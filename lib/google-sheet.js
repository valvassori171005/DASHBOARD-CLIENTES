// Plano B: lê a planilha (Google Sheets) que o Script do Google Ads atualiza de hora em hora.
// A planilha é publicada como CSV (Arquivo → Compartilhar → Publicar na Web → CSV).
//
// Layout da aba (escrito pelo script):
//   A..I  date | campaignId | campaignName | status | spend | impressions | clicks | conversions | revenue
//   K1:L3 atualizado_em / moeda / desde  (metadados)
import { googleSheetUrl } from './config.js';
import { isIsoDate } from './dates.js';
import { HttpError } from './http.js';
import { sumRows } from './normalize.js';

export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// Aceita "1234.56", "1234,56" e "1.234,56" (caso a planilha formate os números em pt-BR).
export function parseNumber(v) {
  let s = String(v ?? '').trim().replace(/[^\d.,-]/g, '');
  if (!s) return 0;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

// Aceita AAAA-MM-DD ou dd/mm/aaaa.
function parseDate(v) {
  const s = String(v ?? '').trim();
  if (isIsoDate(s)) return s;
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m && isIsoDate(`${m[3]}-${m[2]}-${m[1]}`) ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

export function snapshotFromCsv(text) {
  const table = parseCsv(text);
  const meta = {};
  for (const r of table.slice(0, 5)) if (r[10]) meta[r[10].trim()] = (r[11] || '').trim();
  const rows = [];
  for (const r of table.slice(1)) {
    const date = parseDate(r[0]);
    if (!date || !r[1]) continue;
    rows.push({
      date,
      campaignId: r[1].trim(),
      campaignName: r[2] || '',
      status: r[3] || '',
      spend: parseNumber(r[4]),
      impressions: parseNumber(r[5]),
      clicks: parseNumber(r[6]),
      conversions: parseNumber(r[7]),
      revenue: parseNumber(r[8]),
    });
  }
  const dates = rows.map((r) => r.date).sort();
  return {
    updatedAt: meta.atualizado_em || null,
    currency: /^[A-Z]{3}$/.test(meta.moeda || '') ? meta.moeda : 'BRL',
    from: parseDate(meta.desde) || dates[0] || null,
    rows,
  };
}

export async function fetchGoogleFromSheet(range) {
  const res = await fetch(googleSheetUrl(), { redirect: 'follow' });
  const text = await res.text();
  if (!res.ok || /^\s*<!doctype html|<html/i.test(text)) {
    throw new HttpError(502, 'sheet_error', 'Não foi possível ler a planilha do Google Ads. Confira se ela está publicada como CSV.');
  }
  const snap = snapshotFromCsv(text);
  if (!snap.rows.length) {
    throw new HttpError(503, 'no_data_yet', 'A planilha do Google Ads ainda está vazia. Rode o script no Google Ads.');
  }
  const inRange = (r, a, b) => r.date >= a && r.date <= b;
  const notes = [`Atualizado via Script do Google Ads → Google Sheets (dados desde ${snap.from})`];
  if (snap.from && range.prevSince < snap.from) notes.push('Período anterior começa antes dos dados disponíveis: comparação parcial.');
  return {
    rows: snap.rows.filter((r) => inRange(r, range.since, range.until)),
    previousTotals: sumRows(snap.rows.filter((r) => inRange(r, range.prevSince, range.prevUntil))),
    currency: snap.currency,
    source: 'Google Ads (Script agendado → Google Sheets)',
    dataUpdatedAt: snap.updatedAt,
    notes,
  };
}
