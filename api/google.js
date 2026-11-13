// Mesmo contrato de resposta, venha da API direta ou do plano B (script) — o front não muda.
import { googleMode, googleReady, isDemo } from '../lib/config.js';
import { parseRange } from '../lib/dates.js';
import { demoData } from '../lib/demo.js';
import { fetchGoogleApi } from '../lib/google-ads.js';
import { fetchGoogleFromSheet } from '../lib/google-sheet.js';
import { getQuery, handler, HttpError, sendJson } from '../lib/http.js';
import { buildPayload } from '../lib/normalize.js';

export default handler(async (req, res) => {
  const range = parseRange(getQuery(req));
  let mode = googleMode();
  let result;
  if (isDemo()) {
    mode = 'demo';
    result = demoData('google', range);
  } else if (!googleReady()) {
    throw new HttpError(503, 'not_configured', mode === 'api'
      ? 'Google Ads API ainda não configurada (GADS_*).'
      : 'Google Ads (planilha) ainda não configurado: falta GADS_SHEET_CSV_URL.');
  } else {
    result = mode === 'api' ? await fetchGoogleApi(range) : await fetchGoogleFromSheet(range);
  }
  sendJson(res, 200, buildPayload({ platform: 'google', mode, range, ...result }), { cache: true });
});
