// Google Ads API (REST + GAQL) via googleAds:searchStream
import { googleConfig } from './config.js';
import { HttpError } from './http.js';
import { sumRows } from './normalize.js';

let tokenCache = { value: null, expiresAt: 0 };

async function accessToken(cfg) {
  if (tokenCache.value && Date.now() < tokenCache.expiresAt - 60_000) return tokenCache.value;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      refresh_token: cfg.refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new HttpError(502, 'google_oauth_error', `Google OAuth: ${data.error_description || data.error || res.statusText}`);
  }
  tokenCache = { value: data.access_token, expiresAt: Date.now() + (data.expires_in || 3600) * 1000 };
  return data.access_token;
}

async function search(cfg, query) {
  const token = await accessToken(cfg);
  const headers = {
    Authorization: `Bearer ${token}`,
    'developer-token': cfg.developerToken,
    'Content-Type': 'application/json',
  };
  if (cfg.loginCustomerId) headers['login-customer-id'] = cfg.loginCustomerId;
  const url = `https://googleads.googleapis.com/${cfg.version}/customers/${cfg.customerId}/googleAds:searchStream`;
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ query }) });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = Array.isArray(data) ? data[0]?.error : data?.error;
    const detail = err?.details?.[0]?.errors?.[0]?.message || err?.message || res.statusText;
    throw new HttpError(502, 'google_ads_api_error', `Google Ads API: ${detail}`);
  }
  return (Array.isArray(data) ? data : []).flatMap((batch) => batch.results || []);
}

const between = (a, b) => `segments.date BETWEEN '${a}' AND '${b}'`;
const quote = (s) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

// Quando GADS_CONVERSION_ACTIONS está definido, conta só essas ações (por nome).
async function conversionsByAction(cfg, since, until, perCampaignDay) {
  const names = cfg.conversionActions.map(quote).join(', ');
  const select = perCampaignDay ? 'segments.date, campaign.id, ' : '';
  const results = await search(cfg, `
    SELECT ${select}segments.conversion_action_name, metrics.all_conversions, metrics.all_conversions_value
    FROM campaign
    WHERE ${between(since, until)} AND segments.conversion_action_name IN (${names})`);
  const map = new Map();
  for (const r of results) {
    const key = perCampaignDay ? `${r.segments.date}|${r.campaign.id}` : 'total';
    const cur = map.get(key) || { conversions: 0, revenue: 0 };
    cur.conversions += Number(r.metrics.allConversions) || 0;
    cur.revenue += Number(r.metrics.allConversionsValue) || 0;
    map.set(key, cur);
  }
  return map;
}

export async function fetchGoogleApi(range) {
  const cfg = googleConfig();
  const filtered = cfg.conversionActions.length > 0;
  const [current, previous, currency, convCur, convPrev] = await Promise.all([
    search(cfg, `
      SELECT segments.date, campaign.id, campaign.name, campaign.status,
             metrics.cost_micros, metrics.impressions, metrics.clicks,
             metrics.conversions, metrics.conversions_value
      FROM campaign
      WHERE ${between(range.since, range.until)}`),
    search(cfg, `
      SELECT metrics.cost_micros, metrics.impressions, metrics.clicks,
             metrics.conversions, metrics.conversions_value
      FROM customer
      WHERE ${between(range.prevSince, range.prevUntil)}`),
    search(cfg, 'SELECT customer.currency_code FROM customer LIMIT 1').catch(() => []),
    filtered ? conversionsByAction(cfg, range.since, range.until, true) : null,
    filtered ? conversionsByAction(cfg, range.prevSince, range.prevUntil, false) : null,
  ]);

  const rows = current.map((r) => {
    const conv = convCur?.get(`${r.segments.date}|${r.campaign.id}`);
    return {
      date: r.segments.date,
      campaignId: r.campaign.id,
      campaignName: r.campaign.name,
      status: r.campaign.status,
      spend: (Number(r.metrics.costMicros) || 0) / 1e6,
      impressions: Number(r.metrics.impressions) || 0,
      clicks: Number(r.metrics.clicks) || 0,
      conversions: filtered ? conv?.conversions || 0 : Number(r.metrics.conversions) || 0,
      revenue: filtered ? conv?.revenue || 0 : Number(r.metrics.conversionsValue) || 0,
    };
  });
  const prevRows = previous.map((r) => ({
    spend: (Number(r.metrics.costMicros) || 0) / 1e6,
    impressions: Number(r.metrics.impressions) || 0,
    clicks: Number(r.metrics.clicks) || 0,
    conversions: Number(r.metrics.conversions) || 0,
    revenue: Number(r.metrics.conversionsValue) || 0,
  }));
  const previousTotals = sumRows(prevRows);
  if (filtered) {
    const p = convPrev.get('total') || { conversions: 0, revenue: 0 };
    previousTotals.conversions = Math.round(p.conversions * 100) / 100;
    previousTotals.revenue = Math.round(p.revenue * 100) / 100;
  }
  return {
    rows,
    previousTotals,
    currency: currency[0]?.customer?.currencyCode || 'BRL',
    source: `Google Ads API ${cfg.version}`,
    notes: [filtered ? `Conversões = ${cfg.conversionActions.join(' + ')}` : 'Conversões = coluna "Conversões" (ações principais)'],
  };
}
