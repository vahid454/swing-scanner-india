/**
 * helpers/websocketClient.js — Finnhub WebSocket client
 *
 * Manages a persistent WS connection to Finnhub's real-time trade feed.
 * As Indian stocks trade on NSE, symbols must be prefixed: "NSE:RELIANCE"
 *
 * Data flow:
 *  WS message → parse tick { symbol, price, volume, timestamp }
 *             → update in-memory latest price map
 *             → write to Redis cache key "tick:<SYMBOL>"
 *
 * The scanWorker reads from Redis rather than this map directly,
 * keeping the two concerns decoupled.
 *
 * Note: Finnhub free tier allows ~50 symbol subscriptions simultaneously.
 * Rotate symbols or use Upstox WebSocket (requires free API registration)
 * for full NSE coverage in Phase 2.
 */

import WebSocket from "ws";
import { redisClient } from "../config/redis.js";
import { WATCHLIST, API } from "../config/constants.js";

let wsInstance = null;

export function startFinnhubWebSocket() {
  wsInstance = new WebSocket(`${API.FINNHUB_WS}?token=${process.env.FINNHUB_API_KEY}`);

  wsInstance.on("open", () => {
    console.log("[WS] Finnhub connected — subscribing to NSE symbols");
    for (const symbol of WATCHLIST) {
      wsInstance.send(JSON.stringify({ type: "subscribe", symbol: `NSE:${symbol}` }));
    }
  });

  wsInstance.on("message", async (raw) => {
    try {
      const data = JSON.parse(raw);
      if (data.type !== "trade") return;

      for (const tick of data.data) {
        // tick: { s: "NSE:RELIANCE", p: 2950.5, v: 1200, t: 1716000000000 }
        const sym = tick.s.replace("NSE:", "");
        // TODO: store tick in Redis with short TTL
        // await redisClient.set(`tick:${sym}`, JSON.stringify(tick), "EX", 60);
      }
    } catch (err) {
      console.error("[WS] Parse error:", err.message);
    }
  });

  wsInstance.on("close", () => {
    console.warn("[WS] Finnhub disconnected — reconnecting in 5s");
    // TODO: exponential backoff reconnect
    setTimeout(startFinnhubWebSocket, 5000);
  });

  wsInstance.on("error", (err) => {
    console.error("[WS] Error:", err.message);
  });
}
