# 📜 Development Guidelines & Engineering Rules — RedeemRelay

## 1. Core Principles & Philosophy
1. **Single Source of Truth**: `PROJECT_MEMORY.md` must be kept updated whenever core architectural, database, or UI changes occur.
2. **Minimal Code, Maximum Stability**: Prefer standard Node.js native libraries and light dependencies over bloat.
3. **Non-Blocking Execution**: Ensure all DB operations use `@libsql/client` async interface (`await db.execute(...)`) to prevent event-loop freezing.

---

## 2. Mandatory DOM ID Preservation (Frontend Rules)

### 2.1 Critical DOM Element Rules
When refactoring or updating `public/index.html` or `public/style.css`:
- **NEVER change or delete existing DOM element IDs** that `public/app.js` depends on.
- **NEVER change `data-tab`, `data-game`, `data-status`, or `data-sort` attributes**.
- `public/app.js` must remain untouched unless explicitly requested by the user.

### 2.2 Essential ID Inventory
- Navigation & Topbar: `globalProgressBar`, `toastContainer`, `sidebarBackdrop`, `sidebar`, `btnToggleSidebarCollapse`, `mobileCloseBtn`, `mobileToggleBtn`, `searchInput`, `runNowBtn`
- Warnings & Banners: `sourceWarningBanner`, `warningBannerText`
- Tab Panes: `overviewTab`, `sourcesTab`, `logsTab`, `configTab`
- Stat Cards: `statTotalCodes`, `statActiveCodes`, `statSourcesOk`, `statWebhooksCount`
- Quick Add Form: `manualCodeForm`, `manualGame`, `manualCodeType`, `manualCode`, `manualRewards`, `btnManualAdd`
- Force Broadcast: `forceGameSelect`, `forceStatusSelect`, `btnForceSend`
- Feed Table & Filters: `codesTable`, `codesTbody`, `codesCountPill`, `btnCopyAllActive`, `gameFilter`, `statusFilter`, `paginationInfo`, `btnPrevPage`, `btnNextPage`
- Tables: `sourcesTbody`, `btnRefreshSources`, `logsTbody`, `logLevelFilter`, `btnRefreshLogs`, `logsCountBadge`, `activeSourcesBadge`
- Config & Webhooks: `pollSeconds`, `discordBotToken`, `defaultMessageTemplate`, `btnSaveGlobalConfig`, `webhooksListContainer`, `btnAddWebhookCard`
- API Docs Modal: `docsModal`, `btnCloseDocs`, `docsContent`, `btnOpenDocs`

---

## 3. Scraper & Anti-Bot Engine Rules
1. **Tier 1 First, Tier 2 Fallback**: Scrapers must attempt fast native HTTP fetch first. Camofox (`http://camofox:9377`) should only be invoked upon HTTP 403 or 429 Cloudflare challenges.
2. **Circuit Breaker**: If a scraper fails 5 consecutive times, set `circuit_breaker_active = 1` and pause requests to that source to prevent IP bans.
3. **Empty-Scrape Protection**: If a scraper returns 0 codes, log a warning and do not purge existing active codes from database.
4. **Strict Code Validation (`isValidCode`)**: Every scraped candidate code MUST pass `isValidCode()` validation. Quantity multipliers (`X100`, `X120`, `X4000`, `100X`), concatenated item strings (`X10000ADVENTURER`, `X30000HERO`), number-suffix tokens (`000NL`, `13TH`), and UI/site names (`VG247`, `COPIED`, `REDEEM`) must be rejected immediately.
5. **Reward Anti-Pollution (`cleanRewards`)**: Rewards text must be sanitized to strip any instance of the code itself, UI action tokens (`Copied`, `▶︎ Redeem Code Link`), and date strings to prevent cross-contamination.

---

## 4. Docker & Container Deployment Rules
1. **Camofox Environment**:
   - `docker-compose.yml` MUST specify `DISPLAY=:99` under `camofox` environment to pin the Xvfb display.
   - `docker-compose.yml` MUST specify `shm_size: 512m` under `camofox` service to prevent Playwright Firefox shared memory crashes.
2. **Healthchecks**:
   - `camofox-browser`: Use `curl -sf http://localhost:9377` (do NOT use `wget` as it is not installed in the image).
   - `redeem-relay`: Use `node -e "require('http').get('http://localhost:3000/api/version', ...)"` (do NOT use `wget` or `curl` as they are not present in the slim Node runtime).

---

## 5. Security & Authentication Rules
1. **Timing-Safe Auth**: Admin API endpoints requiring authorization headers must perform constant-time string comparison (`crypto.timingSafeEqual`) to prevent timing attacks.
2. **Rate-Limiting**: Sliding-window rate limiter must enforce max requests per IP window on protect routes.
3. **SQL Injection Prevention**: All SQL queries MUST use parameterized arguments (`sql: "SELECT * FROM codes WHERE game = ?", args: [game]`). Direct string concatenation in queries is strictly prohibited.
