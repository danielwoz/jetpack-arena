import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

const DIST = path.resolve(import.meta.dirname, '../../dist');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.map': 'application/json',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.webp': 'image/webp',
};

export async function serveStatic(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let urlPath = (req.url ?? '/').split('?')[0];
  if (urlPath === '/') urlPath = '/index.html';

  const file = path.join(DIST, path.normalize(urlPath));
  if (!file.startsWith(DIST)) {
    res.writeHead(403).end('forbidden');
    return;
  }

  try {
    const st = await stat(file);
    const etag = `"${st.size.toString(16)}-${st.mtimeMs.toString(16)}"`;
    // vite fingerprints /assets/* so those never change; everything else
    // revalidates by ETag and gets a cheap 304 on repeat visits
    const cache = urlPath.startsWith('/assets/')
      ? 'public, max-age=31536000, immutable'
      : 'public, max-age=0, must-revalidate';
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, { ETag: etag, 'Cache-Control': cache });
      res.end();
      return;
    }
    const data = await readFile(file);
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream',
      ETag: etag,
      'Cache-Control': cache,
    });
    res.end(data);
  } catch {
    if (urlPath === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('webfps game server is running.\nNo client build found — run `npm run build` first, or use `npm run dev` and open http://localhost:5173\n');
    } else {
      res.writeHead(404).end('not found');
    }
  }
}
