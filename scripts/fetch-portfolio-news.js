#!/usr/bin/env node
// Fetches Google News RSS for each tracked holding + general market news,
// writes portfolio-tracker/news.json. No npm dependencies — Node 18+ only.
const fs = require('fs');
const path = require('path');

const SOURCES_PATH = path.join(__dirname, '..', 'portfolio-tracker', 'news-sources.json');
const OUTPUT_PATH = path.join(__dirname, '..', 'portfolio-tracker', 'news.json');
const MARKET_QUERY = '(stock market OR financial markets OR economy)';
const HOLDING_ITEMS_LIMIT = 6;
const MARKET_ITEMS_LIMIT = 10;
const FETCH_TIMEOUT_MS = 15000;

function decodeEntities(str) {
  return String(str || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/<[^>]+>/g, '')
    .trim();
}

function extractTag(block, tag) {
  const match = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i').exec(block);
  return match ? decodeEntities(match[1]) : '';
}

function parseRssItems(xml) {
  const items = [];
  const itemBlocks = xml.match(/<item>([\s\S]*?)<\/item>/g) || [];
  for (const block of itemBlocks) {
    const title = extractTag(block, 'title');
    const link = extractTag(block, 'link');
    const pubDate = extractTag(block, 'pubDate');
    const source = extractTag(block, 'source');
    if (!title || !link) continue;
    const cleanTitle = source && title.endsWith(' - ' + source)
      ? title.slice(0, -(' - ' + source).length)
      : title;
    items.push({ title: cleanTitle, link, source, pubDate });
  }
  return items;
}

function dedupe(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = item.title.toLowerCase().trim();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

async function fetchRss(query) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PortfolioTrackerNewsBot/1.0)' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const xml = await res.text();
    const items = dedupe(parseRssItems(xml));
    items.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
    return items;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchForSource(entry, limit) {
  try {
    const items = await fetchRss(`${entry.query} when:2d`);
    return items.slice(0, limit);
  } catch (error) {
    console.warn(`[warn] news fetch failed for "${entry.name || entry.query}": ${error.message}`);
    return [];
  }
}

async function main() {
  const sources = JSON.parse(fs.readFileSync(SOURCES_PATH, 'utf8'));
  const holdings = {};
  for (const entry of sources) {
    holdings[entry.id] = await fetchForSource(entry, HOLDING_ITEMS_LIMIT);
  }
  const market = await fetchForSource({ name: 'market', query: MARKET_QUERY }, MARKET_ITEMS_LIMIT);
  const payload = { generatedAt: new Date().toISOString(), market, holdings };
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(payload, null, 2) + '\n');
  console.log(`Wrote ${OUTPUT_PATH}: market=${market.length}, holdings=${Object.entries(holdings).map(([id, items]) => `${id}:${items.length}`).join(', ')}`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
