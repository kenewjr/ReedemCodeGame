import { getGameMeta } from "./games/registry.js";

export function formatRewards(rawRewards, code = "") {
  if (!rawRewards || !String(rawRewards).trim()) return "N/A";

  let cleaned = String(rawRewards)
    .replace(/\{\{Item List\|([^}]+)\}\}/g, "$1")
    .replace(/\|mode=br/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/[\r\n]+/g, " ");

  // Remove UI button/action artifacts
  cleaned = cleaned
    .replace(/\bCopied\b/gi, "")
    .replace(/▶︎?\s*Redeem\s*(Code)?\s*(Link|Here)?/gi, "")
    .replace(/\bDate Added:\s*[\d/]+/gi, "")
    .replace(/\bExpires?:\s*[\d/-]+(\s*(UTC|PT|ET|GMT|JST))?/gi, "")
    .replace(/\bValid until:\s*[\d/-]+(\s*(UTC|PT|ET|GMT|JST))?/gi, "")
    .replace(/\b(Expired|Expires)\s+(TBA|Unknown|[\d/]+)/gi, "")
    .replace(/https?:\/\/[^\s,]+/g, "");

  // Remove the code itself if present in rewards text
  if (code && String(code).trim().length >= 4) {
    const cleanC = String(code).trim();
    const escapedCode = cleanC.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    cleaned = cleaned.replace(new RegExp(`\\b${escapedCode}\\b`, "gi"), "");
  }

  const items = cleaned
    .split(/(?<!\d),(?!\d)|[;・•|]|\b-\s+|<br\s*\/?>/i)
    .map(line => {
      let trimmed = line.replace(/^[\s・•\-*:]+/, "").replace(/[\s・•\-*:]+$/, "").trim();
      trimmed = trimmed.replace(/\s+/g, " ");
      // Convert quantity multiplier asterisk (*100 ->  ×100) to avoid Discord markdown italic formatting
      trimmed = trimmed.replace(/\*(\d+)/g, " ×$1");
      return trimmed;
    })
    .filter(line => {
      if (!line) return false;
      if (code && line.toLowerCase() === String(code).toLowerCase()) return false;
      if (/^(copied|redeem|link|expires?|valid)/i.test(line)) return false;
      return true;
    });

  return items.length > 0 ? items.join(", ") : "N/A";
}

export function renderMessage(template, data, tags = "") {
  const meta = getGameMeta(data.game);

  let fullRedeemUrl = meta.redeemUrl || "";
  if (data.code && meta.hasWebRedemption && meta.redeemUrl && meta.redeemUrl !== "#") {
    const separator = meta.redeemUrl.includes("?") ? "&" : "?";
    fullRedeemUrl = `${meta.redeemUrl}${separator}code=${encodeURIComponent(data.code)}`;
  }

  const hypertextLink = fullRedeemUrl ? `[click here](${fullRedeemUrl})` : "N/A";
  const formattedRewards = formatRewards(data.rewards, data.code);

  let msg = template || "";
  msg = msg.replaceAll("{{game}}", data.game || "");
  msg = msg.replaceAll("{{gameName}}", meta.name || data.game || "");
  msg = msg.replaceAll("{{code}}", data.code || "");
  msg = msg.replaceAll("{{status}}", data.status || "unconfirmed");
  msg = msg.replaceAll("{{codeType}}", data.code_type || data.codeType || "redeem");
  msg = msg.replaceAll("{{server}}", data.server || "All");
  msg = msg.replaceAll("{{rewards}}", formattedRewards);
  msg = msg.replaceAll("{{expires}}", data.expires || data.expires_at || "Unknown");
  msg = msg.replaceAll("{{notes}}", data.notes || "");
  msg = msg.replaceAll("{{redeemLink}}", hypertextLink);
  
  // If template already has markdown link like [click here]({{redeemUrl}}), keep {{redeemUrl}} as URL
  // If template has plain "Redeem Link: {{redeemUrl}}", replace with hypertext link
  if (msg.includes("[click here]({{redeemUrl}})")) {
    msg = msg.replaceAll("{{redeemUrl}}", fullRedeemUrl);
  } else if (msg.includes("Redeem Link: {{redeemUrl}}")) {
    msg = msg.replaceAll("Redeem Link: {{redeemUrl}}", `Redeem Link: ${hypertextLink}`);
  } else {
    msg = msg.replaceAll("{{redeemUrl}}", fullRedeemUrl);
  }

  msg = msg.replaceAll("{{tags}}", tags);

  let sourcesList = "";
  try {
    const s = typeof data.sources_json === "string" ? JSON.parse(data.sources_json) : (data.sources || []);
    sourcesList = Array.isArray(s) ? s.join(", ") : "";
  } catch {}
  msg = msg.replaceAll("{{sources}}", sourcesList);

  return msg.trim();
}

export function renderDiscordEmbed(data, tags = "") {
  const meta = getGameMeta(data.game);
  const colorMap = {
    hsr: 0x9333ea,
    genshin: 0x0284c7,
    wuwa: 0x10b981,
    endfield: 0xf59e0b,
    nte: 0xec4899
  };

  let fullRedeemUrl = "";
  if (data.code && meta.hasWebRedemption && meta.redeemUrl && meta.redeemUrl !== "#") {
    const separator = meta.redeemUrl.includes("?") ? "&" : "?";
    fullRedeemUrl = `${meta.redeemUrl}${separator}code=${encodeURIComponent(data.code)}`;
  }

  const formattedRewards = formatRewards(data.rewards, data.code);

  const fields = [
    { name: "Code", value: `\`${data.code}\``, inline: true },
    { name: "Type", value: String(data.code_type || data.codeType || "redeem").toUpperCase(), inline: true },
    { name: "Server", value: data.server || "All", inline: true },
    { name: "Rewards", value: formattedRewards || "N/A", inline: false },
    { name: "Expiry", value: data.expires || data.expires_at || "Unknown", inline: true }
  ];

  // Note: Only include Redeem Link if game has web redemption!
  if (meta.hasWebRedemption && fullRedeemUrl) {
    fields.push({ name: "Redeem Link", value: `[Click Here](${fullRedeemUrl})`, inline: true });
  }

  const embed = {
    title: `🎮 [${meta.name}] New Redeem Code!`,
    color: colorMap[data.game] || 0x3b82f6,
    fields,
    footer: {
      text: `RedeemRelay • Verified by ${data.verified_count || 1} source(s)`
    },
    timestamp: data.first_seen_at || new Date().toISOString()
  };

  const result = { embeds: [embed] };
  if (tags && tags.trim()) {
    result.content = tags.trim();
  }
  return result;
}

export function formatTags(rolesToTag = [], usersToTag = []) {
  const roleTags = (rolesToTag || []).map(id => `<@&${id.trim()}>`).filter(Boolean).join(" ");
  const userTags = (usersToTag || []).map(id => `<@${id.trim()}>`).filter(Boolean).join(" ");
  return `${roleTags} ${userTags}`.trim();
}

