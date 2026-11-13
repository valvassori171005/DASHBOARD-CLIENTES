// Meta Marketing API: GET /act_{ID}/insights
import { metaConfig } from './config.js';
import { HttpError } from './http.js';
import { sumRows } from './normalize.js';

const GRAPH = 'https://graph.facebook.com';

function sumActions(list, wanted) {
  if (!Array.isArray(list) || wanted.length === 0) return 0;
  let total = 0;
  for (const a of list) if (wanted.includes(a.action_type)) total += Number(a.value) || 0;
  return total;
}

async function graphGet(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    const e = data.error || {};
    // A mensagem do Meta não contém o token; a URL sim, por isso nunca a registramos.
    throw new HttpError(502, 'meta_api_error', `Meta API: ${e.message || res.statusText} (código ${e.code ?? res.status})`);
  }
  return data;
}

async function graphGetAll(path, params, cfg) {
  const qs = new URLSearchParams({ ...params, access_token: cfg.token, limit: '500' });
  let url = `${GRAPH}/${cfg.version}/${path}?${qs}`;
  const out = [];
  for (let page = 0; url && page < 50; page++) {
    const data = await graphGet(url);
    out.push(...(data.data || []));
    url = data.paging?.next || null;
  }
  return out;
}

function toRow(item, cfg) {
  return {
    date: item.date_start,
    campaignId: item.campaign_id || 'account',
    campaignName: item.campaign_name || 'Conta',
    spend: Number(item.spend) || 0,
    impressions: Number(item.impressions) || 0,
    clicks: Number(item[cfg.clicksField]) || 0,
    conversions: sumActions(item.actions, cfg.conversionActions),
    revenue: sumActions(item.action_values, cfg.revenueActions),
  };
}

export async function fetchMeta(range) {
  const cfg = metaConfig();
  const fields = ['campaign_id', 'campaign_name', 'spend', 'impressions', cfg.clicksField, 'actions', 'action_values'].join(',');
  const common = { fields, use_unified_attribution_setting: 'true' }; // mesma atribuição do Gerenciador

  const [current, previous, campaigns] = await Promise.all([
    graphGetAll(`${cfg.account}/insights`, {
      ...common,
      level: 'campaign',
      time_increment: '1',
      time_range: JSON.stringify({ since: range.since, until: range.until }),
    }, cfg),
    graphGetAll(`${cfg.account}/insights`, {
      ...common,
      level: 'account',
      time_range: JSON.stringify({ since: range.prevSince, until: range.prevUntil }),
    }, cfg),
    // Status das campanhas (não bloqueia o dash se falhar)
    graphGetAll(`${cfg.account}/campaigns`, { fields: 'id,effective_status' }, cfg).catch(() => []),
  ]);

  const status = new Map(campaigns.map((c) => [c.id, c.effective_status]));
  const rows = current.map((item) => ({ ...toRow(item, cfg), status: status.get(item.campaign_id) }));
  const previousTotals = sumRows(previous.map((item) => toRow(item, cfg)));
  return {
    rows,
    previousTotals,
    source: `Meta Marketing API ${cfg.version}`,
    notes: [`Conversões = ${cfg.conversionActions.join(' + ')}; cliques = ${cfg.clicksField === 'clicks' ? 'todos' : 'no link'}`],
  };
}
