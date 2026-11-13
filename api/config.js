// Configuração pública (sem segredos) que o front usa para se montar.
import { clientName, conversionLabel, googleMode, googleReady, isDemo, metaReady } from '../lib/config.js';
import { handler, sendJson } from '../lib/http.js';

export default handler(async (_req, res) => {
  const demo = isDemo();
  sendJson(res, 200, {
    clientName: clientName(),
    conversionLabel: conversionLabel(),
    demo,
    platforms: {
      meta: { enabled: demo || metaReady() },
      google: { enabled: demo || googleReady(), mode: demo ? 'demo' : googleMode() },
    },
  });
});
