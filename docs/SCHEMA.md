# 📊 Database Schema & API Payload Specifications — RedeemRelay

## 1. Database Schema (`data/redeem.sqlite`)

RedeemRelay uses SQLite managed via `@libsql/client`.

### 1.1 Table: `codes`
Stores redeem code records collected across all sources and games.

| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | Unique record ID |
| `game` | TEXT | NOT NULL | Game identifier (`hsr`, `genshin`, `wuwa`, `endfield`, `nte`) |
| `code` | TEXT | NOT NULL | Upper-case sanitized redemption code string |
| `code_type` | TEXT | DEFAULT 'redeem' | Category: `redeem`, `anniversary`, `livestream`, `patch` |
| `status` | TEXT | DEFAULT 'unconfirmed'| Lifecycle: `active`, `unconfirmed`, `expired` |
| `server` | TEXT | DEFAULT 'All' | Target game server region |
| `rewards` | TEXT | NULL | In-game item rewards text (e.g. `Stellar Jade*100`) |
| `first_seen_at` | TEXT | NOT NULL | ISO timestamp when first saved in system DB |
| `discovered_at` | TEXT | NULL | Original discovery timestamp from source |
| `expires_at` | TEXT | NULL | Expiration timestamp or date text |
| `notes` | TEXT | NULL | Source notes, event context, or conditions |
| `verified_count`| INTEGER | DEFAULT 1 | Count of unique sources confirming this code |

*Unique Index*: `(game, code)` to prevent duplicates.

---

### 1.2 Table: `deliveries`
Tracks Webhook dispatch events for audit purposes.

| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | Unique delivery ID |
| `code_id` | INTEGER | FOREIGN KEY (`codes.id`) | Reference code ID |
| `webhook_id` | TEXT | NOT NULL | Identifier of target webhook |
| `delivered_at` | TEXT | NOT NULL | ISO timestamp of delivery |
| `status` | TEXT | NOT NULL | Delivery result (`SUCCESS`, `FAILED`, `SKIPPED`) |
| `response_code`| INTEGER | NULL | HTTP response code from Discord API |

---

### 1.3 Table: `source_health`
Monitors health metrics and circuit breaker status per scraper source.

| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | TEXT | PRIMARY KEY | Source identifier (e.g. `hsr-hoyocodes`) |
| `game` | TEXT | NOT NULL | Associated game |
| `type` | TEXT | NOT NULL | Scraper type (`hoyo_api`, `fandom_wiki`, `cheerio_web`) |
| `url` | TEXT | NOT NULL | Source URL endpoint |
| `last_status` | TEXT | DEFAULT 'ok' | Status (`ok`, `error`) |
| `last_http_status`| INTEGER| DEFAULT 200 | Last HTTP status code returned |
| `last_codes_found`| INTEGER| DEFAULT 0 | Number of codes extracted in last run |
| `consecutive_failures`| INTEGER| DEFAULT 0 | Counter for backoff & circuit breaker |
| `circuit_breaker_active`| INTEGER| DEFAULT 0 | `1` if circuit breaker tripped, else `0` |
| `last_success_at`| TEXT | NULL | Timestamp of last successful fetch |

---

### 1.4 Table: `system_logs`
System operational audit logs.

| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | Log entry ID |
| `timestamp` | TEXT | NOT NULL | ISO timestamp |
| `level` | TEXT | NOT NULL | `INFO`, `WARN`, `ERROR` |
| `category` | TEXT | NOT NULL | Event domain (`POLL`, `SCRAPER`, `DISCORD`, `DB`) |
| `message` | TEXT | NOT NULL | Log message summary |
| `details_json`| TEXT | NULL | Additional JSON metadata or stack trace |

---

## 2. Configuration Schema (`data/config.json`)

```json
{
  "pollSeconds": 60,
  "discordBotToken": "MTEx... (Optional for Crossposting)",
  "defaultMessageTemplate": "🎮 **[{{gameName}}] New Code Discovered!**...",
  "games": {
    "hsr": { "enabled": true },
    "genshin": { "enabled": true },
    "wuwa": { "enabled": true },
    "endfield": { "enabled": true },
    "nte": { "enabled": true }
  },
  "webhooks": [
    {
      "id": "wh_1723000000000",
      "name": "General Relay",
      "url": "https://discord.com/api/webhooks/...",
      "enabled": true,
      "allGames": true,
      "games": ["hsr", "genshin", "wuwa", "endfield", "nte"],
      "autoPublish": false,
      "channelId": "",
      "rolesToTag": [],
      "usersToTag": [],
      "username": "RedeemRelay Bot",
      "avatarUrl": "",
      "customMessage": ""
    }
  ]
}
```

---

## 3. REST API Payloads & Endpoints

### 3.1 `GET /api/public/codes`
**Query Parameters**: `limit` (default 50), `offset` (default 0), `game`, `status`, `search`, `sort`, `order`  
**Response**:
```json
{
  "ok": true,
  "data": [
    {
      "id": 101,
      "game": "hsr",
      "code": "STARRAIL2026",
      "code_type": "redeem",
      "status": "active",
      "server": "All",
      "rewards": "Stellar Jade*100, Credit*50000",
      "first_seen_at": "2026-08-09T00:00:00.000Z",
      "discovered_at": "2026-08-09",
      "expires_at": "Unknown",
      "notes": "Official Livestream Code",
      "verified_count": 3
    }
  ],
  "pagination": { "total": 101, "limit": 50, "offset": 0 }
}
```

### 3.2 `POST /api/manual-code`
**Request Body**:
```json
{
  "game": "hsr",
  "code": "MANUALCODE2026",
  "code_type": "redeem",
  "rewards": "Stellar Jade*50"
}
```
**Response**:
```json
{ "ok": true, "message": "Code added successfully", "code": "MANUALCODE2026" }
```
