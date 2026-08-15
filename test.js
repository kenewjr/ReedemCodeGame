import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// Set isolated DB path for testing
process.env.TEST_DB_PATH = `data/test_redeem_${Date.now()}.sqlite`;

import { 
  initDb, 
  saveCodeCandidate, 
  getCodeRecords, 
  getCodeCounts, 
  runAutoExpiryCleanup,
  deleteExpiredCodes,
  upsertSourceHealth,
  getAllSourceHealth,
  deleteSourceHealth,
  addLog,
  getSystemLogs
} from "./src/db.js";

import { 
  trimDuplicateCode, 
  detectCodeType, 
  parseHoyoCodesJson, 
  parseFandomWikitext, 
  parseHtmlCheerio,
  isValidCode,
  cleanRewards
} from "./src/parser.js";

import { renderMessage, renderDiscordEmbed, formatTags, formatRewards } from "./src/template.js";
import { sendDiscordWebhook, publishDiscordMessage } from "./src/discord.js";
import { checkRateLimit, isValidChannelId } from "./server.js";

test("Database Layer - Async Init & 3-Tier Lifecycle", async () => {
  await initDb();
  const codeId = `HSRTEST_${Date.now()}`;

  // 1. Insert initial candidate -> unconfirmed
  const cand1 = {
    game: "hsr",
    code: codeId,
    status: "unconfirmed",
    codeType: "livestream",
    server: "All",
    rewards: "Stellar Jade*100",
    notes: "Initial test discovery",
    sources: ["source-1"]
  };

  const { record: rec1, eventType: evt1 } = await saveCodeCandidate(cand1);
  assert.equal(rec1.status, "unconfirmed");
  assert.equal(rec1.code_type, "livestream");
  assert.equal(rec1.verified_count, 1);
  assert.equal(evt1, "new_code");

  // 2. Second source confirms -> upgrades to active
  const cand2 = {
    game: "hsr",
    code: codeId,
    status: "active",
    rewards: "Stellar Jade*100; Credit*50000",
    sources: ["source-2"]
  };

  const { record: rec2 } = await saveCodeCandidate(cand2);
  assert.equal(rec2.status, "active");
  assert.equal(rec2.verified_count, 2);
  assert.equal(rec2.rewards, "Stellar Jade*100, Credit*50000"); // Smart enrichment preserved & normalized
});

test("Database Layer - Pagination & Counts Query", async () => {
  await initDb();
  const prefix = `PAG_${Date.now()}`;

  // Insert 3 codes across games
  await saveCodeCandidate({ game: "genshin", code: `${prefix}_1`, status: "active", codeType: "redeem" });
  await saveCodeCandidate({ game: "genshin", code: `${prefix}_2`, status: "expired", codeType: "patch" });
  await saveCodeCandidate({ game: "wuwa", code: `${prefix}_3`, status: "active", codeType: "anniversary" });

  const paginated = await getCodeRecords({ game: "genshin", limit: 1, offset: 0 });
  assert.equal(paginated.rows.length, 1);
  assert.ok(paginated.total >= 2);

  const counts = await getCodeCounts();
  assert.ok(counts.total >= 3);
  assert.ok(counts.byGame.genshin.total >= 2);
  assert.ok(counts.byGame.wuwa.total >= 1);
});

test("Database Layer - Auto Expiry Cleanup Pipeline", async () => {
  await initDb();

  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  const expiredCode = `EXP_${Date.now()}`;

  await saveCodeCandidate({
    game: "endfield",
    code: expiredCode,
    status: "active",
    expires: yesterday
  });

  const cleanup = await runAutoExpiryCleanup();
  assert.ok(cleanup.expiredByDate >= 0);

  const res = await getCodeRecords({ game: "endfield" });
  const found = res.rows.find(r => r.code === expiredCode);
  assert.equal(found.status, "expired");
  assert.ok(found.notes.includes("Auto-expired"));
});

test("Parser - Duplicate Trimmer & CodeType Detection", () => {
  assert.equal(trimDuplicateCode("NTEFUNGAMENTEFUNGAME"), "NTEFUNGAME");
  assert.equal(trimDuplicateCode("STARRAILGIFT"), "STARRAILGIFT");

  assert.equal(detectCodeType("CODE1", "Special Anniversary Stream"), "anniversary");
  assert.equal(detectCodeType("CODE2", "Version 2.4 Livestream Code"), "livestream");
  assert.equal(detectCodeType("CODE3", "Patch 1.2 Notes Code"), "patch");
  assert.equal(detectCodeType("CODE4", "Generic code"), "redeem");
});

test("Parser - HoyoCodes JSON API Extractor", () => {
  const sampleJson = {
    codes: [
      { id: 1, code: "ONTOSNEZHNAYA", status: "OK", game: "genshin", rewards: "Primogem*100" },
      { id: 2, code: "CODEA;CODEB", status: "OK", game: "genshin", rewards: "Mora*50000" }
    ]
  };

  const parsed = parseHoyoCodesJson("genshin", sampleJson, "https://hoyo-codes.seria.moe/codes?game=genshin");
  assert.equal(parsed.length, 3);
  assert.equal(parsed[0].code, "ONTOSNEZHNAYA");
  assert.equal(parsed[1].code, "CODEA");
  assert.equal(parsed[2].code, "CODEB");
});

test("Parser - Fandom Wikitext (Genshin Expired section & WuWa Wikitable)", () => {
  const genshinWikitext = `
==Active Codes==
{{Code Row<!--
    -->|ActiveGenshin123|G<!--
    -->|Primogem*100<!--
    -->|2026-07-31|2026-08-03<!--
-->}}

==Expired Codes==
{{Code Row<!--
    -->|OldGenshin456|G<!--
    -->|Primogem*50<!--
    -->|2025-01-01|2025-01-02<!--
-->}}
  `;

  const parsedGenshin = parseFandomWikitext("genshin", genshinWikitext, "https://genshin-impact.fandom.com");
  assert.equal(parsedGenshin.length, 2);
  assert.equal(parsedGenshin[0].code, "ACTIVEGENSHIN123");
  assert.equal(parsedGenshin[0].status, "active");
  assert.equal(parsedGenshin[1].code, "OLDGENSHIN456");
  assert.equal(parsedGenshin[1].status, "expired");

  const wuwaWikitext = `
===Active===
{| class="wikitable"
|-
|<code>WUTHERINGGIFT</code>||All||{{Card List|Astrite*50|delim=;}}
| Valid until: Unknown
|}
  `;
  const parsedWuwa = parseFandomWikitext("wuwa", wuwaWikitext, "https://wutheringwaves.fandom.com");
  assert.equal(parsedWuwa.length, 1);
  assert.equal(parsedWuwa[0].code, "WUTHERINGGIFT");
  assert.equal(parsedWuwa[0].rewards, "Astrite*50");
});

test("Parser - Cheerio Selector HTML Extractor", () => {
  const sampleHtml = `
    <html>
      <body>
        <h2>Active Redeem Codes</h2>
        <table>
          <tr><td><code>ENDFIELD2026</code></td><td>100 Orundum</td></tr>
        </table>
      </body>
    </html>
  `;

  const parsed = parseHtmlCheerio("endfield", sampleHtml, "https://game8.co/endfield");
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].code, "ENDFIELD2026");
  assert.equal(parsed[0].status, "active");
});

test("Discord Embed Generator & Missing Web Redemption Handling", () => {
  assert.equal(formatTags([], []), "");
  assert.equal(formatTags(["123"], ["456"]), "<@&123> <@456>");

  // 1. Genshin has web redemption -> includes Redeem Link field
  const embedGenshin = renderDiscordEmbed({ game: "genshin", code: "GENSHIN123", rewards: "Primogem*100" });
  assert.ok(embedGenshin.embeds[0].fields.some(f => f.name === "Redeem Link" && f.value.includes("https://genshin.hoyoverse.com/en/gift?code=GENSHIN123")));

  // 2. WuWa has NO web redemption -> Redeem Link field omitted
  const embedWuwa = renderDiscordEmbed({ game: "wuwa", code: "WUWA456", rewards: "Astrite*50" });
  assert.ok(!embedWuwa.embeds[0].fields.some(f => f.name === "Redeem Link"));

  // 3. Endfield has NO web redemption -> Redeem Link field omitted
  const embedEndfield = renderDiscordEmbed({ game: "endfield", code: "ENDFIELD789", rewards: "Orundum*500" });
  assert.ok(!embedEndfield.embeds[0].fields.some(f => f.name === "Redeem Link"));
});

test("Circuit Breaker - Backoff State on 5 Consecutive Failures", async () => {
  await initDb();
  const testSource = {
    id: "failing-source-test-" + Date.now(),
    game: "hsr",
    url: "https://example.com/failing",
    type: "html-cheerio",
    enabled: true,
    lastStatus: "error",
    lastHttpStatus: 404,
    lastError: "HTTP 404 Not Found",
    lastCodesFound: 0
  };

  // Fail 5 times
  for (let i = 0; i < 5; i++) {
    await upsertSourceHealth(testSource);
  }

  const allHealth = await getAllSourceHealth();
  const target = allHealth.find(h => h.id === testSource.id);
  assert.ok(target);
  assert.equal(target.consecutive_failures, 5);
  assert.equal(target.circuit_breaker_active, 1);

  await deleteSourceHealth(testSource.id);
});

test("Discord Webhook - sendDiscordWebhook Payload Handling & Safety", async () => {
  // 1. Invalid Webhook URL handling
  const invalidRes = await sendDiscordWebhook("", "Hello");
  assert.equal(invalidRes.ok, false);
  assert.ok(invalidRes.error.includes("Invalid or empty Webhook URL"));

  // 2. Mock fetch test for string and embed object payload
  const originalFetch = globalThis.fetch;
  let lastBody = null;

  globalThis.fetch = async (url, opts) => {
    lastBody = JSON.parse(opts.body);
    return {
      ok: true,
      status: 200,
      json: async () => ({ id: "msg_12345" })
    };
  };

  try {
    // String payload test
    const stringRes = await sendDiscordWebhook("https://discord.com/api/webhooks/test", "Test Text Content", { username: "Bot" });
    assert.equal(stringRes.ok, true);
    assert.equal(stringRes.messageId, "msg_12345");
    assert.equal(lastBody.content, "Test Text Content");
    assert.equal(lastBody.username, "Bot");

    // Object embed payload test
    const embedObj = renderDiscordEmbed({ game: "hsr", code: "TESTHSR100", rewards: "Stellar Jade*100" });
    const embedRes = await sendDiscordWebhook("https://discord.com/api/webhooks/test", embedObj);
    assert.equal(embedRes.ok, true);
    assert.ok(Array.isArray(lastBody.embeds));
    assert.ok(lastBody.embeds[0].title.includes("Honkai: Star Rail"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Template - Rewards Whitespace Gap Normalization", () => {
  const rawGapString = "・ Fons \n\n\n\n\n x10,000 \n\n ・ Beetle Coin \n\n\n x5,000";
  const formatted = formatRewards(rawGapString);
  assert.equal(formatted, "Fons x10,000, Beetle Coin x5,000");
});

test("Discord Crosspost - publishDiscordMessage Authorization Header & Token Normalization", async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl = "";
  let capturedHeaders = null;

  globalThis.fetch = async (url, opts) => {
    capturedUrl = url;
    capturedHeaders = opts.headers;
    return {
      ok: true,
      status: 200,
      json: async () => ({ id: "msg_crossposted" }),
      text: async () => ""
    };
  };

  try {
    // Test 1: Token passed WITH 'Bot ' prefix
    const resWithPrefix = await publishDiscordMessage("123456789012345678", "msg_100", "Bot token_abc123");
    assert.equal(resWithPrefix.ok, true);
    assert.equal(capturedUrl, "https://discord.com/api/v10/channels/123456789012345678/messages/msg_100/crosspost");
    assert.equal(capturedHeaders["Authorization"], "Bot token_abc123"); // Ensures NO double 'Bot Bot'

    // Test 2: Token passed WITHOUT 'Bot ' prefix
    const resWithoutPrefix = await publishDiscordMessage("123456789012345678", "msg_100", "token_abc123");
    assert.equal(resWithoutPrefix.ok, true);
    assert.equal(capturedHeaders["Authorization"], "Bot token_abc123");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Config Validation - Channel ID Format Enforcement", async () => {
  // Helper validation test
  assert.equal(isValidChannelId("discord announc"), false);
  assert.equal(isValidChannelId("abc1234567890"), false);
  assert.equal(isValidChannelId("12345"), false); // too short
  assert.equal(isValidChannelId("123456789012345678"), true); // 18-digit snowflake
  assert.equal(isValidChannelId("12345678901234567890"), true); // 20-digit snowflake
  assert.equal(isValidChannelId(""), true); // empty is permitted when auto-publish not configured
});

test("Auto-Publish Pipeline - Triggers Crosspost Only When Fully Configured", async () => {
  // If botToken, channelId, or messageId is missing, publishDiscordMessage should skip gracefully
  const resNoToken = await publishDiscordMessage("123456789012345678", "msg_100", "");
  assert.equal(resNoToken.ok, false);
  assert.equal(resNoToken.skipped, true);

  const resNoChannel = await publishDiscordMessage("", "msg_100", "token_xyz");
  assert.equal(resNoChannel.ok, false);
  assert.equal(resNoChannel.skipped, true);

  const resNoMessage = await publishDiscordMessage("123456789012345678", "", "token_xyz");
  assert.equal(resNoMessage.ok, false);
  assert.equal(resNoMessage.skipped, true);

  // Condition evaluation check: autoPublish && channelId && discordBotToken
  const evaluateAutoPublishCondition = (hook, configToken) => {
    return !!(hook.autoPublish && configToken && hook.channelId);
  };

  assert.equal(evaluateAutoPublishCondition({ autoPublish: true, channelId: "123456789012345678" }, "token"), true);
  assert.equal(evaluateAutoPublishCondition({ autoPublish: false, channelId: "123456789012345678" }, "token"), false);
  assert.equal(evaluateAutoPublishCondition({ autoPublish: true, channelId: "" }, "token"), false);
  assert.equal(evaluateAutoPublishCondition({ autoPublish: true, channelId: "123456789012345678" }, ""), false);
});

test("System Logging - AUTO_PUBLISH_FAILED Audit Logging on Crosspost Error", async () => {
  await initDb();
  const errorMsg = "Crosspost failed 404: Unknown Channel";

  // Simulate crosspost failure logging
  await addLog("WARN", "AUTO_PUBLISH_FAILED", `Failed to crosspost message msg_err: ${errorMsg}`);

  const logs = await getSystemLogs(20, "WARN");
  const failedLog = logs.find(l => l.category === "AUTO_PUBLISH_FAILED");
  assert.ok(failedLog);
  assert.ok(failedLog.message.includes(errorMsg));
});

test("HTTP Server - Compression & Cache-Control Headers", async () => {
  const { server } = await import("./server.js");
  const port = 3999;
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));

  try {
    // 1. Test Brotli compression on static file (> 256B)
    const resBr = await fetch(`http://127.0.0.1:${port}/style.css`, {
      headers: { "Accept-Encoding": "br" }
    });
    assert.equal(resBr.status, 200);
    assert.equal(resBr.headers.get("content-encoding"), "br");
    assert.equal(resBr.headers.get("cache-control"), "no-cache, must-revalidate");

    // 2. Test export API endpoint
    const resExp = await fetch(`http://127.0.0.1:${port}/api/public/codes/export?status=active`);
    assert.equal(resExp.status, 200);
    assert.equal(resExp.headers.get("content-type"), "text/plain; charset=utf-8");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("Webhook Game Scoping Filter - All Games vs Specific Games Matching", () => {
  const isGameAllowed = (hook, game) => {
    const hookGames = Array.isArray(hook.games) ? hook.games : [];
    return hook.allGames !== false || hookGames.length === 0 || hookGames.includes(game);
  };

  // Case 1: allGames = true -> allowed for all games
  assert.equal(isGameAllowed({ allGames: true, games: ["hsr"] }, "genshin"), true);

  // Case 2: allGames = false & games = ["hsr", "wuwa"] -> allowed only for hsr and wuwa
  assert.equal(isGameAllowed({ allGames: false, games: ["hsr", "wuwa"] }, "hsr"), true);
  assert.equal(isGameAllowed({ allGames: false, games: ["hsr", "wuwa"] }, "wuwa"), true);
  assert.equal(isGameAllowed({ allGames: false, games: ["hsr", "wuwa"] }, "genshin"), false);

  // Case 3: allGames = false & empty games array -> default fallback allowed
  assert.equal(isGameAllowed({ allGames: false, games: [] }, "nte"), true);
});

test("Database Candidate Safety - Handles undefined/null optional fields without throwing", async () => {
  await initDb();
  const nullCode = `NULLSAFE_${Date.now()}`;

  const cand = {
    game: "nte",
    code: nullCode,
    status: null,
    codeType: undefined,
    server: null,
    rewards: null,
    expires: undefined,
    notes: null,
    sources: null
  };

  const { record, eventType } = await saveCodeCandidate(cand);
  assert.equal(record.code, nullCode);
  assert.equal(record.status, "unconfirmed");
  assert.equal(record.game, "nte");
  assert.equal(eventType, "new_code");
});

test("Database Performance - SQLite Indexes & Search Query Filtering", async () => {
  await initDb();
  const searchCode = `SEARCHTEST_${Date.now()}`;

  await saveCodeCandidate({
    game: "genshin",
    code: searchCode,
    status: "active",
    rewards: "Primogem*300"
  });

  const searchRes = await getCodeRecords({ game: "genshin", search: "Primogem*300" });
  assert.ok(searchRes.rows.some(r => r.code === searchCode));
});

test("Dynamic Poll Scheduler - Timer Reset Support", async () => {
  const { resetPollScheduler } = await import("./server.js");
  assert.equal(typeof resetPollScheduler, "function");
  // Ensure function executes without throwing
  resetPollScheduler(120);
  resetPollScheduler(60);
});

test("Batch Tagging - Tags Attached ONLY on Last Code of Webhook Batch", () => {
  const mockWebhook = {
    rolesToTag: ["111222333"],
    usersToTag: ["444555666"]
  };
  const batchRecords = [
    { game: "hsr", code: "CODE_1" },
    { game: "hsr", code: "CODE_2" },
    { game: "genshin", code: "CODE_3" }
  ];

  const totalItems = batchRecords.length;
  const outputs = batchRecords.map((rec, i) => {
    const isLast = (i === totalItems - 1);
    const tags = isLast ? formatTags(mockWebhook.rolesToTag, mockWebhook.usersToTag) : "";
    return renderDiscordEmbed(rec, tags);
  });

  // Code 1 & 2 (index 0 & 1): content (tags) omitted
  assert.equal(outputs[0].content, undefined);
  assert.equal(outputs[1].content, undefined);

  // Code 3 (index 2 - last code in batch): content contains role/user tags
  assert.equal(outputs[2].content, "<@&111222333> <@444555666>");
});

test("Manual Code Expiration API - POST /api/code-status & updateCodeStatus", async () => {
  await initDb();
  const { updateCodeStatus } = await import("./src/db.js");
  const testCode = `EXPIRETEST_${Date.now()}`;

  await saveCodeCandidate({
    game: "wuwa",
    code: testCode,
    status: "active"
  });

  const updated = await updateCodeStatus("wuwa", testCode, "expired");
  assert.equal(updated.status, "expired");

  const records = await getCodeRecords({ game: "wuwa", sort: "code", order: "asc" });
  assert.ok(Array.isArray(records.rows));
});

test("Delete Expired Codes - deleteExpiredCodes DB function", async () => {
  await initDb();
  const expCode1 = `DEL_EXP1_${Date.now()}`;
  const expCode2 = `DEL_EXP2_${Date.now()}`;

  await saveCodeCandidate({ game: "hsr", code: expCode1, status: "expired" });
  await saveCodeCandidate({ game: "genshin", code: expCode2, status: "expired" });

  const deletedHsr = await deleteExpiredCodes("hsr");
  assert.ok(deletedHsr >= 1);

  const resHsr = await getCodeRecords({ game: "hsr", status: "expired" });
  assert.ok(!resHsr.rows.some(r => r.code === expCode1));

  const deletedAll = await deleteExpiredCodes("all");
  assert.ok(deletedAll >= 0);
});

test("Expiry Date Sanitization - Corrupted expires_at strings cleared or normalized at write-time", async () => {
  await initDb();
  
  // Case A: Dirty date string with trailing braces "2026-07-31}}" gets normalized to "2026-07-31"
  const { record: recNormalized } = await saveCodeCandidate({
    game: "nte",
    code: `CORRUPT_EXP1_${Date.now()}`,
    status: "active",
    expires: "2026-07-31}}"
  });
  assert.equal(recNormalized.expires_at, "2026-07-31");

  // Case B: Completely unparseable corrupt string "invalid-date-braces-}}" gets reset to ""
  const { record: recCleared } = await saveCodeCandidate({
    game: "nte",
    code: `CORRUPT_EXP2_${Date.now()}`,
    status: "active",
    expires: "invalid-date-braces-}}"
  });
  assert.equal(recCleared.expires_at, "");

  // Auto-expiry cleanup should not get stuck or crash on empty expires_at
  const cleanup = await runAutoExpiryCleanup();
  assert.ok(typeof cleanup.expiredByDate === "number");
});

test("Parser & Template - Anti-Code Pollution & Quantity Multiplier Rejection", () => {
  // 1. Quantity multipliers & UI artifacts rejected as codes
  assert.equal(isValidCode("X100"), false);
  assert.equal(isValidCode("X120"), false);
  assert.equal(isValidCode("X4000"), false);
  assert.equal(isValidCode("X10000ADVENTURER"), false);
  assert.equal(isValidCode("X30000HERO"), false);
  assert.equal(isValidCode("X100MORA"), false);
  assert.equal(isValidCode("000NL"), false);
  assert.equal(isValidCode("13TH"), false);
  assert.equal(isValidCode("VG247"), false);
  assert.equal(isValidCode("COPIED"), false);
  assert.equal(isValidCode("REDEEM"), false);

  // 2. Real codes accepted
  assert.equal(isValidCode("ZA9674JSAUPF"), true);
  assert.equal(isValidCode("GENSHIN51YT"), true);
  assert.equal(isValidCode("NTE0429"), true);
  assert.equal(isValidCode("STARRAILFATE2026"), true);
  assert.equal(isValidCode("WUTHERINGGIFT"), true);

  // 3. cleanRewards strips code itself and UI text
  const dirtyRewards = "GENSHIN51YT, Copied ▶︎ Redeem Code Link, Brilliant Chrysanthemum x5, Mora x30000, Date Added: 08/13";
  const cleaned = cleanRewards(dirtyRewards, "GENSHIN51YT");
  assert.equal(cleaned, "Brilliant Chrysanthemum x5, Mora x30000");

  // 4. formatRewards strips code itself and handles asterisks
  const formatted = formatRewards("ZA9674JSAUPF, Stellar Jade*100, Credit*50000", "ZA9674JSAUPF");
  assert.equal(formatted, "Stellar Jade ×100, Credit ×50000");
  assert.ok(!formatted.includes("ZA9674JSAUPF"));

  // 5. renderDiscordEmbed excludes code from Rewards field
  const embed = renderDiscordEmbed({
    game: "genshin",
    code: "GENSHIN51YT",
    rewards: "GENSHIN51YT, Brilliant Chrysanthemum x5, Mora x30000"
  });
  const rewardsField = embed.embeds[0].fields.find(f => f.name === "Rewards");
  assert.equal(rewardsField.value, "Brilliant Chrysanthemum x5, Mora x30000");
  assert.ok(!rewardsField.value.includes("GENSHIN51YT"));
});

test("Parser - Cheerio HTML Table with Clipboard Input & Multipliers", () => {
  const sampleTableHtml = `
    <html>
      <body>
        <h2>Active Codes</h2>
        <table>
          <tr><th>Code</th><th>Rewards</th></tr>
          <tr>
            <td>
              <div class="a-clipboard__container">
                <input type="text" class="a-clipboard__textInput" value="ZA9674JSAUPF" readonly="">
                <button>Copied</button>
              </div>
              <a href="https://example.com/gift?code=ZA9674JSAUPF">▶︎ Redeem Code Link</a>
            </td>
            <td>
              <div>Stellar Jade x100</div>
              <div>Credit x50,000</div>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `;

  const parsed = parseHtmlCheerio("hsr", sampleTableHtml, "https://game8.co/hsr");
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].code, "ZA9674JSAUPF");
  assert.ok(!parsed[0].rewards.includes("ZA9674JSAUPF"));
  assert.ok(!parsed[0].rewards.includes("Copied"));
  assert.ok(parsed[0].rewards.includes("Stellar Jade x100"));
});

// Auto-cleanup test database and remove all dummy test codes
test.after(async () => {
  try {
    const { getDbClient } = await import("./src/db.js");
    const db = getDbClient();
    await db.execute("DELETE FROM codes WHERE code LIKE '%TEST%' OR code LIKE 'SEARCHTEST%' OR code LIKE 'CORRUPT_%' OR code LIKE 'TIMESTAMPTEST%' OR code LIKE 'HSRTEST%' OR code LIKE 'BATCHTEST%' OR code LIKE 'AUTOEXP%' OR code LIKE 'EXPIRE_DELETE_%' OR code LIKE 'NULLSAFE_%'");
  } catch {}
  setTimeout(() => process.exit(0), 500);
});

process.on("exit", () => {
  try {
    if (process.env.TEST_DB_PATH && fs.existsSync(process.env.TEST_DB_PATH)) {
      fs.unlinkSync(process.env.TEST_DB_PATH);
    }
  } catch {}
});







