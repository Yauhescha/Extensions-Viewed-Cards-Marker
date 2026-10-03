const EXT = typeof browser !== 'undefined' ? browser : chrome;

const STORAGE_KEYS = {
  settings: 'vcm_settings_v1',
  history: 'vcm_history_v1',
  ui: 'vcm_ui_v1',
  recovery: 'vcm_recovery_v1'
};

const DEFAULTS = {
  settings: {
    schemaVersion: 1,
    sites: [],
    sync: {
      provider: 'none',
      supabaseUrl: '',
      supabaseAnonKey: '',
      historyTable: 'viewed_history',
      sitesTable: 'site_configs'
    }
  },
  history: {
    schemaVersion: 1,
    items: []
  },
  ui: {
    autoApplyCurrentSite: true
  }
};

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function nowIso() {
  return new Date().toISOString();
}

function promisifyChrome(fn, ctx, ...args) {
  return new Promise((resolve, reject) => {
    try {
      fn.call(ctx, ...args, (result) => {
        const err = chrome.runtime && chrome.runtime.lastError;
        if (err) reject(new Error(err.message));
        else resolve(result);
      });
    } catch (e) {
      reject(e);
    }
  });
}

const storageLocal = {
  async get(keys) {
    if (EXT.storage?.local?.get.length === 1) return EXT.storage.local.get(keys);
    return promisifyChrome(EXT.storage.local.get, EXT.storage.local, keys);
  },
  async set(values) {
    if (EXT.storage?.local?.set.length === 1) return EXT.storage.local.set(values);
    return promisifyChrome(EXT.storage.local.set, EXT.storage.local, values);
  }
};

const tabsApi = {
  async query(queryInfo) {
    if (EXT.tabs?.query.length === 1) return EXT.tabs.query(queryInfo);
    return promisifyChrome(EXT.tabs.query, EXT.tabs, queryInfo);
  },
  async sendMessage(tabId, msg) {
    if (EXT.tabs?.sendMessage.length <= 2) return EXT.tabs.sendMessage(tabId, msg);
    return promisifyChrome(EXT.tabs.sendMessage, EXT.tabs, tabId, msg);
  }
};

const permissionsApi = {
  async contains(perm) {
    if (!EXT.permissions) return true;
    if (EXT.permissions.contains.length === 1) return EXT.permissions.contains(perm);
    return promisifyChrome(EXT.permissions.contains, EXT.permissions, perm);
  },
  async request(perm) {
    if (!EXT.permissions) return true;
    if (EXT.permissions.request.length === 1) return EXT.permissions.request(perm);
    return promisifyChrome(EXT.permissions.request, EXT.permissions, perm);
  }
};

function normalizeSettings(raw) {
  const base = deepClone(DEFAULTS.settings);
  const settings = raw && typeof raw === 'object' ? raw : {};
  base.sync = Object.assign(base.sync, settings.sync || {});
  base.sites = Array.isArray(settings.sites) ? settings.sites.map(normalizeSiteConfig).filter(Boolean) : [];
  return base;
}

function normalizeHistory(raw) {
  const base = deepClone(DEFAULTS.history);
  const items = Array.isArray(raw?.items) ? raw.items : [];
  base.items = items.map(normalizeHistoryItem).filter(Boolean);
  return dedupeHistory(base);
}

function normalizeSiteConfig(site) {
  if (!site || typeof site !== 'object') return null;
  const id = String(site.id || '').trim() || `site_${Math.random().toString(36).slice(2, 10)}`;
  const hostPatterns = Array.isArray(site.hostPatterns) ? site.hostPatterns.map(String).map(s => s.trim()).filter(Boolean) : [];
  return {
    id,
    name: String(site.name || id),
    enabled: site.enabled !== false,
    hostPatterns,
    viewPagePatterns: Array.isArray(site.viewPagePatterns) ? site.viewPagePatterns.map(String).filter(Boolean) : [],
    listPagePatterns: Array.isArray(site.listPagePatterns) ? site.listPagePatterns.map(String).filter(Boolean) : [],
    cardSelector: String(site.cardSelector || ''),
    linkSelector: String(site.linkSelector || ''),
    titleSelector: String(site.titleSelector || ''),
    viewPageTitleSelector: String(site.viewPageTitleSelector || ''),
    titleSource: ['selector', 'documentTitle', 'linkText'].includes(site.titleSource) ? site.titleSource : 'selector',
    titleTransforms: Array.isArray(site.titleTransforms) ? site.titleTransforms.map(normalizeTransform).filter(Boolean) : [],
    keyStrategy: ['normalizedTitle', 'urlPathRegex', 'customTemplate'].includes(site.keyStrategy) ? site.keyStrategy : 'normalizedTitle',
    keyRegex: String(site.keyRegex || ''),
    keyTemplate: String(site.keyTemplate || '{{normalizedTitle}}'),
    delayMs: Number.isFinite(Number(site.delayMs)) ? Number(site.delayMs) : 0,
    highlightMode: ['cardClass', 'linkClass'].includes(site.highlightMode) ? site.highlightMode : 'cardClass',
    highlightClass: String(site.highlightClass || ''),
    actionButtons: Array.isArray(site.actionButtons) ? site.actionButtons.map(normalizeButton).filter(Boolean) : [{
      id: 'toggle-viewed',
      textViewed: 'Viewed',
      textUnviewed: 'Mark',
      position: 'insideCardBottom',
      action: 'toggleViewed'
    }],
    pageActions: Array.isArray(site.pageActions) ? site.pageActions.map(normalizePageAction).filter(Boolean) : [],
    autoMarkOnViewPage: site.autoMarkOnViewPage !== false,
    autoApplyOnListPage: site.autoApplyOnListPage !== false,
    updatedAt: String(site.updatedAt || nowIso())
  };
}

function normalizeTransform(t) {
  if (!t || typeof t !== 'object') return null;
  return {
    type: ['regexReplace', 'trim', 'lowercase'].includes(t.type) ? t.type : 'trim',
    pattern: String(t.pattern || ''),
    flags: String(t.flags || ''),
    replacement: String(t.replacement || '')
  };
}

function normalizeButton(btn) {
  if (!btn || typeof btn !== 'object') return null;
  return {
    id: String(btn.id || `btn_${Math.random().toString(36).slice(2, 8)}`),
    textViewed: String(btn.textViewed || 'Viewed'),
    textUnviewed: String(btn.textUnviewed || 'Mark'),
    position: ['afterLink', 'insideCardBottom'].includes(btn.position) ? btn.position : 'insideCardBottom',
    action: 'toggleViewed'
  };
}

function normalizePageAction(action) {
  if (!action || typeof action !== 'object') return null;
  return {
    type: ['dispatchEvent', 'click', 'addClass', 'setAttribute'].includes(action.type) ? action.type : 'dispatchEvent',
    selector: String(action.selector || ''),
    eventName: String(action.eventName || 'mouseover'),
    className: String(action.className || ''),
    attrName: String(action.attrName || ''),
    attrValue: String(action.attrValue || ''),
    delayMs: Number.isFinite(Number(action.delayMs)) ? Number(action.delayMs) : 0
  };
}

function normalizeHistoryItem(item) {
  if (!item || typeof item !== 'object') return null;
  const siteId = String(item.siteId || '').trim();
  const key = String(item.key || '').trim();
  if (!siteId || !key) return null;
  return {
    siteId,
    key,
    url: String(item.url || ''),
    titleRaw: String(item.titleRaw || ''),
    titleNormalized: String(item.titleNormalized || ''),
    createdAt: String(item.createdAt || nowIso()),
    updatedAt: String(item.updatedAt || item.createdAt || nowIso()),
    source: String(item.source || 'auto')
  };
}

function dedupeHistory(history) {
  const map = new Map();
  for (const item of history.items) {
    const uniq = `${item.siteId}::${item.key}`;
    const existing = map.get(uniq);
    if (!existing || String(item.updatedAt) > String(existing.updatedAt)) {
      map.set(uniq, item);
    }
  }
  history.items = Array.from(map.values()).sort((a, b) => String(a.updatedAt).localeCompare(String(b.updatedAt)));
  return history;
}

async function getSettings() {
  const raw = await storageLocal.get(STORAGE_KEYS.settings);
  return normalizeSettings(raw[STORAGE_KEYS.settings] || DEFAULTS.settings);
}

async function setSettings(settings) {
  const normalized = normalizeSettings(settings);
  await storageLocal.set({ [STORAGE_KEYS.settings]: normalized });
  return normalized;
}

async function getHistory() {
  const raw = await storageLocal.get(STORAGE_KEYS.history);
  return normalizeHistory(raw[STORAGE_KEYS.history] || DEFAULTS.history);
}

async function setHistory(history) {
  const normalized = normalizeHistory(history);
  await storageLocal.set({ [STORAGE_KEYS.history]: normalized });
  return normalized;
}

async function getUi() {
  const raw = await storageLocal.get(STORAGE_KEYS.ui);
  return Object.assign({}, DEFAULTS.ui, raw[STORAGE_KEYS.ui] || {});
}

async function setUi(ui) {
  const next = Object.assign({}, DEFAULTS.ui, ui || {});
  await storageLocal.set({ [STORAGE_KEYS.ui]: next });
  return next;
}


const RECOVERY_BATCH_SIZE = 200;
const RECOVERY_EXPORT_PART_SIZE = 500;

function defaultRecoveryState() {
  return {
    schemaVersion: 1,
    nextOffset: 0,
    uploaded: 0,
    totalAtStart: 0,
    startedAt: '',
    updatedAt: '',
    completedAt: '',
    lastError: '',
    sitesUploaded: false
  };
}

async function getRecoveryState() {
  const raw = await storageLocal.get(STORAGE_KEYS.recovery);
  return Object.assign(defaultRecoveryState(), raw[STORAGE_KEYS.recovery] || {});
}

async function setRecoveryState(next) {
  const state = Object.assign(defaultRecoveryState(), next || {}, { updatedAt: nowIso() });
  await storageLocal.set({ [STORAGE_KEYS.recovery]: state });
  return state;
}

async function getRawHistoryContainer() {
  const raw = await storageLocal.get(STORAGE_KEYS.history);
  const container = raw[STORAGE_KEYS.history];
  if (!container || typeof container !== 'object') return { schemaVersion: 1, items: [] };
  return {
    schemaVersion: Number(container.schemaVersion || 1),
    items: Array.isArray(container.items) ? container.items : []
  };
}

function makeSupabaseConfig(settings) {
  const sync = settings?.sync || {};
  if (sync.provider !== 'supabase') return { ok: false, reason: 'sync_disabled' };
  if (!sync.supabaseUrl || !sync.supabaseAnonKey) return { ok: false, reason: 'missing_supabase_settings' };
  return {
    ok: true,
    sync,
    baseUrl: sync.supabaseUrl.replace(/\/$/, ''),
    headers: {
      apikey: sync.supabaseAnonKey,
      Authorization: `Bearer ${sync.supabaseAnonKey}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal'
    }
  };
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchWithRetry(url, options, attempts = 4) {
  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const res = await fetch(url, options);
      if (res.ok) return res;
      const details = await safeReadText(res);
      const error = new Error(`HTTP ${res.status}${details ? `: ${details}` : ''}`);
      error.status = res.status;
      // Do not blindly retry normal client/auth/schema errors.
      if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) throw error;
      lastError = error;
    } catch (e) {
      lastError = e;
      if (e?.status >= 400 && e?.status < 500 && e?.status !== 408 && e?.status !== 429) throw e;
    }
    if (attempt < attempts - 1) await delay([500, 1200, 2500][Math.min(attempt, 2)]);
  }
  throw lastError || new Error('Network request failed');
}

function historyItemToRow(item) {
  const normalized = normalizeHistoryItem(item);
  if (!normalized) return null;
  return {
    site_id: normalized.siteId,
    item_key: normalized.key,
    url: normalized.url,
    title_raw: normalized.titleRaw,
    title_normalized: normalized.titleNormalized,
    created_at: normalized.createdAt,
    updated_at: normalized.updatedAt,
    source: normalized.source
  };
}

async function uploadRecoverySites(settings, cfg) {
  const payload = (settings.sites || []).map(site => ({
    site_id: site.id,
    name: site.name,
    updated_at: site.updatedAt,
    config_json: site
  }));
  if (!payload.length) return;
  await fetchWithRetry(`${cfg.baseUrl}/rest/v1/${encodeURIComponent(cfg.sync.sitesTable)}?on_conflict=site_id`, {
    method: 'POST',
    headers: cfg.headers,
    body: JSON.stringify(payload)
  });
}

async function getRemoteHistoryCount(cfg) {
  try {
    const headers = Object.assign({}, cfg.headers, {
      Prefer: 'count=exact',
      Range: '0-0'
    });
    delete headers['Content-Type'];
    const res = await fetch(`${cfg.baseUrl}/rest/v1/${encodeURIComponent(cfg.sync.historyTable)}?select=site_id`, { headers });
    if (!res.ok) return null;
    const range = res.headers.get('content-range') || '';
    const match = range.match(/\/(\d+|\*)$/);
    return match && match[1] !== '*' ? Number(match[1]) : null;
  } catch {
    return null;
  }
}

async function getRecoveryInfo() {
  const rawHistory = await getRawHistoryContainer();
  const state = await getRecoveryState();
  let approxBytes = 0;
  try {
    const sample = rawHistory.items.slice(0, Math.min(50, rawHistory.items.length));
    const sampleBytes = sample.length ? JSON.stringify(sample).length : 0;
    approxBytes = sample.length ? Math.round((sampleBytes / sample.length) * rawHistory.items.length) : 0;
  } catch {}
  return {
    ok: true,
    localCount: rawHistory.items.length,
    approximateBytes: approxBytes,
    batchSize: RECOVERY_BATCH_SIZE,
    exportPartSize: RECOVERY_EXPORT_PART_SIZE,
    state
  };
}

async function resetRecoveryCheckpoint() {
  const state = await setRecoveryState(defaultRecoveryState());
  return { ok: true, state };
}

async function recoverySyncBatch() {
  const settings = await getSettings();
  const cfg = makeSupabaseConfig(settings);
  if (!cfg.ok) return cfg;

  const rawHistory = await getRawHistoryContainer();
  const total = rawHistory.items.length;
  let state = await getRecoveryState();

  if (!state.startedAt) {
    state = Object.assign(defaultRecoveryState(), {
      startedAt: nowIso(),
      totalAtStart: total
    });
    await setRecoveryState(state);
  }

  // A completed checkpoint can be reused as a verification response.
  if (state.nextOffset >= total) {
    const remoteCount = await getRemoteHistoryCount(cfg);
    state = await setRecoveryState(Object.assign({}, state, {
      nextOffset: total,
      uploaded: total,
      completedAt: state.completedAt || nowIso(),
      lastError: ''
    }));
    return { ok: true, done: true, localCount: total, uploaded: total, nextOffset: total, remoteCount, state };
  }

  try {
    if (!state.sitesUploaded) {
      await uploadRecoverySites(settings, cfg);
      state.sitesUploaded = true;
      await setRecoveryState(state);
    }

    const start = Math.max(0, Number(state.nextOffset || 0));
    const end = Math.min(total, start + RECOVERY_BATCH_SIZE);
    const rawBatch = rawHistory.items.slice(start, end);
    const rows = rawBatch.map(historyItemToRow).filter(Boolean);

    if (rows.length) {
      await fetchWithRetry(`${cfg.baseUrl}/rest/v1/${encodeURIComponent(cfg.sync.historyTable)}?on_conflict=site_id,item_key`, {
        method: 'POST',
        headers: cfg.headers,
        body: JSON.stringify(rows)
      });
    }

    const done = end >= total;
    state = await setRecoveryState(Object.assign({}, state, {
      nextOffset: end,
      uploaded: end,
      totalAtStart: state.totalAtStart || total,
      completedAt: done ? nowIso() : '',
      lastError: ''
    }));

    const remoteCount = done ? await getRemoteHistoryCount(cfg) : null;
    return {
      ok: true,
      done,
      uploaded: end,
      localCount: total,
      sentRows: rows.length,
      skippedRows: rawBatch.length - rows.length,
      remoteCount,
      state
    };
  } catch (e) {
    state = await setRecoveryState(Object.assign({}, state, { lastError: e?.message || String(e) }));
    return {
      ok: false,
      reason: 'recovery_batch_failed',
      details: e?.message || String(e),
      uploaded: Number(state.nextOffset || 0),
      localCount: total,
      state
    };
  }
}

async function recoveryExportPart(offset, limit) {
  const rawHistory = await getRawHistoryContainer();
  const total = rawHistory.items.length;
  const safeOffset = Math.max(0, Number(offset || 0));
  const safeLimit = Math.min(1000, Math.max(1, Number(limit || RECOVERY_EXPORT_PART_SIZE)));
  const items = rawHistory.items.slice(safeOffset, safeOffset + safeLimit);
  return {
    ok: true,
    total,
    offset: safeOffset,
    nextOffset: safeOffset + items.length,
    done: safeOffset + items.length >= total,
    data: {
      schemaVersion: 1,
      kind: 'history',
      exportedAt: nowIso(),
      recoveryPart: {
        offset: safeOffset,
        count: items.length,
        total
      },
      payload: {
        schemaVersion: Number(rawHistory.schemaVersion || 1),
        items
      }
    }
  };
}

function wildcardToRegex(pattern) {
  const escaped = String(pattern).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`, 'i');
}

function urlMatchesPatterns(url, patterns) {
  if (!Array.isArray(patterns) || !patterns.length) return false;
  return patterns.some((pattern) => {
    try {
      return wildcardToRegex(pattern).test(url);
    } catch {
      return false;
    }
  });
}

function getSiteForUrl(settings, url) {
  return settings.sites.find(site => site.enabled && urlMatchesPatterns(url, site.hostPatterns));
}

async function ensureTabInjected(tabId, url) {
  const settings = await getSettings();
  const site = getSiteForUrl(settings, url || '');
  if (!site) return { ok: false, reason: 'site_not_configured' };

  const originPattern = `${new URL(url).origin}/*`;
  const hasPerm = await permissionsApi.contains({ origins: [originPattern] });
  if (!hasPerm) {
    return { ok: false, reason: 'permission_not_granted', originPattern };
  }

  try {
    if (EXT.scripting?.insertCSS) {
      await EXT.scripting.insertCSS({ target: { tabId }, files: ['content.css'] });
      await EXT.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    } else if (EXT.tabs?.insertCSS && EXT.tabs?.executeScript) {
      await promisifyChrome(EXT.tabs.insertCSS, EXT.tabs, tabId, { file: 'content.css' });
      await promisifyChrome(EXT.tabs.executeScript, EXT.tabs, tabId, { file: 'content.js' });
    }
  } catch (e) {
    // already injected or page restricted
  }

  try {
    await tabsApi.sendMessage(tabId, { type: 'VCM_INIT', siteConfig: site });
  } catch {
    // content script may not be ready yet
    setTimeout(() => {
      tabsApi.sendMessage(tabId, { type: 'VCM_INIT', siteConfig: site }).catch(() => {});
    }, 250);
  }

  return { ok: true, siteId: site.id };
}

async function addHistoryItem(item) {
  const history = await getHistory();
  const normalized = normalizeHistoryItem(item);
  if (!normalized) return { ok: false, reason: 'bad_item' };
  history.items.push(normalized);
  const saved = await setHistory(history);
  return { ok: true, item: normalized, count: saved.items.length };
}

async function removeHistoryItem(siteId, key) {
  const history = await getHistory();
  history.items = history.items.filter(item => !(item.siteId === siteId && item.key === key));
  const saved = await setHistory(history);
  return { ok: true, count: saved.items.length };
}

function buildHistoryIndex(items) {
  const out = {};
  for (const item of items) {
    if (!out[item.siteId]) out[item.siteId] = {};
    out[item.siteId][item.key] = item;
  }
  return out;
}

function exportJsonPayload(kind, payload) {
  return {
    schemaVersion: 1,
    kind,
    exportedAt: nowIso(),
    payload
  };
}


function normalizeTitleLegacy(text) {
  return String(text || '')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\{[^}]*\}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function normalizeLegacyPayload(kind, payload) {
  if (kind && kind !== 'legacy') {
    return { kind, payload };
  }

  if (Array.isArray(payload)) {
    if (payload.every(v => typeof v === 'string')) {
      return {
        kind: 'history',
        payload: {
          schemaVersion: 1,
          items: payload.filter(Boolean).map(key => ({
            siteId: 'iwara',
            key: String(key),
            url: '',
            titleRaw: '',
            titleNormalized: '',
            createdAt: nowIso(),
            updatedAt: nowIso(),
            source: 'import'
          }))
        }
      };
    }

    if (payload.every(v => v && typeof v === 'object' && ('url' in v || 'title' in v || 'normalized' in v))) {
      const items = payload.map((row) => {
        const url = String(row.url || '');
        const titleRaw = String(row.title || '');
        const titleNormalized = String(row.normalized || normalizeTitleLegacy(titleRaw));
        const siteId = /\/g\//.test(url) ? 'nhentai' : 'legacy';
        const key = titleNormalized || url;
        return {
          siteId,
          key,
          url,
          titleRaw,
          titleNormalized,
          createdAt: nowIso(),
          updatedAt: nowIso(),
          source: 'import'
        };
      }).filter(item => item.siteId && item.key);

      return {
        kind: 'history',
        payload: {
          schemaVersion: 1,
          items
        }
      };
    }
  }

  return { kind, payload };
}

async function mergeImported(kind, payload, mode) {
  const normalizedInput = normalizeLegacyPayload(kind, payload);
  kind = normalizedInput.kind;
  payload = normalizedInput.payload;
  if (kind === 'history') {
    const current = await getHistory();
    const incoming = normalizeHistory(payload);
    const next = mode === 'replace' ? incoming : dedupeHistory({ schemaVersion: 1, items: current.items.concat(incoming.items) });
    await setHistory(next);
    return { ok: true };
  }

  if (kind === 'settings') {
    const current = await getSettings();
    const incoming = normalizeSettings(payload);
    const next = mode === 'replace'
      ? incoming
      : normalizeSettings({
          sync: incoming.sync.provider !== 'none' ? incoming.sync : current.sync,
          sites: mergeSites(current.sites, incoming.sites)
        });
    await setSettings(next);
    return { ok: true };
  }

  if (kind === 'full-backup') {
    await mergeImported('settings', payload.settings || DEFAULTS.settings, mode);
    await mergeImported('history', payload.history || DEFAULTS.history, mode);
    return { ok: true };
  }

  return { ok: false, reason: 'unknown_kind' };
}

function mergeSites(a, b) {
  const map = new Map();
  [...a, ...b].map(normalizeSiteConfig).filter(Boolean).forEach(site => {
    const existing = map.get(site.id);
    if (!existing || String(site.updatedAt) > String(existing.updatedAt)) {
      map.set(site.id, site);
    }
  });
  return Array.from(map.values());
}

async function syncWithSupabase() {
  return {
    ok: false,
    reason: 'disabled_in_recovery_build',
    details: 'Open extension settings and use Recovery Sync. Normal full sync is disabled in this build to protect the local history.'
  };
}

async function safeReadText(res) {
  try { return await res.text(); } catch { return ''; }
}

async function getActiveTab() {
  const tabs = await tabsApi.query({ active: true, currentWindow: true });
  return tabs && tabs[0] ? tabs[0] : null;
}

async function grantCurrentSitePermission() {
  const tab = await getActiveTab();
  if (!tab?.url) return { ok: false, reason: 'no_active_tab' };
  const originPattern = `${new URL(tab.url).origin}/*`;
  const granted = await permissionsApi.request({ origins: [originPattern] });
  if (!granted) return { ok: false, reason: 'permission_denied' };
  return ensureTabInjected(tab.id, tab.url);
}

async function applyOnCurrentTab() {
  const tab = await getActiveTab();
  if (!tab?.id || !tab.url) return { ok: false, reason: 'no_active_tab' };
  const result = await ensureTabInjected(tab.id, tab.url);
  if (!result.ok) return result;
  try {
    await tabsApi.sendMessage(tab.id, { type: 'VCM_APPLY_NOW' });
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: 'apply_failed', details: String(e) };
  }
}

async function getCurrentSiteStatus() {
  const tab = await getActiveTab();
  if (!tab?.url) return { ok: false, reason: 'no_active_tab' };
  const settings = await getSettings();
  const site = getSiteForUrl(settings, tab.url);
  const originPattern = `${new URL(tab.url).origin}/*`;
  const hasPerm = await permissionsApi.contains({ origins: [originPattern] });
  return {
    ok: true,
    url: tab.url,
    originPattern,
    siteConfigured: !!site,
    siteId: site?.id || '',
    siteName: site?.name || '',
    permissionGranted: !!hasPerm
  };
}

async function handleMessage(msg) {
  switch (msg?.type) {
    case 'VCM_GET_STATE': {
      const [settings, history, ui, status] = await Promise.all([getSettings(), getHistory(), getUi(), getCurrentSiteStatus()]);
      return { ok: true, settings, historyIndex: buildHistoryIndex(history.items), ui, currentSiteStatus: status };
    }
    case 'VCM_GET_SETTINGS':
      return { ok: true, settings: await getSettings() };
    case 'VCM_SAVE_SETTINGS': {
      const saved = await setSettings(msg.settings || DEFAULTS.settings);
      return { ok: true, settings: saved };
    }
    case 'VCM_GET_HISTORY':
      return { ok: true, history: await getHistory() };
    case 'VCM_ADD_HISTORY_ITEM':
      return addHistoryItem(msg.item);
    case 'VCM_REMOVE_HISTORY_ITEM':
      return removeHistoryItem(msg.siteId, msg.key);
    case 'VCM_EXPORT_HISTORY':
      return { ok: true, data: exportJsonPayload('history', await getHistory()) };
    case 'VCM_EXPORT_SETTINGS':
      return { ok: true, data: exportJsonPayload('settings', await getSettings()) };
    case 'VCM_EXPORT_FULL':
      return { ok: true, data: exportJsonPayload('full-backup', { settings: await getSettings(), history: await getHistory() }) };
    case 'VCM_IMPORT_JSON':
      return mergeImported(msg.kind, msg.payload, msg.mode || 'merge');
    case 'VCM_SYNC_NOW':
      return syncWithSupabase();
    case 'VCM_RECOVERY_INFO':
      return getRecoveryInfo();
    case 'VCM_RECOVERY_SYNC_BATCH':
      return recoverySyncBatch();
    case 'VCM_RECOVERY_RESET':
      return resetRecoveryCheckpoint();
    case 'VCM_RECOVERY_EXPORT_PART':
      return recoveryExportPart(msg.offset, msg.limit);
    case 'VCM_GET_CURRENT_SITE_STATUS':
      return getCurrentSiteStatus();
    case 'VCM_GRANT_CURRENT_SITE':
      return grantCurrentSitePermission();
    case 'VCM_APPLY_ON_CURRENT_TAB':
      return applyOnCurrentTab();
    case 'VCM_GET_UI':
      return { ok: true, ui: await getUi() };
    case 'VCM_SAVE_UI':
      return { ok: true, ui: await setUi(msg.ui) };
    default:
      return { ok: false, reason: 'unknown_message' };
  }
}

if (EXT.runtime?.onMessage) {
  EXT.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    Promise.resolve(handleMessage(msg))
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, reason: 'exception', details: String(e) }));
    return true;
  });
}

if (EXT.tabs?.onUpdated) {
  EXT.tabs.onUpdated.addListener((tabId, info, tab) => {
    if (info.status !== 'complete' || !tab?.url || !/^https?:/i.test(tab.url)) return;
    ensureTabInjected(tabId, tab.url).catch(() => {});
  });
}

(async function initDefaults() {
  const [settingsRaw, historyRaw, uiRaw] = await Promise.all([
    storageLocal.get(STORAGE_KEYS.settings),
    storageLocal.get(STORAGE_KEYS.history),
    storageLocal.get(STORAGE_KEYS.ui)
  ]);

  if (!settingsRaw[STORAGE_KEYS.settings]) await storageLocal.set({ [STORAGE_KEYS.settings]: DEFAULTS.settings });
  if (!historyRaw[STORAGE_KEYS.history]) await storageLocal.set({ [STORAGE_KEYS.history]: DEFAULTS.history });
  if (!uiRaw[STORAGE_KEYS.ui]) await storageLocal.set({ [STORAGE_KEYS.ui]: DEFAULTS.ui });
})();
