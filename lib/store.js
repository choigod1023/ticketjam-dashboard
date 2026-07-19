import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'data');
const CONFIG_PATH = join(ROOT, 'config.json');
const HISTORY_PATH = join(DATA, 'history.json');
const LATEST_PATH = join(DATA, 'latest.json');

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
export const writeLatest = (v) => writeJson(LATEST_PATH, v);

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

export { ROOT, DATA };
