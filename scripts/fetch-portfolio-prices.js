#!/usr/bin/env node
// Fetches the latest price and month-end closes, in EUR, for each holding in news-sources.json
// that has a "price" symbol, plus the market benchmark the chart compares with (#158), and
// writes portfolio-tracker/prices.json. No npm dependencies,
// Node 18+ only. Source: Yahoo Finance's public chart endpoint (no key, but unofficial), so a
// symbol that fails keeps its previous values instead of disappearing.
const fs = require('fs');
const path = require('path');

const SOURCES_PATH = path.join(__dirname, '..', 'portfolio-tracker', 'news-sources.json');
const OUTPUT_PATH = path.join(__dirname, '..', 'portfolio-tracker', 'prices.json');
// Long enough for every month the app holds; the chart's "vs Market" view needs all of them.
const RANGE = '5y';
const FETCH_TIMEOUT_MS = 15000;
const EURUSD = 'EURUSD=X'; // USD per EUR
// MSCI World, measured with iShares Core MSCI World (Xetra, EUR).
const BENCHMARK = { id: 'msci_world', name: 'MSCI World', symbol: 'EUNL.DE' };

const round = (n) => Number(n.toFixed(4));

// Dividends paid in the last 12 months (#222), from the chart's dividend events: the yield is
// their total over the current price (both in the listing's currency). null when none were paid.
const DIVIDEND_WINDOW_S = 365 * 24 * 60 * 60;
function dividendsOf(result, price) {
  const since = Date.now() / 1000 - DIVIDEND_WINDOW_S;
  const paid = Object.values(result.events?.dividends || {})
    .filter((d) => typeof d?.amount === 'number' && d.date >= since)
    .sort((a, b) => a.date - b.date);
  if (!paid.length || !price) return null;
  const total = paid.reduce((sum, d) => sum + d.amount, 0);
  return {
    yield: Number(((total / price) * 100).toFixed(2)),
    count: paid.length,
    last: new Date(paid.at(-1).date * 1000).toISOString().slice(0, 10),
  };
}

async function fetchChart(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${RANGE}&interval=1d&events=div`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PortfolioTrackerPriceBot/1.0)' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const result = json.chart?.result?.[0];
    if (!result) throw new Error(json.chart?.error?.description || 'no data');
    const { meta } = result;
    if (typeof meta.regularMarketPrice !== 'number') throw new Error('no current price');
    const offset = meta.gmtoffset || 0;
    const monthOf = (seconds) => new Date((seconds + offset) * 1000).toISOString().slice(0, 7);
    const closes = result.indicators?.quote?.[0]?.close || [];
    const monthEnd = {};
    (result.timestamp || []).forEach((t, i) => {
      if (typeof closes[i] === 'number') monthEnd[monthOf(t)] = closes[i]; // later days overwrite: last close of the month
    });
    // The month the latest price is in hasn't ended yet, so its "last close" isn't a month-end.
    delete monthEnd[monthOf(meta.regularMarketTime)];
    // The close of the last trading day before the latest price's day, for "today's move" (#196).
    const dayOf = (seconds) => new Date((seconds + offset) * 1000).toISOString().slice(0, 10);
    const today = dayOf(meta.regularMarketTime);
    let prevClose = null;
    (result.timestamp || []).forEach((t, i) => {
      if (typeof closes[i] === 'number' && dayOf(t) < today) prevClose = closes[i];
    });
    // The last close at least a week before the latest price's day, for "past 7 days" (#223).
    const weekAgo = new Date(`${today}T00:00:00Z`);
    weekAgo.setUTCDate(weekAgo.getUTCDate() - 7);
    const weekDay = weekAgo.toISOString().slice(0, 10);
    let weekClose = null;
    (result.timestamp || []).forEach((t, i) => {
      if (typeof closes[i] === 'number' && dayOf(t) <= weekDay) weekClose = closes[i];
    });
    return {
      dividends: dividendsOf(result, meta.regularMarketPrice),
      currency: meta.currency,
      price: meta.regularMarketPrice,
      priceAt: new Date(meta.regularMarketTime * 1000).toISOString(),
      prevClose,
      weekClose,
      monthEnd,
    };
  } finally {
    clearTimeout(timer);
  }
}

function toEur(chart, fx) {
  if (chart.currency === 'EUR') return chart;
  if (chart.currency !== 'USD') throw new Error(`unsupported currency ${chart.currency}`);
  if (!fx) throw new Error('EUR/USD rate unavailable');
  const monthEnd = {};
  for (const [month, close] of Object.entries(chart.monthEnd)) {
    if (fx.monthEnd[month]) monthEnd[month] = close / fx.monthEnd[month];
  }
  const prevClose = chart.prevClose === null ? null : chart.prevClose / (fx.prevClose || fx.price);
  const weekClose = chart.weekClose === null ? null : chart.weekClose / (fx.weekClose || fx.price);
  return { ...chart, currency: 'EUR', price: chart.price / fx.price, prevClose, weekClose, monthEnd };
}

async function main() {
  const sources = JSON.parse(fs.readFileSync(SOURCES_PATH, 'utf8')).filter((s) => s.price);
  let previous = {};
  let previousBenchmark = null;
  try {
    const old = JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf8'));
    previous = old.holdings || {};
    previousBenchmark = old.benchmark || null;
  } catch {}

  let fx = null;
  try { fx = await fetchChart(EURUSD); } catch (error) { console.warn(`[warn] ${EURUSD}: ${error.message}`); }

  const entryFor = (symbol, chart) => ({
    symbol,
    price: round(chart.price),
    priceAt: chart.priceAt,
    ...(chart.dividends ? { dividends: chart.dividends } : {}),
    ...(chart.prevClose === null ? {} : { prevClose: round(chart.prevClose) }),
    ...(chart.weekClose === null ? {} : { weekClose: round(chart.weekClose) }),
    monthEnd: Object.fromEntries(Object.entries(chart.monthEnd).map(([m, v]) => [m, round(v)])),
  });
  const holdings = {};
  let fresh = 0;
  for (const entry of sources) {
    try {
      holdings[entry.id] = entryFor(entry.price, toEur(await fetchChart(entry.price), fx));
      fresh++;
    } catch (error) {
      console.warn(`[warn] price fetch failed for ${entry.id} (${entry.price}): ${error.message}`);
      if (previous[entry.id]) holdings[entry.id] = previous[entry.id];
    }
  }
  if (!fresh) {
    console.warn('[warn] no prices fetched; leaving prices.json unchanged');
    return;
  }
  let benchmark = previousBenchmark;
  try {
    benchmark = { id: BENCHMARK.id, name: BENCHMARK.name, ...entryFor(BENCHMARK.symbol, toEur(await fetchChart(BENCHMARK.symbol), fx)) };
  } catch (error) {
    console.warn(`[warn] benchmark ${BENCHMARK.symbol}: ${error.message}`);
  }
  const payload = { generatedAt: new Date().toISOString(), currency: 'EUR', holdings, ...(benchmark ? { benchmark } : {}) };
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(payload, null, 2) + '\n');
  console.log(`Wrote ${OUTPUT_PATH}: ${fresh}/${sources.length} fresh`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
