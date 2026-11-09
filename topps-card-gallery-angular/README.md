# Topps Baseball Archive — Angular 22 + ArangoDB

A responsive, card-based baseball card viewer for **1948–1983 Topps** with search by year, player/card number, team, issue, rookie card, Hall of Fame, and presence of front/back images. Select a thumbnail to view a larger front/back image and variation details.

![Version](https://img.shields.io/badge/Angular-22.2-red) ![Server](https://img.shields.io/badge/Node-HTTP_API-green)

## Important catalog limitations

By default, the server reads `Data-queries/cardsight_cards_named_attributes.json`, a CardSight export containing **8,952 Topps Base Set records from 1954–1969**. The UI shows CardSight card names and team attributes; `RC` is mapped to a positive rookie flag, while Hall of Fame status remains unknown. Each JSON record has an `owns` boolean, initially `false`. Checking a card saves the value back to this file, so the server process needs write permission. The bundled 1948–1983 preliminary catalog remains available in `server/data/` for the earlier demo loader, but is no longer the default datasource.

The two image URLs present in the original dataset were marked unverified there; they are visibly labeled as such. The rest use clear placeholder art. Clicking a placeholder opens the **larger viewer** with an explanation and, when present, an external catalog reference link. After you add front/back image URLs, the same viewer displays those scans without changing the Angular code. Photograph licensing is your responsibility: do not bulk scrape or hotlink from collectors' sites without permission.

## Architecture

```
frontend/                     Angular 22 standalone, signals, zoneless
  src/app/app.html            Responsive card gallery and detail lightbox
  src/app/app.ts              Search, filters, pagination, image state
  src/app/catalog-api.ts      Typed API client
  src/app/app.css             Responsive styling
  proxy.conf.json             /api -> Node development server
server/                       Dependency-free Node.js HTTP API
  index.mjs                   HTTP endpoints + optional built frontend serving
  catalog.mjs                 Dataset loading, filter/search/index, Arango REST
  data/topps_cards.jsonl      Earlier bundled demo catalog
  data/topps_sets.jsonl       Bundled 38 issue records
  data/card_annotations.json  10 sourced rookie/HOF/identity annotations
  test/catalog.test.mjs       Node.js API and data tests
```

The browser never receives CardSight or ArangoDB credentials. The server reads the CardSight JSON file by default and exposes a paginated read-only API. It proxies card image requests to CardSight using `CARDSIGHT_API_KEY`; the key is never sent to the browser. Set `ARANGO_URL` to use the existing ArangoDB datasource instead. The in-memory catalog refreshes every ten minutes by default.

## Requirements

- **Node.js 22.22.3+ (22.x) or 24.15.0+ (24.x)** for Angular 22, or newer supported Node versions. Check [Angular version compatibility](https://angular.dev/reference/versions).
- npm and internet access to install the Angular packages on **your own machine**.
- Optional: ArangoDB (the app runs out of the box with bundled catalog data).

## Quick start (bundled local catalog)

Terminal 1 — start the API without installing dependencies. The default CardSight JSON path is resolved from the workspace layout; set `CARDSIGHT_CARDS_FILE` when the export is elsewhere:

```bash
cd server
export CARDSIGHT_CARDS_FILE='/path/to/cardsight_cards_named_attributes.json'
# Set this in the server environment to enable CardSight images.
export CARDSIGHT_API_KEY='your-rotated-api-key'
npm start
# API: http://localhost:3000/api/meta
```

Terminal 2 — install dependencies and run Angular:

```bash
cd frontend
npm install
npm start
# Web UI: http://localhost:4200
```

On first load, try the **1956** filter and search for **Dean Stone**. Card images are returned through the server proxy; requests require `CARDSIGHT_API_KEY`.

## Connect your existing ArangoDB catalog

First import your catalog using the prior package's `import_arangodb.py` script (see its own README). Then start this API server with environment variables:

```bash
# terminal 1
cd server
export ARANGO_URL='http://127.0.0.1:8529'
export ARANGO_DB='topps_baseball'
export ARANGO_USER='root'
export ARANGO_PASSWORD='YOUR_PASSWORD'
node index.mjs
```

The browser UI can stay running. This uses `topps_cards` and `topps_sets` document collections. It reads the **existing schema** with `_key`, `setCode`, `catalogNumber`, `playerName`, `team`, `variation`, and `images`; it does not modify documents or create collections. The database read is paginated through ArangoDB's Cursor REST API and then indexed in server memory for quick searching.

## Build for production

```bash
cd frontend
npm ci    # if you generated a package-lock.json, otherwise npm install
npm run build
cd ../server
PORT=3000 node index.mjs
# Browse http://localhost:3000
```

Use a reverse proxy with TLS and proper authentication/network restrictions before exposing a private ArangoDB-backed server publicly. The API is read-only and has no login system.

## Deploy to a VPS

For a Docker-based VPS deployment with Caddy HTTPS, Basic Authentication, and persistent ownership data, follow [deploy/README.md](deploy/README.md). The API container is private to the Compose network; only the authenticated HTTPS proxy publishes ports.

## Add images and verified attributes

Use your existing enrichment workflow (`enrich_from_csv.py` + `import_arangodb.py`) to populate the fields in `topps_cards`:

```json
{
  "images": {
    "frontUrl": "https://your-authorized-image-host/cards/1956-135-front.jpg",
    "backUrl": "https://your-authorized-image-host/cards/1956-135-gray-back.jpg",
    "frontVerified": true,
    "backVerified": true,
    "frontSourcePage": "https://your-authorized-image-host/1956-135",
    "backSourcePage": "https://your-authorized-image-host/1956-135"
  },
  "isRookie": false,
  "isHallOfFame": true
}
```

The JSON above is **an example schema with fictional URLs, not real image links**. Use valid licensed files and card-specific image URLs. The `images` object should be merged with the existing document rather than replacing unrelated fields. You can also edit `server/data/card_annotations.json` for researched statuses; annotations are keyed by `<year>:<setCode>:<catalogNumber>` and used in both demo and ArangoDB mode without editing source cards. If the ArangoDB card itself contains explicit boolean fields, those take precedence over the local annotations. Restart the server after editing the annotations.

Image URLs are validated for basic `http`/`https` syntax when served, but the server does **not** verify licensing or crawl third-party sites. `frontVerified`/`backVerified` are provenance indicators from the data source, not proof of ownership.

## API

| Method | Route | Description |
|---|---|---|
| GET | `/api/health` | API and datasource health |
| GET | `/api/meta` | Years, teams, sets, identified/image/flag counts |
| GET | `/api/cards` | Filtered, paginated card states |
| PATCH | `/api/cards/{id}/ownership` | Save `{ "owns": true }` or `{ "owns": false }` to the CardSight JSON file |
| GET | `/api/images/cards/{id}` | CardSight image proxy; requires `CARDSIGHT_API_KEY` |

Query parameters for `/api/cards`:
`search`, `year`, `team`, `set`, `rookie=true`, `hof=true`, `images=true`, `ownership=owned|not-owned|either`, `sort=year-asc|year-desc|player-asc|number-asc`, `page`, `pageSize` (max 100). `either` is the default and does not apply an ownership filter.

Examples:

```bash
curl 'http://localhost:3000/api/cards?year=1956&search=Mantle'
curl 'http://localhost:3000/api/cards?year=1983&rookie=true&hof=true'
curl 'http://localhost:3000/api/cards?year=1956&search=135&pageSize=50'
curl 'http://localhost:3000/api/meta'
```

## Test

```bash
cd server
npm test
```

Tests run with built-in `node:test`, no npm install required. **Frontend Angular packages could not be downloaded in the authoring environment**, so the Angular production build was not executed here; install dependencies locally to build.

## Data accuracy notes

- A card number can have multiple variation-state documents. `variationCount` groups records with equal year/set/catalog number.
- **1956 #135** has two documents: white back and gray back.
- A null `isRookie`/`isHallOfFame` means **unknown**, not false.
- Missing scans are shown as **placeholders** explicitly labeled unavailable.
- Image reference pages and actual front/back scan URLs are separate fields.
- Some historic teams reflect the player era, not necessarily text printed on the card.
- This application is a working viewer for an incomplete research catalog, not a certified master checklist.
