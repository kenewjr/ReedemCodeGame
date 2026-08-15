# 🏗️ System Architecture — RedeemRelay

## 1. High-Level System Architecture

```
                                  ┌───────────────────────────┐
                                  │   20+ Scraper Sources     │
                                  │ (HoyoCodes JSON, Wikitext,│
                                  │   Cheerio Web Scrapers)   │
                                  └─────────────┬─────────────┘
                                                │
                                                ▼
                                   ┌─────────────────────────┐
                                   │    src/fetcher.js       │
                                   │  Dual-Tier Anti-Bot     │
                                   └────┬───────────────┬────┘
                                        │               │
                            Tier 1 Fast │               │ Tier 2 Fallback
                           Native Fetch │               │ Cloudflare 403/429
                                        ▼               ▼
                                 ┌────────────┐   ┌───────────────────┐
                                 │ HTTP Agent │   │ Camofox Browser   │
                                 │ UA Rotate  │   │ (camofox:9377)    │
                                 └─────┬──────┘   └─────────┬─────────┘
                                       │                    │
                                       └────────┬───────────┘
                                                │
                                                ▼
                                   ┌─────────────────────────┐
                                   │     src/parser.js       │
                                   │ HTML/JSON/Wikitext Ext. │
                                   └────────────┬────────────┘
                                                │
                                                ▼
┌──────────────────────────┐       ┌─────────────────────────┐       ┌──────────────────────────┐
│      SQLite DB           │◄─────►│       server.js         │──────►│    src/discord.js       │
│  (@libsql/client async)  │       │   Core Polling Engine   │       │ Multi-Webhook Dispatcher │
│  data/redeem.sqlite      │       └────────────┬────────────┘       └────────────┬─────────────┘
└──────────────────────────┘                    │                                 │
                                                ▼                                 ▼
                                   ┌─────────────────────────┐       ┌──────────────────────────┐
                                   │    Web Dashboard UI     │       │   Discord Channels &     │
                                   │  DaisyUI v4 / Tailwind  │       │ Announcement Crosspost   │
                                   └─────────────────────────┘       └──────────────────────────┘
```

---

## 2. Core Architectural Components

### 2.1 Dual-Tier Scraper Fetcher Engine (`src/fetcher.js`)
- **Tier 1 (Native HTTP)**: Fast fetch with randomized desktop User-Agents, `sec-ch-ua` headers, custom Referer, and exponential backoff retry.
- **Tier 2 (Camofox Anti-Detect Fallback)**: Activated seamlessly when Tier 1 receives HTTP 403 / 429 Cloudflare challenges. Sends snapshot request to `http://camofox:9377/snapshot`.
- **Camofox Environment Configuration**:
  - `DISPLAY=:99` to pin virtual display and prevent Xvfb race conditions.
  - `shm_size: 512m` to allocate sufficient shared memory for Playwright Firefox instances inside Docker.

### 2.2 Async Database Layer (`src/db.js`)
- Powered by **`@libsql/client`** for non-blocking SQLite execution on Node's single-threaded event loop.
- **Schema Tables**: `codes`, `deliveries`, `source_health`, `runs`, `system_logs`.
- **Transactions & Batching**: Used for multi-code insertions and delivery audit record keeping.

### 2.3 Scraper & Parser Registry (`src/sources.js` & `src/parser.js`)
- **Registry Pattern**: Declarative scraper definitions for each of the 5 games (`hsr`, `genshin`, `wuwa`, `endfield`, `nte`).
- **Code Validation Engine (`isValidCode`)**: Pre-filters extracted strings to discard quantity multipliers (`X100`, `X4000`), concatenated reward words (`X10000ADVENTURER`), non-code UI artifacts, and brand tokens.
- **Reward Sanitizer Pipeline (`cleanRewards`)**: Strips embedded code names, action labels (`Copied`, `▶︎ Redeem Code Link`), and dates to prevent description pollution.
- **Parsers**:
  - `parseHoyoCodesJson`: Directly ingests official HoyoCodes API JSON payloads.
  - `parseFandomWikitext`: Cleans wikitext markup, strips HTML comments, and extracts tables.
  - `parseHtmlCheerio`: Robust DOM querying extracting codes from clipboard `<input>` fields, `?code=` URL parameters, code tags, and structured list items while isolating rewards to separate cells.

### 2.4 Discord Webhook Relay (`src/discord.js` & `src/template.js`)
- Multi-webhook dispatch with configurable payload substitution (`{{gameName}}`, `{{code}}`, `{{rewards}}`, `{{redeemUrl}}`).
- Built-in `AbortController` timeout (8s) and rate-limit retry handling (HTTP 429).
- Discord Bot API integration for auto-publishing announcement channel messages (`/channels/{id}/messages/{msgId}/crosspost`).

### 2.5 Web Dashboard UI (`public/`)
- Single Page Application (SPA) built with Vanilla HTML, DaisyUI v4, Tailwind CSS, and ES JS.
- Communicates with `server.js` via REST API endpoints (`/api/public/*`, `/api/config`, etc.).
