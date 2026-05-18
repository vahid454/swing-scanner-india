/**
 * routes/scanner.js
 *
 * GET  /api/scanner/results  → cached top-5 from Redis
 * POST /api/scanner/trigger  → enqueue one-off scan now
 * GET  /api/scanner/status   → queue stats (waiting, active, completed)
 */

import { scanQueue }  from "../../queues/scanQueue.js";
import { redisClient } from "../config/redis.js";
import {
  analyzeSymbol,
  getSmartLookupSummaries,
  isActionableCandidate,
  rememberSmartLookup,
  resolveSymbol,
  saveScanHistory,
} from "../helpers/scanEngine.js";

function todayKey() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function rowHasSymbol(row, symbol) {
  if (!symbol) return true;
  const normalized = resolveSymbol(symbol) ?? String(symbol).trim().toUpperCase();
  const pool = [
    ...(row.summary ?? []),
    ...(row.results ?? []),
  ];
  return pool.some((item) => item?.symbol === normalized);
}

function topSummary(row) {
  return row.summary?.[0] ?? row.results?.[0] ?? null;
}

export default async function scannerRoutes(app) {
  // Latest cached results
  app.get("/results", async (_req, reply) => {
    const cached = await redisClient.get("scan:results");
    if (!cached) {
      return reply.code(202).send({
        message: "No scan results yet. Click 'Run Scan Now' or search a stock.",
      });
    }
    return reply.send(JSON.parse(cached));
  });

  // Manually trigger a scan
  app.post("/trigger", async (_req, reply) => {
    await redisClient.del("scan:results");
    const job = await scanQueue.add("manual-scan", { symbols: [], source: "scan" }, {
      priority: 1, // jump queue
    });
    return reply.send({ jobId: job.id, message: "Live scan queued - results will appear shortly" });
  });

  app.post("/search", async (req, reply) => {
    const query = String(req.body?.query ?? req.body?.symbol ?? "").trim();
    const symbol = resolveSymbol(query);
    if (!symbol) {
      return reply.code(400).send({ error: "Enter a stock name or NSE symbol" });
    }

    try {
      const result = await analyzeSymbol(symbol);
      const rows = [result];
      await redisClient.set("scan:results", JSON.stringify(rows), "EX", 300);
      await rememberSmartLookup(result, query);
      await saveScanHistory(rows, 1, "search", query);
      return reply.send({
        query,
        symbol,
        actionable: isActionableCandidate(result),
        results: rows,
      });
    } catch (err) {
      return reply.code(404).send({ error: err.message, query, symbol });
    }
  });

  app.get("/history", async (req, reply) => {
    const limit = Math.min(Number(req.query.limit) || 25, 100);
    const date = String(req.query.date ?? "").trim();
    const source = String(req.query.source ?? "").trim().toLowerCase();
    const symbol = String(req.query.symbol ?? "").trim();
    const rows = await redisClient.lrange("scan:history", 0, 199);
    const filtered = rows
      .map((row) => JSON.parse(row))
      .filter((row) => !date || row.date === date)
      .filter((row) => !source || source === "all" || row.source === source)
      .filter((row) => rowHasSymbol(row, symbol))
      .slice(0, limit);
    return reply.send(filtered);
  });

  app.get("/smart-lookups", async (req, reply) => {
    const limit = Math.min(Number(req.query.limit) || 20, 50);
    return reply.send(await getSmartLookupSummaries(limit));
  });

  app.get("/today", async (_req, reply) => {
    const date = todayKey();
    const rows = (await redisClient.lrange("scan:history", 0, 199))
      .map((row) => JSON.parse(row))
      .filter((row) => row.date === date);
    const smartLookups = await getSmartLookupSummaries(12);

    const bySymbol = new Map();
    for (const row of rows) {
      for (const item of row.summary ?? []) {
        const existing = bySymbol.get(item.symbol);
        if (!existing || Number(item.potentialScore ?? 0) > Number(existing.potentialScore ?? 0)) {
          bySymbol.set(item.symbol, { ...item, source: row.source, scannedAt: row.scannedAt });
        }
      }
    }

    const picks = [...bySymbol.values()]
      .sort((a, b) => Number(b.potentialScore ?? 0) - Number(a.potentialScore ?? 0))
      .slice(0, 8);
    const latest = rows[0] ? topSummary(rows[0]) : null;

    return reply.send({
      date,
      scanCount: rows.filter((row) => row.source === "scan").length,
      searchCount: rows.filter((row) => row.source === "search").length,
      bestPick: picks[0] ?? latest,
      picks,
      smartLookups,
    });
  });

  // Queue health / stats
  app.get("/status", async (_req, reply) => {
    const [waiting, active, completed, failed] = await Promise.all([
      scanQueue.getWaitingCount(),
      scanQueue.getActiveCount(),
      scanQueue.getCompletedCount(),
      scanQueue.getFailedCount(),
    ]);
    return reply.send({ waiting, active, completed, failed });
  });
}
