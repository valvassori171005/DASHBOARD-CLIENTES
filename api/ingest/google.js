// Plano B: recebe (POST) os dados do Script do Google Ads, protegido por segredo compartilhado.
import { timingSafeEqual, createHash } from 'node:crypto';
import { ingestSecret } from '../../lib/config.js';
import { isIsoDate } from '../../lib/dates.js';
import { handler, HttpError, readJsonBody, sendJson } from '../../lib/http.js';
import { GOOGLE_SCRIPT_KEY, setJson } from '../../lib/store.js';

const MAX_ROWS = 50000;

function authorized(req) {
  const secret = ingestSecret();
  if (!secret || secret.length < 24) throw new HttpError(503, 'not_configured', 'INGEST_SECRET ausente ou curto demais.');
  const header = req.headers.authorization || '';
  const given = header.startsWith('Bearer ') ? header.slice(7) : '';
  const h = (s) => createHash('sha256').update(s).digest();
  return timingSafeEqual(h(given), h(secret));
}

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

export default handler(async (req, res) => {
  if (!authorized(req)) throw new HttpError(401, 'unauthorized', 'Não autorizado.');
  const body = await readJsonBody(req).catch(() => {
    throw new HttpError(400, 'bad_json', 'JSON inválido.');
  });
  if (!Array.isArray(body.rows) || body.rows.length > MAX_ROWS) {
    throw new HttpError(400, 'bad_payload', `Esperado { rows: [...] } com até ${MAX_ROWS} linhas.`);
  }
  const rows = [];
  for (const r of body.rows) {
    if (!r || !isIsoDate(r.date) || r.campaignId == null) continue;
    rows.push({
      date: r.date,
      campaignId: String(r.campaignId).slice(0, 40),
      campaignName: String(r.campaignName ?? '').slice(0, 300),
      status: String(r.status ?? '').slice(0, 30),
      spend: num(r.spend),
      impressions: num(r.impressions),
      clicks: num(r.clicks),
      conversions: num(r.conversions),
      revenue: num(r.revenue),
    });
  }
  const dates = rows.map((r) => r.date).sort();
  const snapshot = {
    receivedAt: new Date().toISOString(),
    currency: /^[A-Z]{3}$/.test(body.currency) ? body.currency : 'BRL',
    from: isIsoDate(body.from) ? body.from : dates[0] || null,
    to: isIsoDate(body.to) ? body.to : dates[dates.length - 1] || null,
    rows,
  };
  await setJson(GOOGLE_SCRIPT_KEY, snapshot);
  sendJson(res, 200, { ok: true, rows: rows.length, from: snapshot.from, to: snapshot.to });
}, { methods: ['POST'] });
