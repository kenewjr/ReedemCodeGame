import { createClient } from "@libsql/client";
import fs from "node:fs";
import path from "node:path";

const DATA_DIR = path.resolve("data");
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function getDbPath() {
  const custom = process.env.TEST_DB_PATH;
  if (custom) return `file:${custom}`;
  return `file:${path.join(DATA_DIR, "redeem.sqlite")}`;
}

let client = null;
export function getDbClient() {
  if (!client) {
    client = createClient({ url: getDbPath() });
  }
  return client;
}

export async function initDb() {
  const db = getDbClient();

  await db.execute(`
    CREATE TABLE IF NOT EXISTS codes (
      game TEXT NOT NULL,
      code TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'unconfirmed',
      code_type TEXT NOT NULL DEFAULT 'redeem',
      server TEXT DEFAULT 'All',
      rewards TEXT DEFAULT '',
      discovered_at TEXT DEFAULT '',
      expires_at TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      needs_review INTEGER DEFAULT 0,
      verified_count INTEGER DEFAULT 1,
      is_manual INTEGER DEFAULT 0,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      sources_json TEXT NOT NULL,
      PRIMARY KEY(game, code)
    );
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS deliveries (
      game TEXT NOT NULL,
      code TEXT NOT NULL,
      webhook_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      sent_at TEXT NOT NULL,
      message_id TEXT DEFAULT '',
      error TEXT DEFAULT '',
      PRIMARY KEY(game, code, webhook_id, event_type)
    );
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS source_health (
      id TEXT PRIMARY KEY,
      game TEXT NOT NULL,
      url TEXT NOT NULL,
      type TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      last_status TEXT DEFAULT 'pending',
      last_http_status INTEGER DEFAULT 0,
      last_success_at TEXT DEFAULT '',
      last_error TEXT DEFAULT '',
      last_codes_found INTEGER DEFAULT 0,
      consecutive_failures INTEGER DEFAULT 0,
      circuit_breaker_active INTEGER DEFAULT 0
    );
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_name TEXT NOT NULL DEFAULT 'poll',
      started_at TEXT NOT NULL,
      finished_at TEXT DEFAULT '',
      status TEXT NOT NULL,
      items_found INTEGER DEFAULT 0,
      items_upserted INTEGER DEFAULT 0,
      error TEXT DEFAULT '',
      meta_json TEXT DEFAULT '{}'
    );
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS system_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      level TEXT NOT NULL,
      category TEXT NOT NULL,
      message TEXT NOT NULL,
      details_json TEXT DEFAULT '{}'
    );
  `);

  // Cleanup test artifacts from production DB if present
  if (!process.env.TEST_DB_PATH) {
    await db.execute(`
      DELETE FROM codes 
      WHERE code LIKE 'HSRTEST_%' 
         OR code LIKE 'TESTCODE_%' 
         OR code LIKE 'PAG_%' 
         OR code LIKE 'EXP_%'
    `);
    await db.execute(`
      DELETE FROM source_health 
      WHERE id LIKE 'failing-source-test%'
    `);
    await db.execute(`
      UPDATE source_health 
      SET consecutive_failures = 0, circuit_breaker_active = 0, last_status = 'ok'
      WHERE id IN ('nte-game8', 'wuwa-game8')
    `);
  }

  // Auto-migration helper for existing databases (codes table)
  const tableInfo = await db.execute(`PRAGMA table_info(codes)`);
  const columns = tableInfo.rows.map(r => String(r.name));

  if (!columns.includes("code_type")) {
    await db.execute(`ALTER TABLE codes ADD COLUMN code_type TEXT NOT NULL DEFAULT 'redeem'`);
  }
  if (!columns.includes("notes")) {
    await db.execute(`ALTER TABLE codes ADD COLUMN notes TEXT DEFAULT ''`);
  }
  if (!columns.includes("needs_review")) {
    await db.execute(`ALTER TABLE codes ADD COLUMN needs_review INTEGER DEFAULT 0`);
  }
  if (!columns.includes("verified_count")) {
    await db.execute(`ALTER TABLE codes ADD COLUMN verified_count INTEGER DEFAULT 1`);
  }
  if (!columns.includes("is_manual")) {
    await db.execute(`ALTER TABLE codes ADD COLUMN is_manual INTEGER DEFAULT 0`);
  }

  // Automatic cleanup of pre-existing inflated notes column entries
  try {
    const inflatedNotes = await db.execute("SELECT game, code, notes, verified_count FROM codes WHERE notes LIKE '%Verified by%Verified by%'");
    for (const row of inflatedNotes.rows) {
      const cleanNotes = String(row.notes || "").replace(/(?:\s*\|\s*)?Verified by \d+ sources/gi, "").trim();
      const vCount = Number(row.verified_count) || 1;
      const finalNotes = cleanNotes ? `${cleanNotes} | Verified by ${vCount} sources` : `Verified by ${vCount} sources`;
      await db.execute({
        sql: "UPDATE codes SET notes = ? WHERE game = ? AND code = ?",
        args: [finalNotes, String(row.game), String(row.code)]
      });
    }
  } catch {}
  if (!columns.includes("discovered_at")) {
    await db.execute(`ALTER TABLE codes ADD COLUMN discovered_at TEXT DEFAULT ''`);
  }
  if (!columns.includes("expires_at")) {
    await db.execute(`ALTER TABLE codes ADD COLUMN expires_at TEXT DEFAULT ''`);
  }

  // Auto-migration helper for source_health table
  const srcInfo = await db.execute(`PRAGMA table_info(source_health)`);
  const srcCols = srcInfo.rows.map(r => String(r.name));
  if (!srcCols.includes("consecutive_failures")) {
    await db.execute(`ALTER TABLE source_health ADD COLUMN consecutive_failures INTEGER DEFAULT 0`);
  }
  if (!srcCols.includes("circuit_breaker_active")) {
    await db.execute(`ALTER TABLE source_health ADD COLUMN circuit_breaker_active INTEGER DEFAULT 0`);
  }

  // Auto-migration helper for runs table
  const runsInfo = await db.execute(`PRAGMA table_info(runs)`);
  const runsCols = runsInfo.rows.map(r => String(r.name));
  if (!runsCols.includes("job_name")) {
    await db.execute(`ALTER TABLE runs ADD COLUMN job_name TEXT NOT NULL DEFAULT 'poll'`);
  }
  if (!runsCols.includes("items_found")) {
    await db.execute(`ALTER TABLE runs ADD COLUMN items_found INTEGER DEFAULT 0`);
  }
  if (!runsCols.includes("items_upserted")) {
    await db.execute(`ALTER TABLE runs ADD COLUMN items_upserted INTEGER DEFAULT 0`);
  }
  if (!runsCols.includes("error")) {
    await db.execute(`ALTER TABLE runs ADD COLUMN error TEXT DEFAULT ''`);
  }
  if (!runsCols.includes("meta_json")) {
    await db.execute(`ALTER TABLE runs ADD COLUMN meta_json TEXT DEFAULT '{}'`);
  }
}

export async function addLog(level, category, message, details = {}) {
  try {
    const db = getDbClient();
    await db.execute({
      sql: `INSERT INTO system_logs (timestamp, level, category, message, details_json) VALUES (?, ?, ?, ?, ?)`,
      args: [new Date().toISOString(), level, category, message, JSON.stringify(details)]
    });
  } catch (err) {
    console.error("Failed to write to system_logs DB:", err);
  }
}

export async function getSystemLogs(limit = 100, level = null) {
  const db = getDbClient();
  let query = `SELECT * FROM system_logs WHERE 1=1`;
  const args = [];
  if (level) {
    query += ` AND level = ?`;
    args.push(level);
  }
  query += ` ORDER BY id DESC LIMIT ?`;
  args.push(limit);

  const res = await db.execute({ sql: query, args });
  return res.rows;
}

export async function upsertSourceHealth(source) {
  const db = getDbClient();
  const existingRes = await db.execute({
    sql: `SELECT consecutive_failures FROM source_health WHERE id = ?`,
    args: [source.id]
  });

  let failures = 0;
  if (source.lastStatus === "error") {
    const prev = existingRes.rows[0]?.consecutive_failures || 0;
    failures = Number(prev) + 1;
  }

  const isCircuitBroken = failures >= 5 ? 1 : 0;

  await db.execute({
    sql: `
      INSERT INTO source_health (id, game, url, type, enabled, last_status, last_http_status, last_success_at, last_error, last_codes_found, consecutive_failures, circuit_breaker_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        game = excluded.game,
        url = excluded.url,
        type = excluded.type,
        enabled = excluded.enabled,
        last_status = excluded.last_status,
        last_http_status = excluded.last_http_status,
        last_success_at = CASE WHEN excluded.last_success_at != '' THEN excluded.last_success_at ELSE source_health.last_success_at END,
        last_error = excluded.last_error,
        last_codes_found = excluded.last_codes_found,
        consecutive_failures = excluded.consecutive_failures,
        circuit_breaker_active = excluded.circuit_breaker_active
    `,
    args: [
      source.id,
      source.game,
      source.url,
      source.type,
      source.enabled ? 1 : 0,
      source.lastStatus || "pending",
      source.lastHttpStatus || 0,
      source.lastSuccessAt || "",
      source.lastError || "",
      source.lastCodesFound || 0,
      failures,
      isCircuitBroken
    ]
  });
}

export async function getAllSourceHealth() {
  const db = getDbClient();
  const res = await db.execute(`SELECT * FROM source_health ORDER BY game ASC, id ASC`);
  return res.rows;
}

export async function saveCodeCandidate(candidate) {
  const db = getDbClient();
  const now = new Date().toISOString();
  const getRes = await db.execute({
    sql: `SELECT * FROM codes WHERE game = ? AND code = ?`,
    args: [candidate.game, candidate.code]
  });

  const existing = getRes.rows[0] || null;
  let eventType = null;
  const newSources = candidate.sources || [];

  if (!existing) {
    eventType = "new_code";
    await db.execute({
      sql: `
        INSERT INTO codes (
          game, code, status, code_type, server, rewards, discovered_at, expires_at,
          notes, needs_review, verified_count, is_manual, first_seen_at, last_seen_at, sources_json
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      args: [
        candidate.game,
        candidate.code,
        candidate.status || "unconfirmed",
        candidate.codeType || "redeem",
        candidate.server || "All",
        candidate.rewards || "",
        candidate.discovered || now.split("T")[0],
        candidate.expires || "",
        candidate.notes || "Initial candidate discovery",
        candidate.needsReview ? 1 : 0,
        1,
        candidate.isManual ? 1 : 0,
        now,
        now,
        JSON.stringify(newSources)
      ]
    });
  } else {
    let oldSources = [];
    try {
      oldSources = JSON.parse(String(existing.sources_json || "[]"));
    } catch {}

    const mergedSources = Array.from(new Set([...oldSources, ...newSources]));
    const verifiedCount = mergedSources.length;

    // Status 3-tier transition logic
    let updatedStatus = String(existing.status);
    if (existing.status === "expired" || candidate.status === "expired") {
      updatedStatus = "expired";
      if (existing.status !== "expired") eventType = "expired_code";
    } else if (candidate.status === "active" || verifiedCount >= 2) {
      updatedStatus = "active";
    }

    // Smart Metadata Enrichment (Never overwrite valid data with empty strings)
    const updatedCodeType = (candidate.codeType && candidate.codeType !== "redeem") ? candidate.codeType : String(existing.code_type || "redeem");
    const updatedServer = (candidate.server && candidate.server !== "All") ? candidate.server : String(existing.server || "All");
    const updatedRewards = (candidate.rewards && String(candidate.rewards).trim() !== "") ? candidate.rewards : String(existing.rewards || "");
    const updatedExpires = (candidate.expires && String(candidate.expires).trim() !== "") ? candidate.expires : String(existing.expires_at || "");
    const updatedDiscovered = (candidate.discovered && String(candidate.discovered).trim() !== "") ? candidate.discovered : String(existing.discovered_at || "");

    let baseNotes = String(existing.notes || "")
      .replace(/(?:\s*\|\s*)?Verified by \d+ sources/gi, "")
      .trim();

    let notes = baseNotes;
    if (verifiedCount >= 2) {
      notes = baseNotes ? `${baseNotes} | Verified by ${verifiedCount} sources` : `Verified by ${verifiedCount} sources`;
    }

    await db.execute({
      sql: `
        UPDATE codes SET
          status = ?,
          code_type = ?,
          server = ?,
          rewards = ?,
          discovered_at = ?,
          expires_at = ?,
          notes = ?,
          needs_review = ?,
          verified_count = ?,
          last_seen_at = ?,
          sources_json = ?
        WHERE game = ? AND code = ?
      `,
      args: [
        updatedStatus,
        updatedCodeType,
        updatedServer,
        updatedRewards,
        updatedDiscovered,
        updatedExpires,
        notes,
        candidate.needsReview ? 1 : Number(existing.needs_review || 0),
        verifiedCount,
        now,
        JSON.stringify(mergedSources),
        candidate.game,
        candidate.code
      ]
    });
  }

  const updatedRes = await db.execute({
    sql: `SELECT * FROM codes WHERE game = ? AND code = ?`,
    args: [candidate.game, candidate.code]
  });

  return { record: updatedRes.rows[0], eventType };
}

export async function getCodeRecords({ game, status, code_type, limit = 200, offset = 0 } = {}) {
  const db = getDbClient();
  let query = `SELECT * FROM codes WHERE 1=1`;
  const args = [];

  if (game) {
    query += ` AND game = ?`;
    args.push(game);
  }

  if (status) {
    query += ` AND status = ?`;
    args.push(status);
  }

  if (code_type) {
    query += ` AND code_type = ?`;
    args.push(code_type);
  }

  query += ` ORDER BY CASE WHEN status = 'active' THEN 1 WHEN status = 'unconfirmed' THEN 2 ELSE 3 END, last_seen_at DESC LIMIT ? OFFSET ?`;
  const safeLimit = Math.min(Math.max(1, Number(limit) || 200), 1000);
  const safeOffset = Math.max(0, Number(offset) || 0);
  args.push(safeLimit, safeOffset);

  const res = await db.execute({ sql: query, args });

  let countQuery = `SELECT COUNT(*) as total FROM codes WHERE 1=1`;
  const countArgs = [];
  if (game) {
    countQuery += ` AND game = ?`;
    countArgs.push(game);
  }
  if (status) {
    countQuery += ` AND status = ?`;
    countArgs.push(status);
  }
  if (code_type) {
    countQuery += ` AND code_type = ?`;
    countArgs.push(code_type);
  }

  const countRes = await db.execute({ sql: countQuery, args: countArgs });
  const total = Number(countRes.rows[0]?.total || 0);

  return { rows: res.rows, total, limit: safeLimit, offset: safeOffset };
}

export async function getCodeCounts() {
  const db = getDbClient();
  const res = await db.execute(`
    SELECT game, status, code_type, COUNT(*) as count
    FROM codes
    GROUP BY game, status, code_type
  `);

  const summary = {
    total: 0,
    active: 0,
    expired: 0,
    unconfirmed: 0,
    byGame: {}
  };

  for (const r of res.rows) {
    const game = String(r.game);
    const status = String(r.status);
    const count = Number(r.count);

    summary.total += count;
    if (summary[status] !== undefined) summary[status] += count;

    if (!summary.byGame[game]) {
      summary.byGame[game] = { total: 0, active: 0, expired: 0, unconfirmed: 0 };
    }
    summary.byGame[game].total += count;
    if (summary.byGame[game][status] !== undefined) {
      summary.byGame[game][status] += count;
    }
  }

  return summary;
}

export async function runAutoExpiryCleanup() {
  const db = getDbClient();
  const now = new Date();
  const todayStr = now.toISOString().split("T")[0];
  const twentyOneDaysAgo = new Date(now.getTime() - 21 * 24 * 60 * 60 * 1000).toISOString();

  const dateRes = await db.execute({
    sql: `
      UPDATE codes SET
        status = 'expired',
        notes = CASE WHEN notes = '' THEN 'Auto-expired: past expiration date' ELSE notes || ' | Auto-expired: past expiration date' END
      WHERE status != 'expired' AND expires_at != '' AND expires_at < ?
    `,
    args: [todayStr]
  });

  const unconfirmedRes = await db.execute({
    sql: `
      UPDATE codes SET
        status = 'expired',
        notes = CASE WHEN notes = '' THEN 'Auto-expired: unconfirmed for >21 days' ELSE notes || ' | Auto-expired: unconfirmed for >21 days' END
      WHERE status = 'unconfirmed' AND is_manual = 0 AND first_seen_at < ?
    `,
    args: [twentyOneDaysAgo]
  });

  return {
    expiredByDate: Number(dateRes.rowsAffected || 0),
    expiredStaleUnconfirmed: Number(unconfirmedRes.rowsAffected || 0)
  };
}

export async function hasDelivered(game, code, webhookId, eventType) {
  const db = getDbClient();
  const res = await db.execute({
    sql: `SELECT 1 FROM deliveries WHERE game = ? AND code = ? AND webhook_id = ? AND event_type = ? AND error = ''`,
    args: [game, code, webhookId, eventType]
  });
  return res.rows.length > 0;
}

export async function recordDelivery(game, code, webhookId, eventType, messageId = "", error = "") {
  const db = getDbClient();
  await db.execute({
    sql: `
      INSERT INTO deliveries (game, code, webhook_id, event_type, sent_at, message_id, error)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(game, code, webhook_id, event_type) DO UPDATE SET
        sent_at = excluded.sent_at,
        message_id = excluded.message_id,
        error = excluded.error
    `,
    args: [game, code, webhookId, eventType, new Date().toISOString(), messageId, error]
  });
}

export async function deleteSourceHealth(id) {
  const db = getDbClient();
  await db.execute({
    sql: `DELETE FROM source_health WHERE id = ?`,
    args: [id]
  });
}

export async function startRun(jobName = "poll") {
  const db = getDbClient();
  const res = await db.execute({
    sql: `INSERT INTO runs (job_name, started_at, status) VALUES (?, ?, 'running')`,
    args: [jobName, new Date().toISOString()]
  });
  return Number(res.lastInsertRowid);
}

export async function finishRun(runId, status, itemsFound = 0, itemsUpserted = 0, error = "", meta = {}) {
  const db = getDbClient();
  await db.execute({
    sql: `UPDATE runs SET finished_at = ?, status = ?, items_found = ?, items_upserted = ?, error = ?, meta_json = ? WHERE id = ?`,
    args: [new Date().toISOString(), status, itemsFound, itemsUpserted, error, JSON.stringify(meta), runId]
  });
}
