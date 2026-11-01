/**
 * Faithful local preview of `site/dist` (no dependencies).
 *
 * `vite preview` runs with `appType: 'spa'`, so it falls back to
 * `dist/index.html` for `/tier` and `/blog`. That document is the home page:
 * the client then hydrates the real route into the home page's DOM, which
 * looks exactly like a hydration bug (#418) that only exists in preview.
 *
 * Cloudflare Pages resolves `<path>/index.html` per directory and serves
 * `404.html` for unknown paths, so this server does the same:
 *
 *   /              -> dist/index.html
 *   /tier          -> dist/tier/index.html
 *   /blog/         -> dist/blog/index.html
 *   /data/x.json   -> dist/data/x.json
 *   anything else  -> dist/404.html (status 404, no SPA fallback)
 *
 * Usage: `node scripts/preview.mjs` (port from `PORT`, default 4173).
 */

import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(rootDir, 'dist');
const notFoundFile = path.join(distDir, '404.html');

const DEFAULT_PORT = 4173;
const PORT = Number.parseInt(process.env.PORT ?? '', 10) || DEFAULT_PORT;

const CONTENT_TYPES = new Map([
  ['html', 'text/html; charset=utf-8'],
  ['js', 'text/javascript; charset=utf-8'],
  ['mjs', 'text/javascript; charset=utf-8'],
  ['css', 'text/css; charset=utf-8'],
  ['json', 'application/json; charset=utf-8'],
  ['csv', 'text/csv; charset=utf-8'],
  ['md', 'text/markdown; charset=utf-8'],
  ['xml', 'application/xml; charset=utf-8'],
  ['txt', 'text/plain; charset=utf-8'],
  ['svg', 'image/svg+xml'],
  ['png', 'image/png'],
  ['jpg', 'image/jpeg'],
  ['jpeg', 'image/jpeg'],
  ['ico', 'image/x-icon'],
  ['woff2', 'font/woff2'],
  ['webp', 'image/webp'],
  ['map', 'application/json; charset=utf-8'],
]);

function contentTypeFor(filePath) {
  const extension = path.extname(filePath).slice(1).toLowerCase();
  return CONTENT_TYPES.get(extension) ?? 'application/octet-stream';
}

async function statOrNull(filePath) {
  try {
    return await stat(filePath);
  } catch {
    return null;
  }
}

function send(response, status, headers, body) {
  response.writeHead(status, headers);
  if (body === undefined) {
    response.end();
    return;
  }
  response.end(body);
}

function sendText(response, status, text) {
  send(
    response,
    status,
    { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    text,
  );
}

function isInsideDist(filePath) {
  return filePath === distDir || filePath.startsWith(distDir + path.sep);
}

/**
 * Decoded, traversal-checked segments of a request path.
 * Returns `null` for anything suspicious (encoded `..`, backslashes, NUL).
 */
function requestSegments(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }

  if (decoded.includes('\0') || decoded.includes('\\')) {
    return null;
  }

  // `decodeURIComponent` runs first, so `%2e%2e%2f` becomes `../` and is
  // rejected exactly like a literal `..` segment.
  const segments = decoded.split('/').filter((segment) => segment !== '');
  if (segments.some((segment) => segment === '.' || segment === '..')) {
    return null;
  }
  return segments;
}

/** Map a request path to a file inside `dist`, or `null` when nothing matches. */
async function resolveFile(pathname) {
  const segments = requestSegments(pathname);
  if (segments === null) {
    return { kind: 'rejected' };
  }

  const candidate = path.resolve(distDir, ...segments);
  if (!isInsideDist(candidate)) {
    return { kind: 'rejected' };
  }

  const info = await statOrNull(candidate);
  if (info === null) {
    return { kind: 'missing' };
  }

  if (info.isDirectory()) {
    const indexFile = path.join(candidate, 'index.html');
    const indexInfo = await statOrNull(indexFile);
    return indexInfo?.isFile() === true ? { kind: 'file', file: indexFile } : { kind: 'missing' };
  }

  return info.isFile() ? { kind: 'file', file: candidate } : { kind: 'missing' };
}

async function handle(request, response) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    sendText(response, 405, 'Method Not Allowed');
    return;
  }

  // Throwing URLs (`http://[`) and malformed escapes are client errors.
  let pathname;
  try {
    pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
  } catch {
    sendText(response, 400, 'Bad Request');
    return;
  }

  const resolved = await resolveFile(pathname);

  if (resolved.kind === 'rejected') {
    sendText(response, 400, 'Bad Request');
    return;
  }

  let file = resolved.kind === 'file' ? resolved.file : null;
  let status = 200;

  if (file === null) {
    status = 404;
    file = notFoundFile;
  }

  let body;
  try {
    body = await readFile(file);
  } catch {
    sendText(response, 404, 'Not Found');
    return;
  }

  const headers = {
    'Content-Type': contentTypeFor(file),
    'Content-Length': String(body.byteLength),
    'X-Content-Type-Options': 'nosniff',
  };
  if (headers['Content-Type'].startsWith('text/html')) {
    headers['Cache-Control'] = 'no-store';
  }

  response.writeHead(status, headers);
  response.end(request.method === 'HEAD' ? undefined : body);
}

const server = createServer((request, response) => {
  handle(request, response).catch((error) => {
    console.error('[preview] request failed:', error);
    if (!response.headersSent) {
      sendText(response, 500, 'Internal Server Error');
    } else {
      response.end();
    }
  });
});

server.on('error', (error) => {
  console.error(`[preview] cannot listen on port ${PORT}:`, error.message);
  process.exitCode = 1;
});

server.listen(PORT, () => {
  console.log(`[preview] serving ${path.relative(process.cwd(), distDir) || 'dist'} at http://localhost:${PORT}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
