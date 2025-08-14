// server.js
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");

const app = express();
app.use(cors());
app.use(express.static("public"));

const {
  NEWS_API_KEY,
  CURRENT_API_KEY,
  EODHD_KEY,
  FMP_KEY,
  QUANDL_KEY,
  STOCKDATA_KEY,
  ALPHAV_KEY,
  TWELVEDATA_KEY,
  PORT
} = process.env;

const port = Number(PORT || 3000);
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const safeNum = v => (v == null || v === "" || Number.isNaN(+v) ? null : +v);

async function j(url, opts = {}) {
  const res = await fetch(url, { timeout: 20000, ...opts });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} on ${url} :: ${text.slice(0,120)}`);
  }
  return res.json();
}

/* -------------------- NEWS (NewsAPI → Currents) -------------------- */
async function getNews() {
  try {
    const url = `https://newsapi.org/v2/top-headlines?language=en&pageSize=25&apiKey=${NEWS_API_KEY}`;
    const d = await j(url);
    const items = (d.articles || []).map(a => ({
      title: a.title,
      source: a.source?.name || "",
      url: a.url,
      time: a.publishedAt
    }));
    if (items.length) return { src: "NewsAPI", items };
  } catch (_) {}
  try {
    const url = `https://api.currentsapi.services/v1/latest-news?apiKey=${CURRENT_API_KEY}&language=en`;
    const d = await j(url);
    const items = (d.news || []).map(n => ({
      title: n.title,
      source: n.author || "",
      url: n.url,
      time: n.published
    }));
    return { src: "Currents", items };
  } catch (e) {
    return { src: "news_error", items: [], error: e.message };
  }
}

/* -------------------- ECON CALENDAR (FMP → EODHD) -------------------- */
async function getCalendar() {
  const from = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
  const to   = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
  try {
    const url = `https://financialmodelingprep.com/api/v3/economic_calendar?from=${from}&to=${to}&apikey=${FMP_KEY}`;
    const arr = await j(url);
    const items = (Array.isArray(arr) ? arr : []).map(e => ({
      title: e.event || e.name || e.title || "Event",
      country: e.country || "Global",
      actual: e.actual ?? null,
      forecast: e.forecast ?? null,
      previous: e.previous ?? null,
      time: e.date
    }));
    if (items.length) return { src: "FMP", items };
  } catch (_) {}
  try {
    const url = `https://eodhd.com/api/economic-events?from=${from}&to=${to}&api_token=${EODHD_KEY}&fmt=json`;
    const arr = await j(url);
    const items = (Array.isArray(arr) ? arr : []).map(e => ({
      title: e.event || e.title || "Event",
      country: e.country || "Global",
      actual: e.actual ?? null,
      forecast: e.forecast ?? null,
      previous: e.previous ?? null,
      time: e.date || e.datetime
    }));
    return { src: "EODHD", items };
  } catch (e) {
    return { src: "calendar_error", items: [], error: e.message };
  }
}

/* -------------------- COT (Quandl) -------------------- */
const COT_MAP = {
  gold: "CFTC/088691_FO_L_ALL", // CME Gold futures-only
  ndx:  "CFTC/20974_FO_L_ALL"   // Nasdaq-100 futures-only
};
const pickIdx = (cols, rx) => cols.findIndex(c => rx.test(c));
const colNum = (row, i) => (i >= 0 ? Number(row[i]) : null);

function cotBias(deltaNet, longDelta, shortDelta) {
  // blend delta net and relative long/short changes
  return clamp(
    0.7 * Math.tanh((deltaNet || 0) / 8000) +
    0.3 * Math.tanh(((longDelta || 0) - (shortDelta || 0)) / 8000),
    -1, 1
  );
}
function cotSentimentLabel(x) {
  if (x > 0.25) return "Bullish";
  if (x < -0.25) return "Bearish";
  return "Neutral";
}

async function getCot(market) {
  try {
    const code = COT_MAP[market];
    const url = `https://www.quandl.com/api/v3/datasets/${code}.json?api_key=${QUANDL_KEY}`;
    const d = await j(url);
    const cols = d.dataset.column_names || [];
    const rows = d.dataset.data || [];
    const [latest, prev] = [rows[0], rows[1] || rows[0]];

    const idx = {
      ncL: pickIdx(cols, /Noncommercial.*Long/i),
      ncS: pickIdx(cols, /Noncommercial.*Short/i),
      cL:  pickIdx(cols, /Commercial.*Long/i),
      cS:  pickIdx(cols, /Commercial.*Short/i),
      oi:  pickIdx(cols, /Open Interest.*All/i)
    };

    const levels = {
      nonCommercial: { long: colNum(latest, idx.ncL), short: colNum(latest, idx.ncS) },
      commercial:    { long: colNum(latest, idx.cL),  short: colNum(latest, idx.cS)  },
      openInterestAll: colNum(latest, idx.oi)
    };

    const weeklyDelta = {
      nonCommercial: {
        long:  (colNum(latest, idx.ncL) ?? 0) - (colNum(prev, idx.ncL) ?? 0),
        short: (colNum(latest, idx.ncS) ?? 0) - (colNum(prev, idx.ncS) ?? 0)
      },
      commercial: {
        long:  (colNum(latest, idx.cL) ?? 0) - (colNum(prev, idx.cL) ?? 0),
        short: (colNum(latest, idx.cS) ?? 0) - (colNum(prev, idx.cS) ?? 0)
      },
      openInterestAll: (colNum(latest, idx.oi) ?? 0) - (colNum(prev, idx.oi) ?? 0)
    };

    const ncNet     = (levels.nonCommercial.long || 0) - (levels.nonCommercial.short || 0);
    const ncNetPrev = ((colNum(prev, idx.ncL) || 0) - (colNum(prev, idx.ncS) || 0));
    const ncNetDelta = ncNet - ncNetPrev;

    const score = cotBias(ncNetDelta, weeklyDelta.nonCommercial.long, weeklyDelta.nonCommercial.short);

    return {
      market: market.toUpperCase(),
      date: latest[0],
      levels, weeklyDelta,
      derived: { nonCommercialNet: ncNet, nonCommercialNetDelta: ncNetDelta },
      sentiment: cotSentimentLabel(score),
      biasScore: score
    };
  } catch (e) {
    return { market: market.toUpperCase(), error: e.message, biasScore: 0 };
  }
}

/* -------------------- OPTIONS FLOW (FMP) -------------------- */
async function getOptionsFlow(symbol) {
  // Try unusual → fallback chain
  const tryUrls = [
    `https://financialmodelingprep.com/api/v4/unusual_options_activity?symbol=${symbol}&apikey=${FMP_KEY}`,
    `https://financialmodelingprep.com/api/v3/unusual-options-activity/${symbol}?apikey=${FMP_KEY}`
  ];
  for (const url of tryUrls) {
    try {
      const d = await j(url);
      const arr = Array.isArray(d) ? d : (Array.isArray(d?.data) ? d.data : []);
      if (!arr.length) continue;
      const getType = o => (o.optionType || o.type || o.side || "").toUpperCase();
      const calls = arr.filter(x => getType(x).startsWith("CALL"));
      const puts  = arr.filter(x => getType(x).startsWith("PUT"));
      const sum = (xs, f) => xs.reduce((s, o) => s + Number(o[f] ?? o.volume ?? 0), 0);
      const callVol = sum(calls, "volume");
      const putVol  = sum(puts,  "volume");
      const callIn  = sum(calls, "askPremium") || sum(calls, "premium");
      const putIn   = sum(puts,  "askPremium") || sum(puts,  "premium");
      const total   = callVol + putVol;
      const bias    = total ? clamp(Math.tanh(((callVol/total)-0.5)*4), -1, 1) : 0;
      return { src: "FMP Unusual", calls: callVol, puts: putVol, callInflow: callIn||null, putInflow: putIn||null, biasScore: bias };
    } catch (_) {}
  }
  try {
    const today = new Date().toISOString().slice(0,10);
    const url = `https://financialmodelingprep.com/api/v3/options-chain/${symbol}?date=${today}&apikey=${FMP_KEY}`;
    const d = await j(url);
    const arr = Array.isArray(d) ? d : (Array.isArray(d?.data) ? d.data : []);
    const getType = o => (o.side || o.optionType || o.type || "").toUpperCase();
    const calls = arr.filter(x => getType(x).startsWith("CALL"));
    const puts  = arr.filter(x => getType(x).startsWith("PUT"));
    const sum = (xs, f) => xs.reduce((s, o) => s + Number(o[f] || 0), 0);
    const callVol = sum(calls, "volume");
    const putVol  = sum(puts,  "volume");
    const total   = callVol + putVol;
    const bias    = total ? clamp(Math.tanh(((callVol/total)-0.5)*4), -1, 1) : 0;
    return { src: "FMP Chain", calls: callVol, puts: putVol, biasScore: bias };
  } catch (e) {
    return { src: "options_error", calls: 0, puts: 0, biasScore: 0, error: e.message };
  }
}

/* -------------------- BREADTH (QQQ) -------------------- */
async function getBreadthQQQ() {
  // holdings from FMP → quotes from StockData.org
  let holdings = [];
  try {
    const urlHold = `https://financialmodelingprep.com/api/v3/etf-holdings/QQQ?apikey=${FMP_KEY}`;
    const h = await j(urlHold);
    if (Array.isArray(h?.holdings) && h.holdings.length) {
      holdings = h.holdings.map(x => x.asset || x.symbol).filter(Boolean);
    }
  } catch (_) {}
  if (!holdings.length) {
    holdings = ["AAPL","MSFT","NVDA","AMZN","META","GOOGL","AVGO","COST","NFLX","PEP",
                "AMD","ADBE","INTC","QCOM","CSCO","TSLA","TXN","AMAT","REGN","VRTX"];
  }
  const chunk = (arr, n) =>
    arr.reduce((acc,_,i)=> (i%n? acc[acc.length-1].push(arr[i]) : acc.push([arr[i]]), acc), []);
  const chunks = chunk(holdings, 40);
  let quotes = [];
  for (const c of chunks) {
    try {
      const url = `https://api.stockdata.org/v1/data/quote?symbols=${encodeURIComponent(c.join(","))}&api_token=${STOCKDATA_KEY}`;
      const d = await j(url);
      quotes = quotes.concat(d.data || []);
    } catch (_) {}
  }
  const cleaned = quotes.map(q => ({
    symbol: q.ticker || q.symbol,
    changePct: safeNum(q.day_change_percent ?? q.change_percent ?? q.dp) ?? 0
  }));
  const adv  = cleaned.filter(x => x.changePct > 0).length;
  const dec  = cleaned.filter(x => x.changePct < 0).length;
  const unch = cleaned.length - adv - dec;
  const avg  = cleaned.length ? cleaned.reduce((s,x)=> s + x.changePct, 0)/cleaned.length : 0;

  const breadth = adv - dec;
  const biasScore = clamp(0.7*Math.tanh(breadth/30) + 0.3*Math.tanh((avg||0)/1.5), -1, 1);

  return { src: "FMP+StockData", count: cleaned.length, adv, dec, unch, avgChangePct: avg, sample: cleaned.slice(0,8), biasScore };
}

/* -------------------- Macro Overlay Inputs (DXY, VIX, US10Y) -------------------- */
async function getDXY() {
  // TwelveData should serve "DXY" (time_series/latest)
  try {
    const url = `https://api.twelvedata.com/time_series?symbol=DXY&interval=1min&outputsize=1&apikey=${TWELVEDATA_KEY}`;
    const d = await j(url);
    const last = d?.values?.[0];
    const changePct = safeNum(d?.meta?.change_percent) ?? null; // sometimes present
    return { src: "TwelveData", value: last?.close ? Number(last.close) : null, changePct };
  } catch (e) {
    return { src: "DXY_error", error: e.message };
  }
}

async function getVIX() {
  try {
    const url = `https://financialmodelingprep.com/api/v3/quote/%5EVIX?apikey=${FMP_KEY}`;
    const d = await j(url);
    const q = Array.isArray(d) ? d[0] : null;
    return { src: "FMP", value: q?.price ?? q?.c ?? null, changePct: q?.changesPercentage ?? null };
  } catch (e) {
    return { src: "VIX_error", error: e.message };
  }
}

async function getUS10Y() {
  try {
    const url = `https://www.alphavantage.co/query?function=TREASURY_YIELD&interval=daily&maturity=10year&apikey=${ALPHAV_KEY}`;
    const d = await j(url);
    const arr = d?.data || d?.data_points || d?.Data || [];
    const last = Array.isArray(arr) ? arr[0] : null;
    const value = last ? safeNum(last.value) : null;
    return { src: "AlphaVantage", value };
  } catch (e) {
    return { src: "US10Y_error", error: e.message };
  }
}

/* Macro Overlay → turn (DXY, US10Y, VIX) into a [-1,1] score for each asset */
function macroOverlayForGold({ dxy, us10y, vix }) {
  // Gold likes: DXY ↓ (pos), US10Y ↓ (pos), VIX ↑ (mild pos/hedge)
  const sDxy  = dxy?.changePct != null ? -Math.tanh((dxy.changePct)/0.5) : 0;    // down USD helps
  const sYld  = us10y?.value != null ? -Math.tanh(((us10y.value - 4.0)/0.8)) : 0; // lower yield helps
  const sVix  = vix?.changePct != null ? Math.tanh((vix.changePct)/5) * 0.3 : 0;  // small weight
  const score = clamp(0.5*sDxy + 0.4*sYld + 0.1*sVix, -1, 1);
  return { score, parts: { sDxy, sYld, sVix } };
}
function macroOverlayForNDX({ dxy, us10y, vix }) {
  // NDX likes: DXY ↓ (slightly pos for multinationals), US10Y ↓ (risk-on), VIX ↓ (risk-on)
  const sDxy  = dxy?.changePct != null ? Math.tanh((-dxy.changePct)/0.6) * 0.2 : 0;
  const sYld  = us10y?.value != null ? Math.tanh((4.2 - us10y.value)/0.7) * 0.6 : 0;
  const sVix  = vix?.changePct != null ? Math.tanh((-vix.changePct)/5) * 0.2 : 0;
  const score = clamp(sDxy + sYld + sVix, -1, 1);
  return { score, parts: { sDxy, sYld, sVix } };
}

/* -------------------- ONE MERGED ENDPOINT -------------------- */
app.get("/api/data", async (_req, res) => {
  const t0 = Date.now();
  const settled = await Promise.allSettled([
    getNews(),
    getCalendar(),
    getCot("gold"),
    getCot("ndx"),
    getOptionsFlow("GLD"),
    getOptionsFlow("QQQ"),
    getBreadthQQQ(),
    getDXY(),
    getUS10Y(),
    getVIX()
  ]);
  const val = i => (settled[i].status === "fulfilled" ? settled[i].value : { error: settled[i].reason?.message || "failed" });

  const news = val(0);
  const calendar = val(1);
  const cotGold = val(2);
  const cotNdx  = val(3);
  const optGLD  = val(4);
  const optQQQ  = val(5);
  const breadth = val(6);
  const dxy     = val(7);
  const us10y   = val(8);
  const vix     = val(9);

  const macroGold = macroOverlayForGold({ dxy, us10y, vix });
  const macroNdx  = macroOverlayForNDX({ dxy, us10y, vix });

  // Final composite scores
  const goldScore = clamp(0.55*(cotGold.biasScore||0) + 0.30*(optGLD.biasScore||0) + 0.15*(macroGold.score||0), -1, 1);
  const ndxScore  = clamp(0.25*(cotNdx.biasScore||0)  + 0.35*(optQQQ.biasScore||0) + 0.25*(breadth.biasScore||0) + 0.15*(macroNdx.score||0), -1, 1);

  res.json({
    updatedAt: new Date().toISOString(),
    latencyMs: Date.now() - t0,
    macroInputs: { dxy, us10y, vix },
    gold: { cot: cotGold, options: optGLD, macro: macroGold, score: goldScore },
    ndx:  { cot: cotNdx,  options: optQQQ, breadth, macro: macroNdx, score: ndxScore },
    calendar,
    news
  });
});

app.listen(port, () => console.log(`✅ Server running on http://localhost:${port}`));
