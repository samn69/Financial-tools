#!/usr/bin/env node
// Fetches the next and the last earnings date of each holding in news-sources.json that has an
// "earnings" symbol (companies only; funds have no earnings) and writes
// portfolio-tracker/events.json (#203). No npm dependencies, Node 18+ only.
// Source: Finnhub's earnings calendar (free plan, 60 calls a minute). The key comes from the
// FINNHUB_KEY environment variable (a GitHub Actions secret); without it the job does nothing.
// When no upcoming date is published yet, the next one is guessed a quarter after the last
// report and marked "approx". The last report date seen is remembered across runs (#209).
// A symbol that fails keeps its previous values.
const fs = require('fs');
const path = require('path');

const SOURCES_PATH = path.join(__dirname, '..', 'portfolio-tracker', 'news-sources.json');
const OUTPUT_PATH = path.join(__dirname, '..', 'portfolio-tracker', 'events.json');
const FETCH_TIMEOUT_MS = 15000;
const QUARTER_DAYS = 91;
const LOOK_BACK_DAYS = 130; // far enough to always include the last quarterly report
const LOOK_AHEAD_DAYS = 120;

const pad = (n) => String(n).padStart(2, '0');
const isoDay = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const addDays = (day, n) => { const d = new Date(`${day}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return isoDay(d); };

async function getJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// Finnhub's "hour": bmo = before market open, amc = after market close
const HOURS = { bmo: 'before open', amc: 'after close' };

// Picks the last report (before today) and the next one (today or later) from calendar rows.
function pickDates(rows, today) {
  const days = rows.filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date || '')).sort((a, b) => a.date.localeCompare(b.date));
  const out = {};
  const last = days.filter((r) => r.date < today).at(-1);
  const next = days.find((r) => r.date >= today);
  if (last) out.last = last.date;
  if (next) {
    out.next = next.date;
    if (HOURS[next.hour]) out.time = HOURS[next.hour];
  } else if (out.last && addDays(out.last, QUARTER_DAYS) >= today) {
    out.next = addDays(out.last, QUARTER_DAYS);
    out.approx = true; // only "around": a quarter after the last report
  }
  return out;
}

// Finnhub's free plan lists only about a month of past reports (#209), so the last report date
// seen before is kept: the newest of Finnhub's last report, the stored one, and a stored next
// date that has passed (unless it was only a guess).
function rememberLast(fresh, prev, today) {
  const known = [fresh.last, prev?.last];
  if (prev?.next && !prev.approx && prev.next < today) known.push(prev.next);
  const last = known.filter(Boolean).sort().at(-1);
  return last ? { ...fresh, last } : fresh;
}

async function fetchEarnings(symbol, today, key) {
  const from = addDays(today, -LOOK_BACK_DAYS), to = addDays(today, LOOK_AHEAD_DAYS);
  const url = `https://finnhub.io/api/v1/calendar/earnings?symbol=${encodeURIComponent(symbol)}&from=${from}&to=${to}&token=${encodeURIComponent(key)}`;
  const json = await getJson(url);
  return { symbol, ...pickDates(json.earningsCalendar || [], today) };
}

async function main() {
  const key = process.env.FINNHUB_KEY;
  if (!key) {
    console.log('FINNHUB_KEY is not set; skipping earnings dates.');
    return;
  }
  const sources = JSON.parse(fs.readFileSync(SOURCES_PATH, 'utf8')).filter((s) => s.earnings);
  let previous = {};
  try { previous = JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf8')).holdings || {}; } catch (e) { /* first run */ }
  const today = isoDay(new Date());
  const holdings = {};
  let ok = 0;
  for (const s of sources) {
    try {
      holdings[s.id] = rememberLast(await fetchEarnings(s.earnings, today, key), previous[s.id], today);
      ok++;
      const h = holdings[s.id];
      console.log(`${s.id}: next ${h.next || '—'}${h.approx ? ' (approx)' : ''}, last ${h.last || '—'}`);
    } catch (e) {
      console.warn(`${s.id}: ${e.message}, keeping previous`);
      if (previous[s.id]) holdings[s.id] = previous[s.id];
    }
  }
  if (!ok && sources.length) {
    console.error('No earnings dates fetched; leaving events.json unchanged.');
    process.exitCode = 1;
    return;
  }
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify({ generatedAt: new Date().toISOString(), holdings }, null, 2) + '\n');
  console.log(`Wrote ${OUTPUT_PATH} (${ok}/${sources.length} fetched)`);
}

if (require.main === module) main();
module.exports = { pickDates, rememberLast };
