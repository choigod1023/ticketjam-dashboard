const yen = (n) => (n == null ? '—' : '¥' + n.toLocaleString('ja-JP'));
const el = (sel) => document.querySelector(sel);

const JST = {
  day: new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Tokyo', month: 'long', day: 'numeric', weekday: 'short',
  }),
  time: new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit',
  }),
  stamp: new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }),
};

const state = {
  data: null,
  mode: 'one',        // 'one' = 1매 구매 가능한 매물만, 'all' = 전체
  open: new Set(),
  live: false,        // true when a local server is backing the page
  timer: null,
};

/* ------------------------------------------------------------------ charts */

const SVG = 'http://www.w3.org/2000/svg';
const mk = (tag, attrs) => {
  const n = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
};

const linePath = (pts) => pts.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(' ');

/** Round a value span out to human-readable tick steps (1/2/2.5/5 x 10^n). */
function niceScale(lo, hi, want = 4) {
  const raw = (hi - lo || Math.max(1, hi)) / want;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const n = raw / mag;
  const step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
  const start = Math.max(0, Math.floor(lo / step) * step);
  const end = Math.ceil(hi / step) * step;
  const vals = [];
  for (let v = start; v <= end + step / 1000; v += step) vals.push(v);
  return { lo: start, hi: end, vals };
}

const series = (snap, mode) => snap[mode] ?? {};

/** Compact single-series trend line — the card's "최저가" label names it. */
function sparkline(snapshots, mode) {
  const w = 140, h = 38, pad = 3;
  const vals = snapshots.map((s) => series(s, mode).min).filter((v) => v != null);
  if (vals.length < 2) return null;
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const span = hi - lo || 1;
  const svg = mk('svg', { width: w, height: h, viewBox: `0 0 ${w} ${h}`, role: 'img' });
  svg.setAttribute('aria-label', `최저가 추이 ${yen(vals[0])} → ${yen(vals.at(-1))}`);

  const pts = vals.map((v, i) => ({
    x: pad + (i * (w - pad * 2)) / Math.max(1, vals.length - 1),
    y: h - pad - ((v - lo) / span) * (h - pad * 2),
  }));
  svg.append(mk('path', {
    d: linePath(pts), fill: 'none', stroke: 'var(--series-1)',
    'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round',
  }));
  const last = pts.at(-1);
  svg.append(mk('circle', {
    cx: last.x, cy: last.y, r: 3.5,
    fill: 'var(--series-1)', stroke: 'var(--surface-1)', 'stroke-width': 2,
  }));
  return svg;
}

/** Full price-history chart: 최저가 + 중앙값 over time, with a hover crosshair. */
function historyChart(snapshots, mode) {
  const w = 1000, h = 260;
  const m = { t: 14, r: 20, b: 28, l: 64 };
  const iw = w - m.l - m.r, ih = h - m.t - m.b;

  const times = snapshots.map((s) => new Date(s.t).getTime());
  const t0 = times[0], t1 = times.at(-1);
  const tSpan = t1 - t0 || 1;

  const all = snapshots
    .flatMap((s) => [series(s, mode).min, series(s, mode).median, s.resale?.min])
    .filter((v) => v != null);
  if (!all.length) return null;

  const rawLo = Math.min(...all), rawHi = Math.max(...all);
  const padY = (rawHi - rawLo) * 0.12 || Math.max(200, rawHi * 0.05);
  const scale = niceScale(Math.max(0, rawLo - padY), rawHi + padY);
  const lo = scale.lo, hi = scale.hi;
  const ySpan = hi - lo || 1;

  const X = (t) => m.l + ((t - t0) / tSpan) * iw;
  const Y = (v) => m.t + ih - ((v - lo) / ySpan) * ih;

  const svg = mk('svg', {
    viewBox: `0 0 ${w} ${h}`, role: 'img',
    'aria-label': '경기별 최저가·중앙값 추이',
  });
  // Let the viewBox drive the aspect ratio so the plot fills the card width
  // instead of letterboxing inside a fixed height.
  svg.style.cssText = 'width:100%;height:auto;min-width:520px;display:block';

  for (const v of scale.vals) {
    const y = Y(v);
    svg.append(mk('line', {
      x1: m.l, x2: m.l + iw, y1: y, y2: y, stroke: 'var(--grid)', 'stroke-width': 1,
    }));
    const lab = mk('text', {
      x: m.l - 8, y: y + 4, 'text-anchor': 'end', fill: 'var(--muted)', 'font-size': 11,
    });
    lab.textContent = yen(Math.round(v));
    svg.append(lab);
  }
  svg.append(mk('line', {
    x1: m.l, x2: m.l + iw, y1: m.t + ih, y2: m.t + ih,
    stroke: 'var(--axis)', 'stroke-width': 1,
  }));

  for (const [t, anchor] of [[t0, 'start'], [t1, 'end']]) {
    if (t0 === t1 && anchor === 'end') break;
    const lab = mk('text', {
      x: X(t), y: h - 8, 'text-anchor': anchor, fill: 'var(--muted)', 'font-size': 11,
    });
    lab.textContent = JST.stamp.format(new Date(t));
    svg.append(lab);
  }

  const defs = [
    { name: '티켓잼 최저', color: 'var(--series-1)', at: (sn) => series(sn, mode).min },
    { name: '티켓잼 중앙', color: 'var(--series-2)', at: (sn) => series(sn, mode).median },
  ];
  // Only plot the second source if it was actually collected for this game.
  if (snapshots.some((sn) => sn.resale?.min != null)) {
    defs.push({ name: 'チケ流 최저', color: 'var(--series-3)', at: (sn) => sn.resale?.min });
  }

  for (const s of defs) {
    const pts = snapshots
      .map((snap, i) => ({ x: X(times[i]), y: Y(s.at(snap)), v: s.at(snap) }))
      .filter((p) => Number.isFinite(p.y));
    if (!pts.length) continue;

    if (pts.length === 1) {
      svg.append(mk('circle', {
        cx: pts[0].x, cy: pts[0].y, r: 4.5, fill: s.color,
        stroke: 'var(--surface-1)', 'stroke-width': 2,
      }));
    } else {
      svg.append(mk('path', {
        d: linePath(pts), fill: 'none', stroke: s.color,
        'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round',
      }));
    }
    // direct label at the series end — identity never rests on color alone
    const last = pts.at(-1);
    const lab = mk('text', {
      x: Math.min(last.x + 6, w - 2), y: last.y - 7,
      'text-anchor': last.x > m.l + iw - 60 ? 'end' : 'start',
      fill: 'var(--ink-2)', 'font-size': 11, 'font-weight': 600,
    });
    lab.textContent = `${s.name} ${yen(last.v)}`;
    svg.append(lab);
  }

  const cross = mk('line', {
    y1: m.t, y2: m.t + ih, stroke: 'var(--axis)', 'stroke-width': 1, opacity: 0,
  });
  svg.append(cross);
  const dots = defs.map((s) => {
    const d = mk('circle', {
      r: 4.5, fill: s.color, stroke: 'var(--surface-1)', 'stroke-width': 2, opacity: 0,
    });
    svg.append(d);
    return d;
  });

  const tip = el('#tooltip');
  svg.addEventListener('pointermove', (ev) => {
    const box = svg.getBoundingClientRect();
    const sx = ((ev.clientX - box.left) / box.width) * w;
    let best = 0, bestD = Infinity;
    times.forEach((t, i) => {
      const d = Math.abs(X(t) - sx);
      if (d < bestD) { bestD = d; best = i; }
    });
    const snap = snapshots[best];
    const x = X(times[best]);
    cross.setAttribute('x1', x); cross.setAttribute('x2', x); cross.setAttribute('opacity', 1);
    defs.forEach((s, i) => {
      const v = s.at(snap);
      dots[i].setAttribute('cx', x);
      dots[i].setAttribute('cy', Y(v));
      dots[i].setAttribute('opacity', Number.isFinite(v) ? 1 : 0);
    });
    tip.innerHTML =
      `<div class="tt-t">${JST.stamp.format(new Date(snap.t))}</div>` +
      defs.map((s) =>
        `<div class="tt-r"><span><span class="sw" style="background:${s.color}"></span>` +
        `${s.name}</span><b>${yen(s.at(snap))}</b></div>`).join('') +
      `<div class="tt-r"><span>매물</span><b>${series(snap, mode).count}건</b></div>`;
    tip.classList.add('on');
    tip.style.left = Math.min(ev.clientX + 14, innerWidth - 190) + 'px';
    tip.style.top = ev.clientY + 14 + 'px';
  });
  svg.addEventListener('pointerleave', () => {
    cross.setAttribute('opacity', 0);
    dots.forEach((d) => d.setAttribute('opacity', 0));
    tip.classList.remove('on');
  });

  return svg;
}

/* ------------------------------------------------------------------ render */

function deltaNode(snaps, mode) {
  const vals = snaps.map((s) => series(s, mode).min).filter((v) => v != null);
  const d = document.createElement('div');
  if (vals.length < 2) {
    d.className = 'delta flat';
    d.textContent = '';
    return d;
  }
  const diff = vals.at(-1) - vals.at(-2);
  d.className = 'delta ' + (diff < 0 ? 'down' : diff > 0 ? 'up' : 'flat');
  d.textContent = diff === 0 ? '변동 없음' : `${diff < 0 ? '▼' : '▲'} ${yen(Math.abs(diff))}`;
  return d;
}

function gameCard(g) {
  const v = g[state.mode];
  const card = document.createElement('article');
  card.className = 'game';

  const head = document.createElement('div');
  head.className = 'game-head';
  head.innerHTML = `
    <div class="game-id">
      <div class="matchup">${g.name}<span class="badge">${g.region}</span></div>
      <div class="where">${JST.time.format(new Date(g.startDate))} · ${g.venue}</div>
    </div>
    <div class="meta-num">매물 ${v.stats.count}건<br>중앙값 ${yen(v.stats.median)}</div>
    <div class="price-block">
      <div class="k">최저가</div>
      <div class="v">${yen(v.stats.min)}</div>
    </div>`;
  head.querySelector('.price-block').append(deltaNode(g.history, state.mode));

  if (g.resale) {
    const jam = v.stats.min, other = g.resale.min;
    const cmp = document.createElement('div');
    cmp.className = 'compare';
    cmp.innerHTML =
      `<span><span class="src">티켓잼</span> <b class="${jam <= other ? 'win' : ''}">${yen(jam)}</b></span>` +
      `<span><span class="src">チケ流${g.resale.source === 'official' ? '<span class="official">공식</span>' : ''}</span> ` +
      `<b class="${other < jam ? 'win' : ''}">${yen(other)}</b> <span class="src">(${g.resale.count}건)</span></span>` +
      (other < jam ? `<span class="src">→ チケ流가 ${yen(jam - other)} 저렴</span>` : '');
    head.querySelector('.game-id').append(cmp);
  }

  const spark = sparkline(g.history, state.mode);
  if (spark) head.append(spark);
  else {
    const ph = document.createElement('div');
    ph.className = 'spark-empty';
    ph.textContent = '추이 수집 중';
    head.append(ph);
  }

  const toggle = document.createElement('button');
  toggle.className = 'ghost';
  toggle.textContent = state.open.has(g.id) ? '닫기' : '상세';
  head.append(toggle);
  card.append(head);

  const body = document.createElement('div');
  body.className = 'game-body';
  body.hidden = !state.open.has(g.id);
  card.append(body);

  const fill = () => {
    body.innerHTML = '';
    const legend = document.createElement('div');
    legend.className = 'legend';
    legend.innerHTML =
      `<span><span class="sw" style="background:var(--series-1)"></span>티켓잼 최저</span>` +
      `<span><span class="sw" style="background:var(--series-2)"></span>티켓잼 중앙</span>` +
      (g.resale ? `<span><span class="sw" style="background:var(--series-3)"></span>チケ流 최저</span>` : '');
    body.append(legend);

    const wrap = document.createElement('div');
    wrap.className = 'chart-wrap';
    const chart = historyChart(g.history, state.mode);
    if (chart) wrap.append(chart);
    body.append(wrap);

    const table = document.createElement('table');
    table.innerHTML =
      `<thead><tr><th class="num">가격</th><th class="num">매수</th>` +
      `<th>좌석</th><th>수령</th><th></th></tr></thead><tbody>` +
      v.cheapest.slice(0, 15).map((l) => `
        <tr>
          <td class="num"><b>${yen(l.price)}</b></td>
          <td class="num">${l.qty ?? '—'}</td>
          <td class="seat">${l.restricted ? '<span class="warn">자격제한</span> ' : ''}${l.seat || '—'}</td>
          <td class="tags">${l.tags.join(' · ')}</td>
          <td>${l.url ? `<a href="https://ticketjam.jp${l.url}" target="_blank" rel="noopener">보기</a>` : ''}</td>
        </tr>`).join('') +
      `</tbody>`;
    body.append(table);

    const link = document.createElement('p');
    link.innerHTML = `<a href="${g.url}" target="_blank" rel="noopener">티켓잼에서 전체 보기 →</a>` +
      (g.resale ? ` &nbsp;·&nbsp; <a href="${g.resale.url}" target="_blank" rel="noopener">チケット流通センター에서 보기 →</a>` : '');
    link.style.cssText = 'font-size:13px;margin:12px 0 0';
    body.append(link);
  };

  if (state.open.has(g.id)) fill();
  toggle.addEventListener('click', () => {
    if (state.open.has(g.id)) {
      state.open.delete(g.id);
      body.hidden = true;
      toggle.textContent = '상세';
    } else {
      state.open.add(g.id);
      fill();
      body.hidden = false;
      toggle.textContent = '닫기';
    }
  });

  return card;
}

/** Apply the browser-side filters to whatever was collected. */
function visibleGames() {
  const games = state.data?.games ?? [];
  const start = el('#start').value;
  const end = el('#end').value;
  const regions = new Set(
    [...document.querySelectorAll('.regions input[value]:checked')].map((b) => b.value),
  );
  return games.filter((g) => {
    const day = g.startDate.slice(0, 10);
    if (start && day < start) return false;
    if (end && day > end) return false;
    if (regions.size && !regions.has(g.region)) return false;
    return g[state.mode].stats.count > 0;
  });
}

function render() {
  const data = state.data;
  if (!data) return;
  const games = visibleGames();

  const st = el('#status');
  st.classList.toggle('busy', !!data.status?.running);
  const stamp = data.generatedAt ? JST.stamp.format(new Date(data.generatedAt)) : '없음';
  st.innerHTML =
    `<span><span class="dot"></span>${data.status?.running ? '갱신 중…' : (state.live ? '로컬 실행 중' : '자동 갱신본')}</span>` +
    `<span>최근 수집 ${stamp} (JST)</span>` +
    `<span>수집 범위 ${data.trip?.start ?? '?'} ~ ${data.trip?.end ?? '?'}</span>`;

  const mins = games.map((g) => g[state.mode].stats.min).filter((v) => v != null);
  const tiles = [
    ['경기 수', games.length, state.mode === 'one' ? '1매 구매 가능' : '전체 매물'],
    ['최저가', yen(mins.length ? Math.min(...mins) : null), '표시된 경기 중'],
    ['평균 최저가', yen(mins.length ? Math.round(mins.reduce((a, b) => a + b, 0) / mins.length) : null), '경기별 최저가 평균'],
    ['총 매물', games.reduce((s, g) => s + g[state.mode].stats.count, 0).toLocaleString(), '자격제한 좌석 제외'],
  ];
  el('#tiles').innerHTML = tiles
    .map(([k, v, n]) => `<div class="tile"><div class="k">${k}</div><div class="v">${v}</div><div class="n">${n}</div></div>`)
    .join('');

  const root = el('#games');
  root.innerHTML = '';
  if (!games.length) {
    root.innerHTML = `<div class="empty">${data.generatedAt
      ? '조건에 맞는 경기가 없습니다. 날짜나 지역을 넓혀보세요.'
      : '아직 수집된 데이터가 없습니다.'}</div>`;
    return;
  }

  const byDay = new Map();
  for (const g of games) {
    const k = g.startDate.slice(0, 10);
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(g);
  }
  for (const [k, list] of [...byDay].sort()) {
    const sec = document.createElement('section');
    sec.className = 'day';
    const h = document.createElement('h2');
    h.textContent = `${JST.day.format(new Date(k + 'T12:00:00+09:00'))} · ${list.length}경기`;
    sec.append(h);
    const box = document.createElement('div');
    box.className = 'games';
    list.forEach((g) => box.append(gameCard(g)));
    sec.append(box);
    root.append(sec);
  }

  el('#errors').innerHTML = (data.errors ?? []).length
    ? `<div class="err">일부 항목 수집 실패 (${data.errors.length}건): ${data.errors.slice(0, 3).join(' / ')}</div>`
    : '';
}

/* ------------------------------------------------------------------- wiring */

// The published build is a plain static site with no API behind it; only a
// local run has one, so don't waste a 404 round trip on every load.
const MAYBE_LIVE = ['localhost', '127.0.0.1'].includes(location.hostname);

/** Prefer the local server; fall back to the statically published snapshot. */
async function fetchData() {
  if (MAYBE_LIVE) {
    try {
      const res = await fetch('/api/data', { cache: 'no-store' });
      if (res.ok) {
        state.live = true;
        return await res.json();
      }
    } catch {
      // Served from a file/static host on localhost — fall through.
    }
  }
  state.live = false;
  const res = await fetch('./data/latest.json', { cache: 'no-store' });
  if (!res.ok) throw new Error('데이터를 불러오지 못했습니다');
  return await res.json();
}

async function load() {
  try {
    state.data = await fetchData();
  } catch (err) {
    el('#games').innerHTML = `<div class="empty">${err.message}</div>`;
    return;
  }

  // Default the date inputs to the collected range on first load only.
  if (!el('#start').value) el('#start').value = state.data.trip?.start ?? '';
  if (!el('#end').value) el('#end').value = state.data.trip?.end ?? '';
  if (!document.querySelector('.regions input[value]:checked')) {
    for (const box of document.querySelectorAll('.regions input[value]')) {
      box.checked = (state.data.regions ?? []).includes(box.value);
    }
  }
  el('#one').checked = state.mode === 'one';
  el('#refresh').hidden = !state.live;

  render();
  clearTimeout(state.timer);
  state.timer = setTimeout(load, state.data.status?.running ? 3000 : 300_000);
}

// Filters are pure view state — re-render immediately, no round trip.
for (const sel of ['#start', '#end']) {
  el(sel).addEventListener('change', render);
}
for (const box of document.querySelectorAll('.regions input[value]')) {
  box.addEventListener('change', render);
}
el('#one').addEventListener('change', (e) => {
  state.mode = e.target.checked ? 'one' : 'all';
  render();
});

el('#refresh').addEventListener('click', async () => {
  el('#refresh').disabled = true;
  try {
    await fetch('/api/refresh', { method: 'POST' });
  } finally {
    setTimeout(() => { el('#refresh').disabled = false; load(); }, 600);
  }
});

load();
