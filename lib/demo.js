// Dados sintéticos e determinísticos para desenvolver o front sem tokens (DEMO_MODE=1).
import { eachDay } from './dates.js';
import { sumRows } from './normalize.js';

function rand(seed) {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15;
  return ((h >>> 0) % 10000) / 10000;
}

const CAMPAIGNS = {
  meta: [
    { id: '120210000001', name: '[LEAD] Check-up Executivo', status: 'ACTIVE', budget: 140, cpm: 22, ctr: 0.012, cvr: 0.09 },
    { id: '120210000002', name: '[LEAD] Ortopedia - Consultas', status: 'ACTIVE', budget: 95, cpm: 18, ctr: 0.014, cvr: 0.07 },
    { id: '120210000003', name: '[MSG] WhatsApp Agendamento', status: 'ACTIVE', budget: 80, cpm: 15, ctr: 0.018, cvr: 0.11 },
    { id: '120210000004', name: '[ALCANCE] Institucional', status: 'PAUSED', budget: 40, cpm: 8, ctr: 0.006, cvr: 0.01 },
  ],
  google: [
    { id: '21000000001', name: 'Pesquisa | Pronto Atendimento', status: 'ENABLED', budget: 160, cpm: 120, ctr: 0.07, cvr: 0.08 },
    { id: '21000000002', name: 'Pesquisa | Exames de Imagem', status: 'ENABLED', budget: 90, cpm: 95, ctr: 0.06, cvr: 0.06 },
    { id: '21000000003', name: 'PMax | Maternidade', status: 'ENABLED', budget: 70, cpm: 30, ctr: 0.02, cvr: 0.04 },
  ],
};

function rowsFor(platform, since, until) {
  const rows = [];
  for (const date of eachDay(since, until)) {
    const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
    const weekend = dow === 0 || dow === 6 ? 0.7 : 1;
    for (const c of CAMPAIGNS[platform]) {
      const k = (s) => rand(`${platform}|${c.id}|${date}|${s}`);
      if (c.status.includes('PAUSED') && date > '2026-10-15') continue;
      const spend = c.budget * weekend * (0.75 + k('s') * 0.5);
      const impressions = Math.round((spend / c.cpm) * 1000 * (0.85 + k('i') * 0.3));
      const clicks = Math.round(impressions * c.ctr * (0.8 + k('c') * 0.4));
      const conversions = Math.round(clicks * c.cvr * (0.6 + k('v') * 0.8));
      rows.push({ date, campaignId: c.id, campaignName: c.name, status: c.status, spend, impressions, clicks, conversions, revenue: 0 });
    }
  }
  return rows;
}

export function demoData(platform, range) {
  return {
    rows: rowsFor(platform, range.since, range.until),
    previousTotals: sumRows(rowsFor(platform, range.prevSince, range.prevUntil)),
    source: 'DADOS DE DEMONSTRAÇÃO',
    notes: ['Modo demonstração: números sintéticos, não são dados reais.'],
  };
}
