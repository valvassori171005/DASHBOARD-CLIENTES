// Testes sem rede: fetch é simulado. Rode com: npm test
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign as rsaSign } from 'node:crypto';

const realFetch = globalThis.fetch;
const ENV_KEYS = Object.keys(process.env);
beforeEach(() => {
  globalThis.fetch = realFetch;
  for (const k of Object.keys(process.env)) if (!ENV_KEYS.includes(k)) delete process.env[k];
});

function mockRes() {
  return {
    statusCode: 200, headers: {}, body: '',
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    end(b) { this.body = b; },
    json() { return JSON.parse(this.body); },
  };
}
const req = (url, extra = {}) => ({ method: 'GET', url, headers: {}, ...extra });
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

test('parseRange calcula período anterior e valida entradas', async () => {
  const { parseRange } = await import('../lib/dates.js');
  const r = parseRange(new URLSearchParams('since=2026-10-01&until=2026-10-31'));
  assert.deepEqual(r, { since: '2026-10-01', until: '2026-10-31', prevSince: '2026-08-31', prevUntil: '2026-09-30' });
  assert.throws(() => parseRange(new URLSearchParams('since=2026-02-30&until=2026-03-01')), /inválido/);
  assert.throws(() => parseRange(new URLSearchParams('since=2026-10-31&until=2026-10-01')), /antes/);
});

test('/api/meta sem token responde 503 not_configured', async () => {
  const { default: h } = await import('../api/meta.js');
  const res = mockRes();
  await h(req('/api/meta?since=2026-10-01&until=2026-10-02'), res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.json().error, 'not_configured');
});

test('/api/meta agrega insights, pagina e soma só as ações de conversão', async () => {
  Object.assign(process.env, { META_ACCESS_TOKEN: 'tok', META_AD_ACCOUNT_ID: '123', META_CONVERSION_ACTIONS: 'lead' });
  const calls = [];
  globalThis.fetch = async (url) => {
    const u = new URL(url);
    calls.push(u);
    if (u.pathname.endsWith('/campaigns')) return json({ data: [{ id: 'c1', effective_status: 'ACTIVE' }] });
    if (u.searchParams.get('level') === 'account') {
      return json({ data: [{ spend: '50', impressions: '1000', inline_link_clicks: '10', actions: [{ action_type: 'lead', value: '5' }] }] });
    }
    if (u.searchParams.get('after')) {
      return json({ data: [{ date_start: '2026-10-02', campaign_id: 'c1', campaign_name: 'C1', spend: '20.5', impressions: '500', inline_link_clicks: '7', actions: [{ action_type: 'lead', value: '2' }] }] });
    }
    return json({
      data: [{ date_start: '2026-10-01', campaign_id: 'c1', campaign_name: 'C1', spend: '10', impressions: '400', inline_link_clicks: '4',
        actions: [{ action_type: 'lead', value: '3' }, { action_type: 'link_click', value: '4' }] }],
      paging: { next: `${u.origin}${u.pathname}?after=abc&access_token=tok` },
    });
  };
  const { default: h } = await import('../api/meta.js');
  const res = mockRes();
  await h(req('/api/meta?since=2026-10-01&until=2026-10-02'), res);
  const body = res.json();
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['cache-control'], /s-maxage=3600/);
  assert.deepEqual(body.totals, { spend: 30.5, impressions: 900, clicks: 11, conversions: 5, revenue: 0 });
  assert.equal(body.previous.totals.conversions, 5);
  assert.equal(body.campaigns[0].status, 'ativa');
  assert.equal(body.daily.length, 2);
  assert.ok(calls.some((u) => u.pathname.includes('/act_123/insights')));
  assert.ok(!res.body.includes('tok'), 'token não pode vazar na resposta');
});

test('/api/meta repassa erro da Graph API sem vazar token', async () => {
  Object.assign(process.env, { META_ACCESS_TOKEN: 'segredo123', META_AD_ACCOUNT_ID: 'act_1' });
  globalThis.fetch = async () => json({ error: { message: 'Invalid OAuth access token', code: 190 } }, 400);
  const { default: h } = await import('../api/meta.js');
  const res = mockRes();
  await h(req('/api/meta?since=2026-10-01&until=2026-10-02'), res);
  assert.equal(res.statusCode, 502);
  assert.match(res.json().message, /190/);
  assert.ok(!res.body.includes('segredo123'));
});

test('/api/google (API direta) converte micros e usa os headers certos', async () => {
  Object.assign(process.env, {
    GADS_DEVELOPER_TOKEN: 'dev', GADS_CLIENT_ID: 'cid', GADS_CLIENT_SECRET: 'cs', GADS_REFRESH_TOKEN: 'rt',
    GADS_CUSTOMER_ID: '123-456-7890', GADS_LOGIN_CUSTOMER_ID: '111-222-3333',
  });
  const seen = [];
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('oauth2')) return json({ access_token: 'at', expires_in: 3600 });
    seen.push({ url: String(url), headers: init.headers });
    const q = JSON.parse(init.body).query;
    if (q.includes('currency_code')) return json([{ results: [{ customer: { currencyCode: 'BRL' } }] }]);
    if (q.includes('FROM customer')) return json([{ results: [{ metrics: { costMicros: '2000000', impressions: '10', clicks: '1', conversions: 1, conversionsValue: 0 } }] }]);
    return json([{ results: [
      { segments: { date: '2026-10-01' }, campaign: { id: '9', name: 'Pesquisa', status: 'ENABLED' }, metrics: { costMicros: '12345678', impressions: '100', clicks: '10', conversions: 2.5, conversionsValue: 0 } },
    ] }]);
  };
  const { default: h } = await import('../api/google.js');
  const res = mockRes();
  await h(req('/api/google?since=2026-10-01&until=2026-10-01'), res);
  const body = res.json();
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(body.mode, 'api');
  assert.equal(body.totals.spend, 12.35);
  assert.equal(body.totals.conversions, 2.5);
  assert.equal(body.previous.totals.spend, 2);
  assert.ok(seen[0].url.includes('/customers/1234567890/googleAds:searchStream'));
  assert.equal(seen[0].headers['login-customer-id'], '1112223333');
  assert.equal(seen[0].headers['developer-token'], 'dev');
});

test('plano B: lê a planilha publicada (CSV), com aspas e números em pt-BR', async () => {
  Object.assign(process.env, { GADS_SHEET_CSV_URL: 'https://docs.google.com/spreadsheets/d/e/X/pub?output=csv' });
  const csv = [
    'date,campaignId,campaignName,status,spend,impressions,clicks,conversions,revenue,,atualizado_em,2026-11-13T12:00:00.000Z',
    '2026-09-30,1,A,ENABLED,5,50,5,1,0,,moeda,BRL',
    '2026-10-01,1,"Pesquisa, ""Marca""",ENABLED,"1.234,56",100,9,2.5,0,,desde,2026-09-01',
    '01/10/2026,2,B,PAUSED,10.5,10,1,0,0,,,',
    'lixo,3,C,ENABLED,99,1,1,1,0,,,',
  ].join('\r\n');
  globalThis.fetch = async (url) => {
    assert.match(String(url), /docs\.google\.com/);
    return new Response(csv, { status: 200, headers: { 'Content-Type': 'text/csv' } });
  };
  const { default: google } = await import('../api/google.js');
  const res = mockRes();
  await google(req('/api/google?since=2026-10-01&until=2026-10-01'), res);
  const body = res.json();
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(body.mode, 'sheet');
  assert.equal(body.totals.spend, 1245.06);
  assert.equal(body.totals.conversions, 2.5);
  assert.equal(body.previous.totals.spend, 5);
  assert.equal(body.dataUpdatedAt, '2026-11-13T12:00:00.000Z');
  assert.ok(body.campaigns.some((c) => c.name === 'Pesquisa, "Marca"'));
});

test('plano B: planilha não publicada (HTML) vira erro claro', async () => {
  Object.assign(process.env, { GADS_SHEET_CSV_URL: 'https://docs.google.com/spreadsheets/d/X/edit' });
  globalThis.fetch = async () => new Response('<!DOCTYPE html><html>login</html>', { status: 200 });
  const { default: google } = await import('../api/google.js');
  const res = mockRes();
  await google(req('/api/google?since=2026-10-01&until=2026-10-01'), res);
  assert.equal(res.statusCode, 502);
  assert.match(res.json().message, /publicada/);
});

test('middleware: bloqueia sem JWT, libera com JWT válido do Cloudflare Access', async () => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256' };
  Object.assign(process.env, { CF_ACCESS_TEAM_DOMAIN: 'equipe.cloudflareaccess.com', CF_ACCESS_AUD: 'aud123' });
  globalThis.fetch = async () => json({ keys: [jwk] });
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const make = (payload) => {
    const unsigned = `${b64({ alg: 'RS256', kid: 'k1' })}.${b64(payload)}`;
    return `${unsigned}.${rsaSign('RSA-SHA256', Buffer.from(unsigned), privateKey).toString('base64url')}`;
  };
  const now = Math.floor(Date.now() / 1000);
  const good = make({ aud: ['aud123'], iss: 'https://equipe.cloudflareaccess.com', exp: now + 600 });
  const wrongAud = make({ aud: ['outra'], iss: 'https://equipe.cloudflareaccess.com', exp: now + 600 });
  const { default: mw } = await import('../middleware.js');
  const call = (token) => mw(new Request('https://x.vercel.app/api/meta', { headers: token ? { 'cf-access-jwt-assertion': token } : {} }));
  assert.equal((await call(null)).status, 403);
  assert.equal((await call(wrongAud)).status, 403);
  assert.equal((await call(good + 'x')).status, 403);
  assert.equal(await call(good), undefined);
});
