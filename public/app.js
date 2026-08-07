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
let currentSortColumn = null;
let currentSortOrder = "desc";

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





// Filter Pills
document.querySelectorAll("#gameFilter .pill").forEach(pill => {
  pill.addEventListener("click", () => {
    document.querySelectorAll("#gameFilter .pill").forEach(p => p.classList.remove("active"));
    pill.classList.add("active");
    currentGameFilter = pill.getAttribute("data-game");
    currentPage = 1;
    showToast("info", "Filter Applied", `Filtering by game: ${currentGameFilter === "all" ? "All Games" : currentGameFilter.toUpperCase()}...`, 2000);
    loadCodesFeed();
  });
});

document.querySelectorAll("#statusFilter .pill").forEach(pill => {
  pill.addEventListener("click", () => {
    document.querySelectorAll("#statusFilter .pill").forEach(p => p.classList.remove("active"));
    pill.classList.add("active");
    currentStatusFilter = pill.getAttribute("data-status");
    currentPage = 1;
    showToast("info", "Filter Applied", `Filtering by status: ${currentStatusFilter === "all" ? "All Status" : currentStatusFilter}...`, 2000);
    loadCodesFeed();
  });
});

// Debounced Search Input (Server-side search integration)
let searchDebounceTimer = null;
document.getElementById("searchInput")?.addEventListener("input", (e) => {
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => {
    searchQuery = e.target.value.toLowerCase().trim();
    currentPage = 1;
    loadCodesFeed();
  }, 300);
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
    tbody.innerHTML = `<tr><td colspan="11" class="text-center py-4 text-muted">No redeem codes match your current filter.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(c => {
    const status = c.status || "unconfirmed";
    const statusClass = status === "active" ? "badge-active" : (status === "expired" ? "badge-expired" : "badge-unconfirmed");
    const codeType = c.code_type || "redeem";
    const typeClass = codeType === "anniversary" ? "badge-anniversary" : (codeType === "livestream" ? "badge-livestream" : (codeType === "patch" ? "badge-patch" : "badge-redeem"));
    const verifiedCount = Number(c.verified_count || 1);
    const redeemLink = getRedeemUrl(c.game, c.code);

    const firstSeenDate = c.discovered_at || (c.first_seen_at ? c.first_seen_at.split("T")[0] : "-");
    const firstSeenTitle = c.discovered_at ? `Source Discovered: ${c.discovered_at}` : `System Recorded: ${c.first_seen_at || ''}`;

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
        <td class="cell-rewards"><span class="font-medium">${c.rewards || "N/A"}</span></td>
        <td><span class="text-muted text-xs font-mono" title="${firstSeenTitle}">📅 ${firstSeenDate}</span></td>
        <td><span class="text-muted text-xs">${c.expires_at || "Unknown"}</span></td>
        <td class="cell-notes"><span class="text-xs text-dim" title="${c.notes || ''}">${c.notes || '-'}</span></td>
        <td class="text-right">
          <div class="flex-row gap-8 justify-end">
            ${status !== 'expired' ? `
              <button class="btn btn-danger-xs" onclick="markCodeExpired('${c.game}', '${c.code}')" title="Mark this code as expired">
                <span>Expire</span>
              </button>
            ` : ''}
            <a href="${redeemLink}" target="_blank" class="btn btn-secondary btn-sm" title="Redeem online">
              <span>Redeem</span>
            </a>
          </div>
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
    showToast("info", "Loading", `Loading page ${currentPage}...`, 1500);
    loadCodesFeed();
  }
});

document.getElementById("btnNextPage")?.addEventListener("click", () => {
  const totalPages = Math.ceil(totalCodesCount / pageSize) || 1;
  if (currentPage < totalPages) {
    currentPage++;
    showToast("info", "Loading", `Loading page ${currentPage}...`, 1500);
    loadCodesFeed();
  }
});

// Fetch Codes Feed per game independently
async function loadCodesFeed(skipProgressStop = false) {
  setProgressBar("start");
  try {
    const gameParam = currentGameFilter === "all" ? "" : `&game=${currentGameFilter}`;
    const statusParam = currentStatusFilter === "all" ? "" : `&status=${currentStatusFilter}`;
    const searchParam = searchQuery ? `&search=${encodeURIComponent(searchQuery)}` : "";
    const sortParam = currentSortColumn ? `&sort=${currentSortColumn}&order=${currentSortOrder}` : "";
    const offset = (currentPage - 1) * pageSize;

    const res = await fetch(`/api/public/codes?limit=${pageSize}&offset=${offset}${gameParam}${statusParam}${searchParam}${sortParam}`);
    if (res.ok) {
      const data = await res.json();
      cachedCodes = data.data || [];
      totalCodesCount = data.pagination?.total || cachedCodes.length;
      renderCodesTable();
    }
  } catch (err) {
    console.error("Codes feed fetch error:", err);
  } finally {
    if (!skipProgressStop) setProgressBar("stop");
  }
}

// Manual Code Expiration Handler
async function markCodeExpired(game, code) {
  if (!confirm(`Are you sure you want to mark code "${code}" as EXPIRED?`)) return;

  try {
    const res = await fetch("/api/code-status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ game, code, status: "expired" })
    });

    if (res.ok) {
      showToast("success", "Code Expired", `Code <strong>${code}</strong> marked as EXPIRED.`);
      loadCodesFeed();
      loadCodeCounts();
    } else {
      showToast("error", "Update Failed", "Failed to update code status.");
    }
  } catch (err) {
    showToast("error", "Error", err.message);
  }
}
window.markCodeExpired = markCodeExpired;

// Copy All Active Codes Utility
async function copyAllActiveCodes() {
  const game = currentGameFilter === "all" ? "" : currentGameFilter;
  try {
    const res = await fetch(`/api/public/codes/export?game=${game}&status=active`);
    if (res.ok) {
      const text = await res.text();
      if (!text.trim()) {
        showToast("warning", "No Active Codes", "No active codes found in current view.");
        return;
      }
      navigator.clipboard.writeText(text.trim()).then(() => {
        const count = text.trim().split("\n").length;
        const gameLabel = game ? game.toUpperCase() : "All Games";
        showToast("success", "Copied All Active!", `Copied <strong>${count} active codes</strong> (${gameLabel}) to clipboard!`);
      });
    }
  } catch (err) {
    showToast("error", "Export Failed", err.message);
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
        <td class="cell-url"><a href="${s.url}" target="_blank" class="table-link text-truncate" title="${s.url}">${s.url}</a></td>
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
    
    let timestamp = l.timestamp;
    try {
      const d = new Date(l.timestamp);
      if (!isNaN(d.getTime())) {
        const datePart = d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
        const timePart = d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true });
        timestamp = `${datePart}, ${timePart}`;
      }
    } catch {}

    const detailsStr = typeof l.details_json === "string" ? l.details_json : JSON.stringify(l.details_json || {});

    return `
      <tr>
        <td>#${l.id}</td>
        <td><span class="text-muted text-xs font-mono">${timestamp}</span></td>
        <td><span class="${levelClass}">${l.level}</span></td>
        <td><strong>${l.category}</strong></td>
        <td>${l.message}</td>
        <td class="cell-details"><span class="text-xs text-muted text-truncate" title="${detailsStr.replace(/"/g, '&quot;')}">${detailsStr}</span></td>
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
          <label class="font-bold text-xs mb-8 block">Target Games for this Webhook:</label>
          <div class="checkbox-group mt-4 p-4 rounded-lg bg-black/20 border border-border-color">
            <label class="checkbox-label flex items-center gap-2 cursor-pointer select-none">
              <input type="checkbox" class="hook-all-games accent-indigo w-5 h-5 mr-2" ${allGamesChecked ? 'checked' : ''} onchange="handleAllGamesChange(this)"> 
              <span>All Games</span>
            </label>
            
            <label class="checkbox-label flex items-center gap-2 cursor-pointer select-none" style="${allGamesChecked ? 'opacity:0.5;' : ''}">
              <input type="checkbox" class="hook-game-hsr accent-indigo w-5 h-5 mr-2" ${hookGames.includes('hsr') ? 'checked' : ''} ${allGamesChecked ? 'disabled' : ''} onchange="handleGameChange(this)"> 
              <span>HSR</span>
            </label>
            
            <label class="checkbox-label flex items-center gap-2 cursor-pointer select-none" style="${allGamesChecked ? 'opacity:0.5;' : ''}">
              <input type="checkbox" class="hook-game-genshin accent-indigo w-5 h-5 mr-2" ${hookGames.includes('genshin') ? 'checked' : ''} ${allGamesChecked ? 'disabled' : ''} onchange="handleGameChange(this)"> 
              <span>Genshin</span>
            </label>
            
            <label class="checkbox-label flex items-center gap-2 cursor-pointer select-none" style="${allGamesChecked ? 'opacity:0.5;' : ''}">
              <input type="checkbox" class="hook-game-wuwa accent-indigo w-5 h-5 mr-2" ${hookGames.includes('wuwa') ? 'checked' : ''} ${allGamesChecked ? 'disabled' : ''} onchange="handleGameChange(this)"> 
              <span>WuWa</span>
            </label>
            
            <label class="checkbox-label flex items-center gap-2 cursor-pointer select-none" style="${allGamesChecked ? 'opacity:0.5;' : ''}">
              <input type="checkbox" class="hook-game-endfield accent-indigo w-5 h-5 mr-2" ${hookGames.includes('endfield') ? 'checked' : ''} ${allGamesChecked ? 'disabled' : ''} onchange="handleGameChange(this)"> 
              <span>Endfield</span>
            </label>
            
            <label class="checkbox-label flex items-center gap-2 cursor-pointer select-none" style="${allGamesChecked ? 'opacity:0.5;' : ''}">
              <input type="checkbox" class="hook-game-nte accent-indigo w-5 h-5 mr-2" ${hookGames.includes('nte') ? 'checked' : ''} ${allGamesChecked ? 'disabled' : ''} onchange="handleGameChange(this)"> 
              <span>NTE</span>
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

          <div class="flex-row gap-12">
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

// All Games Checkbox Logic
function handleAllGamesChange(checkbox) {
  const card = checkbox.closest('.webhook-card-item');
  if (!card) return;
  
  const gameCheckboxes = card.querySelectorAll('.hook-game-hsr, .hook-game-genshin, .hook-game-wuwa, .hook-game-endfield, .hook-game-nte');
  const isChecked = checkbox.checked;
  
  gameCheckboxes.forEach(cb => {
    cb.disabled = isChecked;
    if (isChecked) {
      cb.checked = false;
      cb.parentElement.style.opacity = '0.5';
    } else {
      cb.parentElement.style.opacity = '1';
    }
  });
  
  if (isChecked) {
    showToast("info", "All Games Selected", "This webhook will trigger for all games. Individual game selection disabled.", 2000);
  } else {
    showToast("info", "Custom Games", "Select specific games for this webhook.", 2000);
  }
}

function handleGameChange(checkbox) {
  const card = checkbox.closest('.webhook-card-item');
  if (!card) return;
  
  const allGamesCheckbox = card.querySelector('.hook-all-games');
  const gameCheckboxes = card.querySelectorAll('.hook-game-hsr, .hook-game-genshin, .hook-game-wuwa, .hook-game-endfield, .hook-game-nte');
  const checkedGames = card.querySelectorAll('.hook-game-hsr:checked, .hook-game-genshin:checked, .hook-game-wuwa:checked, .hook-game-endfield:checked, .hook-game-nte:checked');
  
  // If any game is checked, uncheck All Games
  if (checkbox.checked && allGamesCheckbox) {
    allGamesCheckbox.checked = false;
  }
  
  // Update opacity based on selection
  gameCheckboxes.forEach(cb => {
    cb.parentElement.style.opacity = cb.disabled ? '0.5' : '1';
  });
  
  const gameNames = {
    'hsr': 'HSR',
    'genshin': 'Genshin',
    'wuwa': 'WuWa',
    'endfield': 'Endfield',
    'nte': 'NTE'
  };
  
  const selectedGames = Array.from(checkedGames).map(cb => {
    const className = Array.from(cb.classList).find(c => c.startsWith('hook-game-'));
    return gameNames[className?.replace('hook-game-', '')] || 'Unknown';
  });
  
  if (selectedGames.length > 0) {
    showToast("info", "Games Selected", `Selected: ${selectedGames.join(', ')}`, 2000);
  }
}

// Make functions globally accessible
window.handleAllGamesChange = handleAllGamesChange;
window.handleGameChange = handleGameChange;

function toggleWebhookCard(index, event) {
  if (event && (
    event.target.closest('button') || 
    event.target.closest('input') || 
    event.target.closest('select') || 
    event.target.closest('textarea') || 
    event.target.closest('label') || 
    event.target.closest('a')
  )) {
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
          const pollSec = cfg.pollSeconds || 60;
          document.getElementById("pollSeconds").value = pollSec;
          const lastPollEl = document.getElementById("lastPollTime");
          if (lastPollEl) {
            lastPollEl.innerText = `Polling every ${pollSec}s`;
          }
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
      loadCodesFeed(true),

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
      const lastPollEl = document.getElementById("lastPollTime");
      if (lastPollEl) {
        lastPollEl.innerText = `Polling every ${payload.pollSeconds}s`;
      }
      showToast("success", "Saved", `Global settings saved! Polling dynamic interval updated to ${payload.pollSeconds}s.`);
    } else {
      showToast("error", "Save Failed", "Failed to save global settings.");
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

// Helper: Enforce 10-second cooldown on Run Poll button
function startButtonCooldown(btn, cooldownSec = 10) {
  if (!btn) return;
  btn.disabled = true;
  btn.classList.remove("btn-polling-active");
  btn.classList.add("btn-cooldown");

  const spinner = btn.querySelector(".btn-spinner");
  if (spinner) spinner.classList.add("hidden");

  const label = btn.querySelector("span");
  let remaining = cooldownSec;

  if (label) label.innerText = `Cooldown (${remaining}s)...`;

  const cdTimer = setInterval(() => {
    remaining--;
    if (remaining > 0) {
      if (label) label.innerText = `Cooldown (${remaining}s)...`;
    } else {
      clearInterval(cdTimer);
      btn.disabled = false;
      btn.classList.remove("btn-cooldown");
      btn.classList.remove("btn-polling-active");
      if (label) label.innerText = "Run Poll Now";
    }
  }, 1000);
}

// Poll Run Status Helper with Real-time Progress & 10s Cooldown Safety
async function pollRunStatus(btn) {
  let isDone = false;

  if (btn) {
    btn.disabled = true;
    btn.classList.add("btn-polling-active");
    const spinner = btn.querySelector(".btn-spinner");
    if (spinner) spinner.classList.remove("hidden");
  }

  const timer = setInterval(async () => {
    try {
      const res = await fetch("/api/run-status");
      if (res.ok) {
        const data = await res.json();
        const p = data.progress;
        if (p) {
          const label = btn?.querySelector("span");
          if (label && p.message) {
            label.innerText = p.message;
          }

          if (p.phase === "done" || p.phase === "error") {
            clearInterval(timer);
            isDone = true;

            if (p.phase === "done") {
              showToast("success", "Poll Complete", p.message || "Scrape completed successfully!");
            } else {
              showToast("error", "Poll Failed", p.message || "Scrape failed!");
            }

            loadDashboardData();
            startButtonCooldown(btn, 10);
          }
        }
      }
    } catch {}
  }, 1000);

  setTimeout(() => {
    if (!isDone) {
      clearInterval(timer);
      showToast("warning", "Status Unknown", "Poll status tracking timed out. Check System Logs for details.");
      loadDashboardData();
      startButtonCooldown(btn, 10);
    }
  }, 90000);
}

// Run Now Button Handler
document.getElementById("runNowBtn")?.addEventListener("click", async () => {
  const btn = document.getElementById("runNowBtn");
  if (btn.disabled) return;

  btn.disabled = true;
  btn.classList.add("btn-polling-active");
  const spinner = btn.querySelector(".btn-spinner");
  if (spinner) spinner.classList.remove("hidden");
  const label = btn.querySelector("span");
  if (label) label.innerText = "Starting scrape...";

  try {
    const res = await fetch("/api/run-now", { method: "POST" });
    if (res.ok) {
      showToast("info", "Poll Started", "Live scrape initialized. Tracking progress...");
      pollRunStatus(btn);
    } else {
      showToast("error", "Poll Failed", "Failed to start poll run.");
      startButtonCooldown(btn, 5);
    }
  } catch (err) {
    showToast("error", "Error", err.message);
    startButtonCooldown(btn, 5);
  }
});

// Refresh Handlers
document.getElementById("btnRefreshSources")?.addEventListener("click", () => {
  showToast("info", "Refreshing", "Refreshing dashboard data...", 1500);
  loadDashboardData();
});
document.getElementById("btnRefreshLogs")?.addEventListener("click", () => {
  showToast("info", "Refreshing", "Refreshing system logs...", 1500);
  loadSystemLogs();
});
document.getElementById("logLevelFilter")?.addEventListener("change", renderLogsTable);

// Modal Controls
const docsModal = document.getElementById("docsModal");
const tokenHelpModal = document.getElementById("tokenHelpModal");

document.getElementById("btnOpenDocs")?.addEventListener("click", () => {
  docsModal?.classList.remove("hidden");
  const contentEl = document.getElementById("docsContent");
  if (contentEl) contentEl.innerText = EMBEDDED_DOCS_MD;
  showToast("info", "Documentation", "API Documentation opened", 1500);
});

document.getElementById("btnCloseDocs")?.addEventListener("click", () => docsModal?.classList.add("hidden"));

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

function initKeyboardShortcuts() {
  document.addEventListener("keydown", (e) => {
    if (e.key === "/" && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") {
      e.preventDefault();
      const input = document.getElementById("searchInput");
      if (input) input.focus();
    } else if (e.key === "Escape") {
      document.querySelectorAll(".modal-overlay:not(.hidden)").forEach(m => m.classList.add("hidden"));
    }
  });
}

function initTableSorting() {
  const headers = document.querySelectorAll("#codesTable th.sortable");
  headers.forEach(th => {
    th.addEventListener("click", () => {
      const col = th.getAttribute("data-sort");
      if (!col) return;

      if (currentSortColumn === col) {
        currentSortOrder = currentSortOrder === "asc" ? "desc" : "asc";
      } else {
        currentSortColumn = col;
        currentSortOrder = "desc";
      }

      // Update UI Header classes and sort icons
      headers.forEach(h => {
        h.classList.remove("sort-active");
        const icon = h.querySelector(".sort-icon");
        if (icon) icon.innerText = "↕";
      });

      th.classList.add("sort-active");
      const activeIcon = th.querySelector(".sort-icon");
      if (activeIcon) {
        activeIcon.innerText = currentSortOrder === "asc" ? "▲" : "▼";
      }

      currentPage = 1;
      showToast("info", "Sorting", `Sorting by ${col.toUpperCase()} (${currentSortOrder.toUpperCase()})...`, 1200);
      loadCodesFeed();
    });
  });
}

function initSidebarCollapse() {
  const btn = document.getElementById("btnToggleSidebarCollapse");
  if (!btn) return;

  const isCollapsed = localStorage.getItem("sidebar_collapsed") === "true";
  if (isCollapsed) {
    document.body.classList.add("sidebar-collapsed");
  }

  btn.addEventListener("click", () => {
    document.body.classList.toggle("sidebar-collapsed");
    const collapsedNow = document.body.classList.contains("sidebar-collapsed");
    localStorage.setItem("sidebar_collapsed", String(collapsedNow));
    showToast("info", "Sidebar", collapsedNow ? "Sidebar collapsed for extra canvas width" : "Sidebar expanded", 1200);
  });
}

async function checkActivePollStateOnLoad() {
  const btn = document.getElementById("runNowBtn");
  try {
    const res = await fetch("/api/run-status");
    if (res.ok) {
      const data = await res.json();
      if (data.isPolling && btn) {
        pollRunStatus(btn);
      }
    }
  } catch {}
}

// Initial Run
document.addEventListener('DOMContentLoaded', () => {
  console.log('Dashboard initialized with event handlers');
  initTabNavigation();
  initMobileSidebar();
  initSidebarCollapse();
  initTableSorting();
  initKeyboardShortcuts();
  loadVersion();
  loadDashboardData();
  checkActivePollStateOnLoad();
  
  document.getElementById("btnCopyAllActive")?.addEventListener("click", copyAllActiveCodes);
});

