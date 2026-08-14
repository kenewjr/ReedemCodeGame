import * as cheerio from "cheerio";

// Helper: Trim concatenated duplicate code (e.g. "NTEFUNGAMENTEFUNGAME" -> "NTEFUNGAME")
export function trimDuplicateCode(str) {
  if (!str || typeof str !== "string") return str;
  const s = str.trim();
  const len = s.length;
  if (len >= 10 && len % 2 === 0) {
    const half = len / 2;
    if (s.slice(0, half) === s.slice(half)) {
      return s.slice(0, half);
    }
  }
  return s;
}

// Helper: Clean quotes, wikitext syntax, braces and punctuation from raw code strings
export function cleanCodeString(str) {
  if (!str || typeof str !== "string") return "";
  let s = str.trim();
  s = s.replace(/['"`{}<>\[\]]/g, "").trim();
  s = s.replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, "").trim();
  if (/^code\s*row/i.test(s) || /header|footer/i.test(s) || /^notacode/i.test(s)) {
    return "";
  }
  return trimDuplicateCode(s.toUpperCase());
}

// Helper: Parse and normalize raw expiration date strings into YYYY-MM-DD format
export function parseExpiryDate(str) {
  if (!str || typeof str !== "string") return null;
  const clean = str.trim().replace(/\(.*?\)|\b(UTC|PT|ET|GMT|JST)\b/gi, "").trim();
  if (!clean || /indef|valid|version|patch|exp/i.test(clean)) return null;

  // Pattern 1: YYYY-MM-DD or YYYY/MM/DD
  const isoMatch = clean.match(/\b(\d{4})[-/](\d{1,2})[-/](\d{1,2})\b/);
  if (isoMatch) {
    const [_, y, m, d] = isoMatch;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  // Pattern 2: DD-MM-YYYY or DD/MM/YYYY
  const dmyMatch = clean.match(/\b(\d{1,2})[-/](\d{1,2})[-/](\d{4})\b/);
  if (dmyMatch) {
    const [_, d, m, y] = dmyMatch;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  // Pattern 3: Natural dates (e.g., "May 15, 2024", "15 May 2024", "2024 May 15")
  const parsedMs = Date.parse(clean);
  if (!isNaN(parsedMs)) {
    const dateObj = new Date(parsedMs);
    const yr = dateObj.getFullYear();
    if (yr >= 2020 && yr <= 2100) {
      const mStr = String(dateObj.getMonth() + 1).padStart(2, "0");
      const dStr = String(dateObj.getDate()).padStart(2, "0");
      return `${yr}-${mStr}-${dStr}`;
    }
  }
  return null;
}

// Helper: Auto-detect codeType from context text (heading/paragraph)
export function detectCodeType(code, contextText = "") {
  const text = (contextText || "").toLowerCase();
  if (text.includes("anniversary") || text.includes("anniv")) return "anniversary";
  if (text.includes("livestream") || text.includes("special program") || text.includes("stream")) return "livestream";
  if (text.includes("patch") || text.match(/version\s*v?\d+\.\d+/i) || text.match(/v\d+\.\d+\s*code/i)) return "patch";
  return "redeem";
}

// 1. JSON Parser for hoyo-codes.seria.moe
export function parseHoyoCodesJson(game, json, sourceUrl) {
  const results = [];
  if (!json || !Array.isArray(json.codes)) return results;

  for (const item of json.codes) {
    let rawCode = (item.code || "").trim();
    if (!rawCode) continue;

    const rawCodes = rawCode.split(/[;,/\n\r]+/).map(c => cleanCodeString(c)).filter(Boolean);

    for (const code of rawCodes) {
      if (code.length < 4 || code.length > 30) continue;

      results.push({
        game,
        code,
        status: item.status === "OK" ? "active" : "unconfirmed",
        codeType: detectCodeType(code, item.rewards || ""),
        server: "All",
        rewards: (item.rewards || "").replace(/\s+/g, " ").trim(),
        expires: "",
        discovered: new Date().toISOString().split("T")[0],
        notes: "Sourced from HoyoCodes API",
        sources: [sourceUrl]
      });
    }
  }
  return results;
}

// Helper: Depth-aware wikitext pipe splitter for nested {{...}} templates
export function splitWikitextRow(str) {
  const parts = [];
  let current = "";
  let depth = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    const next = str[i + 1];
    if (char === "{" && next === "{") {
      depth++;
      current += "{{";
      i++;
    } else if (char === "}" && next === "}") {
      depth = Math.max(0, depth - 1);
      current += "}}";
      i++;
    } else if (char === "|" && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  parts.push(current);
  return parts;
}

// 2. Wikitext Parser for Fandom Wiki APIs
export function parseFandomWikitext(game, wikitext, sourceUrl) {
  const results = [];
  if (!wikitext) return results;

  if (game === "hsr") {
    let currentStatus = "active";
    const lines = wikitext.split("\n");

    for (const line of lines) {
      const trimmedLine = line.trim();
      if (trimmedLine.includes("<!--active-->")) currentStatus = "active";
      if (trimmedLine.includes("<!--expired-->")) currentStatus = "expired";

      if (/^\s*\{\{Redemption Code Row/i.test(trimmedLine) && !/\{\{Redemption Code Row\/(header|footer)/i.test(trimmedLine)) {
        const cleanContent = trimmedLine
          .replace(/^\s*\{\{Redemption Code Row\|/i, "")
          .replace(/\}\}\s*$/, "")
          .trim();

        const parts = splitWikitextRow(cleanContent);
        let rawCode = cleanCodeString(parts[0]);
        if (rawCode && rawCode !== "CODE" && rawCode.length >= 4) {
          const code = rawCode;
          let server = "All";
          let rewards = "";
          let expires = "";

          for (let i = 1; i < parts.length; i++) {
            const p = parts[i].trim();
            if (p.startsWith("ref=")) continue;
            if (["A", "G", "SEA", "CN", "NA", "EU", "SAR"].includes(p)) {
              server = p;
            } else if (p.includes("Stellar Jade") || p.includes("Credit") || p.includes("Traveler's Guide") || p.includes("Item List")) {
              rewards = p
                .replace(/\{\{Item List\|([^}]+)\}\}/g, "$1")
                .replace(/\|mode=br/g, "")
                .replace(/;/g, ", ")
                .replace(/\|/g, ", ")
                .replace(/\}\}\s*$/, "")
                .trim();
            } else if (p.match(/^\d{4}-\d{2}-\d{2}/) || p === "indef" || p === "exp") {
              expires = p.replace(/\}\}\s*$/, "").trim();
            }
          }

          // Pre-validation check: skip if raw wikitext braces remain
          if (rewards.includes("{{") || rewards.includes("}}") || expires.includes("{{") || expires.includes("}}")) {
            continue;
          }

          results.push({
            game,
            code,
            status: currentStatus,
            codeType: detectCodeType(code, rewards + " " + line),
            server,
            rewards,
            expires,
            discovered: "",
            notes: "Fandom HSR Wiki",
            sources: [sourceUrl]
          });
        }
      }
    }
  } else if (game === "genshin") {
    const cleanWikitext = wikitext.replace(/<!--[\s\S]*?-->/g, "");
    let currentStatus = "active";
    const lines = cleanWikitext.split("\n");

    for (const line of lines) {
      const trimmedLine = line.trim();
      if (trimmedLine.includes("==Active Codes==") || trimmedLine.includes("===Active===") || trimmedLine.includes("==Active==")) {
        currentStatus = "active";
      }
      if (trimmedLine.includes("==Expired Codes==") || trimmedLine.includes("===Expired===") || trimmedLine.includes("==Expired==")) {
        currentStatus = "expired";
      }

      if (/^\s*\{\{Code Row\s*\|/i.test(trimmedLine) && !/\{\{Code Row\/(header|footer)/i.test(trimmedLine)) {
        const cleanContent = trimmedLine
          .replace(/^\s*\{\{Code Row\s*\|/i, "")
          .replace(/\}\}\s*$/, "")
          .trim();

        const parts = splitWikitextRow(cleanContent);
        const rawCodeStr = parts[0]?.trim();
        if (rawCodeStr && !rawCodeStr.includes("WA8MJCETGXLR")) {
          const rawCodes = rawCodeStr.split(/[;,/\n\r]+/).map(c => cleanCodeString(c)).filter(Boolean);
          for (const code of rawCodes) {
            if (code.length < 4 || code.length > 30 || code === "CODE") continue;

            let server = parts[1]?.trim() || "G";
            let rewards = (parts[2] || "").replace(/\{\{Item List\|([^}]+)\}\}/g, "$1").replace(/\|/g, ", ").trim();
            
            let val3 = (parts[3] || "").trim();
            let val4 = (parts[4] || "").replace(/\}\}\s*$/, "").trim();

            let discovered = "";
            let expires = "";

            if (val3.match(/PT|UTC|\d{1,2}:\d{2}|valid|version|patch|exp|indef/i) || !val4) {
              expires = val3;
              discovered = val4;
            } else {
              discovered = val3;
              expires = val4;
            }

            if (rewards.includes("{{") || rewards.includes("}}") || expires.includes("{{") || expires.includes("}}")) {
              continue;
            }

            results.push({
              game,
              code,
              status: currentStatus,
              codeType: detectCodeType(code, rewards),
              server,
              rewards,
              discovered,
              expires,
              notes: "Fandom Genshin Wiki",
              sources: [sourceUrl]
            });
          }
        }
      }
    }
  } else if (game === "wuwa") {
    let currentStatus = "active";
    const lines = wikitext.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.includes("===Active===") || line.includes("==Active==")) currentStatus = "active";
      if (line.includes("===Expired===") || line.includes("==Expired==")) currentStatus = "expired";

      const codeMatch = line.match(/\|<code>([^<]+)<\/code>/i);
      if (codeMatch) {
        const code = cleanCodeString(codeMatch[1]);
        if (code.length < 4 || code.length > 30) continue;
        let rewards = "";
        let expires = "";

        const cardMatch = line.match(/\{\{Card List\|([^|]+)/i);
        if (cardMatch) rewards = cardMatch[1].replace(/;/g, ", ");

        if (i + 1 < lines.length && lines[i + 1].includes("Valid until:")) {
          const expMatch = lines[i + 1].match(/Valid until:\s*([^<'\n]+)/i);
          if (expMatch) expires = expMatch[1].replace(/\}\}\s*$/, "").trim();
        }

        results.push({
          game,
          code,
          status: currentStatus,
          codeType: detectCodeType(code, rewards),
          server: "All",
          rewards,
          expires,
          discovered: "",
          notes: "Fandom WuWa Wiki",
          sources: [sourceUrl]
        });
      }
    }
  }

  return results;
}

// 3. Cheerio Selector HTML Parser per source
export function parseHtmlCheerio(game, html, sourceUrl) {
  const results = [];
  if (!html) return results;

  const $ = cheerio.load(html);

  const nonCodes = new Set([
    "HONKAI", "GENSHIN", "STARRAIL", "WUTHERING", "WAVES", "IMPACT", "REDEMPTION",
    "EXPIRED", "ACTIVE", "DISCORD", "TWITTER", "YOUTUBE", "HOYOVERSE", "KUROGAMES",
    "PRIMOGEMS", "ASTRITE", "STELLAR", "CREDITS", "JANUARY", "FEBRUARY", "MARCH",
    "APRIL", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER", "GUIDES",
    "POCKET", "TACTICS", "GAMESN", "GAME8", "DESTRUCTOID", "ARTICLE", "PRIVACY",
    "COOKIES", "TERMS", "RIGHTS", "RESERVED", "COPYRIGHT", "ARKNIGHTS", "ENDFIELD",
    "NEVERNESS", "EVERNESS", "SEARCH", "MENU", "LOGIN", "SIGNUP", "REGISTER", "SUBMIT"
  ]);

  $("code, strong, b, td").each((_, el) => {
    const text = $(el).text().trim();
    if (!text) return;

    // Split text by delimiters to handle multiple codes per cell (e.g. "CODE1; CODE2")
    const segments = text.split(/[\s;,/\n\r\t]+/).filter(Boolean);
    for (const seg of segments) {
      const match = seg.match(/\b([A-Z0-9]{4,30})\b/i);
      if (!match) continue;

      const rawCandidate = cleanCodeString(match[1]);
      if (!rawCandidate || rawCandidate.length < 4 || nonCodes.has(rawCandidate)) continue;
      if (!/[0-9]/.test(rawCandidate) || !/[A-Z]/.test(rawCandidate)) continue;

      const code = rawCandidate;

      // Walk up parent container & check preceding headings for section context
      const container = $(el).closest("table, ul, ol, section, div, article");
      const containerText = container.text() || "";
      
      // Check preceding headings (h1..h6) before container
      const prevHeadings = container.prevAll("h1, h2, h3, h4, h5, h6").text() || $(el).parents().prevAll("h1, h2, h3, h4, h5, h6").text() || "";
      const contextText = (prevHeadings + " " + containerText).slice(0, 800);

      let status = "unconfirmed";
      const isExpired = /expired|old codes|out of date|no longer work/i.test(contextText);
      const isActive = /active|working|live codes|latest codes/i.test(contextText);

      if (isExpired && !isActive) {
        status = "expired";
      } else if (isActive) {
        status = "active";
      }

      const codeType = detectCodeType(code, contextText);

      // Extract rewards near element if inside <tr> or <li>
      let rewards = "";
      const tr = $(el).closest("tr");
      if (tr.length) {
        const tds = tr.find("td").map((_, td) => $(td).text().replace(/\s+/g, " ").trim()).get();
        if (tds.length >= 2) {
          rewards = tds.filter(t => t !== code && !t.includes(code)).join(", ").slice(0, 150).replace(/\s+/g, " ").trim();
        }
      }

      results.push({
        game,
        code,
        status,
        codeType,
        server: "All",
        rewards,
        expires: "",
        discovered: new Date().toISOString().split("T")[0],
        notes: `Extracted from ${new URL(sourceUrl).hostname}`,
        sources: [sourceUrl]
      });
    }
  });

  // Deduplicate candidates extracted from the same page
  const unique = new Map();
  for (const item of results) {
    if (!unique.has(item.code) || item.status === "active") {
      unique.set(item.code, item);
    }
  }

  return Array.from(unique.values());
}
