/**
 * config/redis.js — Redis connection factory
 *
 * BullMQ requires its OWN connection (maxRetriesPerRequest: null).
 * The app cache uses a separate connection with normal retry settings.
 * Both are created from the same REDIS_URL env var.
 *
 * Cache key convention:
 *  "ohlcv:<SYMBOL>"     → OHLCV candles array  (TTL: 60s)
 *  "scan:results"       → top-5 list JSON       (TTL: 300s)
 *  "sentiment:<SYMBOL>" → sentiment score obj   (TTL: 600s)
 */

import Redis from "ioredis";

const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";

function makeRedis(opts = {}) {
  const client = new Redis(REDIS_URL, {
    lazyConnect: true,
    retryStrategy: (times) => {
      if (times > 5) return null; // stop retrying after 5 attempts
      return Math.min(times * 500, 3000); // backoff: 500ms, 1000ms, …
    },
    ...opts,
  });

  client.on("connect",   () => console.log("[Redis] Connected"));
  client.on("error",     (err) => console.error("[Redis] Error:", err.message));
  client.on("close",     () => console.warn("[Redis] Connection closed"));

  return client;
}

// General-purpose cache client (used by routes & helpers)
export const redisClient = makeRedis();

// Dedicated BullMQ connection (must have maxRetriesPerRequest: null)
export const bullmqRedis = makeRedis({ maxRetriesPerRequest: null });

/**
 * Connect both clients explicitly — called in server.js before anything else.
 * If Redis is not running, throws immediately with a clear message.
 */
export async function connectRedis() {
  try {

    // Connect only if not already connected
    if (redisClient.status === "wait") {
      await redisClient.connect();
    }

    if (bullmqRedis.status === "wait") {
      await bullmqRedis.connect();
    }

    // Verify Redis works
    const pong = await redisClient.ping();

    console.log("[Redis] Both connections ready:", pong);

  } catch (err) {

    throw new Error(
      `[Redis] Cannot connect to ${REDIS_URL}\n` +
      `  Original error: ${err.message}`
    );

  }
}