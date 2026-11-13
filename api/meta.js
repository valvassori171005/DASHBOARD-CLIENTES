import { isDemo, metaReady } from '../lib/config.js';
import { parseRange } from '../lib/dates.js';
import { demoData } from '../lib/demo.js';
import { getQuery, handler, HttpError, sendJson } from '../lib/http.js';
import { fetchMeta } from '../lib/meta.js';
import { buildPayload } from '../lib/normalize.js';

export default handler(async (req, res) => {
  const range = parseRange(getQuery(req));
  let mode = 'api';
  let result;
  if (isDemo()) {
    mode = 'demo';
    result = demoData('meta', range);
  } else {
    if (!metaReady()) throw new HttpError(503, 'not_configured', 'Meta Ads ainda não configurado (META_ACCESS_TOKEN / META_AD_ACCOUNT_ID).');
    result = await fetchMeta(range);
  }
  sendJson(res, 200, buildPayload({ platform: 'meta', mode, range, ...result }), { cache: true });
});
