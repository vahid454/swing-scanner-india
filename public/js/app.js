/**
 * public/js/app.js — NSE Swing Scanner frontend controller
 *
 * Handles:
 *  - WebSocket connection with auto-reconnect
 *  - Card rendering from scan results
 *  - Score ring SVG animation
 *  - Signal pills (RSI, MACD, EMA, Volume)
 *  - IST clock
 *  - Manual scan trigger + refresh
 */

"use strict";

// ── Config ────────────────────────────────────────────────────────────────
const WS_URL      = `ws${location.protocol === "https:" ? "s" : ""}://${location.host}/ws`;
const API_RESULTS = "/api/scanner/results";
const API_TRIGGER = "/api/scanner/trigger";
const API_HISTORY = "/api/scanner/history";
const API_SEARCH = "/api/scanner/search";
const API_TODAY = "/api/scanner/today";

// ── DOM ───────────────────────────────────────────────────────────────────
const grid        = document.getElementById("results-grid");
const emptyState  = document.getElementById("empty-state");
const wsStatusEl  = document.getElementById("ws-status");
const lastRunEl   = document.getElementById("last-run-time");
const marketTime  = document.getElementById("market-time");
const cardTpl     = document.getElementById("card-template");
const btnScan     = document.getElementById("btn-scan");
const btnRefresh  = document.getElementById("btn-refresh");
const jobStatusEl = document.getElementById("job-status");
const scanCountEl = document.getElementById("scan-count");
const demoBanner  = document.getElementById("demo-banner");
const drawer      = document.getElementById("stock-drawer");
const drawerClose = document.getElementById("drawer-close");
const drawerBackdrop = document.getElementById("drawer-backdrop");
const btnHistory = document.getElementById("btn-history");
const historyBody = document.getElementById("history-body");
const stockSearch = document.getElementById("stock-search");
const stockSearchInput = document.getElementById("stock-search-input");
const viewTabs = document.querySelectorAll(".view-tab");
const tabPanels = document.querySelectorAll(".tab-panel");
const btnToday = document.getElementById("btn-today");
const todayBestSymbol = document.getElementById("today-best-symbol");
const todayBestMeta = document.getElementById("today-best-meta");
const todayActivity = document.getElementById("today-activity");
const smartCount = document.getElementById("smart-count");
const todayPicks = document.getElementById("today-picks");
const smartLookups = document.getElementById("smart-lookups");
const historyFilters = document.getElementById("history-filters");
const historyDate = document.getElementById("history-date");
const historySource = document.getElementById("history-source");
const historySymbol = document.getElementById("history-symbol");
const btnHistoryClear = document.getElementById("btn-history-clear");

let scanCount = 0;
let reconnectTimer = null;
let latestStocks = [];
let todayLoaded = false;

// ── IST Clock ─────────────────────────────────────────────────────────────
function tickClock() {
  marketTime.textContent = "IST " + new Date().toLocaleTimeString("en-IN", {
    timeZone: "Asia/Kolkata", hour12: false,
  });
}
setInterval(tickClock, 1000);
tickClock();

// ── WebSocket ─────────────────────────────────────────────────────────────
function setWsStatus(state) {
  wsStatusEl.className = "badge";
  if (state === "live")  { wsStatusEl.textContent = "● Live";          wsStatusEl.classList.add("badge--live");  }
  if (state === "error") { wsStatusEl.textContent = "● Disconnected";  wsStatusEl.classList.add("badge--error"); }
  if (state === "wait")  { wsStatusEl.textContent = "● Reconnecting…"; }
}

function openWebSocket() {
  const ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    setWsStatus("live");
    clearTimeout(reconnectTimer);
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === "scan_result" && Array.isArray(msg.data)) {
        renderCards(msg.data);
      }
    } catch (_) {}
  };

  ws.onclose = () => {
    setWsStatus("wait");
    reconnectTimer = setTimeout(openWebSocket, 3000);
  };

  ws.onerror = () => setWsStatus("error");
}

// ── Card rendering ────────────────────────────────────────────────────────
function scoreColor(score) {
  if (score >= 65) return "score--high";
  if (score >= 40) return "score--mid";
  return "score--low";
}

function scoreTone(score) {
  if (score === null || score === undefined || Number.isNaN(Number(score))) return "neut";
  if (Number(score) >= 65) return "bull";
  if (Number(score) <= 38) return "bear";
  return "neut";
}

function sentimentClass(label) {
  if (label === "bullish") return "badge--bullish";
  if (label === "bearish") return "badge--bearish";
  return "badge--neutral";
}

function formatPrice(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "—";
  return "₹" + Number(value).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatPct(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "—";
  const sign = Number(value) > 0 ? "+" : "";
  return `${sign}${Number(value).toFixed(2)}%`;
}

function formatScanDate(value) {
  return new Date(value).toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatScanTime(value) {
  return new Date(value).toLocaleTimeString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatCompactPrice(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "—";
  return "₹" + Number(value).toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

function setupClass(setup) {
  if (setup === "BUY" || setup === "A") return "badge--bullish";
  if (setup === "ACCUMULATE" || setup === "B+" || setup === "B") return "badge--neutral";
  if (setup === "WATCH" || setup === "Watch") return "badge--neutral";
  return "badge--bearish";
}

function entryText(plan) {
  if (!plan?.entry) return "—";
  const low = formatPrice(plan.entry.low);
  const high = formatPrice(plan.entry.high);
  return low === high ? low : `${low} - ${high}`;
}

function escapeHtml(value) {
  return String(value ?? "—")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function makeSignalPills(signals) {
  if (!signals) return "";
  const pills = [];

  // RSI pill
  if (signals.rsi !== null && signals.rsi !== undefined) {
    const rsi = signals.rsi;
    const cls = rsi < 40 ? "bull" : rsi > 65 ? "bear" : "neut";
    pills.push(`<span class="signal-pill signal-pill--${cls}">RSI ${rsi}</span>`);
  }

  // MACD pill
  if (signals.macd) {
    const bullMacd = signals.macd.value > signals.macd.signal;
    pills.push(`<span class="signal-pill signal-pill--${bullMacd ? "bull" : "bear"}">MACD ${bullMacd ? "▲" : "▼"}</span>`);
  }

  // EMA pill
  if (signals.priceAboveEmas !== undefined) {
    pills.push(`<span class="signal-pill signal-pill--${signals.priceAboveEmas ? "bull" : "bear"}">EMA ${signals.priceAboveEmas ? "↑" : "↓"}</span>`);
  }

  // Volume pill
  if (signals.volumeSpike !== undefined) {
    pills.push(`<span class="signal-pill signal-pill--${signals.volumeSpike ? "bull" : "neut"}">Vol ${signals.volRatio ?? "?"}×</span>`);
  }

  if (signals.adx?.value !== null && signals.adx?.value !== undefined) {
    const tone = signals.adx.score >= 72 ? "bull" : signals.adx.score <= 35 ? "bear" : "neut";
    pills.push(`<span class="signal-pill signal-pill--${tone}">ADX ${signals.adx.value}</span>`);
  }

  if (signals.mfi !== null && signals.mfi !== undefined) {
    const tone = signals.mfi > 80 ? "bear" : signals.mfi >= 45 ? "bull" : "neut";
    pills.push(`<span class="signal-pill signal-pill--${tone}">MFI ${signals.mfi}</span>`);
  }

  if (signals.bollinger?.percentB !== null && signals.bollinger?.percentB !== undefined) {
    const tone = signals.bollinger.score >= 70 ? "bull" : signals.bollinger.score <= 35 ? "bear" : "neut";
    pills.push(`<span class="signal-pill signal-pill--${tone}">BB ${signals.bollinger.percentB}</span>`);
  }

  return pills.join("");
}

function setComponentScore(card, selector, score) {
  const el = card.querySelector(selector);
  el.textContent = score === null || score === undefined ? "—" : Math.round(score);
  el.className = `component-score component-score--${scoreTone(score)}`;
}

function activateTab(tabName) {
  viewTabs.forEach((tab) => {
    const active = tab.dataset.tab === tabName;
    tab.classList.toggle("is-active", active);
    tab.setAttribute("aria-selected", active ? "true" : "false");
  });
  tabPanels.forEach((panel) => {
    const active = panel.id === `tab-${tabName}`;
    panel.classList.toggle("is-active", active);
    panel.hidden = !active;
  });

  if (tabName === "today" && !todayLoaded) loadToday();
  if (tabName === "history") loadHistory();
}

function renderCards(stocks) {
  latestStocks = stocks;
  // Remove existing cards (not the empty state or template)
  grid.querySelectorAll(".stock-card").forEach((el) => el.remove());

  const isDemoMode = stocks.some((s) =>
    s.sentiment?.headlines?.some((h) => h.includes("Demo mode"))
  );
  demoBanner.style.display = isDemoMode ? "block" : "none";

  if (!stocks.length) {
    emptyState.style.display = "block";
    scanCount++;
    const timeStr = new Date().toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" });
    lastRunEl.textContent = timeStr;
    scanCountEl.textContent = `${scanCount} scan${scanCount === 1 ? "" : "s"} this session`;
    jobStatusEl.textContent = "No actionable breakout candidates passed the current filters.";
    setTimeout(() => { jobStatusEl.textContent = ""; }, 8000);
    loadHistory();
    return;
  }
  emptyState.style.display = "none";

  stocks.forEach((stock, idx) => {
    const clone = cardTpl.content.cloneNode(true);
    const card  = clone.querySelector(".stock-card");

    if (idx === 0) card.classList.add("stock-card--rank-1");

    // Symbol
    card.querySelector(".stock-card__symbol").textContent = stock.symbol;
    card.querySelector(".stock-card__action").textContent = stock.action ?? "Wait for cleaner confirmation";
    const plan = stock.tradePlan ?? {};
    const setupBadge = card.querySelector(".setup-badge");
    setupBadge.textContent = stock.rating ?? plan.setup ?? stock.setup ?? "WATCH";
    setupBadge.className = `badge setup-badge ${setupClass(setupBadge.textContent)}`;

    // Score ring
    const score = Math.round(stock.potentialScore ?? stock.composite ?? 0);
    const ring  = card.querySelector(".score-ring__fill");
    // Animate on next frame so the transition fires
    requestAnimationFrame(() => {
      ring.setAttribute("stroke-dasharray", `${score} 100`);
    });
    ring.classList.add(scoreColor(score));
    card.querySelector(".score-ring__value").textContent = stock.potentialScore ?? score;

    // Trade levels
    card.querySelector(".live-price").textContent = formatPrice(plan.livePrice ?? plan.lastClose);
    const changeEl = card.querySelector(".live-change");
    changeEl.textContent = formatPct(plan.liveChangePct);
    changeEl.className = `price-tape__change live-change ${
      Number(plan.liveChangePct) > 0 ? "is-up" : Number(plan.liveChangePct) < 0 ? "is-down" : ""
    }`;
    card.querySelector(".entry-val").textContent = plan.entry?.trigger ? formatPrice(plan.entry.trigger) : "—";
    card.querySelector(".stop-val").textContent = formatPrice(plan.stopLoss);
    card.querySelector(".target-val").textContent = formatPrice(plan.target1);

    // Signal pills
    card.querySelector(".stock-card__signals").innerHTML =
      makeSignalPills(stock.tech?.signals);

    setComponentScore(card, ".tech-score", stock.tech?.score);
    setComponentScore(card, ".fund-score", stock.fundamentals?.score);
    setComponentScore(card, ".market-score", stock.market?.score ?? stock.market?.primary?.score);
    setComponentScore(card, ".news-score", stock.sentiment?.score);

    // Sentiment
    const sentLabel = stock.sentiment?.sentiment_label ?? "neutral";
    card.querySelector(".sentiment-badge").textContent = sentLabel;
    card.querySelector(".sentiment-badge").className =
      `badge sentiment-badge ${sentimentClass(sentLabel)}`;
    const headline = stock.sentiment?.headlines?.[0] ?? "No recent news";
    card.querySelector(".sentiment-headline").textContent = headline;

    // Metrics row
    const rsiVal = stock.tech?.signals?.rsi;
    card.querySelector(".rsi-val").textContent = rsiVal ? rsiVal.toFixed(1) : "—";
    card.querySelector(".rsi-val").style.color =
      rsiVal ? (rsiVal < 40 ? "var(--accent)" : rsiVal > 65 ? "var(--danger)" : "var(--warn)") : "";

    const adxVal = stock.tech?.signals?.adx?.value;
    card.querySelector(".adx-val").textContent = adxVal ? adxVal.toFixed(1) : "—";
    card.querySelector(".adx-val").style.color =
      adxVal >= 25 ? "var(--accent)" : adxVal < 16 ? "var(--danger)" : "var(--warn)";

    const rr = plan.rewardToRisk;
    card.querySelector(".rr-val").textContent = rr ? rr + "R" : "—";
    card.querySelector(".rr-val").style.color =
      rr >= 2 ? "var(--accent)" : rr < 1.5 ? "var(--danger)" : "var(--warn)";

    card.querySelector(".stock-card__open").addEventListener("click", () => openDrawer(stock.symbol));

    grid.appendChild(clone);
  });

  // Update footer
  scanCount++;
  const timeStr = new Date().toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" });
  lastRunEl.textContent = timeStr;
  scanCountEl.textContent = `${scanCount} scan${scanCount === 1 ? "" : "s"} this session`;
  loadHistory();
  if (todayLoaded) loadToday();
}

function fillList(listEl, items, fallback) {
  listEl.innerHTML = "";
  const values = items?.length ? items : [fallback];
  values.forEach((item) => {
    const li = document.createElement("li");
    li.textContent = item;
    listEl.appendChild(li);
  });
}

function openDrawer(symbol) {
  const stock = latestStocks.find((item) => item.symbol === symbol);
  if (!stock) return;

  const plan = stock.tradePlan ?? {};
  const signals = stock.tech?.signals ?? {};

  document.getElementById("drawer-symbol").textContent = stock.symbol;
  document.getElementById("drawer-action").textContent = stock.action ?? plan.action ?? "Wait for cleaner confirmation";
  const grade = document.getElementById("drawer-grade");
  grade.textContent = stock.rating ?? plan.setup ?? stock.setup ?? "WATCH";
  grade.className = `badge ${setupClass(grade.textContent)}`;

  document.getElementById("drawer-live").textContent = formatPrice(plan.livePrice ?? plan.lastClose);
  document.getElementById("drawer-entry").textContent = entryText(plan);
  document.getElementById("drawer-stop").textContent = `${formatPrice(plan.stopLoss)} (${plan.stopLossPct ?? "—"}%)`;
  document.getElementById("drawer-target").textContent = formatPrice(plan.target1);
  document.getElementById("drawer-breakout").textContent =
    `Breakout: ${formatPrice(plan.breakoutLevel)} (${signals.breakout?.distancePct ?? "—"}%)`;
  document.getElementById("drawer-rr").textContent = `R:R ${plan.rewardToRisk ?? "—"}R`;
  document.getElementById("drawer-source").textContent = `Source: ${plan.priceSource ?? "latest candle"}`;

  const marketFactors = stock.market?.primary?.factors ?? [];
  const marketWarnings = stock.market?.warnings ?? [];
  const ratingFactor = stock.ratingReason ? [`${stock.rating}: ${stock.ratingReason}`] : [];
  const fundamentalFactors = [
    ...(stock.fundamentals?.factors ?? []),
    ...(stock.fundamentals?.metrics?.pe ? [`P/E ${stock.fundamentals.metrics.pe}`] : []),
    ...(stock.fundamentals?.metrics?.revenueGrowthPct ? [`Revenue growth ${formatPct(stock.fundamentals.metrics.revenueGrowthPct)}`] : []),
    ...(stock.fundamentals?.metrics?.operatingMarginPct ? [`Operating margin ${stock.fundamentals.metrics.operatingMarginPct}%`] : []),
  ];
  const contextFactors = [
    ...(stock.market?.factors ?? marketFactors),
    ...(stock.sentiment?.sentiment_label ? [`News sentiment is ${stock.sentiment.sentiment_label} (${stock.sentiment.score})`] : []),
    ...(stock.sentiment?.risk_flags ?? []).map((flag) => `News risk: ${flag.category} (${flag.keyword})`),
  ];

  fillList(document.getElementById("drawer-factors"), [...ratingFactor, ...(signals.factors ?? []), ...marketFactors], "No strong confirmation factors yet.");
  fillList(document.getElementById("drawer-warnings"), [...(signals.warnings ?? []), ...(stock.fundamentals?.warnings ?? []), ...marketWarnings], "No major risk warnings from the scanner.");
  fillList(document.getElementById("drawer-fundamentals"), fundamentalFactors, "Fundamental data is neutral or unavailable.");
  fillList(document.getElementById("drawer-context"), contextFactors, "Market and sentiment context is neutral.");

  drawer.hidden = false;
  requestAnimationFrame(() => drawer.classList.add("is-open"));
}

function closeDrawer() {
  drawer.classList.remove("is-open");
  setTimeout(() => { drawer.hidden = true; }, 180);
}

drawerClose.addEventListener("click", closeDrawer);
drawerBackdrop.addEventListener("click", closeDrawer);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !drawer.hidden) closeDrawer();
});

// ── Buttons ───────────────────────────────────────────────────────────────
btnScan.addEventListener("click", async () => {
  btnScan.disabled = true;
  btnScan.textContent = "Scanning live…";
  jobStatusEl.textContent = "";

  try {
    const res  = await fetch(API_TRIGGER, { method: "POST" });
    const body = await res.json();
    jobStatusEl.textContent = body.message ?? `Job: ${body.jobId}`;
    setTimeout(() => { jobStatusEl.textContent = ""; }, 8000);
  } catch (err) {
    jobStatusEl.textContent = "Trigger failed — is the server running?";
  } finally {
    setTimeout(() => {
      btnScan.disabled = false;
      btnScan.textContent = "Run Scan Now";
    }, 3000);
  }
});

btnRefresh.addEventListener("click", async () => {
  btnRefresh.disabled = true;
  try {
    const res = await fetch(API_RESULTS);
    if (res.status === 202) {
      jobStatusEl.textContent = "No results yet — click Run Scan Now";
      return;
    }
    if (!res.ok) throw new Error(res.statusText);
    const data = await res.json();
    renderCards(Array.isArray(data) ? data : []);
  } catch (err) {
    jobStatusEl.textContent = "Refresh failed";
  } finally {
    btnRefresh.disabled = false;
  }
});

async function runSearch(query) {
  if (!query) return;

  const submitBtn = stockSearch.querySelector("button");
  submitBtn.disabled = true;
  jobStatusEl.textContent = `Searching ${query}…`;

  try {
    const res = await fetch(API_SEARCH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? "Search failed");
    renderCards(body.results ?? []);
    stockSearchInput.value = body.symbol ?? query;
    jobStatusEl.textContent = body.actionable
      ? `${body.symbol} is actionable`
      : `${body.symbol} loaded for review`;
  } catch (err) {
    jobStatusEl.textContent = err.message;
  } finally {
    submitBtn.disabled = false;
    setTimeout(() => { jobStatusEl.textContent = ""; }, 8000);
  }
}

stockSearch.addEventListener("submit", async (event) => {
  event.preventDefault();
  await runSearch(stockSearchInput.value.trim());
});

async function loadHistory() {
  try {
    const params = new URLSearchParams();
    if (historyDate.value) params.set("date", historyDate.value);
    if (historySource.value && historySource.value !== "all") params.set("source", historySource.value);
    if (historySymbol.value.trim()) params.set("symbol", historySymbol.value.trim());
    const query = params.toString();
    const res = await fetch(query ? `${API_HISTORY}?${query}` : API_HISTORY);
    if (!res.ok) throw new Error(res.statusText);
    const rows = await res.json();
    if (!rows.length) {
      historyBody.innerHTML = `<tr><td colspan="10">No scan records yet.</td></tr>`;
      return;
    }
    historyBody.innerHTML = rows.map((row) => {
      const top = row.summary?.[0] ?? row.results?.[0] ?? {};
      const type = row.source === "search" ? "Search" : "Scan";
      return `
        <tr>
          <td>${formatScanDate(row.scannedAt)}</td>
          <td>${formatScanTime(row.scannedAt)}</td>
          <td>${type}</td>
          <td>${escapeHtml(top.symbol)}</td>
          <td>${escapeHtml(top.rating ?? top.setup ?? top.tradePlan?.setup)}</td>
          <td>${escapeHtml(top.potentialScore ?? top.composite)}</td>
          <td>${formatPrice(top.livePrice ?? top.tradePlan?.livePrice)}</td>
          <td>${formatPrice(top.entry ?? top.tradePlan?.entry?.trigger)}</td>
          <td>${formatPrice(top.target1 ?? top.tradePlan?.target1)}</td>
          <td>${row.resultCount ?? 0}/${row.scannedCount ?? "—"}</td>
        </tr>
      `;
    }).join("");
  } catch (_) {
    historyBody.innerHTML = `<tr><td colspan="10">History unavailable.</td></tr>`;
  }
}

function renderToday(data) {
  const best = data.bestPick;
  todayBestSymbol.textContent = best?.symbol ?? "—";
  todayBestMeta.textContent = best
    ? `${best.rating ?? best.setup ?? "WATCH"} · Score ${best.potentialScore ?? best.composite ?? "—"} · Entry ${formatCompactPrice(best.entry ?? best.tradePlan?.entry?.trigger)} · Target ${formatCompactPrice(best.target1 ?? best.tradePlan?.target1)}`
    : "Waiting for scan/search history";
  todayActivity.textContent = `${data.scanCount ?? 0} / ${data.searchCount ?? 0}`;
  smartCount.textContent = data.smartLookups?.length ?? 0;

  const picks = data.picks ?? [];
  todayPicks.innerHTML = picks.length
    ? picks.map((pick) => `
        <button class="pick-row" type="button" data-symbol="${escapeHtml(pick.symbol)}">
          <span>
            <strong>${escapeHtml(pick.symbol)}</strong>
            <small>${escapeHtml(pick.rating ?? pick.setup ?? "WATCH")} · Entry ${formatCompactPrice(pick.entry)} · Target ${formatCompactPrice(pick.target1)}</small>
          </span>
          <b>${escapeHtml(pick.potentialScore ?? pick.composite ?? "—")}</b>
        </button>
      `).join("")
    : `<button class="pick-row" type="button" disabled>No picks yet</button>`;

  const lookups = data.smartLookups ?? [];
  smartLookups.innerHTML = lookups.length
    ? lookups.map((item) => `
        <button class="lookup-chip" type="button" data-symbol="${escapeHtml(item.symbol)}">
          <strong>${escapeHtml(item.symbol)}</strong>
          <span>${escapeHtml(item.rating ?? "WATCH")} ${escapeHtml(item.potentialScore ?? "—")}</span>
        </button>
      `).join("")
    : `<button class="lookup-chip" type="button" disabled>No smart lookups yet</button>`;
}

async function loadToday() {
  try {
    const res = await fetch(API_TODAY);
    if (!res.ok) throw new Error(res.statusText);
    renderToday(await res.json());
    todayLoaded = true;
  } catch (_) {
    todayBestMeta.textContent = "Decision desk unavailable";
  }
}

btnToday.addEventListener("click", loadToday);
viewTabs.forEach((tab) => {
  tab.addEventListener("click", () => activateTab(tab.dataset.tab));
});

todayPicks.addEventListener("click", (event) => {
  const button = event.target.closest("[data-symbol]");
  if (button) runSearch(button.dataset.symbol);
});

smartLookups.addEventListener("click", (event) => {
  const button = event.target.closest("[data-symbol]");
  if (button) runSearch(button.dataset.symbol);
});

historyFilters.addEventListener("submit", (event) => {
  event.preventDefault();
  loadHistory();
});

btnHistoryClear.addEventListener("click", () => {
  historyDate.value = "";
  historySource.value = "all";
  historySymbol.value = "";
  loadHistory();
});

// ── Init ──────────────────────────────────────────────────────────────────
openWebSocket();
loadHistory();
