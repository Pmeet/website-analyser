"use strict";

// ── Helpers ─────────────────────────────────────────────────────────────────
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const store = {
  get(k) {
    try { return localStorage.getItem(k); } catch { return null; }
  },
  set(k, v) {
    try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* storage unavailable */ }
  },
};

async function api(path, opts = {}) {
  const token = store.get("wa-token");
  const res = await fetch(path, {
    ...opts,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...(opts.headers || {}) },
  });
  if (res.status === 401) {
    await askToken();
    return api(path, opts);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function askToken() {
  return new Promise((resolve) => {
    const dlg = $("#token-dialog");
    $("#token-form").onsubmit = () => {
      store.set("wa-token", $("#token-input").value.trim());
      resolve();
    };
    if (!dlg.open) dlg.showModal();
  });
}

function withToken(url) {
  const token = store.get("wa-token");
  return token ? `${url}${url.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}` : url;
}

const scoreClass = (n) => (n === null || n === undefined ? "" : n >= 90 ? "good" : n >= 50 ? "ok" : "bad");
const gradeClass = (g) => (!g ? "" : /^A/.test(g) ? "good" : /^[BC]/.test(g) ? "ok" : "bad");

// ── Tabs ────────────────────────────────────────────────────────────────────
function showTab(name) {
  $$(".tabs button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === name)));
  $$(".tab").forEach((t) => (t.hidden = t.id !== `tab-${name}`));
  store.set("wa-tab", name);
  if (name === "batch") loadBatches();
  if (name === "settings") loadSettings();
}
$$(".tabs button").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));

document.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-copy]");
  if (!btn) return;
  navigator.clipboard.writeText($(`#${btn.dataset.copy}`).textContent).then(() => {
    const old = btn.textContent;
    btn.textContent = "Copied";
    setTimeout(() => (btn.textContent = old), 1200);
  });
});

// ── Analyse ─────────────────────────────────────────────────────────────────
let lastResult = null;

$("#analyze-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const url = $("#analyze-url").value.trim();
  if (!url) return;
  const button = $("#analyze-form button");
  const status = $("#analyze-status");
  const fast = $("#analyze-fast").checked;
  button.disabled = true;
  status.hidden = false;
  status.innerHTML = `<span class="spinner"></span>Analysing ${esc(url)}… ${fast ? "" : "PageSpeed usually takes 10–30s."}`;
  try {
    const data = await api("/api/analyze", { method: "POST", body: JSON.stringify({ url, skipPagespeed: fast }) });
    renderResult(data);
    status.hidden = true;
  } catch (err) {
    status.textContent = `Error: ${err.message}`;
  } finally {
    button.disabled = false;
  }
});

function renderResult({ result, report, fullReport }) {
  lastResult = result;
  $("#analyze-result").hidden = false;
  $("#report-short").textContent = report;
  $("#report-full").textContent = fullReport;

  const s = result.scores;
  const tiles = [
    ["Performance", s.performance, scoreClass(s.performance)],
    ["SEO", s.seo, scoreClass(s.seo)],
    ["Security", result.security ? s.security.grade : null, gradeClass(result.security && s.security.grade)],
    ["Email", result.email ? s.email : null, scoreClass(result.email ? s.email : null)],
    ["Accessibility", s.accessibility, scoreClass(s.accessibility)],
    ["Overall", s.overall, scoreClass(s.overall)],
  ];
  $("#score-tiles").innerHTML = tiles
    .map(([k, v, cls]) => `<div class="tile"><div class="v ${cls}">${v === null || v === undefined ? "–" : esc(v)}</div><div class="k">${esc(k)}</div></div>`)
    .join("");

  $("#stack-chips").innerHTML = result.stack.length
    ? result.stack.map((t) => `<span class="chip" title="${esc(t.categories.join(", "))}">${esc(t.name)}${t.version ? ` <small>${esc(t.version)}</small>` : ""}</span>`).join("")
    : '<span class="muted">Nothing detected</span>';

  $("#findings").innerHTML = result.findings.length
    ? result.findings
        .map(
          (f) => `<li><span class="sev ${f.severity}">${f.severity}</span><div>${esc(f.title)}${f.detail ? `<details><summary>details</summary>${esc(f.detail)}</details>` : ""}</div><span class="cat">${esc(f.category)}</span></li>`,
        )
        .join("")
    : '<li class="muted">No issues found.</li>';
}

$("#download-json").addEventListener("click", () => {
  if (!lastResult) return;
  const blob = new Blob([JSON.stringify(lastResult, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${lastResult.host}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});

// ── Batch ───────────────────────────────────────────────────────────────────
let currentBatch = null;
let pollTimer = null;
let clientRunner = null;

const countUrls = (text) => text.split(/[\s,;]+/).filter((s) => s.includes(".")).length;
$("#batch-urls").addEventListener("input", (e) => ($("#batch-count").textContent = `${countUrls(e.target.value)} URLs`));

$("#batch-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const button = $("#batch-form button[type=submit]");
  button.disabled = true;
  try {
    const data = await api("/api/batches", { method: "POST", body: JSON.stringify({ name: $("#batch-name").value, urls: $("#batch-urls").value }) });
    $("#batch-urls").value = "";
    $("#batch-count").textContent = data.invalid.length ? `Skipped invalid: ${data.invalid.join(", ")}` : "0 URLs";
    openBatch(data.id);
    loadBatches();
  } catch (err) {
    alert(err.message);
  } finally {
    button.disabled = false;
  }
});

async function loadBatches() {
  try {
    const { batches } = await api("/api/batches");
    $("#batch-list").innerHTML = batches.length
      ? batches
          .map(
            (b) => `<li><a href="#" data-batch="${esc(b.id)}">${esc(b.name || b.id.slice(0, 8))}</a><span class="muted">${esc(b.finished)}/${esc(b.total)} · ${esc(b.created_at)} UTC</span></li>`,
          )
          .join("")
      : '<li class="muted">No batches yet.</li>';
  } catch (err) {
    $("#batch-list").innerHTML = `<li class="muted">${esc(err.message)}</li>`;
  }
}

$("#batch-list").addEventListener("click", (e) => {
  const a = e.target.closest("[data-batch]");
  if (!a) return;
  e.preventDefault();
  openBatch(a.dataset.batch);
});

function openBatch(id) {
  currentBatch = id;
  clearTimeout(pollTimer);
  $("#batch-view").hidden = false;
  for (const fmt of ["csv", "txt", "json"]) $(`#export-${fmt}`).href = withToken(`/api/batches/${id}/export?format=${fmt}`);
  pollBatch();
}

async function pollBatch() {
  if (!currentBatch) return;
  const id = currentBatch;
  try {
    const data = await api(`/api/batches/${id}`);
    if (id !== currentBatch) return;
    renderBatch(data);
    const unfinished = data.counts.pending + data.counts.running;
    if (data.batch.mode === "client" && data.counts.pending) runClientSide(data);
    if (unfinished) pollTimer = setTimeout(pollBatch, 4000);
  } catch (err) {
    $("#batch-summary").textContent = err.message;
  }
}

function renderBatch({ batch, counts, items }) {
  const total = items.length || 1;
  const finished = counts.done + counts.error;
  $("#batch-title").textContent = batch.name || `Batch ${batch.id.slice(0, 8)}`;
  $("#batch-progress").style.width = `${Math.round((finished / total) * 100)}%`;
  $("#batch-summary").textContent =
    `${finished}/${items.length} finished · ${counts.done} done · ${counts.error} failed · ${counts.running} running · ${counts.pending} queued` +
    (batch.mode === "client" ? " · running in this browser tab (no Queue binding) — keep it open" : "");
  $("#batch-rows").innerHTML = items
    .map(
      (it) => `<tr>
        <td><a href="#" data-item-url="${esc(it.url)}">${esc(it.domain || it.url)}</a></td>
        <td><span class="status ${it.status}">${esc(it.status)}</span>${it.error ? `<div class="muted small">${esc(it.error.slice(0, 120))}</div>` : ""}</td>
        <td>${esc(it.stack || "")}</td>
        <td class="${scoreClass(it.performance)}">${it.performance ?? "–"}</td>
        <td class="${scoreClass(it.seo)}">${it.seo ?? "–"}</td>
        <td class="${gradeClass(it.security_grade)}">${esc(it.security_grade || "–")}</td>
        <td>${it.email_ok === null ? "–" : it.email_ok ? "OK" : '<span class="bad">gaps</span>'}</td>
        <td>${esc([it.contact_email, it.contact_phone].filter(Boolean).join(" · "))}</td>
        <td class="hook">${esc(it.hook || "")}</td>
      </tr>`,
    )
    .join("");
}

$("#batch-rows").addEventListener("click", (e) => {
  const a = e.target.closest("[data-item-url]");
  if (!a) return;
  e.preventDefault();
  $("#analyze-url").value = a.dataset.itemUrl;
  showTab("analyze");
});

$("#batch-retry").addEventListener("click", async () => {
  if (!currentBatch) return;
  await api(`/api/batches/${currentBatch}/retry`, { method: "POST" });
  pollBatch();
});

/** Fallback when the Worker has no Queue binding: this tab works through pending items, 2 at a time. */
function runClientSide(data) {
  if (clientRunner === data.batch.id) return;
  clientRunner = data.batch.id;
  const pending = data.items.filter((i) => i.status === "pending").map((i) => i.id);
  const worker = async () => {
    while (pending.length && clientRunner === data.batch.id) {
      const itemId = pending.shift();
      try {
        await api(`/api/batches/${data.batch.id}/items/${itemId}/run`, { method: "POST" });
      } catch { /* the item row records the error */ }
    }
  };
  Promise.all([worker(), worker()]).finally(() => {
    if (clientRunner === data.batch.id) clientRunner = null;
    pollBatch();
  });
}

// ── Settings ────────────────────────────────────────────────────────────────
let presets = [];
let defaultModels = {};

function getPath(obj, path) {
  return path.split(".").reduce((o, k) => (o ? o[k] : undefined), obj);
}
function setPath(obj, path, value) {
  const keys = path.split(".");
  const last = keys.pop();
  const target = keys.reduce((o, k) => (o[k] ??= {}), obj);
  target[last] = value;
}

async function loadSettings() {
  try {
    const data = await api("/api/settings");
    presets = data.presets;
    defaultModels = data.defaultModels;
    $("#ai-preset").innerHTML = presets.map((p) => `<option value="${esc(p.id)}">${esc(p.label)}</option>`).join("");
    for (const el of $$("#settings-form [name]")) {
      const v = getPath(data.settings, el.name);
      if (el.type === "checkbox") el.checked = Boolean(v);
      else el.value = v ?? "";
    }
    const meta = data.settings.meta;
    $("#psi-env-note").textContent = meta.pagespeedKeyFromEnv ? "A key is also set via the PAGESPEED_API_KEY secret (used when this field is empty)." : "";
    $("#env-status").innerHTML = [
      ["Access token", meta.accessTokenSet ? "set" : "NOT SET — anyone with the URL can use this tool and your API keys"],
      ["Batch queue", meta.queueAvailable ? "Cloudflare Queue bound" : "no Queue binding — batches run from the browser tab"],
      ["Browser Rendering", meta.browserRendering ? "enabled for JS-heavy / blocked sites" : "off (set CF_ACCOUNT_ID + CF_API_TOKEN to enable)"],
      ["Workers AI", meta.workersAiAvailable ? "AI binding available" : "no AI binding"],
    ]
      .map(([k, v]) => `<li><span>${esc(k)}</span><span class="muted">${esc(v)}</span></li>`)
      .join("");
    if (!$("#ai-preset").value && presets.length) $("#ai-preset").value = presets[0].id;
    updateAiFields();
  } catch (err) {
    $("#settings-status").textContent = err.message;
  }
}

function updateAiFields() {
  const provider = $('[name="ai.provider"]').value;
  $$("[data-ai]").forEach((el) => (el.hidden = !el.dataset.ai.split(" ").includes(provider)));
  const preset = presets.find((p) => p.id === $("#ai-preset").value);
  let hint = "";
  if (provider === "openai-compatible" && preset) {
    $("#ai-model").placeholder = preset.modelHint || "model name";
    $("#ai-baseurl").placeholder = preset.baseUrl || "https://api.example.com/v1";
    if (preset.keyUrl) hint = `Get a key: <a href="${esc(preset.keyUrl)}" target="_blank" rel="noopener">${esc(preset.keyUrl)}</a>. Model names change often — check your provider's list.`;
  } else if (provider === "anthropic") {
    $("#ai-model").placeholder = defaultModels.anthropic;
    hint = `Leave model blank for ${esc(defaultModels.anthropic)}; use claude-haiku-4-5 for the cheapest option. Keys: <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">console.anthropic.com</a>.`;
  } else if (provider === "workers-ai") {
    $("#ai-model").placeholder = defaultModels["workers-ai"];
    hint = "Requires the [ai] binding in wrangler.toml. Free daily allowance on Cloudflare.";
  }
  $("#ai-hint").innerHTML = hint;
}

$('[name="ai.provider"]').addEventListener("change", updateAiFields);
$("#ai-preset").addEventListener("change", () => {
  const preset = presets.find((p) => p.id === $("#ai-preset").value);
  if (preset?.baseUrl) $("#ai-baseurl").value = preset.baseUrl;
  updateAiFields();
});

function collectSettings() {
  const out = {};
  for (const el of $$("#settings-form [name]")) {
    const v = el.type === "checkbox" ? el.checked : el.type === "number" ? Number(el.value) : el.value.trim();
    setPath(out, el.name, v);
  }
  return out;
}

$("#settings-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const status = $("#settings-status");
  status.textContent = "Saving…";
  try {
    await api("/api/settings", { method: "PUT", body: JSON.stringify(collectSettings()) });
    status.textContent = "Saved.";
    loadSettings();
  } catch (err) {
    status.textContent = `Error: ${err.message}`;
  }
});

$("#test-ai").addEventListener("click", async () => {
  const status = $("#settings-status");
  status.textContent = "Saving and testing…";
  try {
    await api("/api/settings", { method: "PUT", body: JSON.stringify(collectSettings()) });
    const r = await api("/api/settings/test-ai", { method: "POST" });
    status.textContent = `✓ ${r.provider} replied "${r.reply}" in ${r.ms}ms`;
  } catch (err) {
    status.textContent = `✗ ${err.message}`;
  }
});

// ── Boot ────────────────────────────────────────────────────────────────────
(async function boot() {
  showTab(store.get("wa-tab") || "analyze");
  try {
    const { settings } = await api("/api/settings");
    if (!settings.meta.accessTokenSet && !/^(localhost|127\.)/.test(location.hostname)) {
      const banner = $("#banner");
      banner.hidden = false;
      banner.textContent = "No ACCESS_TOKEN is set — anyone with this URL can run analyses with your API keys. Run: npx wrangler secret put ACCESS_TOKEN";
    }
  } catch { /* shown elsewhere */ }
})();
