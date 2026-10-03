(function () {
  const EXT = globalThis.browser || globalThis.chrome;

  function sendMessage(msg) {
    try {
      const maybePromise = EXT.runtime.sendMessage(msg);
      if (maybePromise && typeof maybePromise.then === 'function') return maybePromise;
    } catch {}
    return new Promise((resolve) => EXT.runtime.sendMessage(msg, resolve));
  }

  function extPermissionsContains(perm) {
    if (!EXT.permissions) return Promise.resolve(true);
    try {
      const maybePromise = EXT.permissions.contains(perm);
      if (maybePromise && typeof maybePromise.then === 'function') return maybePromise;
    } catch {}
    return new Promise((resolve) => EXT.permissions.contains(perm, resolve));
  }

  function extPermissionsRequest(perm) {
    if (!EXT.permissions) return Promise.resolve(true);
    try {
      const maybePromise = EXT.permissions.request(perm);
      if (maybePromise && typeof maybePromise.then === 'function') return maybePromise;
    } catch {}
    return new Promise((resolve) => EXT.permissions.request(perm, resolve));
  }

  let currentStatus = null;

  async function loadState() {
    const info = document.getElementById('siteInfo');
    const status = document.getElementById('status');

    const res = await sendMessage({ type: 'VCM_GET_CURRENT_SITE_STATUS' });
    currentStatus = res?.ok ? res : null;

    if (!res?.ok) {
      info.innerHTML = '<span class="badge">No active tab</span>';
      return;
    }

    info.innerHTML = `
      <div><span class="badge">Configured: ${res.siteConfigured ? 'yes' : 'no'}</span></div>
      <div class="muted">${res.siteConfigured ? res.siteName : 'No matching site config for this page'}</div>
      <div class="muted">Permission: ${res.permissionGranted ? 'granted' : 'not granted'}</div>
      <div class="muted">${res.originPattern}</div>
    `;

    status.textContent = '';
  }

  async function grantSite() {
    const status = document.getElementById('status');

    if (!currentStatus?.ok) {
      status.textContent = 'No active tab.';
      return;
    }

    if (!currentStatus.siteConfigured) {
      status.textContent = 'No matching site config for this page.';
      return;
    }

    const perm = { origins: [currentStatus.originPattern] };

    try {
      const alreadyGranted = await extPermissionsContains(perm);
      if (!alreadyGranted) {
        status.textContent = 'Requesting permission...';
        const granted = await extPermissionsRequest(perm);
        if (!granted) {
          status.textContent = 'Permission was not granted.';
          await loadState();
          return;
        }
      }

      status.textContent = 'Permission granted. Initializing...';
      const applied = await sendMessage({ type: 'VCM_APPLY_ON_CURRENT_TAB' });

      status.textContent = applied?.ok
        ? 'Permission granted and script initialized.'
        : `Permission granted, but initialization failed: ${applied?.reason || 'unknown'}`;

      await loadState();
    } catch (e) {
      status.textContent = `Grant failed: ${e?.message || String(e)}`;
      await loadState();
    }
  }

  async function applyNow() {
    const status = document.getElementById('status');
    status.textContent = 'Applying...';
    const res = await sendMessage({ type: 'VCM_APPLY_ON_CURRENT_TAB' });
    status.textContent = res?.ok ? 'Applied.' : `Failed: ${res?.reason || 'unknown'}`;
  }

  async function syncNow() {
    const status = document.getElementById('status');
    status.textContent = 'Recovery build: opening safe Recovery Sync…';
    if (EXT.runtime.openOptionsPage) await EXT.runtime.openOptionsPage();
  }

  function openOptionsPage() {
    if (EXT.runtime.openOptionsPage) {
      EXT.runtime.openOptionsPage();
    }
  }

  document.getElementById('btnGrant').addEventListener('click', grantSite);
  document.getElementById('btnApply').addEventListener('click', applyNow);
  document.getElementById('btnSync').addEventListener('click', syncNow);
  document.getElementById('btnOptions').addEventListener('click', openOptionsPage);

  loadState();
})();
