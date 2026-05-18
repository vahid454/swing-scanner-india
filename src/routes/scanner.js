/**
 * routes/scanner.js
 *
 * GET  /api/scanner/results  → cached top-5 from Redis
 * POST /api/scanner/trigger  → enqueue one-off scan now
 * GET  /api/scanner/status   → queue stats (waiting, active, completed)
 */

import { scanQueue }  from "../../queues/scanQueue.js";
import { redisClient } from "../config/redis.js";
import { analyzeSymbol, isActionableCandidate, resolveSymbol, saveScanHistory } from "../helpers/scanEngine.js";

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
    const rows = await redisClient.lrange("scan:history", 0, limit - 1);
    return reply.send(rows.map((row) => JSON.parse(row)));
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
