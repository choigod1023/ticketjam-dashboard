import { getHtml } from './http.js';
import { parseListings } from './parse.js';

const BASE = 'https://ticketjam.jp';

/**
 * The seat_maps page assigns listings to polygons server-side and never exposes
 * the mapping in its embedded JSON. The only accurate source is the same
 * endpoint the site itself calls on click:
 *   /tickets/{team}/search_by_seat_maps?seat_map_id={polygonId}&event_id={id}
 * It 500s without a Referer, so the seat_maps page URL is sent as one.
 */
async function polygonListings(team, eventId, polygonId, { delayMs }) {
  const ref = `${BASE}/tickets/${team}/event/${eventId}/seat_maps`;
  const url = `${BASE}/tickets/${team}/search_by_seat_maps` +
    `?seat_map_id=${polygonId}&event_id=${eventId}`;
  const raw = await getHtml(url, { delayMs, referer: ref });
  if (!raw) return null;
  let html;
  try {
    html = JSON.parse(raw).ticket_list_partial || '';
  } catch {
    return null;
  }
  return parseListings(html);
}

/**
 * Resolve exact per-polygon pricing for one event. Only the polygons that
 * actually hold listings (enableSeatIds) are queried, cheapest-first isn't
 * needed since we read them all. Returns { polygonId: {min,count,url} }.
 */
export async function seatmapDetail(team, eventId, enableSeatIds, { delayMs = 700, log } = {}) {
  const out = {};
  let done = 0;
  for (const pid of enableSeatIds) {
    const listings = await polygonListings(team, eventId, pid, { delayMs });
    done++;
    if (!listings?.length) continue;
    const usable = listings
      .filter((l) => !/高校生|中学生|小学生|こども|子ども|子供|シニア|女性限定|レディース|学割/.test(l.seat))
      .sort((a, b) => a.price - b.price);
    if (!usable.length) continue;
    out[pid] = {
      min: usable[0].price,
      count: usable.length,
      url: usable[0].url || null,
    };
    if (log && done % 25 === 0) log(`    seatmap ${eventId}: ${done}/${enableSeatIds.length}`);
  }
  return out;
}
