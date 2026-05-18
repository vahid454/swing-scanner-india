/**
 * workers/scanWorker.js — BullMQ worker: runs the full scan pipeline
 *
 * Pipeline per job:
 *  1. Fetch OHLCV candles (Redis cache → Finnhub REST fallback)
 *  2. scoreTechnicals()  → RSI / MACD / EMA / Volume score
 *  3. fetchSentimentScore() → Finnhub news keyword score
 *  4. Weighted composite score
 *  5. Cache top-N in Redis "scan:results"
 *  6. Broadcast to all connected WebSocket clients
 */

import { Worker } from "bullmq";
import { bullmqRedis, redisClient } from "../config/redis.js";
import { analyzeSymbol, getSmartLookupSymbols, isActionableCandidate, saveScanHistory } from "../helpers/scanEngine.js";
import { WATCHLIST, TOP_N } from "../config/constants.js";
import { clearRepeatingJobs }        from "../../queues/scanQueue.js";

// In-memory set of active WebSocket connections (populated by server.js)
export const wsClients = new Set();

function broadcastResults(top) {
  const msg = JSON.stringify({ type: "scan_result", data: top, ts: Date.now() });
  for (const socket of wsClients) {
    try {
      if (socket.readyState === 1 /* OPEN */) socket.send(msg);
    } catch (_) { /* stale client — will be cleaned up on close event */ }
  }
}

function ratingPriority(item) {
  if (item.rating === "BUY") return 4;
  if (item.rating === "ACCUMULATE") return 3;
  if (item.rating === "WATCH") return 2;
  return 1;
}

async function analyzeSymbols(symbols, app, concurrency = 4) {
  const results = [];
  for (let i = 0; i < symbols.length; i += concurrency) {
    const batch = symbols.slice(i, i + concurrency);
    const settled = await Promise.allSettled(batch.map((symbol) => analyzeSymbol(symbol)));
    settled.forEach((item, index) => {
      const symbol = batch[index];
      if (item.status === "fulfilled") {
        results.push(item.value);
      } else {
        app.log.warn(`[Worker] Skipping ${symbol}: ${item.reason?.message ?? item.reason}`);
      }
    });
  }
  return results;
}

export function startScanWorker(app) {
  clearRepeatingJobs();

  const worker = new Worker(
    "stock-scan",
    async (job) => {
      const explicitSymbols = job.data.symbols?.length ? job.data.symbols : null;
      const smartLookups = explicitSymbols ? [] : await getSmartLookupSymbols(25);
      const symbols = [...new Set([...(explicitSymbols ?? WATCHLIST), ...smartLookups])];
      const source = job.data.source ?? "scan";
      const query = job.data.query ?? null;
      app.log.info(`[Worker] Scanning ${symbols.length} symbols (${smartLookups.length} smart lookups)…`);

      const results = await analyzeSymbols(symbols, app);

      if (results.length === 0) {
        app.log.warn("[Worker] No results — check FINNHUB_API_KEY in .env");
        return [];
      }

      // 5. Sort and slice top N
      const ranked = results.sort((a, b) =>
        ratingPriority(b) - ratingPriority(a) ||
        (b.potentialScore ?? b.composite) - (a.potentialScore ?? a.composite)
      );
      const actionable = ranked.filter(isActionableCandidate);
      const top = [
        ...actionable,
        ...ranked.filter((item) => !actionable.includes(item)),
      ].slice(0, TOP_N);

      // 6. Cache and history
      await redisClient.set("scan:results", JSON.stringify(top), "EX", 300);
      await saveScanHistory(top, symbols.length, source, query);

      // 7. Broadcast to WebSocket clients
      broadcastResults(top);

      app.log.info(
        top.length
          ? `[Worker] Done — #1: ${top[0].symbol} (${top[0].composite})`
          : "[Worker] Done — no actionable candidates passed filters"
      );
      return top;
    },
    {
      connection: bullmqRedis,
      concurrency: 1,
    }
  );

  worker.on("completed", (job) => {
    app.log.info(`[Worker] Job ${job.id} completed`);
  });

  worker.on("failed", (job, err) => {
    app.log.error(`[Worker] Job ${job?.id} failed: ${err.message}`);
  });

  return worker;
}
