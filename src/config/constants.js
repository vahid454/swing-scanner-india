/**
 * config/constants.js
 *
 * SAFE EXPANDED VERSION
 * - Preserves existing exports
 * - Adds broader stock coverage
 * - Adds API expansion
 * - Keeps backward compatibility
 */

/* =========================================================
 * CORE WATCHLIST
 * ========================================================= */

export const WATCHLIST = [
  "RELIANCE",
  "TCS",
  "HDFCBANK",
  "INFY",
  "ICICIBANK",
  "BAJFINANCE",
  "SBIN",
  "WIPRO",
  "AXISBANK",
  "LT",
  "ADANIENT",
  "MARUTI",
  "SUNPHARMA",
  "TATAMOTORS",
  "HCLTECH",
  "ITC",
  "SAIL",
  "HINDCOPPER",
  "TATASTEEL",
  "JSWSTEEL",
  "HINDALCO",
  "COALINDIA",
  "ONGC",
  "NTPC",
  "POWERGRID",
  "BHARTIARTL",
  "KOTAKBANK",
  "ULTRACEMCO",
  "ASIANPAINT",
  "TITAN",
  "DRREDDY",
  "CIPLA",
  "GRASIM",
  "EICHERMOT",
  "HEROMOTOCO",
];

/* =========================================================
 * MARKET INDEXES
 * ========================================================= */

export const MARKET_INDEXES = {
  NIFTY: "^NSEI",
  BANKNIFTY: "^NSEBANK",
  INDIA_VIX: "^INDIAVIX",
};

/* =========================================================
 * BANKING SYMBOLS
 * ========================================================= */

export const BANKING_SYMBOLS = new Set([
  "HDFCBANK",
  "ICICIBANK",
  "AXISBANK",
  "SBIN",
  "KOTAKBANK",
  "BANKBARODA",
  "PNB",
  "CANBK",
  "IDFCFIRSTB",
  "INDUSINDBK",
]);

/* =========================================================
 * STOCK PROFILES
 * ========================================================= */

export const STOCK_PROFILES = {
  RELIANCE: {
    sector: "Energy",
    sectorIndex: "NIFTY",
    industry: "Oil & Gas",
  },

  TCS: {
    sector: "Information Technology",
    sectorIndex: "NIFTY",
    industry: "IT Services",
  },

  HDFCBANK: {
    sector: "Financial Services",
    sectorIndex: "BANKNIFTY",
    industry: "Private Bank",
  },

  INFY: {
    sector: "Information Technology",
    sectorIndex: "NIFTY",
    industry: "IT Services",
  },

  ICICIBANK: {
    sector: "Financial Services",
    sectorIndex: "BANKNIFTY",
    industry: "Private Bank",
  },

  ITC: {
    sector: "Consumer Defensive",
    sectorIndex: "NIFTY",
    industry: "FMCG",
  },

  TATASTEEL: {
    sector: "Basic Materials",
    sectorIndex: "NIFTY",
    industry: "Steel",
  },

  HINDALCO: {
    sector: "Basic Materials",
    sectorIndex: "NIFTY",
    industry: "Metals",
  },

  NTPC: {
    sector: "Utilities",
    sectorIndex: "NIFTY",
    industry: "Power",
  },

  POWERGRID: {
    sector: "Utilities",
    sectorIndex: "NIFTY",
    industry: "Power Transmission",
  },
};

/* =========================================================
 * STOCK ALIASES
 * ========================================================= */

export const STOCK_ALIASES = {
  RELIANCE: "RELIANCE",
  RELIANCEINDUSTRIES: "RELIANCE",

  TCS: "TCS",
  TATACONSULTANCYSERVICES: "TCS",

  INFOSYS: "INFY",
  INFY: "INFY",

  HDFCBANK: "HDFCBANK",
  HDFC: "HDFCBANK",

  ICICI: "ICICIBANK",
  ICICIBANK: "ICICIBANK",

  SBI: "SBIN",
  SBIN: "SBIN",

  AXIS: "AXISBANK",
  AXISBANK: "AXISBANK",

  LT: "LT",
  LARSENTOUBRO: "LT",

  ITC: "ITC",

  TATASTEEL: "TATASTEEL",

  JSWSTEEL: "JSWSTEEL",

  HINDALCO: "HINDALCO",

  POWERGRID: "POWERGRID",

  BHARTIAIRTEL: "BHARTIARTL",
  BHARTIARTL: "BHARTIARTL",
};

/* =========================================================
 * LARGE CAP EXPANSION
 * ========================================================= */

export const LARGE_CAP_STOCKS = [
  "TECHM",
  "DIVISLAB",
  "NESTLEIND",
  "BAJAJFINSV",
  "INDUSINDBK",
  "ADANIPORTS",
  "TATACONSUM",
  "BRITANNIA",
  "APOLLOHOSP",
  "SBILIFE",
  "HDFCLIFE",
  "BPCL",
  "IOC",
  "SHREECEM",
  "PIDILITIND",
  "DABUR",
  "M&M",
  "TATAPOWER",
  "SIEMENS",
  "AMBUJACEM",
];

/* =========================================================
 * MIDCAPS
 * ========================================================= */

export const MIDCAP_STOCKS = [
  "BHEL",
  "RVNL",
  "IRCTC",
  "IREDA",
  "NHPC",
  "HUDCO",
  "IDFCFIRSTB",
  "BANKBARODA",
  "PNB",
  "CANBK",
  "UNIONBANK",
  "JINDALSTEL",
  "NMDC",
  "VEDL",
  "PAGEIND",
  "MPHASIS",
  "LTIM",
  "PERSISTENT",
  "COFORGE",
  "PAYTM",
  "ZOMATO",
  "NYKAA",
  "POLYCAB",
  "DIXON",
  "BEL",
  "HAL",
  "BDL",
  "MAZDOCK",
  "COCHINSHIP",
  "SUZLON",
];

/* =========================================================
 * HIGH BETA STOCKS
 * ========================================================= */

export const HIGH_BETA_STOCKS = [
  "YESBANK",
  "IDEA",
  "JPPOWER",
  "RPOWER",
  "TRIDENT",
  "IRFC",
  "NBCC",
  "GMRINFRA",
  "ZEEL",
  "PFC",
  "RECLTD",
  "IEX",
  "TATACHEM",
  "DEEPAKNTR",
  "RAIN",
  "GSFC",
  "GNFC",
];

/* =========================================================
 * THEMATIC STOCKS
 * ========================================================= */

export const THEMATIC_STOCKS = {
  AI_TECH: [
    "TCS",
    "INFY",
    "HCLTECH",
    "WIPRO",
    "TECHM",
    "LTIM",
    "PERSISTENT",
    "COFORGE",
  ],

  DEFENCE: [
    "HAL",
    "BEL",
    "BDL",
    "MAZDOCK",
    "COCHINSHIP",
  ],

  RAILWAYS: [
    "RVNL",
    "IRCTC",
    "IRFC",
  ],

  POWER_ENERGY: [
    "NTPC",
    "POWERGRID",
    "NHPC",
    "TATAPOWER",
    "SUZLON",
    "PFC",
    "RECLTD",
  ],

  METALS: [
    "TATASTEEL",
    "JSWSTEEL",
    "HINDALCO",
    "HINDCOPPER",
    "NMDC",
    "VEDL",
  ],
};

/* =========================================================
 * EXPANDED WATCHLIST
 * ========================================================= */

export const EXPANDED_WATCHLIST = [
  ...new Set([
    ...WATCHLIST,
    ...LARGE_CAP_STOCKS,
    ...MIDCAP_STOCKS,
    ...HIGH_BETA_STOCKS,
    ...Object.values(THEMATIC_STOCKS).flat(),
  ]),
];

/* =========================================================
 * SCAN PROFILES
 * ========================================================= */

export const SCAN_PROFILES = {
  LIGHT: WATCHLIST,

  MEDIUM: [
    ...new Set([
      ...WATCHLIST,
      ...LARGE_CAP_STOCKS,
    ]),
  ],

  FULL: EXPANDED_WATCHLIST,
};

/* =========================================================
 * API LIMITS
 * ========================================================= */

export const API_LIMITS = {
  MAX_PARALLEL_REQUESTS: 4,
  REQUEST_GAP_MS: 250,
  YAHOO_RETRY_DELAY_MS: 2000,
};

/* =========================================================
 * SCORE WEIGHTS
 * ========================================================= */

export const SCORE_WEIGHTS = {
  technical: 0.62,
  fundamentals: 0.18,
  market: 0.10,
  sentiment: 0.10,
};

/* =========================================================
 * GENERAL CONFIG
 * ========================================================= */

export const TOP_N = 5;

export const SCAN_INTERVAL_MS = 5 * 60 * 1000;

/* =========================================================
 * MARKET PHASE
 * ========================================================= */

export const MARKET_PHASE = {
  BULLISH: "BULLISH",
  BEARISH: "BEARISH",
  SIDEWAYS: "SIDEWAYS",
  VOLATILE: "VOLATILE",
};

/* =========================================================
 * LIQUIDITY FILTERS
 * ========================================================= */

export const MINIMUM_FILTERS = {
  MIN_AVG_VOLUME: 500000,
  MIN_PRICE: 20,
  MAX_PRICE: 50000,
};

/* =========================================================
 * API CONFIG
 * ========================================================= */

export const API = {
  /* ===== Yahoo ===== */

  YAHOO_CHART:
    "https://query1.finance.yahoo.com/v8/finance/chart",

  YAHOO_QUOTE:
    "https://query1.finance.yahoo.com/v7/finance/quote",

  YAHOO_QUOTE_SUMMARY:
    "https://query1.finance.yahoo.com/v10/finance/quoteSummary",

  YAHOO_SPARK:
    "https://query1.finance.yahoo.com/v7/finance/spark",

  YAHOO_SEARCH:
    "https://query2.finance.yahoo.com/v1/finance/search",

  /* ===== Finnhub ===== */

  FINNHUB_BASE:
    "https://finnhub.io/api/v1",

  FINNHUB_WS:
    "wss://ws.finnhub.io",

  /* ===== Alpha Vantage ===== */

  ALPHA_VANTAGE:
    "https://www.alphavantage.co/query",

  /* ===== Twelve Data ===== */

  TWELVE_DATA:
    "https://api.twelvedata.com",

  /* ===== FMP ===== */

  FMP:
    "https://financialmodelingprep.com/api/v3",

  /* ===== Polygon ===== */

  POLYGON:
    "https://api.polygon.io",

  /* ===== EODHD ===== */

  EODHD:
    "https://eodhistoricaldata.com/api",

  /* ===== NSE ===== */

  NSE_PREOPEN:
    "https://www.nseindia.com/api/market-data-pre-open",

  NSE_QUOTE:
    "https://www.nseindia.com/api/quote-equity",

  NSE_OPTION_CHAIN:
    "https://www.nseindia.com/api/option-chain-equities",

  /* ===== Upstox ===== */

  UPSTOX_BASE:
    "https://api.upstox.com/v2",

  UPSTOX_WS:
    "wss://api.upstox.com/v2/feed/market-data-streamer",

  /* ===== Angel One ===== */

  ANGEL_ONE:
    "https://apiconnect.angelone.in",

  /* ===== FYERS ===== */

  FYERS:
    "https://api.fyers.in/api/v2",

  FYERS_WS:
    "wss://socket.fyers.in",

  /* ===== DHAN ===== */

  DHAN:
    "https://api.dhan.co",

  DHAN_WS:
    "wss://api-feed.dhan.co",

  /* ===== Binance ===== */

  BINANCE:
    "https://api.binance.com/api/v3",

  /* ===== CoinGecko ===== */

  COINGECKO:
    "https://api.coingecko.com/api/v3",

  /* ===== News ===== */

  NEWS_API:
    "https://newsapi.org/v2",

  GNEWS:
    "https://gnews.io/api/v4",

  /* ===== Reddit ===== */

  REDDIT:
    "https://www.reddit.com",

  /* ===== Fear & Greed ===== */

  CNN_FEAR_GREED:
    "https://production.dataviz.cnn.io/index/fearandgreed/graphdata",

  /* ===== Investing ===== */

  INVESTING:
    "https://www.investing.com",

  /* ===== TradingView ===== */

  TRADINGVIEW:
    "https://symbol-search.tradingview.com/symbol_search",
};