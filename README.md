# RedeemRelay

[![CI](https://github.com/YOUR_USERNAME/reedemcode/actions/workflows/ci.yml/badge.svg)](https://github.com/kenewjr/reedemcode/actions/workflows/ci.yml)

24/7 multi-game redeem code aggregator. Scrapes 20+ sources, deduplicates via SQLite, and broadcasts new codes to multiple Discord webhooks automatically.

## Supported Games

| Game | Web Redeem | Sources |
|------|-----------|---------|
| Honkai: Star Rail | ✅ | HoyoCodes API, Fandom Wiki, Game8, PCGamesN, Destructoid |
| Genshin Impact | ✅ | HoyoCodes API, Fandom Wiki, Game8, Siliconera, VG247, RockPaperShotgun |
| Wuthering Waves | ❌ | Fandom Wiki, PCGamesN, Destructoid, PCGamer, Game8 |
| Arknights: Endfield | ❌ | Game8, GamesRadar |
| Neverness to Everness | ❌ | PCGamesN, DotGG, Game8 |

## Features

- **Multi-source scraping** with auto-deduplication (SQLite)
- **Anti-bot bypass** — dual-tier fetcher: stealth headers + [Camofox](https://github.com/jo-inc/camofox-browser) anti-detect browser fallback
- **Multi-webhook** — send to many Discord servers/channels simultaneously
- **Discord Announcement Auto-Publish** — optional crossposting via Bot Token
- **Custom templates** — `{{gameName}}`, `{{code}}`, `{{rewards}}`, `{{redeemUrl}}`, `{{tags}}`, etc.
- **Role/User tagging** — `<@&roleId>` and `<@userId>` per webhook
- **3-tier code lifecycle** — `unconfirmed` → `active` → `expired` with smart auto-expiry
- **Circuit breaker** — backoff on repeatedly failing sources
- **Web Dashboard** — dark glassmorphism UI with code browser, source health, webhook management
- **REST API** — public read-only + admin protected endpoints
- **Docker ready** — side-by-side with Camofox browser container

## Quick Start

### Prerequisites

- **Node.js ≥ 22.5.0**

### Local

```bash
# 1. Clone & install
git clone https://github.com/YOUR_USERNAME/reedemcode.git
cd reedemcode
npm install

# 2. Setup config
cp data/config.example.json data/config.json
# Edit data/config.json — set adminToken, webhook URL, etc.

# 3. Start server
npm start
# → http://localhost:3000
```

### Docker (24/7)

```bash
# 1. Setup config
cp data/config.example.json data/config.json
# Edit data/config.json

# 2. Configure environment in docker-compose.yml
# Set ADMIN_TOKEN, DISCORD_WEBHOOK_URL, etc.

# 3. Start containers (app + Camofox anti-bot browser)
docker compose up -d --build

# 4. View logs
docker compose logs -f redeem-relay
```

Data persists in `./data/` via Docker volume mount.

## Configuration

All settings live in `data/config.json`. See [config.example.json](data/config.example.json) for the full template.

| Key | Description |
|-----|-------------|
| `adminToken` | Password for Dashboard UI & Admin API |
| `pollSeconds` | Scrape interval in seconds (default: 60) |
| `discordBotToken` | Optional — required only for Announcement Channel auto-publish |
| `webhooks[]` | Array of Discord webhook configs (URL, username, avatar, game filter, tags, etc.) |
| `defaultMessageTemplate` | Fallback text template with `{{variable}}` placeholders |

### Webhook Config

Each webhook supports:
- `allGames` / `games[]` — scope which games trigger this webhook
- `autoPublish` + `channelId` — auto-crosspost to announcement channels (requires `discordBotToken`)
- `rolesToTag` / `usersToTag` — Discord mention IDs
- `customMessage` — override default embed with text template

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP server port |
| `ADMIN_TOKEN` | — | Overrides `config.json` adminToken |
| `POLL_SECONDS` | `60` | Overrides `config.json` pollSeconds |
| `DISCORD_WEBHOOK_URL` | — | Default webhook URL fallback |
| `CAMOFOX_URL` | — | Camofox browser endpoint (e.g. `http://camofox:9377`) |
| `TEST_DB_PATH` | — | Isolated SQLite path for testing |

## API

Full documentation: **[docs/API.md](docs/API.md)**

### Public (rate-limited 60 req/min)

| Endpoint | Description |
|----------|-------------|
| `GET /api/version` | App version |
| `GET /api/run-status` | Live poll progress |
| `GET /api/public/codes` | Code list (filter: `?game=hsr&status=active`) |
| `GET /api/public/codes/count` | Count breakdown per game/status |
| `GET /api/public/sources` | Source health status |
| `GET /api/public/games` | Game registry metadata |
| `GET /api/public/logs` | System audit logs |
| `POST /api/public/verify-token` | Validate admin token |

### Admin (requires `Authorization: Bearer <token>`)

| Endpoint | Description |
|----------|-------------|
| `GET/PUT /api/config` | Read/update config |
| `POST /api/config/webhooks` | Create webhook |
| `PUT/DELETE /api/config/webhooks/:id` | Update/delete webhook |
| `POST /api/run-now` | Trigger manual poll |
| `POST /api/test-webhook` | Send test message |
| `POST /api/manual-code` | Insert code manually |
| `PUT /api/admin/code` | Override code attributes |
| `POST /api/force-send` | Force-broadcast codes to webhooks |

## Testing

```bash
# Run full test suite (creates isolated test DB)
npm test
```

Tests cover: DB lifecycle, pagination, auto-expiry, parser (HoyoCodes JSON, Fandom Wikitext, Cheerio HTML), Discord embed generation, circuit breaker, webhook payload handling, token normalization, channel ID validation, and audit logging.

## Project Structure

```
├── server.js              # HTTP server, auth, rate limiter, polling engine
├── src/
│   ├── db.js              # SQLite via @libsql/client (async)
│   ├── fetcher.js         # Dual-tier anti-bot fetcher
│   ├── parser.js          # HoyoCodes JSON + Fandom Wikitext + Cheerio HTML parsers
│   ├── sources.js         # 20+ scraper source definitions
│   ├── discord.js         # Webhook sender + announcement crosspost
│   ├── template.js        # Message template engine + Discord embeds
│   ├── state.js           # Config file reader/writer
│   └── games/
│       └── registry.js    # 5-game registry with redeem URLs
├── public/                # Web Dashboard (HTML/CSS/JS)
├── docs/API.md            # API documentation
├── test.js                # Test suite (node:test)
├── Dockerfile             # Container build
├── docker-compose.yml     # App + Camofox side-by-side
└── data/
    ├── config.example.json  # Config template
    ├── config.json          # Your config (gitignored)
    └── redeem.sqlite        # Database (gitignored)
```

## License

MIT
