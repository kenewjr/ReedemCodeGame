import fs from "node:fs";
import path from "node:path";

const CONFIG_PATH = path.resolve("data/config.json");

export const DEFAULT_CONFIG = {
  pollSeconds: parseInt(process.env.POLL_SECONDS || "60", 10),
  games: {
    hsr: { enabled: true },
    genshin: { enabled: true },
    wuwa: { enabled: true },
    endfield: { enabled: true },
    nte: { enabled: true }
  },
  webhooks: [
    {
      id: "default-hook",
      name: "Default Webhook",
      url: process.env.DISCORD_WEBHOOK_URL || "",
      enabled: true,
      rolesToTag: [],
      usersToTag: [],
      customMessage: ""
    }
  ],
  defaultMessageTemplate: "🎮 **[{{gameName}}] New Code Discovered!**\n\nCode: `{{code}}`\nRewards: {{rewards}}\nServer: {{server}}\nExpiry: {{expires}}\nRedeem Link: {{redeemUrl}}\n\nTags: {{tags}}"
};

// ponytail: in-memory cache eliminates per-request sync I/O; upgrade to file watcher if multi-process
let _cachedConfig = null;

export function loadConfig() {
  if (_cachedConfig) return _cachedConfig;
  if (!fs.existsSync(CONFIG_PATH)) {
    saveConfig(DEFAULT_CONFIG);
    return _cachedConfig;
  }
  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw);
    _cachedConfig = { ...DEFAULT_CONFIG, ...parsed };
    return _cachedConfig;
  } catch (err) {
    console.error("Failed to parse config.json, using defaults:", err);
    _cachedConfig = DEFAULT_CONFIG;
    return _cachedConfig;
  }
}

export function saveConfig(cfg) {
  const dir = path.dirname(CONFIG_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), "utf8");
  _cachedConfig = cfg;
}

