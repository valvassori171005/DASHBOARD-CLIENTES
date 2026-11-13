// Plano B: lê os dados que o Script do Google Ads enviou para /api/ingest/google.
import { HttpError } from './http.js';
import { sumRows } from './normalize.js';
import { getJson, GOOGLE_SCRIPT_KEY } from './store.js';

export async function fetchGoogleFromStore(range) {
  const snap = await getJson(GOOGLE_SCRIPT_KEY);
  if (!snap) {
    throw new HttpError(503, 'no_data_yet', 'Nenhum dado do Google Ads recebido ainda. Rode o script no Google Ads.');
  }
  const inRange = (r, a, b) => r.date >= a && r.date <= b;
  const rows = snap.rows.filter((r) => inRange(r, range.since, range.until));
  const previousTotals = sumRows(snap.rows.filter((r) => inRange(r, range.prevSince, range.prevUntil)));
  const notes = [`Sincronizado via Script do Google Ads (dados desde ${snap.from})`];
  if (range.prevSince < snap.from) notes.push('Período anterior começa antes dos dados disponíveis: comparação parcial.');
  return {
    rows,
    previousTotals,
    currency: snap.currency || 'BRL',
    source: 'Google Ads (Script agendado)',
    dataUpdatedAt: snap.receivedAt,
    notes,
  };
}
