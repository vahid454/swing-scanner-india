/**
 * helpers/technicalAnalysis.js — Technical indicator scoring
 *
 * Improvements:
 *  - Better handling of edge cases and missing data
 *  - More defensive calculations
 *  - Improved scoring normalization
 *  - Added data quality checks
 */

import { RSI, MACD, EMA, ATR, ADX, BollingerBands, MFI, OBV, Stochastic } from "technicalindicators";

const WEIGHTS = {
  trend: 0.18,
  breakout: 0.24,
  volume: 0.17,
  momentum: 0.16,
  advanced: 0.10,
  risk: 0.09,
  quality: 0.06,
};

function round(value, places = 2) {
  if (!Number.isFinite(value)) return null;
  return +value.toFixed(places);
}

function pct(value) {
  return Number.isFinite(value) ? round(value, 2) : null;
}

function average(values) {
  const valid = values.filter(Number.isFinite);
  if (!valid.length) return 0;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

function safeDiv(numerator, denominator, fallback = 0) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
    return fallback;
  }
  return numerator / denominator;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
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
 * Validate candle data quality
 */
function validateCandleData(candles) {
  const issues = [];
  
  if (!candles || !Array.isArray(candles)) {
    return { valid: false, issues: ["No candle data provided"] };
  }
  
  if (candles.length < 55) {
    return { valid: false, issues: [`Need at least 55 candles, got ${candles.length}`] };
  }
  
  // Check for data gaps
  const sorted = [...candles].sort((a, b) => (a.time ?? 0) - (b.time ?? 0));
  let gapCount = 0;
  for (let i = 1; i < sorted.length; i++) {
    const daysDiff = (sorted[i].time - sorted[i - 1].time) / 86400;
    if (daysDiff > 5) gapCount++; // More than 5 days gap (accounting for weekends)
  }
  
  if (gapCount > 5) {
    issues.push(`Data has ${gapCount} significant gaps`);
  }
  
  // Check for suspicious values
  const zeroVolume = candles.filter((c) => c.volume === 0).length;
  if (zeroVolume > candles.length * 0.1) {
    issues.push(`${zeroVolume} candles have zero volume`);
  }
  
  // Check for stale data
  const latestTime = sorted.at(-1)?.time;
  const daysSinceLatest = latestTime ? (Date.now() / 1000 - latestTime) / 86400 : Infinity;
  if (daysSinceLatest > 7) {
    issues.push(`Data is ${Math.floor(daysSinceLatest)} days old`);
  }
  
  return { valid: issues.length === 0, issues };
}

/**
 * Calculate indicators with defensive error handling
 */
function safeCalculateIndicators(closes, highs, lows, volumes) {
  const indicators = {};
  
  try {
    indicators.rsi = RSI.calculate({ values: closes, period: 14 });
  } catch (e) {
    indicators.rsi = [];
  }
  
  try {
    indicators.macd = MACD.calculate({
      values: closes,
      fastPeriod: 12,
      slowPeriod: 26,
      signalPeriod: 9,
      SimpleMAOscillator: false,
      SimpleMASignal: false,
    });
  } catch (e) {
    indicators.macd = [];
  }
  
  try {
    indicators.ema9 = EMA.calculate({ values: closes, period: 9 });
    indicators.ema21 = EMA.calculate({ values: closes, period: 21 });
    indicators.ema50 = EMA.calculate({ values: closes, period: 50 });
  } catch (e) {
    indicators.ema9 = [];
    indicators.ema21 = [];
    indicators.ema50 = [];
  }
  
  try {
    indicators.adx = ADX.calculate({ high: highs, low: lows, close: closes, period: 14 });
  } catch (e) {
    indicators.adx = [];
  }
  
  try {
    indicators.mfi = MFI.calculate({ high: highs, low: lows, close: closes, volume: volumes, period: 14 });
  } catch (e) {
    indicators.mfi = [];
  }
  
  try {
    indicators.stochastic = Stochastic.calculate({ high: highs, low: lows, close: closes, period: 14, signalPeriod: 3 });
  } catch (e) {
    indicators.stochastic = [];
  }
  
  try {
    indicators.obv = OBV.calculate({ close: closes, volume: volumes });
  } catch (e) {
    indicators.obv = [];
  }
  
  try {
    indicators.bb = BollingerBands.calculate({ values: closes, period: 20, stdDev: 2 });
  } catch (e) {
    indicators.bb = [];
  }
  
  try {
    indicators.atr = ATR.calculate({ high: highs, low: lows, close: closes, period: 14 });
  } catch (e) {
    indicators.atr = [];
  }
  
  return indicators;
}

/**
 * @param {Array<{open: number, high: number, low: number, close: number, volume: number}>} candles
 * @returns {{ score: number, signals: object, tradePlan: object }}
 */
export function scoreTechnicals(candles, options = {}) {
  // Validate data quality first
  const validation = validateCandleData(candles);
  
  if (!validation.valid) {
    return {
      score: 50,
      signals: {
        rsi: null,
        macd: null,
        priceAboveEmas: false,
        volumeSpike: false,
        factors: [],
        warnings: validation.issues,
        note: "Data quality issues - using neutral score",
        dataQuality: { valid: false, issues: validation.issues },
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
  
  const closes = [...completed.slice(0, -1).map((c) => c.close), livePrice];
  const highs = [...completed.slice(0, -1).map((c) => c.high), latest.high];
  const lows = [...completed.slice(0, -1).map((c) => c.low), latest.low];
  const volumes = completed.map((c) => c.volume);
  const price = livePrice;
  
  // Calculate returns with safety
  const ret5 = closes.length > 6 ? safeDiv(price - closes.at(-6), closes.at(-6)) * 100 : null;
  const ret20 = closes.length > 21 ? safeDiv(price - closes.at(-21), closes.at(-21)) * 100 : null;
  const ret50 = closes.length > 51 ? safeDiv(price - closes.at(-51), closes.at(-51)) * 100 : null;

  const factors = [];
  const warnings = [];
  
  // Add data quality warnings
  if (validation.issues.length > 0) {
    warnings.push(...validation.issues);
  }

  // Calculate all indicators with error handling
  const indicators = safeCalculateIndicators(closes, highs, lows, volumes);

  // ── RSI ───────────────────────────────────────────────────────────────────
  const rsiCurr = indicators.rsi.at(-1) ?? 50;
  const rsiPrev = indicators.rsi.at(-2) ?? 50;
  const rsiRising = rsiCurr > rsiPrev;

  let rsiScore = 25;
  if (rsiCurr >= 50 && rsiCurr <= 68 && rsiRising) rsiScore = 100;
  else if (rsiCurr >= 45 && rsiCurr < 50 && rsiRising) rsiScore = 72;
  else if (rsiCurr > 68 && rsiCurr <= 72) rsiScore = 58;
  else if (rsiCurr > 72) rsiScore = 20;
  else if (rsiCurr < 30) rsiScore = 45; // Oversold can be opportunity

  if (rsiScore >= 72) factors.push(`RSI ${round(rsiCurr, 1)} is rising in a swing-friendly momentum zone`);
  if (rsiCurr > 72) warnings.push(`RSI ${round(rsiCurr, 1)} is extended; avoid chasing a stretched candle`);
  if (rsiCurr < 25) factors.push(`RSI ${round(rsiCurr, 1)} is deeply oversold - potential reversal zone`);

  // ── MACD ──────────────────────────────────────────────────────────────────
  const macdCurr = indicators.macd.at(-1);
  const macdPrev = indicators.macd.at(-2);

  let macdScore = 35; // Default neutral-ish
  if (macdCurr && Number.isFinite(macdCurr.MACD) && Number.isFinite(macdCurr.signal)) {
    const bullishCross =
      macdPrev &&
      Number.isFinite(macdPrev.MACD) &&
      Number.isFinite(macdPrev.signal) &&
      macdPrev.MACD <= macdPrev.signal &&
      macdCurr.MACD > macdCurr.signal;

    if (bullishCross) macdScore = 100;
    else if (macdCurr.MACD > macdCurr.signal && macdCurr.histogram > 0) macdScore = 70;
    else if (macdCurr.MACD > macdCurr.signal) macdScore = 50;
    else macdScore = 10;
  }
  
  if (macdScore >= 70) factors.push("MACD is above signal with positive momentum");
  if (macdScore <= 10) warnings.push("MACD has not confirmed bullish momentum yet");

  // ── ADX / DMI ─────────────────────────────────────────────────────────────
  const adxCurr = indicators.adx.at(-1);
  let adxScore = 45;
  if (adxCurr && Number.isFinite(adxCurr.adx)) {
    if (adxCurr.adx >= 25 && adxCurr.pdi > adxCurr.mdi) adxScore = 92;
    else if (adxCurr.adx >= 18 && adxCurr.pdi > adxCurr.mdi) adxScore = 72;
    else if (adxCurr.mdi > adxCurr.pdi) adxScore = 26;
  }
  if (adxScore >= 72) factors.push(`ADX ${round(adxCurr?.adx, 1)} confirms trend strength`);
  if (adxScore <= 30) warnings.push("ADX/DMI does not support a bullish trend yet");

  // ── MFI ───────────────────────────────────────────────────────────────────
  const mfiCurr = indicators.mfi.at(-1);
  let mfiScore = 50;
  if (Number.isFinite(mfiCurr)) {
    if (mfiCurr >= 45 && mfiCurr <= 75) mfiScore = 78;
    else if (mfiCurr > 80) mfiScore = 24;
    else if (mfiCurr < 25) mfiScore = 62;
    else if (mfiCurr < 40) mfiScore = 42;
  }
  if (mfiScore >= 75) factors.push(`Money flow is healthy (MFI ${round(mfiCurr, 1)})`);
  if (mfiScore <= 30) warnings.push(`MFI ${round(mfiCurr, 1)} is overheated; entry risk is higher`);

  // ── Stochastic ────────────────────────────────────────────────────────────
  const stochastic = indicators.stochastic.at(-1);
  let stochasticScore = 50;
  if (stochastic && Number.isFinite(stochastic.k) && Number.isFinite(stochastic.d)) {
    if (stochastic.k > stochastic.d && stochastic.k >= 40 && stochastic.k <= 82) stochasticScore = 74;
    else if (stochastic.k > 85) stochasticScore = 30;
    else if (stochastic.k < 25 && stochastic.k > stochastic.d) stochasticScore = 64;
    else if (stochastic.k < stochastic.d) stochasticScore = 36;
  }

  // ── OBV ───────────────────────────────────────────────────────────────────
  const obvRecent = indicators.obv.slice(-6);
  const obvSlope = obvRecent.length >= 2 ? (obvRecent.at(-1) ?? 0) - (obvRecent.at(0) ?? 0) : 0;
  const obvScore = obvSlope > 0 ? 72 : 34;
  if (obvScore >= 70) factors.push("OBV is rising, showing accumulation behind the move");
  else warnings.push("OBV is not confirming accumulation yet");

  // ── EMA Trend ─────────────────────────────────────────────────────────────
  const e9 = indicators.ema9.at(-1) ?? price;
  const e21 = indicators.ema21.at(-1) ?? price;
  const e50 = indicators.ema50.at(-1) ?? price;
  const e9p = indicators.ema9.at(-2) ?? e9;
  const e21p = indicators.ema21.at(-2) ?? e21;

  const uptrend = price > e9 && e9 > e21 && e21 > e50;
  const emaExpanding = e9 - e21 > e9p - e21p;

  let emaScore = 0;
  if (uptrend && emaExpanding) emaScore = 100;
  else if (price > e9 && e9 > e21) emaScore = 78;
  else if (price > e21) emaScore = 40;
  else emaScore = 10;
  
  if (emaScore >= 78) factors.push("Price is stacked above short and medium EMAs");
  if (price < e21) warnings.push("Price is still below EMA21; trend structure is not clean");

  // ── Volume ────────────────────────────────────────────────────────────────
  const recentVols = volumes.slice(-21, -1).filter(Number.isFinite);
  const avgVol = average(recentVols);
  const currVol = completedLatest?.volume ?? 0;
  const volRatio = avgVol > 0 ? currVol / avgVol : 1;
  const intradayVolRatio =
    avgVol > 0 && Number.isFinite(Number(options.liveVolume))
      ? Number(options.liveVolume) / avgVol
      : null;

  let volumeScore = 0;
  if (volRatio >= 2.0) volumeScore = 100;
  else if (volRatio >= 1.5) volumeScore = 82;
  else if (volRatio >= 1.2) volumeScore = 68;
  else if (volRatio >= 0.9) volumeScore = 48;
  else if (volRatio >= 0.7) volumeScore = 30;
  else volumeScore = 12;
  
  if (volRatio >= 1.5) factors.push(`Last completed volume was ${round(volRatio, 2)}x the 20-day average`);
  if (volRatio < 0.9) warnings.push("Breakout volume is weak versus the 20-day average");
  if (intradayVolRatio !== null) {
    factors.push(`Today's live volume is ${round(intradayVolRatio, 2)}x of the 20-day daily average so far`);
  }

  // ── Breakout and Risk ─────────────────────────────────────────────────────
  const lookbackHighs = lookback.map((c) => c.high).filter(Number.isFinite);
  const lookbackLows = lookback.slice(-10).map((c) => c.low).filter(Number.isFinite);
  
  const breakoutLevel = lookbackHighs.length > 0 ? Math.max(...lookbackHighs) : price;
  const supportLevel = lookbackLows.length > 0 ? Math.min(...lookbackLows) : price * 0.95;
  
  const distanceToBreakoutPct = safeDiv(price - breakoutLevel, breakoutLevel) * 100;
  const breakoutConfirmed = price > breakoutLevel && latest.close > breakoutLevel;
  const nearBreakout = distanceToBreakoutPct >= -1.2 && distanceToBreakoutPct <= 2.2;
  const closeRange = latest.high - latest.low;
  const closeStrength = closeRange > 0 ? safeDiv(latest.close - latest.low, closeRange) * 100 : 50;

  let breakoutScore = 15;
  if (breakoutConfirmed && closeStrength >= 75 && distanceToBreakoutPct <= 2.2) breakoutScore = 100;
  else if (breakoutConfirmed && distanceToBreakoutPct <= 2.8) breakoutScore = 82;
  else if (nearBreakout && price > e21 && closeStrength >= 60) breakoutScore = 68;
  else if (distanceToBreakoutPct > 5) breakoutScore = 30;

  if (breakoutConfirmed) factors.push(`Closed above the 20-day breakout level (${round(breakoutLevel)})`);
  else if (nearBreakout) factors.push(`Within ${Math.abs(round(distanceToBreakoutPct, 2))}% of 20-day breakout level`);
  if (distanceToBreakoutPct > 2.8) warnings.push("Price is already far above breakout level; risk of late entry is higher");
  if (closeStrength < 60) warnings.push("Latest candle did not close strongly enough for a clean breakout");

  // ── Bollinger Bands ───────────────────────────────────────────────────────
  const bb = indicators.bb.at(-1);
  let bbScore = 50;
  let bbPercent = null;
  let bbWidthPct = null;
  if (bb && Number.isFinite(bb.upper) && Number.isFinite(bb.lower)) {
    const bbRange = bb.upper - bb.lower;
    bbPercent = bbRange > 0 ? safeDiv(price - bb.lower, bbRange) : 0.5;
    bbWidthPct = safeDiv(bbRange, price) * 100;
    
    if (bbPercent >= 0.45 && bbPercent <= 0.92 && bbWidthPct <= 14) bbScore = 78;
    else if (bbPercent > 1.08) bbScore = 24;
    else if (bbPercent > 0.92) bbScore = 48;
    else if (bbPercent < 0.25) bbScore = 40;
  }
  if (bbScore >= 75) factors.push("Bollinger position leaves room without looking exhausted");
  if (bbScore <= 30) warnings.push("Price is stretched outside the upper Bollinger band");

  // ── ATR and Risk Management ───────────────────────────────────────────────
  const atr = indicators.atr.at(-1) ?? price * 0.025;
  const atrPct = safeDiv(atr, price) * 100;
  const structuralStop = supportLevel * 0.997;
  const volatilityStop = price - 1.5 * atr;
  const stopLoss = Math.max(structuralStop, volatilityStop);
  const stopLossPct = safeDiv(price - stopLoss, price) * 100;
  const entryLow = breakoutConfirmed ? breakoutLevel : price;
  const entryHigh = breakoutConfirmed ? price * 1.006 : breakoutLevel * 1.004;
  const riskAmount = Math.max(price - stopLoss, 0.01);
  const target1 = price + riskAmount * 2;
  const target2 = price + riskAmount * 3;
  const rewardToRisk = safeDiv(target1 - price, riskAmount, 1);

  let riskScore = 30;
  if (stopLossPct >= 2 && stopLossPct <= 7.5 && rewardToRisk >= 1.8) riskScore = 100;
  else if (stopLossPct > 7.5 && stopLossPct <= 9) riskScore = 62;
  else if (stopLossPct < 2) riskScore = 55;
  else if (stopLossPct > 9) riskScore = 20;

  if (stopLossPct <= 7.5) factors.push(`Stop can be kept near ${round(stopLoss)} (${round(stopLossPct, 1)}% risk)`);
  if (stopLossPct > 8.5) warnings.push(`Stop is wide at ${round(stopLossPct, 1)}%; position size should be smaller`);
  if (atrPct > 6) warnings.push(`ATR is high at ${round(atrPct, 1)}%; expect wider swings`);

  // ── Quality Score ─────────────────────────────────────────────────────────
  const last5AvgVolume = average(volumes.slice(-5));
  const previous20AvgVolume = average(volumes.slice(-25, -5));
  const accumulation = previous20AvgVolume > 0 ? safeDiv(last5AvgVolume, previous20AvgVolume, 1) : 1;
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

  // ── Final Score ───────────────────────────────────────────────────────────
  const momentumScore = Math.round(rsiScore * 0.36 + macdScore * 0.38 + stochasticScore * 0.26);
  const advancedScore = Math.round(adxScore * 0.35 + mfiScore * 0.25 + obvScore * 0.20 + bbScore * 0.20);
  const trendScore = emaScore;

  const score = Math.round(
    trendScore * WEIGHTS.trend +
    breakoutScore * WEIGHTS.breakout +
    volumeScore * WEIGHTS.volume +
    momentumScore * WEIGHTS.momentum +
    advancedScore * WEIGHTS.advanced +
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
    score >= 84 && warnings.length <= 1 && breakoutConfirmed && validBreakout
      ? "A"
      : score >= 74 && validBreakout
        ? "B+"
        : score >= 66 && validBreakout
          ? "B"
          : score >= 58 && uptrend && nearBreakout
            ? "Watch"
            : "Avoid";

  const action =
    breakoutConfirmed && score >= 74 && validBreakout
      ? "Breakout buy zone"
      : nearBreakout && score >= 66 && validBreakout
        ? "Watch for breakout trigger"
        : "Wait for cleaner confirmation";

  return {
    score: clamp(score, 0, 100),
    signals: {
      rsi: round(rsiCurr, 1),
      rsiScore,
      macd: macdCurr
        ? {
            value: round(macdCurr.MACD, 3),
            signal: round(macdCurr.signal, 3),
            histogram: round(macdCurr.histogram, 3),
          }
        : null,
      macdScore,
      ema: { ema9: round(e9), ema21: round(e21), ema50: round(e50), price: round(price) },
      emaScore,
      priceAboveEmas: uptrend,
      volumeSpike: volRatio >= 1.5,
      volRatio: round(volRatio, 2),
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
      advancedScore,
      adx: adxCurr
        ? {
            value: round(adxCurr.adx, 1),
            plusDi: round(adxCurr.pdi, 1),
            minusDi: round(adxCurr.mdi, 1),
            score: adxScore,
          }
        : null,
      mfi: Number.isFinite(mfiCurr) ? round(mfiCurr, 1) : null,
      mfiScore,
      stochastic: stochastic
        ? {
            k: round(stochastic.k, 1),
            d: round(stochastic.d, 1),
            score: stochasticScore,
          }
        : null,
      obv: {
        slope: round(obvSlope, 0),
        rising: obvSlope > 0,
        score: obvScore,
      },
      bollinger: bb
        ? {
            upper: round(bb.upper),
            middle: round(bb.middle),
            lower: round(bb.lower),
            percentB: round(bbPercent, 2),
            widthPct: round(bbWidthPct, 2),
            score: bbScore,
          }
        : null,
      returns: {
        ret5: pct(ret5),
        ret20: pct(ret20),
        ret50: pct(ret50),
      },
      riskScore,
      qualityScore,
      confirmation: {
        validBreakout,
        liquidEnough,
        avgTurnover: round(avgTurnover, 0),
        accumulation: round(accumulation, 2),
        usingCompletedVolume: latestIsToday,
      },
      dataQuality: validation,
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