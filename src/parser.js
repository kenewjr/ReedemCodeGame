import * as cheerio from "cheerio";

export const NON_CODES = new Set([
  // Games & Publishers
  "HONKAI", "GENSHIN", "STARRAIL", "WUTHERING", "WAVES", "IMPACT", "ARKNIGHTS", "ENDFIELD",
  "NEVERNESS", "EVERNESS", "HOYOVERSE", "KUROGAMES", "MIHOYO", "FANDOM", "GAME8", "DESTRUCTOID",
  "PCGAMESN", "PCGAMER", "SILICONERA", "VG247", "ROCKPAPERSHOTGUN", "DOTGG", "GAMESRADAR",
  "UMAMUSUME", "CYBERPUNK", "PERSONA", "SONIC", "YU-GI", "YUGI", "YUGIOH",

  // Currencies & Item types (when alone)
  "PRIMOGEMS", "PRIMOGEM", "ASTRITE", "ASTRITES", "STELLAR", "CREDITS", "CREDIT", "ORUNDUM",
  "MORA", "GENESIS", "CRYSTALS", "CRYSTAL", "COINS", "COIN", "RESONANCE", "LUNITE",

  // Dates & Months
  "JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER",
  "OCTOBER", "NOVEMBER", "DECEMBER",

  // UI, Web & App Actions
  "SEARCH", "MENU", "LOGIN", "SIGNUP", "REGISTER", "SUBMIT", "COPIED", "REDEEM", "REDEEMED",
  "CODES", "CODE", "HERE", "LINK", "FREE", "REWARDS", "REWARD", "TABLE", "LIST", "UPDATE",
  "UPDATED", "VERSION", "PATCH", "SERVER", "STATUS", "GLOBAL", "ASIA", "EUROPE", "AMERICA",
  "TWITCH", "PRIME", "GAMING", "DROPS", "NEWS", "DISCORD", "TWITTER", "YOUTUBE", "ARTICLE",
  "PRIVACY", "COOKIES", "TERMS", "RIGHTS", "RESERVED", "COPYRIGHT", "EXPIRED", "ACTIVE",
  "WORKING", "UNCONFIRMED", "VALID", "INVALID", "REDEMPTION", "HEADER", "FOOTER", "EXCHANGE",
  "PHONE", "BUTTON", "SECTION", "ICONS", "SCREEN", "HOMEPAGE", "SIDEBAR",

  // Guide, How-To, & Tutorial vocabulary
  "GUIDES", "GUIDE", "TIPS", "TIP", "TRICKS", "WALKTHROUGH", "TUTORIAL", "OVERVIEW", "REVIEW",
  "CAVERNS", "TIER", "SIMULATED", "APOCALYPTIC", "CURRENCY", "BANNER", "BANNERS", "RERUN",
  "RELEASE", "MAINTENANCE", "DOWNLOAD", "CONTROLLER", "DIFFERENCES", "REVEAL", "CHARACTER",
  "CHARACTERS", "WHEN", "WORLD", "OPERATION", "OVERTURE", "CHALLENGE", "DAILIES", "DAILY",
  "COMMISSIONS", "COMMISSION", "CHESTS", "CHEST", "QUESTS", "QUEST", "ACHIEVEMENTS", "ACHIEVEMENT",
  "SHRINES", "SHRINE", "WORSHIP", "STATUES", "STATUE", "MAIL", "MAILBOX", "SHOP", "STORE",
  "PURCHASES", "EXPLORING", "PROMOTION", "SPECIAL", "EVENTS", "EVENT", "BOSSES", "WARPS",
  "WARP", "ITEMS", "ITEM", "MAPS", "MAP", "MISSIONS", "MISSION", "LEVEL", "LEVELS", "STAGE",
  "STAGES", "SYSTEM", "REQUIREMENTS", "PLATFORMS", "PLATFORM", "DETAILS", "ACCOUNT", "STEPS",
  "CONFIRM", "COGWHEEL",

  // General English Words & Character names that appear in guide labels/tables
  "BLADE", "HIMEKO", "AVENTURINE", "ROBIN", "TRAILBLAZER", "JARILO", "YANGYANG", "SUISUI",
  "CAMELLYA", "CARTETHYIA", "PHROLOVA", "THRENODIANS", "SUMIKA", "MINGTING", "STARTORCH",
  "DHALIFA", "ROVER", "JINHSI", "SANHUA", "LAHAI", "SILVER", "BRANT", "CARLOTTA", "CANTARELLA",
  "CHANGLI", "ENCORE", "JIYAN", "LINGYANG", "ROCCIA", "YINLIN", "ZHEZHI", "SOMNOIRE", "PLUSHIE",
  "ABRAXAS", "PART", "FULL", "PINK", "LAID", "PLAY", "ANTI", "MUSE", "TEST", "MORE", "SOME",
  "WHAT", "YOUR", "THEM", "THIS", "THAT", "WITH", "FROM", "HAVE", "BEEN", "LIKE", "ABOUT",
  "NOTE", "NOTES", "HOWTO", "STEPS", "OTHER", "WAYS", "PAST", "CURRENT", "OLDER", "RECENT"
]);

// Helper: Detect if a reward string contains instructional/guide text rather than game items
export function isInstructionalReward(text) {
  if (!text || typeof text !== "string") return false;
  const t = text.toLowerCase();

  const guidePatterns = [
    /\b(click|press|open|select|choose|enter|type|hit|run|claim|download|install|switch|navigate|go into|tap)\s+(the|on|to|a|your|button|icon|screen|menu|settings|tab|option|device|game|code|inbox)\b/i,
    /\b(if you|you can|be sure to|keep an eye|every now and|there(?:'|’|\s)s no better|when on a|things to do|walkthrough|guide &|guides wiki|rerun banner|available platforms|system requirements|how to|should you watch|age verification|pre-registration)\b/i,
    /\b(top corner|left-hand|right-hand|next to your name|of depths can be|exchange \w+ at|genesis crystals from)\b/i,
    /\b(fog of war|tank the hit|good option|quick primogem|fast travel)\b/i
  ];

  for (const pattern of guidePatterns) {
    if (pattern.test(t)) return true;
  }
  return false;
}

// Helper: Validate if string is a legitimate redeem code and not quantity/UI artifact
export function isValidCode(raw) {
  if (!raw || typeof raw !== "string") return false;
  const s = raw.trim().toUpperCase();
  // Redeem codes strictly do not contain whitespace
  if (/\s/.test(s)) return false;
  if (s.length < 4 || s.length > 30) return false;
  if (!/^[A-Z0-9]+([-_][A-Z0-9]+)*$/.test(s)) return false;
  if (!/[A-Z]/.test(s)) return false;
  if (NON_CODES.has(s)) return false;

  // Reject quantity multipliers (e.g. X100, X120, X4000, 100X, etc.)
  if (/^[X×]\d+$/i.test(s) || /^\d+[X×]$/i.test(s)) return false;

  // Reject quantity multipliers glued to reward words (e.g. X10000ADVENTURER, X30000HERO, X100MORA)
  if (/^[X×]\d+[A-Z]+$/i.test(s)) return false;

  // Reject numbers with suffixes/prefixes (e.g. 000NL, 13TH, 1ST)
  if (/^\d{3,}[A-Z]{1,2}$/i.test(s) || /^\d+(ST|ND|RD|TH)$/i.test(s)) return false;

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

// Helper: Format server code to human readable name
export function formatServer(rawServer) {
  if (!rawServer || !String(rawServer).trim()) return "All";
  const clean = String(rawServer)
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/[{}[\]]/g, "")
    .trim()
    .toUpperCase();

  const serverMap = {
    "A": "All",
    "ALL": "All",
    "GLOBAL": "Global",
    "G": "Global",
    "CN": "China",
    "NA": "North America",
    "EU": "Europe",
    "SEA": "Southeast Asia",
    "SAR": "TW / HK / MO",
    "ASIA": "Asia"
  };

  return serverMap[clean] || clean || "All";
}

// Helper: Format and clean expiry string for display
export function formatExpiry(rawExpiry, status = "") {
  if (!rawExpiry || !String(rawExpiry).trim()) return "Unknown";
  let clean = String(rawExpiry)
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/[{}[\]]/g, "")
    .replace(/={2,}[^=]+={2,}/g, "")
    .replace(/Code Row\/?(header|footer)?/gi, "")
    .replace(/Mail\/Reward[^,]*/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  if (/\b(indef|indefinite|permanent|never|no expiry)\b/i.test(clean)) {
    return "Permanent";
  }
  if (/^\b(exp|expired)\b/i.test(clean)) {
    return "Expired";
  }
  if (/^(tba|unknown|n\/a|\?)$/i.test(clean)) {
    return "Unknown";
  }

  const parsed = parseExpiryDate(clean);
  if (parsed) {
    const today = new Date().toISOString().split("T")[0];
    if (parsed < today || status === "expired") {
      return `${parsed} (Expired)`;
    }
    return parsed;
  }

  if (status === "expired") {
    return "Expired";
  }

  if (/[=/|<>]/.test(clean) || clean.length > 30) {
    return "Unknown";
  }

  return clean || "Unknown";
}

// Helper: Clean wikitext templates & remove inline references/links
export function cleanWikitextTemplate(str) {
  if (!str) return "";
  let s = String(str);
  s = s.replace(/\{\{(?:Item|Card)\s+List\s*\|([^}]+)\}\}/gi, "$1");
  s = s.replace(/\b(?:Item|Card)\s+List\b/gi, "");
  s = s.replace(/\|mode=\w+/gi, "");
  s = s.replace(/\|delim=[^|}]+/gi, "");
  s = s.replace(/<ref[\s\S]*?<\/ref>/gi, "");
  s = s.replace(/<[^>]+>/g, "");
  s = s.replace(/\[\[(?:[^|\]]*\|)?([^\]]+)\]\]/g, "$1");
  s = s.replace(/[{}[\]]/g, "");
  return s.replace(/;/g, ", ").trim();
}

// Helper: Depth-aware template extractor for nested {{...}} templates
export function extractWikitextTemplates(wikitext, templateName) {
  const results = [];
  const pattern = new RegExp(`\\{\\{\\s*${templateName}[\\s\\n]*\\|`, "gi");
  let match;
  while ((match = pattern.exec(wikitext)) !== null) {
    const startIndex = match.index;
    const contentStartIndex = match.index + match[0].length;
    let depth = 2;
    let i = contentStartIndex;
    while (i < wikitext.length && depth > 0) {
      if (wikitext[i] === "{" && wikitext[i + 1] === "{") {
        depth += 2;
        i += 2;
      } else if (wikitext[i] === "}" && wikitext[i + 1] === "}") {
        depth -= 2;
        i += 2;
      } else {
        i++;
      }
    }
    const rawContent = wikitext.slice(contentStartIndex, i - 2);
    results.push({
      startIndex,
      endIndex: i,
      rawContent
    });
  }
  return results;
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
export function parseFandomWikitext(game, rawWikitext, sourceUrl) {
  const results = [];
  if (!rawWikitext) return results;

  const wikitext = rawWikitext.replace(/<!--[\s\S]*?-->/g, "");

  if (game === "hsr") {
    let currentStatus = "active";
    const templates = extractWikitextTemplates(wikitext, "Redemption Code Row");

    for (const tmpl of templates) {
      const matchIndex = tmpl.startIndex;
      const textBefore = wikitext.slice(Math.max(0, matchIndex - 500), matchIndex);
      if (textBefore.includes("==Expired Codes==") || textBefore.includes("===Expired===") || textBefore.includes("==Expired==") || textBefore.includes("<!--expired-->")) {
        currentStatus = "expired";
      }

      const cleanContent = tmpl.rawContent.trim();
      if (/^(header|footer)/i.test(cleanContent)) continue;

      const parts = splitWikitextRow(cleanContent);
      let rawCode = cleanCodeString(parts[0]);
      if (!rawCode || !isValidCode(rawCode)) continue;

      let server = "All";
      let rewards = "";
      let expires = "";
      let discovered = "";

      for (let i = 1; i < parts.length; i++) {
        const p = parts[i].trim();
        if (p.startsWith("ref=")) continue;
        if (["A", "G", "SEA", "CN", "NA", "EU", "SAR", "ALL", "GLOBAL"].includes(p.toUpperCase())) {
          server = formatServer(p);
        } else if (p.includes("Stellar Jade") || p.includes("Credit") || p.includes("Traveler's Guide") || p.includes("Item List") || p.includes("Fuel") || p.includes("Variable") || p.includes("Aether") || p.includes("Heroic") || p.includes("Refined")) {
          rewards = cleanWikitextTemplate(p);
        } else if (p.match(/^\d{4}-\d{2}-\d{2}/) || /^(indef|exp|permanent|unknown)/i.test(p)) {
          if (!discovered && p.match(/^\d{4}-\d{2}-\d{2}/) && i === 4) {
            discovered = p;
          } else {
            expires = formatExpiry(p);
          }
        }
      }

      results.push({
        game,
        code: rawCode,
        status: currentStatus,
        codeType: detectCodeType(rawCode, rewards),
        server,
        rewards: cleanRewards(rewards, rawCode),
        expires: expires || "Unknown",
        discovered,
        notes: "Fandom HSR Wiki",
        sources: [sourceUrl]
      });
    }
  } else if (game === "genshin") {
    let currentStatus = "active";
    const templates = extractWikitextTemplates(wikitext, "Code Row");

    for (const tmpl of templates) {
      const matchIndex = tmpl.startIndex;
      const textBefore = wikitext.slice(Math.max(0, matchIndex - 500), matchIndex);
      if (textBefore.includes("==Expired Codes==") || textBefore.includes("===Expired===") || textBefore.includes("==Expired==")) {
        currentStatus = "expired";
      }

      const cleanContent = tmpl.rawContent.trim();
      if (/^(header|footer)/i.test(cleanContent)) continue;

      const parts = splitWikitextRow(cleanContent);
      const rawCodeStr = parts[0]?.trim();
      if (!rawCodeStr || rawCodeStr.includes("WA8MJCETGXLR")) continue;

      const rawCodes = rawCodeStr.split(/[;,/\n\r]+/).map(c => cleanCodeString(c)).filter(Boolean);
      for (const code of rawCodes) {
        if (!isValidCode(code)) continue;

        let server = formatServer(parts[1]?.trim() || "G");
        let rewards = cleanWikitextTemplate(parts[2] || "");
        
        let val3 = (parts[3] || "").trim();
        let val4 = (parts[4] || "").trim();

        let discovered = "";
        let rawExp = "";

        if (val3 && val4) {
          discovered = val3;
          rawExp = val4;
        } else if (val3) {
          if (val3.match(/PT|UTC|\d{1,2}:\d{2}|valid|version|patch|exp|indef/i)) {
            rawExp = val3;
          } else {
            discovered = val3;
          }
        }

        results.push({
          game,
          code,
          status: currentStatus,
          codeType: detectCodeType(code, rewards),
          server,
          rewards: cleanRewards(rewards, code),
          discovered,
          expires: formatExpiry(rawExp),
          notes: "Fandom Genshin Wiki",
          sources: [sourceUrl]
        });
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
        if (cardMatch) rewards = cleanWikitextTemplate(cardMatch[1]);

        if (i + 1 < lines.length && lines[i + 1].includes("Valid until:")) {
          const expMatch = lines[i + 1].match(/Valid until:\s*([^<'\n]+)/i);
          if (expMatch) expires = formatExpiry(expMatch[1]);
        }

        results.push({
          game,
          code,
          status: currentStatus,
          codeType: detectCodeType(code, rewards),
          server: "All",
          rewards: cleanRewards(rewards, code),
          expires: expires || "Unknown",
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

  // Remove boilerplates & non-content areas
  $("script, style, nav, header, footer, aside, .sidebar, .widget, .comments, #comments, .nav, .footer, .ad-container, .advertisement, .toc, #toc, .breadcrumb, .related-posts, .share-buttons").remove();

  const EXCLUDE_HEADING_REGEX = /\b(how\s*to\s*(redeem|claim|use|get|enter)|steps\s*to|where\s*to|what\s*are|other\s*ways|faq|frequently|characters?|tier\s*list|builds?|banners?|reruns?|weapons?|bosses?|enemies?|guides?|walkthrough|quests?|system\s*requirements?|platforms?|schedule|news|related|comments?|patch\s*notes?|archive|wiki)\b/i;
  const CODE_HEADING_REGEX = /\b(active|working|live|new|latest|current|valid|expired|old|livestream|stream|promo|redemption|gift|all\s*codes)\s*(codes?|rewards?)?\b/i;

  // Strategy 1: Table-based extraction
  $("table").each((_, tbl) => {
    const container = $(tbl).closest("section, div, article") || $(tbl);
    const prevHeading = $(tbl).prevAll("h1, h2, h3, h4, h5, h6").first().text().trim() ||
                        $(tbl).parents().prevAll("h1, h2, h3, h4, h5, h6").first().text().trim() || "";

    // Explicitly reject guide / tutorial / navigation tables
    if (EXCLUDE_HEADING_REGEX.test(prevHeading)) return;

    // Check table headers & inputs
    const thText = $(tbl).find("th").text().toLowerCase();
    const hasCodeInput = $(tbl).find("input.a-clipboard__textInput, input[type='text'], a[href*='code=']").length > 0;
    const isCodeHeading = CODE_HEADING_REGEX.test(prevHeading);
    const isCodeTh = /\b(code|promo|gift|redemption|voucher)\b/i.test(thText);

    // Table MUST have clipboard inputs, code links, code headers, or be under a code heading
    if (!hasCodeInput && !isCodeTh && !isCodeHeading) return;

    let sectionStatus = "unconfirmed";
    const contextText = (prevHeading + " " + container.text()).slice(0, 1000);
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

      // 1. Check input value (Game8 clipboard container)
      const inputVal = $(tr).find("input[type='text'], input.a-clipboard__textInput").val();
      if (inputVal && isValidCode(inputVal)) {
        extractedCode = inputVal.trim().toUpperCase();
      }

      // 2. Check links with ?code=...
      if (!extractedCode) {
        $(tr).find("a[href*='code=']").each((_, a) => {
          const href = $(a).attr("href") || "";
          const match = href.match(/[?&]code=([A-Za-z0-9_-]+)/i);
          if (match && isValidCode(match[1])) {
            extractedCode = match[1].trim().toUpperCase();
          }
        });
      }

      // 3. Check <code>, <strong>, <b> in 1st cell
      if (!extractedCode && tds.length > 0) {
        const firstTd = $(tds[0]);
        const codeTag = firstTd.find("code, strong, b").first().text().trim();
        if (codeTag && isValidCode(codeTag)) {
          extractedCode = codeTag.toUpperCase();
        }
      }

      // 4. Check first cell plain text only if table has code header or code heading
      if (!extractedCode && (isCodeTh || isCodeHeading) && tds.length > 0) {
        const firstTdText = $(tds[0]).text().trim();
        const segments = firstTdText.split(/[\s;,/\n\r\t]+/).filter(Boolean);
        for (const seg of segments) {
          const cleaned = seg.replace(/^[^a-zA-Z0-9_-]+|[^a-zA-Z0-9_-]+$/g, "");
          if (isValidCode(cleaned)) {
            extractedCode = cleaned.toUpperCase();
            break;
          }
        }
      }

      if (!extractedCode || !isValidCode(extractedCode)) return;

      // Extract rewards from subsequent cells
      if (tds.length >= 2) {
        const rewardCells = [];
        for (let i = 1; i < tds.length; i++) {
          const cellText = $(tds[i]).text().replace(/\s+/g, " ").trim();
          if (cellText) rewardCells.push(cellText);
        }
        rawRewards = rewardCells.join(", ");
      }

      // Reject instructional text masquerading as rewards
      if (isInstructionalReward(rawRewards)) return;

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
    const prevHeading = $(list).prevAll("h1, h2, h3, h4, h5, h6").first().text().trim() ||
                        $(list).parents().prevAll("h1, h2, h3, h4, h5, h6").first().text().trim() || "";

    // Strictly skip non-code or tutorial lists
    if (EXCLUDE_HEADING_REGEX.test(prevHeading)) return;
    if (!CODE_HEADING_REGEX.test(prevHeading)) return;

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

      // Check separator patterns
      const sepMatch = liText.match(/^([A-Za-z0-9_-]{4,30})\s*[:–—\-\(]\s*(.+)$/);
      if (sepMatch && isValidCode(sepMatch[1])) {
        extractedCode = sepMatch[1].trim().toUpperCase();
        rawRewards = sepMatch[2].replace(/\)$/, "").trim();
      } else if (extractedCode) {
        rawRewards = liText.replace(new RegExp(`^\\s*${extractedCode}\\s*[:–—\\-\\s]*`, "i"), "");
      }

      if (!extractedCode || !isValidCode(extractedCode)) return;

      // Reject instructional text
      if (isInstructionalReward(rawRewards) || isInstructionalReward(liText)) return;

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

