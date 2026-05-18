/**
 * helpers/fetchQuote.js - live NSE quote fetcher.
 *
 * Yahoo chart is preferred for NSE symbols because Finnhub free keys often
 * return empty or delayed Indian-market fields. Finnhub remains a fallback.
 */

import { redisClient } from "../config/redis.js";
import { API } from "../config/constants.js";

const CACHE_TTL = 10;

function round(value, places = 2) {
  if (!Number.isFinite(value)) return null;
  return +value.toFixed(places);
}

function yahooSymbol(symbol) {
  return `${symbol.toUpperCase()}.NS`;
}

function buildQuote(livePrice, previousClose, source, extra = {}) {
  const change = Number.isFinite(livePrice) && Number.isFinite(previousClose)
    ? livePrice - previousClose
    : null;
  const changePct = Number.isFinite(change) && previousClose
    ? (change / previousClose) * 100
    : null;

  return {
    livePrice: round(livePrice),
    previousClose: round(previousClose),
    change: round(change),
    changePct: round(changePct, 2),
    source,
    ...extra,
  };
}

async function fetchYahooQuote(symbol) {
  const url =
    `${API.YAHOO_CHART}/${encodeURIComponent(yahooSymbol(symbol))}` +
    "?range=1d&interval=1m&includePrePost=false";

  const res = await fetch(url, {
    headers: { "user-agent": "Mozilla/5.0 swing-scanner-india" },
  });
  const data = await res.json();
  const result = data?.chart?.result?.[0];
  const meta = result?.meta;
  if (!meta) return null;

  const quote = result?.indicators?.quote?.[0];
  const minuteClose = quote?.close?.filter((v) => Number.isFinite(v)).at(-1);
  const livePrice = Number(meta.regularMarketPrice ?? minuteClose);
  const previousClose = Number(meta.chartPreviousClose ?? meta.previousClose);

  if (!Number.isFinite(livePrice) || livePrice <= 0) return null;

  return buildQuote(livePrice, previousClose, "yahoo-chart", {
    open: round(Number(meta.regularMarketOpen)),
    high: round(Number(meta.regularMarketDayHigh)),
    low: round(Number(meta.regularMarketDayLow)),
    volume: Number.isFinite(Number(meta.regularMarketVolume)) ? Number(meta.regularMarketVolume) : null,
    exchangeTime: meta.regularMarketTime ?? null,
  });
}

async function fetchFinnhubQuote(symbol) {
  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey || apiKey === "your_finnhub_api_key_here") return null;

  const url = `${API.FINNHUB_BASE}/quote?symbol=NSE:${symbol}&token=${apiKey}`;
  const res = await fetch(url);
  const data = await res.json();
  const livePrice = Number(data.c);
  const previousClose = Number(data.pc);
  if (!Number.isFinite(livePrice) || livePrice <= 0) return null;

  return buildQuote(livePrice, previousClose, "finnhub-quote", {
    open: round(Number(data.o)),
    high: round(Number(data.h)),
    low: round(Number(data.l)),
    volume: null,
    exchangeTime: data.t ?? null,
  });
}

/**
 * @param {string} symbol e.g. "RELIANCE"
 * @param {number | null} fallbackPrice latest real candle close
 */
export async function fetchQuote(symbol, fallbackPrice = null) {
  const normalized = symbol.toUpperCase();
  const cacheKey = `quote:${normalized}`;

  const cached = await redisClient.get(cacheKey);
  if (cached) return JSON.parse(cached);

  let quote = null;
  try {
    quote = await fetchYahooQuote(normalized);
  } catch (err) {
    console.warn(`[Quote] Yahoo failed for ${yahooSymbol(normalized)}: ${err.message}`);
  }

  if (!quote) {
    try {
      quote = await fetchFinnhubQuote(normalized);
    } catch (err) {
      console.warn(`[Quote] Finnhub failed for NSE:${normalized}: ${err.message}`);
    }
  }

  if (!quote && Number.isFinite(fallbackPrice)) {
    quote = buildQuote(fallbackPrice, null, "daily-candle");
  }

  if (!quote) {
    throw new Error(`No live quote available for ${normalized}`);
  }

  await redisClient.set(cacheKey, JSON.stringify(quote), "EX", CACHE_TTL);
  return quote;
}
