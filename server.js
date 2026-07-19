import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { refresh } from './lib/refresh.js';
import { readConfig, writeConfig, readLatest, ROOT } from './lib/store.js';

const PUBLIC = join(ROOT, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
};

const state = {
  running: false,
  lastError: null,
  lastRunAt: null,
  log: [],
};

function pushLog(line) {
  state.log.push(`${new Date().toISOString().slice(11, 19)}  ${line}`);
  if (state.log.length > 400) state.log = state.log.slice(-400);
  console.log(line);
}

/** Run a refresh unless one is already in flight. */
async function runRefresh() {
  if (state.running) return { skipped: true };
  state.running = true;
  state.lastError = null;
  state.log = [];
  try {
    const payload = await refresh({ log: pushLog });
    state.lastRunAt = payload.generatedAt;
    return payload;
  } catch (err) {
    state.lastError = err.message;
    pushLog(`refresh failed: ${err.message}`);
    throw err;
  } finally {
    state.running = false;
  }
}

const json = (res, code, body) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
};

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    return {};
  }
}

async function serveStatic(res, urlPath) {
  const rel = normalize(urlPath === '/' ? '/index.html' : urlPath).replace(/^(\.\.[/\\])+/, '');
  const file = join(PUBLIC, rel);
  if (!file.startsWith(PUBLIC)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/api/data') {
    const latest = readLatest();
    return json(res, 200, {
      ...(latest ?? { games: [], generatedAt: null }),
      config: readConfig(),
      status: {
        running: state.running,
        lastError: state.lastError,
        lastRunAt: state.lastRunAt,
      },
    });
  }

  if (url.pathname === '/api/status') {
    return json(res, 200, { ...state, log: state.log.slice(-60) });
  }

  if (url.pathname === '/api/refresh' && req.method === 'POST') {
    if (state.running) return json(res, 202, { running: true, skipped: true });
    runRefresh().catch(() => {});
    return json(res, 202, { running: true });
  }

  if (url.pathname === '/api/config' && req.method === 'POST') {
    const body = await readBody(req);
    const next = {};
    if (body.trip) next.trip = { ...readConfig().trip, ...body.trip };
    if (Array.isArray(body.regions)) next.regions = body.regions;
    if (Number.isFinite(body.refreshMinutes)) next.refreshMinutes = body.refreshMinutes;
    if ('ticketCount' in body) {
      next.ticketCount = Number.isInteger(body.ticketCount) ? body.ticketCount : null;
    }
    const cfg = writeConfig(next);
    // New window means the cached payload is stale — repopulate immediately.
    runRefresh().catch(() => {});
    return json(res, 200, { config: cfg, running: true });
  }

  if (req.method !== 'GET') return json(res, 405, { error: 'method not allowed' });
  return serveStatic(res, url.pathname);
});

const cfg = readConfig();
const port = cfg.port ?? 4173;

server.listen(port, () => {
  console.log(`\n  TicketJam dashboard  →  http://localhost:${port}\n`);
  console.log(`  window: ${cfg.trip?.start} .. ${cfg.trip?.end}`);
  console.log(`  auto-refresh: every ${cfg.refreshMinutes} min\n`);

  // Refresh on boot only when there is nothing to show yet; otherwise the
  // dashboard renders instantly from the last snapshot.
  if (!readLatest()) runRefresh().catch(() => {});

  const everyMs = Math.max(5, cfg.refreshMinutes ?? 30) * 60_000;
  setInterval(() => runRefresh().catch(() => {}), everyMs);
});
