import { getHtml } from './http.js';
import { parseSchedule, parseListings, parseMaxPage, parseEventMeta } from './parse.js';
import { readConfig, appendSnapshots, writeLatest, readHistory } from './store.js';
import { fetchResale } from './resale.js';

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

const view = (listings) => ({
  stats: summarise(listings),
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
      // Two views: the site's own "buyable as 1 ticket" filter also keeps
      // larger lots the seller allows splitting, which a raw 枚 count misses —
      // so it has to be fetched, not derived.
      const all = await fetchListings(game, cfg, { oneTicket: false });
      const one = await fetchListings(game, cfg, { oneTicket: true });
      const meta = all.meta || one.meta;

      const vAll = view(all.listings);
      const vOne = view(one.listings);

      // Second opinion from チケット流通センター — for some clubs this is the
      // club's own official resale, and it is regularly cheaper than TicketJam.
      let resale = null;
      try {
        resale = await fetchResale({ ...game, teams: [...game.teams] }, { delayMs });
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
