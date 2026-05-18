import { scoreTechnicals } from "./technicalAnalysis.js";
import { fetchSentimentScore } from "./sentiment.js";
import { fetchCandles } from "./fetchCandles.js";
import { fetchQuote } from "./fetchQuote.js";
import { SCORE_WEIGHTS, STOCK_ALIASES } from "../config/constants.js";
import { redisClient } from "../config/redis.js";
import { fetchMarketContext } from "./marketContext.js";

function todayKey() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function normalizeText(value) {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function buildHistorySummary(result) {
  const plan = result?.tradePlan ?? {};
  return {
    symbol: result?.symbol ?? null,
    rating: result?.rating ?? null,
    potentialScore: result?.potentialScore ?? null,
    setup: result?.setup ?? plan.setup ?? null,
    action: result?.action ?? plan.action ?? null,
    composite: result?.composite ?? null,
    livePrice: plan.livePrice ?? plan.lastClose ?? null,
    entry: plan.entry?.trigger ?? null,
    stopLoss: plan.stopLoss ?? null,
    target1: plan.target1 ?? null,
    target2: plan.target2 ?? null,
    rewardToRisk: plan.rewardToRisk ?? null,
    priceSource: plan.priceSource ?? null,
  };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function buildRating(result, marketContext) {
  const signals = result.tech?.signals ?? {};
  const plan = result.tradePlan ?? {};
  const breakout = signals.breakout ?? {};
  const marketScore = marketContext?.primary?.score ?? 50;
  const warningPenalty = Math.min((signals.warnings?.length ?? 0) * 3, 12);

  let potentialScore = result.composite;
  potentialScore += (marketScore - 50) * 0.18;
  if (signals.priceAboveEmas) potentialScore += 5;
  if (breakout.near) potentialScore += 5;
  if (breakout.confirmed) potentialScore += 6;
  if (Number(plan.stopLossPct ?? 99) <= 6) potentialScore += 4;
  if (Number(signals.rsi ?? 0) >= 45 && Number(signals.rsi ?? 0) <= 68) potentialScore += 3;
  if (Number(signals.volRatio ?? 0) >= 1.1 || Number(signals.intradayVolRatio ?? 0) >= 0.45) potentialScore += 3;
  potentialScore -= warningPenalty;
  if (!signals.confirmation?.validBreakout) potentialScore = Math.min(potentialScore, 82);
  if (Number(signals.volRatio ?? 0) < 0.75 && Number(signals.intradayVolRatio ?? 0) < 0.45) {
    potentialScore = Math.min(potentialScore, 78);
  }
  if (!signals.priceAboveEmas) potentialScore = Math.min(potentialScore, 55);
  potentialScore = Math.round(clamp(potentialScore, 0, 100));

  const buyableRisk = Number(plan.stopLossPct ?? 99) <= 8.5 &&
    Number(plan.rewardToRisk ?? 0) >= 1.8;
  const buyTrigger = breakout.confirmed || breakout.near;
  const weakStructure = !signals.priceAboveEmas && !breakout.near;

  let rating = "AVOID";
  let ratingReason = "Structure is not clean enough for a swing entry";
  let action = result.action;

  if (potentialScore >= 68 && buyableRisk && buyTrigger && marketScore >= 45) {
    rating = "BUY";
    ratingReason = breakout.confirmed
      ? "Best available buy candidate: price is breaking/reclaiming resistance with controlled risk"
      : "Best available buy candidate: trend, risk and market context are constructive";
    action = breakout.confirmed ? "BUY: breakout active" : "BUY: use trigger and strict stop";
  } else if (potentialScore >= 58 && buyableRisk && signals.priceAboveEmas && marketScore >= 45) {
    rating = "ACCUMULATE";
    ratingReason = "Potential setup: build only near support/trigger and keep position size moderate";
    action = "ACCUMULATE: wait for confirmation or dips";
  } else if (potentialScore >= 45) {
    rating = "WATCH";
    ratingReason = "Watchlist setup: needs cleaner trend, volume or breakout confirmation";
    action = "WATCH: no fresh buy until trigger improves";
  }

  return {
    rating,
    potentialScore,
    ratingReason,
    action,
  };
}

export function resolveSymbol(input) {
  const normalized = normalizeText(input);
  if (!normalized) return null;
  return STOCK_ALIASES[normalized] ?? normalized;
}

export function isActionableCandidate(item) {
  const signals = item.tech?.signals ?? {};
  const plan = item.tradePlan ?? {};
  const breakout = signals.breakout ?? {};

  return ["BUY", "ACCUMULATE"].includes(item.rating) &&
    item.potentialScore >= 58 &&
    signals.priceAboveEmas === true &&
    Number(plan.stopLossPct ?? 99) <= 8.5 &&
    Number(plan.rewardToRisk ?? 0) >= 1.8 &&
    (breakout.near === true || breakout.confirmed === true);
}

export async function analyzeSymbol(symbol) {
  const normalized = resolveSymbol(symbol);
  if (!normalized) throw new Error("Enter a valid NSE stock name or symbol");

  const candles = await fetchCandles(normalized);
  const lastClose = candles.at(-1)?.close ?? null;
  const quote = await fetchQuote(normalized, lastClose);
  const tech = scoreTechnicals(candles, {
    livePrice: quote.livePrice,
    dayHigh: quote.high,
    dayLow: quote.low,
    liveVolume: quote.volume,
  });
  const sentiment = await fetchSentimentScore(normalized);
  const marketContext = await fetchMarketContext(normalized);

  const composite = Math.round(
    tech.score * SCORE_WEIGHTS.technical +
    sentiment.score * SCORE_WEIGHTS.sentiment
  );

  const tradePlan = tech.tradePlan
    ? {
        ...tech.tradePlan,
        livePrice: quote.livePrice ?? tech.tradePlan.livePrice,
        previousClose: quote.previousClose ?? tech.tradePlan.previousClose,
        liveChange: quote.change,
        liveChangePct: quote.changePct,
        priceSource: quote.source,
      }
    : null;

  const baseResult = {
    symbol: normalized,
    composite,
    setup: tradePlan?.setup ?? "Watch",
    action: tradePlan?.action ?? "Wait for cleaner confirmation",
    tradePlan,
    tech: {
      score: tech.score,
      signals: tech.signals,
    },
    sentiment: {
      score: sentiment.score,
      headline_count: sentiment.headline_count,
      headlines: sentiment.headlines,
      sentiment_label: sentiment.sentiment_label,
    },
    market: marketContext,
  };

  const rating = buildRating(baseResult, marketContext);
  return {
    ...baseResult,
    rating: rating.rating,
    potentialScore: rating.potentialScore,
    ratingReason: rating.ratingReason,
    action: rating.action,
  };
}

export async function saveScanHistory(results, scannedCount, source = "scan", query = null) {
  const entry = {
    id: Date.now().toString(),
    date: todayKey(),
    source,
    query,
    scannedAt: new Date().toISOString(),
    scannedCount,
    resultCount: results.length,
    summary: results.map(buildHistorySummary),
    results,
  };

  await redisClient.lpush("scan:history", JSON.stringify(entry));
  await redisClient.ltrim("scan:history", 0, 99);
  await redisClient.set(`scan:history:${entry.date}:${entry.id}`, JSON.stringify(entry), "EX", 60 * 60 * 24 * 180);
  return entry;
}
