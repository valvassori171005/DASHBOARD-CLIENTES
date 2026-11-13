// Utilitários HTTP compartilhados pelas funções serverless.

export class HttpError extends Error {
  constructor(status, code, message, { expose = true } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.expose = expose;
  }
}

export const CACHE_1H = 'public, s-maxage=3600, stale-while-revalidate=86400';

export function sendJson(res, status, body, { cache = false } = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', cache ? CACHE_1H : 'no-store');
  res.end(JSON.stringify(body));
}

export function getQuery(req) {
  return new URL(req.url, 'http://localhost').searchParams;
}

// Envolve um handler: erros viram JSON sem vazar detalhes internos (nem tokens).
export function handler(fn, { methods = ['GET'] } = {}) {
  return async (req, res) => {
    try {
      if (!methods.includes(req.method)) {
        res.setHeader('Allow', methods.join(', '));
        throw new HttpError(405, 'method_not_allowed', 'Método não permitido');
      }
      await fn(req, res);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      if (status >= 500) console.error(`[${err.code || 'internal_error'}]`, err.message);
      sendJson(res, status, {
        error: err.code || 'internal_error',
        message: err instanceof HttpError && err.expose ? err.message : 'Erro interno ao consultar os dados.',
      });
    }
  };
}

export async function readJsonBody(req) {
  if (req.body !== undefined && req.body !== null && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body);
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}
