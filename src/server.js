/**
 * server.js — Fastify entry point
 *
 * Boot order:
 *  1. Register Fastify plugins
 *  2. Connect Redis (both clients) — exits clearly if Redis is down
 *  3. Mount API routes
 *  4. Register /ws WebSocket endpoint (client set managed here)
 *  5. Start scan worker + schedule repeating job
 *  6. Listen
 */

import "dotenv/config";
import Fastify         from "fastify";
import fastifyStatic   from "@fastify/static";
import fastifyWs       from "@fastify/websocket";
import fastifyCors     from "@fastify/cors";
import { fileURLToPath } from "url";
import path            from "path";

import { connectRedis }             from "./config/redis.js";
import { startScanWorker, wsClients } from "./workers/scanWorker.js";
import scannerRoutes                from "./routes/scanner.js";
import stocksRoutes                 from "./routes/stocks.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = Fastify({
  logger: {
    level: "info",
    transport:
      process.env.NODE_ENV !== "production"
        ? { target: "pino-pretty", options: { colorize: true } }
        : undefined,
  },
});

// ── Plugins ───────────────────────────────────────────────────────────────
await app.register(fastifyCors, { origin: "*" });
await app.register(fastifyWs);
await app.register(fastifyStatic, {
  root: path.join(__dirname, "../public"),
  prefix: "/",
});

// ── Routes ────────────────────────────────────────────────────────────────
await app.register(scannerRoutes, { prefix: "/api/scanner" });
await app.register(stocksRoutes,  { prefix: "/api/stocks" });

// ── Health check ──────────────────────────────────────────────────────────
app.get("/health", async () => ({ status: "ok", ts: Date.now() }));

// ── WebSocket endpoint ────────────────────────────────────────────────────
// The worker imports & updates `wsClients` directly.
app.get("/ws", { websocket: true }, (socket, _req) => {
  wsClients.add(socket);
  app.log.info(`[WS] Client connected (total: ${wsClients.size})`);

  socket.on("close", () => {
    wsClients.delete(socket);
    app.log.info(`[WS] Client disconnected (total: ${wsClients.size})`);
  });

  socket.on("error", () => wsClients.delete(socket));
});

// ── Startup ───────────────────────────────────────────────────────────────
const start = async () => {
  try {
    // Connect Redis before anything else — gives clear error if not running
    await connectRedis();

    // Start worker (schedules repeating job internally)
    startScanWorker(app);

    await app.listen({ port: Number(process.env.PORT) || 8786, host: "0.0.0.0" });
    app.log.info("🚀  NSE Swing Scanner running");
  } catch (err) {
    console.error("\n❌  Startup failed:", err.message, "\n");
    process.exit(1);
  }
};

start();
