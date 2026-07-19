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

/** Append one price snapshot per event and persist. */
export function appendSnapshots(entries, at) {
  const history = readHistory();

  for (const { meta, stats } of entries) {
    if (!stats || stats.count === 0) continue;
    const rec = (history.events[meta.id] ??= { meta, snapshots: [] });
    rec.meta = meta;

    const last = rec.snapshots.at(-1);
    const point = {
      t: at,
      count: stats.count,
      totalQty: stats.totalQty,
      min: stats.min,
      p25: stats.p25,
      median: stats.median,
      max: stats.max,
    };

    // Collapse consecutive identical readings into the latest timestamp so
    // a quiet week doesn't bloat the file or flatten the chart with noise.
    const same =
      last &&
      last.min === point.min &&
      last.median === point.median &&
      last.count === point.count;
    if (same) rec.snapshots[rec.snapshots.length - 1] = point;
    else rec.snapshots.push(point);

    if (rec.snapshots.length > MAX_SNAPSHOTS) {
      rec.snapshots = rec.snapshots.slice(-MAX_SNAPSHOTS);
    }
  }

  writeJson(HISTORY_PATH, history);
  return history;
}

export { ROOT, DATA };
