/**
 * routes/stocks.js
 *
 * GET /api/stocks/watchlist          → current WATCHLIST
 * GET /api/stocks/:symbol/candles    → cached OHLCV
 * GET /api/stocks/:symbol/sentiment  → cached sentiment
 */

import { WATCHLIST }   from "../config/constants.js";
import { redisClient } from "../config/redis.js";
import { fetchQuote } from "../helpers/fetchQuote.js";

export default async function stocksRoutes(app) {
  app.get("/watchlist", async (_req, reply) => {
    return reply.send({ symbols: WATCHLIST, count: WATCHLIST.length });
  });

  app.get("/:symbol/candles", async (req, reply) => {
    const { symbol } = req.params;
    const cached = await redisClient.get(`ohlcv:${symbol.toUpperCase()}`);
    if (!cached) return reply.code(404).send({ error: `No candle data cached for ${symbol}` });
    return reply.send({ symbol, candles: JSON.parse(cached) });
  });

  app.get("/:symbol/sentiment", async (req, reply) => {
    const { symbol } = req.params;
    const cached = await redisClient.get(`sentiment:${symbol.toUpperCase()}`);
    if (!cached) return reply.code(404).send({ error: `No sentiment cached for ${symbol}` });
    return reply.send({ symbol, ...JSON.parse(cached) });
  });

  app.get("/:symbol/quote", async (req, reply) => {
    const { symbol } = req.params;
    const cachedCandles = await redisClient.get(`ohlcv:${symbol.toUpperCase()}`);
    const fallbackPrice = cachedCandles ? JSON.parse(cachedCandles).at(-1)?.close : null;
    const quote = await fetchQuote(symbol, fallbackPrice);
    return reply.send({ symbol: symbol.toUpperCase(), ...quote });
  });
}
