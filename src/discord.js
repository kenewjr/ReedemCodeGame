export async function sendDiscordWebhook(webhookUrl, contentOrPayload, options = {}) {
  if (!webhookUrl || !webhookUrl.startsWith("http")) {
    return { ok: false, error: "Invalid or empty Webhook URL. Please check Webhook settings." };
  }

  try {
    const url = new URL(webhookUrl);
    url.searchParams.set("wait", "true"); // Ensures Discord returns message object with id

    let payload = {};
    if (typeof contentOrPayload === "object" && contentOrPayload !== null) {
      payload = { ...contentOrPayload };
    } else {
      payload = { content: String(contentOrPayload || "") };
    }

    if (options.username && options.username.trim()) {
      payload.username = options.username.trim();
    }
    if (options.avatarUrl && options.avatarUrl.trim()) {
      payload.avatar_url = options.avatarUrl.trim();
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000); // 8s timeout

    const res = await fetch(url.toString(), {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    clearTimeout(timeout);

    if (res.status === 429) {
      const retryAfter = res.headers.get("Retry-After") || "5";
      return { ok: false, error: `Rate limited by Discord. Retry after ${retryAfter}s` };
    }

    if (!res.ok) {
      const text = await res.text();
      return { ok: false, error: `Discord HTTP ${res.status}: ${text}` };
    }

    const data = await res.json();
    return { ok: true, messageId: data.id || "" };
  } catch (err) {
    if (err.name === "AbortError") {
      return { ok: false, error: "Discord Webhook request timed out after 8 seconds." };
    }
    return { ok: false, error: err.message };
  }
}

export async function publishDiscordMessage(channelId, messageId, botToken) {
  const cleanToken = String(botToken || "").trim().replace(/^Bot\s+/i, "");
  if (!cleanToken || !channelId || !messageId) {
    return { ok: false, skipped: true, reason: "No bot token or channel details for auto-publish" };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages/${messageId}/crosspost`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Authorization": `Bot ${cleanToken}`,
        "Content-Type": "application/json"
      }
    });
    clearTimeout(timeout);

    if (!res.ok) {
      const text = await res.text();
      return { ok: false, error: `Crosspost failed ${res.status}: ${text}` };
    }

    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
