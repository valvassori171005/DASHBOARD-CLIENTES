// Armazenamento leve (Upstash Redis via REST, sem dependências) para o plano B do Google Ads.
import { storeConfig } from './config.js';
import { HttpError } from './http.js';

export const GOOGLE_SCRIPT_KEY = 'gads:script:v1';

async function command(args) {
  const { url, token } = storeConfig();
  if (!url || !token) throw new HttpError(503, 'store_not_configured', 'Armazenamento (Upstash/KV) não configurado.');
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new HttpError(502, 'store_error', `Armazenamento: ${data.error || res.statusText}`);
  return data.result;
}

export async function getJson(key) {
  const raw = await command(['GET', key]);
  return raw ? JSON.parse(raw) : null;
}

export async function setJson(key, value) {
  await command(['SET', key, JSON.stringify(value)]);
}
