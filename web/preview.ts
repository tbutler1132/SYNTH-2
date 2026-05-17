import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(__dirname, 'dist');
const PORT = Number(process.env.PORT) || 8000;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

interface Resolved { path: string; size: number; }

function resolveFile(urlPath: string): Resolved | null {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const segments = decoded.split('/').filter(Boolean);
  if (segments.some(s => s === '..' || s === '.')) return null;
  const base = path.join(DIST, ...segments);
  for (const c of [base, path.join(base, 'index.html')]) {
    try {
      const stat = fs.statSync(c);
      if (stat.isFile()) return { path: c, size: stat.size };
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT' && code !== 'ENOTDIR') throw e;
    }
  }
  return null;
}

try {
  fs.accessSync(DIST);
} catch {
  console.error(`web/dist/ doesn't exist — run 'npm run build:web' first`);
  process.exit(1);
}

const server = http.createServer((req, res) => {
  const file = resolveFile(req.url ?? '/');
  if (!file) {
    res.statusCode = 404;
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    res.end(`404 — ${req.url}\n`);
    return;
  }
  res.setHeader('content-type', MIME[path.extname(file.path).toLowerCase()] ?? 'application/octet-stream');
  res.setHeader('content-length', String(file.size));
  fs.createReadStream(file.path).pipe(res);
});

server.listen(PORT, () => {
  console.log(`preview → http://localhost:${PORT}`);
});
