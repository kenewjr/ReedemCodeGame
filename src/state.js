import fs from "node:fs";
import path from "node:path";

const CONFIG_PATH = path.resolve("data/config.json");

export const DEFAULT_CONFIG = {
  adminToken: process.env.ADMIN_TOKEN || "change_me_super_secret_token",
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

export function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    saveConfig(DEFAULT_CONFIG);
    return DEFAULT_CONFIG;
  }
  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch (err) {
    console.error("Failed to parse config.json, using defaults:", err);
    return DEFAULT_CONFIG;
  }
}

export function saveConfig(cfg) {
  const dir = path.dirname(CONFIG_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), "utf8");
}
