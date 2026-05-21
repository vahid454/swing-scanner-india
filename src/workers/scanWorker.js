/**
 * workers/scanWorker.js — BullMQ worker: runs the full scan pipeline
 *
 * Improvements:
 *  - Better error handling and recovery
 *  - Progress tracking
 *  - Graceful degradation when providers fail
 *  - Health monitoring
 */

import { Worker } from "bullmq";
import { bullmqRedis, redisClient } from "../config/redis.js";
import {
  analyzeSymbol,
  getSmartLookupSymbols,
  isActionableCandidate,
  saveScanHistory,
} from "../helpers/scanEngine.js";
import { fetchCandlesBatch, getProviderStatus, resetProvider } from "../helpers/fetchCandles.js";
import { WATCHLIST, TOP_N } from "../config/constants.js";
import { clearRepeatingJobs } from "../../queues/scanQueue.js";

// In-memory set of active WebSocket connections
export const wsClients = new Set();

// Scan statistics for monitoring
const scanStats = {
  totalScans: 0,
  successfulScans: 0,
  failedSymbols: 0,
  lastScanTime: null,
  lastScanDuration: 0,
  avgSymbolsPerScan: 0,
};

function broadcastResults(top) {
  const msg = JSON.stringify({ type: "scan_result", data: top, ts: Date.now() });
  let sentCount = 0;
  
  for (const socket of wsClients) {
    try {
      if (socket.readyState === 1 /* OPEN */) {
        socket.send(msg);
        sentCount++;
      }
    } catch (_) {
      /* stale client — will be cleaned up on close event */
    }
  }
  
  return sentCount;
}

function broadcastProgress(progress) {
  const msg = JSON.stringify({ type: "scan_progress", ...progress, ts: Date.now() });
  for (const socket of wsClients) {
    try {
      if (socket.readyState === 1) socket.send(msg);
    } catch (_) {}
  }
}

function ratingPriority(item) {
  if (item.rating === "BUY") return 4;
  if (item.rating === "ACCUMULATE") return 3;
  if (item.rating === "WATCH") return 2;
  return 1;
}

async function analyzeSymbolsWithProgress(symbols, app, concurrency = 4) {
  const results = [];
  const errors = [];
  const total = symbols.length;
  let processed = 0;
  
  for (let i = 0; i < symbols.length; i += concurrency) {
    const batch = symbols.slice(i, i + concurrency);
    
    // Broadcast progress
    broadcastProgress({
      processed,
      total,
      percent: Math.round((processed / total) * 100),
      currentBatch: batch,
    });
    
    const settled = await Promise.allSettled(
      batch.map((symbol) =>
        analyzeSymbol(symbol).catch((err) => {
          // Return a partial result instead of throwing
          return {
            symbol,
            error: err.message,
            skipped: true,
          };
        })
      )
    );
    
    settled.forEach((item, index) => {
      const symbol = batch[index];
      processed++;
      
      if (item.status === "fulfilled") {
        if (item.value.skipped) {
          errors.push({ symbol, error: item.value.error });
          app.log.warn(`[Worker] Skipping ${symbol}: ${item.value.error}`);
        } else {
          results.push(item.value);
        }
      } else {
        errors.push({ symbol, error: item.reason?.message ?? "Unknown error" });
        app.log.warn(`[Worker] Failed ${symbol}: ${item.reason?.message ?? item.reason}`);
      }
    });
    
    // Small delay between batches to avoid overwhelming APIs
    if (i + concurrency < symbols.length) {
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  
  return { results, errors };
}

async function prefetchCandles(symbols, app) {
  // Pre-warm the cache with a batch fetch
  app.log.info(`[Worker] Pre-fetching candles for ${symbols.length} symbols...`);
  const candleResults = await fetchCandlesBatch(symbols, 5);
  
  const successful = [];
  const failed = [];
  
  for (const [symbol, result] of candleResults) {
    if (result.error) {
      failed.push({ symbol, error: result.error });
    } else {
      successful.push(symbol);
    }
  }
  
  app.log.info(`[Worker] Pre-fetch complete: ${successful.length} successful, ${failed.length} failed`);
  
  if (failed.length > 0 && failed.length <= 10) {
    app.log.warn(`[Worker] Failed symbols: ${failed.map((f) => f.symbol).join(", ")}`);
  }
  
  return { successful, failed };
}

function checkProviderHealth(app) {
  const status = getProviderStatus();
  const disabledProviders = Object.entries(status)
    .filter(([_, state]) => state.disabled)
    .map(([name]) => name);
  
  if (disabledProviders.length > 0) {
    app.log.warn(`[Worker] Disabled providers: ${disabledProviders.join(", ")}`);
    
    // Auto-reset providers that have been disabled for too long
    disabledProviders.forEach((provider) => {
      if (status[provider].lastCallAgo > 120000) {
        // 2 minutes
        resetProvider(provider);
        app.log.info(`[Worker] Auto-reset provider: ${provider}`);
      }
    });
  }
  
  return status;
}

export function startScanWorker(app) {
  clearRepeatingJobs();

  const worker = new Worker(
    "stock-scan",
    async (job) => {
      const startTime = Date.now();
      scanStats.totalScans++;
      scanStats.lastScanTime = new Date().toISOString();
      
      // Check provider health before starting
      checkProviderHealth(app);
      
      const explicitSymbols = job.data.symbols?.length ? job.data.symbols : null;
      const smartLookups = explicitSymbols ? [] : await getSmartLookupSymbols(25);
      const allSymbols = [...new Set([...(explicitSymbols ?? WATCHLIST), ...smartLookups])];
      const source = job.data.source ?? "scan";
      const query = job.data.query ?? null;
      
      app.log.info(
        `[Worker] Starting scan of ${allSymbols.length} symbols (${smartLookups.length} smart lookups)`
      );
      
      // Broadcast scan start
      broadcastProgress({
        status: "started",
        total: allSymbols.length,
        processed: 0,
        percent: 0,
      });

      // Step 1: Pre-fetch candles (optional optimization)
      let symbolsToAnalyze = allSymbols;
      if (job.data.prefetchCandles !== false) {
        const { successful, failed } = await prefetchCandles(allSymbols, app);
        
        // Only analyze symbols where we got candle data
        symbolsToAnalyze = successful;
        scanStats.failedSymbols += failed.length;
        
        if (symbolsToAnalyze.length === 0) {
          app.log.error("[Worker] All candle fetches failed - check API keys and network");
          broadcastProgress({ status: "error", message: "No candle data available" });
          return [];
        }
      }

      // Step 2: Analyze symbols
      const { results, errors } = await analyzeSymbolsWithProgress(
        symbolsToAnalyze,
        app,
        job.data.concurrency ?? 4
      );

      if (results.length === 0) {
        app.log.warn("[Worker] No results — check FINNHUB_API_KEY and ALPHA_VANTAGE_API_KEY in .env");
        broadcastProgress({ status: "completed", results: 0, message: "No results found" });
        return [];
      }

      // Step 3: Sort and filter
      const ranked = results.sort(
        (a, b) =>
          ratingPriority(b) - ratingPriority(a) ||
          (b.potentialScore ?? b.composite) - (a.potentialScore ?? a.composite)
      );
      
      const actionable = ranked.filter(isActionableCandidate);
      const top = [
        ...actionable,
        ...ranked.filter((item) => !actionable.includes(item)),
      ].slice(0, TOP_N);

      // Step 4: Cache results
      const cacheData = {
        results: top,
        meta: {
          scannedAt: new Date().toISOString(),
          totalSymbols: allSymbols.length,
          analyzedSymbols: symbolsToAnalyze.length,
          resultsCount: results.length,
          actionableCount: actionable.length,
          errors: errors.length,
          providerStatus: getProviderStatus(),
        },
      };
      
      await redisClient.set("scan:results", JSON.stringify(top), "EX", 300);
      await redisClient.set("scan:meta", JSON.stringify(cacheData.meta), "EX", 300);
      await saveScanHistory(top, allSymbols.length, source, query);

      // Step 5: Broadcast to WebSocket clients
      const clientsNotified = broadcastResults(top);
      broadcastProgress({
        status: "completed",
        results: top.length,
        actionable: actionable.length,
        total: allSymbols.length,
        errors: errors.length,
      });

      // Update stats
      const duration = Date.now() - startTime;
      scanStats.successfulScans++;
      scanStats.lastScanDuration = duration;
      scanStats.avgSymbolsPerScan =
        (scanStats.avgSymbolsPerScan * (scanStats.successfulScans - 1) + allSymbols.length) /
        scanStats.successfulScans;

      app.log.info(
        `[Worker] Scan completed in ${(duration / 1000).toFixed(1)}s — ` +
          `${results.length} analyzed, ${actionable.length} actionable, ` +
          `${errors.length} errors, ${clientsNotified} clients notified`
      );
      
      if (top.length > 0) {
        app.log.info(`[Worker] Top result: ${top[0].symbol} (score: ${top[0].composite})`);
      }

      return top;
    },
    {
      connection: bullmqRedis,
      concurrency: 1,
      limiter: {
        max: 1,
        duration: 10000, // Max 1 scan per 10 seconds
      },
    }
  );

  worker.on("completed", (job) => {
    app.log.info(`[Worker] Job ${job.id} completed`);
  });

  worker.on("failed", (job, err) => {
    app.log.error(`[Worker] Job ${job?.id} failed: ${err.message}`);
    broadcastProgress({ status: "error", message: err.message });
  });

  worker.on("error", (err) => {
    app.log.error(`[Worker] Worker error: ${err.message}`);
  });

  return worker;
}

/**
 * Get scan statistics for monitoring
 */
export function getScanStats() {
  return {
    ...scanStats,
    providerStatus: getProviderStatus(),
  };
}

/**
 * Reset a specific provider
 */
export function resetProviderStatus(provider) {
  resetProvider(provider);
}