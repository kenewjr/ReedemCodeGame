# 📄 Product Requirements Document (PRD) — RedeemRelay

## 1. Executive Summary
**RedeemRelay** is an enterprise-grade, 24/7 automated multi-game redeem code aggregator and notification relay system. It continuously monitors over 20 external sources (official JSON APIs, fandom wikis, gaming news portals) for active redemption codes across 5 major games, deduplicates and verifies them, and automatically broadcasts new codes to multiple Discord channels via Webhooks with optional Discord Announcement crossposting.

---

## 2. Supported Games
1. **Honkai: Star Rail (HSR)** (`hsr`)
2. **Genshin Impact** (`genshin`)
3. **Wuthering Waves (WuWa)** (`wuwa`)
4. **Arknights: Endfield** (`endfield`)
5. **Neverness to Everness (NTE)** (`nte`)

---

## 3. Core Features & Capabilities

### 3.1 24/7 Automated Scraping & Anti-Bot Engine
- **Multi-Source Fetching**: Scrapes 20+ web sources concurrently with jitter delay.
- **Dual-Tier Fetcher Engine**:
  - **Tier 1 (Fast Native)**: Rotates User-Agents, `sec-ch-ua` headers, and exponential backoff retry.
  - **Tier 2 (Camofox Anti-Detect Fallback)**: Automatically routes traffic through side-by-side [Camofox Browser](https://github.com/jo-inc/camofox-browser) (`http://camofox:9377`) with C++ fingerprint spoofing when Cloudflare 403/429 block is detected.
- **Circuit Breaker**: Auto-pauses failing scrapers after 5 consecutive errors to prevent rate-limit bans.

### 3.2 Code Processing & Lifecycle Management
- **3-Tier Lifecycle Statuses**:
  - `active`: Verified working code.
  - `unconfirmed`: Newly discovered code requiring confirmation.
  - `expired`: Code confirmed inactive or auto-cleaned.
- **Categorization**: `redeem`, `anniversary`, `livestream`, `patch`.
- **Strict Code Validation & Anti-Pollution**:
  - Reject quantity multipliers (`X100`, `X120`, `X4000`, `100X`), concatenated item words (`X10000ADVENTURER`, `X30000HERO`), and UI tokens.
  - Separate code from reward cells in HTML tables (supports clipboard `<input>` tags, `?code=` query parameters).
  - Automatically strip the code itself, UI button labels (`Copied`, `▶︎ Redeem Code Link`), and dates from reward descriptions.
- **Deduplication & Sanitization**: Strict normalize-and-hash matching in SQLite database, wikitext comment/quote stripping, and delimited multi-code cell splitting.
- **Auto-Expiry Cleanup**: Lifecycle pipeline to auto-expire stale or past-date codes.
- **Manual Code Control & Bulk Cleanup**: Instant manual status mutation (`/api/code-status`) and bulk delete expired codes per-game or globally (`DELETE /api/config/codes/expired`).

### 3.3 Multi-Webhook Discord Relay
- **Multi-Channel Dispatch**: Distribute codes to multiple Discord Webhooks independently.
- **Granular Game Filtering**: Scope webhooks to all games or specific selected games.
- **Custom Branding**: Custom Webhook name, avatar, and per-webhook template text.
- **Auto-Publishing**: Support Discord Announcement channel crossposting via Bot Token.
- **Role/User Mentions**: Tag specific Role IDs (`<@&id>`) or User IDs (`<@id>`).

### 3.4 Modern Web Dashboard (v3.2.0 UI)
- **DaisyUI v4 + Tailwind CSS Dark Glassmorphism Theme**.
- **Collapsible Sidebar**: Compact icon-only view toggleable on desktop & mobile drawer.
- **Dedicated Redeem Codes Feed Tab (`#codesTab`)**: Full-screen table view with quick actions (Copy Active Codes, Delete Expired Codes) and column sorting.
- **Direct Click-to-Copy UX**: Click on any code cell chip (`.code-clickable`) to copy code directly to clipboard (clean chip without redundant icon).
- **Dashboard Hub Matrix & Activity Stream**: Real-time 5-game status matrix and recent code stream.
- **Unified Quick Push & Force Broadcast Form Grid**: Pixel-aligned 3-column input layout with formal sub-labels.
- **Streamlined Multi-Webhook Accordion**: Direct header switch toggle without opening collapse, compact form padding.
- **Source Health Monitor**: Live HTTP status, failure counts, and circuit breaker status.
- **Audit Logs**: Filterable system event logs (`INFO`, `WARN`, `ERROR`).
- **Config Manager**: Edit global polling interval, bot tokens, and webhooks dynamically.

---

## 4. Non-Functional Requirements
- **Performance**: High concurrency with non-blocking Node.js event loop & `@libsql/client` async DB driver.
- **Availability**: Containerized via Docker (`docker-compose.yml`) with healthcheck auto-recovery.
- **Security**: Timing-safe auth headers (`crypto.timingSafeEqual`), rate-limiting per IP.
- **Data Integrity**: Parameterized SQL queries preventing injection.
