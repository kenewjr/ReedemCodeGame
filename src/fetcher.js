// Smart Anti-Bot Fetcher Module (Native Header Rotation + Camofox Side-by-Side Fallback)

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:123.0) Gecko/20100101 Firefox/123.0",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36 Edg/121.0.0.0",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
];

function getRandomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function getStealthHeaders(targetUrl) {
  const ua = getRandomUserAgent();
  const origin = new URL(targetUrl).origin;
  
  return {
    "User-Agent": ua,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9,id;q=0.8",
    "Accept-Encoding": "gzip, deflate, br",
    "Cache-Control": "max-age=0",
    "Sec-Ch-Ua": '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": '"Windows"',
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "cross-site",
    "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1",
    "Referer": origin
  };
}

let camofoxOfflineUntil = 0;

async function fetchViaCamofox(targetUrl, camofoxUrl) {
  // If Camofox marked offline due to recent connection error/timeout, skip immediately
  if (Date.now() < camofoxOfflineUntil) {
    throw new Error("Camofox is currently offline/unreachable (circuit breaker)");
  }

  const endpoint = camofoxUrl.endsWith("/") ? `${camofoxUrl}snapshot` : `${camofoxUrl}/snapshot`;
  const urlWithQuery = `${endpoint}?url=${encodeURIComponent(targetUrl)}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000); // 4s fast timeout for Camofox

  try {
    const res = await fetch(urlWithQuery, {
      method: "GET",
      signal: controller.signal,
      headers: { "Accept": "application/json, text/html, */*" }
    });
    clearTimeout(timeout);

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Camofox returned HTTP ${res.status}: ${errText.slice(0, 100)}`);
    }

    const contentType = res.headers.get("content-type") || "";
    let bodyText = "";

    if (contentType.includes("application/json")) {
      const data = await res.json();
      bodyText = data.html || data.content || data.snapshot || JSON.stringify(data);
    } else {
      bodyText = await res.text();
    }

    return {
      ok: true,
      status: 200,
      text: async () => bodyText,
      headers: res.headers,
      viaCamofox: true
    };
  } catch (err) {
    clearTimeout(timeout);
    // Mark Camofox offline for 2 minutes on connection error or timeout
    camofoxOfflineUntil = Date.now() + 2 * 60 * 1000;
    throw err;
  }
}

export async function fetchWithBypass(url, options = {}) {
  const maxRetries = options.maxRetries || 1;
  const timeoutMs = options.timeoutMs || 5000; // 5s timeout
  const camofoxUrl = process.env.CAMOFOX_URL || options.camofoxUrl || "";

  let lastError = null;
  let lastRes = null;

  // Tier 1: Stealth Native HTTP Fetcher with Header Rotation & Retries
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        // Random backoff jitter: 200ms - 500ms
        const jitter = Math.floor(Math.random() * 300) + 200;
        await new Promise(r => setTimeout(r, jitter * attempt));
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      const headers = {
        ...getStealthHeaders(url),
        ...(options.headers || {})
      };

      const res = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers
      });
      clearTimeout(timeout);

      lastRes = res;

      // If response is OK or 3xx, return immediately
      if (res.ok) {
        return res;
      }

      // If blocked by anti-bot (HTTP 403 or 429), try Camofox sidecar fallback if configured
      if ((res.status === 403 || res.status === 429) && camofoxUrl) {
        try {
          const camofoxRes = await fetchViaCamofox(url, camofoxUrl);
          return camofoxRes;
        } catch (camofoxErr) {
          // If Camofox fallback fails, keep last native error response
        }
      }
    } catch (err) {
      lastError = err;
      if (err.name === "AbortError") {
        lastError = new Error(`Request timed out after ${timeoutMs}ms`);
      }
    }
  }

  // Tier 2 Fallback: If native fetch failed or timed out and Camofox is available, try Camofox as last resort
  if (camofoxUrl && Date.now() >= camofoxOfflineUntil) {
    try {
      return await fetchViaCamofox(url, camofoxUrl);
    } catch {}
  }

  if (lastRes) return lastRes;
  throw lastError || new Error(`Fetch failed for ${url}`);
}
