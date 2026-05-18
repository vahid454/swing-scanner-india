/**
 * helpers/technicalAnalysis.js — Technical indicator scoring
 *
 * Returns composite score 0–100 based on:
 *  - RSI(14):    30–50 rising = bullish setup       weight 20%
 *  - MACD:       line > signal = momentum up        weight 20%
 *  - EMA 9/21:   price > EMA9 > EMA21 = uptrend    weight 15%
 *  - Volume:     current > 1.5× 20-day avg          weight 15%
 *  (sentiment adds remaining 30% in scanWorker)
 *
 * All sub-scores normalised to 0–100 before weighting.
 */

import { RSI, MACD, EMA, ATR } from "technicalindicators";

const WEIGHTS = {
  trend:     0.20,
  breakout:  0.28,
  volume:    0.20,
  momentum:  0.16,
  risk:      0.10,
  quality:   0.06,
};

function round(value, places = 2) {
  if (!Number.isFinite(value)) return null;
  return +value.toFixed(places);
}

function pct(value) {
  return Number.isFinite(value) ? round(value, 2) : null;
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function istDateKeyFromUnix(seconds) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(seconds * 1000));
}

function todayIstKey() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function finiteOr(value, fallback) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

/**
 * @param {Array<{open: number, high: number, low: number, close: number, volume: number}>} candles
 * @returns {{ score: number, signals: object }}
 */
export function scoreTechnicals(candles, options = {}) {
  if (!candles || candles.length < 55) {
    return {
      score: 50,
      signals: {
        rsi: null, macd: null,
        priceAboveEmas: false, volumeSpike: false, factors: [],
        warnings: ["Need at least 55 daily candles for a reliable swing setup"],
        note: "insufficient data - using neutral 50",
      },
      tradePlan: null,
    };
  }

  const sorted = [...candles].sort((a, b) => (a.time ?? 0) - (b.time ?? 0));
  const rawLatest = sorted.at(-1);
  const latestIsToday = rawLatest?.time && istDateKeyFromUnix(rawLatest.time) === todayIstKey();
  const completed = latestIsToday && sorted.length > 55 ? sorted.slice(0, -1) : sorted;
  const completedLatest = completed.at(-1);
  const livePrice = finiteOr(options.livePrice, rawLatest.close);
  const liveHigh = finiteOr(options.dayHigh, null);
  const liveLow = finiteOr(options.dayLow, null);
  const latest = {
    ...completedLatest,
    close: livePrice,
    high: latestIsToday && liveHigh ? Math.max(liveHigh, livePrice) : Math.max(rawLatest.high, livePrice),
    low: latestIsToday && liveLow ? Math.min(liveLow, livePrice) : Math.min(rawLatest.low, livePrice),
  };
  const previous = completed.at(-2);
  const structureCandles = latestIsToday ? completed : completed.slice(0, -1);
  const lookback = structureCandles.slice(-20);
  const closes  = [...completed.slice(0, -1).map((c) => c.close), livePrice];
  const highs   = [...completed.slice(0, -1).map((c) => c.high), latest.high];
  const lows    = [...completed.slice(0, -1).map((c) => c.low), latest.low];
  const volumes = completed.map((c) => c.volume);
  const price = livePrice;

  const factors = [];
  const warnings = [];

  // ── RSI ───────────────────────────────────────────────────────────────────
  const rsiValues = RSI.calculate({ values: closes, period: 14 });
  const rsiCurr   = rsiValues.at(-1) ?? 50;
  const rsiPrev   = rsiValues.at(-2) ?? 50;
  const rsiRising = rsiCurr > rsiPrev;

  let rsiScore = 25;
  if (rsiCurr >= 50 && rsiCurr <= 68 && rsiRising) rsiScore = 100;
  else if (rsiCurr >= 45 && rsiCurr < 50 && rsiRising) rsiScore = 72;
  else if (rsiCurr > 68 && rsiCurr <= 72) rsiScore = 58;
  else if (rsiCurr > 72) rsiScore = 20;

  if (rsiScore >= 72) factors.push(`RSI ${round(rsiCurr, 1)} is rising in a swing-friendly momentum zone`);
  if (rsiCurr > 72) warnings.push(`RSI ${round(rsiCurr, 1)} is extended; avoid chasing a stretched candle`);

  // ── MACD ──────────────────────────────────────────────────────────────────
  const macdResult = MACD.calculate({
    values: closes, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9,
    SimpleMAOscillator: false, SimpleMASignal: false,
  });
  const macdCurr = macdResult.at(-1);
  const macdPrev = macdResult.at(-2);

  let macdScore = 0;
  if (macdCurr) {
    const bullishCross = macdPrev &&
      macdPrev.MACD <= macdPrev.signal &&
      macdCurr.MACD >  macdCurr.signal; // fresh bullish crossover

    if (bullishCross)                        macdScore = 100;
    else if (macdCurr.MACD > macdCurr.signal && macdCurr.histogram > 0)
                                             macdScore = 70;
    else if (macdCurr.MACD > macdCurr.signal) macdScore = 50;
    else                                     macdScore = 10;
  }
  if (macdScore >= 70) factors.push("MACD is above signal with positive momentum");
  if (macdScore <= 10) warnings.push("MACD has not confirmed bullish momentum yet");

  // ── EMA trend ─────────────────────────────────────────────────────────────
  const ema9  = EMA.calculate({ values: closes, period: 9 });
  const ema21 = EMA.calculate({ values: closes, period: 21 });
  const ema50 = EMA.calculate({ values: closes, period: 50 });
  const e9    = ema9.at(-1)  ?? price;
  const e21   = ema21.at(-1) ?? price;
  const e50   = ema50.at(-1) ?? price;
  const e9p   = ema9.at(-2)  ?? e9;
  const e21p  = ema21.at(-2) ?? e21;

  const uptrend      = price > e9 && e9 > e21 && e21 > e50;
  const emaExpanding = (e9 - e21) > (e9p - e21p); // spread widening = strengthening

  let emaScore = 0;
  if (uptrend && emaExpanding) emaScore = 100;
  else if (price > e9 && e9 > e21) emaScore = 78;
  else if (price > e21)        emaScore = 40;
  else                         emaScore = 10;
  if (emaScore >= 78) factors.push("Price is stacked above short and medium EMAs");
  if (price < e21) warnings.push("Price is still below EMA21; trend structure is not clean");

  // ── Volume ────────────────────────────────────────────────────────────────
  const recentVols = volumes.slice(-21, -1);
  const avgVol     = recentVols.reduce((a, b) => a + b, 0) / recentVols.length;
  const currVol    = completedLatest.volume ?? 0;
  const volRatio   = avgVol > 0 ? currVol / avgVol : 1;
  const intradayVolRatio = avgVol > 0 && Number.isFinite(Number(options.liveVolume))
    ? Number(options.liveVolume) / avgVol
    : null;

  let volumeScore = 0;
  if      (volRatio >= 2.0) volumeScore = 100;
  else if (volRatio >= 1.5) volumeScore = 82;
  else if (volRatio >= 1.2) volumeScore = 68;
  else if (volRatio >= 0.9) volumeScore = 48;
  else if (volRatio >= 0.7) volumeScore = 30;
  else                      volumeScore = 12;
  if (volRatio >= 1.5) factors.push(`Last completed volume was ${round(volRatio, 2)}x the 20-day average`);
  if (volRatio < 0.9) warnings.push("Breakout volume is weak versus the 20-day average");
  if (intradayVolRatio !== null) {
    factors.push(`Today's live volume is ${round(intradayVolRatio, 2)}x of the 20-day daily average so far`);
  }

  // ── Breakout and risk structure ───────────────────────────────────────────
  const breakoutLevel = Math.max(...lookback.map((c) => c.high));
  const supportLevel = Math.min(...lookback.slice(-10).map((c) => c.low));
  const distanceToBreakoutPct = ((price - breakoutLevel) / breakoutLevel) * 100;
  const breakoutConfirmed = price > breakoutLevel && latest.close > breakoutLevel;
  const nearBreakout = distanceToBreakoutPct >= -1.2 && distanceToBreakoutPct <= 2.2;
  const closeRange = latest.high - latest.low;
  const closeStrength = closeRange > 0 ? ((latest.close - latest.low) / closeRange) * 100 : 50;

  let breakoutScore = 15;
  if (breakoutConfirmed && closeStrength >= 75 && distanceToBreakoutPct <= 2.2) breakoutScore = 100;
  else if (breakoutConfirmed && distanceToBreakoutPct <= 2.8) breakoutScore = 82;
  else if (nearBreakout && price > e21 && closeStrength >= 60) breakoutScore = 68;
  else if (distanceToBreakoutPct > 5) breakoutScore = 30;

  if (breakoutConfirmed) factors.push(`Closed above the 20-day breakout level (${round(breakoutLevel)})`);
  else if (nearBreakout) factors.push(`Within ${Math.abs(round(distanceToBreakoutPct, 2))}% of 20-day breakout level`);
  if (distanceToBreakoutPct > 2.8) warnings.push("Price is already far above breakout level; risk of late entry is higher");
  if (closeStrength < 60) warnings.push("Latest candle did not close strongly enough for a clean breakout");

  const atrValues = ATR.calculate({ high: highs, low: lows, close: closes, period: 14 });
  const atr = atrValues.at(-1) ?? (price * 0.025);
  const atrPct = (atr / price) * 100;
  const structuralStop = supportLevel * 0.997;
  const volatilityStop = price - 1.5 * atr;
  const stopLoss = Math.max(structuralStop, volatilityStop);
  const stopLossPct = ((price - stopLoss) / price) * 100;
  const entryLow = breakoutConfirmed ? breakoutLevel : price;
  const entryHigh = breakoutConfirmed ? price * 1.006 : breakoutLevel * 1.004;
  const target1 = price + ((price - stopLoss) * 2);
  const target2 = price + ((price - stopLoss) * 3);
  const rewardToRisk = (target1 - price) / Math.max(price - stopLoss, 1);

  let riskScore = 30;
  if (stopLossPct >= 2 && stopLossPct <= 7.5 && rewardToRisk >= 1.8) riskScore = 100;
  else if (stopLossPct > 7.5 && stopLossPct <= 9) riskScore = 62;
  else if (stopLossPct < 2) riskScore = 55;
  else if (stopLossPct > 9) riskScore = 20;

  if (stopLossPct <= 7.5) factors.push(`Stop can be kept near ${round(stopLoss)} (${round(stopLossPct, 1)}% risk)`);
  if (stopLossPct > 8.5) warnings.push(`Stop is wide at ${round(stopLossPct, 1)}%; position size should be smaller`);
  if (atrPct > 6) warnings.push(`ATR is high at ${round(atrPct, 1)}%; expect wider swings`);

  const last5AvgVolume = average(volumes.slice(-5));
  const previous20AvgVolume = average(volumes.slice(-25, -5));
  const accumulation = previous20AvgVolume > 0 ? last5AvgVolume / previous20AvgVolume : 1;
  const bodyPct = latest.open > 0 ? Math.abs(latest.close - latest.open) / latest.open * 100 : 0;
  const avgTurnover = avgVol * price;
  const liquidEnough = avgTurnover >= 100_000_000;
  let qualityScore = 38;
  if (closeStrength >= 75 && accumulation >= 1.05 && bodyPct <= 5.5 && liquidEnough) qualityScore = 100;
  else if (closeStrength >= 65 && accumulation >= 0.9 && liquidEnough) qualityScore = 74;
  else if (closeStrength < 55 || !liquidEnough) qualityScore = 24;

  if (qualityScore >= 72) factors.push("Recent volume/close quality supports accumulation");
  if (bodyPct > 7) warnings.push("Latest candle body is very large; wait for a calmer entry if possible");
  if (!liquidEnough) warnings.push("Average turnover is low for reliable swing execution");

  const momentumScore = Math.round((rsiScore * 0.48) + (macdScore * 0.52));
  const trendScore = emaScore;

  const score = Math.round(
    trendScore * WEIGHTS.trend +
    breakoutScore * WEIGHTS.breakout +
    volumeScore * WEIGHTS.volume +
    momentumScore * WEIGHTS.momentum +
    riskScore * WEIGHTS.risk +
    qualityScore * WEIGHTS.quality
  );

  const validBreakout =
    uptrend &&
    nearBreakout &&
    closeStrength >= 60 &&
    stopLossPct <= 8.5 &&
    rewardToRisk >= 1.8 &&
    volRatio >= (breakoutConfirmed ? 0.75 : 0.9) &&
    liquidEnough;

  const setup =
    score >= 84 && warnings.length <= 1 && breakoutConfirmed && validBreakout ? "A" :
    score >= 74 && validBreakout ? "B+" :
    score >= 66 && validBreakout ? "B" :
    score >= 58 && uptrend && nearBreakout ? "Watch" : "Avoid";

  const action =
    breakoutConfirmed && score >= 74 && validBreakout ? "Breakout buy zone" :
    nearBreakout && score >= 66 && validBreakout ? "Watch for breakout trigger" :
    "Wait for cleaner confirmation";

  return {
    score: Math.min(100, Math.max(0, score)),
    signals: {
      rsi:          round(rsiCurr, 1),
      rsiScore,
      macd:         macdCurr ? {
        value:     round(macdCurr.MACD, 3),
        signal:    round(macdCurr.signal, 3),
        histogram: round(macdCurr.histogram, 3),
      } : null,
      macdScore,
      ema:          { ema9: round(e9), ema21: round(e21), ema50: round(e50), price: round(price) },
      emaScore,
      priceAboveEmas: uptrend,
      volumeSpike:  volRatio >= 1.5,
      volRatio:     round(volRatio, 2),
      intradayVolRatio: round(intradayVolRatio, 2),
      volumeScore,
      breakout: {
        level: round(breakoutLevel),
        distancePct: pct(distanceToBreakoutPct),
        confirmed: breakoutConfirmed,
        near: nearBreakout,
        closeStrength: round(closeStrength, 1),
      },
      atr: round(atr),
      atrPct: round(atrPct, 2),
      support: round(supportLevel),
      trendScore,
      breakoutScore,
      momentumScore,
      riskScore,
      qualityScore,
      confirmation: {
        validBreakout,
        liquidEnough,
        avgTurnover: round(avgTurnover, 0),
        accumulation: round(accumulation, 2),
        usingCompletedVolume: latestIsToday,
      },
      factors,
      warnings,
    },
    tradePlan: {
      setup,
      action,
      livePrice: round(price),
      lastClose: round(price),
      previousClose: round(previous?.close),
      entry: {
        low: round(entryLow),
        high: round(entryHigh),
        trigger: round(breakoutConfirmed ? price : breakoutLevel),
      },
      stopLoss: round(stopLoss),
      stopLossPct: round(stopLossPct, 2),
      target1: round(target1),
      target2: round(target2),
      rewardToRisk: round(rewardToRisk, 2),
      breakoutLevel: round(breakoutLevel),
      support: round(supportLevel),
    },
  };
}
