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

const dayKey = (iso) => iso.slice(0, 10);
let state = { data: null, open: new Set(), timer: null };

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

/**
 * Compact single-series trend line. No axes or legend — the card's own
 * "최저가" label names the series.
 */
function sparkline(snapshots) {
  const w = 140, h = 38, pad = 3;
  const vals = snapshots.map((s) => s.min);
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
  // 2px surface ring keeps the end dot legible where it overlaps the line.
  const last = pts.at(-1);
  svg.append(mk('circle', {
    cx: last.x, cy: last.y, r: 3.5,
    fill: 'var(--series-1)', stroke: 'var(--surface-1)', 'stroke-width': 2,
  }));
  return svg;
}

/**
 * Full price-history chart: 최저가 + 중앙값 over time, with a hover crosshair.
 */
function historyChart(snapshots) {
  const w = 1000, h = 260;
  const m = { t: 14, r: 20, b: 28, l: 64 };
  const iw = w - m.l - m.r, ih = h - m.t - m.b;

  const times = snapshots.map((s) => new Date(s.t).getTime());
  const t0 = times[0], t1 = times.at(-1);
  const tSpan = t1 - t0 || 1;

  const all = snapshots.flatMap((s) => [s.min, s.median]).filter((v) => v != null);
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

  // recessive gridlines + y ticks
  for (const v of scale.vals) {
    const y = Y(v);
    svg.append(mk('line', {
      x1: m.l, x2: m.l + iw, y1: y, y2: y, stroke: 'var(--grid)', 'stroke-width': 1,
    }));
    const lab = mk('text', {
      x: m.l - 8, y: y + 4, 'text-anchor': 'end',
      fill: 'var(--muted)', 'font-size': 11,
    });
    lab.textContent = yen(Math.round(v));
    svg.append(lab);
  }
  svg.append(mk('line', {
    x1: m.l, x2: m.l + iw, y1: m.t + ih, y2: m.t + ih,
    stroke: 'var(--axis)', 'stroke-width': 1,
  }));

  // x labels: first and last only, so ticks never collide
  for (const [t, anchor] of [[t0, 'start'], [t1, 'end']]) {
    if (t0 === t1 && anchor === 'end') break;
    const lab = mk('text', {
      x: X(t), y: h - 8, 'text-anchor': anchor, fill: 'var(--muted)', 'font-size': 11,
    });
    lab.textContent = JST.stamp.format(new Date(t));
    svg.append(lab);
  }

  const series = [
    { key: 'min', name: '최저가', color: 'var(--series-1)' },
    { key: 'median', name: '중앙값', color: 'var(--series-2)' },
  ];

  for (const s of series) {
    const pts = snapshots
      .map((snap, i) => ({ x: X(times[i]), y: Y(snap[s.key]), v: snap[s.key] }))
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

  // hover crosshair
  const cross = mk('line', {
    y1: m.t, y2: m.t + ih, stroke: 'var(--axis)', 'stroke-width': 1, opacity: 0,
  });
  svg.append(cross);
  const dots = series.map((s) => {
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
    series.forEach((s, i) => {
      dots[i].setAttribute('cx', x);
      dots[i].setAttribute('cy', Y(snap[s.key]));
      dots[i].setAttribute('opacity', Number.isFinite(snap[s.key]) ? 1 : 0);
    });
    tip.innerHTML =
      `<div class="tt-t">${JST.stamp.format(new Date(snap.t))}</div>` +
      series.map((s) =>
        `<div class="tt-r"><span><span class="sw" style="background:${s.color};` +
        `display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:5px"></span>` +
        `${s.name}</span><b>${yen(snap[s.key])}</b></div>`).join('') +
      `<div class="tt-r"><span>출품</span><b>${snap.count}건</b></div>`;
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

function deltaNode(snaps) {
  const d = document.createElement('div');
  if (snaps.length < 2) {
    // Nothing to compare against yet; the sparkline slot carries the notice.
    d.className = 'delta flat';
    d.textContent = '';
    return d;
  }
  const diff = snaps.at(-1).min - snaps.at(-2).min;
  d.className = 'delta ' + (diff < 0 ? 'down' : diff > 0 ? 'up' : 'flat');
  d.textContent = diff === 0 ? '변동 없음' : `${diff < 0 ? '▼' : '▲'} ${yen(Math.abs(diff))}`;
  return d;
}

function gameCard(g) {
  const card = document.createElement('article');
  card.className = 'game';

  const head = document.createElement('div');
  head.className = 'game-head';
  head.innerHTML = `
    <div class="game-id">
      <div class="matchup">${g.name}<span class="badge">${g.region}</span></div>
      <div class="where">${JST.time.format(new Date(g.startDate))} · ${g.venue}</div>
    </div>
    <div class="meta-num">출품 ${g.stats.count}건<br>중앙값 ${yen(g.stats.median)}</div>
    <div class="price-block">
      <div class="k">최저가</div>
      <div class="v">${yen(g.stats.min)}</div>
    </div>`;

  head.querySelector('.price-block').append(deltaNode(g.history));

  if (g.history.length >= 2) {
    head.append(sparkline(g.history));
  } else {
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
      `<span><span class="sw" style="background:var(--series-1)"></span>최저가</span>` +
      `<span><span class="sw" style="background:var(--series-2)"></span>중앙값</span>`;
    body.append(legend);

    const wrap = document.createElement('div');
    wrap.className = 'chart-wrap';
    if (g.history.length) wrap.append(historyChart(g.history));
    body.append(wrap);

    const table = document.createElement('table');
    table.innerHTML =
      `<thead><tr><th class="num">가격</th><th class="num">매수</th>` +
      `<th>좌석</th><th>수령</th><th></th></tr></thead><tbody>` +
      g.cheapest.slice(0, 15).map((l) => `
        <tr>
          <td class="num"><b>${yen(l.price)}</b></td>
          <td class="num">${l.qty ?? '—'}</td>
          <td class="seat">${l.seat || '—'}</td>
          <td class="tags">${l.tags.join(' · ')}</td>
          <td>${l.url ? `<a href="https://ticketjam.jp${l.url}" target="_blank" rel="noopener">보기</a>` : ''}</td>
        </tr>`).join('') +
      `</tbody>`;
    body.append(table);

    const link = document.createElement('p');
    link.innerHTML = `<a href="${g.url}" target="_blank" rel="noopener">티켓잼에서 전체 ${g.stats.count}건 보기 →</a>`;
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

function render(data) {
  state.data = data;
  const games = data.games ?? [];

  // controls reflect stored config
  el('#start').value = data.config?.trip?.start ?? '';
  el('#end').value = data.config?.trip?.end ?? '';
  for (const box of document.querySelectorAll('.regions input')) {
    box.checked = (data.config?.regions ?? []).includes(box.value);
  }

  // status line
  const st = el('#status');
  st.classList.toggle('busy', !!data.status?.running);
  const stamp = data.generatedAt ? JST.stamp.format(new Date(data.generatedAt)) : '없음';
  st.innerHTML =
    `<span><span class="dot"></span>${data.status?.running ? '갱신 중…' : '대기 중'}</span>` +
    `<span>최근 갱신 ${stamp} (JST)</span>` +
    `<span>자동 갱신 ${data.config?.refreshMinutes ?? 30}분마다</span>`;

  // stat tiles
  const mins = games.map((g) => g.stats.min).filter((v) => v != null);
  const tiles = [
    ['경기 수', games.length, `${data.trip?.start ?? ''} ~ ${data.trip?.end ?? ''}`],
    ['최저가', yen(mins.length ? Math.min(...mins) : null), '전체 경기 중'],
    ['평균 최저가', yen(mins.length ? Math.round(mins.reduce((a, b) => a + b, 0) / mins.length) : null), '경기별 최저가 평균'],
    ['총 출품', games.reduce((s, g) => s + g.stats.count, 0).toLocaleString(), '수집된 리세일 건수'],
  ];
  el('#tiles').innerHTML = tiles
    .map(([k, v, n]) => `<div class="tile"><div class="k">${k}</div><div class="v">${v}</div><div class="n">${n}</div></div>`)
    .join('');

  // games grouped by JST date
  const root = el('#games');
  root.innerHTML = '';
  if (!games.length) {
    root.innerHTML = `<div class="empty">${data.generatedAt
      ? '이 기간·지역에는 등록된 경기가 없습니다. 날짜나 지역을 넓혀보세요.'
      : '아직 수집된 데이터가 없습니다. “지금 갱신”을 눌러주세요.'}</div>`;
  } else {
    const byDay = new Map();
    for (const g of games) {
      const k = dayKey(g.startDate);
      (byDay.get(k) ?? byDay.set(k, []).get(k)).push(g);
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
  }

  el('#errors').innerHTML = (data.errors ?? []).length
    ? `<div class="err">일부 항목 수집 실패 (${data.errors.length}건): ${data.errors.slice(0, 3).join(' / ')}</div>`
    : '';
}

/* ------------------------------------------------------------------- wiring */

async function load() {
  const res = await fetch('/api/data');
  const data = await res.json();
  render(data);
  // While a refresh runs, poll faster so the page fills in as it finishes.
  clearTimeout(state.timer);
  state.timer = setTimeout(load, data.status?.running ? 3000 : 60_000);
}

el('#refresh').addEventListener('click', async () => {
  el('#refresh').disabled = true;
  await fetch('/api/refresh', { method: 'POST' });
  setTimeout(() => { el('#refresh').disabled = false; load(); }, 600);
});

el('#apply').addEventListener('click', async () => {
  const regions = [...document.querySelectorAll('.regions input:checked')].map((b) => b.value);
  await fetch('/api/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      trip: { start: el('#start').value, end: el('#end').value },
      regions,
    }),
  });
  setTimeout(load, 600);
});

load();
