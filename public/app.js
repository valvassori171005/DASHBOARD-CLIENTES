/* Dashboard de tráfego pago — front sem framework.
 * Consome /api/config, /api/meta e /api/google (mesmo contrato de resposta). */
'use strict';

// ---------- Formatação pt-BR ----------
let currency = 'BRL';
const fmt = {
  money: (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(v),
  moneyShort: (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 }).format(v),
  int: (v) => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(v),
  dec: (v) => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(v),
  pct: (v) => new Intl.NumberFormat('pt-BR', { style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v),
  pct0: (v) => new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 0 }).format(v),
  ratio: (v) => `${new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)}x`,
  date: (iso) => iso.split('-').reverse().join('/'),
  dayMonth: (iso) => iso.slice(8, 10) + '/' + iso.slice(5, 7),
  dateTime: (iso) => {
    const d = new Date(iso);
    return `${d.toLocaleDateString('pt-BR')} às ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
  },
};
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- Datas (strings AAAA-MM-DD) ----------
const D = {
  today() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  },
  add(iso, n) {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  },
  days(a, b) { return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5) + 1; },
  monthStart(iso) { return `${iso.slice(0, 7)}-01`; },
  monthEnd(iso) { return D.add(D.monthStart(D.add(D.monthStart(iso), 32)), -1); },
  prevMonthStart(iso) { return D.monthStart(D.add(D.monthStart(iso), -1)); },
  each(a, b) { const out = []; for (let d = a; d <= b; d = D.add(d, 1)) out.push(d); return out; },
};

function computeRange(period, custom) {
  const today = D.today();
  const yesterday = D.add(today, -1);
  let since, until, prevSince, prevUntil, label;
  if (period === '7d' || period === '30d') {
    const n = period === '7d' ? 7 : 30;
    until = yesterday; since = D.add(until, -(n - 1));
    label = `Últimos ${n} dias`;
  } else if (period === 'mes_atual') {
    since = D.monthStart(today); until = today;
    prevSince = D.prevMonthStart(today);
    const prevEnd = D.monthEnd(prevSince);
    prevUntil = D.add(prevSince, D.days(since, until) - 1);
    if (prevUntil > prevEnd) prevUntil = prevEnd;
    label = 'Mês atual';
  } else if (period === 'mes_anterior') {
    since = D.prevMonthStart(today); until = D.monthEnd(since);
    prevSince = D.prevMonthStart(since); prevUntil = D.monthEnd(prevSince);
    label = 'Mês anterior';
  } else {
    since = custom.since; until = custom.until;
    label = 'Período personalizado';
  }
  if (!prevSince) {
    const len = D.days(since, until);
    prevUntil = D.add(since, -1); prevSince = D.add(since, -len);
  }
  return { since, until, prevSince, prevUntil, label };
}

// ---------- Métricas ----------
const derive = (t) => ({
  ...t,
  ctr: t.impressions ? t.clicks / t.impressions : null,
  cpc: t.clicks ? t.spend / t.clicks : null,
  cpm: t.impressions ? (t.spend / t.impressions) * 1000 : null,
  cpl: t.conversions ? t.spend / t.conversions : null,
  roas: t.spend && t.revenue ? t.revenue / t.spend : null,
});
const zero = () => ({ spend: 0, impressions: 0, clicks: 0, conversions: 0, revenue: 0 });
const addT = (a, b) => { for (const k of Object.keys(zero())) a[k] += b?.[k] || 0; return a; };

const PLATFORMS = {
  meta: { name: 'Meta Ads', short: 'Meta', css: '--series-meta' },
  google: { name: 'Google Ads', short: 'Google', css: '--series-google' },
};

// ---------- Estado ----------
const state = {
  config: null,
  period: '30d',
  custom: { since: null, until: null },
  platform: 'all',
  metric: 'spend',
  sort: { key: 'spend', dir: -1 },
  search: '',
  range: null,
  data: {}, // meta|google -> payload | { error }
};
let chart = null;
let loadSeq = 0;

function conv() {
  const label = state.config?.conversionLabel || 'Conversões';
  const lower = label.toLowerCase();
  const singular = lower.endsWith('ões') ? lower.slice(0, -3) + 'ão' : lower.endsWith('s') ? lower.slice(0, -1) : lower;
  const costLabel = /lead/i.test(label) ? 'CPL' : 'CPA';
  return { label, singular, costLabel };
}

function kpiDefs(hasRevenue) {
  const c = conv();
  const defs = [
    { key: 'spend', label: 'Investimento', f: fmt.money, better: null },
    { key: 'impressions', label: 'Impressões', f: fmt.int, better: 'up' },
    { key: 'clicks', label: 'Cliques', f: fmt.int, better: 'up' },
    { key: 'ctr', label: 'CTR', f: fmt.pct, better: 'up' },
    { key: 'cpc', label: 'CPC', f: fmt.money, better: 'down' },
    { key: 'cpm', label: 'CPM', f: fmt.money, better: 'down' },
    { key: 'conversions', label: c.label, f: fmt.dec, better: 'up' },
    { key: 'cpl', label: c.costLabel, f: fmt.money, better: 'down' },
  ];
  if (hasRevenue) defs.push({ key: 'roas', label: 'ROAS', f: fmt.ratio, better: 'up' });
  return defs;
}

// ---------- Visão (filtro de plataforma aplicado no cliente) ----------
function activePlatforms() {
  const ok = Object.keys(PLATFORMS).filter((p) => state.data[p] && !state.data[p].error);
  return state.platform === 'all' ? ok : ok.filter((p) => p === state.platform);
}

function buildView() {
  const plats = activePlatforms();
  const totals = zero();
  const prev = zero();
  const byPlat = {};
  const campaigns = [];
  for (const p of plats) {
    const d = state.data[p];
    addT(totals, d.totals);
    addT(prev, d.previous?.totals);
    byPlat[p] = d;
    for (const c of d.campaigns) campaigns.push({ ...derive(c), platform: p });
  }
  return { plats, totals: derive(totals), prev: derive(prev), byPlat, campaigns };
}

function delta(cur, prev) {
  if (cur == null || prev == null || prev === 0) return null;
  return (cur - prev) / Math.abs(prev);
}

// ---------- Render: KPIs ----------
function renderKpis(view) {
  const defs = kpiDefs(view.totals.revenue > 0);
  const el = document.getElementById('kpis');
  el.innerHTML = defs.map((d) => {
    const cur = view.totals[d.key];
    const prev = view.prev[d.key];
    const ch = delta(cur, prev);
    let deltaHtml = '<span class="kpi-prev">sem base de comparação</span>';
    if (ch !== null) {
      const up = ch > 0;
      const flat = Math.abs(ch) < 0.005;
      const cls = flat || !d.better ? 'neutral' : (up === (d.better === 'up') ? 'good' : 'bad');
      const arrow = flat ? '■' : up ? '▲' : '▼';
      const word = flat ? 'estável' : (cls === 'good' ? 'melhora' : cls === 'bad' ? 'piora' : (up ? 'alta' : 'queda'));
      deltaHtml = `<span class="${cls}"><span aria-hidden="true">${arrow}</span> ${fmt.pct0(Math.abs(ch)).replace(/^0%$/, '<1%')}</span> <span class="sr-only">(${word})</span>vs anterior
        <span class="kpi-prev">antes: ${prev != null ? d.f(prev) : '—'}</span>`;
    } else if (prev != null && cur != null) {
      deltaHtml = `<span class="kpi-prev">antes: ${d.f(prev)}</span>`;
    }
    return `<div class="kpi">
      <p class="kpi-label">${esc(d.label)}</p>
      <p class="kpi-value">${cur != null ? d.f(cur) : '—'}</p>
      <p class="kpi-delta">${deltaHtml}</p>
    </div>`;
  }).join('');

  // Título com o achado principal
  const c = conv();
  const t = view.totals, p = view.prev;
  let title;
  const chCpl = delta(t.cpl, p.cpl);
  const chConv = delta(t.conversions, p.conversions);
  const chSpend = delta(t.spend, p.spend);
  if (t.conversions > 0 && chCpl !== null && Math.abs(chCpl) >= 0.01) {
    title = `${c.costLabel} ${chCpl < 0 ? 'caiu' : 'subiu'} ${fmt.pct0(Math.abs(chCpl))}: ${fmt.money(t.cpl)} por ${c.singular}`;
    if (chConv !== null) {
      const cc = Math.abs(chConv) < 0.01 ? 'estável' : `${chConv > 0 ? '+' : '−'}${fmt.pct0(Math.abs(chConv))}`;
      title += `, com ${fmt.dec(t.conversions)} ${c.label.toLowerCase()} (${cc})`;
    }
  } else if (t.conversions > 0) {
    title = `${fmt.dec(t.conversions)} ${c.label.toLowerCase()} a ${fmt.money(t.cpl)} cada`;
  } else if (t.spend > 0) {
    title = `Investimento de ${fmt.money(t.spend)}${chSpend !== null ? `, ${fmt.pct0(Math.abs(chSpend))} ${chSpend >= 0 ? 'acima' : 'abaixo'} do período anterior` : ''}`;
  } else {
    title = 'Sem veiculação no período';
  }
  document.getElementById('kpi-title').textContent = title;
  const r = state.range;
  document.getElementById('kpi-sub').textContent =
    `Variação vs ${fmt.date(r.prevSince)} a ${fmt.date(r.prevUntil)} (período anterior equivalente)`;
}

// ---------- Render: divisão por plataforma ----------
function renderSplit(view) {
  const card = document.getElementById('split-card');
  const show = state.platform === 'all' && view.plats.length === 2;
  card.hidden = !show;
  if (!show) return;
  const c = conv();
  const m = derive(view.byPlat.meta.totals), g = derive(view.byPlat.google.totals);
  const share = (k) => { const s = m[k] + g[k]; return s ? m[k] / s : null; };
  const rows = [
    { k: 'spend', label: 'Investimento' },
    { k: 'conversions', label: c.label },
    { k: 'clicks', label: 'Cliques' },
  ];
  const bars = rows.map(({ k, label }) => {
    const s = share(k);
    if (s === null) return '';
    return `<div class="share-row">
      <div class="share-head"><span>${esc(label)}</span><span class="num">Meta ${fmt.pct0(s)} · Google ${fmt.pct0(1 - s)}</span></div>
      <div class="share-bar" role="img" aria-label="${esc(label)}: Meta ${fmt.pct0(s)}, Google ${fmt.pct0(1 - s)}">
        ${s > 0 ? `<span class="m" style="width:${s * 100}%"></span>` : ''}${s < 1 ? `<span class="g" style="width:${(1 - s) * 100}%"></span>` : ''}
      </div>
    </div>`;
  }).join('');
  const legend = `<div class="share-legend"><span><i class="dot dot-meta"></i>Meta Ads</span><span><i class="dot dot-google"></i>Google Ads</span></div>`;
  const line = (p, t) => `<tr><td><span class="plat"><i class="dot dot-${p}"></i>${PLATFORMS[p].name}</span></td>
    <td class="n">${fmt.money(t.spend)}</td><td class="n">${fmt.dec(t.conversions)}</td>
    <td class="n">${t.cpl != null ? fmt.money(t.cpl) : '—'}</td><td class="n">${t.ctr != null ? fmt.pct(t.ctr) : '—'}</td>
    <td class="n">${t.cpc != null ? fmt.money(t.cpc) : '—'}</td></tr>`;
  const table = `<div class="table-scroll"><table>
    <thead><tr><th>Plataforma</th><th class="n">Invest.</th><th class="n">${esc(c.label)}</th><th class="n">${c.costLabel}</th><th class="n">CTR</th><th class="n">CPC</th></tr></thead>
    <tbody>${line('meta', m)}${line('google', g)}</tbody></table></div>`;
  document.getElementById('split').innerHTML = `<div>${bars}${legend}</div>${table}`;

  const ss = share('spend'), sc = share('conversions');
  let title = `Meta recebeu ${fmt.pct0(ss)} do investimento`;
  if (sc !== null) {
    title += ` e trouxe ${fmt.pct0(sc)} do total de ${c.label.toLowerCase()}`;
    if (m.cpl && g.cpl) {
      const cheaper = m.cpl < g.cpl ? 'Meta' : 'Google';
      const diff = Math.abs(m.cpl - g.cpl) / Math.max(m.cpl, g.cpl);
      if (diff >= 0.05) title += ` · ${c.costLabel} ${fmt.pct0(diff)} menor no ${cheaper}`;
    }
  }
  document.getElementById('split-title').textContent = title;
}

// ---------- Render: tendência ----------
function metricDefs() {
  const c = conv();
  return [
    { key: 'spend', label: 'Investimento', f: fmt.money, axis: fmt.moneyShort },
    { key: 'conversions', label: c.label, f: fmt.dec, axis: fmt.dec },
    { key: 'cpl', label: c.costLabel, f: fmt.money, axis: fmt.moneyShort, ratio: true },
    { key: 'clicks', label: 'Cliques', f: fmt.int, axis: fmt.int },
    { key: 'ctr', label: 'CTR', f: fmt.pct, axis: (v) => fmt.pct0(v), ratio: true },
  ];
}

function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

function renderMetricButtons() {
  const el = document.getElementById('metric-buttons');
  el.innerHTML = metricDefs().map((m) =>
    `<button type="button" data-metric="${m.key}" aria-pressed="${m.key === state.metric}">${esc(m.label)}</button>`).join('');
}

function dailySeries(view) {
  const days = D.each(state.range.since, state.range.until);
  const series = {};
  for (const p of view.plats) {
    const map = new Map(state.data[p].daily.map((d) => [d.date, d]));
    series[p] = days.map((day) => map.get(day) || { date: day, ...zero() });
  }
  const total = days.map((day, i) => {
    const t = zero();
    for (const p of view.plats) addT(t, series[p][i]);
    return { date: day, ...t };
  });
  return { days, series, total };
}

function renderTrend(view) {
  renderMetricButtons();
  const md = metricDefs().find((m) => m.key === state.metric) || metricDefs()[0];
  const { days, series, total } = dailySeries(view);
  const val = (d) => derive(d)[md.key];

  // Título com o achado: 1ª metade vs 2ª metade + pico
  const half = Math.floor(days.length / 2);
  const agg = (arr) => derive(arr.reduce((a, d) => addT(a, d), zero()))[md.key];
  const sumOrAvg = (arr) => (md.ratio ? agg(arr) : agg(arr) / Math.max(arr.length, 1));
  let title = `${md.label} diário`;
  if (days.length >= 4) {
    const a = sumOrAvg(total.slice(0, half)), b = sumOrAvg(total.slice(half));
    const ch = delta(b, a);
    if (ch !== null) {
      title = Math.abs(ch) < 0.05
        ? `${md.label} estável ao longo do período`
        : `${md.label} ${ch > 0 ? 'subiu' : 'caiu'} ${fmt.pct0(Math.abs(ch))} na segunda metade do período`;
    }
  }
  const vals = total.map(val);
  let peak = -1;
  vals.forEach((v, i) => { if (v != null && (peak < 0 || v > vals[peak])) peak = i; });
  if (peak >= 0 && !md.ratio && vals[peak] > 0) title += ` · pico em ${fmt.dayMonth(days[peak])} (${md.f(vals[peak])})`;
  document.getElementById('trend-title').textContent = title;
  document.getElementById('trend-sub').textContent = view.plats.length > 1
    ? 'Tendência diária por plataforma (passe o mouse para ver o total do dia)'
    : `Tendência diária · ${view.plats.map((p) => PLATFORMS[p].name).join('')}`;

  // Tabela acessível
  const plats = view.plats;
  document.getElementById('daily-table').innerHTML = `<thead><tr><th>Data</th>${plats.map((p) => `<th class="n">${PLATFORMS[p].short}</th>`).join('')}${plats.length > 1 ? '<th class="n">Total</th>' : ''}</tr></thead>
    <tbody>${days.map((d, i) => `<tr><td>${fmt.date(d)}</td>${plats.map((p) => { const v = val(series[p][i]); return `<td class="n">${v != null ? md.f(v) : '—'}</td>`; }).join('')}${plats.length > 1 ? `<td class="n">${vals[i] != null ? md.f(vals[i]) : '—'}</td>` : ''}</tr>`).join('')}</tbody>`;

  if (!window.Chart) return;
  const surface = cssVar('--surface');
  const datasets = plats.map((p) => ({
    label: PLATFORMS[p].name,
    data: series[p].map(val),
    borderColor: cssVar(PLATFORMS[p].css),
    backgroundColor: cssVar(PLATFORMS[p].css),
    pointBackgroundColor: cssVar(PLATFORMS[p].css),
    pointBorderColor: surface,
    pointBorderWidth: 2,
    borderWidth: 2,
    pointRadius: days.length <= 14 ? 3 : 0,
    pointHoverRadius: 5,
    tension: 0,
    spanGaps: true,
  }));
  const grid = cssVar('--grid'), text2 = cssVar('--text-2'), text3 = cssVar('--text-3');
  const options = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: plats.length > 1
        ? { display: true, position: 'top', align: 'start', labels: { color: text2, usePointStyle: true, pointStyle: 'circle', boxWidth: 8, boxHeight: 8, font: { size: 13 } } }
        : { display: false },
      tooltip: {
        backgroundColor: cssVar('--surface'), titleColor: cssVar('--text'), bodyColor: text2,
        borderColor: cssVar('--border'), borderWidth: 1, padding: 10, boxPadding: 4, usePointStyle: true,
        callbacks: {
          title: (items) => fmt.date(days[items[0].dataIndex]),
          label: (ctx) => ` ${ctx.dataset.label}: ${ctx.raw != null ? md.f(ctx.raw) : '—'}`,
          footer: (items) => (plats.length > 1 && vals[items[0].dataIndex] != null ? `Total: ${md.f(vals[items[0].dataIndex])}` : ''),
        },
        footerColor: cssVar('--text'),
      },
    },
    scales: {
      x: {
        grid: { display: false }, border: { color: grid },
        ticks: { color: text3, maxRotation: 0, autoSkip: true, maxTicksLimit: 8, callback: (_v, i) => fmt.dayMonth(days[i]) },
      },
      y: {
        beginAtZero: true, grid: { color: grid }, border: { display: false },
        ticks: { color: text3, maxTicksLimit: 6, callback: (v) => md.axis(v) },
      },
    },
  };
  if (chart) chart.destroy();
  chart = new Chart(document.getElementById('trend-chart'), { type: 'line', data: { labels: days, datasets }, options, plugins: [crosshair] });
}

// Linha vertical no dia sob o cursor
const crosshair = {
  id: 'crosshair',
  afterDatasetsDraw(c) {
    const active = c.tooltip?.getActiveElements?.() || [];
    if (!active.length) return;
    const x = active[0].element.x;
    const { top, bottom } = c.chartArea;
    const ctx = c.ctx;
    ctx.save();
    ctx.strokeStyle = cssVar('--text-3');
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.stroke();
    ctx.restore();
  },
};

// ---------- Render: campanhas ----------
function renderCampaigns(view) {
  const c = conv();
  const hasRevenue = view.totals.revenue > 0;
  const cols = [
    { key: 'platform', label: 'Plataforma', text: true },
    { key: 'name', label: 'Campanha', text: true },
    { key: 'status', label: 'Status', text: true },
    { key: 'spend', label: 'Invest.', f: fmt.money },
    { key: 'impressions', label: 'Impr.', f: fmt.int },
    { key: 'clicks', label: 'Cliques', f: fmt.int },
    { key: 'ctr', label: 'CTR', f: fmt.pct },
    { key: 'cpc', label: 'CPC', f: fmt.money },
    { key: 'conversions', label: c.label, f: fmt.dec },
    { key: 'cpl', label: c.costLabel, f: fmt.money },
  ];
  if (hasRevenue) cols.push({ key: 'roas', label: 'ROAS', f: fmt.ratio });

  const q = state.search.trim().toLowerCase();
  const rows = view.campaigns.filter((r) => !q || r.name.toLowerCase().includes(q));
  const { key, dir } = state.sort;
  rows.sort((a, b) => {
    const va = a[key], vb = b[key];
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    return typeof va === 'string' ? va.localeCompare(vb, 'pt-BR') * dir : (va - vb) * dir;
  });

  const head = cols.map((col) => {
    const sorted = col.key === key;
    const aria = sorted ? ` aria-sort="${dir === 1 ? 'ascending' : 'descending'}"` : '';
    const arrow = sorted ? (dir === 1 ? '↑' : '↓') : '';
    return `<th class="${col.text ? '' : 'n'}"${aria}><button type="button" data-sort="${col.key}">${esc(col.label)}<span aria-hidden="true">${arrow}</span></button></th>`;
  }).join('');

  const cell = (r, col) => {
    if (col.key === 'platform') return `<td><span class="plat"><i class="dot dot-${r.platform}" aria-hidden="true"></i>${PLATFORMS[r.platform].short}</span></td>`;
    if (col.key === 'name') return `<td class="name">${esc(r.name)}</td>`;
    if (col.key === 'status') return `<td>${r.status ? `<span class="status ${esc(r.status)}">${esc(r.status)}</span>` : '—'}</td>`;
    const v = r[col.key];
    return `<td class="n">${v != null ? col.f(v) : '—'}</td>`;
  };
  const body = rows.length
    ? rows.map((r) => `<tr>${cols.map((col) => cell(r, col)).join('')}</tr>`).join('')
    : `<tr><td class="empty" colspan="${cols.length}">${q ? 'Nenhuma campanha encontrada para a busca.' : 'Nenhuma campanha com veiculação no período.'}</td></tr>`;

  const tot = derive(rows.reduce((a, r) => addT(a, r), zero()));
  const foot = rows.length > 1
    ? `<tfoot><tr><td colspan="3">Total (${rows.length} campanhas)</td>${cols.slice(3).map((col) => `<td class="n">${tot[col.key] != null ? col.f(tot[col.key]) : '—'}</td>`).join('')}</tr></tfoot>`
    : '';
  document.getElementById('camp-table').innerHTML = `<thead><tr>${head}</tr></thead><tbody>${body}</tbody>${foot}`;

  // Título com o achado
  const all = view.campaigns;
  const totConv = all.reduce((s, r) => s + r.conversions, 0);
  const totSpend = all.reduce((s, r) => s + r.spend, 0);
  let title = 'Campanhas no período';
  if (totConv > 0) {
    const top = [...all].sort((a, b) => b.conversions - a.conversions)[0];
    title = `“${top.name}” gerou ${fmt.pct0(top.conversions / totConv)} do total de ${c.label.toLowerCase()}${top.cpl != null ? `, com ${c.costLabel} de ${fmt.money(top.cpl)}` : ''}`;
  } else if (totSpend > 0) {
    const top = [...all].sort((a, b) => b.spend - a.spend)[0];
    title = `“${top.name}” concentra ${fmt.pct0(top.spend / totSpend)} do investimento`;
  }
  document.getElementById('camp-title').textContent = title;
}

// ---------- Avisos e rodapé ----------
function renderNotices() {
  const out = [];
  for (const p of Object.keys(PLATFORMS)) {
    const d = state.data[p];
    if (!d) continue;
    if (d.error) out.push(`<div class="notice err"><strong>${PLATFORMS[p].name}:</strong> ${esc(d.error)}</div>`);
    else if (d.mode !== 'demo') for (const n of d.notes || []) if (/parcial/i.test(n)) out.push(`<div class="notice"><strong>${PLATFORMS[p].name}:</strong> ${esc(n)}</div>`);
  }
  const m = state.data.meta, g = state.data.google;
  if (m && g && !m.error && !g.error && m.currency !== g.currency) {
    out.push(`<div class="notice">As contas usam moedas diferentes (${esc(m.currency)} e ${esc(g.currency)}): o consolidado soma valores sem conversão.</div>`);
  }
  if (state.config?.demo) out.unshift('<div class="notice"><strong>Modo demonstração:</strong> os números abaixo são sintéticos. Configure os tokens e desligue DEMO_MODE para ver os dados reais.</div>');
  document.getElementById('notices').innerHTML = out.join('');
}

function renderFooter() {
  const lines = [];
  for (const p of activePlatforms()) {
    const d = state.data[p];
    const when = d.mode === 'script'
      ? `última sincronização em ${fmt.dateTime(d.dataUpdatedAt)}`
      : `consultado em ${fmt.dateTime(d.generatedAt)}`;
    const notes = (d.notes || []).filter((n) => !/parcial/i.test(n)).join(' · ');
    lines.push(`<p><strong>${PLATFORMS[p].name}</strong> — fonte: ${esc(d.source)} · ${when}${notes ? ` · ${esc(notes)}` : ''}</p>`);
  }
  lines.push('<p>Os dados ficam em cache por até 1 hora. Datas no fuso de cada conta de anúncios.</p>');
  document.getElementById('footer').innerHTML = lines.join('');
}

// ---------- Ciclo principal ----------
function render() {
  const view = buildView();
  currency = view.plats.map((p) => state.data[p].currency)[0] || 'BRL';
  renderNotices();
  renderFooter();
  if (!view.plats.length) {
    document.getElementById('kpi-title').textContent = 'Nenhuma fonte de dados disponível para esta seleção';
    document.getElementById('kpis').innerHTML = '';
    document.getElementById('split-card').hidden = true;
    document.getElementById('trend-title').textContent = '';
    document.getElementById('camp-title').textContent = '';
    document.getElementById('camp-table').innerHTML = '';
    document.getElementById('daily-table').innerHTML = '';
    if (chart) { chart.destroy(); chart = null; }
    return;
  }
  renderKpis(view);
  renderSplit(view);
  renderTrend(view);
  renderCampaigns(view);
}

function syncControls() {
  for (const b of document.querySelectorAll('[data-period]')) b.setAttribute('aria-pressed', String(b.dataset.period === state.period));
  for (const b of document.querySelectorAll('[data-platform]')) {
    b.setAttribute('aria-pressed', String(b.dataset.platform === state.platform));
    const p = b.dataset.platform;
    if (p !== 'all') b.disabled = !state.config?.platforms?.[p]?.enabled;
  }
  document.getElementById('custom-range').hidden = state.period !== 'custom';
  const r = state.range;
  if (r) {
    document.getElementById('period-label').textContent = `${r.label}: ${fmt.date(r.since)} a ${fmt.date(r.until)}`;
    document.getElementById('custom-since').value = state.custom.since || r.since;
    document.getElementById('custom-until').value = state.custom.until || r.until;
  }
  const qs = new URLSearchParams({ periodo: state.period, plataforma: state.platform });
  if (state.period === 'custom') { qs.set('de', state.custom.since); qs.set('ate', state.custom.until); }
  history.replaceState(null, '', `?${qs}`);
}

async function fetchPlatform(p, r) {
  const qs = new URLSearchParams({ since: r.since, until: r.until, prev_since: r.prevSince, prev_until: r.prevUntil });
  try {
    const res = await fetch(`/api/${p}?${qs}`, { headers: { Accept: 'application/json' } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { error: body.message || `Erro ${res.status} ao carregar os dados.` };
    return body;
  } catch {
    return { error: 'Falha de rede ao carregar os dados.' };
  }
}

async function load() {
  state.range = computeRange(state.period, state.custom);
  syncControls();
  const seq = ++loadSeq;
  const content = document.getElementById('content');
  content.classList.add('loading');
  content.setAttribute('aria-busy', 'true');
  const enabled = Object.keys(PLATFORMS).filter((p) => state.config.platforms[p]?.enabled);
  const results = await Promise.all(enabled.map((p) => fetchPlatform(p, state.range)));
  if (seq !== loadSeq) return; // resposta antiga
  state.data = {};
  enabled.forEach((p, i) => { state.data[p] = results[i]; });
  for (const p of Object.keys(PLATFORMS)) {
    if (!enabled.includes(p)) state.data[p] = { error: 'ainda não configurado.' };
  }
  content.classList.remove('loading');
  content.removeAttribute('aria-busy');
  render();
}

function readUrl() {
  const qs = new URLSearchParams(location.search);
  const period = qs.get('periodo');
  if (['7d', '30d', 'mes_atual', 'mes_anterior', 'custom'].includes(period)) state.period = period;
  const plat = qs.get('plataforma');
  if (['all', 'meta', 'google'].includes(plat)) state.platform = plat;
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  if (state.period === 'custom') {
    const a = qs.get('de'), b = qs.get('ate');
    if (iso.test(a || '') && iso.test(b || '') && a <= b) state.custom = { since: a, until: b };
    else state.period = '30d';
  }
}

function bind() {
  document.getElementById('period-buttons').addEventListener('click', (e) => {
    const b = e.target.closest('[data-period]');
    if (!b) return;
    if (b.dataset.period === 'custom') {
      state.period = 'custom';
      if (!state.custom.since) state.custom = { since: state.range.since, until: state.range.until };
      syncControls();
      document.getElementById('custom-since').focus();
      return;
    }
    state.period = b.dataset.period;
    load();
  });
  document.getElementById('custom-range').addEventListener('submit', (e) => {
    e.preventDefault();
    const since = document.getElementById('custom-since').value;
    const until = document.getElementById('custom-until').value;
    if (!since || !until || since > until) { alert('Escolha uma data inicial anterior à final.'); return; }
    if (D.days(since, until) > 366) { alert('Escolha um período de até 366 dias.'); return; }
    state.custom = { since, until };
    load();
  });
  document.getElementById('platform-buttons').addEventListener('click', (e) => {
    const b = e.target.closest('[data-platform]');
    if (!b || b.disabled) return;
    state.platform = b.dataset.platform;
    syncControls();
    render();
  });
  document.getElementById('metric-buttons').addEventListener('click', (e) => {
    const b = e.target.closest('[data-metric]');
    if (!b) return;
    state.metric = b.dataset.metric;
    renderTrend(buildView());
  });
  document.getElementById('camp-table').addEventListener('click', (e) => {
    const b = e.target.closest('[data-sort]');
    if (!b) return;
    const key = b.dataset.sort;
    const textCol = ['platform', 'name', 'status'].includes(key);
    state.sort = state.sort.key === key ? { key, dir: -state.sort.dir } : { key, dir: textCol ? 1 : -1 };
    renderCampaigns(buildView());
  });
  document.getElementById('camp-search').addEventListener('input', (e) => {
    state.search = e.target.value;
    renderCampaigns(buildView());
  });
  // Redesenha o gráfico ao trocar tema claro/escuro
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (state.range) renderTrend(buildView()); });
}

async function init() {
  readUrl();
  bind();
  try {
    const res = await fetch('/api/config');
    state.config = await res.json();
    if (!res.ok) throw new Error();
  } catch {
    document.getElementById('kpi-title').textContent = 'Não foi possível carregar a configuração do painel.';
    return;
  }
  document.getElementById('client-name').textContent = state.config.clientName;
  document.title = `${state.config.clientName} · Tráfego`;
  document.getElementById('demo-badge').hidden = !state.config.demo;
  if (state.platform !== 'all' && !state.config.platforms[state.platform]?.enabled) state.platform = 'all';
  await load();
}

init();
