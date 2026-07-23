// Schematic stadium plan. Not a real seating chart — an annular fan around the
// field. Direction comes from the area name, depth from the row range, so each
// cell is (area x rows) exactly as the site reports it. Grid-code venues
// (Tokyo Dome "A01エリア", Belluna "112ブロック", Jingu "入口14") carry no
// position information and are not drawn.

const SVGNS = 'http://www.w3.org/2000/svg';

// 0° points to centre field; angles run clockwise, tiling the full ring.
const ZONES = [
  { id: 'center', label: '외야 중앙', a0: -25, a1: 25 },
  { id: 'right', label: '라이트', a0: 25, a1: 70 },
  { id: 'rightwing', label: '라이트 윙', a0: 70, a1: 100 },
  { id: 'first', label: '1루측', a0: 100, a1: 145 },
  { id: 'backnet_first', label: '백네트(1루쪽)', a0: 145, a1: 170 },
  { id: 'backnet', label: '백네트', a0: 170, a1: 190 },
  { id: 'backnet_third', label: '백네트(3루쪽)', a0: 190, a1: 215 },
  { id: 'third', label: '3루측', a0: 215, a1: 260 },
  { id: 'leftwing', label: '레프트 윙', a0: 260, a1: 290 },
  { id: 'left', label: '레프트', a0: 290, a1: 335 },
];

/**
 * Map an area name onto a zone. Order matters: ネット裏 is checked before the
 * base-side tests because Yokohama combines both ("BAYSIDE・ネット裏"), and the
 * wings precede plain left/right.
 */
export function zoneOf(area) {
  const a = String(area || '');
  if (!a || a === '구역 미기재') return null;
  if (/ネット裏|バックネット|中央指定席|中央席/.test(a)) {
    if (/STARSIDE|STAR SIDE|3塁|三塁/.test(a)) return 'backnet_third';
    if (/BAYSIDE|1塁|一塁/.test(a)) return 'backnet_first';
    return 'backnet';
  }
  if (/レフトウィング|レフト側ウィング/.test(a)) return 'leftwing';
  if (/ライトウィング|ライト側ウィング/.test(a)) return 'rightwing';
  if (/ウイングフロント|ウィング/.test(a)) return null; // side not stated
  if (/レフト/.test(a)) return 'left';
  if (/ライト/.test(a)) return 'right';
  if (/センター/.test(a)) return 'center';
  if (/3塁|三塁/.test(a)) return 'third';
  if (/1塁|一塁/.test(a)) return 'first';
  return null;
}

/** True when enough of a venue's listings can actually be placed. */
export function isMappable(cells) {
  const total = cells.reduce((s, c) => s + c.count, 0);
  if (!total) return false;
  const placed = cells.reduce((s, c) => (zoneOf(c.area) ? s + c.count : s), 0);
  return placed / total >= 0.5;
}

const rad = (deg) => ((deg - 90) * Math.PI) / 180;

/** Annular sector path between two radii over an angle range. */
function sector(cx, cy, r0, r1, a0, a1) {
  const p = (r, a) => [cx + r * Math.cos(rad(a)), cy + r * Math.sin(rad(a))];
  const [x0, y0] = p(r1, a0);
  const [x1, y1] = p(r1, a1);
  const [x2, y2] = p(r0, a1);
  const [x3, y3] = p(r0, a0);
  const big = a1 - a0 > 180 ? 1 : 0;
  return `M${x0} ${y0} A${r1} ${r1} 0 ${big} 1 ${x1} ${y1} L${x2} ${y2} A${r0} ${r0} 0 ${big} 0 ${x3} ${y3} Z`;
}

// Sequential blue ramp, light (cheap) → dark (expensive).
const RAMP = ['#cde2fb', '#b7d3f6', '#9ec5f4', '#86b6ef', '#6da7ec', '#3987e5', '#256abf', '#184f95'];
// Past this step the fill is too dark for black labels.
const DARK_FROM = 5;

const mk = (tag, attrs) => {
  const n = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
};

/**
 * Draw the plan. `cells` is the per (area, row) summary. `onPick` receives the
 * chosen cell ({area, row}) or null to clear.
 */
/** Numeric extent of a row label, for merging spans: "18 ~ 28段" -> [18, 28]. */
function rowExtent(row) {
  const ns = (String(row || '').match(/\d+/g) || []).map(Number);
  return ns.length ? [Math.min(...ns), Math.max(...ns)] : null;
}

/**
 * A wedge can only carry so many rings before they become unreadable slivers —
 * Jingu's left field alone has 29 distinct row ranges. Past the limit, adjacent
 * depth bands are merged and labelled with the span they actually cover, so the
 * aggregation stays visible rather than silently dropping rows.
 */
function limitBands(list, max = 6) {
  if (list.length <= max) return list;
  const sorted = [...list].sort((a, b) => a.order - b.order);
  const per = Math.ceil(sorted.length / max);
  const out = [];
  for (let i = 0; i < sorted.length; i += per) {
    const chunk = sorted.slice(i, i + per);
    const ext = chunk.map((c) => rowExtent(c.row)).filter(Boolean);
    const span = ext.length
      ? `${Math.min(...ext.map((e) => e[0]))} ~ ${Math.max(...ext.map((e) => e[1]))}단`
      : `${chunk.length}개 구간`;
    out.push({
      zone: chunk[0].zone,
      row: span,
      rows: chunk.map((c) => c.row),
      order: chunk[0].order,
      min: Math.min(...chunk.map((c) => c.min)),
      median: Math.min(...chunk.map((c) => c.median)),
      count: chunk.reduce((a, c) => a + c.count, 0),
      areas: [...new Set(chunk.flatMap((c) => c.areas))],
      merged: chunk.length > 1,
    });
  }
  return out;
}

export function stadiumMap(cells, { yen, onPick, selected } = {}) {
  const placed = cells.filter((c) => zoneOf(c.area));
  if (!placed.length) return null;

  const mins = placed.map((c) => c.min);
  const lo = Math.min(...mins), hi = Math.max(...mins);
  const step = (v) => (hi === lo ? 2 : Math.min(RAMP.length - 1,
    Math.floor(((v - lo) / (hi - lo)) * RAMP.length)));

  const W = 420, H = 400, cx = W / 2, cy = 208;
  const R0 = 104, R1 = 182;

  const svg = mk('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img',
    'aria-label': '구장 좌석 구역·열별 최저가 개략도' });
  svg.style.cssText = 'width:100%;max-width:420px;height:auto;display:block';

  // Field: outfield arc plus the infield diamond, purely for orientation.
  svg.append(mk('path', {
    d: `M${cx} ${cy + 74} L${cx - 70} ${cy + 4} A100 100 0 0 1 ${cx + 70} ${cy + 4} Z`,
    fill: 'var(--wash)', stroke: 'var(--grid)', 'stroke-width': 1,
  }));
  svg.append(mk('path', {
    d: `M${cx} ${cy + 74} L${cx - 32} ${cy + 42} L${cx} ${cy + 10} L${cx + 32} ${cy + 42} Z`,
    fill: 'none', stroke: 'var(--axis)', 'stroke-width': 1.5,
  }));

  // Collapse to (zone, row). Venues like Jingu split an area further by block
  // letter ("レフト (Xブロック)"), but nothing tells us where block X sits, so
  // drawing each as its own band produces unreadable slivers that claim a
  // precision we don't have. The table below keeps the full breakdown.
  const merged = new Map();
  for (const c of placed) {
    const z = zoneOf(c.area);
    const key = `${z}\u0000${c.row || ''}`;
    const cur = merged.get(key);
    if (!cur) {
      merged.set(key, { zone: z, row: c.row || '', rows: [c.row || ''],
        order: c.order ?? 9999, min: c.min, median: c.median, count: c.count,
        areas: [c.area] });
    } else {
      cur.min = Math.min(cur.min, c.min);
      cur.median = Math.min(cur.median, c.median);
      cur.count += c.count;
      cur.order = Math.min(cur.order, c.order ?? 9999);
      if (!cur.areas.includes(c.area)) cur.areas.push(c.area);
    }
  }
  const bands = [...merged.values()];

  for (const z of ZONES) {
    // Front rows innermost — that is what the radial axis means.
    const own = limitBands(bands.filter((c) => c.zone === z.id))
      .sort((a, b) => (a.order ?? 9999) - (b.order ?? 9999));

    if (!own.length) {
      svg.append(mk('path', {
        d: sector(cx, cy, R0, R1, z.a0 + 1.2, z.a1 - 1.2),
        fill: 'var(--wash)', stroke: 'var(--surface-1)', 'stroke-width': 2,
      }));
      continue;
    }

    const band = (R1 - R0) / own.length;
    own.forEach((c, i) => {
      const r0 = R0 + band * i;
      const r1 = r0 + band;
      const on = selected && selected.zone === c.zone && selected.row === c.row;
      const path = mk('path', {
        d: sector(cx, cy, r0 + 0.6, r1 - 0.6, z.a0 + 1.2, z.a1 - 1.2),
        fill: RAMP[step(c.min)],
        stroke: on ? 'var(--ink)' : 'var(--surface-1)',
        'stroke-width': on ? 2.5 : 1.2,
        cursor: 'pointer',
      });
      path.addEventListener('click', () => onPick?.(on ? null
        : { zone: c.zone, row: c.row, rows: c.rows ?? [c.row], label: z.label }));
      const title = mk('title', {});
      title.textContent =
        `${z.label}\n${c.row || '열 미기재'}${c.merged ? ' (여러 구간 묶음)' : ''}\n` +
        `최저 ${yen(c.min)} · ${c.count}건\n${c.areas.join(', ')}`;
      path.append(title);
      svg.append(path);

      // Label only bands thick enough to hold text without collision.
      if (band >= 15) {
        const mid = (z.a0 + z.a1) / 2;
        const r = (r0 + r1) / 2;
        const t = mk('text', {
          x: cx + r * Math.cos(rad(mid)), y: cy + r * Math.sin(rad(mid)) + 4,
          'text-anchor': 'middle', 'font-size': 10, 'font-weight': 700,
          fill: step(c.min) >= DARK_FROM ? '#ffffff' : '#0b0b0b', 'pointer-events': 'none',
        });
        t.textContent = yen(c.min).replace('¥', '');
        svg.append(t);
      }
    });
  }

  // Orientation cues — without them the fan is an abstract donut.
  const home = mk('text', {
    x: cx, y: cy + 92, 'text-anchor': 'middle', 'font-size': 10, fill: 'var(--muted)',
  });
  home.textContent = '홈플레이트';
  svg.append(home);

  const depth = mk('text', {
    x: cx, y: H - 8, 'text-anchor': 'middle', 'font-size': 10, fill: 'var(--muted)',
  });
  depth.textContent = '안쪽 = 앞열 · 바깥쪽 = 뒷열';
  svg.append(depth);

  const placedCount = bands.reduce((a, b) => a + b.count, 0);
  const totalCount = cells.reduce((a, c) => a + (c.count || 0), 0);
  return { svg, coverage: totalCount ? placedCount / totalCount : 0 };
}

export { ZONES };

/* ------------------------------------------------------------------ real map */

// Join key shared by geojson polygons and my parsed price cells. The site is
// inconsistent — "STAR SIDE" vs "STARSIDE・3塁側", "51 ~ 67段" vs "51 ~ 67" —
// so spaces, 段/列 and ・ are stripped before comparing.
const jkey = (s) => String(s || '').replace(/[\s段列・]/g, '').toUpperCase();

/** Cheapest cell matching a polygon: exact (side,row) first, then side alone. */
function priceForPoly(poly, byRow, bySide) {
  const rk = jkey(poly.side) + '|' + jkey(poly.row);
  if (byRow.has(rk)) return byRow.get(rk);
  const sk = jkey(poly.side);
  return bySide.has(sk) ? bySide.get(sk) : null;
}

/**
 * Render the real TicketJam stadium plan: actual seat polygons coloured by the
 * cheapest listing that joins to each. `geo` is the cached {polys, bounds};
 * `cells` is my per-(area,row) price summary. `onPick({area,row})` filters.
 */
export function realStadiumMap(geo, cells, { yen, onPick, selected, detail } = {}) {
  const byRow = new Map(), bySide = new Map();
  for (const c of cells) {
    byRow.set(jkey(c.area) + '|' + jkey(c.row), c.min);
    const sk = jkey(c.area);
    if (!bySide.has(sk) || c.min < bySide.get(sk)) bySide.set(sk, c.min);
  }

  // Polygon ids are per-event AND some venues serve a different map version per
  // event, so detail collected against one version won't id-match another.
  // Only trust detail when its ids actually belong to THIS geojson.
  let exactMap = detail || null;
  if (exactMap) {
    const gIds = new Set(geo.polys.map((p) => p.id));
    const dIds = Object.keys(exactMap).map(Number);
    const hit = dIds.filter((id) => gIds.has(id)).length;
    if (!dIds.length || hit / dIds.length < 0.5) exactMap = null;
  }

  // Exact per-polygon pricing (from the seat-map API) wins over the coarse
  // (side,row) text join, which paints a whole row one colour.
  const priced = geo.polys
    .map((p) => {
      const d = exactMap?.[p.id];
      if (d) return { ...p, price: d.min, count: d.count, ticketUrl: d.url, exact: true };
      // With authoritative detail, an unlisted polygon stays blank rather than
      // borrowing its row's price. Only the text-join map colours by fallback.
      return { ...p, price: exactMap ? null : priceForPoly(p, byRow, bySide) };
    })
    .filter((p) => p.price != null);
  if (!priced.length) return null;

  const mins = priced.map((p) => p.price);
  const lo = Math.min(...mins), hi = Math.max(...mins);
  const step = (v) => (hi === lo ? 2 : Math.min(RAMP.length - 1,
    Math.floor(((v - lo) / (hi - lo)) * RAMP.length)));

  const { minX, minY, maxX, maxY } = geo.bounds;
  const W = 640, H = 620, pad = 12;
  const sx = (x) => pad + ((x - minX) / (maxX - minX)) * (W - pad * 2);
  const sy = (y) => pad + ((maxY - y) / (maxY - minY)) * (H - pad * 2); // flip Y

  const svg = mk('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img',
    'aria-label': '구장 실제 좌석 배치도 · 구역별 최저가' });
  svg.style.cssText = 'width:100%;max-width:560px;height:auto;display:block;margin:6px auto 0';

  const path = (rings) => rings.map((r) =>
    'M' + r.map(([x, y]) => `${sx(x).toFixed(1)} ${sy(y).toFixed(1)}`).join('L') + 'Z').join(' ');

  // Unpriced blocks first as a faint base, so the coloured ones read on top.
  for (const p of geo.polys) {
    if (p.price != null) continue;
    svg.append(mk('path', { d: path(p.g), fill: 'var(--wash)',
      stroke: 'var(--surface-1)', 'stroke-width': 0.5 }));
  }

  for (const p of priced) {
    const on = selected && (selected.id != null
      ? selected.id === p.id
      : jkey(selected.area) === jkey(p.side) && (selected.row == null || jkey(selected.row) === jkey(p.row)));
    const el = mk('path', {
      d: path(p.g),
      fill: RAMP[step(p.price)],
      stroke: on ? 'var(--ink)' : 'var(--surface-1)',
      'stroke-width': on ? 1.6 : 0.5,
      cursor: 'pointer',
    });
    el.addEventListener('click', () => onPick?.(on ? null
      : { area: p.side, row: p.row, seat: p.seat, id: p.id, ticketUrl: p.ticketUrl, exact: p.exact, price: p.price, count: p.count }));
    const t = mk('title', {});
    t.textContent = `${p.side}${p.row ? ' · ' + p.row + '段' : ''}` +
      `${p.seat ? ' · ' + p.seat + '番' : ''}\n최저 ${yen(p.price)}` +
      `${p.exact ? ` · ${p.count}건` : ' (근사)'}`;
    el.append(t);
    svg.append(el);
  }

  // Field marker for orientation.
  const cxp = sx((minX + maxX) / 2);
  const lab = mk('text', { x: cxp, y: H - 16, 'text-anchor': 'middle',
    'font-size': 11, fill: 'var(--muted)' });
  lab.textContent = 'グラウンド';
  svg.append(lab);

  // In exact mode detail is authoritative (every listed polygon placed), so
  // coverage is complete; the fraction only means something for the text join.
  return { svg, exact: !!exactMap, count: priced.length,
    coverage: exactMap ? 1 : (geo.polys.length ? priced.length / geo.polys.length : 0) };
}
