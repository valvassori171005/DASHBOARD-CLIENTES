// Datas sempre como strings AAAA-MM-DD (fuso da conta de anúncios).
import { HttpError } from './http.js';

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 400;

export function isIsoDate(s) {
  if (typeof s !== 'string' || !ISO.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(since, until) {
  return Math.round((Date.parse(`${until}T00:00:00Z`) - Date.parse(`${since}T00:00:00Z`)) / 86400000) + 1;
}

export function eachDay(since, until) {
  const out = [];
  for (let d = since; d <= until; d = addDays(d, 1)) out.push(d);
  return out;
}

function checkRange(since, until, label) {
  if (!isIsoDate(since) || !isIsoDate(until)) {
    throw new HttpError(400, 'bad_range', `Período ${label} inválido: use AAAA-MM-DD.`);
  }
  if (until < since) throw new HttpError(400, 'bad_range', `Período ${label}: data final antes da inicial.`);
  if (daysBetween(since, until) > MAX_DAYS) {
    throw new HttpError(400, 'bad_range', `Período ${label} maior que ${MAX_DAYS} dias.`);
  }
}

// ?since=&until=[&prev_since=&prev_until=]
// Sem prev_*: usa o período de mesmo tamanho imediatamente anterior.
export function parseRange(params) {
  const since = params.get('since');
  const until = params.get('until');
  checkRange(since, until, 'atual');
  let prevSince = params.get('prev_since');
  let prevUntil = params.get('prev_until');
  if (!prevSince || !prevUntil) {
    const len = daysBetween(since, until);
    prevUntil = addDays(since, -1);
    prevSince = addDays(since, -len);
  }
  checkRange(prevSince, prevUntil, 'anterior');
  return { since, until, prevSince, prevUntil };
}
