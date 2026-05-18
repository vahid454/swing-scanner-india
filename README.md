# NSE Swing Scanner

Real-time swing trading scanner for **Indian stocks (NSE)**.
Combines RSI / MACD / EMA / Volume technicals + Finnhub news sentiment.
Returns the top 5 swing trade candidates, updated every 5 minutes.

---

## Quick Start (Local)

### 1. Prerequisites
- Node.js ≥ 20
- Docker Desktop (for Redis)

### 2. Clone & install
```bash
git clone <repo>
cd swing-scanner-india
npm install
```

### 3. Start Redis
```bash
docker compose up -d
# Starts Redis on localhost:6379
```

### 4. Configure environment
```bash
cp .env.example .env
# Open .env and add your FINNHUB_API_KEY
# Free at: https://finnhub.io/register
```

### 5. Run the server
```bash
npm run dev
# Open http://localhost:3000
```

> **No API key?** The app runs in demo mode with mock candle data so you
> can test the UI and scoring pipeline without signing up.

---

## Architecture

```
Finnhub WebSocket ──ticks──► websocketClient.js ──► Redis tick cache
Finnhub REST API  ──candles──► fetchCandles.js  ──► Redis ohlcv cache
Finnhub REST API  ──news─────► sentiment.js     ──► Redis sentiment cache
                                      │
                    BullMQ (every 5 min) → scanWorker.js
                                      │
                         scoreTechnicals() + fetchSentimentScore()
                                      │
                         composite score (0–100)
                                      │
                    Redis "scan:results" ──► Fastify /ws broadcast
                                                      │
                                             browser app.js
                                                      │
                                             renderCards() → SVG ring
```

## Scoring

| Signal        | Weight | Bullish condition                     |
|---------------|--------|---------------------------------------|
| RSI(14)       | 20%    | 30–50 and rising                      |
| MACD          | 20%    | MACD line > signal line               |
| EMA 9/21      | 15%    | Price > EMA9 > EMA21                  |
| Volume        | 15%    | Current > 1.5× 20-day average         |
| News sentiment| 30%    | Positive keyword ratio in headlines   |

## Deployment (Railway)

1. Push to GitHub
2. New project → "Deploy from GitHub repo"
3. Add Redis plugin (Railway provides `REDIS_URL` automatically)
4. Set env vars: `FINNHUB_API_KEY`, `NODE_ENV=production`
5. Deploy — Railway detects `Dockerfile` automatically

## API Endpoints

| Method | Path                          | Description              |
|--------|-------------------------------|--------------------------|
| GET    | /                             | Frontend UI              |
| GET    | /health                       | Health check             |
| GET    | /api/scanner/results          | Cached top-5 results     |
| POST   | /api/scanner/trigger          | Run scan immediately     |
| GET    | /api/scanner/status           | Queue stats              |
| GET    | /api/stocks/watchlist         | NSE symbol list          |
| GET    | /api/stocks/:symbol/candles   | Cached OHLCV data        |
| GET    | /api/stocks/:symbol/sentiment | Cached sentiment score   |
| WS     | /ws                           | Live result push stream  |

---

> ⚠️ For educational and research use only. Not financial advice.
