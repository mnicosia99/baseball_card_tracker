import { readFile, rename, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const DATA_DIRECTORY = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data');
const DEFAULT_CARDSIGHT_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../data/cardsight_cards_named_attributes.json');
let ownershipWriteQueue = Promise.resolve();
const SORT_NAMES = new Set(['year-asc', 'year-desc', 'number-asc', 'player-asc']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function asHttpUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') ? url.href : null;
  } catch { return null; }
}

export function normalizeCard(source, annotation = {}) {
  const images = source.images || {};
  const originalReferences = Array.isArray(source.references) ? source.references.filter(Boolean) : [];
  const references = [...new Set([...originalReferences, ...(annotation.reference ? [annotation.reference] : [])])];
  const cardSightId = typeof source.cardSightId === 'string' && UUID_PATTERN.test(source.cardSightId) ? source.cardSightId : null;
  const frontUrl = asHttpUrl(images.frontUrl) || (cardSightId ? `/api/images/cards/${cardSightId}` : null);
  const backUrl = asHttpUrl(images.backUrl);
  const setCode = String(source.setCode ?? 'flagship');
  const year = Number(source.year) || 0;
  return {
    key: String(source._key),
    year,
    setName: source.setName ?? 'Topps Baseball',
    setCode,
    cardNumber: source.cardNumber == null ? null : String(source.cardNumber),
    catalogNumber: source.catalogNumber == null ? null : String(source.catalogNumber),
    playerName: source.playerName || annotation.playerName || null,
    cardTitle: source.cardTitle || annotation.cardTitle || null,
    cardType: source.cardType || 'unknown',
    team: source.team || annotation.team || null,
    variationLabel: source.variation?.label || null,
    variationFamily: source.variation?.family || null,
    variationAttributes: source.variation?.attributes || {},
    variationCount: 1,
    isRookie: typeof source.isRookie === 'boolean' ? source.isRookie : (typeof source.rookieCard === 'boolean' ? source.rookieCard : (typeof annotation.isRookie === 'boolean' ? annotation.isRookie : null)),
    isHallOfFame: typeof source.isHallOfFame === 'boolean' ? source.isHallOfFame : (typeof source.hallOfFame === 'boolean' ? source.hallOfFame : (typeof annotation.isHallOfFame === 'boolean' ? annotation.isHallOfFame : null)),
    owns: source.owns === true,
    images: {
      frontUrl, backUrl,
      frontVerified: !!(frontUrl && (images.frontVerified || cardSightId)),
      backVerified: !!(backUrl && images.backVerified),
      frontSourcePage: asHttpUrl(images.frontSourcePage),
      backSourcePage: asHttpUrl(images.backSourcePage)
    },
    sourcePage: asHttpUrl(images.frontSourcePage) || asHttpUrl(annotation.reference) || references.map(asHttpUrl).find(Boolean) || null,
    identityStatus: source.identityStatus || 'unknown',
    variationStatus: source.variationStatus || 'unknown',
    references
  };
}

function numberValue(value) {
  const match = String(value ?? '').match(/\d+/);
  return match ? Number(match[0]) : 999999;
}

function compareCards(a, b, sort) {
  if (sort === 'year-desc') return (b.year - a.year) || (numberValue(a.cardNumber) - numberValue(b.cardNumber)) || a.key.localeCompare(b.key);
  if (sort === 'player-asc') return (a.playerName || a.cardTitle || 'zzzzz').localeCompare(b.playerName || b.cardTitle || 'zzzzz') || (a.year - b.year) || a.key.localeCompare(b.key);
  if (sort === 'number-asc') return (numberValue(a.cardNumber) - numberValue(b.cardNumber)) || (a.year - b.year) || a.key.localeCompare(b.key);
  return (a.year - b.year) || (numberValue(a.cardNumber) - numberValue(b.cardNumber)) || a.key.localeCompare(b.key);
}

function parseParamInt(value, defaultValue, min, max) {
  const number = Number(value);
  return Number.isSafeInteger(number) ? Math.min(max, Math.max(min, number)) : defaultValue;
}

export function createCatalog(rawCards, sets, annotations = {}, mode = 'demo') {
  const countByNumber = new Map();
  const cards = rawCards.map(source => {
    const code = `${source.year}:${source.setCode}:${source.catalogNumber}`;
    const doc = normalizeCard(source, annotations[code]);
    countByNumber.set(code, (countByNumber.get(code) || 0) + 1);
    return doc;
  });
  for (const card of cards) card.variationCount = countByNumber.get(`${card.year}:${card.setCode}:${card.catalogNumber}`) || 1;
  const cardsByKey = new Map(cards.map(card => [card.key, card]));

  const sorted = Object.fromEntries([...SORT_NAMES].map(sort => [sort, [...cards].sort((a, b) => compareCards(a, b, sort))]));
  const years = [...new Set(cards.map(card => card.year))].sort((a, b) => a - b);
  const teams = [...new Set(cards.map(card => card.team).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const setOptions = sets.map(set => ({ year: set.year, code: set.setCode, name: set.setName })).sort((a, b) => (a.year - b.year) || a.name.localeCompare(b.name));
  const meta = {
    years, teams, sets: setOptions,
    counts: {
      total: cards.length,
      identified: cards.filter(card => !!card.playerName).length,
      withFrontScan: cards.filter(card => !!card.images.frontUrl).length,
      rookieVerified: cards.filter(card => card.isRookie === true).length,
      hallVerified: cards.filter(card => card.isHallOfFame === true).length
    },
    generatedAt: new Date().toISOString(), mode
  };

  function search(query = {}) {
    const page = parseParamInt(query.page, 1, 1, 100000);
    const pageSize = parseParamInt(query.pageSize, 24, 1, 100);
    const year = query.year ? Number(query.year) : null;
    const team = String(query.team ?? '');
    const set = String(query.set ?? '');
    const rookie = query.rookie === 'true';
    const hof = query.hof === 'true';
    const images = query.images === 'true';
    const ownership = query.ownership === 'owned' || query.ownership === 'not-owned' ? query.ownership : 'either';
    const sort = SORT_NAMES.has(query.sort) ? query.sort : 'year-asc';
    const keyword = String(query.search ?? '').slice(0, 120).trim().toLowerCase();
    const normalizedKeyword = keyword.replace(/^#/, '');
    const matching = sorted[sort].filter(card => {
      if (year && card.year !== year) return false;
      if (team && card.team !== team) return false;
      if (set && `${card.year}:${card.setCode}` !== set) return false;
      if (rookie && card.isRookie !== true) return false;
      if (hof && card.isHallOfFame !== true) return false;
      if (images && !card.images.frontUrl && !card.images.backUrl) return false;
      if (ownership === 'owned' && !card.owns) return false;
      if (ownership === 'not-owned' && card.owns) return false;
      if (normalizedKeyword) {
        const text = [card.playerName, card.cardTitle, card.team, card.cardNumber, card.variationLabel, card.year].filter(Boolean).join(' ').toLowerCase();
        if (!text.includes(normalizedKeyword)) return false;
      }
      return true;
    });
    return { total: matching.length, page, pageSize, pageCount: Math.ceil(matching.length / pageSize), items: matching.slice((page - 1) * pageSize, page * pageSize) };
  }
  return {
    meta,
    search,
    updateOwns(key, owns) {
      const card = cardsByKey.get(key);
      if (!card) return false;
      card.owns = owns;
      return true;
    }
  };
}

async function loadJsonl(filename) {
  const text = await readFile(path.join(DATA_DIRECTORY, filename), 'utf8');
  return text.split('\n').filter(Boolean).map(line => JSON.parse(line));
}

export async function loadAnnotations() {
  return JSON.parse(await readFile(path.join(DATA_DIRECTORY, 'card_annotations.json'), 'utf8'));
}

export async function loadDemoCatalog() {
  const [cards, sets, annotations] = await Promise.all([loadJsonl('topps_cards.jsonl'), loadJsonl('topps_sets.jsonl'), loadAnnotations()]);
  return createCatalog(cards, sets, annotations, 'demo');
}

export function normalizeCardSightCard(source) {
  const year = Number(source.releaseYear) || 0;
  const attributes = Array.isArray(source.attributes) ? source.attributes : [];
  return {
    _key: source.id,
    cardSightId: source.id,
    year,
    setCode: source.setId,
    setName: `${source.releaseName} ${source.setName}`.trim(),
    cardNumber: source.number,
    catalogNumber: source.number,
    playerName: source.name || null,
    cardTitle: source.description || source.name || null,
    cardType: 'card',
    team: Array.isArray(source.attributeNames) ? source.attributeNames[0] || null : null,
    owns: source.owns === true,
    isRookie: attributes.includes('RC') ? true : null,
    identityStatus: 'cardsight_catalog',
    variationStatus: source.variationOf || source.variations ? 'variation_data_available' : 'unknown'
  };
}

export function getCardSightFilename() {
  return process.env.CARDSIGHT_CARDS_FILE || DEFAULT_CARDSIGHT_FILE;
}

export async function saveCardSightOwnership(cardId, owns, filename = getCardSightFilename()) {
  const save = ownershipWriteQueue.then(async () => {
    const rows = JSON.parse(await readFile(filename, 'utf8'));
    const card = rows.find(row => row.id === cardId);
    if (!card) return false;
    card.owns = owns;
    const temporaryFile = `${filename}.${process.pid}.tmp`;
    await writeFile(temporaryFile, `${JSON.stringify(rows, null, 2)}\n`);
    await rename(temporaryFile, filename);
    return true;
  });
  ownershipWriteQueue = save.catch(() => {});
  return save;
}

export async function loadCardSightCatalog(filename = getCardSightFilename()) {
  const rows = JSON.parse(await readFile(filename, 'utf8'));
  if (!Array.isArray(rows)) throw new Error('CardSight cards file must contain a JSON array');
  const cards = rows.map(normalizeCardSightCard);
  const sets = [...new Map(cards.map(card => [`${card.year}:${card.setCode}`, {
    year: card.year,
    setCode: card.setCode,
    setName: card.setName
  }])).values()];
  return createCatalog(cards, sets, {}, 'cardsight');
}

async function arangoRequest(method, endpoint, body = null) {
  const base = process.env.ARANGO_URL?.replace(/\/+$/, '');
  const database = process.env.ARANGO_DB || 'topps_baseball';
  if (!base) throw new Error('ARANGO_URL is not configured');
  const url = `${base}/_db/${encodeURIComponent(database)}${endpoint}`;
  const user = process.env.ARANGO_USER || 'root';
  const password = process.env.ARANGO_PASSWORD || '';
  const headers = { 'authorization': `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`, 'content-type': 'application/json' };
  const response = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) });
  const result = await response.json();
  if (!response.ok || result.error) throw new Error(`ArangoDB returned HTTP ${response.status}: ${result.errorMessage || response.statusText}`);
  return result;
}

async function queryAll(collection) {
  // Collection names are program-controlled, never interpolated from a request parameter.
  if (!['topps_cards', 'topps_sets'].includes(collection)) throw new Error('Unsupported collection');
  let reply = await arangoRequest('POST', '/_api/cursor', { query: `FOR document IN ${collection} RETURN document`, batchSize: 4000 });
  const rows = [...reply.result];
  while (reply.hasMore) {
    reply = await arangoRequest('PUT', `/_api/cursor/${encodeURIComponent(reply.id)}`);
    rows.push(...reply.result);
  }
  return rows;
}

export async function loadArangoCatalog() {
  const [cards, sets, annotations] = await Promise.all([queryAll('topps_cards'), queryAll('topps_sets'), loadAnnotations()]);
  return createCatalog(cards, sets, annotations, 'arangodb');
}

export function createCatalogStore(loader, refreshMs = 10 * 60 * 1000) {
  let catalog = null;
  let lastLoad = 0;
  let inFlight = null;
  return {
    async get() {
      if (!catalog || Date.now() - lastLoad > refreshMs) {
        if (!inFlight) inFlight = loader().then(updated => { catalog = updated; lastLoad = Date.now(); return updated; }).finally(() => { inFlight = null; });
        try { await inFlight; } catch (error) { if (!catalog) throw error; console.warn('Refresh failed; serving the previous catalog snapshot:', error.message); lastLoad = Date.now(); }
      }
      return catalog;
    },
    async updateOwns(key, owns) {
      if (!catalog) await this.get();
      return catalog.updateOwns(key, owns);
    }
  };
}
