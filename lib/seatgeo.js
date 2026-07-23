import { getHtml } from './http.js';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const VENUES = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'venues');

// TicketJam's seat_maps page embeds the real stadium as a GeoJSON polygon set
// in data-geo-json. Geometry is venue-fixed (identical across events), so it is
// fetched once per venue and cached — it never changes.
const unescape = (s) =>
  String(s)
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

/** Round every coordinate to 4dp — plenty for a ~600px plan, ~6x smaller. */
const r4 = (n) => Math.round(n * 1e4) / 1e4;

function extractGeo(html) {
  // The attribute value is single-quoted JSON; grab up to the next attribute.
  const m = html.match(/data-geo-json='(.*?)'(?=\s+[a-z-]+=|\s*>)/s);
  if (!m) return null;
  let gj;
  try {
    gj = JSON.parse(unescape(m[1]));
  } catch {
    return null;
  }

  const polys = [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const f of gj.features ?? []) {
    const p = f.properties ?? {};
    if (!Number.isInteger(p.id) || !p.side) continue;
    if (f.geometry?.type !== 'Polygon') continue;

    const rings = f.geometry.coordinates.map((ring) =>
      ring.map(([x, y]) => {
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        return [r4(x), r4(y)];
      }),
    );
    polys.push({ id: p.id, side: p.side, row: p.row || null, seat: p.seat || null, g: rings });
  }
  if (!polys.length) return null;
  return { polys, bounds: { minX: r4(minX), minY: r4(minY), maxX: r4(maxX), maxY: r4(maxY) } };
}

const slugify = (venue) =>
  String(venue).split('（')[0].trim()
    .replace(/[^\w぀-ヿ一-鿿]+/g, '-').replace(/^-+|-+$/g, '');

/**
 * Return the cached seat geometry for a venue, fetching+caching it the first
 * time. Cache is keyed by venue name; a missing seat_maps page yields null and
 * is remembered so we don't retry every run.
 */
export async function venueGeo(game, { delayMs = 700 } = {}) {
  mkdirSync(VENUES, { recursive: true });
  const slug = slugify(game.venue);
  const path = join(VENUES, `${slug}.json`);

  if (existsSync(path)) {
    const cached = JSON.parse(readFileSync(path, 'utf8'));
    return cached.polys ? { slug, ...cached } : null;
  }

  const team = game.teams?.[0];
  if (!team) return null;
  const html = await getHtml(`/tickets/${team}/event/${game.id}/seat_maps`, { delayMs, retries: 1 });
  const geo = html ? extractGeo(html) : null;

  // Persist either the geometry or a negative marker (null polys) to skip next time.
  writeFileSync(path, JSON.stringify(geo ? { venue: game.venue, ...geo } : { venue: game.venue, polys: null }));
  return geo ? { slug, venue: game.venue, ...geo } : null;
}

/** The polygon ids that currently hold listings, from a seat_maps page. */
export function enableSeatIds(html) {
  const m = html.match(/data-enable-seat-ids='(\[[^']*\])'/);
  if (!m) return [];
  try { return JSON.parse(unescape(m[1])); } catch { return []; }
}

/** Fetch a seat_maps page once and return its enable-seat-ids (for detail). */
export async function fetchEnableSeatIds(game, { delayMs = 700 } = {}) {
  const team = game.teams?.[0];
  if (!team) return [];
  const html = await getHtml(`/tickets/${team}/event/${game.id}/seat_maps`, { delayMs, retries: 1 });
  return html ? enableSeatIds(html) : [];
}

export { slugify };
