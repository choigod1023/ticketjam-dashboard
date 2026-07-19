import { getHtml } from './http.js';

// チケット流通センター listing pages, one per club. Discovered by probing the
// /sys/d/ id range; the Marines page is the club's *official* resale partner,
// the rest are the same marketplace without club branding.
const TEAM_IDS = {
  giants: 20016,
  hanshintigers: 20017,
  'yakult-swallows': 20018,
  dragons: 20019,
  baystars: 20020,
  carp: 20021,
  seibulions: 20022,
  marines: 20023,
  rakuteneagles: 20024,
  buffaloes: 20025,
  fighters: 20026,
  softbankhawks: 20027,
};

// Clubs whose page on this site is the club-sanctioned resale, not just a
// third-party marketplace listing.
const OFFICIAL = new Set(['marines']);

const BASE = 'https://www.ticket.co.jp';
const url = (id, ymd) => `${BASE}/sys/d/${id}.htm?st=${ymd}`;

const quantile = (sorted, q) => {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return lo === hi ? sorted[lo] : Math.round(sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo));
};

/** Prices sit in a `price`-classed element as a yen-prefixed figure. */
function parsePrices(html) {
  const out = [];
  const re = /class="[^"]*price[^"]*"[^>]*>\s*￥([\d,]+)/g;
  let m;
  while ((m = re.exec(html))) {
    const v = Number(m[1].replace(/,/g, ''));
    if (Number.isFinite(v) && v > 0) out.push(v);
  }
  return out.sort((a, b) => a - b);
}

/**
 * Look up one game on チケット流通センター and summarise its listings.
 * Tries each club involved, since the page is per-club and either side of the
 * fixture may carry it. Returns null when nothing is listed.
 */
export async function fetchResale(game, { delayMs = 700 } = {}) {
  const ymd = game.startDate.slice(0, 10).replace(/-/g, '');

  for (const team of game.teams ?? []) {
    const id = TEAM_IDS[team];
    if (!id) continue;

    const link = url(id, ymd);
    const html = await getHtml(link, { delayMs });
    if (!html) continue;

    const prices = parsePrices(html);
    if (!prices.length) continue;

    return {
      source: OFFICIAL.has(team) ? 'official' : 'marketplace',
      site: 'チケット流通センター',
      team,
      url: link,
      count: prices.length,
      min: prices[0],
      p25: quantile(prices, 0.25),
      median: quantile(prices, 0.5),
      max: prices[prices.length - 1],
    };
  }
  return null;
}

export { TEAM_IDS };
