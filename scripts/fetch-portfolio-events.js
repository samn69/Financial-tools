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
  if (last) {
    out.last = last.date;
    if (HOURS[last.hour]) out.lastTime = HOURS[last.hour];
    // the analysts' EPS forecast and the actual result (#232)
    if (typeof last.epsActual === 'number' && typeof last.epsEstimate === 'number') {
      out.lastEps = { date: last.date, actual: last.epsActual, estimate: last.epsEstimate };
    }
  }
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
  const known = [
    { date: fresh.last, time: fresh.lastTime },
    { date: prev?.last, time: prev?.lastTime },
  ];
  if (prev?.next && !prev.approx && prev.next < today) known.push({ date: prev.next, time: prev.time });
  const dated = known.filter((k) => k.date);
  if (!dated.length) return fresh;
  const last = dated.map((k) => k.date).sort().at(-1);
  const time = dated.find((k) => k.date === last && k.time)?.time;
  const out = { ...fresh, last };
  if (time) out.lastTime = time; else delete out.lastTime;
  // the forecast and result of that report, once seen (#232)
  const eps = [fresh.lastEps, prev?.lastEps].find((e) => e?.date === last);
  if (eps) out.lastEps = eps; else delete out.lastEps;
  return out;
}

// The share price move around a report (#212), from daily closes {day: close}:
//   before open: close before the report day → close on it
//   after close: close on the report day → close on the next trading day
//   time unknown: close before the report day → close after it
// Only closes from before today count, so a day still trading never fixes the result.
function reactionFrom(closes, report, time, today) {
  const days = Object.keys(closes).filter((d) => d < today).sort();
  const beforeDay = days.filter((d) => (time === 'after close' ? d <= report : d < report)).at(-1);
  const afterDay = days.find((d) => (time === 'before open' ? d >= report : d > report));
  if (!beforeDay || !afterDay) return null;
  return { date: report, move: Number(((closes[afterDay] / closes[beforeDay] - 1) * 100).toFixed(2)), from: beforeDay, to: afterDay };
}

// Daily closes of a US listing from Yahoo's chart endpoint (the same one the price job uses).
async function fetchCloses(symbol, aroundDay) {
  const t = (day) => Math.floor(new Date(`${day}T00:00:00Z`).getTime() / 1000);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${t(addDays(aroundDay, -10))}&period2=${t(addDays(aroundDay, 10))}&interval=1d`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PortfolioTrackerPriceBot/1.0)' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const result = (await res.json()).chart?.result?.[0];
    if (!result) throw new Error('no chart data');
    const offset = result.meta?.gmtoffset || 0;
    const closes = {};
    const quote = result.indicators?.quote?.[0]?.close || [];
    (result.timestamp || []).forEach((ts, i) => {
      if (typeof quote[i] === 'number') closes[new Date((ts + offset) * 1000).toISOString().slice(0, 10)] = quote[i];
    });
    return closes;
  } finally {
    clearTimeout(timer);
  }
}

// Keeps a reaction once worked out for the same report; otherwise tries to work it out.
async function addReaction(h, prev, today) {
  if (!h.last) return h;
  if (prev?.reaction?.date === h.last) return { ...h, reaction: prev.reaction };
  try {
    const reaction = reactionFrom(await fetchCloses(h.symbol, h.last), h.last, h.lastTime, today);
    return reaction ? { ...h, reaction } : h;
  } catch (e) {
    console.warn(`${h.symbol}: no price reaction (${e.message})`);
    return h;
  }
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
      holdings[s.id] = await addReaction(rememberLast(await fetchEarnings(s.earnings, today, key), previous[s.id], today), previous[s.id], today);
      ok++;
      const h = holdings[s.id];
      console.log(`${s.id}: next ${h.next || '—'}${h.approx ? ' (approx)' : ''}, last ${h.last || '—'}${h.reaction ? ` (price ${h.reaction.move}% after it)` : ''}`);
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
module.exports = { pickDates, rememberLast, reactionFrom, fetchCloses, addReaction };
