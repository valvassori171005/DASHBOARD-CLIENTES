// Vercel Routing Middleware (roda antes do cache da CDN).
// Exige o JWT do Cloudflare Access em todas as rotas (exceto o ingest, que tem segredo próprio).
// Sem isso, a URL *.vercel.app ficaria aberta, contornando o Cloudflare Access.
// Se CF_ACCESS_TEAM_DOMAIN / CF_ACCESS_AUD não estiverem definidos, não bloqueia (dev/preview).

export const config = { matcher: ['/((?!api/ingest/).*)'] };

let jwksCache = { keys: null, at: 0 };

function b64urlToBytes(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function getKeys(team) {
  if (jwksCache.keys && Date.now() - jwksCache.at < 3600_000) return jwksCache.keys;
  const res = await fetch(`https://${team}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error('certs');
  const { keys } = await res.json();
  jwksCache = { keys, at: Date.now() };
  return keys;
}

function readCookie(header, name) {
  for (const part of (header || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

async function verify(token, team, aud) {
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [h, p, sig] = parts;
  const header = JSON.parse(new TextDecoder().decode(b64urlToBytes(h)));
  const payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(p)));
  if (header.alg !== 'RS256') return false;
  const jwk = (await getKeys(team)).find((k) => k.kid === header.kid);
  if (!jwk) return false;
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlToBytes(sig), new TextEncoder().encode(`${h}.${p}`));
  if (!ok) return false;
  const now = Math.floor(Date.now() / 1000);
  const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  return auds.includes(aud) && payload.iss === `https://${team}` && payload.exp > now && (payload.nbf ?? 0) <= now + 60;
}

export default async function middleware(request) {
  const team = (process.env.CF_ACCESS_TEAM_DOMAIN || '').trim();
  const aud = (process.env.CF_ACCESS_AUD || '').trim();
  if (!team || !aud) return; // proteção desligada

  const token = request.headers.get('cf-access-jwt-assertion')
    || readCookie(request.headers.get('cookie'), 'CF_Authorization');
  try {
    if (token && (await verify(token, team, aud))) return; // segue para a rota
  } catch {
    // cai no 403
  }
  return new Response('Acesso restrito. Entre pelo endereço oficial do dashboard.', {
    status: 403,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
