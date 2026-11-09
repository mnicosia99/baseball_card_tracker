import http from 'node:http';
import path from 'node:path';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createCatalogStore, loadArangoCatalog, loadCardSightCatalog, saveCardSightOwnership } from './catalog.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDirectory = path.resolve(here, '../frontend/dist/topps-card-gallery/browser');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2' };

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(JSON.stringify(body));
}

async function serveCardSightImage(res, cardId) {
  const apiKey = process.env.CARDSIGHT_API_KEY;
  if (!apiKey) return sendJson(res, 503, { error: 'CardSight image access is not configured.' });
  try {
    const imageUrl = `https://api.cardsight.ai/v1/images/cards/${cardId}?format=raw&default=true`;
    const response = await fetch(imageUrl, {
      headers: { accept: 'image/jpeg', 'X-API-Key': apiKey },
      signal: AbortSignal.timeout(30000)
    });
    if (!response.ok) return sendJson(res, response.status === 404 ? 404 : 502, { error: 'Unable to retrieve card image.' });
    const contentType = response.headers.get('content-type') || 'image/jpeg';
    if (!contentType.toLowerCase().startsWith('image/')) return sendJson(res, 502, { error: 'CardSight returned an invalid image response.' });
    res.writeHead(200, {
      'content-type': contentType,
      'cache-control': 'public, max-age=3600',
      'x-content-type-options': 'nosniff'
    });
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    sendJson(res, 502, { error: 'Unable to retrieve card image.' });
  }
}

async function serveFile(res, pathname) {
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { return sendJson(res, 400, { error: 'Bad request' }); }
  const requested = decoded === '/' ? '/index.html' : decoded;
  const filepath = path.resolve(publicDirectory, `.${requested}`);
  if (filepath !== publicDirectory && !filepath.startsWith(`${publicDirectory}${path.sep}`)) return sendJson(res, 403, { error: 'Forbidden' });
  try {
    const info = await stat(filepath);
    if (!info.isFile()) throw new Error('Not a file');
    const data = await readFile(filepath);
    res.writeHead(200, { 'content-type': TYPES[path.extname(filepath)] || 'application/octet-stream', 'x-content-type-options': 'nosniff', 'cache-control': pathname.includes('.') ? 'public, max-age=86400' : 'no-cache' });
    res.end(data);
  } catch {
    // Angular's client-side routing can load index.html for paths without file extensions.
    if (!path.extname(requested) && requested !== '/') return serveFile(res, '/index.html');
    sendJson(res, 404, { error: 'Frontend build not found. In development run npm start in frontend/; for production first run npm run build.' });
  }
}

export function makeServer(store) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    try {
      const ownershipMatch = url.pathname.match(/^\/api\/cards\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/ownership$/i);
      if (ownershipMatch) {
        if (req.method !== 'PATCH') return sendJson(res, 405, { error: 'Method not allowed' });
        if ((await store.get()).meta.mode !== 'cardsight') return sendJson(res, 409, { error: 'Ownership updates require the CardSight JSON catalog.' });
        let body = '';
        for await (const chunk of req) {
          body += chunk;
          if (body.length > 1024) return sendJson(res, 413, { error: 'Request body too large.' });
        }
        let payload;
        try { payload = JSON.parse(body); } catch { return sendJson(res, 400, { error: 'Invalid JSON body.' }); }
        if (typeof payload.owns !== 'boolean') return sendJson(res, 400, { error: 'owns must be a boolean.' });
        const cardId = ownershipMatch[1];
        if (!await saveCardSightOwnership(cardId, payload.owns)) return sendJson(res, 404, { error: 'Card not found.' });
        await store.updateOwns(cardId, payload.owns);
        return sendJson(res, 200, { key: cardId, owns: payload.owns });
      }
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
      const imageMatch = url.pathname.match(/^\/api\/images\/cards\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i);
      if (imageMatch) return await serveCardSightImage(res, imageMatch[1]);
      if (url.pathname.startsWith('/api/images/')) return sendJson(res, 400, { error: 'Invalid card image identifier.' });
      if (url.pathname === '/api/health') return sendJson(res, 200, { status: 'ok', source: (await store.get()).meta.mode });
      if (url.pathname === '/api/meta') return sendJson(res, 200, (await store.get()).meta);
      if (url.pathname === '/api/cards') {
        const query = Object.fromEntries(url.searchParams.entries());
        return sendJson(res, 200, (await store.get()).search(query));
      }
      if (url.pathname.startsWith('/api/')) return sendJson(res, 404, { error: 'Unknown API endpoint' });
      return await serveFile(res, url.pathname);
    } catch (error) {
      console.error('API error:', error);
      return sendJson(res, 500, { error: 'Unable to load catalog; check server log.' });
    }
  });
}

export async function startServer({ port = Number(process.env.PORT || 3000) } = {}) {
  const loader = process.env.ARANGO_URL ? loadArangoCatalog : loadCardSightCatalog;
  const store = createCatalogStore(loader, Number(process.env.CATALOG_REFRESH_MS || 600000));
  const catalog = await store.get();
  const server = makeServer(store);
  await new Promise((resolve, reject) => server.once('error', reject).listen(port, resolve));
  const address = server.address();
  console.log(`Topps API listening on http://localhost:${address.port} — ${catalog.meta.mode} mode — ${catalog.meta.counts.total} card states`);
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startServer().catch(error => { console.error(error); process.exitCode = 1; });
}
