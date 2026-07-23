import { getHtml } from './http.js';
import { parseSchedule, parseListings, parseMaxPage, parseEventMeta } from './parse.js';
import {
  readConfig, appendSnapshots, writeLatest, readHistory, readSchedule, writeSchedule,
} from './store.js';
import { fetchResale } from './resale.js';
import { officialFor } from './official.js';
import { venueGeo, slugify } from './seatgeo.js';

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

// Seats sold under an eligibility restriction (student/child/senior/women-only).
// These routinely undercut every other listing, so a bare minimum price is
// misleading unless they are excluded from the headline stats.
const RESTRICTED = /高校生|中学生|小学生|こども|子ども|子供|シニア|女性限定|レディース|学割/;

const SORT_CHEAPEST = 'sort_query%5BsortKindKey%5D=price_for_cell_asc';
const ONE_TICKET = 'sort_query%5BremainingCountMultiple%5B1%5D%5D=1';

const quantile = (sorted, q) => {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return lo === hi ? sorted[lo] : Math.round(sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo));
};

/** Headline stats over the listings a buyer could actually use. */
function summarise(listings) {
  const usable = listings.filter((l) => !l.restricted);
  const prices = usable.map((l) => l.price).sort((a, b) => a - b);
  if (!prices.length) {
    return { count: 0, totalQty: 0, min: null, p25: null, median: null, max: null };
  }
  return {
    count: prices.length,
    totalQty: usable.reduce((s, l) => s + (l.qty || 0), 0),
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

/**
 * Fetch one listing view of an event (all listings, or only those buyable as a
 * single ticket). Always sorted cheapest-first, so a truncated crawl still
 * yields an exact minimum.
 */
async function fetchListings(game, cfg, { oneTicket }) {
  const delayMs = cfg.requestDelayMs ?? 700;
  const q = '?' + [SORT_CHEAPEST, ...(oneTicket ? [ONE_TICKET] : [])].join('&');

  const first = await getHtml(game.path + q, { delayMs });
  if (!first) return { listings: [], meta: null, truncated: false };

  const meta = parseEventMeta(first, game.id);
  const listings = parseListings(first);
  const available = parseMaxPage(first, game.id);
  const limit = Math.min(available, cfg.maxPagesPerEvent ?? 3);

  for (let page = 2; page <= limit; page++) {
    const html = await getHtml(`${game.path}${q}&page=${page}`, { delayMs });
    if (!html) break;
    listings.push(...parseListings(html));
  }

  return {
    listings: listings.map((l) => ({ ...l, restricted: RESTRICTED.test(l.seat) })),
    meta,
    truncated: available > limit,
  };
}

/**
 * Sort key for a row range so bands can be laid out front-to-back.
 * Yokohama mixes numeric rows ("51 ~ 67段") with lettered ones ("A ~ X段"),
 * which belong to a different deck — letters sort after numbers rather than
 * being forced onto the same scale.
 */
function rowOrder(row) {
  const r = String(row || '');
  const num = /(\d+)/.exec(r);
  if (num) return Number(num[1]);
  const alpha = /([A-Za-z])/.exec(r);
  if (alpha) return 1000 + alpha[1].toUpperCase().charCodeAt(0);
  return 9999;
}

/**
 * Cheapest offer per (area, row-range) cell.
 *
 * Row depth carries real price signal — at Yokohama the same レフトウィング
 * runs ¥5,300 at 51~67段 but ¥6,600 at 36~49段 — so collapsing to area alone
 * throws away a dimension. The row ranges the site reports are used verbatim
 * rather than bucketed into invented tiers.
 */
function byCell(listings) {
  const groups = new Map();
  for (const l of listings) {
    if (l.restricted || !l.block?.area) continue;
    const row = l.block.row || '';
    const key = `${l.block.area}\u0000${row}`;
    if (!groups.has(key)) groups.set(key, { area: l.block.area, row, prices: [] });
    groups.get(key).prices.push(l.price);
  }

  return [...groups.values()]
    .map((g) => {
      g.prices.sort((a, b) => a - b);
      return {
        area: g.area,
        row: g.row,
        order: rowOrder(g.row),
        count: g.prices.length,
        min: g.prices[0],
        median: quantile(g.prices, 0.5),
      };
    })
    .sort((a, b) => a.min - b.min);
}

/** Cheapest offer per seating area, over every listing rather than the top N. */
function byArea(listings) {
  const groups = new Map();
  for (const l of listings) {
    if (l.restricted) continue;
    const area = l.block?.area || '구역 미기재';
    if (!groups.has(area)) groups.set(area, []);
    groups.get(area).push(l.price);
  }
  return [...groups]
    .map(([area, prices]) => {
      prices.sort((a, b) => a - b);
      return {
        area,
        count: prices.length,
        min: prices[0],
        median: quantile(prices, 0.5),
      };
    })
    .sort((a, b) => a.min - b.min);
}

const view = (listings) => ({
  stats: summarise(listings),
  areas: byArea(listings),
  cells: byCell(listings),
  cheapest: [...listings].sort((a, b) => a.price - b.price).slice(0, 40),
});

/**
 * Run one full refresh: rebuild the schedule, price every in-scope game in both
 * views, append a history snapshot and write the dashboard payload.
 */
export async function refresh({ log = console.log } = {}) {
  const cfg = readConfig();
  const startedAt = new Date().toISOString();
  const delayMs = cfg.requestDelayMs ?? 700;
  const scope = { start: cfg.trip?.start, end: cfg.trip?.end, regions: cfg.regions };

  log(`refresh start ${startedAt} — window ${scope.start}..${scope.end}`);

  // 1. Schedules. Event ids are global, so the same game seen from two teams
  //    collapses onto one entry. Served from cache unless it has gone stale.
  const errors = [];
  const ttlMs = (cfg.scheduleTtlHours ?? 12) * 3600_000;
  const cached = readSchedule(ttlMs);
  let games;

  if (cached) {
    games = cached.games;
    const ageMin = Math.round((Date.now() - new Date(cached.fetchedAt).getTime()) / 60_000);
    log(`  schedule: ${games.length} games from cache (${ageMin}m old)`);
  } else {
    const byId = new Map();
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
    games = [...byId.values()].map((g) => ({ ...g, teams: [...g.teams] }));
    if (games.length) writeSchedule(games);
    log(`  schedule: ${games.length} distinct games fetched across ${cfg.teams?.length ?? 0} teams`);
  }

  // 2. Price only the games inside the trip window.
  const scoped = games
    .filter((g) => inScope(g, scope))
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
  log(`  in window: ${scoped.length} games`);

  const entries = [];
  for (const game of scoped) {
    try {
      // Two views: the site's own "buyable as 1 ticket" filter also keeps
      // larger lots the seller allows splitting, which a raw 枚 count misses —
      // so it has to be fetched, not derived.
      const all = await fetchListings(game, cfg, { oneTicket: false });
      const one = await fetchListings(game, cfg, { oneTicket: true });
      const meta = all.meta || one.meta;

      const vAll = view(all.listings);
      const vOne = view(one.listings);

      // Real seat map: cached per venue (venue-fixed geometry). Only some
      // venues expose one; the rest fall back to the schematic fan.
      let hasGeo = false;
      try {
        const geo = await venueGeo(game, { delayMs });
        hasGeo = !!geo;
      } catch (err) {
        log(`  ! geo ${game.venue}: ${err.message}`);
      }

      // Second opinion from チケット流通センター — for some clubs this is the
      // club's own official resale, and it is regularly cheaper than TicketJam.
      let resale = null;
      try {
        resale = await fetchResale(game, { delayMs });
      } catch (err) {
        log(`  ! resale ${game.id}: ${err.message}`);
      }

      entries.push({
        meta: {
          id: game.id,
          name: meta?.name || game.name,
          startDate: meta?.startDate || game.startDate,
          venue: meta?.venue || game.venue,
          region: meta?.region || game.region,
          url: game.url,
          teams: [...game.teams],
          official: officialFor(game.teams),
          venueSlug: slugify(game.venue),
          hasGeo,
          teamLabels: [...game.teams].map((t) => TEAM_LABELS[t] || t),
        },
        all: vAll,
        one: vOne,
        resale,
        truncated: all.truncated,
      });

      log(`  ${game.startDate.slice(0, 10)} ${game.name} @ ${game.venue}: ` +
        `티켓잼 1매 ${vOne.stats.count}건 min ¥${vOne.stats.min?.toLocaleString() ?? '-'} / ` +
        (resale
          ? `チケ流(${resale.source}) ${resale.count}건 min ¥${resale.min.toLocaleString()}`
          : 'チケ流 매물 없음'));
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
      all: e.all,
      one: e.one,
      resale: e.resale,
      truncated: e.truncated,
      history: history.events[e.meta.id]?.snapshots ?? [],
      events: history.events[e.meta.id]?.events ?? [],
    })),
  };

  writeLatest(payload);
  log(`refresh done — ${entries.length} games priced, ${errors.length} errors`);
  return payload;
}

export { TEAM_LABELS };
