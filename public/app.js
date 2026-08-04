// Enterprise Dashboard Frontend Logic v2.0.0
let cachedCodes = [];
let cachedSources = [];
let cachedLogs = [];
let cachedWebhooks = [];
let currentGameFilter = "all";
let currentStatusFilter = "all";
let searchQuery = "";
let currentPage = 1;
const pageSize = 50;
let totalCodesCount = 0;

// Embedded API Documentation
const EMBEDDED_DOCS_MD = `# RedeemRelay REST API Documentation

Aplikasi ini menyediakan REST API tanpa proteksi token untuk manajemen kode redeem dan webhook:

---

### \`GET /api/public/codes\`
Mengambil daftar kode redeem dengan dukungan pagination dan filter game/status/code_type.

### \`GET /api/public/codes/count\`
Mengambil breakdown total count asli per game dan status dari database.

### \`GET /api/public/sources\`
Mengambil status kesehatan dari sumber scraper.

### \`GET /api/public/games\`
Mengambil daftar registry 5 game dan metadata.

### \`GET /api/public/logs\`
Mengambil audit logs sistem.

### \`POST /api/manual-code\`
Input kode manual.

### \`POST /api/force-send\`
Mengirim paksa ulang kode ke Webhook.

### \`PUT /api/config\`
Memperbarui konfigurasi.

### \`POST /api/test-webhook\`
Menguji pengiriman payload ke Webhook URL.
`;

// Toast System
function showToast(type, title, message, duration = 4000) {
  const container = document.getElementById("toastContainer");
  if (!container) return;
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;

  const icons = { success: "✅", error: "❌", warning: "⚠️", info: "ℹ️" };
  toast.innerHTML = `
    <div class="toast-icon">${icons[type] || "🔔"}</div>
    <div class="toast-content">
      <div class="toast-title">${title}</div>
      <div class="toast-msg">${message}</div>
    </div>
  `;

  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add("toast-out");
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// Progress Bar Helper
let progressBarTimer = null;
function setProgressBar(state) {
  const bar = document.getElementById("globalProgressBar");
  if (!bar) return;

  if (progressBarTimer) clearTimeout(progressBarTimer);

  if (state === "start") {
    bar.className = "progress-bar-top active";
    progressBarTimer = setTimeout(() => setProgressBar("stop"), 6000);
  } else if (state === "stop") {
    bar.className = "progress-bar-top complete";
    setTimeout(() => { bar.className = "progress-bar-top"; }, 400);
  }
}



// Tab Navigation
document.querySelectorAll(".nav-item[data-tab]").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".nav-item").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".tab-pane").forEach(p => p.classList.remove("active"));

    btn.classList.add("active");
    const target = btn.getAttribute("data-tab");
    document.getElementById(target)?.classList.add("active");

    if (target === "logsTab") loadSystemLogs();
  });
});

// Filter Pills
document.querySelectorAll("#gameFilter .pill").forEach(pill => {
  pill.addEventListener("click", () => {
    document.querySelectorAll("#gameFilter .pill").forEach(p => p.classList.remove("active"));
    pill.classList.add("active");
    currentGameFilter = pill.getAttribute("data-game");
    currentPage = 1;
    loadCodesFeed();
  });
});

document.querySelectorAll("#statusFilter .pill").forEach(pill => {
  pill.addEventListener("click", () => {
    document.querySelectorAll("#statusFilter .pill").forEach(p => p.classList.remove("active"));
    pill.classList.add("active");
    currentStatusFilter = pill.getAttribute("data-status");
    currentPage = 1;
    loadCodesFeed();
  });
});

// Debounced Search Input
let searchDebounceTimer = null;
document.getElementById("searchInput")?.addEventListener("input", (e) => {
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => {
    searchQuery = e.target.value.toLowerCase().trim();
    renderCodesTable();
  }, 250);
});

// Clipboard Helper
function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => {
    showToast("info", "Copied!", `Code <strong>${text}</strong> copied to clipboard.`);
  }).catch(err => {
    showToast("error", "Copy Failed", err.message);
  });
}

// Game Badge Component
function getGameBadge(game) {
  const meta = {
    hsr: { icon: "✨", name: "Star Rail" },
    genshin: { icon: "⚔️", name: "Genshin" },
    wuwa: { icon: "🌀", name: "WuWa" },
    endfield: { icon: "🛡️", name: "Endfield" },
    nte: { icon: "🌆", name: "NTE" }
  };
  const g = meta[game] || { icon: "🎮", name: game };
  return `<span class="game-badge"><span>${g.icon}</span> <span>${g.name}</span></span>`;
}

// Redeem URL Mapper
function getRedeemUrl(game, code) {
  if (game === "hsr") return `https://hsr.hoyoverse.com/gift?code=${code}`;
  if (game === "genshin") return `https://genshin.hoyoverse.com/gift?code=${code}`;
  if (game === "wuwa") return `https://wutheringwaves.kurogames.com/`;
  if (game === "endfield") return `https://endfield.gryphline.com/`;
  if (game === "nte") return `https://nte.hotta.hk/`;
  return "#";
}

// Render Codes Table
function renderCodesTable() {
  const tbody = document.getElementById("codesTbody");
  if (!tbody) return;

  let filtered = cachedCodes.filter(item => {
    if (searchQuery) {
      const matchCode = item.code.toLowerCase().includes(searchQuery);
      const matchRewards = (item.rewards || "").toLowerCase().includes(searchQuery);
      const matchNotes = (item.notes || "").toLowerCase().includes(searchQuery);
      if (!matchCode && !matchRewards && !matchNotes) return false;
    }
    return true;
  });

  document.getElementById("codesCountPill").innerText = `${totalCodesCount} items`;

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="10" class="text-center py-4 text-muted">No redeem codes match your current filter.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(c => {
    const status = c.status || "unconfirmed";
    const statusClass = status === "active" ? "badge-active" : (status === "expired" ? "badge-expired" : "badge-unconfirmed");
    const codeType = c.code_type || "redeem";
    const typeClass = codeType === "anniversary" ? "badge-anniversary" : (codeType === "livestream" ? "badge-livestream" : (codeType === "patch" ? "badge-patch" : "badge-redeem"));
    const verifiedCount = Number(c.verified_count || 1);
    const redeemLink = getRedeemUrl(c.game, c.code);

    return `
      <tr>
        <td>${getGameBadge(c.game)}</td>
        <td>
          <div class="code-cell flex-row gap-16">
            <strong class="font-mono">${c.code}</strong>
            <button class="btn-copy" onclick="copyToClipboard('${c.code}')" title="Copy Code">
              📋
            </button>
          </div>
        </td>
        <td><span class="badge-type ${typeClass}">${codeType}</span></td>
        <td><span class="status-badge ${statusClass}">${status}</span></td>
        <td><span class="badge-verified" title="Confirmed by ${verifiedCount} sources">${verifiedCount} src</span></td>
        <td><span class="text-muted font-mono">${c.server || "All"}</span></td>
        <td><span class="font-medium">${c.rewards || "N/A"}</span></td>
        <td><span class="text-muted text-xs">${c.expires_at || "Unknown"}</span></td>
        <td><span class="text-xs text-dim text-truncate" style="max-width:180px; display:inline-block;" title="${c.notes || ''}">${c.notes || '-'}</span></td>
        <td class="text-right">
          <a href="${redeemLink}" target="_blank" class="btn btn-secondary btn-sm" title="Redeem online">
            <span>Redeem</span>
          </a>
        </td>
      </tr>
    `;
  }).join("");

  updatePaginationUI();
}

function updatePaginationUI() {
  const totalPages = Math.ceil(totalCodesCount / pageSize) || 1;
  document.getElementById("paginationInfo").innerText = `Page ${currentPage} of ${totalPages} (${totalCodesCount} total items)`;
  document.getElementById("btnPrevPage").disabled = currentPage <= 1;
  document.getElementById("btnNextPage").disabled = currentPage >= totalPages;
}

document.getElementById("btnPrevPage")?.addEventListener("click", () => {
  if (currentPage > 1) {
    currentPage--;
    loadCodesFeed();
  }
});

document.getElementById("btnNextPage")?.addEventListener("click", () => {
  const totalPages = Math.ceil(totalCodesCount / pageSize) || 1;
  if (currentPage < totalPages) {
    currentPage++;
    loadCodesFeed();
  }
});

// Fetch Codes Feed per game independently
async function loadCodesFeed() {
  setProgressBar("start");
  try {
    const gameParam = currentGameFilter === "all" ? "" : `&game=${currentGameFilter}`;
    const statusParam = currentStatusFilter === "all" ? "" : `&status=${currentStatusFilter}`;
    const offset = (currentPage - 1) * pageSize;

    const res = await fetch(`/api/public/codes?limit=${pageSize}&offset=${offset}${gameParam}${statusParam}`);
    if (res.ok) {
      const data = await res.json();
      cachedCodes = data.data || [];
      totalCodesCount = data.pagination?.total || cachedCodes.length;
      renderCodesTable();
    }
  } catch (err) {
    console.error("Codes feed fetch error:", err);
  } finally {
    setProgressBar("stop");
  }
}

// Fetch Code Counts Breakdown
async function loadCodeCounts() {
  try {
    const res = await fetch("/api/public/codes/count");
    if (res.ok) {
      const data = await res.json();
      const summary = data.data || {};
      document.getElementById("statTotalCodes").innerText = summary.total || 0;
      document.getElementById("statActiveCodes").innerText = summary.active || 0;
    }
  } catch (err) {
    console.error("Counts fetch error:", err);
  }
}

// Render Sources Table & Check Warning Banner
function renderSourcesTable() {
  const tbody = document.getElementById("sourcesTbody");
  if (!tbody) return;

  const okCount = cachedSources.filter(s => s.last_status === 'ok').length;
  document.getElementById("activeSourcesBadge").innerText = `${okCount}/${cachedSources.length}`;
  document.getElementById("statSourcesOk").innerText = `${okCount}/${cachedSources.length}`;

  // Source Health Warning Banner Check
  const failedSources = cachedSources.filter(s => Number(s.consecutive_failures || 0) >= 3);
  const banner = document.getElementById("sourceWarningBanner");
  const bannerText = document.getElementById("warningBannerText");

  if (failedSources.length > 0 && banner && bannerText) {
    const names = failedSources.map(s => `${s.id} (${s.consecutive_failures}x)`).join(", ");
    bannerText.innerText = `⚠️ Warning: ${failedSources.length} source(s) failing consecutively: ${names}. Check scraper page structure.`;
    banner.classList.remove("hidden");
  } else if (banner) {
    banner.classList.add("hidden");
  }

  if (cachedSources.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="text-center py-4 text-muted">No sources initialized yet. Trigger a poll.</td></tr>`;
    return;
  }

  tbody.innerHTML = cachedSources.map(s => {
    const isOk = s.last_status === "ok";
    const failures = Number(s.consecutive_failures || 0);
    const isCircuitBroken = failures >= 5 || Number(s.circuit_breaker_active || 0) === 1;

    let statusBadge = `<span class="status-badge badge-active">HEALTHY</span>`;
    if (isCircuitBroken) {
      statusBadge = `<span class="status-badge badge-unconfirmed" style="background:rgba(245,158,11,0.2); color:#f59e0b;" title="Circuit breaker active. Paused to prevent failure spam.">⚠️ BACKOFF (${failures}x)</span>`;
    } else if (!isOk) {
      statusBadge = `<span class="status-badge badge-expired">ERROR</span>`;
    }

    const httpBadge = s.last_http_status === 200 ? `<span class="text-emerald font-mono font-bold">200 OK</span>` : `<span class="text-rose font-mono font-bold">${s.last_http_status || 'FAIL'}</span>`;
    const lastChecked = s.last_success_at ? new Date(s.last_success_at).toLocaleTimeString() : "-";

    return `
      <tr>
        <td>${getGameBadge(s.game)}</td>
        <td>
          <strong>${s.id}</strong>
          <div class="text-xs text-muted">${s.type}</div>
        </td>
        <td><a href="${s.url}" target="_blank" class="text-xs text-muted font-mono text-truncate" style="max-width:240px; display:inline-block;">${s.url}</a></td>
        <td>${statusBadge}</td>
        <td>${httpBadge}</td>
        <td><strong class="font-mono">${s.last_codes_found || 0}</strong></td>
        <td><span class="${failures >= 3 ? 'text-rose font-bold' : 'text-muted'}">${failures}</span></td>
        <td><span class="text-xs text-muted">${lastChecked}</span></td>
      </tr>
    `;
  }).join("");
}

// Render Logs
function renderLogsTable() {
  const tbody = document.getElementById("logsTbody");
  if (!tbody) return;
  const filterLevel = document.getElementById("logLevelFilter").value;

  let filtered = cachedLogs;
  if (filterLevel !== "all") {
    filtered = cachedLogs.filter(l => l.level === filterLevel);
  }

  document.getElementById("logsCountBadge").innerText = filtered.length;

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-muted">No logs recorded yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(l => {
    const levelClass = l.level === "INFO" ? "log-info" : (l.level === "WARN" ? "log-warn" : "log-error");
    const timestamp = new Date(l.timestamp).toLocaleTimeString();
    const detailsStr = typeof l.details_json === "string" ? l.details_json : JSON.stringify(l.details_json || {});

    return `
      <tr>
        <td>#${l.id}</td>
        <td><span class="text-muted">${timestamp}</span></td>
        <td><span class="${levelClass}">${l.level}</span></td>
        <td><strong>${l.category}</strong></td>
        <td>${l.message}</td>
        <td><span class="text-xs text-muted">${detailsStr}</span></td>
      </tr>
    `;
  }).join("");
}

// Fetch Version from API
async function loadVersion() {
  try {
    const res = await fetch("/api/version");
    if (res.ok) {
      const data = await res.json();
      const verTag = document.querySelector(".version-tag");
      if (verTag) verTag.innerText = `v${data.version || '2.2.0'} • 24/7 Engine`;
    }
  } catch {}
}

let expandedWebhookIndex = null;

function renderWebhooksList() {
  const container = document.getElementById("webhooksListContainer");
  if (!container) return;

  if (cachedWebhooks.length === 0) {
    container.innerHTML = `
      <div class="empty-state-card">
        <div class="empty-state-icon">🔔</div>
        <h4 style="margin:0; font-size:16px; color: var(--text-main);">No Webhooks Configured</h4>
        <p class="text-xs text-muted mt-4">Click <strong>+ Add Webhook</strong> above to connect your first Discord Webhook channel.</p>
      </div>
    `;
    document.getElementById("statWebhooksCount").innerText = "0";
    return;
  }

  container.innerHTML = cachedWebhooks.map((hook, index) => {
    const isExpanded = expandedWebhookIndex === index;
    const collapsedClass = isExpanded ? "" : "collapsed";
    const hookGames = Array.isArray(hook.games) ? hook.games : ["hsr", "genshin", "wuwa", "endfield", "nte"];
    const allGamesChecked = hook.allGames !== false;
    const statusBadge = hook.enabled 
      ? `<span class="status-pill-enabled">ENABLED</span>` 
      : `<span class="status-pill-disabled">DISABLED</span>`;
    
    const gamesBadge = allGamesChecked 
      ? `<span class="badge-type badge-redeem text-xs">All Games</span>` 
      : `<span class="badge-type badge-patch text-xs">${hookGames.length} Game(s)</span>`;

    return `
    <div class="webhook-card-item ${collapsedClass}" data-index="${index}" data-id="${hook.id}">
      <div class="webhook-card-header" onclick="toggleWebhookCard(${index}, event)">
        <div class="webhook-card-title">
          <span class="webhook-card-chevron">▼</span>
          <span>🔔 ${hook.name || `Webhook #${index + 1}`}</span>
        </div>
        <div class="flex-row gap-8 align-center">
          ${gamesBadge}
          ${statusBadge}
        </div>
      </div>

      <div class="webhook-card-body">
        <div class="form-row gap-16">
          <div class="form-group flex-1">
            <label>Webhook Label / Name</label>
            <input type="text" class="input-styled hook-name" value="${hook.name || ''}" placeholder="e.g. #hsr-announcements">
          </div>
          <div class="form-group flex-1">
            <label>Discord Webhook URL</label>
            <input type="url" class="input-styled hook-url" value="${hook.url || ''}" placeholder="https://discord.com/api/webhooks/...">
          </div>
        </div>

        <!-- Game Scope Selection -->
        <div class="form-group mt-12">
          <label class="font-bold text-xs">Target Games for this Webhook:</label>
          <div class="checkbox-group mt-4">
            <label class="checkbox-label text-xs">
              <input type="checkbox" class="hook-all-games" ${allGamesChecked ? 'checked' : ''}> All Games
            </label>
            <label class="checkbox-label text-xs">
              <input type="checkbox" class="hook-game-hsr" ${hookGames.includes('hsr') ? 'checked' : ''}> HSR
            </label>
            <label class="checkbox-label text-xs">
              <input type="checkbox" class="hook-game-genshin" ${hookGames.includes('genshin') ? 'checked' : ''}> Genshin
            </label>
            <label class="checkbox-label text-xs">
              <input type="checkbox" class="hook-game-wuwa" ${hookGames.includes('wuwa') ? 'checked' : ''}> WuWa
            </label>
            <label class="checkbox-label text-xs">
              <input type="checkbox" class="hook-game-endfield" ${hookGames.includes('endfield') ? 'checked' : ''}> Endfield
            </label>
            <label class="checkbox-label text-xs">
              <input type="checkbox" class="hook-game-nte" ${hookGames.includes('nte') ? 'checked' : ''}> NTE
            </label>
          </div>
        </div>

        <!-- Avatar, Username & Auto-Publish Settings -->
        <div class="form-row gap-16 mt-12">
          <div class="form-group flex-1">
            <label>Custom Webhook Username</label>
            <input type="text" class="input-styled hook-username" value="${hook.username || ''}" placeholder="e.g. Honkai Code Relay">
          </div>
          <div class="form-group flex-1">
            <label>Custom Webhook Avatar URL</label>
            <input type="url" class="input-styled hook-avatar" value="${hook.avatarUrl || ''}" placeholder="https://example.com/avatar.png">
          </div>
        </div>

        <div class="form-row gap-16 mt-12">
          <div class="form-group flex-1">
            <label>
              <input type="checkbox" class="hook-autopublish" ${hook.autoPublish ? 'checked' : ''}> Enable Discord Auto-Publish (Announcement Crosspost)
            </label>
            <input type="text" class="input-styled hook-channelid mt-12" value="${hook.channelId || ''}" placeholder="Discord Announcement Channel ID (Required for Auto-Publish)">
            <span class="text-xs text-muted mt-4 block">Klik kanan channel di Discord (aktifkan Developer Mode dulu) &rarr; Copy Channel ID. Harus angka semua.</span>
          </div>
        </div>

        <div class="form-row gap-16 mt-12">
          <div class="form-group flex-1">
            <label>Role IDs to Tag (Comma separated)</label>
            <input type="text" class="input-styled hook-roles" value="${(hook.rolesToTag || []).join(', ')}" placeholder="123456789">
          </div>
          <div class="form-group flex-1">
            <label>User IDs to Tag (Comma separated)</label>
            <input type="text" class="input-styled hook-users" value="${(hook.usersToTag || []).join(', ')}" placeholder="987654321">
          </div>
        </div>

        <div class="form-group mt-12">
          <label>Custom Message Template (Leave blank to use Discord Embed)</label>
          <textarea rows="2" class="textarea-styled font-mono hook-msg" placeholder="Default Discord Embed used if empty...">${hook.customMessage || ''}</textarea>
        </div>

        <div class="flex-between mt-16 pt-12 border-t">
          <label class="text-xs font-bold text-muted flex-row gap-8 align-center">
            <input type="checkbox" class="hook-enabled" ${hook.enabled ? 'checked' : ''}> Webhook Enabled
          </label>

          <div class="flex-row gap-8">
            <button type="button" class="btn btn-secondary btn-sm" onclick="testSingleWebhook(${index})">
              <span>Test Payload</span>
            </button>
            <button type="button" class="btn btn-danger-sm" onclick="deleteSingleWebhook(${index})">
              <span>Delete</span>
            </button>
            <button type="button" class="btn btn-primary btn-sm" onclick="saveSingleWebhook(${index})">
              <span>Save Webhook</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  `;
  }).join("");

  document.getElementById("statWebhooksCount").innerText = cachedWebhooks.filter(w => w.enabled && w.url).length;
}

function toggleWebhookCard(index, event) {
  if (event && (event.target.tagName === 'BUTTON' || event.target.closest('button') || event.target.tagName === 'INPUT')) {
    return;
  }
  expandedWebhookIndex = expandedWebhookIndex === index ? null : index;
  renderWebhooksList();
}

async function addWebhookCard() {
  const newHook = {
    id: "hook-" + Date.now(),
    name: `Webhook #${cachedWebhooks.length + 1}`,
    url: "",
    username: "RedeemRelay Bot",
    avatarUrl: "",
    autoPublish: false,
    channelId: "",
    enabled: true,
    allGames: true,
    games: ["hsr", "genshin", "wuwa", "endfield", "nte"],
    rolesToTag: [],
    usersToTag: [],
    customMessage: ""
  };

  try {
    const res = await fetch("/api/config/webhooks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newHook)
    });
    if (res.ok) {
      const data = await res.json();
      cachedWebhooks.push(data.webhook || newHook);
      expandedWebhookIndex = cachedWebhooks.length - 1;
      renderWebhooksList();
      showToast("success", "Created", "New Webhook card created. Configure details and save!");
    } else {
      showToast("error", "Error", "Failed to create webhook card.");
    }
  } catch (err) {
    showToast("error", "Error", err.message);
  }
}

async function saveSingleWebhook(index) {
  const card = document.querySelector(`.webhook-card-item[data-index="${index}"]`);
  if (!card) return;

  const hookId = cachedWebhooks[index]?.id;
  if (!hookId) return;

  const roles = card.querySelector(".hook-roles").value.split(",").map(s => s.trim()).filter(Boolean);
  const users = card.querySelector(".hook-users").value.split(",").map(s => s.trim()).filter(Boolean);
  const allGames = card.querySelector(".hook-all-games")?.checked !== false;

  const selectedGames = [];
  if (card.querySelector(".hook-game-hsr")?.checked) selectedGames.push("hsr");
  if (card.querySelector(".hook-game-genshin")?.checked) selectedGames.push("genshin");
  if (card.querySelector(".hook-game-wuwa")?.checked) selectedGames.push("wuwa");
  if (card.querySelector(".hook-game-endfield")?.checked) selectedGames.push("endfield");
  if (card.querySelector(".hook-game-nte")?.checked) selectedGames.push("nte");

  const channelId = card.querySelector(".hook-channelid").value.trim();
  if (channelId && !/^\d{17,20}$/.test(channelId)) {
    showToast("error", "Validation Error", "Channel ID format tidak valid. Channel ID harus berupa 17-20 digit angka.");
    return;
  }

  const payload = {
    id: hookId,
    name: card.querySelector(".hook-name").value.trim() || `Webhook #${index + 1}`,
    url: card.querySelector(".hook-url").value.trim(),
    username: card.querySelector(".hook-username").value.trim(),
    avatarUrl: card.querySelector(".hook-avatar").value.trim(),
    autoPublish: card.querySelector(".hook-autopublish").checked,
    channelId,
    enabled: card.querySelector(".hook-enabled").checked,
    allGames,
    games: selectedGames,
    rolesToTag: roles,
    usersToTag: users,
    customMessage: card.querySelector(".hook-msg").value
  };

  try {
    const res = await fetch(`/api/config/webhooks/${hookId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      cachedWebhooks[index] = payload;
      showToast("success", "Saved", `Webhook "${payload.name}" updated successfully!`);
      renderWebhooksList();
    } else {
      showToast("error", "Save Failed", "Failed to update webhook settings.");
    }
  } catch (err) {
    showToast("error", "Error", err.message);
  }
}

async function deleteSingleWebhook(index) {
  const hookId = cachedWebhooks[index]?.id;
  if (!hookId) return;

  if (!confirm(`Are you sure you want to delete Webhook #${index + 1}?`)) return;

  try {
    const res = await fetch(`/api/config/webhooks/${hookId}`, {
      method: "DELETE"
    });
    if (res.ok) {
      cachedWebhooks.splice(index, 1);
      if (expandedWebhookIndex === index) expandedWebhookIndex = null;
      showToast("info", "Deleted", "Webhook deleted successfully.");
      renderWebhooksList();
    } else {
      showToast("error", "Delete Failed", "Failed to delete webhook.");
    }
  } catch (err) {
    showToast("error", "Error", err.message);
  }
}

async function testSingleWebhook(index) {
  const card = document.querySelector(`.webhook-card-item[data-index="${index}"]`);
  const url = card ? card.querySelector(".hook-url")?.value.trim() : cachedWebhooks[index]?.url;
  const username = card ? card.querySelector(".hook-username")?.value.trim() : cachedWebhooks[index]?.username;
  const avatarUrl = card ? card.querySelector(".hook-avatar")?.value.trim() : cachedWebhooks[index]?.avatarUrl;

  if (!url) return showToast("warning", "Missing URL", "Please enter a Discord Webhook URL first.");

  try {
    const res = await fetch("/api/test-webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, username, avatarUrl })
    });
    const data = await res.json();
    if (data.ok) {
      showToast("success", "Webhook Sent", `Test payload delivered successfully!`);
    } else {
      showToast("error", "Webhook Failed", data.error || "Failed to deliver message.");
    }
  } catch (err) {
    showToast("error", "Error", err.message);
  }
}

window.toggleWebhookCard = toggleWebhookCard;
window.saveSingleWebhook = saveSingleWebhook;
window.deleteSingleWebhook = deleteSingleWebhook;
window.testSingleWebhook = testSingleWebhook;
window.copyToClipboard = copyToClipboard;

document.getElementById("btnAddWebhookCard")?.addEventListener("click", addWebhookCard);

// Fetch Logs
async function loadSystemLogs() {
  try {
    const res = await fetch("/api/public/logs?limit=150");
    if (res.ok) {
      const data = await res.json();
      cachedLogs = data.data || [];
      renderLogsTable();
    }
  } catch (err) {
    console.error("Failed to load logs:", err);
  }
}

// Load Dashboard Data (Parallel Execution for Fast Page Load)
async function loadDashboardData() {
  setProgressBar("start");
  try {
    await Promise.allSettled([
      // 1. Config
      fetch("/api/config")
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (!data) return;
          const cfg = data.config;
          document.getElementById("pollSeconds").value = cfg.pollSeconds || 60;
          document.getElementById("discordBotToken").value = cfg.discordBotToken || "";
          if (document.getElementById("defaultMessageTemplate")) {
            document.getElementById("defaultMessageTemplate").value = cfg.defaultMessageTemplate || "";
          }
          cachedWebhooks = cfg.webhooks || [];
          renderWebhooksList();
        })
        .catch(err => console.error("Config fetch error:", err)),

      // 2. Sources Health
      fetch("/api/public/sources")
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (!data) return;
          cachedSources = data.data || [];
          renderSourcesTable();
        })
        .catch(err => console.error("Sources fetch error:", err)),

      // 3. Counts
      loadCodeCounts(),

      // 4. Codes Feed
      loadCodesFeed(),

      // 5. Logs
      loadSystemLogs()
    ]);
  } finally {
    setProgressBar("stop");
  }
}

// Button Spinner Helper
function setButtonLoading(btn, isLoading, defaultText) {
  if (!btn) return;
  const spinner = btn.querySelector(".btn-spinner");
  const label = btn.querySelector("span");
  if (isLoading) {
    if (spinner) spinner.classList.remove("hidden");
    if (label) label.innerText = "Processing...";
    btn.disabled = true;
  } else {
    if (spinner) spinner.classList.add("hidden");
    if (label) label.innerText = defaultText;
    btn.disabled = false;
  }
}

// Global Config Submit Form
document.getElementById("globalConfigForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = document.getElementById("btnSaveGlobalConfig");
  setButtonLoading(btn, true);

  const payload = {
    pollSeconds: parseInt(document.getElementById("pollSeconds").value, 10),
    discordBotToken: document.getElementById("discordBotToken").value.trim(),
    defaultMessageTemplate: document.getElementById("defaultMessageTemplate").value
  };

  try {
    const res = await fetch("/api/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      showToast("success", "Saved", "Global settings saved successfully!");
    } else {
      showToast("error", "Save Failed", "Unauthorized token. Please verify Admin Token.");
    }
  } catch (err) {
    showToast("error", "Error", err.message);
  } finally {
    setButtonLoading(btn, false, "Save Global Settings");
  }
});

// Manual Code Form
document.getElementById("manualCodeForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = document.getElementById("btnManualAdd");
  setButtonLoading(btn, true);

  const game = document.getElementById("manualGame").value;
  const codeType = document.getElementById("manualCodeType").value;
  const code = document.getElementById("manualCode").value.trim();
  const rewards = document.getElementById("manualRewards").value.trim();

  try {
    const res = await fetch("/api/manual-code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ game, code, codeType, rewards })
    });

    if (res.ok) {
      showToast("success", "Code Pushed", `Code <strong>${code}</strong> added to DB!`);
      document.getElementById("manualCode").value = "";
      document.getElementById("manualRewards").value = "";
      loadDashboardData();
    } else {
      showToast("error", "Add Failed", "Invalid input or server error.");
    }
  } catch (err) {
    showToast("error", "Error", err.message);
  } finally {
    setButtonLoading(btn, false, "Push Code");
  }
});

// Force Send Button Handler
document.getElementById("btnForceSend")?.addEventListener("click", async () => {
  const btn = document.getElementById("btnForceSend");
  const game = document.getElementById("forceGameSelect").value;
  const status = document.getElementById("forceStatusSelect").value;

  if (totalCodesCount > 20) {
    const confirmSend = confirm(`⚠️ Mass Force Send Notice:\n\nBroadcasting codes to webhooks includes rate-limit protection (~850ms delay per message) to prevent Discord 429 bans.\n\nDo you want to proceed?`);
    if (!confirmSend) return;
  }

  setButtonLoading(btn, true);
  try {
    const res = await fetch("/api/force-send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ game, status, webhookId: "all" })
    });
    const data = await res.json();
    if (data.ok) {
      if (data.sentCount === 0) {
        showToast("warning", "Force Send Warnings", `0 message(s) delivered out of ${data.totalTargetCodes || 0} code attempt(s). Check system logs for error details.`);
      } else {
        const failText = data.failedCount > 0 ? ` (${data.failedCount} failed)` : "";
        showToast("success", "Force Send Completed", `Broadcasted ${data.sentCount} message(s)${failText}!`);
      }
      loadSystemLogs();
    } else {
      showToast("error", "Force Send Error", data.error || "Failed to execute force send.");
    }
  } catch (err) {
    showToast("error", "Error", err.message);
  } finally {
    setButtonLoading(btn, false, "Force Send Now");
  }
});

// Poll Run Status Helper (Point 13)
async function pollRunStatus(btn) {
  let isDone = false;
  const timer = setInterval(async () => {
    try {
      const res = await fetch("/api/run-status");
      if (res.ok) {
        const data = await res.json();
        const p = data.progress;
        if (p) {
          const label = btn?.querySelector("span");
          if (label) label.innerText = p.message || "Scraping...";

          if (p.phase === "done" || p.phase === "error") {
            clearInterval(timer);
            isDone = true;
            if (p.phase === "done") {
              showToast("success", "Poll Complete", p.message || "Scrape completed successfully!");
            } else {
              showToast("error", "Poll Failed", p.message || "Scrape failed!");
            }
            setButtonLoading(btn, false, "Run Poll Now");
            loadDashboardData();
          }
        }
      }
    } catch {}
  }, 1000);

  setTimeout(() => {
    if (!isDone) {
      clearInterval(timer);
      showToast("warning", "Status Unknown", "Poll status tracking timed out. Check System Logs for details.");
      setButtonLoading(btn, false, "Run Poll Now");
      loadDashboardData();
    }
  }, 60000);
}

// Run Now Button Handler
document.getElementById("runNowBtn")?.addEventListener("click", async () => {
  const btn = document.getElementById("runNowBtn");
  setButtonLoading(btn, true);

  try {
    const res = await fetch("/api/run-now", { method: "POST" });
    if (res.ok) {
      showToast("info", "Poll Started", "Live scrape initialized. Tracking progress...");
      pollRunStatus(btn);
    } else {
      showToast("error", "Poll Failed", "Unauthorized token.");
      setButtonLoading(btn, false, "Run Poll Now");
    }
  } catch (err) {
    showToast("error", "Error", err.message);
    setButtonLoading(btn, false, "Run Poll Now");
  }
});

// Refresh Handlers
document.getElementById("btnRefreshSources")?.addEventListener("click", loadDashboardData);
document.getElementById("btnRefreshLogs")?.addEventListener("click", loadSystemLogs);
document.getElementById("logLevelFilter")?.addEventListener("change", renderLogsTable);

// Modal Controls
const docsModal = document.getElementById("docsModal");
const tokenHelpModal = document.getElementById("tokenHelpModal");

document.getElementById("btnOpenDocs")?.addEventListener("click", () => {
  docsModal?.classList.remove("hidden");
  const contentEl = document.getElementById("docsContent");
  if (contentEl) contentEl.innerText = EMBEDDED_DOCS_MD;
});

document.getElementById("btnCloseDocs")?.addEventListener("click", () => docsModal?.classList.add("hidden"));
document.getElementById("btnHelpToken")?.addEventListener("click", () => tokenHelpModal?.classList.remove("hidden"));
document.getElementById("btnCloseTokenHelp")?.addEventListener("click", () => tokenHelpModal?.classList.add("hidden"));

// Tab Navigation & Mobile Sidebar Handlers
function closeMobileSidebar() {
  document.getElementById("sidebar")?.classList.remove("mobile-open");
  document.getElementById("sidebarBackdrop")?.classList.remove("mobile-open");
}

function initTabNavigation() {
  const navItems = document.querySelectorAll(".nav-item[data-tab]");
  const tabPanes = document.querySelectorAll(".tab-pane");

  navItems.forEach(item => {
    item.addEventListener("click", () => {
      const targetId = item.getAttribute("data-tab");
      if (!targetId) return;

      navItems.forEach(nav => nav.classList.remove("active"));
      item.classList.add("active");

      tabPanes.forEach(pane => {
        if (pane.id === targetId) {
          pane.classList.add("active");
        } else {
          pane.classList.remove("active");
        }
      });

      if (targetId === "logsTab") {
        loadSystemLogs();
      } else if (targetId === "sourcesTab" || targetId === "overviewTab") {
        loadDashboardData();
      }

      closeMobileSidebar();
    });
  });
}

function initMobileSidebar() {
  const toggleBtn = document.getElementById("mobileToggleBtn");
  const closeBtn = document.getElementById("mobileCloseBtn");
  const backdrop = document.getElementById("sidebarBackdrop");
  const sidebar = document.getElementById("sidebar");

  toggleBtn?.addEventListener("click", () => {
    sidebar?.classList.add("mobile-open");
    backdrop?.classList.add("mobile-open");
  });

  closeBtn?.addEventListener("click", closeMobileSidebar);
  backdrop?.addEventListener("click", closeMobileSidebar);
}

// Initial Run
initTabNavigation();
initMobileSidebar();
loadVersion();
loadDashboardData();


