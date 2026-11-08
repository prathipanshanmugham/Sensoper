/* Local preview of the website: serves these files and passes /api/* to the Sensoper backend.
   node dev-server.mjs            → http://localhost:5100  (backend at http://localhost:8001)
   PORT=5100 BACKEND=http://localhost:8001 node dev-server.mjs
   In production nginx does the same job (see DEPLOY.md). */
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PORT = Number(process.env.PORT || 5100);
const BACKEND = new URL(process.env.BACKEND || 'http://localhost:8001');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.txt': 'text/plain', '.xml': 'application/xml', '.ico': 'image/x-icon' };

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/public/') || url.pathname.startsWith('/api/client/')) {
    const p = http.request({ host: BACKEND.hostname, port: BACKEND.port, path: req.url, method: req.method,
      headers: { ...req.headers, host: BACKEND.host, 'x-forwarded-for': req.socket.remoteAddress || '' } }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
    p.on('error', () => { res.writeHead(502, { 'content-type': 'application/json' }); res.end('{"detail":"The Sensoper backend isn’t running."}'); });
    req.pipe(p);
    return;
  }
  if (url.pathname.startsWith('/api/')) { res.writeHead(404, { 'content-type': 'application/json' }); res.end('{"detail":"Not found"}'); return; }
  let path = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  if (path.endsWith('/')) path += 'index.html';
  let file = join(ROOT, path);
  try { if ((await stat(file)).isDirectory()) file = join(file, 'index.html'); } catch { /* fall through */ }
  try {
    let body = await readFile(file);
    const type = TYPES[extname(file)] || 'application/octet-stream';
    const headers = { 'content-type': type, 'cache-control': 'no-cache' };
    if (/text|javascript|json|svg|xml/.test(type) && /gzip/.test(req.headers['accept-encoding'] || '')) { body = gzipSync(body); headers['content-encoding'] = 'gzip'; }   // like nginx in production
    res.writeHead(200, headers);
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
    res.end(await readFile(join(ROOT, '404.html')).catch(() => 'Not found'));
  }
}).listen(PORT, () => console.log(`Sensoper website on http://localhost:${PORT} (API → ${BACKEND.href})`));
