import { createClient } from "@libsql/client";
import fs from "node:fs";
import path from "node:path";
import { parseExpiryDate, cleanCodeString, isValidCode, cleanRewards, isInstructionalReward, NON_CODES, formatServer, formatExpiry } from "./parser.js";
import { SOURCES } from "./sources.js";

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
  if (process.env.TEST_DB_PATH) {
    client = createClient({ url: getDbPath() });
  } else if (!client) {
    client = createClient({ url: getDbPath() });
  }
  const db = client;

  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      await db.execute("PRAGMA busy_timeout = 10000;");
      await db.execute("PRAGMA journal_mode = WAL;");
      break;
    } catch (err) {
      if (attempt === 5) break;
      await new Promise(resolve => setTimeout(resolve, 300 * attempt));
    }
  }

  const runDbSetup = async () => {

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

  // Cleanup test artifacts, junk guide words, and corrupted codes from production DB if present
  if (!process.env.TEST_DB_PATH) {
    await db.execute(`
      DELETE FROM codes 
      WHERE code LIKE 'HSRTEST_%' 
         OR code LIKE 'TESTCODE_%' 
         OR code LIKE 'PAG_%' 
         OR code LIKE 'EXP_%'
         OR code LIKE '% %'
         OR code GLOB 'X[0-9]*' 
         OR code GLOB '[0-9]*X' 
         OR code GLOB 'X[0-9]*[A-Z]*' 
         OR code GLOB '[0-9][0-9][0-9]*[A-Z]*'
         OR LENGTH(code) < 4
         OR LENGTH(code) > 30
         OR rewards LIKE '%Click on%'
         OR rewards LIKE '%Open the%'
         OR rewards LIKE '%Go into%'
         OR rewards LIKE '%Run on your%'
         OR rewards LIKE '%If you%re travelling%'
         OR rewards LIKE '%Walkthrough%'
         OR rewards LIKE '%Rerun Banner%'
         OR rewards LIKE '%Available Platforms%'
         OR rewards LIKE '%System Requirements%'
    `);

    // Purge any codes matching NON_CODES or failing isValidCode/isInstructionalReward
    try {
      const allDbCodes = await db.execute("SELECT game, code, rewards FROM codes");
      for (const row of allDbCodes.rows) {
        const c = String(row.code).trim().toUpperCase();
        if (!isValidCode(c) || isInstructionalReward(String(row.rewards || ""))) {
          await db.execute({
            sql: "DELETE FROM codes WHERE game = ? AND code = ?",
            args: [String(row.game), String(row.code)]
          });
          await db.execute({
            sql: "DELETE FROM deliveries WHERE game = ? AND code = ?",
            args: [String(row.game), String(row.code)]
          });
        }
      }
    } catch {}

    await db.execute(`
      DELETE FROM source_health 
      WHERE id LIKE 'failing-source-test%'
    `);
    await db.execute(`
      UPDATE source_health 
      SET consecutive_failures = 0, circuit_breaker_active = 0, last_status = 'ok'
      WHERE id IN ('nte-game8', 'wuwa-game8')
    `);

    // Clean any rewards containing code itself or UI artifacts
    try {
      const allCodes = await db.execute("SELECT game, code, rewards FROM codes WHERE rewards != ''");
      for (const row of allCodes.rows) {
        const cleaned = cleanRewards(String(row.rewards || ""), String(row.code || ""));
        if (cleaned !== row.rewards) {
          await db.execute({
            sql: "UPDATE codes SET rewards = ? WHERE game = ? AND code = ?",
            args: [cleaned, String(row.game), String(row.code)]
          });
        }
      }
    } catch {}

    // Clean any server and expires_at containing wikitext artifacts or raw codes
    try {
      const allDbRows = await db.execute("SELECT game, code, server, expires_at FROM codes");
      for (const row of allDbRows.rows) {
        const srv = formatServer(String(row.server || ""));
        const rawExp = String(row.expires_at || "");
        let cleanExp = rawExp;
        if (/indef/i.test(rawExp) || rawExp.includes("<!--") || rawExp.includes("}}")) {
          const parsed = parseExpiryDate(rawExp);
          cleanExp = parsed || (/indef/i.test(rawExp) ? "Permanent" : "");
        }
        if (srv !== row.server || cleanExp !== row.expires_at) {
          await db.execute({
            sql: "UPDATE codes SET server = ?, expires_at = ? WHERE game = ? AND code = ?",
            args: [srv, cleanExp, String(row.game), String(row.code)]
          });
        }
      }
    } catch {}
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

  // Create performance indexes
  try {
    await db.execute(`CREATE INDEX IF NOT EXISTS idx_codes_game_status ON codes(game, status)`);
    await db.execute(`CREATE INDEX IF NOT EXISTS idx_codes_first_seen ON codes(first_seen_at DESC)`);
    await db.execute(`CREATE INDEX IF NOT EXISTS idx_system_logs_ts ON system_logs(timestamp DESC, level)`);
    await db.execute(`CREATE INDEX IF NOT EXISTS idx_deliveries_sent ON deliveries(sent_at DESC)`);

    // Migration & Cleanup for misplaced discovered_at strings containing expiry timezones/text
    await db.execute(`UPDATE codes SET expires_at = discovered_at, discovered_at = '' WHERE discovered_at LIKE '%(PT)%' OR discovered_at LIKE '%UTC%' OR discovered_at LIKE '%Valid%'`);
    // Cleanup corrupt or invalid expires_at dates not matching YYYY-MM-DD format
    await db.execute(`UPDATE codes SET expires_at = '' WHERE expires_at != '' AND expires_at NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`);
  } catch {}
};

  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      await runDbSetup();
      break;
    } catch (err) {
      if (err.message && err.message.includes("SQLITE_BUSY") && attempt < 5) {
        await new Promise(resolve => setTimeout(resolve, 500 * attempt));
      } else {
        throw err;
      }
    }
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
  const isError = source.lastStatus === "error" || (source.lastHttpStatus && source.lastHttpStatus >= 400);
  if (isError) {
    const prev = existingRes.rows[0]?.consecutive_failures;
    failures = (prev !== undefined && prev !== null) ? Number(prev) + 1 : 1;
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
  const validIds = (SOURCES || []).map(s => s.id);

  // Auto-clean orphaned sources from DB that are no longer in active SOURCES configuration (production only)
  if (!process.env.TEST_DB_PATH && validIds.length > 0) {
    const placeholders = validIds.map(() => "?").join(",");
    try {
      await db.execute({
        sql: `DELETE FROM source_health WHERE id NOT IN (${placeholders})`,
        args: validIds
      });
    } catch {}
  }

  const res = await db.execute(`SELECT * FROM source_health ORDER BY game ASC, id ASC`);
  return res.rows;
}

export async function saveCodeCandidate(candidate) {
  const db = getDbClient();
  const rawCode = cleanCodeString(candidate.code);
  if (!rawCode || !isValidCode(rawCode)) {
    return { record: null, eventType: null };
  }
  if (isInstructionalReward(candidate.rewards)) {
    return { record: null, eventType: null };
  }
  candidate.code = rawCode;
  const cleanedRewards = cleanRewards(candidate.rewards || "", candidate.code);
  candidate.rewards = cleanedRewards;
  candidate.server = formatServer(candidate.server);

  const now = new Date();
  const nowIso = now.toISOString();
  const todayStr = nowIso.split("T")[0];

  const getRes = await db.execute({
    sql: `SELECT * FROM codes WHERE game = ? AND code = ?`,
    args: [candidate.game, candidate.code]
  });

  const existing = getRes.rows[0] || null;
  let eventType = null;
  const newSources = candidate.sources || [];

  // Expiration Validation 2: Parse raw expiration string & compare with current fetch date
  const rawExpires = candidate.expires || (existing ? String(existing.expires_at || "") : "");
  const isoParsedExpiry = parseExpiryDate(rawExpires);
  const isPastExpiryDate = !!(isoParsedExpiry && isoParsedExpiry < todayStr);

  // Expiration Validation 1 (Default Source Status) + Validation 2 (Date Comparison)
  let computedStatus = candidate.status || "unconfirmed";
  if (candidate.status === "expired" || isPastExpiryDate) {
    computedStatus = "expired";
  }

  // Write-time validation: Ensure expires_at matches YYYY-MM-DD or 'Permanent' or is empty
  let finalExpiresAt = isoParsedExpiry || "";
  if (!finalExpiresAt && rawExpires) {
    const formatted = formatExpiry(rawExpires);
    if (formatted === "Permanent" || /^\d{4}-\d{2}-\d{2}$/.test(formatted)) {
      finalExpiresAt = formatted;
    }
  }
  if (finalExpiresAt && finalExpiresAt !== "Permanent" && !/^\d{4}-\d{2}-\d{2}$/.test(finalExpiresAt)) {
    finalExpiresAt = "";
  }

  if (!existing) {
    eventType = computedStatus === "expired" ? null : "new_code";
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
        computedStatus,
        candidate.codeType || "redeem",
        candidate.server || "All",
        candidate.rewards || "",
        candidate.discovered || todayStr,
        finalExpiresAt,
        isPastExpiryDate ? (candidate.notes ? `${candidate.notes} | Auto-expired: past parsed expiry` : "Auto-expired: past parsed expiry date") : (candidate.notes || "Initial candidate discovery"),
        candidate.needsReview ? 1 : 0,
        1,
        candidate.isManual ? 1 : 0,
        nowIso,
        nowIso,
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

    // Status transition logic enforcing expiry rules
    let updatedStatus = String(existing.status);
    if (existing.status === "expired" || computedStatus === "expired" || isPastExpiryDate) {
      updatedStatus = "expired";
      if (existing.status !== "expired") eventType = "expired_code";
    } else if (candidate.status === "active" || verifiedCount >= 2) {
      updatedStatus = "active";
    }

    // Smart Metadata Enrichment (Never overwrite valid data with empty strings)
    const updatedCodeType = (candidate.codeType && candidate.codeType !== "redeem") ? candidate.codeType : String(existing.code_type || "redeem");
    const updatedServer = (candidate.server && candidate.server !== "All") ? formatServer(candidate.server) : formatServer(String(existing.server || "All"));
    const updatedRewards = (candidate.rewards && String(candidate.rewards).trim() !== "") ? candidate.rewards : String(existing.rewards || "");
    const existingExpiresClean = (existing && (/^\d{4}-\d{2}-\d{2}$/.test(String(existing.expires_at || "")) || String(existing.expires_at) === "Permanent")) ? String(existing.expires_at) : "";
    const updatedExpires = finalExpiresAt || existingExpiresClean;
    const updatedDiscovered = (candidate.discovered && String(candidate.discovered).trim() !== "") ? candidate.discovered : String(existing.discovered_at || "");

    let baseNotes = String(existing.notes || "")
      .replace(/(?:\s*\|\s*)?Verified by \d+ sources/gi, "")
      .trim();

    let notes = baseNotes;
    if (verifiedCount >= 2) {
      notes = baseNotes ? `${baseNotes} | Verified by ${verifiedCount} sources` : `Verified by ${verifiedCount} sources`;
    }
    if (isPastExpiryDate && !notes.includes("Auto-expired")) {
      notes = notes ? `${notes} | Auto-expired: past parsed expiry` : "Auto-expired: past parsed expiry date";
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
        nowIso,
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

export async function updateCodeStatus(game, code, status) {
  const db = getDbClient();
  const validStatus = ["active", "unconfirmed", "expired"].includes(status) ? status : "expired";
  const now = new Date().toISOString();

  await db.execute({
    sql: `UPDATE codes SET status = ?, last_seen_at = ? WHERE game = ? AND code = ?`,
    args: [validStatus, now, game, code]
  });

  const res = await db.execute({
    sql: `SELECT * FROM codes WHERE game = ? AND code = ?`,
    args: [game, code]
  });

  return res.rows[0] || null;
}

export async function getCodeRecords({ game, status, code_type, search, sort, order, limit = 200, offset = 0 } = {}) {
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

  if (search && search.trim()) {
    const term = `%${search.trim().toLowerCase()}%`;
    query += ` AND (LOWER(code) LIKE ? OR LOWER(rewards) LIKE ? OR LOWER(notes) LIKE ?)`;
    args.push(term, term, term);
  }

  const validSortCols = {
    game: "game",
    code: "code",
    code_type: "code_type",
    status: "status",
    verified_count: "verified_count",
    server: "server",
    rewards: "rewards",
    first_seen: "first_seen_at",
    first_seen_at: "first_seen_at",
    discovered_at: "discovered_at",
    expires_at: "expires_at"
  };

  const sortCol = validSortCols[sort] || null;
  const sortDir = (order && order.toLowerCase() === "asc") ? "ASC" : "DESC";

  if (sortCol) {
    query += ` ORDER BY ${sortCol} ${sortDir}, last_seen_at DESC LIMIT ? OFFSET ?`;
  } else {
    query += ` ORDER BY CASE WHEN status = 'active' THEN 1 WHEN status = 'unconfirmed' THEN 2 ELSE 3 END, last_seen_at DESC LIMIT ? OFFSET ?`;
  }
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
  if (search && search.trim()) {
    const term = `%${search.trim().toLowerCase()}%`;
    countQuery += ` AND (LOWER(code) LIKE ? OR LOWER(rewards) LIKE ? OR LOWER(notes) LIKE ?)`;
    countArgs.push(term, term, term);
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

  // 1. Direct ISO comparison
  const dateRes = await db.execute({
    sql: `
      UPDATE codes SET
        status = 'expired',
        notes = CASE WHEN notes = '' THEN 'Auto-expired: past expiration date' ELSE notes || ' | Auto-expired: past expiration date' END
      WHERE status != 'expired' AND expires_at != '' AND expires_at < ?
    `,
    args: [todayStr]
  });

  // 2. Natural language / Non-ISO date parsing cleanup
  let extraExpiredByDate = 0;
  const activeCodesRes = await db.execute(`SELECT game, code, expires_at, notes FROM codes WHERE status != 'expired' AND expires_at != ''`);
  for (const row of activeCodesRes.rows) {
    const parsedIso = parseExpiryDate(String(row.expires_at || ""));
    if (parsedIso && parsedIso < todayStr) {
      const baseNotes = String(row.notes || "");
      const newNotes = baseNotes ? `${baseNotes} | Auto-expired: past parsed expiry date` : "Auto-expired: past parsed expiry date";
      await db.execute({
        sql: `UPDATE codes SET status = 'expired', expires_at = ?, notes = ? WHERE game = ? AND code = ?`,
        args: [parsedIso, newNotes, String(row.game), String(row.code)]
      });
      extraExpiredByDate++;
    }
  }

  // 3. Stale unconfirmed cleanup
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
    expiredByDate: Number(dateRes.rowsAffected || 0) + extraExpiredByDate,
    expiredStaleUnconfirmed: Number(unconfirmedRes.rowsAffected || 0)
  };
}

export async function hasDelivered(game, code, webhookId, eventType) {
  const db = getDbClient();
  // If eventType is 'new_code', check if ANY successful delivery exists for this code and webhook (even if force_sent previously)
  if (eventType === "new_code") {
    const res = await db.execute({
      sql: `SELECT 1 FROM deliveries WHERE game = ? AND code = ? AND webhook_id = ? AND error = ''`,
      args: [game, code, webhookId]
    });
    return res.rows.length > 0;
  }

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

export async function deleteExpiredCodes(game = null) {
  const db = getDbClient();
  let sql = `DELETE FROM codes WHERE status = 'expired'`;
  const args = [];
  if (game && game !== "all") {
    sql += ` AND game = ?`;
    args.push(game);
  }
  const res = await db.execute({ sql, args });
  return Number(res.rowsAffected || 0);
}

