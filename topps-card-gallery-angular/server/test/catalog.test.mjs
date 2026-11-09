import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadDemoCatalog, loadCardSightCatalog, createCatalogStore, normalizeCard } from '../catalog.mjs';
import { makeServer } from '../index.mjs';

let catalog;
let server;
let base;

before(async () => {
  catalog = await loadDemoCatalog();
  server = makeServer(createCatalogStore(async () => catalog));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => { await new Promise(resolve => server.close(resolve)); });

test('preliminary archive contains expected years, sets and card states', () => {
  assert.equal(catalog.meta.counts.total, 19887);
  assert.equal(catalog.meta.sets.length, 38);
  assert.equal(catalog.meta.years[0], 1948);
  assert.equal(catalog.meta.years.at(-1), 1983);
});

test('1956 Mantle lists two distinct back variations', () => {
  const cards = catalog.search({ year: '1956', search: 'mantle' });
  assert.equal(cards.total, 2);
  assert.deepEqual(new Set(cards.items.map(c => c.variationLabel)), new Set(['Gray Back', 'White Back']));
  assert(cards.items.every(c => c.variationCount === 2));
  assert(cards.items.every(c => c.isHallOfFame === true));
});

test('rookie and Hall of Fame filter include annotated 1983 rookies', () => {
  const result = catalog.search({ year: '1983', rookie: 'true', hof: 'true' });
  assert.equal(result.total, 3);
  assert.deepEqual(result.items.map(c => c.playerName).sort(), ['Ryne Sandberg', 'Tony Gwynn', 'Wade Boggs']);
});

test('unknown rookie/HOF status stays null rather than becoming false', () => {
  const result = catalog.search({ year: '1962', search: '#2' });
  const item = result.items.find(c => c.cardNumber === '2');
  assert(item);
  assert.equal(item.isHallOfFame, null);
  assert.equal(item.isRookie, null);
});

test('pagination and set filters work', () => {
  const result = catalog.search({ year: '1951', set: '1951:blue_backs', page: '2', pageSize: '10' });
  assert.equal(result.total, 52);
  assert.equal(result.page, 2);
  assert.equal(result.items.length, 10);
  assert.equal(result.pageCount, 6);
});

test('API returns metadata and filtered JSON responses', async () => {
  const metaResponse = await fetch(`${base}/api/meta`);
  assert.equal(metaResponse.status, 200);
  assert.equal((await metaResponse.json()).counts.total, 19887);
  const cardsResponse = await fetch(`${base}/api/cards?year=1980&search=henderson&rookie=true`);
  assert.equal(cardsResponse.status, 200);
  const data = await cardsResponse.json();
  assert.equal(data.total, 1);
  assert.equal(data.items[0].playerName, 'Rickey Henderson');
  assert.equal(data.items[0].isRookie, true);
});

test('prevents unexpected write methods and unknown API routes', async () => {
  assert.equal((await fetch(`${base}/api/cards`, { method: 'POST' })).status, 405);
  assert.equal((await fetch(`${base}/api/something`)).status, 404);
});


test('1956 Cubs team card retains three separately cataloged front layouts', () => {
  const result = catalog.search({ year: '1956', team: 'Chicago Cubs', pageSize: '100' });
  const teamCards = result.items.filter(card => card.cardNumber === '11');
  assert.equal(teamCards.length, 3);
  assert(teamCards.every(card => card.variationCount === 3));
  assert.deepEqual(new Set(teamCards.map(card => card.variationLabel)), new Set(['Dated 1955', 'Undated centered name', 'Undated left-aligned name']));
});

test('front/back image fields display authorized http(s) URLs and reject unsafe schemes', () => {
  const doc = normalizeCard({ _key: 'test_card', year: 1956, setCode: 'flagship', catalogNumber: '135', images: {
    frontUrl: 'https://images.example.org/front.jpg', backUrl: 'javascript:alert(1)',
    frontVerified: true, backVerified: true
  } });
  assert.equal(doc.images.frontUrl, 'https://images.example.org/front.jpg');
  assert.equal(doc.images.frontVerified, true);
  assert.equal(doc.images.backUrl, null);
  assert.equal(doc.images.backVerified, false);
});

test('CardSight named-attributes export loads the referenced card and rookie tag', async () => {
  const cardSightCatalog = await loadCardSightCatalog();
  const dean = cardSightCatalog.search({ year: '1956', search: 'Dean Stone', pageSize: 1 }).items[0];
  const rookie = cardSightCatalog.search({ year: '1968', search: 'Bill Stoneman', rookie: 'true', pageSize: 1 }).items[0];

  assert.equal(cardSightCatalog.meta.counts.total, 8952);
  assert.deepEqual([cardSightCatalog.meta.years[0], cardSightCatalog.meta.years.at(-1)], [1954, 1969]);
  assert.equal(dean.key, '681a1fd5-e6a0-4919-8d8e-cabe88175b4e');
  assert.equal(dean.team, 'Washington Senators');
  assert.equal(dean.images.frontUrl, '/api/images/cards/681a1fd5-e6a0-4919-8d8e-cabe88175b4e');
  assert.equal(rookie.isRookie, true);
});

test('CardSight image endpoint proxies bytes with a server-side API key', async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.CARDSIGHT_API_KEY;
  let upstreamRequest;
  process.env.CARDSIGHT_API_KEY = 'test-key';
  globalThis.fetch = async (input, options) => {
    if (String(input).startsWith('https://api.cardsight.ai/')) {
      upstreamRequest = { url: String(input), headers: options.headers };
      return new Response(Buffer.from('jpeg-test'), { status: 200, headers: { 'content-type': 'image/jpeg' } });
    }
    return originalFetch(input, options);
  };

  try {
    const response = await originalFetch(`${base}/api/images/cards/681a1fd5-e6a0-4919-8d8e-cabe88175b4e`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/jpeg');
    assert.equal(await response.text(), 'jpeg-test');
    assert.match(upstreamRequest.url, /format=raw&default=true$/);
    assert.equal(upstreamRequest.headers['X-API-Key'], 'test-key');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.CARDSIGHT_API_KEY;
    else process.env.CARDSIGHT_API_KEY = originalApiKey;
  }
});

test('ownership changes persist to CardSight JSON and filter owned versus unowned cards', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'cardsight-ownership-'));
  const filename = path.join(directory, 'cards.json');
  const cardIds = [
    '681a1fd5-e6a0-4919-8d8e-cabe88175b4e',
    '58c1205c-54e7-4225-b10c-15c9800e9540'
  ];
  const rows = cardIds.map((id, index) => ({
    id,
    number: String(index + 1),
    name: `Player ${index + 1}`,
    setId: 'd3093625-8aa0-439a-81db-1a3c43627461',
    setName: 'Base Set',
    releaseName: 'Topps',
    releaseYear: '1956',
    attributes: [],
    attributeNames: []
  }));
  await writeFile(filename, JSON.stringify(rows));
  const originalFilename = process.env.CARDSIGHT_CARDS_FILE;
  process.env.CARDSIGHT_CARDS_FILE = filename;
  const cardSightCatalog = await loadCardSightCatalog(filename);
  const ownershipServer = makeServer(createCatalogStore(async () => cardSightCatalog));
  await new Promise(resolve => ownershipServer.listen(0, '127.0.0.1', resolve));
  const ownershipBase = `http://127.0.0.1:${ownershipServer.address().port}`;

  try {
    assert.equal(cardSightCatalog.search({ ownership: 'owned' }).total, 0);
    assert.equal(cardSightCatalog.search({ ownership: 'not-owned' }).total, 2);
    const response = await fetch(`${ownershipBase}/api/cards/${cardIds[0]}/ownership`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ owns: true })
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { key: cardIds[0], owns: true });
    assert.equal(cardSightCatalog.search({ ownership: 'owned' }).total, 1);
    assert.equal(cardSightCatalog.search({ ownership: 'not-owned' }).total, 1);
    assert.equal(cardSightCatalog.search({ ownership: 'either' }).total, 2);
    assert.equal(JSON.parse(await readFile(filename, 'utf8'))[0].owns, true);
    const reloaded = await loadCardSightCatalog(filename);
    assert.equal(reloaded.search({ ownership: 'owned' }).items[0].key, cardIds[0]);
  } finally {
    await new Promise(resolve => ownershipServer.close(resolve));
    if (originalFilename === undefined) delete process.env.CARDSIGHT_CARDS_FILE;
    else process.env.CARDSIGHT_CARDS_FILE = originalFilename;
    await rm(directory, { recursive: true, force: true });
  }
});
