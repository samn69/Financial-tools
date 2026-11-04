#!/usr/bin/env node
// Fetches the latest price and month-end closes, in EUR, for each holding in news-sources.json
// that has a "price" symbol, and writes portfolio-tracker/prices.json. No npm dependencies,
// Node 18+ only. Source: Yahoo Finance's public chart endpoint (no key, but unofficial), so a
// symbol that fails keeps its previous values instead of disappearing.
const fs = require('fs');
const path = require('path');

const SOURCES_PATH = path.join(__dirname, '..', 'portfolio-tracker', 'news-sources.json');
const OUTPUT_PATH = path.join(__dirname, '..', 'portfolio-tracker', 'prices.json');
const RANGE = '6mo';
const FETCH_TIMEOUT_MS = 15000;
const EURUSD = 'EURUSD=X'; // USD per EUR

const round = (n) => Number(n.toFixed(4));

async function fetchChart(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${RANGE}&interval=1d`;
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
    return {
      currency: meta.currency,
      price: meta.regularMarketPrice,
      priceAt: new Date(meta.regularMarketTime * 1000).toISOString(),
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
  return { ...chart, currency: 'EUR', price: chart.price / fx.price, monthEnd };
}

async function main() {
  const sources = JSON.parse(fs.readFileSync(SOURCES_PATH, 'utf8')).filter((s) => s.price);
  let previous = {};
  try { previous = JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf8')).holdings || {}; } catch {}

  let fx = null;
  try { fx = await fetchChart(EURUSD); } catch (error) { console.warn(`[warn] ${EURUSD}: ${error.message}`); }

  const holdings = {};
  let fresh = 0;
  for (const entry of sources) {
    try {
      const chart = toEur(await fetchChart(entry.price), fx);
      holdings[entry.id] = {
        symbol: entry.price,
        price: round(chart.price),
        priceAt: chart.priceAt,
        monthEnd: Object.fromEntries(Object.entries(chart.monthEnd).map(([m, v]) => [m, round(v)])),
      };
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
  const payload = { generatedAt: new Date().toISOString(), currency: 'EUR', holdings };
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(payload, null, 2) + '\n');
  console.log(`Wrote ${OUTPUT_PATH}: ${fresh}/${sources.length} fresh`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
