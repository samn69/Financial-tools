#!/usr/bin/env node
// Fetches Google News RSS for each tracked holding + general market news,
// writes portfolio-tracker/news.json. No npm dependencies — Node 18+ only.
// Stock-market news only (#194): searches go to finance sources, companies are searched as a
// stock and funds by what they hold (news-sources.json "query"), and a headline is kept only if
// it names the stock or topic (one of its "match" words).
const fs = require('fs');
const path = require('path');

const SOURCES_PATH = path.join(__dirname, '..', 'portfolio-tracker', 'news-sources.json');
const OUTPUT_PATH = path.join(__dirname, '..', 'portfolio-tracker', 'news.json');
const MARKET_QUERY = '("stock market" OR stocks OR "Wall Street" OR "global markets")';
const MARKET_MATCH = ['stock', 'stocks', 'market', 'markets', 'Wall Street', 'S&P', 'Nasdaq', 'Dow', 'shares', 'index', 'indices', 'equities', 'Fed', 'rates', 'bond', 'yields'];
const FINANCE_SITES = ['reuters.com', 'cnbc.com', 'marketwatch.com', 'finance.yahoo.com', 'bloomberg.com',
  'wsj.com', 'ft.com', 'barrons.com', 'fool.com', 'investing.com', 'morningstar.com', 'seekingalpha.com',
  'thestreet.com', 'businessinsider.com', 'kitco.com', 'coindesk.com', 'etf.com', 'zacks.com'];
const SITE_FILTER = '(' + FINANCE_SITES.map(site => `site:${site}`).join(' OR ') + ')';
const RECENT = 'when:7d';
const HOLDING_ITEMS_LIMIT = 3;
const MARKET_ITEMS_LIMIT = 8;

// Quote pages, data pages and fund-filing notices that Google News lists as articles.
const NOT_NEWS = /\b(stock )?quotes?\b|price, news|charts?, data and news|stock forecasts?\b|in real time|\bETF overview\b|net asset value|seasonal returns|technical data|price data|latest stock news|news and headlines|\b(sells|buys) \$[\d.,]+ (thousand|million|billion) of\b/i;

// True when the headline names one of the words, as a whole word (so "LULU" doesn't match "lulled").
function mentions(title, words) {
  return words.some(word => new RegExp(`(^|[^A-Za-z0-9])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^A-Za-z0-9]|$)`, 'i').test(title));
}
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
    const items = await fetchRss(`(${entry.query}) ${SITE_FILTER} ${RECENT}`);
    return items.filter(item => mentions(item.title, entry.match) && !NOT_NEWS.test(item.title)).slice(0, limit);
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
  const market = await fetchForSource({ name: 'market', query: MARKET_QUERY, match: MARKET_MATCH }, MARKET_ITEMS_LIMIT);
  const payload = { generatedAt: new Date().toISOString(), market, holdings };
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(payload, null, 2) + '\n');
  console.log(`Wrote ${OUTPUT_PATH}: market=${market.length}, holdings=${Object.entries(holdings).map(([id, items]) => `${id}:${items.length}`).join(', ')}`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
