/**
 * helpers/fetchCandles.js - OHLCV candle fetcher.
 *
 * Uses Finnhub first, then Yahoo Finance NSE chart data. It never fabricates
 * prices during a real scan; bad provider data skips the symbol instead.
 */

import { redisClient } from "../config/redis.js";
import { API } from "../config/constants.js";

const CACHE_TTL = 45;
const DAYS_BACK = 180;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function yahooSymbol(symbol) {
  return `${symbol.toUpperCase()}.NS`;
}

function isUsableCandles(candles) {
  return Array.isArray(candles) &&
    candles.length >= 55 &&
    candles.every((c) =>
      Number.isFinite(c.open) &&
      Number.isFinite(c.high) &&
      Number.isFinite(c.low) &&
      Number.isFinite(c.close) &&
      Number.isFinite(c.volume)
    );
}

function parseFinnhubCandles(data, provider) {
  if (data?.s !== "ok" || !data.c?.length) return [];
  return data.t.map((time, i) => ({
    time,
    open: Number(data.o[i]),
    high: Number(data.h[i]),
    low: Number(data.l[i]),
    close: Number(data.c[i]),
    volume: Number(data.v[i]),
    provider,
  }));
}

function parseYahooCandles(data, provider) {
  const result = data?.chart?.result?.[0];
  const timestamps = result?.timestamp ?? [];
  const quote = result?.indicators?.quote?.[0];
  if (!timestamps.length || !quote) return [];

  return timestamps
    .map((time, i) => ({
      time,
      open: Number(quote.open?.[i]),
      high: Number(quote.high?.[i]),
      low: Number(quote.low?.[i]),
      close: Number(quote.close?.[i]),
      volume: Number(quote.volume?.[i]),
      provider,
    }))
    .filter((c) =>
      Number.isFinite(c.open) &&
      Number.isFinite(c.high) &&
      Number.isFinite(c.low) &&
      Number.isFinite(c.close) &&
      Number.isFinite(c.volume)
    );
}

async function fetchFinnhubCandles(symbol) {
  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey || apiKey === "your_finnhub_api_key_here") return [];

  const to = Math.floor(Date.now() / 1000);
  const from = to - DAYS_BACK * 24 * 60 * 60;
  const url =
    `${API.FINNHUB_BASE}/stock/candle` +
    `?symbol=NSE:${symbol}&resolution=D&from=${from}&to=${to}` +
    `&token=${apiKey}`;

  await sleep(90);
  const res = await fetch(url);
  const data = await res.json();
  return parseFinnhubCandles(data, "finnhub-candle");
}

async function fetchYahooCandles(symbol) {
  const url =
    `${API.YAHOO_CHART}/${encodeURIComponent(yahooSymbol(symbol))}` +
    "?range=6mo&interval=1d&includePrePost=false";

  const res = await fetch(url, {
    headers: { "user-agent": "Mozilla/5.0 swing-scanner-india" },
  });
  const data = await res.json();
  return parseYahooCandles(data, "yahoo-chart");
}

/**
 * @param {string} symbol e.g. "RELIANCE"
 * @returns {Array<{open,high,low,close,volume,time,provider}>}
 */
export async function fetchCandles(symbol) {
  const normalized = symbol.toUpperCase();
  const cacheKey = `ohlcv:${normalized}`;

  const cached = await redisClient.get(cacheKey);
  if (cached) {
    const candles = JSON.parse(cached);
    if (isUsableCandles(candles) && candles.at(-1)?.provider) return candles;
  }

  let candles = [];
  try {
    candles = await fetchFinnhubCandles(normalized);
  } catch (err) {
    console.warn(`[Candles] Finnhub failed for NSE:${normalized}: ${err.message}`);
  }

  if (!isUsableCandles(candles)) {
    try {
      candles = await fetchYahooCandles(normalized);
    } catch (err) {
      console.warn(`[Candles] Yahoo failed for ${yahooSymbol(normalized)}: ${err.message}`);
    }
  }

  if (!isUsableCandles(candles)) {
    throw new Error(`No real candle data available for ${normalized}`);
  }

  await redisClient.set(cacheKey, JSON.stringify(candles), "EX", CACHE_TTL);
  return candles;
}
