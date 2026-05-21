/**
 * helpers/fetchCandles.js - OHLCV candle fetcher with multiple fallbacks and retry logic
 *
 * Data sources (in order of preference):
 *  1. Redis cache
 *  2. Finnhub API
 *  3. Yahoo Finance Chart API (primary endpoint)
 *  4. Yahoo Finance v8 API (alternative endpoint)
 *  5. Alpha Vantage (if API key configured)
 *
 * Features:
 *  - Exponential backoff retry logic
 *  - Rate limiting per provider
 *  - Stale-while-revalidate caching
 *  - Detailed error logging
 */

import { redisClient } from "../config/redis.js";
import { API } from "../config/constants.js";

const CACHE_TTL = 300; // 5 minutes for fresh data
const STALE_TTL = 3600; // 1 hour for stale fallback
const DAYS_BACK = 180;
const MIN_CANDLES = 55;
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 200;

// Rate limiting state per provider
const rateLimiter = {
  finnhub: { lastCall: 0, minInterval: 120, failures: 0, disabled: false },
  yahoo: { lastCall: 0, minInterval: 50, failures: 0, disabled: false },
  yahooV8: { lastCall: 0, minInterval: 50, failures: 0, disabled: false },
  alphaVantage: { lastCall: 0, minInterval: 800, failures: 0, disabled: false },
};

const FAILURE_THRESHOLD = 5;
const DISABLE_DURATION_MS = 60000; // 1 minute

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForRateLimit(provider) {
  const limiter = rateLimiter[provider];
  if (!limiter) return;
  
  // Check if provider is temporarily disabled
  if (limiter.disabled) {
    if (Date.now() - limiter.disabledAt > DISABLE_DURATION_MS) {
      limiter.disabled = false;
      limiter.failures = 0;
    } else {
      return false; // Still disabled
    }
  }
  
  const elapsed = Date.now() - limiter.lastCall;
  if (elapsed < limiter.minInterval) {
    await sleep(limiter.minInterval - elapsed);
  }
  limiter.lastCall = Date.now();
  return true;
}

function recordSuccess(provider) {
  const limiter = rateLimiter[provider];
  if (limiter) {
    limiter.failures = Math.max(0, limiter.failures - 1);
  }
}

function recordFailure(provider) {
  const limiter = rateLimiter[provider];
  if (limiter) {
    limiter.failures++;
    if (limiter.failures >= FAILURE_THRESHOLD) {
      limiter.disabled = true;
      limiter.disabledAt = Date.now();
      console.warn(`[Candles] Provider ${provider} temporarily disabled after ${limiter.failures} failures`);
    }
  }
}

function yahooSymbol(symbol) {
  return `${symbol.toUpperCase()}.NS`;
}

function isUsableCandles(candles, minRequired = MIN_CANDLES) {
  return (
    Array.isArray(candles) &&
    candles.length >= minRequired &&
    candles.every(
      (c) =>
        Number.isFinite(c.open) &&
        Number.isFinite(c.high) &&
        Number.isFinite(c.low) &&
        Number.isFinite(c.close) &&
        Number.isFinite(c.volume) &&
        c.open > 0 &&
        c.high > 0 &&
        c.low > 0 &&
        c.close > 0 &&
        c.high >= c.low &&
        c.high >= c.open &&
        c.high >= c.close &&
        c.low <= c.open &&
        c.low <= c.close
    )
  );
}

function cleanCandles(candles) {
  // Remove duplicates by timestamp and sort chronologically
  const seen = new Set();
  return candles
    .filter((c) => {
      if (seen.has(c.time)) return false;
      seen.add(c.time);
      return true;
    })
    .sort((a, b) => a.time - b.time);
}

function parseFinnhubCandles(data, provider) {
  if (data?.s !== "ok" || !data.c?.length) return [];
  const candles = data.t.map((time, i) => ({
    time,
    open: Number(data.o[i]),
    high: Number(data.h[i]),
    low: Number(data.l[i]),
    close: Number(data.c[i]),
    volume: Number(data.v[i]),
    provider,
  }));
  return cleanCandles(candles);
}

function parseYahooCandles(data, provider) {
  const result = data?.chart?.result?.[0];
  const timestamps = result?.timestamp ?? [];
  const quote = result?.indicators?.quote?.[0];
  if (!timestamps.length || !quote) return [];

  const candles = timestamps
    .map((time, i) => ({
      time,
      open: Number(quote.open?.[i]),
      high: Number(quote.high?.[i]),
      low: Number(quote.low?.[i]),
      close: Number(quote.close?.[i]),
      volume: Number(quote.volume?.[i]),
      provider,
    }))
    .filter(
      (c) =>
        Number.isFinite(c.open) &&
        Number.isFinite(c.high) &&
        Number.isFinite(c.low) &&
        Number.isFinite(c.close) &&
        Number.isFinite(c.volume)
    );
  return cleanCandles(candles);
}

function parseAlphaVantageCandles(data, provider) {
  const timeSeries = data?.["Time Series (Daily)"];
  if (!timeSeries) return [];

  const candles = Object.entries(timeSeries).map(([dateStr, values]) => ({
    time: Math.floor(new Date(dateStr).getTime() / 1000),
    open: Number(values["1. open"]),
    high: Number(values["2. high"]),
    low: Number(values["3. low"]),
    close: Number(values["4. close"]),
    volume: Number(values["5. volume"]),
    provider,
  }));
  return cleanCandles(candles);
}



async function safeParseResponse(res) {
  const contentType = res.headers.get("content-type") || "";

  // Try JSON first if response says it's JSON
  if (contentType.includes("application/json")) {
    try {
      return await res.json();
    } catch (err) {
      const text = await res.text();

      return {
        ok: false,
        status: res.status,
        error: "Invalid JSON response",
        raw: text,
      };
    }
  }

  // Fallback for text/html/plain-text responses
  const text = await res.text();

  try {
    return JSON.parse(text);
  } catch {
    return {
      ok: false,
      status: res.status,
      error: text || "Non-JSON response received",
    };
  }
}

async function fetchWithRetry(
  url,
  options = {},
  maxRetries = MAX_RETRIES
) {
  let lastError;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    let controller;
    let timeout;

    try {
      controller = new AbortController();

      timeout = setTimeout(() => {
        controller.abort();
      }, 15000);

      const res = await fetch(url, {
        ...options,
        signal: controller.signal,
      });

      clearTimeout(timeout);

      // Handle rate limit
      if (res.status === 429) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt + 1);

        console.warn(
          `[Fetch] Rate limited (429). Retry ${attempt + 1}/${maxRetries} in ${delay}ms`
        );

        await sleep(delay);
        continue;
      }

      // Handle server errors
      if (!res.ok) {
        const text = await res.text();

        throw new Error(
          `HTTP ${res.status}: ${text || res.statusText}`
        );
      }

      // Safe response parsing
      return await safeParseResponse(res);

    } catch (err) {
      clearTimeout(timeout);

      lastError = err;

      // Timeout
      if (err.name === "AbortError") {
        console.warn(
          `[Fetch] Timeout. Attempt ${attempt + 1}/${maxRetries}`
        );
      } else {
        console.warn(
          `[Fetch] Error: ${err.message}`
        );
      }

      // Retry remaining
      if (attempt < maxRetries - 1) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt);

        console.warn(
          `[Fetch] Retrying in ${delay}ms`
        );

        await sleep(delay);
      }
    }
  }

  throw lastError || new Error("Fetch failed after retries");
}

async function fetchFinnhubCandles(symbol) {
  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey || apiKey === "your_finnhub_api_key_here") return [];

  const canWait = await waitForRateLimit("finnhub");
  if (!canWait) return [];

  const to = Math.floor(Date.now() / 1000);
  const from = to - DAYS_BACK * 24 * 60 * 60;
  
  // Try NSE: prefix first, then without prefix
  const symbols = [`NSE:${symbol}`, symbol];
  
  for (const sym of symbols) {
    try {
      const url =
        `${API.FINNHUB_BASE}/stock/candle` +
        `?symbol=${encodeURIComponent(sym)}&resolution=D&from=${from}&to=${to}` +
        `&token=${apiKey}`;

      const data = await fetchWithRetry(url);
      const candles = parseFinnhubCandles(data, "finnhub-candle");
      
      if (candles.length >= MIN_CANDLES) {
        recordSuccess("finnhub");
        return candles;
      }
    } catch (err) {
      console.warn(`[Candles] Finnhub ${sym} error: ${err.message}`);
    }
  }
  
  recordFailure("finnhub");
  return [];
}

async function fetchYahooCandles(symbol) {
  const canWait = await waitForRateLimit("yahoo");
  if (!canWait) return [];

  const yahooSym = yahooSymbol(symbol);
  const url =
    `${API.YAHOO_CHART}/${encodeURIComponent(yahooSym)}` +
    "?range=6mo&interval=1d&includePrePost=false";

  try {
    const data = await fetchWithRetry(url, {
      headers: {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        accept: "application/json",
      },
    });
    const candles = parseYahooCandles(data, "yahoo-chart");
    
    if (candles.length >= MIN_CANDLES) {
      recordSuccess("yahoo");
      return candles;
    }
  } catch (err) {
    console.warn(`[Candles] Yahoo chart ${yahooSym} error: ${err.message}`);
    recordFailure("yahoo");
  }
  return [];
}

async function fetchYahooV8Candles(symbol) {
  const canWait = await waitForRateLimit("yahooV8");
  if (!canWait) return [];

  const yahooSym = yahooSymbol(symbol);
  const to = Math.floor(Date.now() / 1000);
  const from = to - DAYS_BACK * 24 * 60 * 60;
  
  // Alternative Yahoo Finance v8 endpoint
  const url =
    `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSym)}` +
    `?period1=${from}&period2=${to}&interval=1d&includePrePost=false`;

  try {
    const data = await fetchWithRetry(url, {
      headers: {
        "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        accept: "*/*",
        "accept-language": "en-US,en;q=0.9",
      },
    });
    const candles = parseYahooCandles(data, "yahoo-v8");
    
    if (candles.length >= MIN_CANDLES) {
      recordSuccess("yahooV8");
      return candles;
    }
  } catch (err) {
    console.warn(`[Candles] Yahoo v8 ${yahooSym} error: ${err.message}`);
    recordFailure("yahooV8");
  }
  return [];
}

async function fetchAlphaVantageCandles(symbol) {
  const apiKey = process.env.ALPHA_VANTAGE_API_KEY;
  if (!apiKey || apiKey === "your_alpha_vantage_api_key_here") return [];

  const canWait = await waitForRateLimit("alphaVantage");
  if (!canWait) return [];

  // Alpha Vantage uses BSE: prefix for Indian stocks
  const bseSymbol = `BSE:${symbol}`;
  const url =
    `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY` +
    `&symbol=${encodeURIComponent(bseSymbol)}&outputsize=compact&apikey=${apiKey}`;

  try {
    const data = await fetchWithRetry(url);
    
    // Check for error messages
    if (data?.["Error Message"] || data?.Note) {
      console.warn(`[Candles] Alpha Vantage ${symbol}: ${data["Error Message"] || data.Note}`);
      recordFailure("alphaVantage");
      return [];
    }
    
    const candles = parseAlphaVantageCandles(data, "alpha-vantage");
    
    if (candles.length >= MIN_CANDLES) {
      recordSuccess("alphaVantage");
      return candles;
    }
  } catch (err) {
    console.warn(`[Candles] Alpha Vantage ${symbol} error: ${err.message}`);
    recordFailure("alphaVantage");
  }
  return [];
}

async function getCachedCandles(cacheKey) {
  try {
    // Check fresh cache first
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      const candles = JSON.parse(cached);
      if (isUsableCandles(candles) && candles.at(-1)?.provider) {
        return { candles, fresh: true };
      }
    }

    // Check stale cache as fallback
    const staleKey = `${cacheKey}:stale`;
    const stale = await redisClient.get(staleKey);
    if (stale) {
      const candles = JSON.parse(stale);
      if (isUsableCandles(candles)) {
        return { candles, fresh: false };
      }
    }
  } catch (err) {
    console.warn(`[Candles] Cache read error: ${err.message}`);
  }
  return { candles: null, fresh: false };
}

async function setCachedCandles(cacheKey, candles) {
  try {
    const serialized = JSON.stringify(candles);
    await Promise.all([
      redisClient.set(cacheKey, serialized, "EX", CACHE_TTL),
      redisClient.set(`${cacheKey}:stale`, serialized, "EX", STALE_TTL),
    ]);
  } catch (err) {
    console.warn(`[Candles] Cache write error: ${err.message}`);
  }
}

/**
 * @param {string} symbol e.g. "RELIANCE"
 * @returns {Array<{open,high,low,close,volume,time,provider}>}
 */
export async function fetchCandles(symbol) {
  const normalized = symbol.toUpperCase().replace(/\.NS$/i, "");
  const cacheKey = `ohlcv:${normalized}`;

  // Step 1: Check cache
  const { candles: cached, fresh } = await getCachedCandles(cacheKey);
  if (cached && fresh) {
    return cached;
  }

  // Step 2: Try providers in sequence
  const providers = [
    { name: "Finnhub", fn: fetchFinnhubCandles },
    { name: "Yahoo Chart", fn: fetchYahooCandles },
    { name: "Yahoo V8", fn: fetchYahooV8Candles },
    { name: "Alpha Vantage", fn: fetchAlphaVantageCandles },
  ];

  const errors = [];
  
  for (const { name, fn } of providers) {
    try {
      const candles = await fn(normalized);
      if (isUsableCandles(candles)) {
        await setCachedCandles(cacheKey, candles);
        console.info(`[Candles] ${normalized}: ${candles.length} candles from ${name}`);
        return candles;
      }
    } catch (err) {
      errors.push(`${name}: ${err.message}`);
    }
  }

  // Step 3: Use stale cache if all providers failed
  if (cached) {
    console.warn(`[Candles] All providers failed for ${normalized}, using stale cache (${cached.length} candles)`);
    return cached;
  }

  // Step 4: No data available
  const errorSummary = errors.length > 0 ? ` Errors: ${errors.join("; ")}` : "";
  throw new Error(
    `No candle data available for ${normalized} after trying all providers.${errorSummary}`
  );
}

/**
 * Batch fetch candles for multiple symbols with concurrency control
 * @param {string[]} symbols
 * @param {number} concurrency
 * @returns {Map<string, {candles: Array, error: string|null}>}
 */
export async function fetchCandlesBatch(symbols, concurrency = 3) {
  const results = new Map();
  
  for (let i = 0; i < symbols.length; i += concurrency) {
    const batch = symbols.slice(i, i + concurrency);
    const settled = await Promise.allSettled(
      batch.map(async (symbol) => {
        const candles = await fetchCandles(symbol);
        return { symbol, candles };
      })
    );
    
    for (const result of settled) {
      if (result.status === "fulfilled") {
        results.set(result.value.symbol, { candles: result.value.candles, error: null });
      } else {
        const symbol = batch[settled.indexOf(result)];
        results.set(symbol, { candles: null, error: result.reason?.message ?? "Unknown error" });
      }
    }
    
    // Small delay between batches to be nice to APIs
    if (i + concurrency < symbols.length) {
      await sleep(100);
    }
  }
  
  return results;
}

/**
 * Get provider health status
 * @returns {Object}
 */
export function getProviderStatus() {
  return Object.entries(rateLimiter).reduce((acc, [name, state]) => {
    acc[name] = {
      disabled: state.disabled,
      failures: state.failures,
      lastCallAgo: state.lastCall ? Date.now() - state.lastCall : null,
    };
    return acc;
  }, {});
}

/**
 * Reset a provider's failure count (useful after fixing API key issues)
 * @param {string} provider
 */
export function resetProvider(provider) {
  if (rateLimiter[provider]) {
    rateLimiter[provider].failures = 0;
    rateLimiter[provider].disabled = false;
    console.info(`[Candles] Provider ${provider} reset`);
  }
}