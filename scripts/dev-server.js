// Servidor local sem dependências: serve /public e as funções de /api, lendo o .env.
// Uso: npm run dev  (ou DEMO_MODE=1 npm run dev)
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..');
const envFile = join(root, '.env');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' };
const port = Number(process.env.PORT) || 3000;

createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  try {
    if (pathname.startsWith('/api/')) {
      const file = join(root, normalize(`${pathname}.js`));
      if (!file.startsWith(join(root, 'api')) || !existsSync(file)) { res.statusCode = 404; return res.end('not found'); }
      const mod = await import(pathToFileURL(file).href);
      return await mod.default(req, res);
    }
    let file = join(root, 'public', normalize(pathname));
    if (!file.startsWith(join(root, 'public'))) { res.statusCode = 403; return res.end(); }
    if ((await stat(file).catch(() => null))?.isDirectory()) file = join(file, 'index.html');
    const body = await readFile(file);
    res.setHeader('Content-Type', TYPES[extname(file)] || 'application/octet-stream');
    res.end(body);
  } catch (err) {
    res.statusCode = err.code === 'ENOENT' ? 404 : 500;
    res.end(res.statusCode === 404 ? 'not found' : String(err));
  }
}).listen(port, () => console.log(`Dashboard local em http://localhost:${port}`));
