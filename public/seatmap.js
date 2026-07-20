// Schematic stadium plan. Not a real seating chart — an annular fan of zones
// around the field, good enough to answer "where in the park is the cheap
// seat" at a glance. Only venues whose area names carry meaning are drawn;
// grid-code venues (Tokyo Dome's "A01エリア", Belluna's "112ブロック",
// Jingu's "入口14") would need a genuine seat map to place, so they fall back
// to the table rather than inventing positions.

const SVGNS = 'http://www.w3.org/2000/svg';

// 0° points to centre field; angles run clockwise. Ranges tile the full ring.
const ZONES = [
  { id: 'center', label: '외야 중앙', a0: -25, a1: 25 },
  { id: 'right', label: '라이트(우익)', a0: 25, a1: 75 },
  { id: 'rightwing', label: '라이트 윙', a0: 75, a1: 105 },
  { id: 'first', label: '1루측 내야', a0: 105, a1: 150 },
  { id: 'backnet', label: '백네트 뒤', a0: 150, a1: 210 },
  { id: 'third', label: '3루측 내야', a0: 210, a1: 255 },
  { id: 'leftwing', label: '레프트 윙', a0: 255, a1: 285 },
  { id: 'left', label: '레프트(좌익)', a0: 285, a1: 335 },
];

/**
 * Map a venue's area string onto a schematic zone.
 * Order matters: the wing checks must precede the plain left/right checks,
 * and ネット裏 precedes the base-side checks because Yokohama's names combine
 * both ("BAYSIDE・ネット裏").
 */
export function zoneOf(area) {
  const a = String(area || '');
  if (!a || a === '구역 미기재') return null;
  if (/ネット裏|バックネット/.test(a)) return 'backnet';
  if (/レフトウィング|レフト側ウィング/.test(a)) return 'leftwing';
  if (/ライトウィング|ライト側ウィング/.test(a)) return 'rightwing';
  if (/ウイングフロント|ウィング/.test(a)) return null; // side unknown
  if (/レフト/.test(a)) return 'left';
  if (/ライト/.test(a)) return 'right';
  if (/センター/.test(a)) return 'center';
  if (/3塁|三塁/.test(a)) return 'third';
  if (/1塁|一塁/.test(a)) return 'first';
  return null;
}

/** True when enough of a venue's listings can actually be placed. */
export function isMappable(areas) {
  const total = areas.reduce((s, a) => s + a.count, 0);
  if (!total) return false;
  const placed = areas.reduce((s, a) => (zoneOf(a.area) ? s + a.count : s), 0);
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
const RAMP = ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95'];

const mk = (tag, attrs) => {
  const n = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
};

/**
 * Draw the plan. `areas` is the per-area summary; `onPick` receives the zone
 * id (or null to clear) when a zone is clicked.
 */
export function stadiumMap(areas, { yen, onPick, selected } = {}) {
  // Collapse areas onto zones, keeping the cheapest offer per zone.
  const byZone = new Map();
  for (const a of areas) {
    const z = zoneOf(a.area);
    if (!z) continue;
    const cur = byZone.get(z);
    if (!cur) byZone.set(z, { min: a.min, count: a.count, names: [a.area] });
    else {
      cur.min = Math.min(cur.min, a.min);
      cur.count += a.count;
      cur.names.push(a.area);
    }
  }
  if (!byZone.size) return null;

  const mins = [...byZone.values()].map((z) => z.min);
  const lo = Math.min(...mins), hi = Math.max(...mins);
  const shade = (v) => (hi === lo ? RAMP[2] : RAMP[Math.min(RAMP.length - 1,
    Math.floor(((v - lo) / (hi - lo)) * RAMP.length))]);

  const W = 360, H = 330, cx = W / 2, cy = 172;
  const svg = mk('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img',
    'aria-label': '구장 좌석 구역별 최저가 개략도' });
  svg.style.cssText = 'width:100%;max-width:360px;height:auto;display:block';

  // Field: outfield arc plus the infield diamond, purely for orientation.
  svg.append(mk('path', {
    d: `M${cx} ${cy + 78} L${cx - 74} ${cy + 4} A104 104 0 0 1 ${cx + 74} ${cy + 4} Z`,
    fill: 'var(--wash)', stroke: 'var(--grid)', 'stroke-width': 1,
  }));
  svg.append(mk('path', {
    d: `M${cx} ${cy + 78} L${cx - 34} ${cy + 44} L${cx} ${cy + 10} L${cx + 34} ${cy + 44} Z`,
    fill: 'none', stroke: 'var(--axis)', 'stroke-width': 1.5,
  }));

  for (const z of ZONES) {
    const data = byZone.get(z.id);
    const on = selected === z.id;
    const path = mk('path', {
      d: sector(cx, cy, 108, 150, z.a0 + 1.5, z.a1 - 1.5),
      fill: data ? shade(data.min) : 'var(--wash)',
      stroke: on ? 'var(--ink)' : 'var(--surface-1)',
      'stroke-width': on ? 2.5 : 2,
      cursor: data ? 'pointer' : 'default',
    });
    if (data) {
      path.addEventListener('click', () => onPick?.(on ? null : z.id));
      const title = mk('title', {});
      title.textContent = `${z.label} — 최저 ${yen(data.min)} · ${data.count}건\n${data.names.join(', ')}`;
      path.append(title);
    }
    svg.append(path);

    // Price label sits on the band; zone names go in the legend below.
    if (data) {
      const mid = (z.a0 + z.a1) / 2;
      const r = 129;
      const x = cx + r * Math.cos(rad(mid));
      const y = cy + r * Math.sin(rad(mid));
      const t = mk('text', {
        x, y: y + 4, 'text-anchor': 'middle', 'font-size': 11, 'font-weight': 700,
        fill: '#0b0b0b', 'pointer-events': 'none',
      });
      t.textContent = yen(data.min).replace('¥', '');
      svg.append(t);
    }
  }

  // Orientation cue — without it the fan is just an abstract donut.
  const home = mk('text', {
    x: cx, y: cy + 96, 'text-anchor': 'middle', 'font-size': 10, fill: 'var(--muted)',
  });
  home.textContent = '홈플레이트';
  svg.append(home);

  return { svg, zones: byZone };
}

export { ZONES };
