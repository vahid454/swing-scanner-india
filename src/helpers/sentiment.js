/**
 * helpers/sentiment.js — News sentiment scoring for Indian stocks
 *
 * Source: Finnhub /company-news (free tier)
 * Scoring: keyword lexicon → aggregate score normalised to 0–100
 *
 * Without an API key: returns a neutral mock score so the app still runs.
 * Redis cache key: "sentiment:<SYMBOL>"  (TTL: 600s = 10 min)
 */

import { redisClient } from "../config/redis.js";
import { API }         from "../config/constants.js";

const CACHE_TTL = 600; // 10 minutes

// Keyword lexicon — weights are additive per headline
const POSITIVE = {
  upgrade: 2, beat: 2, record: 2, profit: 2, growth: 2,
  strong: 1, buy: 1, bullish: 1, outperform: 2, surge: 2,
  "52-week high": 3, breakout: 2, dividend: 1, acquisition: 1,
  order: 1, "order win": 2, expansion: 1, approval: 1, "block deal": 1,
  "stake buy": 2, "raises target": 2, "fresh high": 2,
};
const NEGATIVE = {
  downgrade: -2, miss: -2, loss: -2, weak: -1, sell: -1, bearish: -1,
  underperform: -2, crash: -2, "52-week low": -3, probe: -2,
  fraud: -3, default: -3, debt: -1, "profit warning": -3,
  raid: -3, penalty: -2, "show cause": -2, insolvency: -3,
  pledge: -2, "pledged shares": -2, resignation: -1, lawsuit: -2,
};

const RISK_FLAGS = {
  governance: ["fraud", "probe", "raid", "show cause", "lawsuit", "resignation"],
  leverage: ["default", "insolvency", "debt", "pledged shares", "pledge"],
  earnings: ["profit warning", "miss", "weak demand", "margin pressure"],
  macro: ["tariff", "war", "sanction", "rate hike", "recession"],
};

function scoreHeadline(text) {
  const lower = text.toLowerCase();
  let score = 0;
  for (const [word, weight] of Object.entries(POSITIVE)) {
    if (lower.includes(word)) score += weight;
  }
  for (const [word, weight] of Object.entries(NEGATIVE)) {
    if (lower.includes(word)) score += weight; // weight is already negative
  }
  return score;
}

function collectRiskFlags(articles) {
  const flags = [];
  const blob = articles
    .map((article) => `${article.headline ?? ""} ${article.summary ?? ""}`)
    .join(" ")
    .toLowerCase();
  for (const [category, keywords] of Object.entries(RISK_FLAGS)) {
    const matched = keywords.find((keyword) => blob.includes(keyword));
    if (matched) flags.push({ category, keyword: matched });
  }
  return flags;
}

/**
 * @param {string} symbol e.g. "RELIANCE"
 * @returns {{ score: number, headline_count: number, headlines: string[], sentiment_label: string }}
 */
export async function fetchSentimentScore(symbol) {
  const cacheKey = `sentiment:${symbol}`;

  // ── Cache hit ─────────────────────────────────────────────────────────────
  const cached = await redisClient.get(cacheKey);
  if (cached) return JSON.parse(cached);

  // ── No API key → mock ─────────────────────────────────────────────────────
  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey || apiKey === "your_finnhub_api_key_here") {
    const mock = {
      score: 50,
      headline_count: 0,
      headlines: ["[Demo mode — add FINNHUB_API_KEY for real news]"],
      sentiment_label: "neutral",
      risk_flags: [],
    };
    await redisClient.set(cacheKey, JSON.stringify(mock), "EX", CACHE_TTL);
    return mock;
  }

  // ── Finnhub REST ──────────────────────────────────────────────────────────
  const now  = new Date();
  const to   = now.toISOString().slice(0, 10);              // today
  const from = new Date(now - 2 * 24 * 60 * 60 * 1000)     // 2 days ago
               .toISOString().slice(0, 10);

  const url =
    `${API.FINNHUB_BASE}/company-news` +
    `?symbol=NSE:${symbol}&from=${from}&to=${to}` +
    `&token=${apiKey}`;

  let articles = [];
  try {
    const res = await fetch(url);
    const body = await res.json();
    articles = Array.isArray(body) ? body : [];
  } catch (err) {
    console.error(`[Sentiment] Fetch failed for ${symbol}:`, err.message);
  }

  // ── Score ─────────────────────────────────────────────────────────────────
  let total = 0;
  for (const article of articles) {
    total += scoreHeadline(article.headline || "");
    total += scoreHeadline(article.summary  || "") * 0.5; // summary = half weight
  }
  const riskFlags = collectRiskFlags(articles);
  total -= riskFlags.length * 2.5;

  // Normalise: raw range roughly -10 to +10 per article → map to 0–100
  const maxRaw   = Math.max(articles.length * 3, 1);
  const clamped  = Math.max(-maxRaw, Math.min(maxRaw, total));
  const score    = Math.round(((clamped / maxRaw) + 1) / 2 * 100); // 0–100

  const label =
    score >= 65 ? "bullish" :
    score <= 35 ? "bearish" : "neutral";

  const result = {
    score,
    headline_count: articles.length,
    headlines: articles.slice(0, 5).map((a) => a.headline).filter(Boolean),
    sentiment_label: label,
    risk_flags: riskFlags,
  };

  await redisClient.set(cacheKey, JSON.stringify(result), "EX", CACHE_TTL);
  return result;
}
