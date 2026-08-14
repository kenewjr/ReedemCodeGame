# RedeemRelay REST API Documentation (v3.2.0)

## 1. Public Read-Only & Manual Code APIs (Rate Limited: 60 req/min per IP)

### `GET /api/version`
Returns current app version from `package.json`.

**Response:**
```json
{ "ok": true, "version": "3.2.0" }
```

---

### `GET /api/run-status`
Returns live progress of the current/last poll run.

**Response:**
```json
{
  "ok": true,
  "isPolling": false,
  "progress": {
    "phase": "done",
    "runId": 42,
    "sourcesChecked": 20,
    "totalSources": 20,
    "newCodesFound": 2,
    "savedCount": 45,
    "deliveriesSent": 4,
    "startedAt": "2026-08-14T08:00:00Z",
    "finishedAt": "2026-08-14T08:01:30Z",
    "message": "Poll completed successfully. 2 new codes found."
  }
}
```

---

### `GET /api/public/codes`
Code list with pagination and filters.

**Query Parameters:**
| Param | Values | Default |
|-------|--------|---------|
| `game` | `hsr`, `genshin`, `wuwa`, `endfield`, `nte` | all |
| `status` | `active`, `expired`, `unconfirmed` | all |
| `code_type` | `redeem`, `anniversary`, `livestream`, `patch` | all |
| `limit` | 1–1000 | 200 |
| `offset` | ≥ 0 | 0 |

**Response:**
```json
{
  "ok": true,
  "data": [
    {
      "game": "hsr",
      "code": "XTJ9MV38DL3X",
      "status": "active",
      "code_type": "livestream",
      "server": "All",
      "rewards": "Stellar Jade x100, Refined Aether x4",
      "discovered_at": "2026-08-14",
      "expires_at": "2026-08-15",
      "notes": "Verified by 3 sources",
      "needs_review": 0,
      "verified_count": 3,
      "is_manual": 0,
      "first_seen_at": "2026-08-14T10:00:00Z",
      "last_seen_at": "2026-08-14T12:00:00Z",
      "sources_json": "[\"https://hoyo-codes.seria.moe/...\"]"
    }
  ],
  "pagination": { "total": 45, "limit": 200, "offset": 0 }
}
```

---

### `GET /api/public/codes/count`
Breakdown count per game and status.

**Response:**
```json
{
  "ok": true,
  "data": {
    "total": 128,
    "active": 34,
    "expired": 82,
    "unconfirmed": 12,
    "byGame": {
      "hsr": { "total": 45, "active": 12, "expired": 30, "unconfirmed": 3 },
      "genshin": { "total": 52, "active": 15, "expired": 32, "unconfirmed": 5 },
      "wuwa": { "total": 21, "active": 5, "expired": 14, "unconfirmed": 2 },
      "endfield": { "total": 6, "active": 2, "expired": 3, "unconfirmed": 1 },
      "nte": { "total": 4, "active": 0, "expired": 3, "unconfirmed": 1 }
    }
  }
}
```

---

### `GET /api/public/sources`
Health status of all scraper sources (20+).

---

### `GET /api/public/games`
Game registry with metadata and redeem URLs.

---

### `GET /api/public/status`
Basic polling status.

**Response:**
```json
{ "ok": true, "isPolling": false, "pollInterval": 60 }
```

---

### `GET /api/public/logs`
System audit logs.

**Query Parameters:**
| Param | Default |
|-------|---------|
| `limit` | 100 |
| `level` | all (`INFO`, `WARN`, `ERROR`) |

---

### `POST /api/manual-code`
Insert code manually. Manual codes are protected from auto-expiry-by-absence.

**Body:**
```json
{
  "game": "hsr",
  "code": "STARRAIL2026",
  "codeType": "livestream",
  "rewards": "Stellar Jade x100",
  "server": "All",
  "expires": "2026-12-31",
  "notes": "Version 2.5 stream code"
}
```

---

### `POST /api/code-status`
Update status of an existing code manually.

**Body:**
```json
{
  "game": "hsr",
  "code": "STARRAIL2026",
  "status": "expired"
}
```

**Response:**
```json
{ "ok": true, "message": "Code status updated successfully." }
```

---

## 2. Management & Configuration APIs

### `GET /api/config`
Returns full config.

### `PUT /api/config`
Update config. Validates `channelId` format (must be 17–20 digit snowflake or empty).

**Body:** partial or full config object.

---

### `DELETE /api/config/codes/expired`
Bulk delete all expired codes for a specified game or all games.

**Query Parameters:**
| Param | Values | Default |
|-------|--------|---------|
| `game` | `all`, `hsr`, `genshin`, `wuwa`, `endfield`, `nte` | `all` |

**Response:**
```json
{ "ok": true, "deleted": 14, "game": "hsr" }
```

---

### `POST /api/config/webhooks`
Create new webhook.

**Body:**
```json
{
  "name": "My Webhook",
  "url": "https://discord.com/api/webhooks/...",
  "username": "RedeemRelay",
  "avatarUrl": "",
  "autoPublish": false,
  "channelId": "",
  "enabled": true,
  "allGames": true,
  "games": ["hsr", "genshin"],
  "rolesToTag": ["123456789"],
  "usersToTag": [],
  "customMessage": ""
}
```

### `PUT /api/config/webhooks/:id`
Update webhook by ID. Validates `channelId` format.

### `DELETE /api/config/webhooks/:id`
Delete webhook by ID.

---

### `POST /api/run-now`
Trigger immediate poll cycle.

### `POST /api/test-webhook`
Send test message to a webhook URL.

**Body:**
```json
{
  "url": "https://discord.com/api/webhooks/...",
  "message": "🔔 Test from RedeemRelay!",
  "username": "Test Bot"
}
```

---

### `POST /api/force-send`
Force-broadcast codes to webhooks. Includes rate-limit throttling (~850ms between sends) and circuit breaker on HTTP 429.

**Body:**
```json
{
  "game": "all",
  "status": "active",
  "webhookId": "all"
}
```

**Response:**
```json
{
  "ok": true,
  "sentCount": 15,
  "failedCount": 0,
  "totalTargetCodes": 15,
  "errors": []
}
```
