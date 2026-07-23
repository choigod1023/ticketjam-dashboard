const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const BASE = 'https://ticketjam.jp';

// TicketJam is a small resale site; keep requests strictly serial with a
// delay so a refresh cycle never looks like a scrape burst.
let chain = Promise.resolve();
let lastAt = 0;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function throttled(fn, delayMs) {
  const run = chain.then(async () => {
    const wait = delayMs - (Date.now() - lastAt);
    if (wait > 0) await sleep(wait);
    try {
      return await fn();
    } finally {
      lastAt = Date.now();
    }
  });
  // Keep the chain alive even when a request rejects.
  chain = run.then(
    () => {},
    () => {},
  );
  return run;
}

/**
 * Fetch a TicketJam path and return its HTML.
 * Retries on network errors and 5xx/429 with exponential backoff.
 */
export async function getHtml(path, { delayMs = 700, retries = 3, referer = null } = {}) {
  const url = path.startsWith('http') ? path : BASE + path;

  for (let attempt = 0; ; attempt++) {
    try {
      const res = await throttled(
        () =>
          fetch(url, {
            headers: {
              'User-Agent': UA,
              Accept: 'text/html,application/xhtml+xml',
              'Accept-Language': 'ja,en;q=0.8',
              // Some endpoints (search_by_seat_maps) 500 without a same-site
              // Referer, so pass one through when the caller supplies it.
              ...(referer ? { Referer: referer, 'X-Requested-With': 'XMLHttpRequest' } : {}),
            },
            signal: AbortSignal.timeout(30_000),
          }),
        delayMs,
      );

      if (res.status === 404) return null;
      if (res.status === 429 || res.status >= 500) {
        throw new Error(`HTTP ${res.status}`);
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return decodeBody(await res.arrayBuffer(), res.headers.get('content-type'));
    } catch (err) {
      if (attempt >= retries) throw new Error(`${url}: ${err.message}`);
      await sleep(1000 * 2 ** attempt);
    }
  }
}


/**
 * Decode a response body using its declared charset.
 *
 * ticket.co.jp still serves EUC-JP, so assuming UTF-8 (what res.text() does)
 * turns every Japanese seat name into replacement characters.
 */
function decodeBody(buf, contentType) {
  const fromHeader = /charset=["']?([\w-]+)/i.exec(contentType || '')?.[1];
  // The meta tag is ASCII-safe to read from a latin1 view of the first bytes.
  const head = new TextDecoder('latin1').decode(new Uint8Array(buf, 0, Math.min(2048, buf.byteLength)));
  const fromMeta = /charset=["']?([\w-]+)/i.exec(head)?.[1];
  const charset = (fromHeader || fromMeta || 'utf-8').toLowerCase();

  try {
    return new TextDecoder(charset).decode(buf);
  } catch {
    return new TextDecoder('utf-8').decode(buf);
  }
}

export { BASE };
