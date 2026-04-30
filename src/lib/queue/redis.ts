import { Queue } from "bullmq";
import IORedis from "ioredis";

function createConnection(): IORedis {
  return new IORedis(process.env.REDIS_URL || "redis://localhost:6379", {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: true,
  });
}

const defaultJobOptions = {
  removeOnComplete: 100,
  removeOnFail: 50,
  attempts: 3,
  backoff: {
    type: "exponential" as const,
    delay: 2000,
  },
};

export const leadProcessingQueue = new Queue("lead-processing", {
  connection: createConnection() as never,
  defaultJobOptions,
});

export const messageQueue = new Queue("message-sending", {
  connection: createConnection() as never,
  defaultJobOptions: {
    ...defaultJobOptions,
    backoff: { type: "exponential" as const, delay: 1000 },
  },
});

export const transcriptionQueue = new Queue("transcription", {
  connection: createConnection() as never,
  defaultJobOptions: {
    removeOnComplete: 50,
    removeOnFail: 20,
    attempts: 2,
    backoff: { type: "fixed" as const, delay: 5000 },
  },
});

export const aiResponseQueue = new Queue("ai-response", {
  connection: createConnection() as never,
  defaultJobOptions,
});

export const followUpQueue = new Queue("follow-up", {
  connection: createConnection() as never,
  defaultJobOptions: {
    removeOnComplete: 50,
    removeOnFail: 20,
    attempts: 2,
  },
});

export const webhookQueue = new Queue("webhook-dispatch", {
  connection: createConnection() as never,
  defaultJobOptions: {
    ...defaultJobOptions,
    attempts: 5,
  },
});