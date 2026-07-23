import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'data');
const CONFIG_PATH = join(ROOT, 'config.json');
const HISTORY_PATH = join(DATA, 'history.json');
const LATEST_PATH = join(DATA, 'latest.json');
const SCHEDULE_PATH = join(DATA, 'schedule.json');
const SEATMAP_DIR = join(DATA, 'seatmap');

// Keep roughly a month of half-hourly snapshots per event.
const MAX_SNAPSHOTS = 1500;

function readJson(path, fallback) {
  try {
    return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : fallback;
  } catch {
    return fallback;
  }
}

// Write via a temp file so a crash mid-write can't truncate good data.
function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(value));
  renameSync(tmp, path);
}

export const readConfig = () => readJson(CONFIG_PATH, null);

export function writeConfig(next) {
  const merged = { ...readConfig(), ...next };
  writeJson(CONFIG_PATH, merged);
  return merged;
}

export const readHistory = () => readJson(HISTORY_PATH, { events: {} });
export const readLatest = () => readJson(LATEST_PATH, null);

/**
 * Cached fixture list. The schedule only changes when the league publishes or
 * moves a game, so re-fetching 12 battle_cards pages on every poll is pure
 * waste — that was two thirds of a refresh cycle's requests.
 */
export function readSchedule(maxAgeMs) {
  const cached = readJson(SCHEDULE_PATH, null);
  if (!cached?.fetchedAt || !Array.isArray(cached.games)) return null;
  const age = Date.now() - new Date(cached.fetchedAt).getTime();
  return age >= 0 && age < maxAgeMs ? cached : null;
}

export const writeSchedule = (games) =>
  writeJson(SCHEDULE_PATH, { fetchedAt: new Date().toISOString(), games });
export const writeLatest = (v) => writeJson(LATEST_PATH, v);

// Chart annotations. Club news feeds render their dates in JS, so a reliable
// date→headline mapping isn't scrapeable; these events come from the price
// series itself, which is the thing the chart is actually about.
function detectEvents(prev, next, meta) {
  if (!prev) return [];
  const out = [];
  const pct = (a, b) => (b == null || a == null || !a ? 0 : Math.round(((b - a) / a) * 100));

  const dMin = pct(prev.one?.min, next.one.min);
  if (dMin <= -10) out.push({ kind: 'drop', text: `1매 최저가 ${Math.abs(dMin)}% 하락 → ${fmt(next.one.min)}` });
  if (dMin >= 10) out.push({ kind: 'spike', text: `1매 최저가 ${dMin}% 상승 → ${fmt(next.one.min)}` });

  const dCount = pct(prev.one?.count, next.one.count);
  if (dCount <= -20) out.push({ kind: 'supply', text: `1매 매물 ${Math.abs(dCount)}% 감소 (${prev.one.count}→${next.one.count}건)` });
  if (dCount >= 20) out.push({ kind: 'supply', text: `1매 매물 ${dCount}% 증가 (${prev.one.count}→${next.one.count}건)` });

  // Which marketplace is cheaper flips often enough to be worth flagging.
  if (prev.resale?.min != null && next.resale?.min != null) {
    const was = prev.one?.min <= prev.resale.min ? 'jam' : 'chike';
    const now = next.one.min <= next.resale.min ? 'jam' : 'chike';
    if (was !== now) {
      out.push({
        kind: 'flip',
        text: now === 'chike'
          ? `최저가 역전 — チケ流가 더 쌈 (${fmt(next.resale.min)} < ${fmt(next.one.min)})`
          : `최저가 역전 — 티켓잼이 더 쌈 (${fmt(next.one.min)} < ${fmt(next.resale.min)})`,
      });
    }
  }
  return out;
}

const fmt = (n) => (n == null ? '—' : '¥' + n.toLocaleString('ja-JP'));

const point = (v) => ({
  count: v.count, min: v.min, p25: v.p25, median: v.median, max: v.max,
});

/** Append one price snapshot per event and persist. */
export function appendSnapshots(entries, at) {
  const history = readHistory();

  for (const { meta, all, one, resale } of entries) {
    if (!all || all.stats.count === 0) continue;
    const rec = (history.events[meta.id] ??= { meta, snapshots: [] });
    rec.meta = meta;

    const snap = { t: at, all: point(all.stats), one: point(one.stats) };
    if (resale) snap.resale = { count: resale.count, min: resale.min, median: resale.median };
    const last = rec.snapshots.at(-1);

    // Collapse consecutive identical readings into the latest timestamp so a
    // quiet week doesn't bloat the file or flatten the chart with noise.
    const fired = detectEvents(last, snap, meta);
    if (fired.length) {
      rec.events = (rec.events ?? []).concat(fired.map((e) => ({ ...e, t: at })));
      if (rec.events.length > 300) rec.events = rec.events.slice(-300);
    }

    const same =
      last &&
      last.all?.min === snap.all.min &&
      last.all?.median === snap.all.median &&
      last.all?.count === snap.all.count &&
      last.one?.min === snap.one.min &&
      last.one?.count === snap.one.count &&
      last.resale?.min === snap.resale?.min;
    if (same) rec.snapshots[rec.snapshots.length - 1] = snap;
    else rec.snapshots.push(snap);

    if (rec.snapshots.length > MAX_SNAPSHOTS) {
      rec.snapshots = rec.snapshots.slice(-MAX_SNAPSHOTS);
    }
  }

  writeJson(HISTORY_PATH, history);
  return history;
}

/** Per-polygon seat-map pricing for one event, or null if never collected. */
export function readSeatmap(eventId) {
  return readJson(join(SEATMAP_DIR, `${eventId}.json`), null);
}

export function writeSeatmap(eventId, polys) {
  mkdirSync(SEATMAP_DIR, { recursive: true });
  writeJson(join(SEATMAP_DIR, `${eventId}.json`), {
    eventId, at: new Date().toISOString(), polys,
  });
}

/** Age in ms of an event's seat-map file, Infinity if absent. */
export function seatmapAge(eventId) {
  const rec = readSeatmap(eventId);
  if (!rec?.at) return Infinity;
  return Date.now() - new Date(rec.at).getTime();
}

export { ROOT, DATA };
