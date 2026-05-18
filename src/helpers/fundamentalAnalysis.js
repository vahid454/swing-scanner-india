import { redisClient } from "../config/redis.js";
import { API, STOCK_PROFILES } from "../config/constants.js";

const CACHE_TTL = 60 * 60 * 4;
let yahooAuth = null;
let yahooAuthTs = 0;
const YAHOO_AUTH_TTL = 60 * 60 * 1000;

function round(value, places = 2) {
  if (!Number.isFinite(value)) return null;
  return +value.toFixed(places);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function yahooSymbol(symbol) {
  return `${symbol.toUpperCase()}.NS`;
}

function raw(value) {
  if (value && typeof value === "object" && "raw" in value) return Number(value.raw);
  return Number(value);
}

function text(value) {
  if (value && typeof value === "object" && "fmt" in value) return value.fmt;
  if (value === null || value === undefined) return null;
  return String(value);
}

async function fetchQuoteSummary(symbol) {
  const now = Date.now();
  if (!yahooAuth || now - yahooAuthTs > YAHOO_AUTH_TTL) {
    const cookieRes = await fetch("https://fc.yahoo.com", {
      headers: { "user-agent": "Mozilla/5.0 swing-scanner-india" },
    });
    const cookie = cookieRes.headers.get("set-cookie");
    const crumbRes = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", {
      headers: {
        "user-agent": "Mozilla/5.0 swing-scanner-india",
        ...(cookie ? { cookie } : {}),
      },
    });
    const crumb = await crumbRes.text();
    yahooAuth = { cookie, crumb };
    yahooAuthTs = now;
  }

  const modules = [
    "price",
    "summaryDetail",
    "defaultKeyStatistics",
    "financialData",
    "recommendationTrend",
    "earningsTrend",
    "calendarEvents",
  ].join(",");
  const url =
    `${API.YAHOO_QUOTE_SUMMARY}/${encodeURIComponent(yahooSymbol(symbol))}` +
    `?modules=${modules}&crumb=${encodeURIComponent(yahooAuth.crumb)}`;

  const res = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 swing-scanner-india",
      ...(yahooAuth.cookie ? { cookie: yahooAuth.cookie } : {}),
    },
  });
  const data = await res.json();
  return data?.quoteSummary?.result?.[0] ?? null;
}

function scorePe(pe) {
  if (!Number.isFinite(pe) || pe <= 0) return null;
  if (pe <= 18) return 82;
  if (pe <= 30) return 68;
  if (pe <= 45) return 52;
  if (pe <= 70) return 36;
  return 22;
}

function scoreRatioLowerBetter(value, good, stretched) {
  if (!Number.isFinite(value)) return null;
  if (value <= good) return 78;
  if (value <= stretched) return 55;
  return 30;
}

function scoreGrowth(value) {
  if (!Number.isFinite(value)) return null;
  const pct = value * 100;
  if (pct >= 20) return 86;
  if (pct >= 10) return 72;
  if (pct >= 4) return 58;
  if (pct >= 0) return 44;
  return 24;
}

function scoreMargin(value) {
  if (!Number.isFinite(value)) return null;
  const pct = value * 100;
  if (pct >= 22) return 84;
  if (pct >= 14) return 70;
  if (pct >= 8) return 56;
  if (pct >= 0) return 38;
  return 18;
}

function recommendationScore(trend) {
  const row = trend?.trend?.[0];
  if (!row) return null;
  const strongBuy = Number(row.strongBuy ?? 0);
  const buy = Number(row.buy ?? 0);
  const hold = Number(row.hold ?? 0);
  const sell = Number(row.sell ?? 0);
  const strongSell = Number(row.strongSell ?? 0);
  const total = strongBuy + buy + hold + sell + strongSell;
  if (!total) return null;
  const weighted = (strongBuy * 100 + buy * 78 + hold * 52 + sell * 25 + strongSell * 8) / total;
  return { score: Math.round(weighted), total, strongBuy, buy, hold, sell, strongSell };
}

function daysUntilEarnings(calendarEvents) {
  const earningsDates = calendarEvents?.earnings?.earningsDate ?? [];
  const next = earningsDates
    .map((item) => raw(item))
    .filter(Number.isFinite)
    .sort((a, b) => a - b)
    .find((seconds) => seconds * 1000 > Date.now());
  if (!next) return null;
  return Math.ceil((next * 1000 - Date.now()) / (24 * 60 * 60 * 1000));
}

export async function fetchFundamentalAnalysis(symbol) {
  const normalized = symbol.toUpperCase();
  const cacheKey = `fundamentals:v2:${normalized}`;
  const cached = await redisClient.get(cacheKey);
  if (cached) return JSON.parse(cached);

  let summary = null;
  try {
    summary = await fetchQuoteSummary(normalized);
  } catch (err) {
    console.warn(`[Fundamentals] Yahoo quote summary failed for ${normalized}: ${err.message}`);
  }

  if (!summary) {
    const fallback = {
      score: 50,
      label: "unknown",
      metrics: {
        sector: STOCK_PROFILES[normalized]?.sector ?? null,
        industry: STOCK_PROFILES[normalized]?.industry ?? null,
      },
      factors: [],
      warnings: ["Fundamental data unavailable; score kept neutral"],
      earningsTiming: null,
      analyst: null,
    };
    await redisClient.set(cacheKey, JSON.stringify(fallback), "EX", CACHE_TTL);
    return fallback;
  }

  const price = summary.price ?? {};
  const summaryDetail = summary.summaryDetail ?? {};
  const keyStats = summary.defaultKeyStatistics ?? {};
  const financialData = summary.financialData ?? {};

  const pe = raw(summaryDetail.trailingPE) || raw(keyStats.trailingPE) || raw(summaryDetail.forwardPE);
  const forwardPe = raw(summaryDetail.forwardPE);
  const peg = raw(keyStats.pegRatio);
  const revenueGrowth = raw(financialData.revenueGrowth);
  const earningsGrowth = raw(financialData.earningsGrowth);
  const operatingMargin = raw(financialData.operatingMargins);
  const profitMargin = raw(financialData.profitMargins);
  const debtToEquity = raw(financialData.debtToEquity);
  const currentRatio = raw(financialData.currentRatio);
  const targetMeanPrice = raw(financialData.targetMeanPrice);
  const currentPrice = raw(financialData.currentPrice) || raw(price.regularMarketPrice);
  const marketCap = raw(price.marketCap) || raw(summaryDetail.marketCap);
  const dividendYield = raw(summaryDetail.dividendYield);
  const beta = raw(summaryDetail.beta);
  const rec = recommendationScore(summary.recommendationTrend);
  const daysToEarnings = daysUntilEarnings(summary.calendarEvents);

  const parts = [];
  const factors = [];
  const warnings = [];

  const peScore = scorePe(pe);
  if (peScore !== null) {
    parts.push({ name: "valuation", score: peScore, weight: 0.22 });
    if (peScore >= 68) factors.push(`Valuation is reasonable for swing risk (P/E ${round(pe, 1)})`);
    if (peScore <= 36) warnings.push(`Valuation is stretched (P/E ${round(pe, 1)})`);
  }

  const pegScore = scoreRatioLowerBetter(peg, 1.4, 2.4);
  if (pegScore !== null) {
    parts.push({ name: "peg", score: pegScore, weight: 0.10 });
    if (pegScore <= 35) warnings.push(`PEG is elevated at ${round(peg, 2)}`);
  }

  const growthScores = [scoreGrowth(revenueGrowth), scoreGrowth(earningsGrowth)]
    .filter((value) => value !== null);
  if (growthScores.length) {
    const growthScore = growthScores.reduce((a, b) => a + b, 0) / growthScores.length;
    parts.push({ name: "growth", score: growthScore, weight: 0.22 });
    if (growthScore >= 72) factors.push("Growth profile supports a higher-quality setup");
    if (growthScore <= 38) warnings.push("Growth profile is weak or contracting");
  }

  const marginScores = [scoreMargin(operatingMargin), scoreMargin(profitMargin)]
    .filter((value) => value !== null);
  if (marginScores.length) {
    const marginScore = marginScores.reduce((a, b) => a + b, 0) / marginScores.length;
    parts.push({ name: "margins", score: marginScore, weight: 0.18 });
    if (marginScore >= 70) factors.push("Margins are healthy versus most swing candidates");
    if (marginScore <= 38) warnings.push("Margins are thin; fundamentals add risk");
  }

  const balanceSheetScores = [];
  const debtScore = scoreRatioLowerBetter(debtToEquity, 80, 180);
  if (debtScore !== null) balanceSheetScores.push(debtScore);
  if (Number.isFinite(currentRatio)) {
    balanceSheetScores.push(currentRatio >= 1.5 ? 75 : currentRatio >= 1 ? 55 : 28);
  }
  if (balanceSheetScores.length) {
    const balanceScore = balanceSheetScores.reduce((a, b) => a + b, 0) / balanceSheetScores.length;
    parts.push({ name: "balanceSheet", score: balanceScore, weight: 0.13 });
    if (debtScore !== null && debtScore <= 35) warnings.push(`Debt/equity is high at ${round(debtToEquity, 0)}`);
  }

  if (rec) {
    parts.push({ name: "analysts", score: rec.score, weight: 0.15 });
    if (rec.score >= 70) factors.push(`Analyst trend is supportive (${rec.strongBuy + rec.buy}/${rec.total} buy-side ratings)`);
    if (rec.score <= 35) warnings.push("Analyst trend is negative");
  }

  if (Number.isFinite(targetMeanPrice) && Number.isFinite(currentPrice) && currentPrice > 0) {
    const upsidePct = ((targetMeanPrice - currentPrice) / currentPrice) * 100;
    if (upsidePct > 15) factors.push(`Mean target implies ${round(upsidePct, 1)}% upside`);
    if (upsidePct < -8) warnings.push(`Mean target implies ${round(Math.abs(upsidePct), 1)}% downside`);
  }

  if (daysToEarnings !== null && daysToEarnings <= 14) {
    warnings.push(`Earnings expected in ${daysToEarnings} day${daysToEarnings === 1 ? "" : "s"}; avoid oversized fresh entries`);
  }

  if (Number.isFinite(beta) && beta > 1.6) {
    warnings.push(`High beta (${round(beta, 2)}) can amplify market swings`);
  }

  let score = 50;
  if (parts.length) {
    const totalWeight = parts.reduce((sum, item) => sum + item.weight, 0);
    score = parts.reduce((sum, item) => sum + item.score * item.weight, 0) / totalWeight;
  } else {
    warnings.push("Not enough fundamental fields from Yahoo; score kept neutral");
  }

  if (daysToEarnings !== null && daysToEarnings <= 7) score -= 8;
  score = Math.round(clamp(score, 0, 100));

  const result = {
    score,
    label: score >= 68 ? "strong" : score >= 52 ? "fair" : score >= 38 ? "weak" : "poor",
    metrics: {
      name: text(price.longName) ?? text(price.shortName) ?? normalized,
      sector: STOCK_PROFILES[normalized]?.sector ?? null,
      industry: STOCK_PROFILES[normalized]?.industry ?? null,
      marketCap,
      pe: round(pe, 2),
      forwardPe: round(forwardPe, 2),
      peg: round(peg, 2),
      revenueGrowthPct: round(revenueGrowth * 100, 2),
      earningsGrowthPct: round(earningsGrowth * 100, 2),
      operatingMarginPct: round(operatingMargin * 100, 2),
      profitMarginPct: round(profitMargin * 100, 2),
      debtToEquity: round(debtToEquity, 2),
      currentRatio: round(currentRatio, 2),
      dividendYieldPct: round(dividendYield * 100, 2),
      beta: round(beta, 2),
      targetMeanPrice: round(targetMeanPrice, 2),
      currentPrice: round(currentPrice, 2),
    },
    factors: factors.slice(0, 5),
    warnings: warnings.slice(0, 5),
    earningsTiming: daysToEarnings === null ? null : {
      daysUntilEarnings: daysToEarnings,
      risk: daysToEarnings <= 7 ? "high" : daysToEarnings <= 14 ? "medium" : "low",
    },
    analyst: rec,
    components: parts.map(({ name, score: partScore }) => ({
      name,
      score: Math.round(partScore),
    })),
  };

  await redisClient.set(cacheKey, JSON.stringify(result), "EX", CACHE_TTL);
  return result;
}
