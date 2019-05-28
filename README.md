# Brokkr

Brokkr is a background job orchestrator for Node. It's currently designed to use Redis and Kafka as the backbone, but can be easily expanded for other stacks.

## Installation

`npm install --save brokkr`

## Use Case

We mostly use Kafka publishers and subscribers to create message queues and orchestrate async processes that involve multiple microservices. Suddenly, a new, very complex async flow was required, in which the steps and actors were dynamic (determined on runtime), and dynamicly dependent on each other (an acyclic graph of dependencies).

We determined we needed an orchestrator entity for this job. An orchestrator that would be smart on when to trigger each step of the Saga, and that had a simple API for the micro-services to implement. It must also be flexible enough so that we could use it for any kind of Saga in the future.

## Complete Example

**TODO**

## API Examples

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

We want this package to be as resilient as Brokkr. Also, Brokkr sounds like "broker", which has some similarities with what this package does in micro-service architectures (message broker).