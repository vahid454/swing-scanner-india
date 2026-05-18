/**
 * config/constants.js — App-wide configuration constants
 *
 * Centralises:
 *  - WATCHLIST: NSE symbols to scan (expand later via DB or file)
 *  - SCAN_INTERVAL_MS: how often the BullMQ repeatable job fires
 *  - Scoring weights for technical vs sentiment signals
 *  - API base URLs
 */

// NSE symbols — use Upstox/Fyers symbol format e.g. "NSE_EQ|INE002A01018"
// For Finnhub use "NSE:RELIANCE" format
export const WATCHLIST = [
  "RELIANCE", "TCS", "HDFCBANK", "INFY", "ICICIBANK",
  "BAJFINANCE", "SBIN", "WIPRO", "AXISBANK", "LT",
  "ADANIENT", "MARUTI", "SUNPHARMA", "TATAMOTORS", "HCLTECH",
  // TODO: load from a config file or DB in Phase 2
];

export const MARKET_INDEXES = {
  NIFTY: "^NSEI",
  BANKNIFTY: "^NSEBANK",
};

export const BANKING_SYMBOLS = new Set([
  "HDFCBANK", "ICICIBANK", "AXISBANK", "SBIN",
]);

export const STOCK_ALIASES = {
  RELIANCEINDUSTRIES: "RELIANCE",
  RELIANCE: "RELIANCE",
  TATACONSULTANCYSERVICES: "TCS",
  TCS: "TCS",
  HDFCBANK: "HDFCBANK",
  HDFC: "HDFCBANK",
  HDFCBANKLTD: "HDFCBANK",
  INFOSYS: "INFY",
  INFY: "INFY",
  ICICIBANK: "ICICIBANK",
  ICICI: "ICICIBANK",
  BAJAJFINANCE: "BAJFINANCE",
  BAJFINANCE: "BAJFINANCE",
  STATEBANKOFINDIA: "SBIN",
  SBI: "SBIN",
  SBIN: "SBIN",
  WIPRO: "WIPRO",
  AXISBANK: "AXISBANK",
  AXIS: "AXISBANK",
  LARSENTOUBRO: "LT",
  LT: "LT",
  ADANIENTERPRISES: "ADANIENT",
  ADANIENT: "ADANIENT",
  MARUTI: "MARUTI",
  MARUTISUZUKI: "MARUTI",
  SUNPHARMA: "SUNPHARMA",
  SUNPHARMACEUTICAL: "SUNPHARMA",
  TATAMOTORS: "TATAMOTORS",
  HCLTECH: "HCLTECH",
  HCLTECHNOLOGIES: "HCLTECH",
};

export const SCAN_INTERVAL_MS = 5 * 60 * 1000; // every 5 minutes

export const SCORE_WEIGHTS = {
  technical: 0.85,
  sentiment: 0.15, // news is useful, but swing breakouts should be led by price/volume
};

export const TOP_N = 5; // return top N candidates

export const API = {
  // Finnhub — free tier, real-time Indian stocks via NSE feed
  FINNHUB_BASE: "https://finnhub.io/api/v1",
  FINNHUB_WS:   "wss://ws.finnhub.io",
  YAHOO_CHART:   "https://query1.finance.yahoo.com/v8/finance/chart",

  // Upstox — free for registered users, real Indian market WebSocket
  // UPSTOX_WS: "wss://api.upstox.com/v2/feed/market-data-streamer",
};
