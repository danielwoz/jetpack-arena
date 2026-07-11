import { readFile } from 'node:fs/promises';
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
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream' });
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
