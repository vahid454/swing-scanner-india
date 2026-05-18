/**
 * queues/scanQueue.js — BullMQ queue definition
 *
 * Uses the dedicated bullmqRedis connection (maxRetriesPerRequest: null).
 * Import path uses ../../ because this file lives in /queues, one level
 * outside /src.
 */

import { Queue } from "bullmq";
import { bullmqRedis } from "../src/config/redis.js";

export const scanQueue = new Queue("stock-scan", {
  connection: bullmqRedis,
  defaultJobOptions: {
    removeOnComplete: 20,
    removeOnFail:     50,
    attempts:         2,
    backoff: { type: "exponential", delay: 2000 },
  },
});

export async function clearRepeatingJobs() {
  const repeatableJobs = await scanQueue.getRepeatableJobs();
  for (const job of repeatableJobs) {
    await scanQueue.removeRepeatableByKey(job.key);
  }
  if (repeatableJobs.length) {
    console.log(`[Queue] Removed ${repeatableJobs.length} stale repeating scan(s)`);
  }
}
