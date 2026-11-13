// Formato único que o front consome, venha o dado do Meta, do Google ou do script.
// Linha bruta: { date, campaignId, campaignName, status, spend, impressions, clicks, conversions, revenue }

const METRICS = ['spend', 'impressions', 'clicks', 'conversions', 'revenue'];

export function emptyTotals() {
  return { spend: 0, impressions: 0, clicks: 0, conversions: 0, revenue: 0 };
}

function add(target, row) {
  for (const k of METRICS) target[k] += Number(row[k]) || 0;
}

function round(t) {
  return {
    spend: Math.round(t.spend * 100) / 100,
    impressions: Math.round(t.impressions),
    clicks: Math.round(t.clicks),
    conversions: Math.round(t.conversions * 100) / 100,
    revenue: Math.round(t.revenue * 100) / 100,
  };
}

export function normalizeStatus(raw) {
  const s = String(raw || '').toUpperCase();
  if (s === 'ACTIVE' || s === 'ENABLED') return 'ativa';
  if (s.includes('PAUSED')) return 'pausada';
  if (s === 'REMOVED' || s === 'DELETED' || s === 'ARCHIVED') return 'encerrada';
  return s ? s.toLowerCase() : null;
}

export function sumRows(rows) {
  const t = emptyTotals();
  for (const r of rows) add(t, r);
  return round(t);
}

export function aggregate(rows) {
  const byDate = new Map();
  const byCampaign = new Map();
  const totals = emptyTotals();
  for (const r of rows) {
    if (!byDate.has(r.date)) byDate.set(r.date, { date: r.date, ...emptyTotals() });
    add(byDate.get(r.date), r);
    const id = String(r.campaignId);
    if (!byCampaign.has(id)) {
      byCampaign.set(id, { id, name: r.campaignName, status: normalizeStatus(r.status), ...emptyTotals() });
    }
    const c = byCampaign.get(id);
    if (r.campaignName) c.name = r.campaignName;
    if (r.status) c.status = normalizeStatus(r.status);
    add(c, r);
    add(totals, r);
  }
  const daily = [...byDate.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((d) => ({ date: d.date, ...round(d) }));
  const campaigns = [...byCampaign.values()]
    .map((c) => ({ id: c.id, name: c.name, status: c.status, ...round(c) }))
    .sort((a, b) => b.spend - a.spend);
  return { totals: round(totals), daily, campaigns };
}

export function buildPayload({ platform, source, mode, currency, range, rows, previousTotals, dataUpdatedAt, notes }) {
  const { totals, daily, campaigns } = aggregate(rows);
  return {
    platform,
    source,
    mode,
    currency: currency || 'BRL',
    since: range.since,
    until: range.until,
    generatedAt: new Date().toISOString(),
    dataUpdatedAt: dataUpdatedAt || new Date().toISOString(),
    totals,
    previous: { since: range.prevSince, until: range.prevUntil, totals: previousTotals },
    daily,
    campaigns,
    notes: notes || [],
  };
}
