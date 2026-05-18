import { EMA, MACD, RSI } from "technicalindicators";
import { redisClient } from "../config/redis.js";
import { API, BANKING_SYMBOLS, MARKET_INDEXES } from "../config/constants.js";

const CACHE_TTL = 60;

function round(value, places = 2) {
  if (!Number.isFinite(value)) return null;
  return +value.toFixed(places);
}

function parseYahooCandles(data) {
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
    }))
    .filter((c) =>
      Number.isFinite(c.open) &&
      Number.isFinite(c.high) &&
      Number.isFinite(c.low) &&
      Number.isFinite(c.close)
    );
}

function scoreIndex(name, candles) {
  if (!candles.length || candles.length < 55) {
    return {
      name,
      score: 50,
      trend: "neutral",
      factors: ["Index context unavailable"],
      warnings: [],
    };
  }

  const closes = candles.map((c) => c.close);
  const price = closes.at(-1);
  const ema20 = EMA.calculate({ values: closes, period: 20 }).at(-1) ?? price;
  const ema50 = EMA.calculate({ values: closes, period: 50 }).at(-1) ?? price;
  const rsi = RSI.calculate({ values: closes, period: 14 }).at(-1) ?? 50;
  const macd = MACD.calculate({
    values: closes,
    fastPeriod: 12,
    slowPeriod: 26,
    signalPeriod: 9,
    SimpleMAOscillator: false,
    SimpleMASignal: false,
  }).at(-1);

  const ret5 = ((price - closes.at(-6)) / closes.at(-6)) * 100;
  const ret20 = ((price - closes.at(-21)) / closes.at(-21)) * 100;
  const above20 = price > ema20;
  const above50 = price > ema50;
  const stacked = ema20 > ema50;
  const macdPositive = macd ? macd.MACD > macd.signal : false;

  let score = 35;
  if (above20) score += 15;
  if (above50) score += 15;
  if (stacked) score += 15;
  if (rsi >= 45 && rsi <= 68) score += 10;
  if (macdPositive) score += 10;
  if (ret5 > 0) score += 5;
  if (ret20 > 0) score += 5;
  score = Math.min(100, score);

  const factors = [];
  const warnings = [];
  if (above20 && above50) factors.push(`${name} is above EMA20/EMA50`);
  if (macdPositive) factors.push(`${name} MACD supports risk-on momentum`);
  if (ret20 > 0) factors.push(`${name} 20-day return is positive (${round(ret20, 1)}%)`);
  if (!above50) warnings.push(`${name} is below EMA50`);
  if (rsi < 40) warnings.push(`${name} RSI is weak (${round(rsi, 1)})`);

  return {
    name,
    score,
    trend: score >= 70 ? "bullish" : score >= 50 ? "neutral" : "weak",
    price: round(price),
    ema20: round(ema20),
    ema50: round(ema50),
    rsi: round(rsi, 1),
    ret5: round(ret5, 2),
    ret20: round(ret20, 2),
    factors,
    warnings,
  };
}

async function fetchIndexContext(name, yahooSymbol) {
  const cacheKey = `market:index:${name}`;
  const cached = await redisClient.get(cacheKey);
  if (cached) return JSON.parse(cached);

  const url =
    `${API.YAHOO_CHART}/${encodeURIComponent(yahooSymbol)}` +
    "?range=6mo&interval=1d&includePrePost=false";

  const res = await fetch(url, {
    headers: { "user-agent": "Mozilla/5.0 swing-scanner-india" },
  });
  const data = await res.json();
  const context = scoreIndex(name, parseYahooCandles(data));
  await redisClient.set(cacheKey, JSON.stringify(context), "EX", CACHE_TTL);
  return context;
}

export function sectorIndexName(symbol) {
  return BANKING_SYMBOLS.has(symbol) ? "BANKNIFTY" : "NIFTY";
}

export async function fetchMarketContext(symbol) {
  const indexName = sectorIndexName(symbol);
  const [nifty, sector] = await Promise.all([
    fetchIndexContext("NIFTY", MARKET_INDEXES.NIFTY),
    indexName === "NIFTY"
      ? Promise.resolve(null)
      : fetchIndexContext(indexName, MARKET_INDEXES[indexName]),
  ]);

  return {
    primary: sector ?? nifty,
    nifty,
    sector: sector ?? nifty,
  };
}
