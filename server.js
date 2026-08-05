import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import crypto from "node:crypto";
import os from "node:os";
import { loadConfig, saveConfig } from "./src/state.js";
import { SOURCES } from "./src/sources.js";
import { GAME_REGISTRY } from "./src/games/registry.js";
import { parseFandomWikitext, parseHtmlCheerio, parseHoyoCodesJson } from "./src/parser.js";
import { 
  initDb,
  saveCodeCandidate, 
  getCodeRecords, 
  getCodeCounts,
  runAutoExpiryCleanup,
  hasDelivered, 
  recordDelivery, 
  startRun, 
  finishRun,
  upsertSourceHealth,
  getAllSourceHealth,
  addLog,
  getSystemLogs
} from "./src/db.js";
import { renderMessage, renderDiscordEmbed, formatTags } from "./src/template.js";
import { sendDiscordWebhook, publishDiscordMessage } from "./src/discord.js";
import { fetchWithBypass } from "./src/fetcher.js";

const PORT = process.env.PORT || 3000;
let isPolling = false;

// Global Live Progress State for /api/run-status
let pollProgress = {
  phase: "idle",
  runId: null,
  sourcesChecked: 0,
  totalSources: 0,
  newCodesFound: 0,
  savedCount: 0,
  deliveriesSent: 0,
  totalDeliveries: 0,
  startedAt: null,
  finishedAt: null,
  message: "Idle"
};

// Simple sliding window in-memory Rate Limiter per IP for /api/public/*
const rateLimitMap = new Map();
function checkRateLimit(ip, limit = 60, windowMs = 60000) {
  const now = Date.now();
  if (!rateLimitMap.has(ip)) {
    rateLimitMap.set(ip, []);
  }
  const timestamps = rateLimitMap.get(ip).filter(t => now - t < windowMs);
  if (timestamps.length >= limit) {
    return false;
  }
  timestamps.push(now);
  rateLimitMap.set(ip, timestamps);
  return true;
}

// Cleanup rate limit map every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, timestamps] of rateLimitMap.entries()) {
    const valid = timestamps.filter(t => now - t < 60000);
    if (valid.length === 0) rateLimitMap.delete(ip);
    else rateLimitMap.set(ip, valid);
  }
}, 5 * 60 * 1000);



// Channel ID format validator (must be empty or 17-20 digit numeric snowflake)
function isValidChannelId(channelId) {
  if (channelId === undefined || channelId === null) return true;
  const str = String(channelId).trim();
  if (!str) return true;
  return /^\d{17,20}$/.test(str);
}

let totalPollCount = 0;

// Core Polling Engine
async function runPoll() {
  if (isPolling) return;
  isPolling = true;
  totalPollCount++;
  const config = loadConfig();
  const runId = await startRun("poll");
  await addLog("INFO", "POLL_START", `Poll run #${runId} started (Cycle #${totalPollCount})`, { pollSeconds: config.pollSeconds });

  const healthRecords = await getAllSourceHealth();
  const healthMap = new Map(healthRecords.map(h => [h.id, h]));

  const activeSources = SOURCES.filter(s => s.enabled);
  pollProgress = {
    phase: "fetching",
    runId,
    sourcesChecked: 0,
    totalSources: activeSources.length,
    newCodesFound: 0,
    savedCount: 0,
    deliveriesSent: 0,
    totalDeliveries: 0,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    finishedAt: null,
    message: `Checking ${activeSources.length} sources across games...`
  };

  const summary = { fetchedSources: 0, newCodes: 0, sentDeliveries: 0, errors: [] };

  try {
    const enabledGameIds = Object.keys(GAME_REGISTRY);

    // Group sources per game for concurrency & empty scrape safety net
    for (const gameId of enabledGameIds) {
      const targetSources = SOURCES.filter(s => s.enabled && s.game === gameId);
      if (targetSources.length === 0) continue;

      const gameCandidates = [];

      // Fetch all sources for this game concurrently using Promise.allSettled
      const results = await Promise.allSettled(
        targetSources.map(async (src) => {
          const hInfo = healthMap.get(src.id);
          const failures = Number(hInfo?.consecutive_failures || 0);

          // Circuit Breaker Backoff Rule: If failing 5+ times, skip fetch unless on 6th poll cycle
          if (failures >= 5 && (totalPollCount % 6 !== 0)) {
            pollProgress.sourcesChecked++;
            pollProgress.updatedAt = new Date().toISOString();
            await addLog("INFO", "CIRCUIT_BREAKER_BACKOFF", `Skipping source ${src.id} (${failures} failures, backoff active)`);
            return [];
          }

          summary.fetchedSources++;
          let status = "ok";
          let httpStatus = 0;
          let errorMsg = "";
          let foundCount = 0;
          let parsed = [];

          try {
            // Jitter delay between native source requests (50ms - 150ms)
            const jitter = Math.floor(Math.random() * 100) + 50;
            await new Promise(r => setTimeout(r, jitter));

            const res = await fetchWithBypass(src.url, { timeoutMs: 10000 });
            httpStatus = res.status;

            if (!res.ok) {
              status = "error";
              errorMsg = `HTTP ${res.status}`;
              await addLog("WARN", "SOURCE_FETCH", `Source ${src.id} returned HTTP ${res.status}`, { url: src.url });
            } else {
              const body = await res.text();

              if (src.type === "hoyo-codes-json") {
                let json = {};
                try { json = JSON.parse(body); } catch {}
                parsed = parseHoyoCodesJson(src.game, json, src.url);
              } else if (src.type === "fandom-wikitext") {
                let wikitext = body;
                try {
                  const json = JSON.parse(body);
                  wikitext = json.parse?.wikitext?.["*"] || body;
                } catch {}
                parsed = parseFandomWikitext(src.game, wikitext, src.url);
              } else {
                parsed = parseHtmlCheerio(src.game, body, src.url);
              }

              foundCount = parsed.length;
            }
          } catch (err) {
            status = "error";
            errorMsg = err.message;
            await addLog("ERROR", "SOURCE_FETCH", `Source ${src.id} failed: ${err.message}`, { url: src.url });
          }

          await upsertSourceHealth({
            ...src,
            lastStatus: status,
            lastHttpStatus: httpStatus,
            lastSuccessAt: status === "ok" ? new Date().toISOString() : "",
            lastError: errorMsg,
            lastCodesFound: foundCount
          });

          pollProgress.sourcesChecked++;
          pollProgress.updatedAt = new Date().toISOString();
          pollProgress.message = `Scraped ${pollProgress.sourcesChecked}/${pollProgress.totalSources} sources (${src.game})...`;

          return parsed;
        })
      );

      for (const res of results) {
        if (res.status === "fulfilled" && Array.isArray(res.value)) {
          gameCandidates.push(...res.value);
        }
      }

      // Safety Net: If a game scrape returns 0 candidates total (all sources failed/empty), skip auto-expiry for this game
      if (gameCandidates.length === 0) {
        await addLog("WARN", "EMPTY_SCRAPE_SKIPPED", `Empty scrape for ${gameId}, skipping expiry - all sources down or empty.`);
        continue;
      }

      pollProgress.phase = "saving";
      pollProgress.updatedAt = new Date().toISOString();
      pollProgress.message = `Processing ${gameCandidates.length} candidate codes for ${gameId}...`;

      // Save Candidates to DB & Notify Webhooks
      for (const cand of gameCandidates) {
        const { record, eventType } = await saveCodeCandidate(cand);
        pollProgress.savedCount++;

        if (eventType === "new_code") {
          summary.newCodes++;
          pollProgress.newCodesFound++;
          await addLog("INFO", "NEW_CODE_FOUND", `Discovered new code ${record.code} for ${record.game}`, record);
        }

        // Notify Discord Webhooks on new or expired code events
        if (eventType) {
          pollProgress.phase = "delivering";
          pollProgress.updatedAt = new Date().toISOString();
          for (const hook of config.webhooks || []) {
            if (!hook.enabled || !hook.url) continue;

            // Multi-Webhook Game Scoping Filter (Point 12)
            const hookGames = Array.isArray(hook.games) ? hook.games : [];
            const isGameAllowed = hook.allGames !== false || hookGames.length === 0 || hookGames.includes(record.game);
            if (!isGameAllowed) continue;

            const alreadyDelivered = await hasDelivered(record.game, record.code, hook.id, eventType);
            if (!alreadyDelivered) {
              const tags = formatTags(hook.rolesToTag, hook.usersToTag);
              
              // If hook has custom text template, use text; else use Discord Embed
              let payloadObj;
              if (hook.customMessage && hook.customMessage.trim()) {
                payloadObj = { content: renderMessage(hook.customMessage, record, tags) };
              } else {
                payloadObj = renderDiscordEmbed(record, tags);
              }

              const delivery = await sendDiscordWebhook(hook.url, payloadObj, {
                username: hook.username,
                avatarUrl: hook.avatarUrl
              });

              if (delivery.ok) {
                summary.sentDeliveries++;
                pollProgress.deliveriesSent++;
                await recordDelivery(record.game, record.code, hook.id, eventType, delivery.messageId, "");
                await addLog("INFO", "WEBHOOK_SENT", `Delivered ${record.code} to webhook ${hook.name}`, { webhookId: hook.id });

                // Discord Auto-Publish Crossposting
                if (hook.autoPublish && config.discordBotToken && hook.channelId && delivery.messageId) {
                  const pubRes = await publishDiscordMessage(hook.channelId, delivery.messageId, config.discordBotToken);
                  if (pubRes.ok) {
                    await addLog("INFO", "AUTO_PUBLISH", `Crossposted message ${delivery.messageId} to channel ${hook.channelId}`);
                  } else {
                    await addLog("WARN", "AUTO_PUBLISH_FAILED", `Failed to crosspost message ${delivery.messageId}: ${pubRes.error}`);
                  }
                }
              } else {
                await recordDelivery(record.game, record.code, hook.id, eventType, "", delivery.error);
                summary.errors.push(`Webhook ${hook.name} failed for ${record.code}: ${delivery.error}`);
                await addLog("ERROR", "WEBHOOK_FAILED", `Failed to send ${record.code} to webhook ${hook.name}: ${delivery.error}`);
              }
            }
          }
        }
      }
    }

    // Run Auto-Expiry Cleanup Pipeline
    const cleanupResult = await runAutoExpiryCleanup();
    await finishRun(runId, "success", summary.fetchedSources, summary.newCodes, "", { ...summary, cleanup: cleanupResult });
    await addLog("INFO", "POLL_FINISH", `Poll run #${runId} finished. New codes: ${summary.newCodes}`, summary);

    pollProgress.phase = "done";
    pollProgress.finishedAt = new Date().toISOString();
    pollProgress.updatedAt = new Date().toISOString();
    pollProgress.message = `Poll completed successfully. ${summary.newCodes} new codes found.`;
    clearApiCache();
  } catch (err) {
    summary.errors.push(err.message);
    await finishRun(runId, "error", summary.fetchedSources, summary.newCodes, err.message, summary);
    await addLog("ERROR", "POLL_ERROR", `Poll run #${runId} failed: ${err.message}`, { error: err.message });

    pollProgress.phase = "error";
    pollProgress.finishedAt = new Date().toISOString();
    pollProgress.updatedAt = new Date().toISOString();
    pollProgress.message = `Poll failed: ${err.message}`;
  } finally {
    isPolling = false;
    if (pollProgress.phase !== "error") {
      pollProgress.phase = "done";
    }
    if (!pollProgress.finishedAt) {
      pollProgress.finishedAt = new Date().toISOString();
    }
    pollProgress.updatedAt = new Date().toISOString();
  }
}

// Helper: Get non-internal IPv4 LAN addresses
function getLanAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === "IPv4" && !iface.internal) {
        addresses.push(iface.address);
      }
    }
  }
  return addresses;
}

// Helper: HTTP Response with Brotli/gzip compression
function respondWithCompression(req, res, statusCode, headers, bodyBufferOrString) {
  const buf = Buffer.isBuffer(bodyBufferOrString)
    ? bodyBufferOrString
    : Buffer.from(bodyBufferOrString);

  const acceptEncoding = req.headers["accept-encoding"] || "";

  if (buf.length > 256) {
    if (acceptEncoding.includes("br")) {
      const compressed = zlib.brotliCompressSync(buf);
      res.writeHead(statusCode, {
        ...headers,
        "Content-Encoding": "br",
        "Content-Length": compressed.length,
        "Vary": "Accept-Encoding"
      });
      return res.end(compressed);
    }
    if (acceptEncoding.includes("gzip")) {
      const compressed = zlib.gzipSync(buf);
      res.writeHead(statusCode, {
        ...headers,
        "Content-Encoding": "gzip",
        "Content-Length": compressed.length,
        "Vary": "Accept-Encoding"
      });
      return res.end(compressed);
    }
  }

  res.writeHead(statusCode, {
    ...headers,
    "Content-Length": buf.length
  });
  return res.end(buf);
}

// Start HTTP Server
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const config = loadConfig();
  const clientIp = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "127.0.0.1";

  const sendJson = (statusCode, data) => {
    const jsonStr = JSON.stringify(data);
    const headers = {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS"
    };
    return respondWithCompression(req, res, statusCode, headers, jsonStr);
  };

  if (req.method === "OPTIONS") {
    return sendJson(204, {});
  }

  const readBody = () => new Promise((resolve) => {
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", () => {
      try { resolve(JSON.parse(body || "{}")); } catch { resolve({}); }
    });
  });

  // Serve static UI & Docs (with gzip/brotli + cache headers)
  if (req.method === "GET" && !url.pathname.startsWith("/api")) {
    let filePath = "";
    if (url.pathname.startsWith("/docs/")) {
      filePath = path.join(".", url.pathname);
    } else {
      filePath = path.join("public", url.pathname === "/" ? "index.html" : url.pathname);
    }

    try {
      try {
        await fs.promises.access(filePath);
      } catch {
        filePath = path.join("public", "index.html");
      }
      const ext = path.extname(filePath);
      const mimeTypes = {
        ".html": "text/html; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".js": "application/javascript; charset=utf-8",
        ".md": "text/markdown; charset=utf-8",
        ".json": "application/json; charset=utf-8",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".svg": "image/svg+xml",
        ".ico": "image/x-icon"
      };
      const content = await fs.promises.readFile(filePath);
      const contentType = mimeTypes[ext] || "text/plain";
      // Cache static assets (CSS/JS) for 1h, HTML for 0 (always revalidate)
      const cacheControl = ext === ".html" ? "no-cache" : "public, max-age=3600";

      return respondWithCompression(req, res, 200, {
        "Content-Type": contentType,
        "Cache-Control": cacheControl
      }, content);
    } catch {
      res.writeHead(404, { "Content-Type": "text/plain" });
      return res.end("Not Found");
    }
  }

  // --- PUBLIC READ-ONLY APIs (Rate Limited) ---
  if (url.pathname === "/api/version") {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.resolve("package.json"), "utf-8"));
      return sendJson(200, { ok: true, version: pkg.version || "2.2.0" });
    } catch {
      return sendJson(200, { ok: true, version: "2.2.0" });
    }
  }

  if (url.pathname === "/api/run-status") {
    return sendJson(200, { ok: true, isPolling, progress: pollProgress });
  }

// Simple In-Memory TTL Cache for High-Frequency Public APIs
const apiCache = new Map();
function getCachedApi(key) {
  const item = apiCache.get(key);
  if (item && (Date.now() - item.ts < 10000)) return item.data;
  return null;
}
function setCachedApi(key, data) {
  apiCache.set(key, { ts: Date.now(), data });
}
function clearApiCache() {
  apiCache.clear();
}

  if (url.pathname.startsWith("/api/public/")) {
    if (!checkRateLimit(clientIp, 60, 60000)) {
      return sendJson(429, { ok: false, error: "Rate limit exceeded. Try again in a minute." });
    }

    if (req.method === "GET" && url.pathname === "/api/public/codes") {
      const game = url.searchParams.get("game");
      const status = url.searchParams.get("status");
      const codeType = url.searchParams.get("code_type");
      const search = url.searchParams.get("search");
      const limit = parseInt(url.searchParams.get("limit") || "200", 10);
      const offset = parseInt(url.searchParams.get("offset") || "0", 10);

      const cacheKey = `codes:${game || 'all'}:${status || 'all'}:${codeType || 'all'}:${search || ''}:${limit}:${offset}`;
      const cached = getCachedApi(cacheKey);
      if (cached) return sendJson(200, cached);

      const result = await getCodeRecords({ game, status, code_type: codeType, search, limit, offset });
      const responsePayload = {
        ok: true,
        data: result.rows,
        pagination: { total: result.total, limit: result.limit, offset: result.offset }
      };
      setCachedApi(cacheKey, responsePayload);
      return sendJson(200, responsePayload);
    }

    if (req.method === "GET" && url.pathname === "/api/public/codes/export") {
      const game = url.searchParams.get("game");
      const status = url.searchParams.get("status") || "active";
      const result = await getCodeRecords({ game: game === "all" ? null : game, status, limit: 500 });
      const codesList = result.rows.map(r => r.code);
      const plainText = codesList.join("\n");

      res.writeHead(200, {
        "Content-Type": "text/plain; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-cache"
      });
      return res.end(plainText);
    }

    if (req.method === "GET" && url.pathname === "/api/public/codes/count") {
      const cacheKey = "counts";
      const cached = getCachedApi(cacheKey);
      if (cached) return sendJson(200, cached);

      const counts = await getCodeCounts();
      const payload = { ok: true, data: counts };
      setCachedApi(cacheKey, payload);
      return sendJson(200, payload);
    }

    if (req.method === "GET" && url.pathname === "/api/public/sources") {
      const sources = await getAllSourceHealth();
      return sendJson(200, { ok: true, data: sources });
    }

    if (req.method === "GET" && url.pathname === "/api/public/games") {
      return sendJson(200, { ok: true, data: GAME_REGISTRY });
    }

    if (req.method === "GET" && url.pathname === "/api/public/status") {
      return sendJson(200, { ok: true, isPolling, pollInterval: config.pollSeconds });
    }

    if (req.method === "GET" && url.pathname === "/api/public/logs") {
      const limit = parseInt(url.searchParams.get("limit") || "100", 10);
      const level = url.searchParams.get("level") || null;
      const logs = await getSystemLogs(limit, level);
      return sendJson(200, { ok: true, data: logs });
    }

  }

  if (req.method === "POST" && url.pathname === "/api/manual-code") {
    const body = await readBody();
    if (!body.game || !body.code) {
      return sendJson(400, { ok: false, error: "Missing required game or code" });
    }

    const cand = {
      game: body.game,
      code: body.code.trim().toUpperCase(),
      status: body.status || "active",
      codeType: body.codeType || "redeem",
      server: body.server || "All",
      rewards: body.rewards || "",
      expires: body.expires || "",
      notes: body.notes || "Manually inserted code",
      isManual: true,
      sources: ["manual-entry"]
    };

    const resData = await saveCodeCandidate(cand);
    clearApiCache();
    await addLog("INFO", "MANUAL_CODE", `Manually added code ${cand.code} for ${cand.game}`);
    return sendJson(200, { ok: true, data: resData });
  }

  // --- MANAGEMENT APIs ---
  if (url.pathname.startsWith("/api/config") || ["/api/run-now", "/api/test-webhook", "/api/force-send"].includes(url.pathname)) {

    if (req.method === "GET" && url.pathname === "/api/config") {
      return sendJson(200, { ok: true, config });
    }

    if (req.method === "PUT" && url.pathname === "/api/config") {
      const body = await readBody();
      if (Array.isArray(body.webhooks)) {
        for (const hook of body.webhooks) {
          if (!isValidChannelId(hook.channelId)) {
            return sendJson(400, { ok: false, error: `Channel ID format tidak valid pada webhook "${hook.name || hook.id}". Channel ID harus berupa 17-20 digit angka.` });
          }
        }
      }
      saveConfig({ ...loadConfig(), ...body });
      addLog("INFO", "CONFIG_UPDATE", "Configuration updated via Admin Dashboard API").catch(() => {});
      return sendJson(200, { ok: true, message: "Configuration saved successfully" });
    }

    // Granular Webhook APIs
    if (req.method === "POST" && url.pathname === "/api/config/webhooks") {
      const body = await readBody();
      if (!isValidChannelId(body.channelId)) {
        return sendJson(400, { ok: false, error: "Channel ID format tidak valid. Channel ID harus berupa 17-20 digit angka." });
      }
      const newWebhook = {
        id: body.id || "hook-" + Date.now(),
        name: body.name || "New Webhook",
        url: body.url || "",
        username: body.username || "",
        avatarUrl: body.avatarUrl || "",
        autoPublish: !!body.autoPublish,
        channelId: body.channelId || "",
        enabled: body.enabled !== false,
        allGames: body.allGames !== false,
        games: Array.isArray(body.games) ? body.games : ["hsr", "genshin", "wuwa", "endfield", "nte"],
        rolesToTag: Array.isArray(body.rolesToTag) ? body.rolesToTag : [],
        usersToTag: Array.isArray(body.usersToTag) ? body.usersToTag : [],
        customMessage: body.customMessage || ""
      };
      const currentCfg = loadConfig();
      const webhooks = currentCfg.webhooks || [];
      webhooks.push(newWebhook);
      saveConfig({ ...currentCfg, webhooks });
      addLog("INFO", "WEBHOOK_CREATED", `Created webhook: ${newWebhook.name}`, { webhookId: newWebhook.id }).catch(() => {});
      return sendJson(201, { ok: true, webhook: newWebhook, message: "Webhook created successfully" });
    }

    if (req.method === "PUT" && url.pathname.startsWith("/api/config/webhooks/")) {
      const hookId = url.pathname.replace("/api/config/webhooks/", "").trim();
      const body = await readBody();
      if (body.channelId !== undefined && !isValidChannelId(body.channelId)) {
        return sendJson(400, { ok: false, error: "Channel ID format tidak valid. Channel ID harus berupa 17-20 digit angka." });
      }
      const currentCfg = loadConfig();
      const webhooks = currentCfg.webhooks || [];
      const idx = webhooks.findIndex(w => w.id === hookId);

      if (idx === -1) {
        return sendJson(404, { ok: false, error: `Webhook with ID ${hookId} not found` });
      }

      webhooks[idx] = {
        ...webhooks[idx],
        ...body,
        id: hookId // Ensure ID remains immutable
      };

      saveConfig({ ...currentCfg, webhooks });
      addLog("INFO", "WEBHOOK_UPDATED", `Updated webhook ${webhooks[idx].name}`, { webhookId: hookId }).catch(() => {});
      return sendJson(200, { ok: true, webhook: webhooks[idx], message: "Webhook updated successfully" });
    }

    if (req.method === "DELETE" && url.pathname.startsWith("/api/config/webhooks/")) {
      const hookId = url.pathname.replace("/api/config/webhooks/", "").trim();
      const currentCfg = loadConfig();
      const webhooks = (currentCfg.webhooks || []).filter(w => w.id !== hookId);

      saveConfig({ ...currentCfg, webhooks });
      addLog("INFO", "WEBHOOK_DELETED", `Deleted webhook ID: ${hookId}`).catch(() => {});
      return sendJson(200, { ok: true, message: `Webhook ${hookId} deleted successfully` });
    }

    if (req.method === "POST" && url.pathname === "/api/run-now") {
      runPoll();
      await addLog("INFO", "MANUAL_POLL", "Manual poll triggered via Admin Dashboard API");
      return sendJson(200, { ok: true, message: "Manual poll triggered in background" });
    }

    if (req.method === "POST" && url.pathname === "/api/test-webhook") {
      const body = await readBody();
      const testUrl = body.url || config.webhooks?.[0]?.url || "";
      await addLog("INFO", "WEBHOOK_TEST", `Testing webhook URL: ${testUrl}`);
      const result = await sendDiscordWebhook(testUrl, body.message || "🔔 Test Webhook Payload from RedeemRelay!", {
        username: body.username,
        avatarUrl: body.avatarUrl
      });
      return sendJson(200, result);
    }



    if (req.method === "POST" && url.pathname === "/api/force-send") {
      const body = await readBody();
      const targetGame = body.game === "all" ? null : body.game;
      const targetStatus = body.status === "all" ? null : (body.status || "active");
      const targetWebhookId = body.webhookId || "all";

      const queryResult = await getCodeRecords({ game: targetGame, status: targetStatus, limit: 1000 });
      // Exclude test code artifacts from broadcast
      const validRecords = queryResult.rows.filter(r => !/^(HSRTEST|TESTCODE|PAG_|EXP_)/i.test(r.code));
      const targetHooks = (config.webhooks || []).filter(w => w.enabled && w.url && (targetWebhookId === "all" || w.id === targetWebhookId));

      let sentCount = 0;
      let failedCount = 0;
      const errors = [];
      const rateLimitedHooks = new Set();

      for (const record of validRecords) {
        for (const hook of targetHooks) {
          if (rateLimitedHooks.has(hook.id)) {
            failedCount++;
            errors.push(`${record.code} -> ${hook.name}: Skipped due to active HTTP 429 rate limit penalty.`);
            continue;
          }

          // Rate Limit Protection Delay: ~850ms jitter between sends to same webhook
          await new Promise(r => setTimeout(r, 850));

          const tags = formatTags(hook.rolesToTag, hook.usersToTag);
          let payloadObj;
          if (hook.customMessage && hook.customMessage.trim()) {
            payloadObj = { content: renderMessage(hook.customMessage, record, tags) };
          } else {
            payloadObj = renderDiscordEmbed(record, tags);
          }

          const delivery = await sendDiscordWebhook(hook.url, payloadObj, {
            username: hook.username,
            avatarUrl: hook.avatarUrl
          });

          if (delivery.ok) {
            sentCount++;
            await recordDelivery(record.game, record.code, hook.id, "force_send", delivery.messageId, "");
            
            // Execute Discord Auto-Publish Crossposting if enabled
            if (hook.autoPublish && config.discordBotToken && hook.channelId && delivery.messageId) {
              const pubRes = await publishDiscordMessage(hook.channelId, delivery.messageId, config.discordBotToken);
              if (pubRes.ok) {
                await addLog("INFO", "AUTO_PUBLISH", `Crossposted message ${delivery.messageId} to announcement channel ${hook.channelId}`);
              } else {
                await addLog("WARN", "AUTO_PUBLISH_FAILED", `Failed to crosspost message ${delivery.messageId}: ${pubRes.error}`, { channelId: hook.channelId, error: pubRes.error });
              }
            }
          } else {
            failedCount++;
            const errMsg = `${record.code} -> ${hook.name}: ${delivery.error}`;
            errors.push(errMsg);
            await recordDelivery(record.game, record.code, hook.id, "force_send", "", delivery.error);

            if (delivery.error && delivery.error.includes("Rate limited")) {
              rateLimitedHooks.add(hook.id);
              await addLog("ERROR", "WEBHOOK_RATE_LIMITED", `Webhook ${hook.name} hit rate limit. Halting subsequent sends in batch.`, { webhookId: hook.id, error: delivery.error });
            } else {
              await addLog("ERROR", "FORCE_SEND_WEBHOOK_FAILED", `Force send failed for code ${record.code} to webhook ${hook.name}: ${delivery.error}`, { webhookId: hook.id, error: delivery.error });
            }
          }
        }
      }

      await addLog("INFO", "FORCE_SEND", `Force broadcast executed for ${validRecords.length} codes. Sent: ${sentCount}, Failed: ${failedCount}`, { errors });
      return sendJson(200, { ok: true, sentCount, failedCount, totalTargetCodes: validRecords.length, errors });
    }
  }

  return sendJson(404, { ok: false, error: "Endpoint not found" });
});

// Initialize Database & Start Server (Only when not running in unit test mode)
if (!process.env.TEST_DB_PATH) {
  initDb().then(() => {
    server.listen(PORT, "0.0.0.0", () => {
      const lanAddrs = getLanAddresses();
      const lanStr = lanAddrs.length > 0 ? lanAddrs.map(ip => `http://${ip}:${PORT}`).join(", ") : `http://0.0.0.0:${PORT}`;
      console.log(`🚀 RedeemRelay Server running on:`);
      console.log(`   - Local:   http://localhost:${PORT}`);
      if (lanAddrs.length > 0) {
        lanAddrs.forEach(ip => console.log(`   - Network: http://${ip}:${PORT}`));
      } else {
        console.log(`   - Network: http://0.0.0.0:${PORT}`);
      }
      addLog("INFO", "SERVER_START", `RedeemRelay server started on port ${PORT} (LAN: ${lanStr})`);

      // Set background poll interval
      setInterval(() => {
        runPoll();
      }, (loadConfig().pollSeconds || 60) * 1000);

      // Run initial poll after 5s
      // ponytail: 5s delay lets camofox fully ready in Docker; lower if running standalone
      setTimeout(runPoll, 5000);
    });
  }).catch(err => {
    console.error("Failed to initialize database:", err);
  });
}

export { server, checkRateLimit, isValidChannelId };
