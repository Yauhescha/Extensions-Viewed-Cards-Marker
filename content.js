(function () {
  if (globalThis.__VCM_CONTENT_LOADED__) {
    if (globalThis.__VCM_REAPPLY_CURRENT_SITE__) {
      globalThis.__VCM_REAPPLY_CURRENT_SITE__();
    }
    return;
  }
  globalThis.__VCM_CONTENT_LOADED__ = true;

  const EXT = globalThis.browser || globalThis.chrome;
  let currentSiteConfig = null;
  let pendingTimer = null;
  let observer = null;
  let historyIndex = {};

  function sendMessage(msg) {
    try {
      const maybePromise = EXT.runtime.sendMessage(msg);
      if (maybePromise && typeof maybePromise.then === 'function') return maybePromise;
    } catch {}
    return new Promise((resolve) => {
      try {
        EXT.runtime.sendMessage(msg, resolve);
      } catch (e) {
        resolve({ ok: false, reason: String(e) });
      }
    });
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

  function applyTransforms(text, transforms) {
    let value = String(text || '');
    for (const tr of transforms || []) {
      try {
        if (tr.type === 'regexReplace') {
          value = value.replace(new RegExp(tr.pattern, tr.flags || ''), tr.replacement || '');
        } else if (tr.type === 'trim') {
          value = value.trim();
        } else if (tr.type === 'lowercase') {
          value = value.toLowerCase();
        }
      } catch {}
    }
    return value.trim();
  }

  function getTitleFromCard(card, site) {
    if (site.titleSource === 'documentTitle') return document.title || '';
    if (site.titleSource === 'linkText') {
      const link = card.querySelector(site.linkSelector);
      return link ? (link.textContent || '').trim() : '';
    }
    const titleEl = site.titleSelector ? card.querySelector(site.titleSelector) : null;
    return titleEl ? (titleEl.textContent || '').trim() : '';
  }

  function getViewPageTitle(site) {
    if (site.viewPageTitleSelector) {
      const el = document.querySelector(site.viewPageTitleSelector);
      if (el && (el.textContent || '').trim()) return (el.textContent || '').trim();
    }
    return document.title || '';
  }

  function getLinkFromCard(card, site) {
    const link = card.querySelector(site.linkSelector);
    if (!link) return { href: '', linkEl: null };
    const href = link.href || link.getAttribute('href') || '';
    return { href, linkEl: link };
  }

  function buildKey({ href, normalizedTitle }, site) {
    if (site.keyStrategy === 'urlPathRegex') {
      try {
        const u = new URL(href, location.href);
        const m = u.pathname.match(new RegExp(site.keyRegex));
        return m ? String(m[1] || m[0] || '').trim() : '';
      } catch {
        return '';
      }
    }

    if (site.keyStrategy === 'customTemplate') {
      return String(site.keyTemplate || '{{normalizedTitle}}')
        .replaceAll('{{normalizedTitle}}', normalizedTitle || '')
        .replaceAll('{{url}}', href || '')
        .trim();
    }

    return normalizedTitle || '';
  }

  function isViewed(siteId, key) {
    return !!(historyIndex[siteId] && historyIndex[siteId][key]);
  }

  function ensureControls(card, linkEl, site, key, viewed, normalizedTitle, href) {
    if (!site.actionButtons || !site.actionButtons.length) return;
    let controls = card.querySelector(':scope > .vcm-controls');
    if (!controls) {
      controls = document.createElement('div');
      controls.className = 'vcm-controls';
      card.appendChild(controls);
    }

    for (const btnDef of site.actionButtons) {
      let btn = controls.querySelector(`button[data-vcm-btn-id="${btnDef.id}"]`);
      if (!btn) {
        btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'vcm-btn';
        btn.dataset.vcmBtnId = btnDef.id;
        controls.appendChild(btn);
      }
      btn.textContent = viewed ? btnDef.textViewed : btnDef.textUnviewed;
      btn.onclick = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (isViewed(site.id, key)) {
          const res = await sendMessage({ type: 'VCM_REMOVE_HISTORY_ITEM', siteId: site.id, key });
          if (res?.ok) {
            if (historyIndex[site.id]) delete historyIndex[site.id][key];
            applyViewedStyles(card, linkEl, site, false);
            btn.textContent = btnDef.textUnviewed;
          }
        } else {
          const item = {
            siteId: site.id,
            key,
            url: href,
            titleRaw: normalizedTitle,
            titleNormalized: normalizedTitle,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            source: 'manual'
          };
          const res = await sendMessage({ type: 'VCM_ADD_HISTORY_ITEM', item });
          if (res?.ok) {
            if (!historyIndex[site.id]) historyIndex[site.id] = {};
            historyIndex[site.id][key] = item;
            applyViewedStyles(card, linkEl, site, true);
            btn.textContent = btnDef.textViewed;
          }
        }
      };
    }
  }

  function applyViewedStyles(card, linkEl, site, viewed) {
    if (site.highlightMode === 'linkClass' && linkEl) {
      linkEl.classList.toggle(site.highlightClass || 'vcm-link-viewed', viewed);
      if (!site.highlightClass) linkEl.classList.toggle('vcm-link-viewed', viewed);
    } else {
      card.classList.toggle(site.highlightClass || 'vcm-viewed', viewed);
      if (!site.highlightClass) card.classList.toggle('vcm-viewed', viewed);
    }
  }

  function collectCards(site) {
    if (!site.cardSelector) return [];
    return Array.from(document.querySelectorAll(site.cardSelector));
  }

  async function refreshState() {
    const resp = await sendMessage({ type: 'VCM_GET_STATE' });
    historyIndex = resp?.historyIndex || {};
  }

  async function autoMarkIfViewPage(site) {
    if (!site.autoMarkOnViewPage || !urlMatchesPatterns(location.href, site.viewPagePatterns)) return;
    const rawTitle = getViewPageTitle(site);
    const normalizedTitle = applyTransforms(rawTitle, site.titleTransforms);
    const key = buildKey({ href: location.href, normalizedTitle }, site);
    if (!key || isViewed(site.id, key)) return;
    const item = {
      siteId: site.id,
      key,
      url: location.href,
      titleRaw: rawTitle,
      titleNormalized: normalizedTitle,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      source: 'auto'
    };
    const res = await sendMessage({ type: 'VCM_ADD_HISTORY_ITEM', item });
    if (res?.ok) {
      if (!historyIndex[site.id]) historyIndex[site.id] = {};
      historyIndex[site.id][key] = item;
    }
  }

  function runPageActions(site) {
    for (const action of site.pageActions || []) {
      const runner = () => {
        const nodes = Array.from(document.querySelectorAll(action.selector || ''));
        for (const node of nodes) {
          if (action.type === 'dispatchEvent') {
            node.dispatchEvent(new MouseEvent(action.eventName || 'mouseover', { bubbles: true, cancelable: true, view: window }));
          } else if (action.type === 'click') {
            node.click();
          } else if (action.type === 'addClass') {
            node.classList.add(action.className || '');
          } else if (action.type === 'setAttribute') {
            node.setAttribute(action.attrName || 'data-vcm', action.attrValue || '1');
          }
        }
      };
      if (action.delayMs > 0) setTimeout(runner, action.delayMs);
      else runner();
    }
  }

  async function applySite(site) {
    await refreshState();
    await autoMarkIfViewPage(site);
    if (!site.autoApplyOnListPage || !urlMatchesPatterns(location.href, site.listPagePatterns)) return;

    const work = async () => {
      const cards = collectCards(site);
      for (const card of cards) {
        const { href, linkEl } = getLinkFromCard(card, site);
        if (!href) continue;
        const rawTitle = getTitleFromCard(card, site);
        const normalizedTitle = applyTransforms(rawTitle, site.titleTransforms);
        const key = buildKey({ href, normalizedTitle }, site);
        if (!key) continue;
        const viewed = isViewed(site.id, key);
        applyViewedStyles(card, linkEl, site, viewed);
        ensureControls(card, linkEl, site, key, viewed, normalizedTitle, href);
      }
      runPageActions(site);
    };

    clearTimeout(pendingTimer);
    pendingTimer = setTimeout(work, Math.max(0, Number(site.delayMs || 0)));
  }

  function disconnectObserver() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
  }

  function connectObserver(site) {
    disconnectObserver();
    observer = new MutationObserver(() => {
      clearTimeout(pendingTimer);
      pendingTimer = setTimeout(() => applySite(site), Math.max(100, Number(site.delayMs || 0)));
    });
    observer.observe(document.documentElement || document.body, { childList: true, subtree: true });
  }

  async function init(siteConfig) {
    currentSiteConfig = siteConfig;
    await applySite(currentSiteConfig);
    connectObserver(currentSiteConfig);
  }

  globalThis.__VCM_REAPPLY_CURRENT_SITE__ = () => {
    if (currentSiteConfig) applySite(currentSiteConfig);
  };

  EXT.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    (async () => {
      try {
        if (msg?.type === 'VCM_INIT' && msg.siteConfig) {
          await init(msg.siteConfig);
          sendResponse({ ok: true });
          return;
        }
        if (msg?.type === 'VCM_APPLY_NOW') {
          if (currentSiteConfig) await applySite(currentSiteConfig);
          sendResponse({ ok: true });
          return;
        }
        sendResponse({ ok: false, reason: 'unknown_message' });
      } catch (e) {
        sendResponse({ ok: false, reason: String(e) });
      }
    })();
    return true;
  });
})();
