// Parsers for TicketJam HTML. Prefers the embedded JSON-LD `SportsEvent`
// blocks (stable, fully-qualified dates) and falls back to markup scraping
// only for the per-listing rows, which have no structured equivalent.

const decode = (s) =>
  String(s ?? '')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const stripTags = (s) => decode(String(s ?? '').replace(/<[^>]+>/g, ' '));

/** Pull every application/ld+json payload out of a page. */
function jsonLdBlocks(html) {
  const out = [];
  const re = /<script[^>]*type=['"]application\/ld\+json['"][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    try {
      out.push(JSON.parse(m[1].trim()));
    } catch {
      // Malformed block: skip rather than fail the whole page.
    }
  }
  return out;
}

const eventIdFromUrl = (url) => (String(url).match(/\/event\/(\d+)/) || [])[1] || null;

/**
 * Parse a `/tickets/{team}/battle_cards` page into the team's remaining games.
 * Returns objects keyed by the TicketJam event id.
 */
export function parseSchedule(html, team) {
  // Listing counts live in the anchor markup, not the JSON-LD.
  const counts = new Map();
  const countRe =
    /js-current-date-(\d+)"[\s\S]{0,600}?class='count ticket-count'>\((\d+)\)/g;
  let c;
  while ((c = countRe.exec(html))) counts.set(c[1], Number(c[2]));

  const games = [];
  for (const block of jsonLdBlocks(html)) {
    const nodes = Array.isArray(block) ? block : [block];
    for (const node of nodes) {
      if (node?.['@type'] !== 'SportsEvent') continue;
      const url = node.offers?.url || '';
      const id = eventIdFromUrl(url);
      if (!id) continue;

      games.push({
        id,
        team,
        name: decode(node.name),
        startDate: node.startDate || null,
        venue: decode(node.location?.name || ''),
        region: decode(node.location?.address?.addressRegion || ''),
        url,
        path: `/tickets/${team}/event/${id}`,
        listingCount: counts.get(id) ?? null,
      });
    }
  }
  return games;
}

/** Split an event page into its individual resale-listing rows. */
function listingRows(html) {
  return html.split(/<li class='eventlist__item/).slice(1);
}

/**
 * Parse one page of `/tickets/{team}/event/{id}` into listing objects.
 */
export function parseListings(html) {
  const listings = [];

  for (const row of listingRows(html)) {
    const priceM = row.match(
      /u-text-vivid-red u-text-size-md font-weight-bold'>\s*([\d,]+)\s*<\/span>\s*<small>\s*円\/枚/,
    );
    if (!priceM) continue;
    const price = Number(priceM[1].replace(/,/g, ''));
    if (!Number.isFinite(price) || price <= 0) continue;

    const qtyM = row.match(/class='ml-1 bold[^']*'>\s*(\d+)\s*枚/);
    const seatM = row
      .match(/<p class='description'>([\s\S]*?)<\/p>/)?.[1]
      ?.match(/<span class='font-weight-bold'>([\s\S]*?)<\/span>/);
    const hrefM = row.match(/href="(\/ticket\/sports\/[^"]+)"/);
    const daysM = row.match(/<small>\s*残り\s*<\/small>\s*<span[^>]*>\s*(\d+)\s*<\/span>/);

    const tags = [];
    const tagRe = /<span class='tag--[^']*'>([\s\S]*?)<\/span>/g;
    let t;
    while ((t = tagRe.exec(row))) {
      const v = stripTags(t[1]);
      if (v) tags.push(v);
    }

    listings.push({
      price,
      qty: qtyM ? Number(qtyM[1]) : null,
      seat: seatM ? stripTags(seatM[1]) : '',
      tags,
      daysLeft: daysM ? Number(daysM[1]) : null,
      url: hrefM ? hrefM[1] : null,
    });
  }

  return listings;
}

/** Highest page number offered by an event page's pagination control. */
export function parseMaxPage(html, eventId) {
  const re = new RegExp(`event/${eventId}\\?page=(\\d+)`, 'g');
  let max = 1;
  let m;
  while ((m = re.exec(html))) max = Math.max(max, Number(m[1]));
  return max;
}

/**
 * Canonical metadata for ONE event from its own page.
 *
 * An event page also embeds JSON-LD for the sibling games in the same series,
 * so the block must be matched on the event id — taking the first SportsEvent
 * silently mislabels every game but one.
 */
export function parseEventMeta(html, eventId) {
  for (const block of jsonLdBlocks(html)) {
    const nodes = Array.isArray(block) ? block : [block];
    for (const node of nodes) {
      if (node?.['@type'] !== 'SportsEvent') continue;
      if (String(eventIdFromUrl(node.offers?.url || '')) !== String(eventId)) continue;
      return {
        name: decode(node.name),
        startDate: node.startDate || null,
        venue: decode(node.location?.name || ''),
        region: decode(node.location?.address?.addressRegion || ''),
      };
    }
  }
  return null;
}

export { decode };
