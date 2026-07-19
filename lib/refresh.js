import { getHtml } from './http.js';
import { parseSchedule, parseListings, parseMaxPage, parseEventMeta } from './parse.js';
import { readConfig, appendSnapshots, writeLatest, readHistory } from './store.js';

const TEAM_LABELS = {
  giants: '読売ジャイアンツ',
  'yakult-swallows': '東京ヤクルトスワローズ',
  baystars: '横浜DeNAベイスターズ',
  marines: '千葉ロッテマリーンズ',
  seibulions: '埼玉西武ライオンズ',
  hanshintigers: '阪神タイガース',
  dragons: '中日ドラゴンズ',
  carp: '広島東洋カープ',
  fighters: '北海道日本ハムファイターズ',
  softbankhawks: '福岡ソフトバンクホークス',
  buffaloes: 'オリックス・バファローズ',
  rakuteneagles: '東北楽天ゴールデンイーグルス',
};

const quantile = (sorted, q) => {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return lo === hi ? sorted[lo] : Math.round(sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo));
};

function summarise(listings) {
  const prices = listings.map((l) => l.price).sort((a, b) => a - b);
  if (!prices.length) {
    return { count: 0, totalQty: 0, min: null, p25: null, median: null, max: null };
  }
  return {
    count: prices.length,
    totalQty: listings.reduce((s, l) => s + (l.qty || 0), 0),
    min: prices[0],
    p25: quantile(prices, 0.25),
    median: quantile(prices, 0.5),
    max: prices[prices.length - 1],
  };
}

/** Games whose local start date falls inside [start, end] and match the regions. */
function inScope(game, { start, end, regions }) {
  if (!game.startDate) return false;
  // startDate carries a +09:00 offset, so the leading date is already JST.
  const day = game.startDate.slice(0, 10);
  if (start && day < start) return false;
  if (end && day > end) return false;
  if (regions?.length && !regions.includes(game.region)) return false;
  return true;
}

async function fetchAllListings(game, cfg, log) {
  const delayMs = cfg.requestDelayMs ?? 700;
  // Sort cheapest-first so a truncated crawl still yields an exact minimum.
  const sorted = '?sort_query%5BsortKindKey%5D=price_for_cell_asc';

  const first = await getHtml(game.path + sorted, { delayMs });
  if (!first) return { listings: [], meta: null, truncated: false };

  const meta = parseEventMeta(first, game.id);
  const listings = parseListings(first);
  const available = parseMaxPage(first, game.id);
  const limit = Math.min(available, cfg.maxPagesPerEvent ?? 3);

  for (let page = 2; page <= limit; page++) {
    const html = await getHtml(`${game.path}${sorted}&page=${page}`, { delayMs });
    if (!html) break;
    listings.push(...parseListings(html));
  }

  const truncated = available > limit;
  if (truncated) {
    log(`  ${game.id}: read ${limit}/${available} pages (price-ascending, minimum still exact)`);
  }
  return { listings, meta, truncated };
}

/**
 * Run one full refresh: rebuild the schedule, price every in-scope game,
 * append a history snapshot and write the dashboard payload.
 */
export async function refresh({ log = console.log } = {}) {
  const cfg = readConfig();
  const startedAt = new Date().toISOString();
  const delayMs = cfg.requestDelayMs ?? 700;
  const scope = { start: cfg.trip?.start, end: cfg.trip?.end, regions: cfg.regions };

  log(`refresh start ${startedAt} — window ${scope.start}..${scope.end}`);

  // 1. Schedules. Event ids are global, so the same game seen from two teams
  //    collapses onto one entry.
  const byId = new Map();
  const errors = [];
  for (const team of cfg.teams ?? []) {
    try {
      const html = await getHtml(`/tickets/${team}/battle_cards`, { delayMs });
      if (!html) continue;
      for (const g of parseSchedule(html, team)) {
        const prev = byId.get(g.id);
        if (prev) prev.teams.add(team);
        else byId.set(g.id, { ...g, teams: new Set([team]) });
      }
    } catch (err) {
      errors.push(`schedule ${team}: ${err.message}`);
      log(`  ! ${team}: ${err.message}`);
    }
  }
  log(`  schedule: ${byId.size} distinct games across ${cfg.teams?.length ?? 0} teams`);

  // 2. Price only the games inside the trip window.
  const scoped = [...byId.values()]
    .filter((g) => inScope(g, scope))
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
  log(`  in window: ${scoped.length} games`);

  const entries = [];
  for (const game of scoped) {
    try {
      const { listings, meta, truncated } = await fetchAllListings(game, cfg, log);
      const stats = summarise(listings);
      const cheapest = [...listings].sort((a, b) => a.price - b.price).slice(0, 40);

      entries.push({
        meta: {
          id: game.id,
          name: meta?.name || game.name,
          startDate: meta?.startDate || game.startDate,
          venue: meta?.venue || game.venue,
          region: meta?.region || game.region,
          url: game.url,
          teams: [...game.teams],
          teamLabels: [...game.teams].map((t) => TEAM_LABELS[t] || t),
        },
        stats,
        truncated,
        cheapest,
      });
      log(`  ${game.startDate.slice(0, 10)} ${game.name} @ ${game.venue}: ` +
        `${stats.count} listings, min ¥${stats.min?.toLocaleString() ?? '-'}`);
    } catch (err) {
      errors.push(`event ${game.id}: ${err.message}`);
      log(`  ! ${game.id}: ${err.message}`);
    }
  }

  // 3. Persist.
  const finishedAt = new Date().toISOString();
  appendSnapshots(entries, finishedAt);
  const history = readHistory();

  const payload = {
    generatedAt: finishedAt,
    startedAt,
    trip: cfg.trip,
    regions: cfg.regions,
    refreshMinutes: cfg.refreshMinutes,
    errors,
    games: entries.map((e) => ({
      ...e.meta,
      stats: e.stats,
      truncated: e.truncated,
      cheapest: e.cheapest,
      history: history.events[e.meta.id]?.snapshots ?? [],
    })),
  };

  writeLatest(payload);
  log(`refresh done — ${entries.length} games priced, ${errors.length} errors`);
  return payload;
}

export { TEAM_LABELS };
