# Brokkr

Brokkr is a background job orchestrator for Node. It's currently designed to use Redis and Kafka as the backbone, but can be easily expanded for other stacks.

## Installation

`npm install --save brokkr`

## Use Case

We mostly use Kafka publishers and subscribers to create message queues and orchestrate async processes that involve multiple microservices. Suddenly, a new, very complex async flow was required, in which the steps and actors were dynamic (determined on runtime), and dynamicly dependent on each other (an acyclic graph of dependencies).

We determined we needed an orchestrator entity for this job. An orchestrator that would be smart on when to trigger each step of the Saga, and that had a simple API for the micro-services to implement. It must also be flexible enough so that we could use it for any kind of Saga in the future.

## Simple usage example

First, we declare the workers:

```javascript
// myWorker.js
const myWorker = {
  name: "PDFCreator",
  run: async (args, _, saga, stepId) => {
    const [name, content] = args;
    // The worker generates a PDF...
    await processPDF(name, content);
    // ...and then notifies that the step is finished
    await saga.stepFinished(stepId);
  }
}

module.exports = myWorker;
```

Then, we initialize Brokkr:

```javascript
// server.js (or your initialization file)
const redis = require('redis');
const { Brokkr, buildRedisClient } = require('brokkr');
const myWorker = require('./myWorker');

const client = redis.createClient(REDIS_PORT, REDIS_HOST, {});
const brokkrRedisClient = buildRedisClient(client);

const brokkr = new Brokkr(brokkrRedisClient);
brokkr.registerWorker(myWorker);

// Here is a good place to add brokkr to your server's ctx
ctx.brokkr = brokkr; // Or whichever syntax you are using
```

Finally, we create a Saga:

```javascript
// This could be a POST at /generate_pdf for example
const {brokkr} = ctx;
const saga = await brokkr.createSaga();
const step = await saga.addStep("PDFCreator", ["MyPDF", "Lorem ipsum..."]); // Args must be JSON encodable
// You could define a compensator by using step.compensateWith(...)
saga.start();
```

Notice that this is a very simple example, for which Brokkr is probably over-engineering the solution. Let's see a more complex example in which Brokkr might be of more help.

## Complex usage example

In this example we will create a Hammer Saga, which creates hammer heads, handles and then builds up a hammer by using the head and handle created in the previous steps.

First, we declare the workers:

```javascript
// workers.js
const hammerHeadFactory = {
  name: "HammerHeadFactory",
  run: async (args, _, saga, stepId) => {
    const [headType] = args;
    const head = await createHammer(headType);
    saga.stepFinished(
      stepId, // <-- Required so that Saga can identify which step finished
      {headId: head.id} // <-- This arguments are going to be sent to the next step. Must be JSON encodable!
    );
  }
}

const handleFactory = {
  name: "HandleFactory",
  run: async (args, saga, stepId) => {
    const [handleSize] = args;
    const handle = await createHandle(handleSize);
    saga.stepFinished(
      stepId, // <-- Required so that Saga can identify which step finished
      {handleId: handle.id} // <-- This arguments are going to be sent to the next step. Must be JSON encodable!
    );
  }
}

const hammerFactory = {
  name: "HammerFactory",
  run: async (args, [headArgs, handleArgs], saga, stepId) => {
    const {headId} = headArgs;
    const {handleId} = handleArgs;
    const hammer = await createHammer(headId, handleId);
    saga.stepFinished(stepId);
  }
}

module.exports = {hammerHeadFactory, handleFactory, hammerFactory};
```

Then, we initialize Brokkr:

```javascript
// server.js (or your initialization file)
const redis = require('redis');
const { Brokkr, buildRedisClient } = require('brokkr');
const {hammerHeadFactory, handleFactory, hammerFactory} = require('./workers.js');

const client = redis.createClient(REDIS_PORT, REDIS_HOST, {});
const brokkrRedisClient = buildRedisClient(client);

const brokkr = new Brokkr(brokkrRedisClient);
brokkr.registerWorkers(hammerHeadFactory, handleFactory, hammerFactory);

ctx.brokkr = brokkr;
```

Finally, we create a Saga:

```javascript
// This could be a POST at /hammer for example
const {brokkr} = ctx;
const saga = await brokkr.createSaga();
const headStep = await saga.addStep("HammerHeadFactory", ["ThunderBestowed"]);
const handleStep = await saga.addStep("HandleFactory", ["short"]);
const hammerStep = await saga.addStep(
  "HammerFactory", // <-- The worker name to call for this step
  [], // <-- HammerFactory requires no fixed args.
  [headStep.id, handleStep.id] // <-- This param tells the dependencies of hammerStep
);
saga.start();
```

After doing this, `headStep` and `handleStep` are going to be executed in parallel. `hammerStep` won't be executed until both previous steps finish. Once they finish and notify their are finished using `saga.finishStep`, `hammerStep` will start running and will receive the results from previous steps in the second argument of the worker.

## Handling failure

Brokkr can handle failures between steps. In the previous example, let's simulate a failure while processing the Hammer.

First, we have to define how to process failures. We have to define a compensator step for each failure we want to handle.

```javascript
// When declaring the steps
// ... same as before
const headStep = await saga.addStep("HammerHeadFactory", ["ThunderBestowed"]);
// Now, we define a compensator
headStep.compensateWith("HammerHeadDestroyer", ["anExampleArg"]);
```

The compensator job could look like this:

```javascript
// workers.js
const hammerHeadDestroyer = {
  name: "HammeHeadDestroyer",
  run: async (_, [hammerHeadCreationResult]) => {
    const {headId} = hammerHeadCreationResult;
    await deleteHammerHeadById(headId)
  }
}
```

Notice that the compensator receives in the dependency arguments the result of the step it's compensating. Now, to test that the compensator works, let's simulate a failure in the last step. We will replace the HammerFactory with the following one:

```javascript
// workers.js
const hammerFactory = {
  name: "HammerFactory",
  run: async (args, [headArgs, handleArgs], saga, stepId) => {
    // Someting failed! Notify saga:
    saga.stepFailed(stepId);
  }
}
```

To recap, the flow that will be executed is the following:

1- HammerHead and Handle workers are executed successfully.

2- Hammer worker is executed as its dependencies are finished.

3- Hammer worker will fail and will notify the Saga.

4- The Saga will be marked as failed and its steps will be attempted to rollback.

5- The HammerHead step has a compensator defined, so it will be executed and the created head will be destroyed.

6- The Handle step does not define a compensator so it won't be rolled back.


## Usage with Kafka (or any message queue)

In most cases you might want to span Sagas across multiple micro-services. In these cases, you might not be able to start and finish a Saga step in one handler. Brokkr was designed with this in mind. The following example should illustrate a typical Kafka-Brokkr setup:

### Hammer services example

Let's use the hammer example again. We will assume that each step lives in a different micro-service (we have a hammer head, a handle and a hammer micro-service). The only piece we have to change from the previous example is the workers, as they won't be able to create their resources in a sync way. Here it's shown how the Handle worker might look like, but it should be pretty similar for the rest of the services.


#### Coordinator service (probable will be Hammer service in this example)

The worker can look like this:

```javascript
// workers.js
const topic = 'hammer-handle-creation';

const hammerHandleWorker = {
  name: "HammerHandleWorker",
  run: async (args, _, saga, stepId) => {
    const [handleSize] = args;
    // producer is a kafka producer wrapper that in this example receives the topic and message
    producer.send(topic, JSON.stringify({handleSize, meta: {sagaId: saga.getId()}}))
  }
}
```

And we also have to define a kafka consumer for being notified when the event is completed successfully:

```javascript
// kafka-consumers
const onHammerHandleSuccess = (kafkaEvent) => {
  const {handleId, meta: {sagaId}}  = kafkaEvent;
  const saga = ctx.brokkr.getSaga(sagaId);
  saga.stepFinished(stepId, {handleId: handle.id});
}

subscribeConsumer('hammer-handle-creation-success', onHammerHandleSuccess);
```

#### Hammer Handle Service

We need to consume the 'hammer-handle-creation' event. It could look something like this:

```javascript
// kafka-consumers.js
const topic = 'hammer-handle-creation-success';

const hammerHandleConsumer = (kafkaEvent) => {
  const {handleSize, meta} = kafkaEvent;
  const hammerHandle = await createHammerHandle(handleSize);
  producer.send(topic, JSON.stringify({handleId: hammerHandle.id, meta}))
}
subscribeConsumer('hammer-handle-creation', hammerHandleConsumer);

```

#### Recap

1- Same flow as previous example where the handle and head steps get executed. (This time in the Hammer service).

2- `hammerHandleWorker` is executed. This spins off a kafka event

3- Inside the Hammer Handle service, a kafka consumer creates a handle.

4- This same consumer spins off a `hammer-handle-creation` event.

5- The Hammer service picks up the event in `onHammerHandleSuccess`. It notifies the saga that the step finished successfully using `saga.stepFinished`.

Notice you can also handle failures by producing a `hammer-handle-creation-failed` event and then calling `saga.stepFailed` in its consumer.

## Using the Brokkr Kafka helper

**TODO: We are working on a spec so that the previous flow can be simplified by using a standard shape of produced kafka events. Stay alert.**

## APIs

### Initializing Brokkr with Redis

#### API

**new Brokkr(brokkrRedisClient)**

#### Example

```javascript
const redis = require('redis');
const { Brokkr, buildRedisClient } = require('brokkr');

const client = redis.createClient(REDIS_PORT, REDIS_HOST, {});
const brokkrRedisClient = buildRedisClient(client);

// Instantiate brokkr in the default namespace
const brokkr = new Brokkr(brokkrRedisClient);
// Or use a defined namespace using:
// const brokkr = new Brokkr(brokkrRedisClient, 'myNamespace');
```

### Create a worker

#### API

**{ name: string, run(args: any[], dependencyArgs: any[], saga: Saga, stepId: string): Promise<any> | any }**

#### Example

```javascript
const hammerHandleWorker = {
  name: "HammerHandleWorker",
  run: async (args, _, saga, stepId) => {
    //...
  }
}
```

### Register a worker

#### API

**brokkr.registerWorker(worker: IWorker)**

#### Example

```javascript
brokkr.registerWorker(hammerHandleWorker);
```

### Registering multiple workers

#### API

**brokkr.registerWorkers(...workers: IWorker[])**

#### Example

```javascript
brokkr.registerWorkers(worker1, worker2, worker3);
```

### Creating a Saga

#### API

**async brokkr.createSaga()**

#### Example

```javascript
const saga = await brokkr.createSaga();
```

### Adding a Step

#### API

**async saga.addStep(workerName: string, args: any[], dependsOnSteps?: string[])**

#### Example

```javascript
const step1 = await saga.addStep('worker1', ['2']);
const step2 = await saga.addStep('worker2', ['hello'], [step1.getId()]);
```

## Why is it called Brokkr

Brokkr is a Dwarf from Norse mythology. He and his brother, Eitri, were tasked to build some powerful gifts for the gods, and bet his head with Loki that they could build the finest gifts. He kept working even while Loki attacked him in the shape of a horsefly.

We want this package to be as resilient as Brokkr. Also, Brokkr sounds like "broker", which has some similarities with what this package does in micro-service architectures (message broker). Lastly, this package uses the concept of a Saga, which is also a name given to epic stories, specially the ones inspired in Norse mythology.