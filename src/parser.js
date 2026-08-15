import * as cheerio from "cheerio";

export const NON_CODES = new Set([
  "HONKAI", "GENSHIN", "STARRAIL", "WUTHERING", "WAVES", "IMPACT", "REDEMPTION",
  "EXPIRED", "ACTIVE", "DISCORD", "TWITTER", "YOUTUBE", "HOYOVERSE", "KUROGAMES",
  "PRIMOGEMS", "ASTRITE", "STELLAR", "CREDITS", "JANUARY", "FEBRUARY", "MARCH",
  "APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER",
  "GUIDES", "POCKET", "TACTICS", "GAMESN", "GAME8", "DESTRUCTOID", "ARTICLE", "PRIVACY",
  "COOKIES", "TERMS", "RIGHTS", "RESERVED", "COPYRIGHT", "ARKNIGHTS", "ENDFIELD",
  "NEVERNESS", "EVERNESS", "SEARCH", "MENU", "LOGIN", "SIGNUP", "REGISTER", "SUBMIT",
  "COPIED", "REDEEM", "CODES", "CODE", "HERE", "LINK", "FREE", "REWARDS", "REWARD",
  "TABLE", "LIST", "UPDATE", "UPDATED", "VERSION", "PATCH", "SERVER", "STATUS",
  "GLOBAL", "ASIA", "EUROPE", "AMERICA", "TWITCH", "PRIME", "GAMING", "DROPS",
  "NEWS", "CHARACTERS", "BOSSES", "WARPS", "EVENTS", "ITEMS", "MAPS", "MISSIONS",
  "VG247", "SILICONERA", "ROCKPAPERSHOTGUN", "DOTGG", "PCGAMER", "GAMESRADAR", "FANDOM"
]);

// Helper: Validate if string is a legitimate redeem code and not quantity/UI artifact
export function isValidCode(raw) {
  if (!raw || typeof raw !== "string") return false;
  const s = raw.trim().toUpperCase();
  if (s.length < 4 || s.length > 35) return false;
  if (NON_CODES.has(s)) return false;

  // Reject quantity multipliers (e.g. X100, X120, X4000, 100X, etc.)
  if (/^[X×]\d+$/i.test(s) || /^\d+[X×]$/i.test(s)) return false;

  // Reject quantity multipliers glued to reward words (e.g. X10000ADVENTURER, X30000HERO, X100MORA)
  if (/^[X×]\d+[A-Z]+$/i.test(s)) return false;

  // Reject numbers with suffixes/prefixes (e.g. 000NL, 13TH, 1ST)
  if (/^\d{3,}[A-Z]{1,2}$/i.test(s) || /^\d+(ST|ND|RD|TH)$/i.test(s)) return false;

  // Must contain at least one letter
  if (!/[A-Z]/.test(s)) return false;

  // Reject URL prefixes or code row headers
  if (/^(HTTP|HTTPS|WWW|COM|NET|ORG|HTML)/i.test(s)) return false;
  if (/^CODE\s*ROW/i.test(s) || /HEADER|FOOTER|NOTACODE/i.test(s)) return false;

  return true;
}

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
  const trimmed = trimDuplicateCode(s.toUpperCase());
  if (!isValidCode(trimmed)) return "";
  return trimmed;
}

// Helper: Clean rewards string, removing UI buttons, dates, and the code itself
export function cleanRewards(rawRewards, code = "") {
  if (!rawRewards || typeof rawRewards !== "string") return "";
  let s = rawRewards
    .replace(/\{\{Item List\|([^}]+)\}\}/g, "$1")
    .replace(/\|mode=br/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/[\r\n]+/g, " ");

  // Remove UI button/action artifacts
  s = s.replace(/\bCopied\b/gi, "")
       .replace(/▶︎?\s*Redeem\s*(Code)?\s*(Link|Here)?/gi, "")
       .replace(/\bDate Added:\s*[\d/]+/gi, "")
       .replace(/\bExpires?:\s*[\d/-]+(\s*(UTC|PT|ET|GMT|JST))?/gi, "")
       .replace(/\bValid until:\s*[\d/-]+(\s*(UTC|PT|ET|GMT|JST))?/gi, "")
       .replace(/\b(Expired|Expires)\s+(TBA|Unknown|[\d/]+)/gi, "")
       .replace(/\(?(New|NEW|new)\)?/g, "")
       .replace(/https?:\/\/[^\s,]+/g, "");

  // Remove the code itself from rewards if present (case-insensitive word boundary match)
  if (code && String(code).trim().length >= 4) {
    const cleanC = String(code).trim();
    const escapedCode = cleanC.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    s = s.replace(new RegExp(`\\b${escapedCode}\\b`, "gi"), "");
  }

  // Normalize delimiters & bullets
  s = s.replace(/[・•]/g, ", ")
       .replace(/\s*;\s*/g, ", ")
       .replace(/\s*\|\s*/g, ", ")
       .replace(/,{2,}/g, ",")
       .replace(/^\s*[,:\-–—\s]+/, "")
       .replace(/[,:\-–—\s]+$/, "")
       .replace(/\s+/g, " ")
       .trim();

  return s;
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
      if (!isValidCode(code)) continue;

      const cleanRew = cleanRewards(item.rewards || "", code);

      results.push({
        game,
        code,
        status: item.status === "OK" ? "active" : "unconfirmed",
        codeType: detectCodeType(code, item.rewards || ""),
        server: "All",
        rewards: cleanRew,
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
        if (rawCode && isValidCode(rawCode)) {
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

          if (rewards.includes("{{") || rewards.includes("}}") || expires.includes("{{") || expires.includes("}}")) {
            continue;
          }

          results.push({
            game,
            code,
            status: currentStatus,
            codeType: detectCodeType(code, rewards + " " + line),
            server,
            rewards: cleanRewards(rewards, code),
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
            if (!isValidCode(code)) continue;

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
              rewards: cleanRewards(rewards, code),
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
        if (!isValidCode(code)) continue;
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
          rewards: cleanRewards(rewards, code),
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

  // Strategy 1: Table-based extraction
  $("table").each((_, tbl) => {
    const container = $(tbl).closest("section, div, article") || $(tbl);
    const prevHeading = $(tbl).prevAll("h1, h2, h3, h4, h5, h6").first().text() ||
                        $(tbl).parents().prevAll("h1, h2, h3, h4, h5, h6").first().text() || "";
    const contextText = (prevHeading + " " + container.text()).slice(0, 1000);

    let sectionStatus = "unconfirmed";
    if (/expired|old codes|out of date|no longer work/i.test(prevHeading || contextText)) {
      sectionStatus = "expired";
    } else if (/active|working|live codes|latest codes|new codes/i.test(prevHeading || contextText)) {
      sectionStatus = "active";
    }

    $(tbl).find("tr").each((_, tr) => {
      const tds = $(tr).find("td");
      if (!tds.length) return; // Header row

      let extractedCode = "";
      let rawRewards = "";
      let rawExpiry = "";

      // Check <input value="..."> inside table row (Game8 clipboard container)
      const inputVal = $(tr).find("input[type='text'], input.a-clipboard__textInput").val();
      if (inputVal && isValidCode(inputVal)) {
        extractedCode = inputVal.trim().toUpperCase();
      }

      // Check links with ?code=...
      if (!extractedCode) {
        $(tr).find("a[href*='code=']").each((_, a) => {
          const href = $(a).attr("href") || "";
          const match = href.match(/[?&]code=([A-Za-z0-9_]+)/i);
          if (match && isValidCode(match[1])) {
            extractedCode = match[1].trim().toUpperCase();
          }
        });
      }

      // Check <code>, <strong>, <b> in 1st cell
      if (!extractedCode && tds.length > 0) {
        const firstTd = $(tds[0]);
        const codeTag = firstTd.find("code, strong, b").first().text().trim();
        if (codeTag && isValidCode(codeTag)) {
          extractedCode = codeTag.toUpperCase();
        }
      }

      // Check first cell text words
      if (!extractedCode && tds.length > 0) {
        const firstTdText = $(tds[0]).text().trim();
        const segments = firstTdText.split(/[\s;,/\n\r\t]+/).filter(Boolean);
        for (const seg of segments) {
          const cleaned = seg.replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, "");
          if (isValidCode(cleaned)) {
            extractedCode = cleaned.toUpperCase();
            break;
          }
        }
      }

      if (!extractedCode || !isValidCode(extractedCode)) return;

      // Extract rewards from other cells (cell 1 onwards)
      if (tds.length >= 2) {
        const rewardCells = [];
        for (let i = 1; i < tds.length; i++) {
          const cellText = $(tds[i]).text().replace(/\s+/g, " ").trim();
          if (cellText) rewardCells.push(cellText);
        }
        rawRewards = rewardCells.join(", ");
      }

      const cleanRew = cleanRewards(rawRewards, extractedCode);

      results.push({
        game,
        code: extractedCode,
        status: sectionStatus,
        codeType: detectCodeType(extractedCode, contextText),
        server: "All",
        rewards: cleanRew,
        expires: rawExpiry,
        discovered: new Date().toISOString().split("T")[0],
        notes: `Extracted from ${new URL(sourceUrl).hostname}`,
        sources: [sourceUrl]
      });
    });
  });

  // Strategy 2: List-based extraction (ul, ol)
  $("ul, ol").each((_, list) => {
    const prevHeading = $(list).prevAll("h1, h2, h3, h4, h5, h6").first().text() ||
                        $(list).parents().prevAll("h1, h2, h3, h4, h5, h6").first().text() || "";
    let sectionStatus = "unconfirmed";
    if (/expired|old codes|out of date|no longer work/i.test(prevHeading)) {
      sectionStatus = "expired";
    } else if (/active|working|live codes|latest codes|new codes/i.test(prevHeading)) {
      sectionStatus = "active";
    }

    $(list).find("li").each((_, li) => {
      const liText = $(li).text().replace(/\s+/g, " ").trim();
      if (!liText || liText.length < 4) return;

      let extractedCode = "";
      let rawRewards = "";

      // Check <code> or <strong> inside <li>
      const leadTag = $(li).find("code, strong, b").first().text().trim();
      if (leadTag && isValidCode(leadTag)) {
        extractedCode = leadTag.toUpperCase();
      }

      // Check separator patterns (e.g. "CODE - Rewards", "CODE : Rewards", "CODE – Rewards", "CODE (Rewards)")
      const sepMatch = liText.match(/^([A-Za-z0-9_-]{4,35})\s*[:–—\-\(]\s*(.+)$/);
      if (sepMatch && isValidCode(sepMatch[1])) {
        extractedCode = sepMatch[1].trim().toUpperCase();
        rawRewards = sepMatch[2].replace(/\)$/, "").trim();
      } else if (extractedCode) {
        rawRewards = liText.replace(new RegExp(`^\\s*${extractedCode}\\s*[:–—\\-\\s]*`, "i"), "");
      }

      if (!extractedCode || !isValidCode(extractedCode)) return;

      const cleanRew = cleanRewards(rawRewards, extractedCode);

      results.push({
        game,
        code: extractedCode,
        status: sectionStatus,
        codeType: detectCodeType(extractedCode, prevHeading + " " + liText),
        server: "All",
        rewards: cleanRew,
        expires: "",
        discovered: new Date().toISOString().split("T")[0],
        notes: `Extracted from ${new URL(sourceUrl).hostname}`,
        sources: [sourceUrl]
      });
    });
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

