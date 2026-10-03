const EXT = typeof browser !== 'undefined' ? browser : chrome;
let currentSettings = null;

function sendMessage(msg) {
  try {
    const maybePromise = EXT.runtime.sendMessage(msg);
    if (maybePromise && typeof maybePromise.then === 'function') return maybePromise;
  } catch {}
  return new Promise((resolve) => EXT.runtime.sendMessage(msg, resolve));
}

function $(id) {
  return document.getElementById(id);
}

function linesToArray(text) {
  return String(text || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
}

function arrayToLines(arr) {
  return (Array.isArray(arr) ? arr : []).join('\n');
}

function safeJsonParse(text, fallback) {
  try { return JSON.parse(text); } catch { return fallback; }
}

function setStatus(value) {
  $('status').textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

async function loadSettings() {
  const res = await sendMessage({ type: 'VCM_GET_SETTINGS' });
  currentSettings = res.settings;
  renderSites();
  renderSync();
  if (currentSettings.sites.length) fillEditor(currentSettings.sites[0]);
  await refreshRecoveryInfo();
}

function renderSites() {
  const list = $('siteList');
  list.innerHTML = '';
  for (const site of currentSettings.sites) {
    const row = document.createElement('div');
    row.className = 'site-row';
    row.innerHTML = `
      <div>
        <div><strong>${escapeHtml(site.name)}</strong></div>
        <div class="small">${escapeHtml(site.id)}</div>
      </div>
      <div class="toolbar">
        <button data-edit="${site.id}">Edit</button>
      </div>
    `;
    row.querySelector('button').addEventListener('click', () => fillEditor(site));
    list.appendChild(row);
  }
}

function renderSync() {
  const sync = currentSettings.sync || {};
  $('syncProvider').value = sync.provider || 'none';
  $('supabaseUrl').value = sync.supabaseUrl || '';
  $('supabaseAnonKey').value = sync.supabaseAnonKey || '';
  $('historyTable').value = sync.historyTable || 'viewed_history';
  $('sitesTable').value = sync.sitesTable || 'site_configs';
}

function fillEditor(site) {
  $('siteId').value = site.id || '';
  $('siteName').value = site.name || '';
  $('siteEnabled').value = String(site.enabled !== false);
  $('hostPatterns').value = arrayToLines(site.hostPatterns);
  $('viewPagePatterns').value = arrayToLines(site.viewPagePatterns);
  $('listPagePatterns').value = arrayToLines(site.listPagePatterns);
  $('cardSelector').value = site.cardSelector || '';
  $('linkSelector').value = site.linkSelector || '';
  $('titleSelector').value = site.titleSelector || '';
  if ($('viewPageTitleSelector')) $('viewPageTitleSelector').value = site.viewPageTitleSelector || '';
  $('titleSource').value = site.titleSource || 'selector';
  $('titleTransforms').value = JSON.stringify(site.titleTransforms || [], null, 2);
  $('keyStrategy').value = site.keyStrategy || 'normalizedTitle';
  $('keyRegex').value = site.keyRegex || '';
  $('keyTemplate').value = site.keyTemplate || '{{normalizedTitle}}';
  $('delayMs').value = Number(site.delayMs || 0);
  $('highlightMode').value = site.highlightMode || 'cardClass';
  $('highlightClass').value = site.highlightClass || '';
  $('actionButtons').value = JSON.stringify(site.actionButtons || [], null, 2);
  $('pageActions').value = JSON.stringify(site.pageActions || [], null, 2);
  $('autoMarkOnViewPage').value = String(site.autoMarkOnViewPage !== false);
  $('autoApplyOnListPage').value = String(site.autoApplyOnListPage !== false);
}

function readEditor() {
  const id = $('siteId').value.trim() || `site_${Math.random().toString(36).slice(2, 10)}`;
  return {
    id,
    name: $('siteName').value.trim() || id,
    enabled: $('siteEnabled').value === 'true',
    hostPatterns: linesToArray($('hostPatterns').value),
    viewPagePatterns: linesToArray($('viewPagePatterns').value),
    listPagePatterns: linesToArray($('listPagePatterns').value),
    cardSelector: $('cardSelector').value.trim(),
    linkSelector: $('linkSelector').value.trim(),
    titleSelector: $('titleSelector').value.trim(),
    viewPageTitleSelector: $('viewPageTitleSelector') ? $('viewPageTitleSelector').value.trim() : '',
    titleSource: $('titleSource').value,
    titleTransforms: safeJsonParse($('titleTransforms').value, []),
    keyStrategy: $('keyStrategy').value,
    keyRegex: $('keyRegex').value.trim(),
    keyTemplate: $('keyTemplate').value.trim(),
    delayMs: Number($('delayMs').value || 0),
    highlightMode: $('highlightMode').value,
    highlightClass: $('highlightClass').value.trim(),
    actionButtons: safeJsonParse($('actionButtons').value, []),
    pageActions: safeJsonParse($('pageActions').value, []),
    autoMarkOnViewPage: $('autoMarkOnViewPage').value === 'true',
    autoApplyOnListPage: $('autoApplyOnListPage').value === 'true',
    updatedAt: new Date().toISOString()
  };
}

async function saveAll() {
  const res = await sendMessage({ type: 'VCM_SAVE_SETTINGS', settings: currentSettings });
  currentSettings = res.settings;
  renderSites();
  renderSync();
  setStatus('Saved.');
}

async function saveSite() {
  const site = readEditor();
  const idx = currentSettings.sites.findIndex(s => s.id === site.id);
  if (idx >= 0) currentSettings.sites[idx] = site;
  else currentSettings.sites.push(site);
  await saveAll();
  fillEditor(site);
}

async function deleteSite() {
  const id = $('siteId').value.trim();
  if (!id) return;
  currentSettings.sites = currentSettings.sites.filter(site => site.id !== id);
  await saveAll();
  if (currentSettings.sites.length) fillEditor(currentSettings.sites[0]);
  else clearEditor();
}

function clearEditor() {
  fillEditor({
    id: '', name: '', enabled: true, hostPatterns: [], viewPagePatterns: [], listPagePatterns: [],
    cardSelector: '', linkSelector: '', titleSelector: '', titleSource: 'selector', titleTransforms: [{ type: 'trim' }],
    keyStrategy: 'normalizedTitle', keyRegex: '', keyTemplate: '{{normalizedTitle}}', delayMs: 0,
    highlightMode: 'cardClass', highlightClass: '', actionButtons: [{ id: 'toggle-viewed', textViewed: 'Viewed', textUnviewed: 'Mark', position: 'insideCardBottom', action: 'toggleViewed' }],
    pageActions: [], autoMarkOnViewPage: true, autoApplyOnListPage: true
  });
}

async function saveSync() {
  currentSettings.sync = {
    provider: $('syncProvider').value,
    supabaseUrl: $('supabaseUrl').value.trim(),
    supabaseAnonKey: $('supabaseAnonKey').value.trim(),
    historyTable: $('historyTable').value.trim() || 'viewed_history',
    sitesTable: $('sitesTable').value.trim() || 'site_configs'
  };
  await saveAll();
}

async function exportKind(kind) {
  const map = {
    history: 'VCM_EXPORT_HISTORY',
    settings: 'VCM_EXPORT_SETTINGS',
    full: 'VCM_EXPORT_FULL'
  };
  const res = await sendMessage({ type: map[kind] });
  if (!res?.ok) {
    setStatus(res);
    return;
  }
  const text = JSON.stringify(res.data, null, 2);
  $('importJson').value = text;
  await downloadText(`${kind}-${Date.now()}.json`, text);
  setStatus(`Exported ${kind}.`);
}

async function downloadText(filename, text, saveAs = true) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const downloads = EXT.downloads;
  try {
    if (downloads && downloads.download) {
      if (downloads.download.length === 1) {
        await downloads.download({ url, filename, saveAs });
      } else {
        await new Promise((resolve, reject) => {
          downloads.download({ url, filename, saveAs }, (id) => {
            const err = globalThis.chrome?.runtime?.lastError;
            if (err) reject(new Error(err.message));
            else resolve(id);
          });
        });
      }
      return;
    }
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 8000);
  }
}

async function importJson(mode) {
  const text = $('importJson').value.trim();
  if (!text) return;

  const parsed = safeJsonParse(text, null);
  if (parsed === null) {
    setStatus('Invalid JSON.');
    return;
  }

  let msg;
  const isEnvelope =
    parsed &&
    typeof parsed === 'object' &&
    !Array.isArray(parsed) &&
    typeof parsed.kind === 'string' &&
    Object.prototype.hasOwnProperty.call(parsed, 'payload');

  if (isEnvelope) {
    msg = {
      type: 'VCM_IMPORT_JSON',
      kind: parsed.kind,
      payload: parsed.payload,
      mode
    };
  } else {
    msg = {
      type: 'VCM_IMPORT_JSON',
      payload: parsed,
      mode
    };
  }

  const res = await sendMessage(msg);
  setStatus(res);
  if (res?.ok) await loadSettings();
}


let recoveryRunning = false;

function formatBytes(bytes) {
  const n = Number(bytes || 0);
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function setRecoveryStatus(value) {
  const el = $('recoveryStatus');
  if (!el) return;
  el.textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

function renderRecoveryInfo(info) {
  if (!info?.ok) {
    $('recoveryInfo').textContent = `Recovery status error: ${info?.reason || 'unknown'}`;
    return;
  }
  const state = info.state || {};
  const local = Number(info.localCount || 0);
  const uploaded = Math.min(local, Number(state.nextOffset || 0));
  const pct = local ? Math.min(100, (uploaded / local) * 100) : 100;
  $('recoveryProgress').style.width = `${pct}%`;
  $('recoveryInfo').textContent = `Local: ${local} records (~${formatBytes(info.approximateBytes)}). Checkpoint: ${uploaded}/${local} (${pct.toFixed(1)}%). Batch: ${info.batchSize}.`;
  if (state.lastError) setRecoveryStatus(`Last error: ${state.lastError}\nCheckpoint preserved at ${uploaded}/${local}.`);
}

async function refreshRecoveryInfo() {
  if (!$('recoveryInfo')) return null;
  const info = await sendMessage({ type: 'VCM_RECOVERY_INFO' });
  renderRecoveryInfo(info);
  return info;
}

async function ensureSupabasePermission() {
  const rawUrl = $('supabaseUrl').value.trim();
  if (!rawUrl || !EXT.permissions) return true;
  let originPattern;
  try {
    const u = new URL(rawUrl);
    originPattern = `${u.protocol}//${u.host}/*`;
  } catch {
    throw new Error('Supabase URL is invalid.');
  }
  const perm = { origins: [originPattern] };
  try {
    const contains = EXT.permissions.contains(perm);
    const granted = contains && typeof contains.then === 'function'
      ? await contains
      : await new Promise(resolve => EXT.permissions.contains(perm, resolve));
    if (granted) return true;
  } catch {}

  try {
    const req = EXT.permissions.request(perm);
    return req && typeof req.then === 'function'
      ? await req
      : await new Promise(resolve => EXT.permissions.request(perm, resolve));
  } catch (e) {
    throw new Error(`Could not request Supabase host permission: ${e?.message || String(e)}`);
  }
}

async function startRecoverySync() {
  if (recoveryRunning) return;
  recoveryRunning = true;
  const btn = $('btnRecoveryStart');
  btn.disabled = true;
  try {
    const permissionGranted = await ensureSupabasePermission();
    if (!permissionGranted) {
      setRecoveryStatus('Supabase host permission was not granted. Recovery did not start and local history is untouched.');
      return;
    }
    await saveSync();
    let info = await refreshRecoveryInfo();
    if (!info?.ok) {
      setRecoveryStatus(info);
      return;
    }
    const localCount = Number(info.localCount || 0);
    if (!localCount) {
      setRecoveryStatus('Local history is empty. Nothing to upload.');
      return;
    }

    while (true) {
      const res = await sendMessage({ type: 'VCM_RECOVERY_SYNC_BATCH' });
      if (!res?.ok) {
        setRecoveryStatus(`Recovery stopped safely.\n${res?.reason || 'unknown'}${res?.details ? `: ${res.details}` : ''}\nUploaded checkpoint: ${res?.uploaded ?? '?'} / ${res?.localCount ?? localCount}.\nTap Start / resume to continue.`);
        await refreshRecoveryInfo();
        return;
      }

      const pct = res.localCount ? (Number(res.uploaded || 0) / Number(res.localCount)) * 100 : 100;
      $('recoveryProgress').style.width = `${Math.min(100, pct)}%`;
      $('recoveryInfo').textContent = `Uploading: ${res.uploaded}/${res.localCount} (${pct.toFixed(1)}%).`;
      setRecoveryStatus(res.done
        ? `Upload complete. Local records: ${res.localCount}.${res.remoteCount != null ? ` Server table count: ${res.remoteCount}.` : ''}\nLocal history was not deleted or replaced.`
        : `Uploaded ${res.uploaded}/${res.localCount}. Current batch sent ${res.sentRows} valid rows${res.skippedRows ? `, skipped ${res.skippedRows} invalid rows` : ''}.`);

      if (res.done) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    await refreshRecoveryInfo();
  } catch (e) {
    setRecoveryStatus(`Recovery UI error: ${e?.message || String(e)}\nThe last confirmed checkpoint remains saved.`);
    await refreshRecoveryInfo();
  } finally {
    recoveryRunning = false;
    btn.disabled = false;
  }
}

async function resetRecovery() {
  if (!confirm('Reset only the Recovery Sync checkpoint? This does NOT delete local history or server data.')) return;
  const res = await sendMessage({ type: 'VCM_RECOVERY_RESET' });
  setRecoveryStatus(res?.ok ? 'Recovery checkpoint reset to 0. Local history is untouched.' : res);
  await refreshRecoveryInfo();
}

async function safeRecoveryExport() {
  const btn = $('btnRecoveryExport');
  btn.disabled = true;
  try {
    const info = await refreshRecoveryInfo();
    if (!info?.ok) return;
    const total = Number(info.localCount || 0);
    if (!total) {
      setRecoveryStatus('Local history is empty. Nothing to export.');
      return;
    }
    const partSize = Number(info.exportPartSize || 500);
    const totalParts = Math.ceil(total / partSize);
    let offset = 0;
    let part = 1;

    while (offset < total) {
      const res = await sendMessage({ type: 'VCM_RECOVERY_EXPORT_PART', offset, limit: partSize });
      if (!res?.ok) throw new Error(res?.details || res?.reason || 'Could not read export part');
      const text = JSON.stringify(res.data);
      const num = String(part).padStart(3, '0');
      const all = String(totalParts).padStart(3, '0');
      await downloadText(`vcm-recovery-history-part-${num}-of-${all}.json`, text, false);
      offset = Number(res.nextOffset || total);
      setRecoveryStatus(`Safe export: downloaded part ${part}/${totalParts} (${Math.min(offset, total)}/${total} records).`);
      part += 1;
      // Let Android Firefox release the previous Blob before the next part.
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    setRecoveryStatus(`Safe export complete: ${totalParts} files, ${total} records total. Each file is a valid history import envelope and can be imported with Merge.`);
  } catch (e) {
    setRecoveryStatus(`Safe export stopped: ${e?.message || String(e)}. Already downloaded parts remain valid.`);
  } finally {
    btn.disabled = false;
  }
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

document.getElementById('btnAddSite').addEventListener('click', clearEditor);
document.getElementById('btnSaveAll').addEventListener('click', saveAll);
document.getElementById('btnSaveSite').addEventListener('click', saveSite);
document.getElementById('btnDeleteSite').addEventListener('click', deleteSite);
document.getElementById('btnSaveSync').addEventListener('click', saveSync);
document.getElementById('btnExportHistory').addEventListener('click', () => exportKind('history'));
document.getElementById('btnExportSettings').addEventListener('click', () => exportKind('settings'));
document.getElementById('btnExportFull').addEventListener('click', () => exportKind('full'));
document.getElementById('btnImportMerge').addEventListener('click', () => importJson('merge'));
document.getElementById('btnImportReplace').addEventListener('click', () => importJson('replace'));
document.getElementById('btnRecoveryStart').addEventListener('click', startRecoverySync);
document.getElementById('btnRecoveryInspect').addEventListener('click', refreshRecoveryInfo);
document.getElementById('btnRecoveryReset').addEventListener('click', resetRecovery);
document.getElementById('btnRecoveryExport').addEventListener('click', safeRecoveryExport);

loadSettings();