// ==UserScript==
// @name         Genesys board sorter
// @namespace    https://apps.mypurecloud.de/
// @version      1.527.0
// @updateURL    https://drandox.cc/work/Genesys/Genesys_V2.user.js
// @downloadURL  https://drandox.cc/work/Genesys/Genesys_V2.user.js
// @description  Sorts and modernizes Genesys agent boards.
// @author       Drandox | Laszlo Akim
// @match        https://apps.mypurecloud.de/*
// @match        https://login.mypurecloud.de/*
// @run-at       document-start
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_listValues
// @grant        GM_deleteValue
// @grant        unsafeWindow
// @grant        GM_xmlhttpRequest
// @grant        GM_info
// @connect      drandox.cc
// @connect      raw.githubusercontent.com
// @license      MIT
// ==/UserScript==

(() => {
  'use strict';

  const INSTANCE_KEY = '__genesysBoardSorterV11__';
  if (window[INSTANCE_KEY]) return;
  window[INSTANCE_KEY] = true;

  // Official release checker: metadata updates remain managed by Tampermonkey.
  const RELEASE_ID = 'genesys-v2';
  // Keep the runtime primary API independent of publication-time URL rewrites.
  // GitHub may rewrite metadata, but must not turn this into the fallback API.
  const UPDATE_API_URL = ['https://', 'drandox.cc', '/work/', '?format=json'].join('');
  const GITHUB_VERSION_URL = 'https://raw.githubusercontent.com/Drandoxx/drandox-userscripts/main/versions.json';
  const PRIMARY_INSTALL_URL = 'https://drandox.cc/work/Genesys/Genesys_V2.user.js';
  const GITHUB_INSTALL_URL = 'https://raw.githubusercontent.com/Drandoxx/drandox-userscripts/main/Genesys_V2.user.js';
  const UPDATE_STATE_KEY = 'genesys-v2-update-policy-state';
  const UPDATE_LOCK_KEY = 'genesys-v2-update-policy-lock';
  const UPDATE_SESSION_COOKIE = 'gbs_update_session';
  const HOUR_MS = 3600000, MANUAL_MS = 600000;
  function updateSessionId() {
    const existing = document.cookie.split('; ').find(part => part.startsWith(UPDATE_SESSION_COOKIE + '='))?.split('=')[1];
    if (existing) return existing;
    const id = String(Date.now()) + Math.random().toString(36).slice(2);
    // Session cookie shared by Genesys login/app tabs; no persistent expiry.
    document.cookie = `${UPDATE_SESSION_COOKIE}=${id}; Domain=.mypurecloud.de; Path=/; Secure; SameSite=Lax`;
    return document.cookie.split('; ').find(part => part.startsWith(UPDATE_SESSION_COOKIE + '='))?.split('=')[1] || id;
  }
  function readUpdateState() {
    const session = updateSessionId();
    const old = GM_getValue(UPDATE_STATE_KEY, {});
    if (old.session === session) return old;
    const fresh = { session, fallback: false, failures: 0, primaryAt: 0,
      githubSuccessAt: old.githubSuccessAt || 0, githubAutoAt: 0, githubManualAt: old.githubManualAt || 0, cached: old.cached || null };
    GM_setValue(UPDATE_STATE_KEY, fresh);
    return fresh;
  }
  let shownAutomaticUpdateVersion = null;
  function applyCachedUpdate(state, manual = false) {
    const current = GM_info.script.version;
    const comparison = confirmedUpdateVersion && compareVersions(confirmedUpdateVersion, current) > 0 ? confirmedUpdateVersion : current;
    const cached = state.cached;
    availableUpdateRelease = cached && [PRIMARY_INSTALL_URL, GITHUB_INSTALL_URL].includes(cached.downloadUrl)
      && /^\d+(?:\.\d+)*$/.test(String(cached.version))
      && compareVersions(cached.version, comparison) > 0 ? cached : null;
    syncGenesysUpdateControls();
    if (!manual && document.body && availableUpdateRelease && shownAutomaticUpdateVersion !== availableUpdateRelease.version) {
      shownAutomaticUpdateVersion = availableUpdateRelease.version;
      showGenesysUpdateNotice(comparison, availableUpdateRelease);
    }
    if (manual && availableUpdateRelease) showGenesysUpdateNotice(comparison, availableUpdateRelease, true);
  }
  function showUpdateCooldown(ms) {
    const button = document.querySelector('.gbs-settings-check-updates');
    // Keep the same button text/style regardless of update source.
    if (button) {
      button.textContent = 'Check for updates';
      const seconds = Math.max(0, Math.ceil(ms / 1000));
      button.title = `Manual check available in ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
      let status = button.parentElement?.querySelector('.gbs-update-cooldown');
      if (!status && button.parentElement) {
        status = document.createElement('span'); status.className = 'gbs-update-cooldown';
        status.style.cssText = 'font-size:12px;color:#a9bcc2;align-self:center';
        button.parentElement.prepend(status);
      }
      if (status) status.textContent = button.title;
    }
  }
  function refreshUpdateCooldown() {
    const state = readUpdateState();
    const remaining = (state.githubManualAt || 0) + MANUAL_MS - Date.now();
    if (state.fallback && remaining > 0 && !isSavedAdmin(document)) showUpdateCooldown(remaining);
    else {
      const button = document.querySelector('.gbs-settings-check-updates');
      button?.removeAttribute('title');
      button?.parentElement?.querySelector('.gbs-update-cooldown')?.remove();
    }
  }
  let updateCheckPending = false;
  let updateCheckTimer = 0;
  let availableUpdateRelease = null;
  let confirmedUpdateVersion = null;
  let openedUpdateVersion = null;
  function confirmGenesysUpdateInstalled() {
    if (!availableUpdateRelease || openedUpdateVersion !== availableUpdateRelease.version) return;
    confirmedUpdateVersion = availableUpdateRelease.version;
    // Advance only the in-page comparison baseline. Never stop polling or
    // alter GM_info: subsequent releases remain detectable without reload.
    availableUpdateRelease = null;
    document.getElementById('gbs-official-update-notice')?.remove();
    syncGenesysUpdateControls();
  }
  function markGenesysUpdateOpened() {
    openedUpdateVersion = availableUpdateRelease?.version || null;
    // Temporary acknowledgement only: opening the installer is not proof
    // of installation. Memory resets on reload, restoring the GM_info check.
    confirmGenesysUpdateInstalled();
    if (confirmedUpdateVersion && typeof GM_info !== 'undefined') {
      showGenesysUpdateNotice(GM_info.script.version, null, true);
    }
  }
  const UPDATE_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2a10 10 0 0 1 7.38 16.75"/><path d="m16 12-4-4-4 4"/><path d="M12 16V8"/><path d="M2.5 8.875a10 10 0 0 0-.5 3"/><path d="M2.83 16a10 10 0 0 0 2.43 3.4"/><path d="M4.636 5.235a10 10 0 0 1 .891-.857"/><path d="M8.644 21.42a10 10 0 0 0 7.631-.38"/></svg>';

  function syncGenesysUpdateControls(doc = document) {
    if (doc.defaultView !== doc.defaultView.top) return;
    const wrapper = doc.querySelector('.gbs-theme-toggle-wrap');
    const gear = wrapper?.querySelector('.gbs-theme-toggle');
    let badge = wrapper?.querySelector('.gbs-update-badge');
    if (availableUpdateRelease && wrapper) {
      if (!badge) {
        badge = doc.createElement('span'); badge.className = 'gbs-update-badge';
        badge.textContent = '1'; badge.setAttribute('aria-hidden', 'true'); wrapper.appendChild(badge);
      }
      gear?.setAttribute('aria-label', 'Genesys V2 Settings — 1 update available');
    } else {
      badge?.remove(); gear?.setAttribute('aria-label', 'Genesys V2 Settings');
    }
    const footer = doc.querySelector('.gbs-settings-popover[data-gbs-settings-page="home"] .gbs-settings-footer');
    const body = doc.querySelector('.gbs-settings-popover[data-gbs-settings-page="home"] .gbs-settings-body');
    let link = body?.querySelector('.gbs-settings-update-link');
    if (availableUpdateRelease && footer) {
      if (!link) {
        link = doc.createElement('a'); link.className = 'gbs-settings-update-link';
        link.innerHTML = UPDATE_ICON + '<span>Click to update to latest version</span><span class="gbs-update-link-badge" aria-hidden="true">1</span>';
        link.target = '_blank'; link.rel = 'noopener noreferrer'; body.prepend(link);
        link.addEventListener('click', markGenesysUpdateOpened);
      }
      link.href = availableUpdateRelease.downloadUrl;
      link.title = `Update to ${availableUpdateRelease.version}`;
    } else link?.remove();
    let confirm = footer?.querySelector('.gbs-update-confirm');
    if (footer && availableUpdateRelease && openedUpdateVersion === availableUpdateRelease.version) {
      if (!confirm) {
        confirm = doc.createElement('button'); confirm.type = 'button'; confirm.className = 'gbs-update-confirm';
        confirm.textContent = "I've installed the update";
        confirm.title = 'Clear this reminder without reloading. The current page keeps running its existing code until refreshed.';
        confirm.addEventListener('click', confirmGenesysUpdateInstalled); footer.appendChild(confirm);
      }
    } else confirm?.remove();
  }

  function compareVersions(a, b) {
    const left = String(a).split('.').map(part => Number(part) || 0);
    const right = String(b).split('.').map(part => Number(part) || 0);
    const length = Math.max(left.length, right.length);

    for (let i = 0; i < length; i++) {
      if ((left[i] || 0) !== (right[i] || 0)) {
        return (left[i] || 0) - (right[i] || 0);
      }
    }

    return 0;
  }

  function showGenesysUpdateNotice(currentVersion, release, manual = false) {
    if (!document.body) return;
    document.getElementById('gbs-official-update-notice')?.remove();
    const host = document.createElement('aside');
    host.id = 'gbs-official-update-notice';
    host.style.cssText = 'position:fixed!important;right:16px!important;bottom:16px!important;z-index:2147483647!important;max-width:calc(100vw - 32px)!important';
    const root = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = ':host{font:14px/1.5 system-ui;color:#e6f7fa}.notice{box-sizing:border-box;width:320px;max-width:calc(100vw - 32px);padding:16px;background:#20262c;border:1px solid #22d3ee;border-radius:12px;box-shadow:0 8px 28px #0006}.title{font-weight:600;margin-right:24px}.close{position:absolute;right:12px;top:8px;border:0;background:none;color:#b9d1d6;cursor:pointer;font-size:22px}.versions{margin:8px 0}.download{display:inline-block;color:#a5f3fc;border:1px solid #22d3ee;border-radius:6px;padding:6px 12px;text-decoration:none}.download:hover{background:#0891b2;color:white}.hint{font-size:12px;color:#a9bcc2;margin-top:8px}';
    const box = document.createElement('div');
    box.className = 'notice'; box.setAttribute('role', 'status');
    const title = document.createElement('div'); title.className = 'title';
    title.textContent = release ? 'Genesys V2 update available' : confirmedUpdateVersion ? 'Reload page to apply the Update' : 'Genesys V2 is up to date';
    const versions = document.createElement('div'); versions.className = 'versions';
    versions.textContent = release ? `Current: ${currentVersion} · Available: ${release.version}` : confirmedUpdateVersion ? `Running: ${currentVersion} · Temporarily acknowledged: ${confirmedUpdateVersion}` : `Current: ${currentVersion}`;
    const close = document.createElement('button'); close.className = 'close'; close.type = 'button';
    close.textContent = '×'; close.setAttribute('aria-label', 'Dismiss update notification');
    close.addEventListener('click', () => host.remove());
    box.append(title, versions, close);
    if (!release && confirmedUpdateVersion) {
      const hint = document.createElement('div'); hint.className = 'hint';
      hint.textContent = 'After confirming installation in Tampermonkey, reload when it is safe. This page will not reload automatically.';
      box.appendChild(hint);
    }
    if (release) {
      const link = document.createElement('a'); link.className = 'download';
      link.textContent = 'Get update'; link.href = release.downloadUrl;
      link.target = '_blank'; link.rel = 'noopener noreferrer';
      link.addEventListener('click', markGenesysUpdateOpened);
      const hint = document.createElement('div'); hint.className = 'hint';
      hint.textContent = 'Opens the official download. Confirm installation in Tampermonkey; refresh Genesys afterward.';
      box.append(link, hint);
    }
    root.append(style, box); document.body.appendChild(host);
    if (!release) {
      // Informational only: clicking the card never reloads or navigates.
      // The X button retains its own immediate dismissal handler.
      host.addEventListener('click', event => event.stopPropagation());
      if (manual) window.setTimeout(() => host.remove(), confirmedUpdateVersion ? 60000 : 7000);
    }
  }

  async function checkGenesysUpdates(manual = false) {
    if (window !== window.top || updateCheckPending) return;
    if (typeof GM_xmlhttpRequest !== 'function' || typeof GM_info === 'undefined') return;
    const currentVersion = GM_info.script?.version;
    if (!/^\d+(?:\.\d+)*$/.test(String(currentVersion))) return;
    let state = readUpdateState();
    // Both sources enter the very same renderer, including cached updates
    // during network failures or when a different tab owns the request.
    applyCachedUpdate(state, manual);
    const now = Date.now();
    // Probe the primary once a minute while on fallback, or on an admin's
    // manual check. A valid primary response restores normal ten-second polling.
    const primaryProbe = state.fallback && (manual && isSavedAdmin(document)
      || !manual && now >= (state.primaryRecoveryAt || 0));
    if (state.fallback && !primaryProbe) {
      const due = manual ? (state.githubManualAt || 0) + MANUAL_MS : Math.max(state.githubAutoAt || 0, state.githubSuccessAt || 0) + HOUR_MS;
      const adminManual = manual && isSavedAdmin(document);
      if (now < due && !adminManual) { if (manual) { showUpdateCooldown(due - now); applyCachedUpdate(state, true); } return; }
    } else if (!primaryProbe && (state.primaryRetryAt ? now < state.primaryRetryAt : !manual && now - (state.primaryAt || 0) < 10000)) return;
    if (manual) {
      const button = document.querySelector('.gbs-settings-check-updates');
      if (button) {
        button.textContent = 'Check for updates'; button.removeAttribute('title');
        button.parentElement?.querySelector('.gbs-update-cooldown')?.remove();
      }
    }
    const oldLock = GM_getValue(UPDATE_LOCK_KEY, null);
    if (oldLock?.expires > now) return;
    updateCheckPending = true;
    const token = String(now) + Math.random().toString(36).slice(2);
    GM_setValue(UPDATE_LOCK_KEY, { token, expires: now + 20000 });
    // Shared GM storage is not atomic: settle simultaneous claims before
    // issuing a request, then only the final owner proceeds.
    await new Promise(resolve => window.setTimeout(resolve, 100));
    if (GM_getValue(UPDATE_LOCK_KEY, {})?.token !== token) { updateCheckPending = false; return; }
    state = readUpdateState();
    const fallback = state.fallback && !primaryProbe;
    const recovering = state.fallback && primaryProbe;
    const releaseLock = () => {
      updateCheckPending = false;
      if (GM_getValue(UPDATE_LOCK_KEY, {})?.token === token) GM_setValue(UPDATE_LOCK_KEY, null);
    };
    const warn = message => {
      const shared = readUpdateState();
      if (!fallback) {
        shared.failures = (shared.failures || 0) + 1;
        shared.primaryRetryAt = Date.now() + 10000;
        shared.lastPrimaryFailure = { at: Date.now(), reason: message };
        if (shared.failures >= 5) {
          shared.fallback = true; shared.primaryRetryAt = 0;
          shared.primaryRecoveryAt = Date.now() + 60000;
        }
      }
      GM_setValue(UPDATE_STATE_KEY, shared);
      releaseLock(); console.warn('[Genesys V2 update]', message);
      if (!fallback && shared.fallback) checkGenesysUpdates(false);
    };
    if (fallback) {
      state.githubAutoAt = now;
      if (manual) state.githubManualAt = now;
    } else {
      state.primaryAt = now;
      if (recovering) state.primaryRecoveryAt = now + 60000;
    }
    GM_setValue(UPDATE_STATE_KEY, state);
    try {
      GM_xmlhttpRequest({
        method: 'GET', url: fallback ? GITHUB_VERSION_URL : UPDATE_API_URL, headers: { Accept: 'application/json' },
        anonymous: true, nocache: true, timeout: 15000,
        onload(response) {
          if (response.status < 200 || response.status >= 300) { warn(`HTTP ${response.status}`); return; }
          try {
            const payload = JSON.parse(response.responseText);
            if (!Array.isArray(payload.releases)) throw new Error('Invalid release list');
            const release = payload.releases.find(item => item?.id === RELEASE_ID);
            if (!release || release.available === false) throw new Error('Missing or unavailable matching release');
            if (!/^\d+(?:\.\d+)*$/.test(String(release.version))) throw new Error('Invalid release version');
            const allowed = fallback ? GITHUB_INSTALL_URL : PRIMARY_INSTALL_URL;
            if (release.downloadUrl !== allowed) throw new Error('Invalid release download URL');
            const shared = readUpdateState();
            shared.failures = 0;
            shared.primaryRetryAt = fallback ? 0 : Date.now() + 10000;
            if (!fallback) {
              shared.lastPrimaryFailure = null;
              shared.fallback = false;
              shared.primaryRecoveryAt = 0;
            }
            shared.cached = { id: RELEASE_ID, version: release.version, downloadUrl: allowed, source: fallback ? 'github' : 'primary' };
            if (fallback) shared.githubSuccessAt = Date.now();
            GM_setValue(UPDATE_STATE_KEY, shared);
            releaseLock(); applyCachedUpdate(shared, manual);
            if (manual && !availableUpdateRelease) showGenesysUpdateNotice(currentVersion, null, true);
          } catch (error) { warn(error.message); }
        },
        onerror: () => warn('Network request failed'),
        ontimeout: () => warn('Request timed out'),
        onabort: () => warn('Request aborted')
      });
    } catch (error) { warn(error.message); }
  }

  function scheduleGenesysUpdateCheck() {
    if (window !== window.top) return;
    // Every new page execution starts with Drandox, even if another page
    // previously stored a GitHub fallback. Retain cache and GitHub cooldowns.
    const fresh = readUpdateState();
    fresh.fallback = false;
    fresh.failures = 0;
    fresh.primaryAt = fresh.primaryRetryAt = fresh.primaryRecoveryAt = 0;
    GM_setValue(UPDATE_STATE_KEY, fresh);
    const schedule = () => {
      if (!updateCheckTimer) updateCheckTimer = window.setInterval(() => {
        try { refreshUpdateCooldown(); } catch (error) { console.warn('[Genesys V2 update] Cooldown display', error); }
        // Shared timestamps keep normal primary requests ten seconds apart;
        // the one-second tick also services ten-second post-response delays.
        checkGenesysUpdates().catch(error => console.warn('[Genesys V2 update] Check failed', error));
      }, 1000);
    };
    // Do not wait for every Genesys iframe/resource to finish loading.
    schedule();
    window.addEventListener('pagehide', () => {
      window.clearInterval(updateCheckTimer); updateCheckTimer = 0;
    });
    window.addEventListener('pageshow', schedule);
  }

  const INTERVAL_MS = 1000;
  const POWER_MODE_KEY = 'genesys-v2-power-mode';
  function powerMode() {
    try { const mode = GM_getValue(POWER_MODE_KEY, 'auto'); return ['auto', 'full', 'low'].includes(mode) ? mode : 'auto'; } catch (_) { return 'auto'; }
  }
  function lowPowerMode() {
    const mode = powerMode();
    if (mode !== 'auto') return mode === 'low';
    return Boolean((navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4)
      || (navigator.deviceMemory && navigator.deviceMemory <= 4) || navigator.connection?.saveData);
  }
  function applyPowerMode(doc) {
    doc.documentElement.classList.toggle('gbs-low-power', lowPowerMode());
    doc.documentElement.classList.toggle('gbs-page-hidden', doc.hidden);
  }
  const STATUS_ORDER = [
    'Busy', 'Not Responding', 'Idle', 'Interacting', 'Break',
    'Meal', 'Available', 'Training', 'Meeting', 'Away'
  ];
  /* Single source of truth for every availability/queue label we handle.
     Future settings can persist a color override against these stable keys. */
  const STATUS_DEFINITIONS = Object.freeze({
    busy: { color: '#ff1744', group: 'busy' },
    chat: { color: '#ff1744', group: 'busy' },
    email: { color: '#ff1744', group: 'busy' },
    other: { color: '#ff1744', group: 'busy' },
    'outgoing-call': { color: '#ff1744', group: 'busy' },
    'remote-session': { color: '#ff1744', group: 'busy' },
    'technical-problem': { color: '#ff1744', group: 'busy' },
    idle: { color: '#39ff88', group: 'idle' },
    available: { color: '#6b7280', group: 'available' },
    interacting: { color: '#22d3ee', group: 'interacting' },
    'on-queue': { color: '#22d3ee', group: 'interacting' },
    'off-queue': { color: '#78716c', group: 'away' },
    break: { color: '#ffe600', group: 'break' },
    meal: { color: '#ff7a18', group: 'meal' },
    'not-responding': { color: '#a855f7', group: 'not-responding' },
    training: { color: '#0891b2', group: 'training' },
    meeting: { color: '#7c3aed', group: 'meeting' },
    away: { color: '#78716c', group: 'away' },
    'personal-reason': { color: '#78716c', group: 'away' },
    'out-of-office': { color: '#78716c', group: 'away' },
    'out-of-office-status': { color: '#78716c', group: 'away' },
    offline: { color: '#475569', group: 'offline' },
    unknown: { color: '#64748b', group: 'unknown' },
    custom: { color: '#64748b', group: 'unknown' }
  });
  const STATUS_COLOR_VARIABLES = Object.entries(STATUS_DEFINITIONS)
    .map(([key, definition]) => `--gbs-status-${key}: ${definition.color};`).join('\n      ');
  const STATUS_COLOR_GROUPS = Object.freeze(Object.entries(STATUS_DEFINITIONS).reduce((groups, [key, definition]) => {
    if (!groups[definition.group]) groups[definition.group] = { key, color: definition.color };
    return groups;
  }, {}));
  const PROFILE_STATUS_LABELS = Object.freeze({
    busy: ['Busy', 'Chat', 'Email', 'Other', 'Outgoing Call', 'Remote Session', 'Technical Problem'],
    idle: ['Idle'], available: ['Available'], interacting: ['Interacting', 'In Call'],
    'on-queue': ['On Queue'], 'off-queue': ['Off Queue'], break: ['Break'], meal: ['Meal'],
    'not-responding': ['Not Responding'], training: ['Training'], meeting: ['Meeting'],
    away: ['Away'], 'personal-reason': ['Personal Reason'],
    'out-of-office': ['Out of Office'], 'out-of-office-status': ['Out of Office Status'], offline: ['Offline']
  });
  const PROFILE_STATUS_SELECTOR_CSS = Object.entries(PROFILE_STATUS_LABELS).flatMap(([key, labels]) =>
    labels.map(label => `:root:has(#user-settings-button[aria-label$=", ${label}"]) { --gbs-my-status-color: var(--gbs-status-${key}); }`)
  ).join('\n    ');
  const STATUS_RANK = new Map(STATUS_ORDER.map((name, index) => [name.toLowerCase(), index]));
  const STYLE_ID = 'genesys-board-sorter-style-v1206';
  const SHADOW_STYLE_ID = 'genesys-board-sorter-shadow-style-v1206';
  const POPOVER_STYLE_ID = 'genesys-board-sorter-popover-style-v1206';
  const LIGHT_STYLE_ID = 'genesys-board-sorter-light-style-v1206';
  /* Canonical viewport names used for future changes:
     TINY  <= 1040px
     SMALL 1041px–1570px
     MEDIUM 1571px–2100px
     BIG   > 2100px */
  const SCREEN_BREAKPOINTS = Object.freeze({ tiny: 1040, small: 1570, medium: 2100 });
  const THEME_KEY = 'genesys-board-sorter-theme';
  const STATUS_COLOR_SETTINGS_KEY = 'genesys-board-sorter-status-colors';
  const BOARD_SETTINGS_KEY = 'genesys-v2-board-settings';
  const BOARD_COLUMNS = [
    ['Status Circle', '.column-agentPresence'], ['#', '.gbs-rank-header, .gbs-rank-cell'],
    ['Agent', '.column-agent'], ['Time', '.column-timeInStatus'],
    ['Status', '.column-status'], ['Duration', '.column-duration, .column-duration-one']
  ];
  function boardSettings(doc) {
    let saved = {};
    try { saved = JSON.parse(doc.defaultView.localStorage.getItem(BOARD_SETTINGS_KEY) || '{}'); } catch (_) {}
    const base = boardDefaultMetrics(doc);
    const padding = Number.isFinite(saved.rowPadding) ? saved.rowPadding : Number.isFinite(saved.heightOffset) ? 8 + (saved.heightOffset + 4) / 2 : 8;
    return { gap: Math.max(1, Math.min(13.5, Number(saved.gap) || base.gap)), fontOffset: Math.max(-5, Math.min(6, Number.isFinite(saved.fontOffset) ? saved.fontOffset : -1)), showYou: saved.showYou !== false, whiteNames: saved.whiteNames === true, rowPadding: Math.max(1, Math.min(13.5, padding)), padding: Math.max(1, Math.min(13.5, padding)), columns: BOARD_COLUMNS.map((_, index) => saved.columns?.[index] !== false) };
  }
  function boardDefaultMetrics(doc) {
    const width = doc.defaultView.innerWidth;
    if (doc.__gbsBoardDefaultMetrics?.width === width) return doc.__gbsBoardDefaultMetrics;
    let metrics = { width, gap: 4, padding: 0 };
    const frameDoc = [...collectReachableDocuments()].find(candidate => candidate.querySelector('table.gbs-board:not([aria-label="Board preview"])'));
    const table = frameDoc?.querySelector('table.gbs-board:not([aria-label="Board preview"])');
    const cell = table?.querySelector('td.column-agent');
    if (cell) {
      const preferenceStyle = frameDoc.getElementById('gbs-board-preferences');
      const disabled = preferenceStyle?.disabled;
      if (preferenceStyle) preferenceStyle.disabled = true;
      const style = frameDoc.defaultView.getComputedStyle(cell);
      metrics.padding = parseFloat(style.paddingTop) || 0;
      metrics.height = cell.getBoundingClientRect().height;
      metrics.lineHeight = parseFloat(style.lineHeight) || 18;
      // User-selected built-in spacing; native geometry is used only for
      // the height baseline, never to replace this chosen default.
      metrics.gap = 4;
      if (preferenceStyle) preferenceStyle.disabled = disabled;
      doc.__gbsBoardDefaultMetrics = metrics;
    }
    return metrics;
  }
  function boardEdgeCSS(settings) {
    const visible = BOARD_COLUMNS.filter((_, index) => settings.columns[index]);
    const edge = entry => entry[1].split(',').map(selector => `table.gbs-board tbody td${selector.trim()}`).join(',');
    return `table.gbs-board tbody td{border-radius:0!important;border-left-width:1px!important;border-right-width:1px!important}${visible.length ? `${edge(visible[0])}{border-left:4px solid var(--gbs-status)!important;border-top-left-radius:7px!important;border-bottom-left-radius:7px!important}${edge(visible[visible.length - 1])}{border-right:4px solid var(--gbs-status)!important;border-top-right-radius:7px!important;border-bottom-right-radius:7px!important}` : ''}`;
  }
  function applyBoardSettings(doc, settings = boardSettings(doc)) {
    if (themeMode(doc) === 'light') return;
    // Apply the selected built-in defaults even before preferences are saved.
    let style = doc.getElementById('gbs-board-preferences');
    if (!style) { style = doc.createElement('style'); style.id = 'gbs-board-preferences'; doc.head.appendChild(style); }
    const hidden = BOARD_COLUMNS.filter((_, index) => !settings.columns[index]).flatMap(([, selectors]) => selectors.split(',').map(selector => `table.gbs-board ${selector.trim()}`)).join(',');
    const tracks = ['32px', '26px', 'minmax(60px,2fr)', 'minmax(48px,1fr)', 'minmax(55px,1fr)', 'minmax(55px,1fr)'].filter((_, index) => settings.columns[index]).join(' ');
    const css = `table.gbs-board{border-spacing:0 ${settings.gap}px!important}table.gbs-board tbody{gap:${settings.gap}px!important}table.gbs-board tbody tr{margin:0!important;border-spacing:0!important}table.gbs-board tbody td{padding-top:${settings.padding}px!important;padding-bottom:${settings.padding}px!important}${hidden ? hidden + '{display:none!important}' : ''}${settings.columns.some(value => !value) ? `table.gbs-board thead tr,table.gbs-board tbody tr{display:grid!important;grid-template-columns:${tracks}!important}table.gbs-board th,table.gbs-board td{width:auto!important;min-width:0!important;max-width:none!important;box-sizing:border-box!important}` : ''}`;
    const height = 19 + (settings.fontOffset || 0) + 2 + 2 * (settings.rowPadding ?? 8);
    const customColumns = settings.columns.some(value => !value);
    doc.querySelectorAll('table.gbs-board:not([aria-label="Board preview"])').forEach(table => {
      if (table.classList.contains('gbs-custom-columns') !== customColumns) {
        delete table.dataset.gbsColumnWidths;
        table.__gbsResponsiveMetrics = null;
      }
      table.classList.toggle('gbs-custom-columns', customColumns);
    });
    const visibleCount = settings.columns.filter(Boolean).length;
    const customTracks = BOARD_COLUMNS.map((_, index) => index < 2 ? (index === 0 ? '32px' : '26px') : `minmax(0,${index === 2 ? 2 : 1}fr)`).filter((_,index) => settings.columns[index]).join(' ');
    const customCSS = customColumns ? `
      table.gbs-board.gbs-custom-columns thead tr,table.gbs-board.gbs-custom-columns tbody tr{display:grid!important;grid-template-columns:${customTracks}!important;width:100%!important;box-sizing:border-box!important}
      table.gbs-board.gbs-custom-columns tr>th,table.gbs-board.gbs-custom-columns tr>td{width:100%!important;min-width:0!important;max-width:none!important;display:flex!important;align-items:center!important;box-sizing:border-box!important;overflow:hidden!important}
      ${hidden.replaceAll('table.gbs-board ', 'table.gbs-board.gbs-custom-columns tr>')}{display:none!important}
      table.gbs-board.gbs-custom-columns tr>.column-agentPresence,table.gbs-board.gbs-custom-columns tr>.gbs-rank-cell,table.gbs-board.gbs-custom-columns tr>.gbs-rank-header,table.gbs-board.gbs-custom-columns tr>.column-status{justify-content:center!important}
      table.gbs-board.gbs-custom-columns thead tr{border-radius:7px!important;overflow:hidden!important}
      table.gbs-board.gbs-custom-columns thead tr>th{border-radius:0!important;text-align:left!important;justify-content:flex-start!important}
      table.gbs-board.gbs-custom-columns thead tr>th.column-agentPresence,table.gbs-board.gbs-custom-columns thead tr>th.gbs-rank-header,table.gbs-board.gbs-custom-columns thead tr>th.column-status{justify-content:center!important;text-align:center!important}
      table.gbs-board.gbs-custom-columns thead th .header-container{display:flex!important;position:relative!important;width:100%!important;min-width:0!important;align-items:center!important;justify-content:inherit!important}
      table.gbs-board.gbs-custom-columns thead th .header-container>.label-container{position:static!important;inset:auto!important;flex:1 1 auto!important;min-width:0!important;display:flex!important;justify-content:inherit!important;text-align:inherit!important}
      table.gbs-board.gbs-custom-columns thead th .column-header-components{position:static!important;flex:0 0 auto!important}
      table.gbs-board.gbs-custom-columns tbody td.column-agent>.hyperlink-cell{display:flex!important;align-items:center!important;flex:1 1 auto!important;width:100%!important;min-width:0!important;max-width:none!important;gap:6px!important}
      table.gbs-board.gbs-custom-columns tbody td.column-agent .hyperlink-cell>a{display:-webkit-box!important;flex:1 1 auto!important;width:auto!important;min-width:0!important;max-width:100%!important;white-space:normal!important;overflow-wrap:anywhere!important;-webkit-box-orient:vertical!important;-webkit-line-clamp:2!important;overflow:hidden!important;text-overflow:clip!important}
      table.gbs-board.gbs-custom-columns tbody tr>td{height:auto!important;min-height:${height}px!important}
      table.gbs-board.gbs-custom-columns tbody tr.gbs-name-wrapped>td{padding-top:0!important;padding-bottom:0!important;min-height:0!important}
      table.gbs-board.gbs-custom-columns tbody tr.gbs-current-agent:has(.gbs-current-agent-badge) td.column-agent>.hyperlink-cell{flex-wrap:wrap!important;gap:3px!important}
      table.gbs-board.gbs-custom-columns tbody tr.gbs-current-agent:has(.gbs-current-agent-badge)>td{padding-top:2px!important;padding-bottom:2px!important}
      table.gbs-board.gbs-custom-columns tbody td.column-agent .gbs-current-agent-badge{flex:0 0 auto!important;display:inline-flex!important;width:max-content!important;margin:0!important}
      table.gbs-board.gbs-custom-columns tbody td:not(.column-agent)>div{min-width:0!important;max-width:100%!important;flex:1 1 auto!important}
      ${boardEdgeCSS(settings).replaceAll('table.gbs-board', 'table.gbs-board.gbs-custom-columns')}
    ` : '';
    const fullCSS = css + `table.gbs-board tbody td{height:${height}px!important;min-height:${height}px!important;box-sizing:border-box!important}` + boardEdgeCSS(settings) + customCSS + 'table.gbs-board th{white-space:nowrap!important}table.gbs-board td.column-agentPresence{padding-left:0!important;padding-right:0!important;text-align:center!important}';
    // Saved live-Board preferences must never override the independently
    // edited preview (especially its changing number of grid tracks).
    const fontSize = 16 + (settings.fontOffset || 0);
    const fontCSS = `table.gbs-board{--gbs-user-font-size:${fontSize}px}table.gbs-board th,table.gbs-board td{font-size:var(--gbs-user-font-size)!important}table.gbs-board td.column-agent{font-size:var(--gbs-user-font-size)!important}table.gbs-board:not(.gbs-agent-font-scaled) td.column-agent a{font-size:inherit!important}table.gbs-board .gbs-current-agent-badge{${settings.showYou === false ? 'display:none!important;' : ''}}`;
    const lineCSS = `table.gbs-board tbody td{line-height:${fontSize + 3}px!important}table.gbs-board tbody td .hyperlink-cell,table.gbs-board tbody td .hyperlink-cell a,table.gbs-board tbody td .unescaped-html,table.gbs-board tbody td .unescaped-html-cell,table.gbs-board tbody td .cell-display-text,table.gbs-board tbody td .idle-timer,table.gbs-board tbody td .conversation-duration-cell-v2{line-height:inherit!important}table.gbs-board tbody td.column-agentPresence .entity-wrapper,table.gbs-board tbody td.column-agentPresence .entity-v3,table.gbs-board tbody td.column-agentPresence .entity-v3-hover-card,table.gbs-board tbody td.column-agentPresence .mini-card-component-wrapper{min-height:0!important}`;
    const wrappedCSS = 'table.gbs-board tbody tr.gbs-name-wrapped>td{padding-top:0!important;padding-bottom:0!important;height:auto!important;min-height:0!important}table.gbs-board.gbs-current-agent-badge-stacked tbody tr.gbs-current-agent:has(.gbs-current-agent-badge)>td{padding-top:2px!important;padding-bottom:2px!important;height:auto!important;min-height:0!important}';
    const circleSize = Math.min(18, 14 + Math.max(0, (settings.rowPadding ?? 8) - 1) * 2);
    const circleCSS = `table.gbs-board td.column-agentPresence .entity-v3-presence-indicator-dot{width:${circleSize}px!important;height:${circleSize}px!important;min-width:${circleSize}px!important;min-height:${circleSize}px!important;box-sizing:border-box!important;transition:width 120ms ease,height 120ms ease!important}`;
    const durationPaddingCSS = 'table.gbs-board tbody tr.gbs-duration-wrapped>td{padding-top:2px!important;padding-bottom:2px!important;height:auto!important;min-height:0!important}';
    const liveCSS = (fullCSS + fontCSS + lineCSS + wrappedCSS + durationPaddingCSS + circleCSS + boardNameColorCSS(settings)).replaceAll('table.gbs-board', 'table.gbs-board:not([aria-label="Board preview"])');
    if (style.textContent !== liveCSS) style.textContent = liveCSS;
  }
  function boardNameColorCSS(settings) {
    if (!settings.whiteNames) return '';
    // Keep the YOU badge and status indicators in their own status colours.
    return 'table.gbs-board tbody tr[class] td.gbs-rank-cell,table.gbs-board tbody tr[class] td.gbs-rank-cell *,table.gbs-board tbody tr[class] td.column-agent,table.gbs-board tbody tr[class] td.column-agent a,table.gbs-board tbody tr[class] td.column-agent span:not(.gbs-current-agent-badge){color:#fff!important}';
  }
  const CURRENT_AGENT_KEY = 'genesys-board-sorter-current-agent-name';
  const RESIZE_KEY_PREFIX = 'genesys-board-sorter-sidebar-width:';
  const RESIZE_RATIO_KEY_PREFIX = 'genesys-board-sorter-sidebar-ratio:';
  const INTERACTION_RAIL_WIDTH_KEY = 'genesys-board-sorter-interaction-rail-width';
  const SELECTED_INTERACTION_RATIO_KEY = 'genesys-board-sorter-selected-interaction-ratio-v2';
  const AGENT_PANEL_WIDTH_KEY = 'genesys-board-sorter-agent-panel-width';
  const WORKSPACE_DASHBOARD_STATE_KEY_PREFIX = 'genesys-board-sorter-workspace-dashboard-state:';
  // One requested clean-slate migration: reset sizing only, never appearance,
  // status colours, dashboard visibility choice, or the current-agent record.
  const LAYOUT_DEFAULTS_RESET_KEY = 'genesys-board-sorter-layout-defaults-reset-v1435';

  function resetLayoutPreferencesOnce(doc) {
    let alreadyReset = false;
    try { alreadyReset = GM_getValue(LAYOUT_DEFAULTS_RESET_KEY, false) === true; } catch (_) { /* GM unavailable */ }
    try { alreadyReset = alreadyReset || doc.defaultView.localStorage.getItem(LAYOUT_DEFAULTS_RESET_KEY) === 'true'; } catch (_) { /* storage unavailable */ }
    if (alreadyReset) return;

    const exactKeys = new Set([
      AGENT_PANEL_WIDTH_KEY,
      INTERACTION_RAIL_WIDTH_KEY,
      'genesys-board-sorter-summary-card-scale',
    ]);
    const isLayoutKey = key => exactKeys.has(key) || key.startsWith(RESIZE_KEY_PREFIX) || key.startsWith(RESIZE_RATIO_KEY_PREFIX);
    try {
      if (typeof GM_listValues === 'function' && typeof GM_deleteValue === 'function') {
        GM_listValues().filter(isLayoutKey).forEach(key => GM_deleteValue(key));
      } else if (typeof GM_deleteValue === 'function') {
        exactKeys.forEach(key => GM_deleteValue(key));
      }
    } catch (_) { /* userscript storage unavailable */ }
    try {
      const storage = doc.defaultView.localStorage;
      Object.keys(storage).filter(isLayoutKey).forEach(key => storage.removeItem(key));
      storage.setItem(LAYOUT_DEFAULTS_RESET_KEY, 'true');
    } catch (_) { /* page storage unavailable */ }
    try { if (typeof GM_setValue === 'function') GM_setValue(LAYOUT_DEFAULTS_RESET_KEY, true); } catch (_) { /* userscript storage unavailable */ }
  }

  function readPersistentNumber(doc, key) {
    try {
      if (typeof GM_getValue === 'function') {
        const value = Number(GM_getValue(key, 0));
        if (Number.isFinite(value) && value > 0) return value;
      }
    } catch (_) { /* userscript storage unavailable */ }
    try { return Number(doc.defaultView.localStorage.getItem(key)) || 0; } catch (_) { return 0; }
  }

  function writePersistentNumber(doc, key, value) {
    try { if (typeof GM_setValue === 'function') GM_setValue(key, value); } catch (_) { /* userscript storage unavailable */ }
    try { doc.defaultView.localStorage.setItem(key, String(value)); } catch (_) { /* page storage unavailable */ }
  }

  function readPersistentText(doc, key) {
    try {
      if (typeof GM_getValue === 'function') {
        const value = GM_getValue(key, '');
        if (typeof value === 'string' && value) return value;
      }
    } catch (_) { /* userscript storage unavailable */ }
    try { return doc.defaultView.localStorage.getItem(key) || ''; } catch (_) { return ''; }
  }

  function writePersistentText(doc, key, value) {
    try { if (typeof GM_setValue === 'function') GM_setValue(key, value); } catch (_) { /* userscript storage unavailable */ }
    try { doc.defaultView.localStorage.setItem(key, value); } catch (_) { /* page storage unavailable */ }
  }
  // Documents are discovered once, then refreshed directly. Rewalking every
  // element and shadow root once per second was the largest avoidable cost.
  const MANAGED_DOCUMENTS = new Set();
  const EMBEDDED_FRAME_LOAD_HOOKS = new WeakSet();
  const PAGE_WINDOW = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

  // Genesys' current Ember loader is only briefly public during bootstrap and
  // is removed before the command bar is rendered. Capture the reference at
  // document-start without replacing or wrapping the loader so the Agent
  // Workspace command can later use its native compact-open API.
  function installNativeRuntimeBridge() {
    try {
      const doc = PAGE_WINDOW.document;
      if (PAGE_WINDOW.__gbsNativeRuntimeBridge || !doc.documentElement) return;
      PAGE_WINDOW.__gbsNativeRuntimeBridge = true;
      const bridge = doc.createElement('script');
      bridge.textContent = `(() => {
        const runtime = window.__gbsNativeRuntime || (window.__gbsNativeRuntime = {});
        const capture = () => {
          try {
            if (typeof window.require === 'function') runtime.require = window.require;
            if (typeof window.define === 'function') runtime.define = window.define;
          } catch (_) { /* The application may still be constructing globals. */ }
          if (runtime.require) clearInterval(timer);
        };
        let timer = 0;
        capture();
        timer = setInterval(capture, 4);
        setTimeout(() => clearInterval(timer), 15000);
      })();`;
      (doc.head || doc.documentElement).appendChild(bridge);
      bridge.remove();
    } catch (_) { /* Native action fallback remains available. */ }
  }
  if (themeMode(document) !== 'light') installNativeRuntimeBridge();

  function accessibleFrameDocument(frame) {
    try {
      const directDocument = frame?.contentDocument;
      if (directDocument) return directDocument;
    } catch (_) { /* try page realm below */ }
    try {
      const localFrames = Array.from(frame?.ownerDocument?.querySelectorAll?.('iframe') || []);
      const index = localFrames.indexOf(frame);
      const pageFrame = index >= 0 ? PAGE_WINDOW.document.querySelectorAll('iframe')[index] : null;
      return pageFrame?.contentDocument || null;
    } catch (_) { return null; }
  }

  const STARTUP_LOADER_CSS = `
    /* The loading scene is fully opaque so no native shell surface can bleed
       through before the coordinated exit animation begins. */
    #gbs-startup-loader { position: fixed; isolation: isolate; inset: 0; z-index: 2147483646; display: grid; place-items: center; overflow: hidden; pointer-events: none; background: #060a12; color: #e5e7eb; opacity: 1; transition: opacity .34s ease, visibility .34s ease; }
    /* Keep large native application iframes alive, sized, and painted below
       the startup scene. Do not use display:none, visibility:hidden, zero
       dimensions, or a second hidden iframe: all can defer rendering or make
       Genesys initialize an extra application. Opacity alone retains the
       frame's normal geometry and lets it be revealed without a re-navigation. */
    html.gbs-startup-covering iframe.gbs-startup-prepaint { opacity: 0 !important; pointer-events: none !important; transform: translateZ(0); will-change: opacity; transition: opacity .26s ease-out !important; }
    /* The application iframe may prepare in the background, but the native
       command shell should not flash in ahead of the startup scene. */
    html.gbs-startup-menu-hidden .command-bar,
    html.gbs-startup-menu-hidden .command-nav,
    html.gbs-startup-menu-hidden .global-actions,
    html.gbs-startup-menu-hidden #navigation-menu { opacity: 0 !important; pointer-events: none !important; transition: opacity .26s ease-out !important; }
    #gbs-startup-loader.gbs-startup-ready { pointer-events: none; animation: gbs-loader-warp-out .78s cubic-bezier(.55,0,.2,1) forwards; }
    #gbs-startup-loader.gbs-startup-complete .gbs-startup-card { animation: gbs-card-ready-pulse .42s cubic-bezier(.2,.8,.2,1) both; }
    #gbs-startup-loader.gbs-startup-ready .gbs-startup-card { animation: gbs-card-warp-out .58s cubic-bezier(.2,.75,.2,1) forwards; }
    #gbs-startup-loader.gbs-startup-ready .gbs-startup-space { animation: gbs-stars-warp-out .7s cubic-bezier(.2,.8,.25,1) forwards; }
    #gbs-startup-loader .gbs-startup-space { position: absolute; inset: 0; z-index: -2; opacity: .9; background-image: radial-gradient(1px 1px at 15% 20%, #fff, transparent 70%), radial-gradient(1px 1px at 72% 18%, #bff8ff, transparent 70%), radial-gradient(1.5px 1.5px at 86% 63%, #fff, transparent 70%), radial-gradient(1px 1px at 31% 77%, #83eaff, transparent 70%), radial-gradient(1px 1px at 57% 47%, #fff, transparent 70%), radial-gradient(1px 1px at 12% 63%, #b9d7ff, transparent 70%); background-size: 210px 210px, 310px 310px, 380px 380px, 260px 260px, 440px 440px, 520px 520px; }
    #gbs-startup-loader .gbs-startup-space i { position: absolute; width: 2px; height: 2px; border-radius: 50%; background: #d9fbff; box-shadow: 0 0 8px 2px rgba(34,211,238,.7); animation: gbs-shooting-star 3.6s cubic-bezier(.15,.8,.25,1) infinite; }
    #gbs-startup-loader .gbs-startup-space i:nth-child(1) { left: 8%; top: 15%; animation-delay: -.8s; } #gbs-startup-loader .gbs-startup-space i:nth-child(2) { left: 66%; top: 28%; animation-delay: -2.1s; } #gbs-startup-loader .gbs-startup-space i:nth-child(3) { left: 38%; top: 77%; animation-delay: -3s; }
    #gbs-startup-loader .gbs-startup-nebula { position: absolute; z-index: -1; width: min(72vw, 920px); aspect-ratio: 1; border-radius: 50%; background: radial-gradient(circle, rgba(14,165,233,.16), rgba(34,211,238,.045) 35%, transparent 68%); }
    #gbs-startup-loader .gbs-startup-card { width: min(380px, calc(100vw - 48px)); text-align: center; padding: 34px 34px 28px; border: 1px solid rgba(103,232,249,.32); border-radius: 22px; background: linear-gradient(145deg, #162030, #070d18); box-shadow: 0 22px 70px rgba(0,0,0,.58), inset 0 1px 0 rgba(255,255,255,.06), 0 0 42px rgba(34,211,238,.13); }
    #gbs-startup-loader .gbs-startup-orbit { position: relative; width: 82px; height: 82px; display: grid; place-items: center; margin: 0 auto 18px; border: 1px solid rgba(103,232,249,.55); border-radius: 50%; box-shadow: 0 0 24px rgba(34,211,238,.23), inset 0 0 20px rgba(34,211,238,.11); animation: gbs-orbit 4.2s linear infinite; }
    #gbs-startup-loader .gbs-startup-orbit::before, #gbs-startup-loader .gbs-startup-orbit::after { content: ''; position: absolute; width: 7px; height: 7px; border-radius: 50%; background: #cffafe; box-shadow: 0 0 12px 3px #22d3ee; }
    #gbs-startup-loader .gbs-startup-orbit::before { transform: translateX(41px); } #gbs-startup-loader .gbs-startup-orbit::after { transform: translateX(-41px); opacity: .55; }
    .gbs-v2-logo { display: inline-block; width: 42px; height: 42px; flex: 0 0 42px; background: center / contain no-repeat url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Ccircle cx='32' cy='11' r='7' fill='%2322d3ee'/%3E%3Crect x='10' y='24' width='44' height='18' rx='9' fill='none' stroke='%2322d3ee' stroke-width='6'/%3E%3Crect x='17' y='48' width='30' height='11' rx='5.5' fill='%2322d3ee'/%3E%3C/svg%3E"); filter: drop-shadow(0 0 9px rgba(34,211,238,.62)); animation: gbs-logo-breathe 2.4s ease-in-out infinite; }
    #gbs-startup-loader .gbs-startup-name { font-size: 25px; line-height: 1.1; font-weight: 760; letter-spacing: .035em; text-shadow: 0 0 22px rgba(103,232,249,.36); }
    #gbs-startup-loader .gbs-startup-kicker { margin-top: 7px; color: #67e8f9; font-size: 10px; font-weight: 700; letter-spacing: .21em; }
    #gbs-startup-loader .gbs-startup-phase { margin-top: 21px; min-height: 18px; color: #b8c7db; font-size: 13px; }
    #gbs-startup-loader .gbs-startup-track { height: 6px; margin-top: 14px; overflow: hidden; border: 1px solid rgba(125,211,252,.22); border-radius: 999px; background: rgba(2,6,23,.65); box-shadow: inset 0 1px 4px rgba(0,0,0,.62); }
    #gbs-startup-loader .gbs-startup-fill { width: 0%; height: 100%; border-radius: inherit; background: linear-gradient(90deg, #0ea5e9, #67e8f9 55%, #e0f2fe); box-shadow: 0 0 16px rgba(34,211,238,.8); transition: width .5s cubic-bezier(.22,1,.36,1); }
    #gbs-startup-loader .gbs-startup-percent { margin-top: 9px; text-align: right; color: #dbeafe; font-size: 12px; font-variant-numeric: tabular-nums; }
    @keyframes gbs-star-drift { to { transform: translate3d(-90px, 70px, 0); } } @keyframes gbs-star-pulse { to { opacity: .55; } } @keyframes gbs-nebula { to { transform: scale(1.15) rotate(15deg); filter: blur(16px); } } @keyframes gbs-orbit { to { transform: rotate(360deg); } } @keyframes gbs-logo-breathe { 50% { transform: scale(1.08); filter: drop-shadow(0 0 15px rgba(34,211,238,.88)); } } @keyframes gbs-shooting-star { 0%, 16% { opacity: 0; transform: translate3d(0,0,0) scale(.3); } 22% { opacity: 1; } 45%, 100% { opacity: 0; transform: translate3d(180px,110px,0) scale(1); } } @keyframes gbs-loader-warp-out { 0% { opacity: 1; clip-path: circle(150% at 50% 50%); } 100% { opacity: 0; clip-path: circle(0% at 50% 50%); } } @keyframes gbs-loader-fade-out { to { opacity: 0; } } @keyframes gbs-card-ready-pulse { 50% { transform: scale(1.025); border-color: rgba(165,243,252,.84); box-shadow: 0 22px 70px rgba(0,0,0,.58), 0 0 62px rgba(34,211,238,.48); } } @keyframes gbs-card-warp-out { 55% { transform: scale(1.035); filter: brightness(1.3); } 100% { opacity: 0; transform: scale(.36); filter: brightness(1.8) blur(2px); } } @keyframes gbs-stars-warp-out { to { opacity: 0; transform: scale(2.5); filter: blur(2px); } }
    @media (prefers-reduced-motion: reduce) { #gbs-startup-loader *, #gbs-startup-loader *::before, #gbs-startup-loader *::after { animation: none !important; } #gbs-startup-loader.gbs-startup-ready { animation: gbs-loader-fade-out .28s ease-out forwards !important; } }
  `;

  function installStartupLoader() {
    // The login domain has its own lightweight login scene.  Do not start the
    // authenticated application's Dashboard/iframe loader there.
    if (location.hostname === 'login.mypurecloud.de') return;
    // One bounded timer only: no mutation observer and no recursive animation
    // frames. Genesys creates thousands of nodes while it boots, so reacting to
    // each node is both unnecessary and can make Chrome unresponsive.
    let isTopLevel = true;
    try { isTopLevel = window.top === window; } catch (_) {}
    const isDashboardRoute = () => /\/analytics\/dashboards\b/i.test(`${location.pathname}${location.hash}`);

    // The embedded Analytics application already has local Board/Dashboard
    // loaders. The cinematic scene must never run nor poll inside that iframe.
    if (!isTopLevel) return;

    if (document.getElementById('gbs-startup-loader-style')) return;
    const style = document.createElement('style');
    style.id = 'gbs-startup-loader-style';
    style.textContent = STARTUP_LOADER_CSS;
    document.documentElement.appendChild(style);
    const mount = () => {
      if (document.getElementById('gbs-startup-loader')) return;
      const loader = document.createElement('div');
      loader.id = 'gbs-startup-loader';
      loader.innerHTML = '<div class="gbs-startup-space" aria-hidden="true"><i></i><i></i><i></i></div><div class="gbs-startup-nebula" aria-hidden="true"></div><div class="gbs-startup-card" role="status" aria-live="polite"><div class="gbs-startup-orbit" aria-hidden="true"><span class="gbs-v2-logo"></span></div><div class="gbs-startup-name">Genesys V2</div><div class="gbs-startup-kicker">INITIALIZING WORKSPACE</div><div class="gbs-startup-phase">Starting application…</div><div class="gbs-startup-track"><div class="gbs-startup-fill"></div></div><div class="gbs-startup-percent">0%</div></div>';
      document.body.appendChild(loader);
      document.documentElement.classList.add('gbs-startup-covering', 'gbs-startup-menu-hidden');
      const fill = loader.querySelector('.gbs-startup-fill');
      const label = loader.querySelector('.gbs-startup-phase');
      const percent = loader.querySelector('.gbs-startup-percent');
      let current = 0;
      let visualProgress = 0;
      const setProgress = (value, phase) => {
        current = Math.max(current, value);
        if (phase) label.textContent = phase;
      };
      const paintProgress = () => {
        const distance = current - visualProgress;
        if (distance <= 0) return;
        // Ease the displayed value toward each real readiness milestone rather
        // than jumping straight from 0 to 62 when the iframe route mounts.
        visualProgress = Math.min(current, visualProgress + Math.max(.18, distance * .18));
        const shown = Math.round(visualProgress);
        fill.style.width = `${shown}%`;
        percent.textContent = `${shown}%`;
      };
      const startedAt = Date.now();
      const startupTimingKey = 'gbs-startup-dashboard-duration-v1';
      let learnedDashboardDuration = 18000;
      try {
        const savedDuration = Number(window.localStorage.getItem(startupTimingKey));
        if (Number.isFinite(savedDuration)) learnedDashboardDuration = Math.max(7000, Math.min(60000, savedDuration));
      } catch (_) {}
      let timer = 0;
      let dashboardDetected = false;
      let iframeLoaded = false;
      let watchedIframe = null;
      let embeddedDashboardReady = false;
      let embeddedBoardReady = false;
      let analyticsWarmed = false;
      let finished = false;
      const prepareLargeFrames = () => {
        document.querySelectorAll('iframe').forEach(frame => {
          const router = frame.closest('frame-router, .main-iframe');
          const rect = frame.getBoundingClientRect();
          if (router || (rect.width >= 360 && rect.height >= 220)) frame.classList.add('gbs-startup-prepaint');
        });
      };
      const receiveEmbeddedReadiness = event => {
        if (!event.data || event.data.type !== 'gbs-startup-component-ready') return;
        if (watchedIframe?.contentWindow && event.source !== watchedIframe.contentWindow) return;
        if (event.data.kind === 'Dashboard') embeddedDashboardReady = true;
        if (event.data.kind === 'Board') embeddedBoardReady = true;
      };
      window.addEventListener('message', receiveEmbeddedReadiness);
      const finish = () => {
        if (finished) return;
        finished = true;
        window.removeEventListener('message', receiveEmbeddedReadiness);
        // Reveal the actual already-painted applications underneath the
        // departure animation, then remove all temporary paint hints.
        const successfulDuration = Date.now() - startedAt;
        if (dashboardDetected) {
          try {
            const blendedDuration = Math.round((learnedDashboardDuration * .65) + (successfulDuration * .35));
            window.localStorage.setItem(startupTimingKey, String(Math.max(7000, Math.min(60000, blendedDuration))));
          } catch (_) {}
        }
        setProgress(100, dashboardDetected ? 'Dashboard ready' : 'Workspace ready');
        loader.classList.add('gbs-startup-complete');
        // Let the final segment arrive visibly before the portal-like exit.
        const finalPaint = window.setInterval(paintProgress, 55);
        window.setTimeout(() => {
          window.clearInterval(timer);
          window.clearInterval(finalPaint);
          fill.style.width = '100%';
          percent.textContent = '100%';
          // Start showing the prepared iframe behind the portal exit now.
          // Keeping it invisible until the loader is removed created the
          // grey empty hand-off that was visible for a brief moment.
          document.documentElement.classList.remove('gbs-startup-covering');
          document.documentElement.classList.remove('gbs-startup-menu-hidden');
          document.querySelectorAll('iframe.gbs-startup-prepaint').forEach(frame => frame.classList.remove('gbs-startup-prepaint'));
          loader.classList.add('gbs-startup-ready');
        }, 540);
        window.setTimeout(() => {
          loader.remove();
        }, 1420);
      };
      const checkReady = () => {
        if (finished) return;
        const menu = document.querySelector('.command-bar, [data-test-id="command-bar-agent"]');
        const shell = document.querySelector('.command-view, main.center-stage');
        // Dashboard readiness must come from its Analytics iframe. The outer
        // Genesys shell can retain stale/similarly named elements while a new
        // tab is still mounting, which otherwise lets the loader exit early.
        let dashboardWidget = null;
        let board = null;
        let nativeDashboardWidget = null;
        let nativeBoard = null;
        let genericDashboardReady = false;
        const dashboardFrame = [...document.querySelectorAll('frame-router[route]')]
          .find(frame => /\/analytics\/dashboards\b/i.test(frame.getAttribute('route') || ''));
        const dashboardRouteMounted = !!dashboardFrame;
        const iframe = dashboardFrame?.querySelector('iframe');
        prepareLargeFrames();
        if (iframe && iframe !== watchedIframe) {
          watchedIframe = iframe;
          iframe.loading = 'eager';
          iframe.setAttribute('loading', 'eager');
          const markRealFrameLoad = () => {
            try {
              const href = iframe.contentWindow?.location?.href || '';
              if (!href || href === 'about:blank') return;
            } catch (_) {
              // A cross-origin access error also proves that navigation left
              // the initial about:blank document.
            }
            iframeLoaded = true;
          };
          iframe.addEventListener('load', markRealFrameLoad);
          markRealFrameLoad();

          // Let Genesys' own frame-router own navigation. Forcing iframe.src
          // was fast on first load but could race route changes (Profile →
          // Analytics) and leave a transient failed native application.
        }
        // The Homepage lives in a same-origin Analytics iframe. Outer-document
        // selectors can never see its widgets or Board, so the old code fell
        // back to the iframe's early HTML `load` event and removed this screen
        // several seconds too soon. Read the actual child document instead.
        if (iframe) {
          try {
            const frameDocument = accessibleFrameDocument(iframe);
            const href = frameDocument?.location?.href || '';
            if (frameDocument && href && href !== 'about:blank') {
              // The list and ordinary dashboards do not necessarily contain
              // an agent Board. Evaluate the actual active Analytics route.
              const frameRoute = frameDocument.location.hash.split('?')[0];
              const shown = node => node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0;
              const busy = [...frameDocument.querySelectorAll('[aria-busy="true"], .loading-spinner, .gbs-component-loader')].some(shown);
              const listRoute = /^#\/dashboards\/?$/.test(frameRoute);
              const listRendered = listRoute && [...frameDocument.querySelectorAll('gux-table, table, [role="table"]')].some(shown);
              const detailRoute = /^#\/dashboards\/[^/]+\/?$/.test(frameRoute);
              const detailRendered = detailRoute && [...frameDocument.querySelectorAll('.analytics-ui-dashboard-detail-display, .dashboard-fullscreen-target, .analytics-view-dashboard-detail')].some(shown);
              genericDashboardReady = !busy && (listRendered || detailRendered) && Date.now() - startedAt > 2400;
              // The Dashboard creates widgets and the Board table before its
              // own local overlays finish. Require the explicit settled marks
              // created by finishComponentLoad(), not merely their presence.
              dashboardWidget ||= frameDocument.querySelector(
                '.main-grid[data-gbs-component-ready="true"] .analytics-ui-dashboard-widget, .main-grid[data-gbs-component-ready="true"] .widget-container .js-draggableObject'
              );
              board ||= frameDocument.querySelector(
                '.grid-sidebar[data-gbs-component-ready="true"] table.gbs-board, .gbs-sidebar[data-gbs-component-ready="true"] table.gbs-board'
              );
              // Some Analytics frame navigations do not run the enhancement
              // bootstrap inside the new document. Its native widgets and
              // table are still authoritative once both have rendered, so do
              // not strand the full-screen loader at 99% awaiting markers
              // that can never be created in that frame instance.
              nativeDashboardWidget ||= frameDocument.querySelector(
                '.main-grid .analytics-ui-dashboard-widget, .main-grid .widget-container .js-draggableObject'
              );
              nativeBoard ||= frameDocument.querySelector(
                '.grid-sidebar table, .gbs-sidebar table, .grid-sidebar gux-table table, .gbs-sidebar gux-table table'
              );
            }
          } catch (_) { /* contextual frame may have navigated */ }
        }
        dashboardWidget ||= embeddedDashboardReady ? true : null;
        board ||= embeddedBoardReady ? true : null;
        // `.main-grid` is also used by the generic Analytics landing/error
        // screen. Only an explicit Dashboard URL or Dashboard frame-router is
        // allowed to enter the Board-specific 99% readiness path.
        if (dashboardRouteMounted || isDashboardRoute()) dashboardDetected = true;
        // Only Dashboard routes may warm Analytics. Previously this ran on
        // every Genesys page, including Profile and Connections iframes.
        if (dashboardDetected && !analyticsWarmed) {
          analyticsWarmed = true;
          try {
            const analyticsEntry = new URL('/analytics-ui/', location.origin);
            fetch(analyticsEntry, {
              credentials: 'include',
              cache: 'force-cache',
              priority: 'high'
            }).catch(() => {});
          } catch (_) {}
        }
        if (document.readyState !== 'loading') setProgress(15, 'Starting Genesys…');
        if (menu) setProgress(30, 'Loading navigation…');
        if (shell) setProgress(48, 'Preparing workspace…');
        if (dashboardDetected) setProgress(62, 'Entering dashboard…');
        if (iframeLoaded) setProgress(76, 'Dashboard is loading…');
        if (dashboardWidget) setProgress(86, 'Dashboard is loading…');
        if (board || embeddedBoardReady || window.__gbsStartupEmbeddedBoardReady) setProgress(94, 'Preparing Board…');
        const elapsed = Date.now() - startedAt;
        // While Analytics is genuinely still rendering, approach 99% slowly
        // but never claim completion until both Dashboard and Board signal it.
        const enhancedDashboardReady = !!(dashboardWidget && (board || embeddedBoardReady || window.__gbsStartupEmbeddedBoardReady));
        // Native readiness is deliberately delayed beyond the frame's first
        // paint. This keeps the loading scene up during an empty/mounting
        // iframe, yet releases it when Genesys has visibly rendered both the
        // Dashboard cards and its actual Board table.
        const nativeDashboardReady = !!(iframeLoaded && nativeDashboardWidget && nativeBoard && elapsed > 2400);
        const dashboardReady = enhancedDashboardReady || nativeDashboardReady || genericDashboardReady;
        if (dashboardDetected && !dashboardReady) {
          const interval = Math.max(360, (learnedDashboardDuration - 1800) / 23);
          const slowTarget = Math.min(99, 76 + Math.floor(Math.max(0, elapsed - 1800) / interval));
          setProgress(slowTarget, 'Dashboard is loading…');
        }
        paintProgress();
        // Navigation and the iframe HTML load are only intermediate milestones.
        // Reveal Homepage after its widgets and enhanced Board both exist.
        const nonDashboardReady = !dashboardDetected && menu && shell && elapsed > 1800;
        // Keep a distant fail-safe for a genuine Genesys load failure, while
        // allowing normal slow sessions to stay covered until Homepage exists.
        if ((dashboardDetected && dashboardReady) || nonDashboardReady || elapsed > 90000) finish();
      };
      checkReady();
      timer = window.setInterval(checkReady, 120);
    };
    if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount, { once: true });
  }
  if (themeMode(document) !== 'light') installStartupLoader();

  function installNativeAppErrorRecovery() {
    const fallbackUrl = 'https://apps.mypurecloud.de/directory/#/analytics/dashboards/4bbdbd2a-1114-4bd9-b40c-5ae6663f6647';
    const errorPattern = /App\s+could\s+not\s+be\s+loaded\.\s*Please\s+try\s+again\s+later\.?|^(?:Page not found|This page (?:does not exist|could not be found)|404(?:\s+Not Found)?)$/im;
    let reloading = false;
    let observer = null;
    const recoveryStarted = Date.now();
    const recoverIfNeeded = () => {
      if (reloading || !document.body) return;
      const stalledPerson = window === window.top && /^#\/person\//.test(location.hash)
        && document.readyState === 'complete' && Date.now() - recoveryStarted > 20000
        && !document.querySelector('.command-view, main.center-stage');
      if (!stalledPerson && !errorPattern.test(document.body.innerText || '')) return;
      // Child applications can report a broken route; recover the top shell,
      // never navigate an individual call iframe or an external destination.
      let topWindow = window;
      let topHref = location.href;
      try {
        topWindow = window.top || window;
        topHref = topWindow.location.href || topHref;
      } catch (_) {}
      if (!topHref.startsWith('https://apps.mypurecloud.de/directory/')
        || topHref.split('?')[0] === fallbackUrl) return;
      const recoveryKey = 'gbs-dashboard-fallback-redirect-v1';
      let attempts = 0;
      try { attempts = Number(topWindow.sessionStorage.getItem(recoveryKey) || '0'); } catch (_) {}
      // One automatic fallback per tab session prevents bouncing between
      // failing routes when Genesys itself is unavailable.
      if (attempts >= 1) {
        observer?.disconnect();
        return;
      }
      reloading = true;
      try { topWindow.sessionStorage.setItem(recoveryKey, String(attempts + 1)); } catch (_) {}
      observer?.disconnect();
      try { topWindow.location.replace(fallbackUrl); }
      catch (_) { reloading = false; }
    };
    const watch = () => {
      recoverIfNeeded();
      if (reloading || !document.body) return;
      observer = new MutationObserver(recoverIfNeeded);
      observer.observe(document.body, { childList: true, characterData: true, subtree: true });
      // A failed preferences bootstrap may leave a blank Person shell with
      // no further mutations. Use the same guarded dashboard fallback once.
      if (window === window.top && /^#\/person\//.test(location.hash)) window.setTimeout(recoverIfNeeded, 21000);
      window.addEventListener('pagehide', () => observer?.disconnect(), { once: true });
    };
    if (document.body) watch(); else document.addEventListener('DOMContentLoaded', watch, { once: true });
  }
  if (themeMode(document) !== 'light') installNativeAppErrorRecovery();
  let themeTransitionUntil = 0;

  const CSS = `
    /* Central status palette — update these variables to change every
       matching board marker, hover card, badge, and profile treatment. */
    :root {
      ${STATUS_COLOR_VARIABLES}
      --gbs-my-status-color: #64748b;
      --gbs-surface-base: #1d2025;
      --gbs-surface-raised: #252b33;
      --gbs-surface-hover: #343d49;
      --gbs-border-subtle: #3a4655;
      --gbs-border-strong: #4b596a;
      --gbs-card-border-cyan: #22d3ee;
      --gbs-text-primary: #e5e7eb;
    }
    /* Disable decoration, never call actions/status updates, on low-end devices. */
    html.gbs-low-power #gbs-startup-loader .gbs-startup-space,
    html.gbs-low-power #gbs-startup-loader .gbs-startup-space *,
    html.gbs-low-power #gbs-startup-loader .gbs-startup-nebula,
    html.gbs-low-power #gbs-startup-loader .gbs-startup-orbit,
    html.gbs-low-power #gbs-startup-loader .gbs-v2-logo,
    html.gbs-low-power #pc-auth-app::before,
    html.gbs-low-power #pc-auth-app::after,
    html.gbs-low-power #pc-auth-app .gbs-login-shooting-stars i,
    html.gbs-low-power .gbs-login-space *,
    html.gbs-page-hidden #gbs-startup-loader .gbs-startup-space * {
      animation: none !important; filter: none !important;
    }
    html.gbs-low-power .gbs-settings-backdrop,
    html.gbs-low-power .gbs-settings-popover,
    html.gbs-low-power #gbs-call-information {
      backdrop-filter: none !important; box-shadow: none !important;
    }
    html.gbs-low-power .gbs-settings-tile svg { animation: none !important; filter: none !important; }
    ${PROFILE_STATUS_SELECTOR_CSS}
    /* Modern, compact agent board */
    table.gbs-board { border-collapse: separate !important; border-spacing: 0 5px !important; table-layout: fixed !important; width: 100% !important; min-width: 0 !important; max-width: 100% !important; }
    /* Keep Genesys-owned rows in place. Visual ordering avoids breaking Ember's
       reconciliation when agents join, leave, or change status. */
    table.gbs-board tbody { display: flex !important; flex-direction: column !important; width: 100% !important; }
    table.gbs-board tbody tr { display: table !important; table-layout: fixed !important; width: 100% !important; min-width: 0 !important; max-width: 100% !important; }
    table.gbs-board .column-agentPresence { width: 48px !important; min-width: 48px !important; max-width: 48px !important; }
    table.gbs-board .gbs-rank-header, table.gbs-board .gbs-rank-cell { width: 42px !important; min-width: 42px !important; max-width: 42px !important; }
    /* Rank is structural data, never a truncatable label.  Native table styles
       otherwise turn a narrow # / 1 into #... / 1..., which also looks off-centre. */
    table.gbs-board .gbs-rank-header, table.gbs-board .gbs-rank-cell {
      overflow: visible !important; text-overflow: clip !important; white-space: nowrap !important;
      padding-left: 0 !important; padding-right: 0 !important; text-align: center !important;
    }
    /* Status only enters this compact mode when its full label would truncate.
       Its baseline is recorded by the allocator, so this is always one step
       below the ordinary column font (never below the global 10px floor). */
    table.gbs-board.gbs-status-cell-compact thead .column-status,
    table.gbs-board.gbs-status-cell-compact tbody td.column-status {
      padding-left: 2px !important; padding-right: 2px !important;
      font-size: var(--gbs-status-cell-font-size, inherit) !important; text-align: center !important;
    }
    table.gbs-board .column-agent { width: 200px !important; min-width: 100px !important; max-width: none !important; }
    table.gbs-board .column-timeInStatus { min-width: 80px !important; }
    table.gbs-board .column-duration, table.gbs-board .column-duration-one { width: 95px !important; min-width: 95px !important; max-width: none !important; }
    table.gbs-board th.column-status, table.gbs-board td.column-status { text-align: center !important; }
    /* Genesys reserves an invisible header-actions area after Status. Center
       the label independently of that area instead of centering its parent. */
    table.gbs-board th.column-status .header-container { position: relative !important; display: flex !important; align-items: center !important; justify-content: center !important; }
    table.gbs-board th.column-status .header-container > .label-container { position: absolute !important; inset-inline: 0 !important; display: flex !important; justify-content: center !important; }
    table.gbs-board th.column-status .header-container > .column-header-components { position: absolute !important; right: 0 !important; }
    /* Preserve the native left-aligned Time presentation.  At the true fit
       boundary, only remove its side padding; do not force an inner wrapper
       width or clip the actual timer value. */
    table.gbs-board th.column-timeInStatus, table.gbs-board td.column-timeInStatus { text-align: left !important; }
    table.gbs-board td.column-timeInStatus > *, table.gbs-board td.column-timeInStatus .idle-timer,
    table.gbs-board td.column-timeInStatus .unescaped-html-cell, table.gbs-board td.column-timeInStatus .cell-display-text {
      width: auto !important; min-width: 0 !important; max-width: none !important;
      margin-left: 0 !important; margin-right: 0 !important; text-align: left !important;
      justify-content: flex-start !important;
    }
    table.gbs-board.gbs-time-cell-compact thead .column-timeInStatus,
    table.gbs-board.gbs-time-cell-compact tbody td.column-timeInStatus {
      padding-left: 2px !important; padding-right: 2px !important;
    }
    /* A Board may be narrow on a large monitor.  Use its measured width—not
       the browser breakpoint—to remove the inherited 12px Time-cell padding. */
    table.gbs-board.gbs-board-narrow th.column-timeInStatus,
    table.gbs-board.gbs-board-narrow td.column-timeInStatus {
      padding-left: 2px !important; padding-right: 2px !important;
    }
    /* The allocator sets these to the largest balanced padding that fits the
       longest timer. The native left presentation remains intact. */
    table.gbs-board.gbs-time-padding-balanced tbody td.column-timeInStatus {
      padding-left: var(--gbs-time-pad-left, 2px) !important;
      padding-right: var(--gbs-time-pad-right, 2px) !important;
    }
    table.gbs-board.gbs-data-padding-balanced tbody td.column-agent {
      padding-left: var(--gbs-agent-pad-left, 2px) !important;
      padding-right: var(--gbs-agent-pad-right, 2px) !important;
    }
    table.gbs-board.gbs-data-padding-balanced tbody td.column-duration,
    table.gbs-board.gbs-data-padding-balanced tbody td.column-duration-one {
      padding-left: var(--gbs-duration-pad-left, 2px) !important;
      padding-right: var(--gbs-duration-pad-right, 2px) !important;
    }
    table.gbs-board th.column-status, table.gbs-board th.column-status * { text-align: center !important; }
    table.gbs-board .column-agent a { display: block !important; overflow: hidden !important; text-overflow: ellipsis !important; white-space: nowrap !important; }
    table.gbs-board.gbs-agent-font-scaled tbody td.column-agent a {
      font-size: calc(var(--gbs-agent-font-scale, 1) * 1em) !important;
    }
    /* The final compact pass yields one textual column at a time.  Keep each
       column independent so a tight timer does not prematurely shrink names. */
    table.gbs-board.gbs-time-font-scaled th.column-timeInStatus,
    table.gbs-board.gbs-time-font-scaled tbody td.column-timeInStatus,
    table.gbs-board.gbs-time-font-scaled tbody td.column-timeInStatus * {
      font-size: var(--gbs-time-font-size, inherit) !important;
    }
    table.gbs-board.gbs-duration-font-scaled th.column-duration,
    table.gbs-board.gbs-duration-font-scaled th.column-duration-one,
    table.gbs-board.gbs-duration-font-scaled tbody td.column-duration,
    table.gbs-board.gbs-duration-font-scaled tbody td.column-duration-one,
    table.gbs-board.gbs-duration-font-scaled tbody td.column-duration *,
    table.gbs-board.gbs-duration-font-scaled tbody td.column-duration-one * {
      font-size: var(--gbs-duration-font-size, inherit) !important;
    }
    table.gbs-board.gbs-status-font-scaled thead .column-status,
    table.gbs-board.gbs-status-font-scaled tbody td.column-status,
    table.gbs-board.gbs-status-font-scaled tbody td.column-status * {
      font-size: var(--gbs-status-cell-font-size, inherit) !important;
    }
    /* The final compact stage scales every textual Board column together.
       It is deliberately limited to 10px so labels remain legible. */
    table.gbs-board.gbs-font-scaled th, table.gbs-board.gbs-font-scaled td,
    table.gbs-board.gbs-font-scaled td .idle-timer,
    table.gbs-board.gbs-font-scaled td .time-duration,
    table.gbs-board.gbs-font-scaled td .unescaped-html-cell,
    table.gbs-board.gbs-font-scaled td a {
      font-size: max(10px, calc(var(--gbs-board-font-scale, 1) * 1em)) !important;
    }
    table.gbs-board th, table.gbs-board td { box-sizing: border-box !important; transition: none !important; }
    table.gbs-board .column-agentPresence { width:var(--gbs-col-presence) !important; min-width:var(--gbs-col-presence) !important; max-width:var(--gbs-col-presence) !important; }
    table.gbs-board .gbs-rank-header, table.gbs-board .gbs-rank-cell { width:var(--gbs-col-rank) !important; min-width:var(--gbs-col-rank) !important; max-width:var(--gbs-col-rank) !important; }
    table.gbs-board .column-agent { width:var(--gbs-col-agent) !important; min-width:var(--gbs-col-agent) !important; max-width:var(--gbs-col-agent) !important; }
    table.gbs-board .column-timeInStatus { width:var(--gbs-col-time) !important; min-width:var(--gbs-col-time) !important; max-width:var(--gbs-col-time) !important; }
    table.gbs-board .column-status { width:var(--gbs-col-status) !important; min-width:var(--gbs-col-status) !important; max-width:var(--gbs-col-status) !important; }
    table.gbs-board .column-duration, table.gbs-board .column-duration-one { width:var(--gbs-col-duration) !important; min-width:var(--gbs-col-duration) !important; max-width:var(--gbs-col-duration) !important; }
    table.gbs-board.gbs-agent-compact .column-agent a { white-space: normal !important; overflow: hidden !important; text-overflow: clip !important; line-height: 1.15 !important; display: -webkit-box !important; -webkit-box-orient: vertical !important; -webkit-line-clamp: 2 !important; }
    table.gbs-board thead th { background: #34383d !important; color: #fff !important; border: 0 !important; font-weight: 700 !important; letter-spacing: .02em !important; }
    /* Genesys' nested header wrappers can retain their own dark fill after a
       table redraw, producing rectangular patches behind Agent/Time/etc. */
    table.gbs-board thead th .header-container,
    table.gbs-board thead th .label-container,
    table.gbs-board thead th .label-value,
    table.gbs-board thead th .column-header-components,
    table.gbs-board thead th .column-header-component-configs,
    table.gbs-board thead th .left-components,
    table.gbs-board thead th .right-components {
      background: transparent !important; background-color: transparent !important; background-image: none !important;
      box-shadow: none !important; border-color: transparent !important; filter: none !important;
    }
    /* Native Analytics tables (including the Queue controls in the Analytics
       iframe) are not Board tables, so give their wrapper, headers, rows,
       controls and empty footer the same dark surface explicitly. */
    .analytics-ui-gux-table, .analytics-ui-gux-table table, .analytics-ui-gux-table thead,
    .analytics-ui-gux-table tbody, .analytics-ui-gux-table .header-container,
    .analytics-ui-gux-table .column-header-components, .analytics-ui-gux-pagination-wrapper,
    .table-wrapper:has(> .analytics-ui-gux-table), .table-wrapper:has(> .analytics-ui-gux-table) .footer {
      background: #1d2025 !important; color: #e5e7eb !important; border-color: #3a4655 !important;
    }
    .analytics-ui-gux-table th { background: #252b33 !important; color: #f8fafc !important; border-color: #4b596a !important; }
    .analytics-ui-gux-table td { background: #1d2025 !important; color: #e5e7eb !important; border-color: #3a4655 !important; }
    .analytics-ui-gux-table tr:hover td { background: #252b33 !important; }
    .analytics-ui-gux-table [class*="empty"], .analytics-ui-gux-table [class*="no-data"],
    .analytics-ui-gux-table [class*="noData"], .analytics-ui-gux-table [class*="table-body"],
    .analytics-ui-gux-table [class*="tableBody"] { background: #1d2025 !important; color: #cbd5e1 !important; }
    .analytics-ui-gux-table td.column-toggleQueueActivation {
      padding: 6px 10px 9px !important; vertical-align: middle !important;
    }
    .analytics-ui-gux-table button.gux-ghost[aria-label="Deactivate"],
    .analytics-ui-gux-table button.gux-ghost[aria-label="Activate"] {
      display: inline-flex !important; align-items: center !important; justify-content: center !important;
      min-height: 32px !important; margin: 2px 0 5px !important; padding: 5px 12px !important;
      background: color-mix(in srgb, #22d3ee 8%, #1d2025) !important;
      color: #a5f3fc !important; border: 1px solid #22d3ee !important; border-radius: 5px !important;
      box-shadow: 0 0 0 1px rgba(34,211,238,.08), 0 2px 5px rgba(2,6,23,.3) !important;
    }
    .analytics-ui-gux-table button.gux-ghost[aria-label="Deactivate"]:hover,
    .analytics-ui-gux-table button.gux-ghost[aria-label="Activate"]:hover {
      background: color-mix(in srgb, #22d3ee 16%, #1d2025) !important; color: #ecfeff !important;
      box-shadow: 0 0 8px rgba(34,211,238,.25) !important;
    }
    table.gbs-board thead th *, table.gbs-board thead th a, table.gbs-board thead th gux-icon { color: #fff !important; fill: currentColor !important; }
    table.gbs-board thead th:first-child { border-radius: 7px 0 0 7px !important; }
    table.gbs-board thead th:last-child { border-radius: 0 7px 7px 0 !important; }
    table.gbs-board tbody tr { --gbs-status: var(--gbs-status-unknown); }
    /* Presence changes are applied on the next paint.  Keep that response
       immediate, while these short transitions make the full row glide to
       its new colour instead of flashing through the fallback grey. */
    table.gbs-board tbody td { background: color-mix(in srgb, var(--gbs-status) 11%, #15181e) !important; border-top: 1px solid color-mix(in srgb, var(--gbs-status) 82%, #1d2025) !important; border-bottom: 1px solid color-mix(in srgb, var(--gbs-status) 82%, #1d2025) !important; border-left: 1px solid color-mix(in srgb, var(--gbs-status) 42%, #111827) !important; border-right: 1px solid color-mix(in srgb, var(--gbs-status) 42%, #111827) !important; transition: background-color 140ms ease-out, border-color 140ms ease-out, color 140ms ease-out, box-shadow 140ms ease-out !important; }
    table.gbs-board tbody td:first-child { border-left: 4px solid var(--gbs-status) !important; border-radius: 7px 0 0 7px !important; }
    table.gbs-board tbody td:last-child { border-right: 4px solid var(--gbs-status) !important; border-radius: 0 7px 7px 0 !important; }
    table.gbs-board tbody tr:hover td { background: color-mix(in srgb, var(--gbs-status) 19%, #15181e) !important; }
    table.gbs-board tbody tr.gbs-status-busy { --gbs-status: var(--gbs-status-busy); }
    table.gbs-board tbody tr.gbs-status-idle { --gbs-status: var(--gbs-status-idle); }
    table.gbs-board tbody tr.gbs-status-available { --gbs-status: var(--gbs-status-available); }
    table.gbs-board tbody tr.gbs-status-interacting { --gbs-status: var(--gbs-status-interacting); }
    table.gbs-board tbody tr.gbs-status-break { --gbs-status: var(--gbs-status-break); }
    table.gbs-board tbody tr.gbs-status-meal { --gbs-status: var(--gbs-status-meal); }
    table.gbs-board tbody tr.gbs-status-not-responding { --gbs-status: var(--gbs-status-not-responding); }
    table.gbs-board tbody tr.gbs-status-training { --gbs-status: var(--gbs-status-training); }
    table.gbs-board tbody tr.gbs-status-meeting { --gbs-status: var(--gbs-status-meeting); }
    table.gbs-board tbody tr.gbs-status-away { --gbs-status: var(--gbs-status-away); }
    /* Keep the last known row colour through an Ember cell-only refresh. The
       data marker survives that refresh even when its transient class does not. */
    table.gbs-board tbody tr[data-gbs-status="busy"] { --gbs-status: var(--gbs-status-busy); }
    table.gbs-board tbody tr[data-gbs-status="idle"] { --gbs-status: var(--gbs-status-idle); }
    table.gbs-board tbody tr[data-gbs-status="available"] { --gbs-status: var(--gbs-status-available); }
    table.gbs-board tbody tr[data-gbs-status="interacting"] { --gbs-status: var(--gbs-status-interacting); }
    table.gbs-board tbody tr[data-gbs-status="break"] { --gbs-status: var(--gbs-status-break); }
    table.gbs-board tbody tr[data-gbs-status="meal"] { --gbs-status: var(--gbs-status-meal); }
    table.gbs-board tbody tr[data-gbs-status="not-responding"] { --gbs-status: var(--gbs-status-not-responding); }
    table.gbs-board tbody tr[data-gbs-status="training"] { --gbs-status: var(--gbs-status-training); }
    table.gbs-board tbody tr[data-gbs-status="meeting"] { --gbs-status: var(--gbs-status-meeting); }
    table.gbs-board tbody tr[data-gbs-status="away"] { --gbs-status: var(--gbs-status-away); }
    table.gbs-board tbody tr.gbs-status-busy td.column-status,
    table.gbs-board tbody tr.gbs-status-busy td.column-agent a { color: var(--gbs-status-busy) !important; }
    .gbs-rank-header, .gbs-rank-cell { width: 42px !important; min-width: 42px !important; text-align: center !important; font-variant-numeric: tabular-nums !important; font-weight: 700 !important; }
    .gbs-rank-cell { color: var(--gbs-status) !important; }

    /* Explicit backgrounds plus !important keep Dark Reader from making dots transparent. */
    table.gbs-board .entity-v3-presence-indicator-dot {
      width: 18px !important; height: 18px !important; min-width: 18px !important; min-height: 18px !important;
      display: inline-flex !important; align-items: center !important; justify-content: center !important;
      opacity: 1 !important; visibility: visible !important; border-radius: 50% !important;
      box-sizing: border-box !important; filter: none !important; mix-blend-mode: normal !important;
      border: 2px solid rgba(255,255,255,.88) !important; box-shadow: 0 0 0 1px rgba(15,23,42,.35), 0 1px 3px rgba(15,23,42,.45) !important; transition: background-color 140ms ease-out, color 140ms ease-out, box-shadow 140ms ease-out !important;
    }
    table.gbs-board .entity-v3-presence-indicator-dot.busy { background: var(--gbs-status-busy) !important; color: var(--gbs-status-busy) !important; }
    table.gbs-board .entity-v3-presence-indicator-dot.idle { background: var(--gbs-status-idle) !important; color: var(--gbs-status-idle) !important; }
    table.gbs-board .entity-v3-presence-indicator-dot.available { background: var(--gbs-status-available) !important; color: var(--gbs-status-available) !important; }
    table.gbs-board .entity-v3-presence-indicator-dot.on_queue,
    table.gbs-board .entity-v3-presence-indicator-dot.interacting { background: var(--gbs-status-interacting) !important; color: var(--gbs-status-interacting) !important; }
    table.gbs-board .entity-v3-presence-indicator-dot.break { background: var(--gbs-status-break) !important; color: var(--gbs-status-break) !important; }
    table.gbs-board .entity-v3-presence-indicator-dot.meal { background: var(--gbs-status-meal) !important; color: var(--gbs-status-meal) !important; }
    table.gbs-board .entity-v3-presence-indicator-dot.not_responding { background: var(--gbs-status-not-responding) !important; color: var(--gbs-status-not-responding) !important; }
    /* The native icon/pseudo marker leaves a tiny dot inside the customized
       presence circle. The solid status fill already conveys the state. */
    table.gbs-board .entity-v3-presence-indicator-dot gux-icon,
    table.gbs-board .entity-v3-presence-indicator-dot > svg {
      display: none !important; visibility: hidden !important; opacity: 0 !important;
    }
    table.gbs-board .entity-v3-presence-indicator-dot::before,
    table.gbs-board .entity-v3-presence-indicator-dot::after {
      content: none !important; display: none !important;
    }

    /* Dark Reader must not leave black rectangles behind values, labels, or links. */
    .gbs-sidebar .table-wrapper { border: 0 !important; outline: 0 !important; box-shadow: none !important; background: transparent !important; box-sizing: border-box !important; padding-left: 8px !important; padding-right: 8px !important; }
    table.gbs-board { margin: 0 !important; width: 100% !important; background: transparent !important; }
    table.gbs-board td, table.gbs-board th { color: #f8fafc !important; }
    table.gbs-board td *, table.gbs-board th * { background-color: transparent !important; background-image: none !important; }
    table.gbs-board thead th .label-value, table.gbs-board thead th span { color: #fff !important; text-decoration: none !important; }
    table.gbs-board thead th { font-size: 16px !important; }
    table.gbs-board tbody td { font-size: 16px !important; }
    table.gbs-board tbody td a { color: var(--gbs-status) !important; text-decoration: none !important; text-decoration-color: transparent !important; }
    table.gbs-board tbody tr[class*="gbs-status-"] td.column-agent a { color: var(--gbs-status) !important; }
    table.gbs-board tbody tr[class*="gbs-status-"] td.column-status { color: var(--gbs-status) !important; }
    /* Normal rows keep the status colour but no neon halo.  The focused
       treatment is reserved strictly for the current-user row below. */
    table.gbs-board tbody tr[class*="gbs-status-"] td.column-agent a,
    table.gbs-board tbody tr[class*="gbs-status-"] td.column-status {
      color: var(--gbs-status) !important; font-weight: 600 !important;
      text-shadow: none !important;
    }
    .main-grid .aggregate-divider {
      background: #22d3ee !important; border-color: #22d3ee !important;
      box-shadow: 0 0 4px color-mix(in srgb, #22d3ee 52%, transparent) !important;
    }
    table.gbs-board td .idle-timer, table.gbs-board td .time-duration, table.gbs-board td .unescaped-html-cell { color: #f8fafc !important; }
    /* Current user's row keeps its status colour; a compact badge and focused
       name identify it without changing the whole-row treatment. */
    .gbs-current-agent-badge {
      display: inline-flex !important; align-items: center !important; justify-content: center !important;
      margin-right: 6px !important; padding: 1px 5px !important; min-height: 18px !important;
      box-sizing: border-box !important; vertical-align: middle !important; border: 1px solid var(--gbs-status) !important;
      border-radius: 4px !important; background: color-mix(in srgb, var(--gbs-status) 12%, #1d2025) !important;
      color: var(--gbs-status) !important; font-size: 11px !important; font-weight: 800 !important;
      line-height: 16px !important; letter-spacing: .04em !important; white-space: nowrap !important;
      box-shadow: 0 0 3px color-mix(in srgb, var(--gbs-status) 52%, transparent) !important;
      text-shadow: 0 0 3px color-mix(in srgb, var(--gbs-status) 62%, #fff) !important;
    }
    table.gbs-board.gbs-font-scaled .gbs-current-agent-badge {
      font-size: max(10px, calc(var(--gbs-board-font-scale, 1) * 11px)) !important;
      min-height: max(14px, calc(var(--gbs-board-font-scale, 1) * 18px)) !important;
      line-height: max(12px, calc(var(--gbs-board-font-scale, 1) * 16px)) !important;
      padding: max(0px, calc(var(--gbs-board-font-scale, 1) * 1px)) max(2px, calc(var(--gbs-board-font-scale, 1) * 5px)) !important;
    }
    table.gbs-board tbody tr.gbs-current-agent td.column-agent a {
      display: inline-block !important; width: calc(100% - var(--gbs-agent-badge-space, 0px)) !important; vertical-align: middle !important;
      background: transparent !important; border: 0 !important; outline: 0 !important; box-shadow: none !important;
      text-shadow: 0 0 3px color-mix(in srgb, var(--gbs-status) 62%, #fff) !important;
    }
    table.gbs-board tbody tr.gbs-current-agent td.column-status {
      text-shadow: 0 0 3px color-mix(in srgb, var(--gbs-status) 62%, #fff) !important;
    }
    /* In constrained Board layouts, let the current-user marker own the first
       line. The name then receives the full cell width and can use its normal
       compact two-line treatment instead of competing with the YOU badge. */
    table.gbs-board.gbs-current-agent-badge-stacked tbody tr.gbs-current-agent td.column-agent .gbs-current-agent-badge {
      display: flex !important; width: max-content !important; margin: 0 0 3px !important; vertical-align: initial !important;
    }
    table.gbs-board.gbs-current-agent-badge-stacked tbody tr.gbs-current-agent td.column-agent a {
      display: -webkit-box !important; width: 100% !important; vertical-align: initial !important;
      -webkit-box-orient: vertical !important; -webkit-line-clamp: 2 !important;
    }
    /* Every rank follows its row colour; only the current user's rank receives
       the stronger focused treatment below. */
    table.gbs-board .gbs-rank-cell { color: var(--gbs-status) !important; }
    table.gbs-board tbody tr.gbs-current-agent td.gbs-rank-cell {
      font-weight: 800 !important; text-shadow: 0 1px 2px rgba(2,6,23,.98), 0 0 3px rgba(2,6,23,.92) !important;
    }
    td.column-title .hyperlink-cell a { color: #22d3ee !important; text-decoration-color: #22d3ee !important; }
    td.column-title .hyperlink-cell a:hover { color: #67e8f9 !important; text-decoration-color: #67e8f9 !important; }

    /* The status summary is intentionally styled as part of the agent board. */
    .gbs-sidebar .analytics-ui-dashboard-widget-agent-list-display { padding: 4px 10px 10px !important; background: transparent !important; border: 0 !important; border-radius: 0 !important; }
    .gbs-sidebar, .gbs-sidebar .sidebar-widget, .gbs-sidebar .widget-body, .gbs-sidebar .widget-content,
    .gbs-sidebar .table-wrapper, .gbs-sidebar gux-table { overflow: visible !important; background: transparent !important; min-width: 0 !important; max-width: 100% !important; }
    .gbs-sidebar .table-wrapper, .gbs-sidebar gux-table,
    .gbs-sidebar [class*="gux-table"], .gbs-sidebar [class*="table-container"],
    .gbs-sidebar [class*="table-wrapper"], .gbs-sidebar [class*="table-viewport"] {
      background: transparent !important; background-color: transparent !important; background-image: none !important;
      box-shadow: none !important;
    }
    .gbs-sidebar { overflow-x: visible !important; }
    .gbs-sidebar .sidebar-widget, .gbs-sidebar .widget-body, .gbs-sidebar .widget-content,
    .gbs-sidebar .table-wrapper, .gbs-sidebar gux-table { overflow-x: hidden !important; width: 100% !important; }
    .gbs-sidebar gux-table, .gbs-sidebar gux-table .gux-table, .gbs-sidebar gux-table .gux-table-container { background: transparent !important; }
    .gbs-sidebar > .sidebar-widget, .gbs-sidebar .widget-content { width: 100% !important; max-width: 100% !important; box-sizing: border-box !important; }
    .gbs-sidebar .analytics-ui-dashboard-widget-agent-list-summary { display: none !important; }
    /* Reserve a true table gutter for the vertical scrollbar. It prevents the
       right-most Duration edge from sitting beneath an overlay scrollbar while
       retaining a small deliberate inset on both sides. */
    .gbs-sidebar .analytics-ui-dashboard-widget-agent-list-display {
      padding: 4px 10px 0 !important;
    }
    .gbs-sidebar .table-wrapper {
      padding-left: 8px !important; padding-right: 12px !important; padding-bottom: 0 !important;
      scrollbar-width: thin !important;
      scrollbar-color: #94a3b8 #151a20 !important;
    }
    /* The scrollbar itself occupies the only extra pixel space on the right.
       Do not reserve a second browser gutter, which made this edge too wide. */
    .gbs-sidebar .table-wrapper.gbs-board-has-scrollbar { padding-right: 2px !important; }
    .gbs-sidebar .table-wrapper.gbs-board-has-scrollbar table.gbs-board {
      width: calc(100% - 6px) !important;
    }
    .gbs-sidebar .table-wrapper::-webkit-scrollbar { width: 9px !important; height: 9px !important; }
    .gbs-sidebar .table-wrapper::-webkit-scrollbar-track { background: #151a20 !important; }
    .gbs-sidebar .table-wrapper::-webkit-scrollbar-thumb {
      background: #94a3b8 !important; border: 2px solid #151a20 !important; border-radius: 999px !important;
    }
    .gbs-sidebar .table-wrapper::-webkit-scrollbar-thumb:hover { background: #cbd5e1 !important; }
    .gbs-summary-cards { display: grid !important; grid-template-columns: repeat(3, 142px) !important; gap: 6px !important; align-items: stretch !important; margin: 0 0 8px !important; }
    .gbs-summary-card { width: 142px !important; min-width: 142px !important; height: 64px !important; box-sizing: border-box !important; padding: 5px 9px !important; display: grid !important; grid-template-rows: 23px 31px !important; align-content: center !important; background: #252b33 !important; border: 1px solid #3a4655 !important; border-left: 4px solid var(--gbs-card-status, #64748b) !important; border-radius: 7px !important; color: #fff !important; box-shadow: 0 1px 2px rgba(0,0,0,.22) !important; }
    .gbs-summary-card *, .gbs-summary-title, .gbs-summary-value { color: #fff !important; }
    .gbs-summary-title { color: #fff !important; font-size: 20px !important; font-weight: 700 !important; line-height: 23px !important; white-space: nowrap !important; }
    .gbs-summary-line { display: flex !important; align-items: center !important; gap: 8px !important; height: 26px !important; line-height: 26px !important; }
    .gbs-summary-value { color: #fff !important; font-size: 30px !important; font-weight: 400 !important; line-height: 31px !important; font-variant-numeric: tabular-nums !important; }
    .gbs-summary-dot { width: 19px !important; height: 19px !important; flex: 0 0 19px !important; align-self: center !important; border: 2px solid rgba(255,255,255,.88) !important; border-radius: 50% !important; background: var(--gbs-card-status, #64748b) !important; box-shadow: 0 0 0 1px rgba(15,23,42,.35) !important; }
    .gbs-sidebar .gbs-summary-busy { grid-column: 1 / -1 !important; justify-self: start !important; width: 142px !important; }
    .gbs-sidebar .gbs-summary-hidden { display: none !important; }
    html.gbs-light-mode .gbs-sidebar .gbs-summary-cards,
    html.gbs-light-mode table.gbs-board .gbs-rank-header,
    html.gbs-light-mode table.gbs-board .gbs-rank-cell { display: none !important; }
    .gbs-sidebar .gbs-summary-idle { --gbs-card-status: var(--gbs-status-idle); }
    .gbs-sidebar .gbs-summary-interacting { --gbs-card-status: var(--gbs-status-interacting); }
    .gbs-sidebar .gbs-summary-available { --gbs-card-status: var(--gbs-status-available); }
    .gbs-sidebar .gbs-summary-busy { --gbs-card-status: var(--gbs-status-busy); }
    .gbs-sidebar .gbs-summary-break { --gbs-card-status: var(--gbs-status-break); }
    .gbs-sidebar .gbs-summary-meal { --gbs-card-status: var(--gbs-status-meal); }
    .gbs-sidebar .gbs-summary-meeting { --gbs-card-status: var(--gbs-status-meeting); }
    .gbs-sidebar .gbs-summary-training { --gbs-card-status: var(--gbs-status-training); }
    .gbs-summary-cards.gbs-summary-height-resizable { --gbs-summary-card-scale: 1; --gbs-summary-text-scale: 1; position:relative !important; }
    .gbs-summary-cards.gbs-summary-height-resizable .gbs-summary-card { height:calc(64px * var(--gbs-summary-card-scale)) !important; padding:calc(5px * var(--gbs-summary-card-scale)) calc(9px * var(--gbs-summary-card-scale)) !important; display:flex !important; flex-direction:column !important; justify-content:center !important; align-items:stretch !important; gap:max(2px, calc(4px * var(--gbs-summary-card-scale))) !important; grid-template-rows:none !important; transition:height .16s ease, padding .16s ease, font-size .16s ease !important; }
    .gbs-summary-cards.gbs-summary-height-resizable .gbs-summary-card.gbs-summary-hidden { display:none !important; }
    /* A live pointer drag needs to track the handle exactly. Animating every
       intermediate update made the card appear temporarily at the previous
       (often smallest) geometry until the pointer paused. */
    body.gbs-summary-resizing .gbs-summary-card { transition:none !important; }
    /* Keep leading relative to its own text size. Pixel-scaled line heights
       briefly fought the browser's font layout during a drag, then snapped
       back on the next frame. */
    .gbs-summary-cards.gbs-summary-height-resizable .gbs-summary-title { font-size:max(10px, calc(20px * var(--gbs-summary-text-scale))) !important; line-height:1.1 !important; }
    .gbs-summary-cards.gbs-summary-height-resizable .gbs-summary-value { font-size:max(10px, calc(30px * var(--gbs-summary-text-scale))) !important; line-height:1 !important; }
    .gbs-summary-cards.gbs-summary-height-resizable .gbs-summary-line { height:auto !important; line-height:1 !important; gap:6px !important; }
    /* Genesys applies transition: all to these descendants. That independently
       animated their old line box after every card-size update, making the
       stable 4px flex gap appear to jump. The card owns the animation instead. */
    .gbs-summary-cards.gbs-summary-height-resizable .gbs-summary-title,
    .gbs-summary-cards.gbs-summary-height-resizable .gbs-summary-value,
    .gbs-summary-cards.gbs-summary-height-resizable .gbs-summary-line,
    .gbs-summary-cards.gbs-summary-height-resizable .gbs-summary-dot { transition:none !important; flex-shrink:0 !important; }
    .gbs-summary-cards.gbs-summary-height-resizable .gbs-summary-dot { width:calc(19px * var(--gbs-summary-card-scale)) !important; height:calc(19px * var(--gbs-summary-card-scale)) !important; flex-basis:calc(19px * var(--gbs-summary-card-scale)) !important; }
    /* The Board can be narrowed independently of the browser viewport.  Do not
       keep the original three fixed 142px cards in that case: they now share
       the actual Board width and their type scales down together before either
       one can push beyond the Board edge. */
    .gbs-summary-cards.gbs-summary-height-resizable {
      --gbs-summary-width-scale: 1; --gbs-summary-content-scale: 1; --gbs-summary-dot-scale: 1;
      grid-template-columns: repeat(3, minmax(0, 1fr)) !important;
      width: 100% !important; min-width: 0 !important; max-width: 100% !important;
    }
    .gbs-summary-cards.gbs-summary-height-resizable .gbs-summary-card {
      width: auto !important; min-width: 0 !important; max-width: 100% !important; overflow: hidden !important;
    }
    .gbs-summary-cards.gbs-summary-height-resizable .gbs-summary-busy {
      grid-column: 1 / -1 !important; width: var(--gbs-summary-busy-width, 142px) !important; min-width: 0 !important;
      justify-self: start !important;
    }
    .gbs-summary-cards.gbs-summary-height-resizable .gbs-summary-title {
      font-size: max(10px, calc(20px * var(--gbs-summary-content-scale))) !important;
    }
    .gbs-summary-cards.gbs-summary-height-resizable .gbs-summary-value {
      font-size: max(10px, calc(30px * var(--gbs-summary-content-scale))) !important;
    }
    .gbs-summary-cards.gbs-summary-height-resizable .gbs-summary-line {
      gap: max(2px, calc(6px * var(--gbs-summary-width-scale))) !important;
    }
    .gbs-summary-cards.gbs-summary-height-resizable .gbs-summary-dot {
      width: calc(19px * var(--gbs-summary-dot-scale)) !important;
      height: calc(19px * var(--gbs-summary-dot-scale)) !important;
      flex-basis: calc(19px * var(--gbs-summary-dot-scale)) !important;
    }
    .gbs-summary-cards.gbs-summary-height-resizable { margin-bottom:16px !important; }
    .gbs-summary-height-resizer { position:absolute !important; z-index:12 !important; left:0 !important; right:0 !important; bottom:-12px !important; height:14px !important; cursor:row-resize !important; touch-action:none !important; }
    .gbs-summary-height-resizer::before { content:"" !important; position:absolute !important; left:24% !important; right:24% !important; top:6px !important; height:2px !important; border-radius:4px !important; background:#475569 !important; border:1px solid #64748b !important; }
    .gbs-summary-height-resizer:hover::before, body.gbs-summary-resizing .gbs-summary-height-resizer::before { background:#64748b !important; border-color:#94a3b8 !important; box-shadow:0 0 6px rgba(148,163,184,.45) !important; }
    /* Independent component loaders hide a native remount until the enhanced
       Dashboard or Board has finished its own render pass. */
    .main-grid.gbs-component-loading, .gbs-sidebar.gbs-component-loading { position: relative !important; overflow: hidden !important; }
    .gbs-component-loader {
      position: absolute !important; inset: 0 !important; z-index: 2147483600 !important;
      display: grid !important; place-items: center !important; align-content: center !important; gap: 12px !important;
      background: #1d2025 !important; color: #e5e7eb !important; opacity: 0 !important;
      pointer-events: none !important; transition: opacity 140ms ease !important;
    }
    .gbs-component-loading > .gbs-component-loader { opacity: 1 !important; pointer-events: auto !important; }
    .gbs-component-loader-spinner {
      width: 34px !important; height: 34px !important; box-sizing: border-box !important;
      border: 3px solid #364152 !important; border-top-color: #67e8f9 !important;
      border-radius: 50% !important; animation: gbs-component-loader-spin .72s linear infinite !important;
      box-shadow: 0 0 18px rgba(34, 211, 238, .20) !important;
    }
    .gbs-component-loader-label { color: #cbd5e1 !important; font-size: 12px !important; font-weight: 700 !important; letter-spacing: .08em !important; text-transform: uppercase !important; }
    @keyframes gbs-component-loader-spin { to { transform: rotate(360deg); } }
    .gbs-sidebar .agent-item-label { color: #cbd5e1 !important; font-weight: 650 !important; }
    .gbs-sidebar .agent-item-value { color: #f8fafc !important; font-variant-numeric: tabular-nums !important; }
    .gbs-sidebar gux-icon.item-icon { position: relative !important; width: 18px !important; height: 18px !important; min-width: 18px !important; min-height: 18px !important; color: transparent !important; vertical-align: middle !important; }
    .gbs-sidebar gux-icon.item-icon::after { content: '' !important; position: absolute !important; inset: 0 !important; border: 2px solid rgba(255,255,255,.88) !important; border-radius: 50% !important; box-sizing: border-box !important; box-shadow: 0 0 0 1px rgba(15,23,42,.35), 0 1px 3px rgba(15,23,42,.45) !important; background: #94a3b8 !important; }
    .gbs-sidebar gux-icon.AVAILABLE_AGENTS::after { background: #6b7280 !important; }
    .gbs-sidebar gux-icon.BREAK_AGENTS::after { background: #eab308 !important; }
    .gbs-sidebar gux-icon.BUSY_AGENTS::after { background: #dc2626 !important; }
    .gbs-sidebar gux-icon.IDLE_AGENTS::after { background: #16a34a !important; }
    .gbs-sidebar gux-icon.INTERACTING_AGENTS::after, .gbs-sidebar gux-icon.ON_QUEUE_AGENTS::after { background: #2563eb !important; }
    .gbs-sidebar gux-icon.MEAL_AGENTS::after { background: #f97316 !important; }
    .gbs-sidebar gux-icon.MEETING_AGENTS::after { background: #7c3aed !important; }
    .gbs-sidebar gux-icon.TRAINING_AGENTS::after { background: #0891b2 !important; }

    /* Narrow, dark-mode-friendly scrollbars inside the sidebar/grid. */
    /* The native parent-grid rule is later and !important, so the Board
       needs this two-class selector to keep its surrounding canvas clear. */
    .parent-grid.gbs-grid-scroll { background: transparent !important; }
    .analytics-ui-dashboard-widget-grid:has(.gbs-sidebar),
    .analytics-yield-content-container:has(.gbs-sidebar),
    .analytics-body-container:has(.gbs-sidebar),
    .analytics-main-content:has(.gbs-sidebar),
    .analytics-main-content-container:has(.gbs-sidebar),
    .main-content:has(.gbs-sidebar), .filter-view-content:has(.gbs-sidebar),
    .analytics-view-main-content:has(.gbs-sidebar),
    .ember-engine-queues-main-content:has(.gbs-sidebar),
    body:has(.gbs-sidebar), html:has(.gbs-sidebar) { background: transparent !important; }
    .gbs-grid-scroll { scrollbar-color: #64748b #1d2025 !important; scrollbar-width: thin !important; background: transparent !important; overflow-x: hidden !important; }
    .gbs-grid-scroll::-webkit-scrollbar { width: 8px !important; height: 8px !important; }
    .gbs-grid-scroll::-webkit-scrollbar-track { background: #1d2025 !important; }
    .gbs-grid-scroll::-webkit-scrollbar-thumb { background: #64748b !important; border: 2px solid #1d2025 !important; border-radius: 999px !important; }
    .gbs-grid-scroll::-webkit-scrollbar-thumb:hover { background: #94a3b8 !important; }

    /* The resize rail remains discreet; its tally icon appears only on hover. */
    .gbs-resizer { position: absolute !important; top: 0 !important; left: -17px !important; width: 28px !important; height: 100% !important; z-index: 30 !important; cursor: col-resize !important; background: transparent !important; border: 0 !important; box-sizing: border-box !important; touch-action: none !important; }
    .gbs-resizer::before { content: "" !important; position: absolute !important; top: 0 !important; bottom: 0 !important; left: 10px !important; width: 8px !important; background: #334155 !important; border-left: 1px solid #64748b !important; box-sizing: border-box !important; pointer-events: none !important; }
    .gbs-resizer:hover::before, .gbs-resizing .gbs-resizer::before { background: #475569 !important; border-color: #94a3b8 !important; }
    .gbs-resizer svg { position: absolute !important; top: calc(50% - 1px) !important; left: 14px !important; width: 22px !important; height: 22px !important; transform: translate(-50%, -50%) !important; box-sizing: border-box !important; opacity: 1 !important; color: #e2e8f0 !important; background: #334155 !important; border: 1px solid #64748b !important; border-radius: 4px !important; padding: 3px !important; pointer-events: none !important; }
    /* Workspace divider: the actual right-hand panel is absolutely positioned;
       its enclosing aside has no width and cannot be the resize target. */
    .command-panel.active.agent.gbs-agent-workspace-resizable {
      position: absolute !important; right: 0 !important; bottom: 0 !important;
      flex: 0 0 var(--gbs-agent-workspace-width, 760px) !important;
      width: var(--gbs-agent-workspace-width, 760px) !important;
      height: auto !important;
      /* Both Workspace panes retain a usable 240px minimum. */
      min-width: 500px !important; max-width: calc(100vw - 320px) !important;
      overflow: visible !important;
      transition: width .22s cubic-bezier(.22, 1, .36, 1), flex-basis .22s cubic-bezier(.22, 1, .36, 1) !important;
    }
    /* Compact Genesys leaves main.center-stage 27px short of the viewport.
       Anchor the normal resized Workspace to the actual viewport instead. */
    @media (max-width: 2100px) {
      .command-panel.active.agent.gbs-agent-workspace-resizable {
        position: fixed !important; top: 38px !important; bottom: 0 !important;
      }
      /* Native expanded mode is intentionally outside the resize system, but
         it still inherits Genesys' short center-stage height on compact UI. */
      .command-panel.active.agent.expanded {
        position: fixed !important; z-index: 2147483620 !important;
        top: 38px !important; right: 0 !important; bottom: 0 !important; left: 0 !important;
        width: auto !important; height: auto !important; min-width: 0 !important;
        max-width: none !important; flex: none !important;
      }
    }
    .application-scroll:has(frame-router.main-iframe) {
      transition: width .22s cubic-bezier(.22, 1, .36, 1), max-width .22s cubic-bezier(.22, 1, .36, 1), flex-basis .22s cubic-bezier(.22, 1, .36, 1) !important;
    }
    body.gbs-agent-workspace-resizing .command-panel.active.agent.gbs-agent-workspace-resizable,
    body.gbs-agent-workspace-resizing .application-scroll:has(frame-router.main-iframe) {
      transition: none !important;
    }
    .gbs-agent-workspace-resizer {
      /* Restore the original, working in-panel geometry. The previous
         negative offset was clipped by Genesys and made this left divider
         look present while placing its hit target outside the panel. */
      position: absolute !important; z-index: 900 !important; top: 0 !important; bottom: 0 !important;
      left: 0 !important; width: 14px !important; cursor: col-resize !important;
      touch-action: none !important; pointer-events: auto !important; background: transparent !important;
      overflow: visible !important; opacity: 1 !important; visibility: visible !important;
    }
    .gbs-agent-workspace-resizer::before {
      content: "" !important; position: absolute !important; top: 0 !important; bottom: 0 !important;
      left: 2px !important; width: 4px !important; border-radius: 3px !important;
      background: #475569 !important; border-left: 1px solid #64748b !important;
    }
    .gbs-agent-workspace-resizer:hover::before,
    body.gbs-agent-workspace-resizing .gbs-agent-workspace-resizer::before {
      background: #64748b !important; border-color: #94a3b8 !important;
      box-shadow: 0 0 5px rgba(148,163,184,.45) !important;
    }
    /* Match the main Board grip with a deliberately smaller button on the
       Workspace dividers, without reducing their generous invisible hit area. */
    .gbs-agent-workspace-resizer .gbs-resize-grip-button,
    .gbs-interaction-queue-resizer .gbs-resize-grip-button,
    .gbs-selected-interaction-resizer .gbs-resize-grip-button {
      position: absolute !important; top: 50% !important; left: 50% !important;
      width: 16px !important; height: 18px !important; transform: translate(-50%, -50%) !important;
      box-sizing: border-box !important; color: #e2e8f0 !important; background: #334155 !important;
      border: 1px solid #64748b !important; border-radius: 3px !important; padding: 2px !important;
      pointer-events: none !important; display: grid !important; place-items: center !important;
      opacity: 1 !important; visibility: visible !important; z-index: 3 !important;
    }
    .gbs-resize-grip-button svg {
      position: static !important; width: 10px !important; height: 14px !important;
      transform: none !important; display: block !important; opacity: 1 !important;
      visibility: visible !important; color: inherit !important; background: none !important;
      border: 0 !important; padding: 0 !important; pointer-events: none !important;
    }
    /* The outer rail is drawn at x=2..6 inside its 14px hit area, so its
       visual center is 4px rather than the hit area's 7px midpoint. */
    .gbs-agent-workspace-resizer .gbs-resize-grip-button { left: 4px !important; }
    .gbs-interaction-queue-resizer .gbs-resize-grip-button,
    .gbs-selected-interaction-resizer .gbs-resize-grip-button { left: 50% !important; }
    .gbs-agent-workspace-resizer:hover .gbs-resize-grip-button,
    .gbs-interaction-queue-resizer:hover .gbs-resize-grip-button,
    .gbs-selected-interaction-resizer:hover .gbs-resize-grip-button,
    body.gbs-agent-workspace-resizing .gbs-agent-workspace-resizer .gbs-resize-grip-button,
    body.gbs-interaction-queue-resizing .gbs-interaction-queue-resizer .gbs-resize-grip-button {
      color: #fff !important; background: #475569 !important; border-color: #94a3b8 !important;
      box-shadow: 0 0 5px rgba(148,163,184,.38) !important;
    }
    .gbs-workspace-resize-capture {
      position: fixed !important; inset: 0 !important; z-index: 2147483600 !important;
      display: block !important; width: 100vw !important; height: 100vh !important;
      margin: 0 !important; padding: 0 !important; border: 0 !important;
      background: transparent !important; cursor: col-resize !important;
      pointer-events: auto !important; touch-action: none !important;
    }
    /* Agent Workspace menus must remain above its resize handle. Keep the
       native gux-hidden state intact; only visible popovers are elevated. */
    .command-panel.active.agent gux-popover:not([hidden]),
    .command-panel.active.agent gux-popover-list:not([hidden]),
    .command-panel.active.agent .gux-popover-wrapper:not(.gux-hidden),
    .command-panel.active.agent .gux-popover-container:not(.gux-hidden) {
      z-index: 1000 !important;
    }
    .command-panel.active.agent .gux-popover-wrapper:not(.gux-hidden),
    .command-panel.active.agent .gux-popover-container:not(.gux-hidden) {
      background: #252b33 !important; color: #e5e7eb !important;
      border: 1px solid #71839a !important; border-radius: 6px !important;
      box-shadow: 0 12px 28px rgba(0,0,0,.42), 0 0 0 1px rgba(148,163,184,.08) !important;
    }
    .command-panel.active.agent .gux-popover-wrapper:not(.gux-hidden) .gux-popover-content,
    .command-panel.active.agent .gux-popover-wrapper:not(.gux-hidden) [role="menu"],
    .command-panel.active.agent .gux-popover-wrapper:not(.gux-hidden) [role="listbox"] {
      background: transparent !important; color: #e5e7eb !important;
    }
    .command-panel.active.agent .gux-popover-wrapper:not(.gux-hidden) .gux-arrow-caret {
      background: #252b33 !important; border-color: #71839a !important;
    }
    /* Dashboard collapse deliberately affects only the dashboard widgets.
       The agent board is a sibling and remains available at full width. */
    .main-grid {
      transition: opacity .16s ease !important;
    }
    /* Genesys gives every dashboard widget transition-all behavior. Live metric DOM
       refreshes then restart a width transition even though the grid itself
       is unchanged, making all cards oscillate by a few pixels forever. */
    .main-grid > .widget-container {
      transition: height .20s cubic-bezier(.22,1,.36,1), min-height .20s cubic-bezier(.22,1,.36,1), background-color .12s ease, border-color .12s ease, box-shadow .12s ease !important;
      will-change: auto !important;
    }
    .main-grid > .widget-container > .analytics-ui-dashboard-widget,
    .main-grid .analytics-ui-dashboard-widget-grid-display,
    .main-grid .analytics-ui-dashboard-widget-grid-display .grid-container {
      transition: height .20s cubic-bezier(.22,1,.36,1), min-height .20s cubic-bezier(.22,1,.36,1), row-gap .16s ease !important;
    }
    /* Agent Workspace starts with dashboard widgets collapsed, while the
       Board remains visible. The left rail restores them on demand. */
    .main-grid.gbs-dashboard-widgets-collapsed {
      display: none !important;
    }
    .gbs-dashboard-widgets-reopen {
      position: fixed !important; left: 0 !important; top: 50% !important;
      z-index: 2147483500 !important; min-width: 31px !important; min-height: 118px !important;
      padding: 10px 7px !important; border: 1px solid #64748b !important; border-left: 0 !important;
      border-radius: 0 8px 8px 0 !important; background: #252b33 !important; color: #e2e8f0 !important;
      box-shadow: 3px 0 15px rgba(0,0,0,.3), 0 0 12px rgba(34,211,238,.10) !important;
      font: 700 11px/1 system-ui, sans-serif !important; letter-spacing: .11em !important;
      writing-mode: vertical-rl !important; transform: translateY(-50%) !important;
      cursor: pointer !important; transition: background-color .16s ease, color .16s ease, box-shadow .16s ease !important;
    }
    .gbs-dashboard-widgets-reopen:hover { background: #334155 !important; color: #67e8f9 !important; box-shadow: 3px 0 18px rgba(34,211,238,.24) !important; }
    .gbs-board-layout-expanded {
      flex: 1 1 100% !important; width: 100% !important; max-width: none !important;
    }
    .gbs-sidebar.gbs-board-expanded {
      flex: 1 1 100% !important; width: 100% !important;
      min-width: 0 !important; max-width: none !important;
    }
    .gbs-board-layout-expanded, .gbs-sidebar, .gbs-sidebar .sidebar-widget,
    .gbs-sidebar .analytics-ui-dashboard-widget-agent-list-display,
    .gbs-sidebar .table-wrapper, table.gbs-board {
      transition: none !important;
    }
    /* Workspace open/close is a discrete layout-state change, not a live
       divider drag. Smooth just this state change so Dashboard/Board do not
       visibly snap while the fast Workspace panel is mounting. */
    body.gbs-agent-workspace-transitioning .main-grid {
      transition: opacity .18s ease, width .18s cubic-bezier(.22, 1, .36, 1), max-width .18s cubic-bezier(.22, 1, .36, 1), flex-basis .18s cubic-bezier(.22, 1, .36, 1), padding .18s ease !important;
      will-change: width, max-width, flex-basis, padding, opacity !important;
    }
    body.gbs-agent-workspace-transitioning .main-grid > .widget-container {
      transition: width .18s cubic-bezier(.22, 1, .36, 1), height .18s ease !important;
      will-change: width, height !important;
    }
    body.gbs-agent-workspace-transitioning .gbs-board-layout-expanded,
    body.gbs-agent-workspace-transitioning .gbs-sidebar.gbs-board-expanded {
      transition: width .18s cubic-bezier(.22, 1, .36, 1), max-width .18s cubic-bezier(.22, 1, .36, 1), flex-basis .18s cubic-bezier(.22, 1, .36, 1) !important;
      will-change: width, max-width, flex-basis !important;
    }
    /* Agent Workspace uses a deliberate two-stage entrance.  Genesys mounts
       its panel at fullscreen geometry, so keep that native intermediate
       state invisible and reveal only after our saved-width layout is ready. */
    body.gbs-agent-workspace-opening .command-panel.active.agent {
      opacity: 0 !important; visibility: hidden !important; pointer-events: none !important;
    }
    body.gbs-agent-workspace-opening .command-panel.active.agent.gbs-agent-workspace-revealing,
    .command-panel.active.agent.gbs-agent-workspace-revealing {
      visibility: visible !important; pointer-events: auto !important;
      animation: gbs-agent-workspace-burst .20s cubic-bezier(.16,.84,.28,1) both !important;
    }
    .command-panel.active.agent.gbs-agent-workspace-closing {
      transform-origin: 50% 50% !important;
      animation: gbs-agent-workspace-collapse .15s cubic-bezier(.55,.02,.78,.22) both !important;
      pointer-events: none !important;
    }
    .gbs-agent-workspace-orb {
      position: fixed !important; z-index: 2147483647 !important; width: 20px !important; height: 20px !important;
      margin: -10px 0 0 -10px !important; border: 2px solid #67e8f9 !important; border-radius: 50% !important;
      background: #374151 !important;
      box-shadow: 0 0 0 5px rgba(34,211,238,.14), 0 0 18px rgba(34,211,238,.82) !important;
      pointer-events: none !important; will-change: transform, opacity, left, top !important;
    }
    .gbs-agent-workspace-orb.gbs-orb-burst { animation: gbs-agent-orb-burst .18s cubic-bezier(.16,.84,.28,1) both !important; }
    @keyframes gbs-agent-workspace-burst { from { opacity:0; transform:scale(.12); filter:brightness(1.65); } 58% { opacity:1; transform:scale(1.025); } to { opacity:1; transform:scale(1); filter:brightness(1); } }
    @keyframes gbs-agent-workspace-collapse { from { opacity:1; transform:scale(1); filter:brightness(1); } to { opacity:0; transform:scale(.12); filter:brightness(1.5); } }
    @keyframes gbs-agent-orb-burst { from { opacity:1; transform:scale(1); box-shadow:0 0 0 5px rgba(34,211,238,.14),0 0 18px rgba(34,211,238,.82); } 45% { opacity:1; transform:scale(5.5); box-shadow:0 0 0 14px rgba(34,211,238,.12),0 0 38px rgba(34,211,238,.95); } to { opacity:0; transform:scale(7.5); box-shadow:0 0 0 22px rgba(34,211,238,0),0 0 52px rgba(34,211,238,0); } }
    /* Fullscreen removes the Homepage, so Workspace is intentionally kept as
       the resizable side panel only. */
    .command-panel.active.agent .panel-control-wrapper .expand-panel,
    .command-panel.active.agent #panel-agent-expand-button { display:none !important; }
    .gbs-sidebar .table-wrapper, .gbs-sidebar gux-table.analytics-ui-gux-table { border: 0 !important; outline: 0 !important; box-shadow: none !important; }
    .gbs-sidebar td.column-agentPresence { padding: 0 !important; vertical-align: middle !important; text-align: center !important; line-height: 1 !important; }
    .gbs-sidebar td.column-agentPresence > .entity-wrapper, .gbs-sidebar td.column-agentPresence .entity-v3, .gbs-sidebar td.column-agentPresence .entity-v3-hover-card, .gbs-sidebar td.column-agentPresence .mini-card-component-wrapper { display: flex !important; align-items: center !important; justify-content: center !important; width: 100% !important; height: 100% !important; min-height: 100% !important; line-height: 1 !important; }
    .gbs-sidebar td.column-agentPresence .entity-v3-presence-indicator-dot { position: static !important; inset: auto !important; margin: 0 !important; transform: none !important; align-self: center !important; }

    /* Genesys shell: a dark slate treatment for the outer navigation chrome. */
    body.ember-application.command, .command-view, .nav-v2-main { background: #1d2025 !important; color: #e5e7eb !important; }
    .loading-body, .loading-body gux-page-loading-spinner {
      background: #1d2025 !important; color: #e5e7eb !important; border-color: #3a4655 !important;
    }
    /* The three current-user avatar hosts inherit exactly one status variable.
       They render grey before the top-menu label has been read. */
    #user-settings-button > gux-avatar-beta,
    .avatar-header .user-avatar > gux-avatar-beta,
    .user-settings-popover .user-avatar > gux-avatar-beta {
      --gbs-avatar-status-color: var(--gbs-my-status-color, #64748b) !important;
    }
    .command-bar, .command-nav, .main-nav, .navigation-container, .tabs-container, .tab-bar, .gux-tabs, .command-view header { background: #252b33 !important; color: #e5e7eb !important; border-color: #3a4655 !important; }
    .command-bar input, .command-bar gux-dropdown { color: #e5e7eb !important; background-color: #2d3540 !important; border-color: #4b596a !important; }
    /* The prior blanket button fill created a second black tile behind every
       navigation icon. Keep the shell surface visible; controls that need a
       distinct state (Off Queue, active tabs) style themselves explicitly. */
    .command-bar button, .command-bar gux-button, .nav-v2-main button,
    .command-nav button, .command-nav gux-button-slot:has(gux-icon) {
      color: #e5e7eb !important; background: transparent !important; background-color: transparent !important;
      border-color: #4b596a !important; box-shadow: none !important;
    }
    /* Navigation Menu is a nested truncate component. Both its host and text
       must stay transparent so the command bar, not a black inner tile, shows. */
    #navigation-menu, #navigation-menu *,
    .main-menu-toggle, .main-menu-toggle *,
    .main-menu-toggle-menu-text, .main-menu-toggle-menu-text * {
      background: transparent !important; background-color: transparent !important;
      box-shadow: none !important;
    }
    .command-bar gux-icon, .command-nav gux-icon, .nav-v2-main gux-icon,
    .command-bar svg, .command-nav svg, .nav-v2-main svg {
      background: transparent !important; background-color: transparent !important;
      border: 0 !important; box-shadow: none !important; outline: 0 !important;
    }

    /* Main navigation, delayed submenus and analytics/queue pages. */
    .command-nav .nav-container, .command-nav nav, .command-nav nav > ul,
    .command-nav .menu-item-container, .command-nav .submenu-bar,
    .command-nav .submenu-scroll-container, .command-nav .submenu-specifics,
    .command-nav .nav-item, .command-nav .nav-link,
    .command-nav .link-title, .command-nav .sublink-title,
    .command-nav .title-items, .command-nav gux-button-slot {
      background: #252b33 !important; color: #e5e7eb !important; border-color: #3a4655 !important;
    }
    .command-nav .nav-item:hover, .command-nav .nav-item.selected,
    .command-nav .nav-item[aria-current="true"], .command-nav button[aria-expanded="true"] {
      background: #343d49 !important; color: #fff !important;
    }
    /* These are text-only descendants of a navigation link. Let the parent
       nav item provide the hover/selected surface instead of painting a tile
       behind the label itself. */
    .command-nav .nav-item .link-title,
    .command-nav .nav-item .sublink-title,
    .command-nav .nav-item gux-truncate,
    .command-nav .nav-item gux-truncate > * {
      background: transparent !important; background-color: transparent !important;
    }
    .command-nav li.menu-item-container,
    .command-nav li.menu-item-container .nav-item,
    .command-nav li.menu-item-container .link-title,
    .command-nav li.menu-item-container gux-truncate {
      text-align: left !important;
    }
    .command-nav li.menu-item-container .title-items {
      justify-content: flex-start !important;
      text-align: left !important;
      flex: 1 1 auto !important;
      min-width: 0 !important;
    }
    .command-nav li.menu-item-container .action-icons-hovers {
      margin-left: auto !important;
    }
    .command-nav gux-icon, .command-nav .custom-icon { color: #cbd5e1 !important; fill: currentColor !important; }
    .ember-engine-queues-main-content, .analytics-view-main-content,
    .analytics-yield-content-container, .filter-view-content,
    .main-content.usability-enhancements, .analytics-main-content-container,
    .analytics-main-content, .analytics-body-container, .table-wrapper,
    .analytics-footer, .analytics-filter-bar, .analytics-filter-bar-container,
    .analytics-view-navigation, .analytics-tab-nav, .switch-navigation {
      background: #1d2025 !important; color: #e5e7eb !important; border-color: #3a4655 !important;
    }
    .analytics-ui-date-span-picker-v4, .custom-date-picker-container,
    .analytics-ui-preset-picker, .analytics-ui-custom-date-time-picker,
    .analytics-ui-day-picker, .left-panel, .time-picker-container,
    .analytics-ui-date-span-picker-footer, .month-year-focus-dropdowns-container,
    .time-zone-picker-container, .filter-sections, .filter-section,
    .expandable-list, .items-list, .header-container {
      background: #252b33 !important; color: #e5e7eb !important; border-color: #4b596a !important;
    }
    .analytics-ui-gux-table table, .analytics-ui-gux-table thead,
    .analytics-ui-gux-table tbody, .analytics-ui-gux-table tr,
    .analytics-ui-gux-table th, .analytics-ui-gux-table td {
      background: #20262d !important; color: #e5e7eb !important; border-color: #3a4655 !important;
    }
    .analytics-ui-gux-table tbody tr:hover td { background: #2d3540 !important; }
    .analytics-ui-data-update-indicator, .display-text-label, .timestamp,
    .preset-picker-title, .month-year-focus-dropdowns-label,
    .time-zone-picker-label, .label-value { color: #cbd5e1 !important; }
    .kebab-menu-button, .refresh-view, .toggle-column-picker, .toggle-export,
    .toggle-filters, .toggle-saved-views, .reset-view-option {
      background: #252b33 !important; color: #e5e7eb !important; border-color: #4b596a !important;
    }

    /* Default/Saved view chooser and content that is created only when it opens. */
    h1.header, .default-views-list, .section.saved,
    .default-views-list .section-header, .section.saved .section-header,
    .default-views-list .time-zone-section, .default-views-list .picker-section,
    .default-views-list .accordion-container, .section.saved .table-wrapper {
      background: #1d2025 !important; color: #e5e7eb !important; border-color: #3a4655 !important;
    }
    h1.header, .default-views-list .section-title, .section.saved .section-title,
    .default-views-list label { color: #f8fafc !important; }
    .default-views-list .accordion-row, .default-views-list gux-accordion-section,
    .section.saved .header-container, .section.saved .footer {
      background: #252b33 !important; color: #e5e7eb !important; border-color: #3a4655 !important;
    }
    .default-views-list .accordion-row:hover { background: #343d49 !important; }
    .default-views-list .accordion-row a, .section.saved a { color: #93c5fd !important; }
    .default-views-list .workspace-search-box, .section.saved .workspace-search-box {
      background: transparent !important; color: #f8fafc !important; border: 0 !important; box-shadow: none !important;
    }

    /* Reusable dark slate palette for dynamic Genesys shells and popovers. */
    :root { color-scheme: dark !important; }
    html, body.ember-application.command { background: #1d2025 !important; color: #e5e7eb !important; }
    .apps-embed-container, .sub-panel-wrapper, .side-panel, .floating-calls, .acd-interactions-panel, .acd-interactions-list, .selected-interaction-container, .interaction-content, .results.suggest-results, .user-settings-popover { background: #252b33 !important; color: #e5e7eb !important; border-color: #3a4655 !important; }
    /* Concrete white survivors found in the captured live stylesheet. Keep
       them as named component surfaces, never as a wildcard dark-mode rule. */
    .iti__dropdown-content, .ember-popover, .chat-panel,
    .interaction-conference-roster-dropdown,
    .interaction-blind-transfer-participant-dropdown,
    .interaction-conference-hangup-dropdown {
      background: #252b33 !important; color: #e5e7eb !important; border-color: #4b596a !important;
    }
    /* Conference / transfer target picker. This component mounts as a white
       card after opening, so style each named surface rather than its generic
       descendants. */
    .target-dropdown.no-header {
      background: #252b33 !important; color: #e5e7eb !important;
      border-color: #4b596a !important;
    }
    .target-dropdown.no-header .filter-container,
    .target-dropdown.no-header .filter-wrapper {
      background: #20262d !important; border-color: #3a4655 !important;
    }
    .target-dropdown.no-header .interaction-conference-filter button {
      background: transparent !important; color: #cbd5e1 !important;
      border-color: transparent !important; box-shadow: none !important;
    }
    .target-dropdown.no-header .interaction-conference-filter.active button,
    .target-dropdown.no-header .interaction-conference-filter button:hover {
      background: #343d49 !important; color: #fff !important;
      border-color: #4b596a !important;
    }
    .target-dropdown.no-header .interaction-conference-filter gux-icon,
    .target-dropdown.no-header .record-count,
    .target-dropdown.no-header .record-count .count {
      background: transparent !important; color: currentColor !important;
    }
    .target-dropdown.no-header .content,
    .target-dropdown.no-header .message-wrapper {
      background: #1d2025 !important; color: #e5e7eb !important;
      border-color: #3a4655 !important;
    }
    .target-dropdown.no-header .message-wrapper p { color: #e5e7eb !important; }
    .target-dropdown.no-header .footer,
    .target-dropdown.no-header .footer-container {
      background: #20262d !important; color: #cbd5e1 !important;
      border-color: #3a4655 !important;
    }
    .target-dropdown.no-header .footer b { color: #f8fafc !important; }
    /* Quoted/replied-to chat messages use plain blockquotes without stable
       component classes. Scope them to conversation/chat surfaces so ordinary
       page quotations retain their native presentation. */
    .chat-panel blockquote,
    .conversation-content blockquote,
    .message-content blockquote,
    .chat-message blockquote,
    .message-body blockquote {
      background: #252b33 !important; color: #e5e7eb !important;
      border: 1px solid #4b596a !important; border-left: 3px solid #64748b !important;
      border-radius: 5px !important; box-shadow: none !important;
    }
    .chat-panel blockquote h1, .chat-panel blockquote h2, .chat-panel blockquote h3,
    .chat-panel blockquote h4, .chat-panel blockquote h5, .chat-panel blockquote h6,
    .conversation-content blockquote h1, .conversation-content blockquote h2, .conversation-content blockquote h3,
    .conversation-content blockquote h4, .conversation-content blockquote h5, .conversation-content blockquote h6,
    .message-content blockquote h6, .chat-message blockquote h6, .message-body blockquote h6 {
      background: transparent !important; color: #f8fafc !important;
    }
    .chat-panel blockquote p, .conversation-content blockquote p,
    .message-content blockquote p, .chat-message blockquote p, .message-body blockquote p,
    .chat-panel blockquote em, .conversation-content blockquote em,
    .message-content blockquote em, .chat-message blockquote em, .message-body blockquote em {
      background: transparent !important; color: #cbd5e1 !important;
    }
    .chat-panel blockquote a, .conversation-content blockquote a,
    .message-content blockquote a, .chat-message blockquote a, .message-body blockquote a {
      color: #93c5fd !important; text-decoration-color: #93c5fd !important;
    }
    /* Chat category rail: All chats / people / groups and its scroll arrows. */
    gux-tab-list.gux-horizontal,
    gux-tab-list.gux-horizontal .gux-tab-container,
    gux-tab-list.gux-horizontal .gux-scrollable-section,
    gux-tab-list.gux-horizontal .gux-scroll-button-container {
      background: #20262d !important; color: #e5e7eb !important;
      border-color: #3a4655 !important;
    }
    gux-tab-list.gux-horizontal button.gux-tab,
    gux-tab-list.gux-horizontal button.gux-scroll-button {
      background: transparent !important; color: #cbd5e1 !important;
      border-color: transparent !important; box-shadow: none !important;
    }
    gux-tab-list.gux-horizontal button.gux-tab:hover,
    gux-tab-list.gux-horizontal button.gux-scroll-button:hover:not(:disabled) {
      background: #343d49 !important; color: #fff !important;
    }
    gux-tab-list.gux-horizontal button.gux-tab.gux-active,
    gux-tab-list.gux-horizontal button.gux-tab[aria-selected="true"] {
      background: #343d49 !important; color: #fff !important;
      border-color: #4b596a !important;
      box-shadow: inset 0 -2px 0 #38bdf8 !important;
    }
    gux-tab-list.gux-horizontal button.gux-tab gux-icon,
    gux-tab-list.gux-horizontal button.gux-scroll-button gux-icon,
    gux-tab-list.gux-horizontal button.gux-tab svg,
    gux-tab-list.gux-horizontal button.gux-scroll-button svg {
      background: transparent !important; color: currentColor !important; fill: currentColor !important;
    }
    gux-tab-list.gux-horizontal .tab-has-unreads-icon:not(.hidden) {
      background: #ff1744 !important; border-color: #fff !important;
    }
    gux-tab-list.gux-horizontal button.gux-scroll-button:disabled {
      color: #64748b !important; opacity: .65 !important;
    }
    /* Directory Profile tab (the full-page profile, not the hover card). */
    .entity-profile.person-detail.profile,
    .entity-profile.person-detail.profile > [role="main"],
    .entity-profile.person-detail.profile .profile-sections,
    .entity-profile.person-detail.profile .masonry-container {
      background: #1d2025 !important; color: #e5e7eb !important;
      border-color: #3a4655 !important;
    }
    /* The Person app is loaded in its own iframe. Its otherwise unstyled root
       remains white in the gaps around the profile card. */
    .center-stage-frame-agoraUIPerson-internal,
    body:has(.entity-profile.person-detail.profile),
    body:has(.entity-profile.person-detail.profile) > .ember-view,
    body:has(.entity-profile.person-detail.profile) > #ember-basic-dropdown-wormhole {
      background: #1d2025 !important; color: #e5e7eb !important;
      border-color: #3a4655 !important;
    }
    .entity-profile.person-detail.profile .banner,
    .entity-profile.person-detail.profile .banner-content,
    .entity-profile.person-detail.profile .information,
    .entity-profile.person-detail.profile .main-actions {
      background: #252b33 !important; color: #e5e7eb !important;
      border-color: #3a4655 !important;
    }
    .entity-profile.person-detail.profile .content:not(.field-section-content):not(.new-sections),
    .entity-profile.person-detail.profile .sections,
    .entity-profile.person-detail.profile .contact-container,
    .entity-profile.person-detail.profile .entity-contact-group-v2 {
      background: #252b33 !important; color: #e5e7eb !important;
      border-color: #3a4655 !important;
    }
    .entity-profile.person-detail.profile .general,
    .entity-profile.person-detail.profile .status,
    .entity-profile.person-detail.profile .contact-container,
    .entity-profile.person-detail.profile .field-section-content,
    .entity-profile.person-detail.profile .field-group,
    .entity-profile.person-detail.profile .group-values,
    .entity-profile.person-detail.profile .field-entry,
    .entity-profile.person-detail.profile .field-component,
    .entity-profile.person-detail.profile .field-value {
      background: transparent !important; color: #e5e7eb !important;
      border-color: #3a4655 !important;
    }
    .entity-profile.person-detail.profile .entity-field-section,
    .entity-profile.person-detail.profile .field-section-header,
    .entity-profile.person-detail.profile .new-sections,
    .entity-profile.person-detail.profile .new-sections .content {
      background: #252b33 !important; color: #e5e7eb !important;
      border-color: #3a4655 !important;
    }
    .entity-profile.person-detail.profile .field-section-header {
      background: #20262d !important;
    }
    .entity-profile.person-detail.profile input.form-control,
    .entity-profile.person-detail.profile textarea.status-input {
      background: #171b20 !important; color: #f8fafc !important;
      border-color: #4b596a !important; box-shadow: none !important;
    }
    .entity-profile.person-detail.profile input.form-control::placeholder,
    .entity-profile.person-detail.profile textarea.status-input::placeholder { color: #94a3b8 !important; }
    .entity-profile.person-detail.profile .title,
    .entity-profile.person-detail.profile .label-component label,
    .entity-profile.person-detail.profile .presence-label,
    .entity-profile.person-detail.profile .entity-status h6,
    .entity-profile.person-detail.profile .field-value,
    .entity-profile.person-detail.profile .value { color: #e5e7eb !important; }
    .entity-profile.person-detail.profile a { color: #93c5fd !important; }
    .entity-profile.person-detail.profile .label.label-default {
      background: #343d49 !important; color: #e5e7eb !important; border-color: #4b596a !important;
    }
    .entity-profile.person-detail.profile .new-sections .section-icon:hover,
    .entity-profile.person-detail.profile .edit-profile gux-button:hover,
    .entity-profile.person-detail.profile .add-new-section gux-button:hover {
      background: #343d49 !important; color: #fff !important;
    }
    /* Keep the Profile canvas continuous. The Person app creates several
       empty structural bands between banner, actions, and sections; giving
       them the base canvas color avoids the visible dark stripes. */
    .entity-profile.person-detail.profile,
    .entity-profile.person-detail.profile > [role="main"],
    .entity-profile.person-detail.profile .profile-sections,
    .entity-profile.person-detail.profile .sections,
    .entity-profile.person-detail.profile .masonry-container,
    .entity-profile.person-detail.profile .entity-contact-group-v2,
    .entity-profile.person-detail.profile .contact-container {
      background: #252b33 !important;
    }
    .entity-profile.person-detail.profile .banner > .content,
    .entity-profile.person-detail.profile .main-actions,
    .entity-profile.person-detail.profile .add-section,
    .entity-profile.person-detail.profile .add-new-section {
      border-color: #3a4655 !important;
      box-shadow: none !important;
    }
    /* Profile information cards are intentionally raised, but every internal
       surface uses the same shade so their header never looks like a dark bar. */
    .entity-profile.person-detail.profile .entity-field-section.contactInfo,
    .entity-profile.person-detail.profile .entity-field-section.contactInfo .field-section-header,
    .entity-profile.person-detail.profile .entity-field-section.contactInfo .field-section-header .header,
    .entity-profile.person-detail.profile .entity-field-section.contactInfo .field-section-content,
    .entity-profile.person-detail.profile .entity-field-section.contactInfo .field-group,
    .entity-profile.person-detail.profile .entity-field-section.contactInfo .group-values,
    .entity-profile.person-detail.profile .entity-field-section.contactInfo .field-entry,
    .entity-profile.person-detail.profile .entity-field-section.contactInfo .field-component,
    .entity-profile.person-detail.profile .entity-field-section.contactInfo .field-value,
    .entity-profile.person-detail.profile .entity-field-section.contactInfo .email-field-content,
    .entity-profile.person-detail.profile .entity-field-section.contactInfo .value,
    .entity-profile.person-detail.profile .entity-field-section.contactInfo .value-type {
      background: #20262d !important; color: #e5e7eb !important;
      border-color: #3a4655 !important;
    }
    .entity-profile.person-detail.profile .entity-field-section.contactInfo {
      border: 1px solid #4b596a !important; border-radius: 8px !important;
      overflow: hidden !important; box-shadow: 0 8px 20px rgba(0, 0, 0, .28) !important;
    }
    .entity-profile.person-detail.profile .entity-field-section.contactInfo .field-section-header {
      border-bottom: 1px solid #3a4655 !important;
    }
    /* The outer masonry field-section owns the native white corner surface.
       Make it the only card shell; its inner entity card is intentionally
       flattened so the entire contact card is one continuous dark surface. */
    .entity-profile.person-detail.profile .field-section.contactInfo-section,
    .entity-profile.person-detail.profile .field-section.contactInfo-section .entity-field-section.contactInfo,
    .entity-profile.person-detail.profile .field-section.contactInfo-section .field-section-header,
    .entity-profile.person-detail.profile .field-section.contactInfo-section .field-section-content,
    .entity-profile.person-detail.profile .field-section.contactInfo-section .field-group,
    .entity-profile.person-detail.profile .field-section.contactInfo-section .group-values,
    .entity-profile.person-detail.profile .field-section.contactInfo-section .field-entry,
    .entity-profile.person-detail.profile .field-section.contactInfo-section .field-component,
    .entity-profile.person-detail.profile .field-section.contactInfo-section .field-value,
    .entity-profile.person-detail.profile .field-section.contactInfo-section .email-field-content,
    .entity-profile.person-detail.profile .field-section.contactInfo-section .value,
    .entity-profile.person-detail.profile .field-section.contactInfo-section .value-type {
      background: #1d2025 !important; color: #e5e7eb !important;
    }
    .entity-profile.person-detail.profile .field-section.contactInfo-section {
      border: 1px solid #4b596a !important; border-radius: 8px !important;
      overflow: hidden !important; box-shadow: 0 8px 20px rgba(0, 0, 0, .30) !important;
    }
    .entity-profile.person-detail.profile .field-section.contactInfo-section .entity-field-section.contactInfo {
      border: 0 !important; border-radius: 0 !important; box-shadow: none !important;
    }
    .entity-profile.person-detail.profile .field-section.contactInfo-section .field-section-header .header,
    .entity-profile.person-detail.profile .field-section.contactInfo-section .field-section-header .header .title {
      background: #1d2025 !important; color: #e5e7eb !important;
    }
    /* Profile settings dropdown — an elevated card with list-style settings
       rows. Every visual row is also the full interactive target. */
    .user-settings-popover {
      background: #1d2025 !important; color: #e5e7eb !important;
      border: 1px solid #4b596a !important; border-radius: 10px !important;
      overflow: hidden !important; box-shadow: 0 12px 28px rgba(0, 0, 0, .36) !important;
    }
    .user-settings-popover .info-card {
      margin: 10px 10px 8px !important; padding: 10px !important;
      background: #20262d !important; border: 1px solid #3a4655 !important;
      border-radius: 8px !important; box-shadow: 0 5px 14px rgba(0, 0, 0, .22) !important;
    }
    .user-settings-popover .user-information,
    .user-settings-popover .avatar-header,
    .user-settings-popover .user-sub-info,
    .user-settings-popover .status-container {
      background: transparent !important; border-color: transparent !important;
    }
    .user-settings-popover .user-name { color: #f8fafc !important; }
    .user-settings-popover .org-name,
    .user-settings-popover .user-sub-info { color: #94a3b8 !important; }
    .user-settings-popover .status-container gux-form-field-text-like,
    .user-settings-popover .status-container .gux-input-container,
    .user-settings-popover .status-container input {
      background: #171b20 !important; color: #f8fafc !important;
      border-color: #4b596a !important; border-radius: 6px !important;
      box-shadow: none !important;
    }
    .user-settings-popover .status-container input { min-height: 34px !important; padding: 0 9px !important; }
    .user-settings-popover .settings-container,
    .user-settings-popover .menu-options,
    .user-settings-popover .settings-scroll {
      background: #20262d !important; border-color: #3a4655 !important;
    }
    .user-settings-popover .menu-row,
    .user-settings-popover .menu-row * {
      background: transparent !important; box-shadow: none !important;
    }
    .user-settings-popover .menu-row {
      display: flex !important; align-items: center !important; width: 100% !important;
      min-height: 44px !important; padding: 7px 14px !important; box-sizing: border-box !important;
      color: #e5e7eb !important; border: 0 !important; border-bottom: 1px solid #3a4655 !important;
      border-radius: 0 !important; text-decoration: none !important;
    }
    .user-settings-popover .user-menu-option:first-child .menu-row {
      box-shadow: inset 3px 0 0 var(--gbs-my-status-color, #64748b) !important;
    }
    .user-settings-popover .menu-row:hover,
    .user-settings-popover .menu-row:focus-visible {
      background: #2d3540 !important; color: #fff !important; outline: 0 !important;
    }
    .user-settings-popover .menu-row:hover *,
    .user-settings-popover .menu-row:focus-visible * { color: inherit !important; }
    .user-settings-popover .menu-row-icon,
    .user-settings-popover .link-hover-icon,
    .user-settings-popover .account-for-two-layer-text-centering {
      color: #93c5fd !important; flex: 0 0 auto !important;
    }
    .user-settings-popover .menu-row-text-label { min-width: 0 !important; flex: 1 1 auto !important; }
    .user-settings-popover .menu-row-text-sub-label { color: #94a3b8 !important; }
    .user-settings-popover .user-settings-footer {
      display: flex !important; gap: 8px !important; padding: 10px !important;
      background: #1d2025 !important; border-top: 1px solid #3a4655 !important;
    }
    .user-settings-popover .user-settings-footer gux-button-slot { flex: 1 1 0 !important; }
    .user-settings-popover .user-settings-footer button {
      width: 100% !important; min-height: 34px !important; padding: 6px 10px !important;
      border-radius: 6px !important; box-shadow: none !important;
    }
    .user-settings-popover [data-testid="user-setting-preferences-button"] {
      background: #2d3540 !important; color: #e5e7eb !important; border-color: #4b596a !important;
    }
    .user-settings-popover [data-testid="user-setting-preferences-button"]:hover { background: #3b4655 !important; color: #fff !important; }
    .user-settings-popover [data-testid="user-setting-logout-button"] {
      background: #4a1f2a !important; color: #fecdd3 !important; border-color: #9f1239 !important;
    }
    .user-settings-popover [data-testid="user-setting-logout-button"]:hover { background: #651f2b !important; color: #fff !important; }
    /* Presence submenu: it replaces the ordinary menu list, so preserve the
       same card hierarchy and turn each radio label into the complete target. */
    .user-settings-popover .presence-selector-menu,
    .user-settings-popover .settings-scroll-with-header,
    .user-settings-popover .settings-scroll-with-header form,
    .user-settings-popover gux-form-field-radio-group-beta {
      background: #20262d !important; border-color: #3a4655 !important;
    }
    .user-settings-popover .presence-selector-menu .menu-header {
      min-height: 46px !important; padding: 8px 14px !important;
      background: #1d2025 !important; color: #f8fafc !important;
      border-bottom: 1px solid #4b596a !important; box-shadow: none !important;
    }
    .user-settings-popover .presence-selector-menu .menu-close {
      display: inline-grid !important; place-items: center !important;
      width: 30px !important; min-width: 30px !important; height: 30px !important;
      padding: 0 !important; background: #2d3540 !important; color: #cbd5e1 !important;
      border: 1px solid #4b596a !important; border-radius: 6px !important;
    }
    .user-settings-popover .presence-selector-menu .menu-close:hover,
    .user-settings-popover .presence-selector-menu .menu-close:focus-visible {
      background: #3b4655 !important; color: #fff !important; border-color: #93c5fd !important;
      outline: 0 !important;
    }
    .user-settings-popover .user-presence-input,
    .user-settings-popover .user-presence-input gux-form-field-radio,
    .user-settings-popover .user-presence-input label {
      background: transparent !important; box-shadow: none !important;
    }
    .user-settings-popover .user-presence-input {
      border-bottom: 1px solid #3a4655 !important;
    }
    .user-settings-popover .user-presence-input label {
      display: flex !important; align-items: center !important; gap: 10px !important;
      min-height: 42px !important; padding: 7px 14px !important; box-sizing: border-box !important;
      color: #e5e7eb !important; cursor: pointer !important; transition: background-color 120ms ease, color 120ms ease !important;
    }
    /* Earlier generic menu text styling painted a separate small rectangle
       behind labels. Status rows are single surfaces: only the row changes. */
    .user-settings-popover .user-presence-input label .menu-row-text-label,
    .user-settings-popover .user-presence-input label .menu-row-text-label *,
    .user-settings-popover .user-presence-input:hover label .menu-row-text-label,
    .user-settings-popover .user-presence-input:focus-within label .menu-row-text-label,
    .user-settings-popover .user-presence-input:has(input:checked) label .menu-row-text-label {
      background: transparent !important; background-color: transparent !important;
      border-color: transparent !important; box-shadow: none !important; color: inherit !important;
    }
    .user-settings-popover .user-presence-input:hover label,
    .user-settings-popover .user-presence-input:focus-within label {
      background: #2d3540 !important; color: #fff !important;
    }
    .user-settings-popover .user-presence-input input.presence-input {
      position: absolute !important; inline-size: 1px !important; block-size: 1px !important;
      margin: -1px !important; opacity: 0 !important; pointer-events: none !important;
    }
    .user-settings-popover .user-presence-input label::before {
      content: '' !important; flex: 0 0 16px !important; width: 16px !important; height: 16px !important;
      box-sizing: border-box !important; border: 2px solid #94a3b8 !important; border-radius: 50% !important;
      background: transparent !important;
    }
    .user-settings-popover .user-presence-input:has(input:checked) label {
      background: rgba(59, 130, 246, .14) !important; color: #f8fafc !important;
      box-shadow: inset 3px 0 0 var(--gbs-my-status-color, #64748b) !important;
    }
    .user-settings-popover .user-presence-input:has(input:checked) label::before {
      border-color: var(--gbs-my-status-color, #64748b) !important;
      box-shadow: inset 0 0 0 3px #20262d !important;
      background: var(--gbs-my-status-color, #64748b) !important;
    }
    /* Make the chosen status intentional even before its global profile
       variable updates. This avoids a generic grey selected row. */
    .user-settings-popover .user-presence-input:has(input[value="Available"]:checked) label,
    .user-settings-popover .user-presence-input:has(input[value="On Queue"]:checked) label { background: rgba(34, 197, 94, .14) !important; box-shadow: inset 3px 0 0 #22c55e !important; }
    .user-settings-popover .user-presence-input:has(input[value="Available"]:checked) label::before,
    .user-settings-popover .user-presence-input:has(input[value="On Queue"]:checked) label::before { background: #22c55e !important; border-color: #22c55e !important; }
    .user-settings-popover .user-presence-input:has(input[value="Busy"]:checked) label { background: rgba(244, 63, 94, .14) !important; box-shadow: inset 3px 0 0 #f43f5e !important; }
    .user-settings-popover .user-presence-input:has(input[value="Busy"]:checked) label::before { background: #f43f5e !important; border-color: #f43f5e !important; }
    .user-settings-popover .user-presence-input:has(input[value="Away"]:checked) label,
    .user-settings-popover .user-presence-input:has(input[value="Break"]:checked) label { background: rgba(234, 179, 8, .14) !important; box-shadow: inset 3px 0 0 #eab308 !important; }
    .user-settings-popover .user-presence-input:has(input[value="Away"]:checked) label::before,
    .user-settings-popover .user-presence-input:has(input[value="Break"]:checked) label::before { background: #eab308 !important; border-color: #eab308 !important; }
    .user-settings-popover .user-presence-input:has(input[value="Meal"]:checked) label { background: rgba(249, 115, 22, .14) !important; box-shadow: inset 3px 0 0 #f97316 !important; }
    .user-settings-popover .user-presence-input:has(input[value="Meal"]:checked) label::before { background: #f97316 !important; border-color: #f97316 !important; }
    .user-settings-popover .user-presence-input:has(input[value="Meeting"]:checked) label,
    .user-settings-popover .user-presence-input:has(input[value="Out of Office"]:checked) label { background: rgba(168, 85, 247, .14) !important; box-shadow: inset 3px 0 0 #a855f7 !important; }
    .user-settings-popover .user-presence-input:has(input[value="Meeting"]:checked) label::before,
    .user-settings-popover .user-presence-input:has(input[value="Out of Office"]:checked) label::before { background: #a855f7 !important; border-color: #a855f7 !important; }
    .user-settings-popover .user-presence-input:has(input[value="Training"]:checked) label { background: rgba(59, 130, 246, .14) !important; box-shadow: inset 3px 0 0 #3b82f6 !important; }
    .user-settings-popover .user-presence-input:has(input[value="Training"]:checked) label::before { background: #3b82f6 !important; border-color: #3b82f6 !important; }
    .user-settings-popover .user-presence-input label gux-icon,
    .user-settings-popover .user-presence-input label .gux-icon-container { color: #93c5fd !important; margin-left: auto !important; }
    /* All popup menu labels share one row surface, including the ordinary
       settings list behind the presence submenu. */
    .user-settings-popover .menu-row .menu-row-text-label,
    .user-settings-popover .menu-row .menu-row-text-label *,
    .user-settings-popover .menu-row:hover .menu-row-text-label,
    .user-settings-popover .menu-row:hover .menu-row-text-label * {
      background: transparent !important; background-color: transparent !important;
      border-color: transparent !important; box-shadow: none !important; color: inherit !important;
    }
    .user-settings-popover .menu-row { transition: background-color 120ms ease, color 120ms ease !important; }
    .user-settings-popover .menu-row:hover,
    .user-settings-popover .menu-row:focus-visible,
    .user-settings-popover .menu-row.active { background: #2d3540 !important; }
    .user-settings-popover,
    .user-settings-popover .info-card { border-color: #62738a !important; }
    .user-settings-popover .menu-row,
    .user-settings-popover .user-presence-input,
    .user-settings-popover .user-settings-footer,
    .user-settings-popover .presence-selector-menu .menu-header { border-color: #4f6074 !important; }
    .user-settings-popover .settings-scroll,
    .user-settings-popover .settings-scroll-with-header {
      scrollbar-width: thin !important; scrollbar-color: #a5b4c8 #151a20 !important;
    }
    .user-settings-popover .settings-scroll::-webkit-scrollbar,
    .user-settings-popover .settings-scroll-with-header::-webkit-scrollbar { width: 9px !important; }
    .user-settings-popover .settings-scroll::-webkit-scrollbar-track,
    .user-settings-popover .settings-scroll-with-header::-webkit-scrollbar-track { background: #151a20 !important; }
    .user-settings-popover .settings-scroll::-webkit-scrollbar-thumb,
    .user-settings-popover .settings-scroll-with-header::-webkit-scrollbar-thumb {
      background: #a5b4c8 !important; border: 2px solid #151a20 !important; border-radius: 999px !important;
    }
    .user-settings-popover .settings-scroll::-webkit-scrollbar-thumb:hover,
    .user-settings-popover .settings-scroll-with-header::-webkit-scrollbar-thumb:hover { background: #d5e0ee !important; }
    .entity-profile.person-detail.profile .field-section.contactInfo-section::before,
    .entity-profile.person-detail.profile .field-section.contactInfo-section::after,
    .entity-profile.person-detail.profile .field-section.contactInfo-section .entity-field-section.contactInfo::before,
    .entity-profile.person-detail.profile .field-section.contactInfo-section .entity-field-section.contactInfo::after {
      background: transparent !important; border-color: transparent !important; box-shadow: none !important;
    }
    /* Call-panel tab icons inherit a separate app-img tile. Let the active
       button own the background instead of painting a dark square behind it. */
    button.toggle-item .app-img.icon,
    button.toggle-item:hover .app-img.icon,
    button.toggle-item:focus-visible .app-img.icon,
    button.toggle-item.active .app-img.icon,
    button.toggle-item[aria-selected="true"] .app-img.icon,
    [role="tab"].toggle-item .app-img.icon,
    button.toggle-item .app-img.icon > gux-icon,
    button.toggle-item .app-img.icon .gux-icon-container {
      background: transparent !important; background-color: transparent !important;
      border-color: transparent !important; box-shadow: none !important;
    }
    /* Captured white surfaces that can appear in the live command/inbox/chat
       experience. Each is named intentionally to preserve unrelated native UI. */
    .side-panel, .inbox-panel .inbox-message, .entity-mini-card,
    .search-suggestions, .feedback-section-v2 .feedback-pane,
    #profile-hover-card-popover #profile-hover-card,
    .chat-textarea-container, .conversation-controls .drop-down-component .menu,
    .call-controls .conversations-heading .call-fax-dropdown,
    .drop-down-component .add-callback-numbers-dropdown,
    .drop-down-component .dialpad-dtmf-dropdown,
    .drop-down-component .dialpad-dtmf-dropdown-consult,
    .drop-down-component .transfer-dropdown {
      background: var(--gbs-surface-raised) !important;
      color: var(--gbs-text-primary) !important;
      border-color: var(--gbs-border-strong) !important;
    }
    #popover-arrow { background: var(--gbs-surface-raised) !important; }
    .inbox-panel .inbox-message .inbox-message-content,
    .inbox-panel .inbox-message .inbox-message-title,
    .inbox-panel .inbox-message .inbox-message-preview,
    .entity-mini-card .name-header,
    .entity-mini-card .sub-header {
      background: transparent !important; color: inherit !important;
    }
    .user-settings-popover [class*="card"], .user-settings-popover [class*="section"], .user-settings-popover [class*="item"], .user-settings-popover [class*="row"], .results.suggest-results [class*="item"] { background: #20262d !important; color: #e5e7eb !important; border-color: #3a4655 !important; }
    .user-settings-popover input, .results.suggest-results input, .side-panel input, .side-panel textarea { background: #171b20 !important; color: #f8fafc !important; border-color: #4b596a !important; }
    .user-settings-popover a, .side-panel a, .acd-interactions-panel a, .results.suggest-results a { color: #93c5fd !important; }
    .mainstage-size-btn, .mainstage-size-btn:hover { background: #2d3540 !important; color: #e5e7eb !important; border-color: #4b596a !important; }

    /* Analytics dashboard cards use the same palette instead of the old brown/light mix. */
    .analytics-ui-dashboard-widget-grid, .parent-grid, .widget-body, .widget-content { background: #1d2025 !important; color: #e5e7eb !important; }
    /* Transparent dashboard grids otherwise expose the browser's black
       fullscreen canvas. Keep normal embedded transparency unchanged. */
    .dashboard-fullscreen-target:fullscreen,
    :fullscreen:has(.dashboard-fullscreen-target) {
      background: var(--gbs-surface-base, #1d2025) !important;
    }
    .dashboard-fullscreen-target:fullscreen::backdrop,
    :fullscreen:has(.dashboard-fullscreen-target)::backdrop {
      background: var(--gbs-surface-base, #1d2025) !important;
    }
    /* The generic widget rule above is right for Dashboard cards, but the
       Board is a transparent overlay by design. Its widget canvas must not
       become a large grey rectangle behind the actual table. */
    .main-grid .analytics-ui-dashboard-widget:has(.gbs-sidebar),
    .main-grid .analytics-ui-dashboard-widget:has(.gbs-sidebar) .widget-body,
    .main-grid .analytics-ui-dashboard-widget:has(.gbs-sidebar) .widget-content,
    .main-grid .analytics-ui-dashboard-widget:has(.gbs-sidebar) .analytics-ui-dashboard-widget-agent-list-display {
      background: transparent !important; background-color: transparent !important; background-image: none !important;
    }
    /* Genesys has changed the Board's wrapper hierarchy several times. Match
       the actual presence of the enhanced table instead of a wrapper name. */
    .analytics-ui-dashboard-widget:has(table.gbs-board),
    .analytics-ui-dashboard-widget:has(table.gbs-board) .widget-body,
    .analytics-ui-dashboard-widget:has(table.gbs-board) .widget-content,
    .analytics-ui-dashboard-widget:has(table.gbs-board) .table-wrapper,
    .analytics-ui-dashboard-widget:has(table.gbs-board) gux-table,
    .analytics-ui-dashboard-widget:has(table.gbs-board) [class*="table-container"],
    .analytics-ui-dashboard-widget:has(table.gbs-board) [class*="table-viewport"] {
      background: transparent !important; background-color: transparent !important; background-image: none !important;
    }
    .analytics-ui-dashboard-widget { background: var(--gbs-surface-base, #1d2025) !important; color: #e5e7eb !important; border-color: #3a4655 !important; }
    .main-grid .analytics-ui-dashboard-widget:not(.sidebar-widget) {
      border-color: color-mix(in srgb, var(--gbs-card-border-cyan) 70%, #3a4655) !important;
      outline: 1px solid color-mix(in srgb, var(--gbs-card-border-cyan) 70%, #3a4655) !important;
      outline-offset: -1px !important;
    }
    .gbs-summary-card {
      border-top-width: 1px !important;
      border-right-width: 1px !important;
      border-bottom-width: 1px !important;
      border-left-width: 4px !important;
      border-top-color: #3a4655 !important;
      border-right-color: #3a4655 !important;
      border-bottom-color: #3a4655 !important;
      box-shadow: 0 1px 2px rgba(0,0,0,.22) !important;
    }
    .analytics-ui-dashboard-widget .widget-title, .analytics-ui-dashboard-widget .widget-title-display { background: var(--gbs-surface-base, #1d2025) !important; color: #f8fafc !important; }
    .analytics-ui-dashboard-widget a { color: #93c5fd !important; }
    .analytics-ui-dashboard-widget [class*="value"], .analytics-ui-dashboard-widget [class*="metric"] { color: #a5b4fc !important; }
    /* Board canvas follows the same named surface all the way through the
       widget and viewport chain, rather than inheriting the generic card fill. */
    /* The Board is a table panel, not a separate dark card.  Keep every
       nested table layer on the same surface as the panel around it. */
    .main-grid { --gbs-board-canvas: #1d2025; }
    .analytics-ui-dashboard-widget:has(table.gbs-board),
    .analytics-ui-dashboard-widget:has(table.gbs-board) .widget-body,
    .analytics-ui-dashboard-widget:has(table.gbs-board) .widget-content,
    .analytics-ui-dashboard-widget:has(table.gbs-board) .analytics-ui-dashboard-widget-agent-list-display,
    .analytics-ui-dashboard-widget:has(table.gbs-board) .table-wrapper,
    .analytics-ui-dashboard-widget:has(table.gbs-board) gux-table,
    .analytics-ui-dashboard-widget:has(table.gbs-board) [class*="table-container"],
    .analytics-ui-dashboard-widget:has(table.gbs-board) [class*="table-viewport"] {
      background-color: var(--gbs-board-canvas) !important;
    }
    /* This explicitly wins over the broad dark-mode rule for all analytics
       tables (#20262d). It is the table's own paint layer that was leaving a
       visibly different rectangle in the Board row gaps. */
    .analytics-ui-gux-table:has(table.gbs-board) table.gbs-board,
    .analytics-ui-gux-table:has(table.gbs-board) table.gbs-board > tbody,
    .analytics-ui-gux-table:has(table.gbs-board) table.gbs-board > thead {
      background-color: var(--gbs-board-canvas) !important;
    }

    /* Responsive, compact dashboard cards: works with any number of widgets. */
    .main-grid {
      display: grid !important;
      grid-template-rows: none !important;
      grid-auto-rows: max-content !important;
      width: 100% !important; max-width: 100% !important; box-sizing: border-box !important;
      grid-template-columns: repeat(4, minmax(0, 1fr)) !important;
      gap: 10px !important; padding: 10px 17px 10px 10px !important;
      align-items: flex-start !important; align-content: flex-start !important;
      overflow-x: hidden !important;
    }
    body .main-grid[class*="-rows"] { grid-template-rows: none !important; grid-auto-rows: max-content !important; }
    .main-grid .gbs-sidebar { min-height: 100% !important; align-self: stretch !important; }
    /* The Board block overlays this grid on the right, so reserve its live width for dashboard cards. */
    .main-grid.gbs-grid-scroll { padding-right: calc(10px + var(--gbs-board-width, 500px)) !important; }
    .main-grid > .widget-drop-target { display: none !important; }
    .main-grid > .widget-container {
      min-width: 0 !important; min-height: 0 !important; height: auto !important;
      position: relative !important; align-self: flex-start !important;
      flex: 1 1 calc((100% - 30px) / 4) !important;
      max-width: calc((100% - 30px) / 4) !important;
      grid-column: auto !important; grid-row: auto !important;
    }
    /* Genesys leaves zero-height placeholders after the last real widget. In a
       flex dashboard they still create extra rows/gaps and a needless scrollbar. */
    .main-grid > .widget-container.widget-container-hidden,
    .main-grid > .widget-container:empty,
    .main-grid > .widget-container:not(:has(.analytics-ui-dashboard-widget)) { display: none !important; }
    .main-grid > .widget-container.full-width { grid-column: 1 / -1 !important; width: 100% !important; max-width: none !important; }
    .main-grid .widget-container .js-draggableObject { height: auto !important; min-height: 0 !important; }
    .main-grid .analytics-ui-dashboard-widget {
      height: auto !important; min-height: 0 !important; overflow: hidden !important;
      background: #20262d !important; border: 1px solid #364152 !important;
      border-radius: 8px !important; box-shadow: 0 1px 2px rgba(0,0,0,.18) !important;
    }
    .main-grid .analytics-ui-dashboard-widget .widget-title,
    .main-grid .analytics-ui-dashboard-widget .widget-title-display {
      min-height: 28px !important; padding: 5px 7px !important; background: #2b3440 !important;
      font-size: clamp(13px, 0.88vw, 16px) !important; line-height: 20px !important; overflow: hidden !important;
      text-overflow: ellipsis !important; white-space: nowrap !important;
    }
    .main-grid .analytics-ui-dashboard-widget .widget-title { border-radius: 5px !important; overflow: hidden !important; }
    .main-grid .analytics-ui-dashboard-widget .widget-title-display { border-radius: 4px !important; }
    .main-grid .analytics-ui-dashboard-widget .widget-title *,
    .main-grid .analytics-ui-dashboard-widget .widget-title-display *,
    .main-grid .analytics-ui-dashboard-widget .widget-title h1,
    .main-grid .analytics-ui-dashboard-widget .widget-title h2,
    .main-grid .analytics-ui-dashboard-widget .widget-title h3 { font-size: inherit !important; line-height: inherit !important; }
    .main-grid .analytics-ui-dashboard-widget .widget-body,
    .main-grid .analytics-ui-dashboard-widget .widget-content { padding: 8px 10px !important; }
    .main-grid .analytics-ui-dashboard-widget-grid-display .grid-container { row-gap: var(--gbs-metric-row-gap, 8px) !important; align-content: flex-start !important; }
    .main-grid .analytics-ui-dashboard-widget:has(.analytics-ui-dashboard-widget-grid-display) .widget-content { padding-top: var(--gbs-metric-inset, 8px) !important; padding-bottom: var(--gbs-metric-inset, 8px) !important; }
    .main-grid .analytics-ui-dashboard-widget-grid-display .grid-container { padding-top: var(--gbs-metric-inset, 8px) !important; padding-bottom: var(--gbs-metric-inset, 8px) !important; }
    .main-grid .analytics-ui-dashboard-widget a { color: #f8fafc !important; text-decoration: none !important; }
    .main-grid .analytics-ui-dashboard-widget a { display: block !important; min-width: 0 !important; overflow: hidden !important; text-overflow: ellipsis !important; white-space: nowrap !important; font-size: clamp(12px, .86vw, 15px) !important; }
    .main-grid .analytics-ui-dashboard-widget a[href*="/queues/"][data-gbs-short-label] { position: relative !important; color: transparent !important; text-indent: -10000px !important; }
    .main-grid .analytics-ui-dashboard-widget a[data-gbs-short-label]::after { content: attr(data-gbs-short-label) !important; position: absolute !important; inset: 0 !important; display: block !important; overflow: hidden !important; text-overflow: ellipsis !important; white-space: nowrap !important; text-indent: 0 !important; color: #f8fafc !important; font-size: clamp(12px, .86vw, 15px) !important; line-height: inherit !important; }
    .main-grid .analytics-ui-dashboard-widget a:hover { color: #fff !important; text-decoration: underline !important; text-decoration-color: #64748b !important; }
    .main-grid .analytics-ui-dashboard-widget-grid-display .grid-container { grid-template-columns: minmax(0, 1fr) max-content !important; }
    .main-grid .analytics-ui-dashboard-widget-grid-display .difference-cell { display: none !important; }
    .main-grid .analytics-ui-dashboard-widget-grid-display .grid-container > .column-label:not(.column-label-difference-cell),
    .main-grid .analytics-ui-dashboard-widget-grid-display .grid-container > .row-label { grid-column: 1 !important; justify-self: stretch !important; text-align: left !important; min-width: 0 !important; overflow: hidden !important; }
    .main-grid .analytics-ui-dashboard-widget-grid-display .grid-container > .column-label-data-cell,
    .main-grid .analytics-ui-dashboard-widget-grid-display .grid-container > .data-cell:not(.difference-cell) { grid-column: 2 !important; justify-self: end !important; min-width: max-content !important; text-align: right !important; }
    .main-grid .analytics-ui-dashboard-widget-grid-display .row-label-text { display: block !important; overflow: hidden !important; text-overflow: ellipsis !important; white-space: nowrap !important; text-align: left !important; }
    .main-grid .analytics-ui-dashboard-widget a { text-align: left !important; }
    /* Preserve the 20px text line-height; remove only the extra 5px row cushion. */
    .main-grid .row-item, .main-grid .data-cell, .main-grid .aggregate-cell { min-height: 20px !important; font-size: 15px !important; line-height: 20px !important; }
    .main-grid .row-label, .main-grid .column-label { font-size: 14px !important; line-height: 19px !important; }
    .main-grid .cell-display-text, .main-grid .difference-value { font-size: 19px !important; line-height: 22px !important; }
    .main-grid .analytics-ui-dashboard-widget .row-label,
    .main-grid .analytics-ui-dashboard-widget .column-label,
    .main-grid .analytics-ui-dashboard-widget .data-cell,
    .main-grid .analytics-ui-dashboard-widget .aggregate-cell,
    .main-grid .analytics-ui-dashboard-widget .cell-display-text,
    .main-grid .analytics-ui-dashboard-widget .difference-value { color: #f8fafc !important; }
    .gbs-sla-title { display: flex !important; align-items: center !important; }
    .gbs-sla-badge { display: inline-flex !important; align-items: center !important; margin-left: 8px !important; padding: 2px 6px !important; border: 1px solid currentColor !important; border-radius: 5px !important; font-size: 16px !important; line-height: 18px !important; font-weight: 700 !important; }
    .gbs-sla-badge.gbs-sla-good { color: #39ff88 !important; background: rgba(57,255,136,.14) !important; }
    .gbs-sla-badge.gbs-sla-low { color: #ff1744 !important; background: rgba(255,23,68,.14) !important; }
    .gbs-sla-badge.gbs-sla-neutral { color: #cbd5e1 !important; background: rgba(148,163,184,.14) !important; }

    .main-grid.gbs-dashboard-columns-4 { grid-template-columns: repeat(4, minmax(0, 1fr)) !important; }
    .main-grid.gbs-dashboard-columns-3 { grid-template-columns: repeat(3, minmax(0, 1fr)) !important; }
    .main-grid.gbs-dashboard-columns-2 { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
    .main-grid.gbs-dashboard-columns-1 { grid-template-columns: minmax(0, 1fr) !important; }
    body .main-grid[class*="gbs-dashboard-columns-"] > .widget-container:not(.full-width) {
      width: 100% !important; min-width: 0 !important; max-width: none !important;
      grid-column: auto !important; grid-row: auto !important;
    }
    @media (min-width: 1800px) {
      .main-grid.gbs-dashboard-columns-5 .analytics-ui-dashboard-widget .widget-title,
      .main-grid.gbs-dashboard-columns-5 .analytics-ui-dashboard-widget .widget-title-display { min-height: 38px !important; padding: 7px 10px !important; font-size: 18px !important; line-height: 24px !important; }
      .main-grid.gbs-dashboard-columns-5 .analytics-ui-dashboard-widget a,
      .main-grid.gbs-dashboard-columns-5 .analytics-ui-dashboard-widget a[data-gbs-short-label]::after { font-size: 16px !important; }
      .main-grid .row-item, .main-grid .data-cell, .main-grid .aggregate-cell { font-size: 17px !important; line-height: 22px !important; }
      .main-grid .row-label, .main-grid .column-label { font-size: 16px !important; line-height: 21px !important; }
      .main-grid .cell-display-text, .main-grid .difference-value { font-size: 21px !important; line-height: 24px !important; }
      .gbs-sla-badge { font-size: 18px !important; line-height: 20px !important; }
    }

    /* The dashboard breadcrumb/action row stays compact at every viewport. */
    .secondary-nav-bar { min-height: 36px !important; padding: 0 8px !important; }
    .secondary-nav-bar .button-bar-section, .secondary-nav-bar button { min-height: 30px !important; }
    .secondary-nav-bar .entity-name { font-size: 13px !important; }
    .secondary-nav-bar .breadcrumb-back-button, .secondary-nav-bar .favorite-toggle { width: 30px !important; padding: 4px !important; }
    .gux-tab-container, .gux-scrollable-section { min-height: 36px !important; }
    gux-tab { font-size: 12px !important; }

    @media (max-width: 2100px) {
      .command-bar { display: flex !important; align-items: center !important; box-sizing: border-box !important; height: 38px !important; min-height: 38px !important; padding: 0 8px !important; }
      .command-bar > :not(.command-nav), .command-bar .global-actions, .command-bar .all-but-global-search { align-self: center !important; }
      .command-bar .global-actions, .command-bar .all-but-global-search { display: flex !important; align-items: center !important; gap: 4px !important; min-width: 0 !important; }
      .command-bar .all-but-global-search { flex: 1 1 auto !important; }
      .command-bar button, .global-actions button { display: inline-flex !important; align-items: center !important; justify-content: center !important; height: 24px !important; min-height: 24px !important; padding: 2px 5px !important; font-size: 11px !important; line-height: 1 !important; }
      #search-field { height: 24px !important; max-width: 220px !important; font-size: 11px !important; }
      .gux-tab-container, .gux-scrollable-section { height: 29px !important; min-height: 29px !important; }
      /* Keep the dashboard breadcrumb/action strip proportionate to the compact command bar. */
      .secondary-nav-bar { display: flex !important; align-items: center !important; height: 28px !important; min-height: 28px !important; padding: 0 6px !important; box-sizing: border-box !important; }
      .secondary-nav-bar .button-search-interval-picker-bar,
      .secondary-nav-bar .button-search-bar,
      .secondary-nav-bar .bar-center,
      .secondary-nav-bar .bar-right,
      .secondary-nav-bar .other-actions,
      .secondary-nav-bar .button-bar,
      .secondary-nav-bar .entity-breadcrumb,
      .secondary-nav-bar .button-bar-section { display: flex !important; align-items: center !important; align-self: stretch !important; min-height: 0 !important; height: 26px !important; box-sizing: border-box !important; }
      .secondary-nav-bar button { display: inline-flex !important; align-items: center !important; justify-content: center !important; min-height: 24px !important; height: 24px !important; padding: 2px 4px !important; }
      .secondary-nav-bar .breadcrumb-back-button,
      .secondary-nav-bar .favorite-toggle { width: 24px !important; min-width: 24px !important; height: 24px !important; padding: 2px !important; }
      .secondary-nav-bar .entity-name { font-size: 12px !important; line-height: 16px !important; }
      .secondary-nav-bar gux-icon { width: 14px !important; height: 14px !important; font-size: 14px !important; }

      /* The unread badge belongs inside its compact Inbox control, not above the bar. */
      .command-bar-inbox > button { position: relative !important; }
      .command-bar .global-actions, .command-bar .all-but-global-search { overflow: visible !important; }
      .command-bar-inbox { position: relative !important; isolation: isolate !important; z-index: 2147483645 !important; }
      .command-bar-inbox > button { z-index: 2147483646 !important; }
      .command-bar-inbox .alert-badge-unread-holder { top: -4px !important; right: -6px !important; position: absolute !important; z-index: 2147483647 !important; }
      .command-bar-inbox .alert-badge-unread { display: inline-flex !important; align-items: center !important; justify-content: center !important; box-sizing: border-box !important; width: 12px !important; min-width: 12px !important; height: 12px !important; padding: 0 !important; border-radius: 50% !important; font-size: 8px !important; line-height: 12px !important; text-indent: -1px !important; position: relative !important; z-index: 2147483647 !important; }
    }

    /* This is the native sliding menu. Only compact viewports need its placement adjusted. */
    /* Replace the orange Genesys mark with a compact cyan V2 mark. The
       original image stays in the DOM for the application's accessibility
       and layout logic; only its paint is replaced. */
    .command-nav .logo { position: relative !important; width: clamp(22px, 1.5vw, 30px) !important; height: clamp(24px, 1.7vw, 32px) !important; background: center / contain no-repeat url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Ccircle cx='32' cy='11' r='7' fill='%2322d3ee'/%3E%3Crect x='10' y='24' width='44' height='18' rx='9' fill='none' stroke='%2322d3ee' stroke-width='6'/%3E%3Crect x='17' y='48' width='30' height='11' rx='5.5' fill='%2322d3ee'/%3E%3C/svg%3E") !important; filter: drop-shadow(0 0 4px rgba(34,211,238,.34)) !important; }
    .command-nav .logo .logo-image,
    .command-nav .logo .icon-logo-genesys,
    .command-nav .logo-image,
    .command-nav .icon-logo-genesys { opacity: 0 !important; }
    @media (max-width: 2100px) {
      .command-nav .logo-group { top: 7px !important; height: 28px !important; align-items: center !important; }
      .command-nav .logo { width: 24px !important; height: 28px !important; }
      .command-nav .logo-image, .command-nav .icon-logo-genesys { width: 20px !important; height: 20px !important; max-width: 20px !important; max-height: 20px !important; object-fit: contain !important; }
      .command-nav #navigation-menu { height: 28px !important; min-height: 28px !important; padding: 0 8px !important; font-size: 12px !important; transform: translate(-10px, -3px) !important; }
      .command-bar .command-global-search { transition: margin-left .7s ease !important; }
      .command-bar:has(#navigation-menu[aria-expanded="true"]) .command-global-search { margin-left: -18px !important; }
    }
    .command-bar .command-global-search { margin-left: 132px !important; }

    @media (max-width: 1200px) {
      .command-bar button, .global-actions button { height: 26px !important; min-height: 26px !important; padding: 2px 5px !important; font-size: 11px !important; }
      #search-field { max-width: 250px !important; font-size: 12px !important; }
    }
    /* Genesys switches the top bar to icon-only controls at exactly 1040px.
       Keep every compact control on the same measured 32x26px rhythm. */
    @media (max-width: 1040px) {
      .command-bar .global-search-narrow-view { margin-left: 120px !important; }
      /* In expanded mode the native search adds another 132px left margin and
         grows to 521px. Remove that duplicate offset and reserve only the
         measured space that remains before the compact action group. */
      .command-bar .global-search-narrow-view:has(.global-search-bar-with-overlay) { margin-left: 125px !important; }
      .command-bar .global-search-narrow-view:has(.global-search-bar-with-overlay),
      .command-bar .global-search-narrow-view .global-search-bar-with-overlay,
      .command-bar .global-search-narrow-view .global-search-overlay {
        width: 370px !important; min-width: 0 !important; max-width: 370px !important;
      }
      .command-bar .global-search-narrow-view:has(.global-search-bar-with-overlay),
      .command-bar .global-search-narrow-view .global-search-bar-with-overlay,
      .command-bar .global-search-narrow-view .command-global-search,
      .command-bar .global-search-narrow-view .global-search-field,
      .command-bar .global-search-narrow-view .global-search-field-container,
      .command-bar .global-search-narrow-view gux-form-field-search {
        height: 26px !important; min-height: 26px !important; max-height: 26px !important;
      }
      .command-bar .global-search-narrow-view .command-global-search {
        box-sizing: border-box !important; width: 370px !important; min-width: 0 !important; max-width: 370px !important;
        margin: 0 !important; padding-right: 5px !important;
      }
      .command-bar .global-search-narrow-view .global-search-field,
      .command-bar .global-search-narrow-view .global-search-field-container,
      .command-bar .global-search-narrow-view gux-form-field-search {
        box-sizing: border-box !important; width: 365px !important; min-width: 0 !important; max-width: 365px !important;
        padding-bottom: 0 !important; background: transparent !important;
      }
      .command-bar .global-search-narrow-view #search-field { height: 20px !important; min-height: 20px !important; }
      /* Give each compact transition an approximately 10px visual gap. Inbox
         has an extra empty native wrapper; Agent nearly overlaps Queue. */
      .command-bar .global-action-icon-button {
        box-sizing: border-box !important; width: 32px !important; min-width: 32px !important;
        margin: 0 6px 0 0 !important; border-radius: 3px !important; overflow: visible !important;
      }
      /* Genesys puts the first action slots inside anonymous Ember wrappers.
         Those wrappers stayed narrower than the 32px buttons and cut off their
         right edges. Reserve the button's 32px plus its 6px visual spacing. */
      .command-bar .global-actions .ember-view:has(> gux-button-slot.command-bar-help-button),
      .command-bar .global-actions .ember-view:has(> gux-button-slot.command-bar-calls-button),
      .command-bar .global-actions .ember-view:has(> gux-button-slot.command-bar-chat-button),
      .command-bar .all-but-global-search .ember-view:has(> gux-button-slot.command-bar-help-button),
      .command-bar .all-but-global-search .ember-view:has(> gux-button-slot.command-bar-calls-button),
      .command-bar .all-but-global-search .ember-view:has(> gux-button-slot.command-bar-chat-button) {
        display: inline-flex !important; align-items: center !important; justify-content: flex-start !important;
        box-sizing: border-box !important; flex: 0 0 38px !important;
        width: 38px !important; min-width: 38px !important; max-width: 38px !important;
        height: 26px !important; min-height: 26px !important; margin: 0 !important; padding: 0 !important;
        overflow: visible !important;
      }
      /* Runtime-marked wrappers for all five icon controls are the
         authoritative layout. Their content
         box exactly matches the button; the margin, rather than an overflowing
         margin on the Web Component, provides the intended spacing. */
      .command-bar .gbs-compact-action-wrapper {
        display: inline-flex !important; align-items: center !important; justify-content: center !important;
        box-sizing: border-box !important; flex: 0 0 32px !important;
        position: relative !important; inset: auto !important;
        width: 32px !important; min-width: 32px !important; max-width: 32px !important;
        height: 26px !important; min-height: 26px !important; max-height: 26px !important;
        margin: 0 6px 0 0 !important; padding: 0 !important; overflow: visible !important;
        vertical-align: middle !important;
      }
      .command-bar .gbs-compact-action-wrapper > gux-button-slot.global-action-icon-button {
        display: block !important; position: relative !important;
        flex: 0 0 32px !important; width: 32px !important; min-width: 32px !important;
        max-width: 32px !important; height: 26px !important; min-height: 26px !important;
        max-height: 26px !important; margin: 0 !important; padding: 0 !important;
        inset: auto !important; overflow: visible !important;
      }
      .command-bar .gbs-compact-action-wrapper > gux-button-slot.global-action-icon-button > button {
        display: flex !important; position: absolute !important; inset: 0 !important;
        align-items: center !important; justify-content: center !important;
        box-sizing: border-box !important; width: 32px !important; min-width: 32px !important;
        max-width: 32px !important; height: 26px !important; min-height: 26px !important;
        max-height: 26px !important; margin: 0 !important; padding: 0 !important;
        transform: none !important; overflow: visible !important;
      }
      .command-bar .gbs-compact-action-wrapper .command-button-text {
        display: none !important; width: 0 !important; min-width: 0 !important;
        margin: 0 !important; padding: 0 !important;
      }
      .command-bar .gbs-compact-action-wrapper .global-action-icon {
        display: block !important; position: static !important; flex: 0 0 18px !important;
        width: 18px !important; min-width: 18px !important; max-width: 18px !important;
        height: 18px !important; min-height: 18px !important; max-height: 18px !important;
        margin: 0 !important; transform: none !important;
      }
      .command-bar .global-action-icon-button > button,
      .command-bar .global-action-icon-button > gux-button-slot,
      .command-bar .global-action-icon-button > gux-button-slot > button {
        box-sizing: border-box !important; width: 32px !important; min-width: 32px !important;
        max-width: 32px !important; height: 26px !important; min-height: 26px !important;
        margin: 0 !important; padding: 2px 5px !important; border-radius: 3px !important;
        overflow: visible !important;
      }
      .command-bar .command-bar-inbox { margin-right: 2px !important; }
      .command-bar .command-bar-agent { margin-right: 11px !important; }

      .command-bar #command-bar-queue,
      .command-bar .global-queue {
        display: inline-flex !important; align-items: center !important; justify-content: center !important;
        gap: 6px !important; box-sizing: border-box !important; height: 30px !important; min-height: 30px !important;
        padding: 2px 8px !important; margin: 0 0 0 7px !important; line-height: 1 !important;
      }
      .command-bar #command-bar-queue .queue-label,
      .command-bar #command-bar-queue .queue-label span {
        display: inline-flex !important; align-items: center !important; height: 100% !important;
        margin: 0 !important; padding: 0 !important; line-height: 1 !important;
      }
      .command-bar #command-bar-queue gux-toggle { align-self: center !important; margin: 0 !important; }

      .command-bar .gbs-theme-toggle-wrap {
        width: 32px !important; min-width: 32px !important; height: 26px !important;
        margin: 0 4px !important; transform: none !important; align-self: center !important;
      }
      .command-bar .gbs-theme-toggle {
        width: 32px !important; min-width: 32px !important; height: 26px !important; min-height: 26px !important;
        padding: 0 !important; align-self: center !important;
      }

      .command-bar .command-user-settings,
      .command-bar .command-user-settings-button {
        display: flex !important; align-items: center !important; justify-content: center !important;
        box-sizing: border-box !important; width: 32px !important; min-width: 32px !important;
        height: 30px !important; min-height: 30px !important; margin: 0 !important; padding: 0 !important;
      }
      .command-bar #user-settings-button {
        display: inline-flex !important; align-items: center !important; justify-content: center !important;
        box-sizing: border-box !important; width: 32px !important; min-width: 32px !important;
        height: 30px !important; min-height: 30px !important; margin: 0 0 0 3px !important; padding: 3px !important;
      }
      .command-bar #user-settings-button gux-avatar-beta {
        width: 24px !important; min-width: 24px !important; height: 24px !important; max-height: 24px !important;
        margin: 0 !important; align-self: center !important;
      }
      .command-bar #user-settings-button gux-avatar-beta img {
        width: 22px !important; min-width: 22px !important; max-width: 22px !important;
        height: 22px !important; min-height: 22px !important; max-height: 22px !important;
        margin: 0 !important; object-fit: cover !important;
      }
    }
    /* MEDIUM and below: normalize the controls that must stay vertically
       centered in the 38px command bar. BIG screens retain native dimensions. */
    @media (max-width: 2100px) {
      .command-bar .command-global-search .global-search-field,
      .command-bar .command-global-search .global-search-field-container,
      .command-bar .command-global-search gux-form-field-search {
        box-sizing: border-box !important; height: 26px !important; min-height: 26px !important;
        padding-bottom: 0 !important;
      }
      .command-bar #command-bar-queue,
      .command-bar .global-queue {
        display: inline-flex !important; align-items: center !important; justify-content: center !important;
        box-sizing: border-box !important; height: 30px !important; min-height: 30px !important;
        padding-top: 2px !important; padding-bottom: 2px !important; line-height: 1 !important;
      }
      .command-bar #command-bar-queue .queue-label,
      .command-bar #command-bar-queue .queue-label span,
      .command-bar .global-queue .queue-label,
      .command-bar .global-queue .queue-label span {
        display: inline-flex !important; align-items: center !important; justify-content: center !important;
        align-self: center !important; box-sizing: border-box !important;
        height: 26px !important; min-height: 26px !important; margin: 0 !important; padding: 0 !important;
        line-height: 26px !important; position: relative !important; top: 0 !important; transform: none !important;
      }
      .command-bar .gbs-theme-toggle-wrap,
      .command-bar .gbs-theme-toggle {
        display: inline-flex !important; align-items: center !important; justify-content: center !important;
        box-sizing: border-box !important; width: 32px !important; min-width: 32px !important;
        height: 26px !important; min-height: 26px !important; padding: 0 !important;
        transform: none !important; align-self: center !important;
      }
      .command-bar .command-user-settings,
      .command-bar .command-user-settings-button,
      .command-bar #user-settings-button {
        display: inline-flex !important; align-items: center !important; justify-content: center !important;
        box-sizing: border-box !important; width: 34px !important; min-width: 34px !important;
        height: 32px !important; min-height: 32px !important; max-height: 32px !important;
        margin-top: 3px !important; margin-bottom: 3px !important; padding: 3px !important;
        align-self: center !important; transform: none !important;
      }
      .command-bar .command-user-settings {
        position: relative !important; left: -5px !important; top: -2px !important;
      }
      .command-bar #user-settings-button gux-avatar-beta {
        width: 24px !important; min-width: 24px !important; max-width: 24px !important;
        height: 24px !important; min-height: 24px !important; max-height: 24px !important;
        margin: 0 !important; align-self: center !important;
      }
      .command-bar #user-settings-button gux-avatar-beta img {
        width: 24px !important; min-width: 24px !important; max-width: 24px !important;
        height: 24px !important; min-height: 24px !important; max-height: 24px !important;
        margin: 0 !important; object-fit: cover !important;
      }
    }
    /* BIG only: retain native control sizes but lift these two controls by 1px. */
    @media (min-width: 2101px) {
      .command-bar #command-bar-queue,
      .command-bar .global-queue,
      .command-bar .gbs-theme-toggle-wrap {
        position: relative !important; top: -1px !important;
      }
    }
    /* SMALL and below: compact all five icon buttons and use the narrower
       expanded search. TINY-only horizontal placement remains in its 1040 rule. */
    @media (max-width: 1570px) {
      .command-bar .gbs-compact-action-wrapper {
        display: inline-flex !important; align-items: center !important; justify-content: center !important;
        box-sizing: border-box !important; flex: 0 0 32px !important; position: relative !important;
        width: 32px !important; min-width: 32px !important; max-width: 32px !important;
        height: 26px !important; min-height: 26px !important; max-height: 26px !important;
        margin: 0 6px 0 0 !important; padding: 0 !important; overflow: visible !important;
      }
      .command-bar .gbs-compact-action-wrapper > gux-button-slot.global-action-icon-button {
        display: block !important; position: relative !important; box-sizing: border-box !important;
        width: 32px !important; min-width: 32px !important; max-width: 32px !important;
        height: 26px !important; min-height: 26px !important; max-height: 26px !important;
        margin: 0 !important; padding: 0 !important; overflow: visible !important;
      }
      .command-bar .gbs-compact-action-wrapper > gux-button-slot.global-action-icon-button > button {
        display: flex !important; position: absolute !important; inset: 0 !important;
        align-items: center !important; justify-content: center !important; box-sizing: border-box !important;
        width: 32px !important; min-width: 32px !important; max-width: 32px !important;
        height: 26px !important; min-height: 26px !important; max-height: 26px !important;
        margin: 0 !important; padding: 0 !important; transform: none !important; overflow: visible !important;
      }
      .command-bar .gbs-compact-action-wrapper .command-button-text {
        display: none !important; width: 0 !important; min-width: 0 !important; margin: 0 !important; padding: 0 !important;
      }
      .command-bar .gbs-compact-action-wrapper .global-action-icon {
        position: static !important; flex: 0 0 18px !important; width: 18px !important; height: 18px !important;
        margin: 0 !important; transform: none !important;
      }
      .command-bar .global-search-narrow-view:has(.global-search-bar-with-overlay),
      .command-bar .global-search-narrow-view .global-search-bar-with-overlay,
      .command-bar .global-search-narrow-view .global-search-overlay {
        width: 370px !important; min-width: 0 !important; max-width: 370px !important;
      }
      .command-bar .global-search-narrow-view .global-search-field,
      .command-bar .global-search-narrow-view .global-search-field-container,
      .command-bar .global-search-narrow-view gux-form-field-search {
        width: 365px !important; min-width: 0 !important; max-width: 365px !important;
      }
    }
    @media (max-width: 1500px) {
      .gbs-sidebar .gbs-summary-busy { width: calc((100% - 10px) / 3) !important; }
      .gbs-summary-cards { grid-template-columns: repeat(3, minmax(0, 1fr)) !important; gap: 5px !important; }
      .gbs-summary-card { width: auto !important; min-width: 0 !important; height: 56px !important; padding: 4px 7px !important; grid-template-rows: 19px 27px !important; }
      .gbs-summary-title { font-size: 16px !important; line-height: 19px !important; }
      .gbs-summary-line { height: 24px !important; line-height: 24px !important; gap: 6px !important; }
      .gbs-summary-value { font-size: 24px !important; line-height: 27px !important; }
      .gbs-summary-dot { width: 16px !important; height: 16px !important; flex-basis: 16px !important; }
      table.gbs-board thead th { font-size: 13px !important; padding: 7px 5px !important; }
      table.gbs-board tbody td { font-size: 13px !important; padding: 6px 5px !important; line-height: 16px !important; }
    }
    @media (max-width: 1040px) {
      /* The zoomed/tiny layout gets three readable dashboard cards rather than
         squeezing four cards into the 580px space left beside the Board. */
      .main-grid { gap: 7px !important; padding: 7px 14px 7px 7px !important; }
      .main-grid .analytics-ui-dashboard-widget .widget-title,
      .main-grid .analytics-ui-dashboard-widget .widget-title-display {
        min-height: 26px !important; padding: 3px 5px !important; font-size: 13px !important; line-height: 18px !important;
      }
      .main-grid .analytics-ui-dashboard-widget .widget-body,
      .main-grid .analytics-ui-dashboard-widget .widget-content { padding: 4px 6px !important; }
      .main-grid .analytics-ui-dashboard-widget:has(.analytics-ui-dashboard-widget-grid-display) .widget-content,
      .main-grid .analytics-ui-dashboard-widget-grid-display .grid-container {
        padding-left: 0 !important; padding-right: 0 !important;
      }
      .main-grid .row-item, .main-grid .data-cell, .main-grid .aggregate-cell {
        min-height: 18px !important; font-size: 13px !important; line-height: 18px !important;
      }
      .main-grid .row-label, .main-grid .column-label { font-size: 12px !important; line-height: 17px !important; }
      .main-grid .cell-display-text, .main-grid .difference-value { font-size: 17px !important; line-height: 19px !important; }

      .gbs-sidebar .table-wrapper { padding-left: 6px !important; padding-right: 6px !important; overflow-x: hidden !important; }
      table.gbs-board { width: 100% !important; max-width: 100% !important; border-spacing: 0 3px !important; }
      table.gbs-board thead th { font-size: 11px !important; line-height: 14px !important; padding: 4px 3px !important; }
      table.gbs-board tbody td { font-size: 11px !important; line-height: 14px !important; padding: 3px !important; }
      /* TINY Board widths retain a visible left Time edge.  The compact class
         takes precedence when a real timer needs the last available pixels. */
      table.gbs-board th.column-timeInStatus, table.gbs-board td.column-timeInStatus { padding-left: 3px !important; padding-right: 2px !important; text-align: left !important; }
      table.gbs-board.gbs-time-cell-compact th.column-timeInStatus,
      table.gbs-board.gbs-time-cell-compact td.column-timeInStatus { padding-left: 2px !important; padding-right: 2px !important; }
      table.gbs-board th.column-status, table.gbs-board td.column-status { text-align: center !important; }
      table.gbs-board.gbs-agent-compact .column-agent a { line-height: 1.08 !important; }
      table.gbs-board .gbs-current-agent-badge {
        min-height: 14px !important; margin-right: 4px !important; padding: 0 3px !important;
        font-size: 9px !important; line-height: 13px !important;
      }
      .gbs-summary-cards { gap: 4px !important; }
      .gbs-summary-card { height: 50px !important; padding: 3px 5px !important; grid-template-rows: 17px 24px !important; }
      .gbs-summary-title { font-size: 14px !important; line-height: 17px !important; }
      .gbs-summary-line { height: 22px !important; line-height: 22px !important; gap: 4px !important; }
      .gbs-summary-value { font-size: 22px !important; line-height: 24px !important; }
      .gbs-summary-dot { width: 14px !important; height: 14px !important; flex-basis: 14px !important; }
    }
    @media (max-width: 850px) {
      .main-grid { gap: 7px !important; padding: 7px 14px 7px 7px !important; }
      .main-grid .analytics-ui-dashboard-widget .widget-title,
      .main-grid .analytics-ui-dashboard-widget .widget-title-display { min-height: 26px !important; padding: 3px 5px !important; font-size: 13px !important; line-height: 18px !important; }
      .main-grid .analytics-ui-dashboard-widget .widget-body,
      .main-grid .analytics-ui-dashboard-widget .widget-content { padding: 4px 6px !important; }
      .secondary-nav-bar { min-height: 32px !important; padding: 0 5px !important; }
      .secondary-nav-bar .entity-name { font-size: 12px !important; }
      .command-bar button, .global-actions button { min-height: 28px !important; padding: 3px 5px !important; font-size: 11px !important; }
      #search-field { max-width: 180px !important; }
    }
    @media (max-width: 560px) {
      .main-grid { gap: 5px !important; padding: 5px 12px 5px 5px !important; }
      #search-field { max-width: 130px !important; }
    }

    /* Top navigation controls whose component internals keep light defaults. */
    #search-field { background: transparent !important; color: #f8fafc !important; border: 0 !important; outline: 0 !important; border-radius: 0 !important; box-shadow: none !important; }
    #search-field::placeholder { color: #94a3b8 !important; }
    /* Global search overlay and results. */
    .background-shroud { background: rgba(71, 85, 105, .48) !important; opacity: 1 !important; }
    .command-global-search-results, .command-global-search-results .results, .command-global-search-results .suggest-results { background: #20262d !important; color: #e5e7eb !important; border-color: #3a4655 !important; box-shadow: 0 14px 30px rgba(0, 0, 0, .45) !important; }
    .command-global-search-results .search-results-pages-header,
    .command-global-search-results .search-results-directory-header { background: #303946 !important; color: #f8fafc !important; border-color: #4b596a !important; }
    .command-global-search-results .page-results, .command-global-search-results .pages-result-item,
    .command-global-search-results .page-result-link, .command-global-search-results .no-results { background: #20262d !important; color: #e5e7eb !important; border-color: #3a4655 !important; }
    .command-global-search-results .page-result-link:hover, .command-global-search-results .page-result-link:focus { background: #2b3440 !important; color: #fff !important; }
    .command-global-search-results .page-title, .command-global-search-results .pages-text,
    .command-global-search-results .directory-text, .command-global-search-results .page-path { color: #e5e7eb !important; }
    .command-global-search-results .show-all-pages, .command-global-search-results .show-all-directory { color: #93c5fd !important; }
    .command-global-search-results .pages-image-icon-container, .command-global-search-results .file-text-icon-container { background: #334155 !important; color: #cbd5e1 !important; }
    #command-bar-queue-toggle, .command-bar-queue, .command-bar-queue gux-toggle, gux-tab, [role="tab"] { background-color: #2d3540 !important; color: #e5e7eb !important; border-color: #4b596a !important; }
    gux-tabs, .tabs, .tab-list, [role="tablist"] { background: #252b33 !important; border-color: #3a4655 !important; }
    .gbs-sidebar .agent-item-label, .gbs-sidebar .agent-item-value { color: #f8fafc !important; }

    /* Exact live shell selectors audited from Calls, Chat, Inbox and profile. */
    #command-bar-queue, .global-queue {
      background: #2d3540 !important; color: #f1f5f9 !important;
      border: 2px solid #64748b !important; border-radius: 6px !important;
      box-shadow: 0 0 7px rgba(148, 163, 184, .28) !important;
      transition: background-color .18s ease, border-color .18s ease, color .18s ease, box-shadow .18s ease !important;
    }
    #command-bar-queue .queue-label, #command-bar-queue .queue-label span { color: #e5e7eb !important; background: transparent !important; }
    #command-bar-queue.gbs-on-queue,
    .global-queue.gbs-on-queue {
      background: #0b3b2e !important; color: #39ff88 !important;
      border-color: #34d399 !important;
      box-shadow: 0 0 5px rgba(52, 211, 153, .8), 0 0 12px rgba(16, 185, 129, .42) !important;
    }
    #command-bar-queue.gbs-on-queue .queue-label,
    #command-bar-queue.gbs-on-queue .queue-label span,
    .global-queue.gbs-on-queue .queue-label,
    .global-queue.gbs-on-queue .queue-label span { color: #39ff88 !important; }
    #command-bar-queue .queue-label,
    #command-bar-queue .queue-label span,
    .global-queue .queue-label,
    .global-queue .queue-label span {
      display: inline-flex !important; align-items: center !important; justify-content: center !important;
      align-self: center !important; height: auto !important; min-height: 0 !important;
      margin: 0 !important; padding: 0 !important; line-height: 1 !important;
      position: static !important; transform: none !important;
    }
    /* Keep the real GUX control clickable, but draw a consistently centered
       switch above its native artwork. */
    #command-bar-queue-toggle {
      display: inline-block !important; position: relative !important; align-self: center !important;
      box-sizing: border-box !important; flex: 0 0 38px !important;
      width: 38px !important; min-width: 38px !important; max-width: 38px !important;
      height: 20px !important; min-height: 20px !important; max-height: 20px !important;
      margin: 0 !important; padding: 0 !important; background: transparent !important;
      overflow: visible !important; vertical-align: middle !important;
    }
    #command-bar-queue-toggle::before {
      content: "" !important; position: absolute !important; z-index: 20 !important;
      inset: 0 !important; box-sizing: border-box !important; pointer-events: none !important;
      background: #475569 !important; border: 1px solid #94a3b8 !important;
      border-radius: 999px !important; box-shadow: none !important;
      transition: background-color .18s ease, border-color .18s ease, box-shadow .18s ease !important;
    }
    #command-bar-queue-toggle::after {
      content: "" !important; position: absolute !important; z-index: 21 !important;
      top: 2px !important; left: 2px !important; box-sizing: border-box !important;
      width: 16px !important; height: 16px !important; pointer-events: none !important;
      background: #e2e8f0 !important; border: 1px solid #f8fafc !important; border-radius: 50% !important;
      box-shadow: none !important;
      transform: translateX(0) !important; transition: transform .18s ease !important;
    }
    #command-bar-queue.gbs-on-queue #command-bar-queue-toggle::before,
    .global-queue.gbs-on-queue #command-bar-queue-toggle::before {
      background: #10b981 !important; border-color: #6ee7b7 !important;
      box-shadow: none !important;
    }
    #command-bar-queue.gbs-on-queue #command-bar-queue-toggle::after,
    .global-queue.gbs-on-queue #command-bar-queue-toggle::after {
      transform: translateX(18px) !important;
    }
    @media (max-width: 2100px) {
      #command-bar-queue-toggle {
        flex-basis: 34px !important; width: 34px !important; min-width: 34px !important; max-width: 34px !important;
        height: 18px !important; min-height: 18px !important; max-height: 18px !important;
        margin-left: 4px !important;
      }
      #command-bar-queue-toggle::after {
        top: 2px !important; left: 2px !important; width: 14px !important; height: 14px !important;
      }
      #command-bar-queue.gbs-on-queue #command-bar-queue-toggle::after,
      .global-queue.gbs-on-queue #command-bar-queue-toggle::after {
        transform: translateX(16px) !important;
      }
    }
    @media (min-width: 2101px) {
      #command-bar-queue,
      .global-queue {
        display: inline-flex !important; align-items: center !important; justify-content: center !important;
        gap: 7px !important;
      }
      #command-bar-queue-toggle { top: 0 !important; transform: none !important; }
    }
    .command-panel, .command-panel.active, .command-panel-wrapper, .command-panel-wrapper.active,
    .command-panel .panel-content, .command-panel .panel-container, .command-panel hgroup,
    .call-controls-container, .conversations-container, .call-scroll,
    .acd-interactions-panel, .acd-interactions-list, .chat-container, .left-chat-rail,
    .inbox-panel, .inbox-panel-content { background: #1d2025 !important; color: #e5e7eb !important; border-color: #3a4655 !important; }
    .command-panel h1, .command-panel h2, .command-panel .heading, .command-panel .header-text,
    .command-panel .panel-title, .command-panel .active-call-heading, .command-panel .start-call { color: #f8fafc !important; }
    .command-panel button, .command-panel [role="tab"], .command-panel .toggle-item,
    .command-panel .interaction-roster-header-btn, .command-panel .action-fetch-more {
      background: #252b33 !important; color: #e5e7eb !important; border-color: #3a4655 !important;
    }
    .command-panel button:hover, .command-panel [role="tab"]:hover, .command-panel [role="tab"].active {
      background: #343d49 !important; color: #fff !important;
    }
    .inbox-message, .inbox-message.read, .inbox-message.unread, .reporting-export-entry,
    .export-expiration-container { background: #252b33 !important; color: #e5e7eb !important; border-color: #3a4655 !important; }
    .inbox-message:hover, .reporting-export-entry:hover { background: #2d3540 !important; }
    .inbox-row, .inbox-row *, .file-details, .file-name, .view-name, .time-container, .ib-time { color: #e5e7eb !important; }
    .command-panel input, .command-panel textarea, .command-panel select { background: #171b20 !important; color: #f8fafc !important; border-color: #4b596a !important; }
    .command-panel .dialpad, .command-panel .dialpad-numbers-container, .command-panel .dial-pad-item,
    .command-panel .follow-me-settings, .command-panel .phone-settings,
    .command-panel .audio-controls, .command-panel .device-volumes,
    .command-panel .form-control, .command-panel .custom-input, .command-panel .tags-input {
      background: #1d2025 !important; color: #e5e7eb !important; border-color: #4b596a !important;
    }
    .command-panel .dialpad-number { background: #252b33 !important; color: #f8fafc !important; border: 1px solid #3a4655 !important; }
    .command-panel .dialpad-number:hover { background: #343d49 !important; }
    .command-panel .phone-settings *, .command-panel .follow-me-settings * { color: #e5e7eb !important; }
    .command-panel .switch, .command-panel [class*="toggle"], .command-panel [class*="device"] {
      border-color: #4b596a !important;
    }
    .command-panel .conversations-heading, .command-panel .active-call,
    .command-panel .actions-container, .command-panel .interaction-header-group,
    .command-panel .dropdown-menu, .command-panel .dropdown-menu li,
    .command-panel .dropdown-menu a { background: #252b33 !important; color: #e5e7eb !important; border-color: #3a4655 !important; }
    .command-panel .dropdown-menu li:hover, .command-panel .dropdown-menu a:hover { background: #343d49 !important; color: #fff !important; }
    .command-panel gux-button-slot.close-panel, .command-panel gux-button-slot.expand-panel { background: #252b33 !important; color: #e5e7eb !important; }
    .command-panel .call-controls, .command-panel .call-controls-container,
    .command-panel .call-controls-subheader, .command-panel .toggle-item-container,
    .command-panel .heading {
      background: #252b33 !important; color: #e5e7eb !important; border-color: #3a4655 !important;
    }
    .command-panel .toggle-item-container .toggle-item,
    .command-panel .toggle-item-container .toggle-item .app-img {
      background: #252b33 !important; color: #f8fafc !important; fill: currentColor !important; border-color: #4b596a !important;
    }
    .command-panel .toggle-item-container .toggle-item gux-icon {
      background: transparent !important; color: #f8fafc !important; fill: currentColor !important;
      opacity: 1 !important; filter: none !important;
    }
    /* Interaction workspace / selected conversation mainstage. */
    .interaction-container, .selected-interaction-container,
    .acd-interaction, .acd-interaction-v2, .interaction-header-v2,
    .interaction-header-v2 .data-container, .interaction-header-v2 .top-container,
    .interaction-header-v2 .actions-container, .interaction-header-group,
    .interaction-grid, .interaction-content, .mainstage-header, .mainstage-title,
    .mainstage-header__action-container, .interaction-script-container,
    .app-view-stack, .conversation-v2, .app-carousel-toolbar, .app-carousel-view,
    .app-carousel-native-view, .sub-panel-wrapper {
      background: #1d2025 !important; color: #e5e7eb !important; border-color: #3a4655 !important;
    }
    /* These two apps are loaded as same-origin iframes. Their CSS-module names
       are deliberately matched by prefix, so a Profile Panel deployment can
       change its hash without leaving its card or canvas white. */
    html.gbs-dark-mode #root.rootContainer,
    html.gbs-dark-mode #root.rootContainer > [class*="searchPage"],
    html.gbs-dark-mode #root.rootContainer [class*="contactCardContainer"],
    html.gbs-dark-mode #root.rootContainer [class*="outerCard"],
    html.gbs-dark-mode #root.rootContainer [class*="cardBody"],
    html.gbs-dark-mode #root.rootContainer [class*="contactMedia"],
    html.gbs-dark-mode #root.rootContainer gux-card,
    html.gbs-dark-mode #root.rootContainer gux-card > div {
      background: #1d2025 !important; color: #e5e7eb !important;
      border-color: #4b596a !important;
    }
    html.gbs-dark-mode #root.rootContainer [class*="outerCard"] {
      border: 1px solid #4b596a !important; border-radius: 6px !important;
    }
    html.gbs-dark-mode #root.rootContainer [class*="contactMedia"],
    html.gbs-dark-mode #root.rootContainer [class*="identifierValueContainer"] {
      background: #252b33 !important; color: #f1f5f9 !important;
    }
    /* The carousel toolbar is a separate embedded app. Style both the custom
       element and its legacy light-DOM container. */
    html.gbs-dark-mode app-carousel-toolbar,
    html.gbs-dark-mode .app-carousel-toolbar,
    html.gbs-dark-mode .app-carousel-toolbar-container,
    html.gbs-dark-mode .app-carousel-toolbar-container.legacy {
      background: #252b33 !important; color: #e5e7eb !important;
      border-color: #4b596a !important; box-shadow: none !important;
    }
    .interaction-header-v2, .mainstage-header {
      background: #252b33 !important; border-bottom: 1px solid #4b596a !important;
    }
    .interaction-container .participant-name, .interaction-container .message-type,
    .interaction-container h1, .interaction-container h2, .interaction-container h3,
    .interaction-container h4, .interaction-container span { color: #f1f5f9 !important; }
    .interaction-container .copy-action-button,
    .interaction-container .interaction-header-button,
    .interaction-container .mainstage-header__action-button {
      background: #252b33 !important; color: #e5e7eb !important;
      border-color: #4b596a !important; box-shadow: none !important;
    }
    .interaction-container .copy-action-button:hover,
    .interaction-container .interaction-header-button:hover,
    .interaction-container .mainstage-header__action-button:hover,
    .interaction-container .mainstage-header__action-button.small-size-active {
      background: #343d49 !important; color: #fff !important;
    }
    .interaction-container .interaction-end-btn,
    .interaction-container .interaction-end-btn:hover {
      background: #7f1d2d !important; color: #fff !important; border-color: #ff1744 !important;
    }
    .interaction-container .mainstage-size-popover,
    .interaction-container .mainstage-size-list,
    .interaction-container .mainstage-size-btn {
      background: #252b33 !important; color: #e5e7eb !important; border-color: #4b596a !important;
    }
    .interaction-container .mainstage-size-btn:hover,
    .interaction-container .mainstage-size-btn.active,
    .interaction-container .mainstage-size-btn[aria-selected="true"] {
      background: #343d49 !important; color: #fff !important;
    }
    .interaction-container iframe.interaction-script {
      background: #1d2025 !important; color-scheme: dark !important; border-color: #3a4655 !important;
    }
    /* Interaction Details is a custom-component app rather than a Genesys
       panel. Its inline light styles must be overridden at every structural
       level, including the Open in SNOW control, while retaining its native
       click handler and ServiceNow launch behavior. */
    .sub-container.run-mode,
    .sub-container.run-mode .root-component,
    .sub-container.run-mode .container-component,
    .sub-container.run-mode .children-wrapper,
    .sub-container.run-mode .alignment-wrapper,
    .sub-container.run-mode .container-inner,
    .sub-container.run-mode .text-component-background {
      background: #1d2025 !important; color: #e5e7eb !important;
      border-color: #3a4655 !important;
    }
    .sub-container.run-mode .horizontal-container,
    .sub-container.run-mode .vertical-container {
      background: transparent !important; color: #e5e7eb !important;
      border-color: #3a4655 !important;
    }
    .sub-container.run-mode .text-component,
    .sub-container.run-mode .cc-editable {
      color: #e5e7eb !important;
    }
    .sub-container.run-mode .btn-main.container-inner {
      min-height: 30px !important; padding: 5px 11px !important;
      background: color-mix(in srgb, #22d3ee 13%, #1d2025) !important;
      color: #a5f3fc !important; border: 1px solid #22d3ee !important;
      border-radius: 5px !important; box-shadow: 0 0 8px rgba(34,211,238,.18) !important;
    }
    .sub-container.run-mode .btn-main.container-inner:hover,
    .sub-container.run-mode .btn-main.container-inner:focus-visible {
      background: color-mix(in srgb, #22d3ee 22%, #1d2025) !important;
      color: #ecfeff !important; box-shadow: 0 0 11px rgba(34,211,238,.34) !important;
    }
    /* Scripter panels use legacy Bootstrap controls in a same-origin call
       iframe. Their own .form-control/.btn-default/.dropdown-menu rules were
       the remaining source of white surfaces in the captured call document. */
    .scripter-container, .scripter-container .sub-container,
    .scripter-container .container-component, .scripter-container .container-inner,
    .scripter-container .children-wrapper, .scripter-container .alignment-wrapper,
    .sub-container.run-mode, .sub-container.run-mode .component,
    .sub-container.run-mode .container-inner {
      background: #1d2025 !important; color: #e5e7eb !important; border-color: #3a4655 !important;
    }
    .scripter-container .form-control,
    .scripter-container .form-control:focus,
    .sub-container.run-mode .form-control,
    .sub-container.run-mode .form-control:focus,
    .scripter-container select, .scripter-container textarea,
    .sub-container.run-mode select, .sub-container.run-mode textarea {
      background: #0f1722 !important; color: #f1f5f9 !important;
      border-color: #4b596a !important; box-shadow: inset 0 1px 3px rgba(0,0,0,.35) !important;
    }
    .scripter-container .dropdown-menu,
    .sub-container.run-mode .dropdown-menu {
      background: #252b33 !important; color: #e5e7eb !important;
      border-color: #4b596a !important; box-shadow: 0 10px 24px rgba(0,0,0,.4) !important;
    }
    .scripter-container .dropdown-menu > li > a,
    .sub-container.run-mode .dropdown-menu > li > a {
      color: #e5e7eb !important;
    }
    .scripter-container .dropdown-menu > li > a:hover,
    .scripter-container .dropdown-menu > li > a:focus,
    .sub-container.run-mode .dropdown-menu > li > a:hover,
    .sub-container.run-mode .dropdown-menu > li > a:focus {
      background: #343d49 !important; color: #ecfeff !important;
    }
    .scripter-container .btn-default,
    .sub-container.run-mode .btn-default {
      background: #252b33 !important; color: #e5e7eb !important; border-color: #4b596a !important;
    }
    .scripter-container .btn-default:hover,
    .scripter-container .btn-default:focus,
    .sub-container.run-mode .btn-default:hover,
    .sub-container.run-mode .btn-default:focus {
      background: #343d49 !important; color: #ecfeff !important; border-color: #22d3ee !important;
    }
    /* Wrap-up Codes is its own Svelte document. Keep every functional zone
       dark, including dynamically-created empty/list states and the footer. */
    html:has([data-testid="wrapup-main-container"]),
    body:has([data-testid="wrapup-main-container"]),
    [data-testid="wrapup-main-container"],
    .wrapup-main-container, .wrapup-container, .wrapup-content,
    .wrapup-selection-container, .wrapup-container-footer,
    .wrapup-container-footer-messages, .wrapup-container-footer-voice-quality {
      background: #1d2025 !important; color: #e5e7eb !important; border-color: #3a4655 !important;
    }
    .wrapup-message-container,
    .wrapup-search,
    .wrapup-container-footer {
      background: #252b33 !important; color: #e5e7eb !important;
      border-color: #4b596a !important;
    }
    .wrapup-messages, .wrapup-duration-mandatory,
    .wrapup-footer-information, .wrapup-message-selection {
      color: #e5e7eb !important;
    }
    .wrapup-duration-mandatory { color: #67e8f9 !important; text-shadow: 0 0 8px rgba(34,211,238,.26) !important; }
    .wrapup-list, .wrapup-list .wrapup-item,
    [data-testid="wrapup-code-list"], [data-testid="wrapup-code-list"] [role="option"] {
      background: #20262d !important; color: #e5e7eb !important; border-color: #3a4655 !important;
    }
    .wrapup-list .wrapup-item:hover,
    .wrapup-list .wrapup-item[aria-selected="true"],
    [data-testid="wrapup-code-list"] [role="option"]:focus-visible {
      background: color-mix(in srgb, #22d3ee 14%, #20262d) !important;
      color: #ecfeff !important; outline: 1px solid #22d3ee !important;
    }
    [data-testid="wrapup-code-search"],
    .wrapup-search input[type="search"] {
      background: #0f1722 !important; color: #f1f5f9 !important; border-color: #4b596a !important;
    }
    [data-testid="voice-quality-flag-button"], .voice-quality-flag-btn {
      background: #252b33 !important; color: #a5f3fc !important; border: 1px solid #4b596a !important;
    }
    [data-testid="voice-quality-flag-button"]:hover, .voice-quality-flag-btn:hover {
      border-color: #22d3ee !important; background: #343d49 !important;
    }
    [data-testid="wrapup-apply-button"], .wrapup-apply-button {
      background: color-mix(in srgb, #22d3ee 17%, #1d2025) !important;
      color: #a5f3fc !important; border: 1px solid #22d3ee !important;
      border-radius: 5px !important; box-shadow: 0 0 8px rgba(34,211,238,.2) !important;
    }
    [data-testid="wrapup-apply-button"]:hover, [data-testid="wrapup-apply-button"]:focus-visible,
    .wrapup-apply-button:hover, .wrapup-apply-button:focus-visible {
      background: color-mix(in srgb, #22d3ee 27%, #1d2025) !important;
      color: #ecfeff !important; box-shadow: 0 0 12px rgba(34,211,238,.34) !important;
    }
    /* Profile's CSS-module document can be mounted after the top-level theme
       class sync. These deliberately do not depend on that class, and only
       match its unique module/header vocabulary. */
    [class*="_searchPage_"], [class*="_contactCardContainer_"],
    [class*="_outerCard_"], [class*="_cardBody_"], [class*="_contactMedia_"],
    [class*="_identifierValueContainer_"],
    .app-carousel-header, .app-carousel-toolbar-container.legacy,
    .app-description, .app-actions, .app-sizer .sizer-list,
    .app-sizer .sizer-list-item {
      background: #1d2025 !important; color: #e5e7eb !important; border-color: #3a4655 !important;
    }
    [class*="_outerCard_"] gux-card,
    [class*="_outerCard_"] gux-card > div {
      background: #252b33 !important; color: #e5e7eb !important;
      border-color: #4b596a !important; box-shadow: none !important;
      --gux-card-background-color: #252b33; --gux-background: #252b33;
    }
    .app-carousel-header .app-button,
    .app-carousel-header .action-btn,
    .app-sizer .sizer-list-item {
      background: #252b33 !important; color: #e5e7eb !important; border-color: #4b596a !important;
    }
    .app-carousel-header .app-button:hover,
    .app-carousel-header .app-button:focus-visible,
    .app-sizer .sizer-list-item:hover,
    .app-sizer .sizer-list-item[aria-selected="true"] {
      background: #343d49 !important; color: #f8fafc !important; border-color: #22d3ee !important;
    }
    .interaction-container app-carousel-toolbar, .interaction-container app-carousel-view,
    .interaction-container app-view-stack, .interaction-container .app-carousel-native-view,
    .interaction-container .app-carousel-view, .interaction-container .contextual-v2,
    .interaction-container [role="tabpanel"], .interaction-container [role="main"] {
      background: #1d2025 !important; color: #e5e7eb !important; border-color: #3a4655 !important;
    }
    /* Embedded scripts and contextual apps receive this stylesheet in their
       own document. Cover their document canvas as well as the live Details /
       Profile surfaces observed in the selected interaction. */
    html.gbs-dark-mode,
    html.gbs-dark-mode body,
    html.gbs-dark-mode body:not(.ember-application),
    html.gbs-dark-mode main,
    html.gbs-dark-mode article,
    html.gbs-dark-mode section,
    html.gbs-dark-mode form,
    html.gbs-dark-mode [class*="interaction-details"],
    html.gbs-dark-mode [class*="interactionDetails"],
    html.gbs-dark-mode [class*="interaction-detail"],
    html.gbs-dark-mode [class*="script-container"],
    html.gbs-dark-mode [class*="script-content"],
    html.gbs-dark-mode [class*="profile-container"],
    html.gbs-dark-mode [class*="profile-content"],
    html.gbs-dark-mode [class*="contact-card"],
    html.gbs-dark-mode [class*="contact-data"] {
      background: #1d2025 !important; color: #e5e7eb !important; border-color: #3a4655 !important;
    }
    html.gbs-dark-mode [class*="interaction-details"] [class*="header"],
    html.gbs-dark-mode [class*="interactionDetails"] [class*="header"],
    html.gbs-dark-mode [class*="profile"] [class*="header"],
    html.gbs-dark-mode [class*="contact"] [class*="header"],
    .interaction-container [class*="control-bar"],
    .interaction-container [class*="toolbar"],
    .interaction-container [class*="header-bar"] {
      background: #252b33 !important; color: #f1f5f9 !important; border-color: #4b596a !important;
    }
    html.gbs-dark-mode [class*="interaction-details"] label,
    html.gbs-dark-mode [class*="interaction-details"] dt,
    html.gbs-dark-mode [class*="interaction-details"] dd,
    html.gbs-dark-mode [class*="interaction-details"] p,
    html.gbs-dark-mode [class*="profile"] label,
    html.gbs-dark-mode [class*="profile"] p,
    html.gbs-dark-mode [class*="contact"] p {
      color: #e5e7eb !important;
    }
    html.gbs-dark-mode [class*="profile"] [class*="card"],
    html.gbs-dark-mode [class*="contact"] [class*="card"],
    html.gbs-dark-mode [class*="interaction-details"] [class*="card"] {
      background: #252b33 !important; color: #e5e7eb !important;
      border: 1px solid #4b596a !important; box-shadow: none !important;
    }
    html.gbs-dark-mode input,
    html.gbs-dark-mode textarea,
    html.gbs-dark-mode select {
      background: #171b20 !important; color: #f8fafc !important; border-color: #4b596a !important;
    }
    /* Conversation roster and selected interaction group. */
    .interactions,
    .interactions .interaction-group,
    .interactions .interaction-group-wrapper,
    .interactions .interaction-group-header,
    .interactions .interaction-group-header .header-text,
    .interactions .acd-interaction-outbound-contact,
    .interactions .interaction-add,
    .interactions .interaction-add-contact,
    .interactions .acd-interaction-card-v2,
    .interactions .acd-interaction-card-v2-container,
    .interactions .acd-interaction-card-v2-voice,
    .interactions .roster-card,
    .interactions .roster-card-call,
    .interactions .int-type,
    .interactions .int-details,
    .interactions .int-queue-case-row {
      background: #20262d !important; color: #e5e7eb !important; border-color: #3a4655 !important;
    }
    .interactions .interaction-group.is-selected .interaction-group-header,
    .interactions .acd-interaction-card-v2.is-selected,
    .interactions .acd-interaction-card-v2.is-selected .acd-interaction-card-v2-container {
      background: #2d3540 !important; color: #fff !important; border-color: #60a5fa !important;
    }
    .interactions .participant-name,
    .interactions .int-queue,
    .interactions .outbound-option-contact-address,
    .interactions .outbound-option-contact-queue {
      color: #f1f5f9 !important;
    }
    .interactions .customer-group-outbound-options,
    .interactions .new-outbound {
      background: #252b33 !important; color: #e5e7eb !important; border-color: #4b596a !important;
    }
    .interactions .customer-group-outbound-options:hover,
    .interactions .new-outbound:hover {
      background: #343d49 !important; color: #fff !important;
    }
    .interactions .popover-outbound,
    .interactions .customer-outbound-options,
    .interactions .outbound-option,
    .interactions .outbound-option-contact-info {
      background: #252b33 !important; color: #e5e7eb !important; border-color: #4b596a !important;
    }
    .interactions .customer-outbound-options gux-list-item:hover,
    .interactions .customer-outbound-options gux-list-item:focus {
      background: #343d49 !important; color: #fff !important;
    }
    /* Agent presence hover cards — shared shell and both self/other variants. */
    .entity-v3-hover-card-popover,
    .entity-v3-hover-card-popover .ember-engage-components-pop-over-container {
      background: transparent !important; border: 0 !important; box-shadow: none !important;
    }
    .entity-v3-hover-card-popover .entity-v3-mini-card,
    .entity-v3-hover-card-popover .left-bar,
    .entity-v3-hover-card-popover .right-bar {
      background: #20262d !important; color: #e5e7eb !important; border-color: #4b596a !important;
    }
    .entity-v3-hover-card-popover .entity-v3-mini-card {
      box-sizing: border-box !important; border: 1px solid rgba(255,255,255,.9) !important;
      border-radius: 6px !important; overflow: hidden !important; box-shadow: 0 8px 20px rgba(0,0,0,.4) !important;
    }
    .entity-v3-hover-card-popover .left-bar {
      background: #252b33 !important; border-right: 1px solid #4b596a !important;
    }
    .entity-v3-hover-card-popover .arrow {
      background: #20262d !important; border-color: #4b596a !important;
    }
    .entity-v3-hover-card-popover .name-header,
    .entity-v3-hover-card-popover .person-title,
    .entity-v3-hover-card-popover .person-department,
    .entity-v3-hover-card-popover .message,
    .entity-v3-hover-card-popover .person-status,
    .entity-v3-hover-card-popover .presence-label,
    .entity-v3-hover-card-popover .menu-label {
      color: #f8fafc !important;
    }
    .entity-v3-hover-card-popover .divider { color: #94a3b8 !important; }
    .entity-v3-hover-card-popover .status-block,
    .entity-v3-hover-card-popover .presence-label-group,
    .entity-v3-hover-card-popover .presence-label-wrapper {
      background: transparent !important; border-color: #4b596a !important;
    }
    .entity-v3-hover-card-popover .blockquote-start,
    .entity-v3-hover-card-popover .self-icon,
    .entity-v3-hover-card-popover gux-icon {
      background: transparent !important; color: #cbd5e1 !important; fill: currentColor !important;
    }
    .entity-v3-hover-card-popover .profile-link-image,
    .entity-v3-hover-card-popover .avatar-container,
    .entity-v3-hover-card-popover .animated-status {
      background: transparent !important; border-color: #4b596a !important;
    }
    .entity-v3-hover-card-popover .presence-selector {
      background: #171b20 !important; color: #f8fafc !important;
      border: 1px solid #4b596a !important; box-shadow: none !important;
    }
    .entity-v3-hover-card-popover .presence-selector:focus {
      border-color: #22d3ee !important; outline: 0 !important;
    }
    .entity-v3-hover-card-popover .entity-v3-mini-card:has(.avatar-container.busy) { --gbs-hover-status: var(--gbs-status-busy); }
    .entity-v3-hover-card-popover .entity-v3-mini-card:has(.avatar-container.idle) { --gbs-hover-status: var(--gbs-status-idle); }
    .entity-v3-hover-card-popover .entity-v3-mini-card:has(.avatar-container.available) { --gbs-hover-status: var(--gbs-status-available); }
    .entity-v3-hover-card-popover .entity-v3-mini-card:has(.avatar-container.interacting) { --gbs-hover-status: var(--gbs-status-interacting); }
    .entity-v3-hover-card-popover .entity-v3-mini-card:has(.avatar-container.on_queue) { --gbs-hover-status: var(--gbs-status-idle); }
    .entity-v3-hover-card-popover .entity-v3-mini-card:has(.avatar-container.break) { --gbs-hover-status: var(--gbs-status-break); }
    .entity-v3-hover-card-popover .entity-v3-mini-card:has(.avatar-container.meal) { --gbs-hover-status: var(--gbs-status-meal); }
    .entity-v3-hover-card-popover .entity-v3-mini-card:has(.avatar-container.meeting) { --gbs-hover-status: var(--gbs-status-meeting); }
    .entity-v3-hover-card-popover .entity-v3-mini-card:has(.avatar-container.training) { --gbs-hover-status: var(--gbs-status-training); }
    /* The hover-card portrait gets a prominent ring in the presence colour of
       the person being viewed, rather than inheriting the current user's one. */
    .entity-v3-hover-card-popover .avatar-container,
    .entity-v3-hover-card-popover .animated-status {
      display: inline-flex !important; align-items: center !important; justify-content: center !important;
      box-sizing: border-box !important; border-radius: 50% !important;
    }
    .entity-v3-hover-card-popover .avatar-container {
      border: 0 !important; outline: 0 !important; box-shadow: none !important; background: transparent !important;
    }
    .entity-v3-hover-card-popover .animated-status {
      padding: 3px !important; border: 4px solid var(--gbs-hover-status, var(--gbs-status-unknown)) !important;
      background: #20262d !important; box-shadow: inset 0 0 0 1px #fff !important;
    }
    .entity-v3-hover-card-popover .profile-link-image,
    .entity-v3-hover-card-popover .profile-link-image .avatar {
      display: block !important; border-radius: 50% !important; overflow: hidden !important;
    }
    .entity-v3-hover-card-popover .gux-toggle-wrapper {
      display: block !important; position: relative !important; box-sizing: border-box !important;
      min-height: 32px !important; width: 100% !important; overflow: visible !important;
      background: transparent !important; border: 1px solid #64748b !important; border-radius: 3px !important;
    }
    .entity-v3-hover-card-popover .gux-toggle-wrapper::before {
      content: "" !important; position: absolute !important; z-index: 2 !important; left: 5px !important; top: 50% !important;
      width: 36px !important; height: 16px !important; box-sizing: border-box !important; pointer-events: none !important;
      background: #475569 !important; border: 1px solid #94a3b8 !important; border-radius: 999px !important;
      transform: translateY(-50%) !important; transition: background-color .18s ease, border-color .18s ease !important;
    }
    .entity-v3-hover-card-popover .gux-toggle-wrapper::after {
      content: "" !important; position: absolute !important; z-index: 3 !important; left: 7px !important; top: 50% !important;
      width: 12px !important; height: 12px !important; box-sizing: border-box !important; pointer-events: none !important;
      background: #f8fafc !important; border: 1px solid #dbeafe !important;
      border-radius: 50% !important; box-shadow: none !important; transform: translateY(-50%) !important;
      transition: transform .18s ease !important;
    }
    .entity-v3-hover-card-popover .gux-toggle-wrapper.gbs-toggle-on::before { background: #10b981 !important; border-color: #6ee7b7 !important; }
    .entity-v3-hover-card-popover .gux-toggle-wrapper.gbs-toggle-on::after { transform: translate(20px, -50%) !important; }
    .entity-v3-hover-card-popover .gbs-popup-queue-label {
      position: absolute !important; z-index: 3 !important; left: 50px !important; top: 50% !important;
      transform: translateY(-50%) !important; color: #f8fafc !important; background: transparent !important;
      font-size: 14px !important; font-weight: 600 !important; line-height: 1 !important; white-space: nowrap !important;
      pointer-events: none !important;
    }
    .entity-v3-hover-card-popover .gux-toggle-wrapper.gbs-toggle-on .gbs-popup-queue-label { color: #6ee7b7 !important; }
    .entity-v3-hover-card-popover .gux-toggle-wrapper gux-toggle {
      position: absolute !important; z-index: 4 !important; left: 0 !important; top: 0 !important;
      width: 46px !important; height: 32px !important; opacity: 0 !important; cursor: pointer !important;
    }
    .entity-v3-hover-card-popover .disassociate-button,
    .entity-v3-hover-card-popover .info-actions a {
      color: #67e8f9 !important; background: transparent !important; border-color: transparent !important;
    }
    .entity-v3-hover-card-popover .disassociate-button:hover,
    .entity-v3-hover-card-popover .info-actions a:hover {
      color: #a5f3fc !important; background: #2d3540 !important;
    }
    .entity-v3-hover-card-popover .entity-contact,
    .entity-v3-hover-card-popover .entity-v3-contact-group,
    .entity-v3-hover-card-popover .contact-container {
      background: transparent !important; border-color: transparent !important;
    }
    .entity-v3-hover-card-popover .contact {
      display: inline-flex !important; align-items: center !important; justify-content: center !important;
      background: #252b33 !important; color: #e5e7eb !important; border: 1px solid #4b596a !important;
      border-radius: 4px !important; box-shadow: none !important;
    }
    .entity-v3-hover-card-popover .contact:hover,
    .entity-v3-hover-card-popover .person-favorite:hover {
      background: #343d49 !important; color: #fff !important; border-color: #64748b !important;
    }
    .entity-v3-hover-card-popover .person-favorite {
      background: #252b33 !important; color: #facc15 !important; border: 1px solid #4b596a !important;
    }
    .entity-v3-hover-card-popover .pop-over-tether-element-marker,
    .entity-v3-hover-card-popover .pop-over-tether-marker-dot {
      background: #20262d !important; border-color: #4b596a !important;
    }
    .interaction-queue-status-container .interactions-container,
    .interaction-queue-status-container .interactions-image {
      background: #1d2025 !important; color: #e5e7eb !important; border-color: #3a4655 !important;
    }
    .interaction-queue-status-container .queue-message {
      color: #f8fafc !important; opacity: 1 !important;
    }
    /* The outbound illustration is decorative and consumes valuable room. */
    .left-chat-rail .interactions-image,
    .left-chat-rail .interactions-image::before,
    .left-chat-rail .interactions-image::after {
      background-image: none !important; content: none !important;
    }
    .left-chat-rail .interactions-image > img,
    .left-chat-rail .interactions-image > svg { display: none !important; }
    .acd-interactions-list.chat-roster.not-has-active-interaction.gray-arrow-v2::before,
    .acd-interactions-list.chat-roster.not-has-active-interaction.gray-arrow-v2::after {
      content: none !important; display: none !important; background-image: none !important;
    }
    .acd-interactions-list.chat-roster.not-has-active-interaction > .interactions {
      display: flex !important; align-items: center !important; justify-content: center !important;
      min-height: 0 !important; background: #1d2025 !important;
    }
    .acd-interactions-list.chat-roster.not-has-active-interaction > .interactions .no-interactions-roster-text {
      display: none !important;
    }
    .acd-interactions-list.chat-roster.not-has-active-interaction > .interactions::after {
      content: "Call Area" !important; color: #cbd5e1 !important; font-size: 15px !important;
      font-weight: 650 !important; letter-spacing: .03em !important; opacity: .82 !important;
    }
    .interaction-roster-header {
      display: flex !important; flex-wrap: wrap !important; align-items: center !important; gap: 6px !important;
    }
    .interaction-roster-header .header-text {
      flex: 1 1 auto !important; min-width: max-content !important;
    }
    .interaction-roster-header-buttons {
      display: flex !important; flex: 0 0 auto !important; flex-wrap: nowrap !important;
      gap: 6px !important; margin-left: auto !important;
    }
    @media (max-width: 650px) {
      .interaction-roster-header-buttons { flex-basis: 100% !important; margin-left: 0 !important; }
    }
    .panel-control-wrapper.active-acd,
    .panel-control-wrapper.active-acd gux-button-slot,
    .panel-control-wrapper.active-acd button {
      background: #252b33 !important; color: #e5e7eb !important; border-color: #4b596a !important;
    }
    .panel-control-wrapper.active-acd button:hover { background: #343d49 !important; color: #fff !important; }
    .interaction-queue-status-container {
      position: relative !important; box-sizing: border-box !important;
      min-width: 0 !important; max-width: none !important;
      flex: 1 1 auto !important; width: 100% !important; overflow: visible !important;
    }
    /* The flex rail is the reliable resize target in Genesys. It receives the
       complement of the saved No-active-conversations ratio, so the right
       pane changes exactly as requested without its nested 240px clamp. */
    .left-chat-rail.gbs-interaction-rail-resizable {
      flex: 0 0 var(--gbs-interaction-rail-width, 320px) !important;
      width: var(--gbs-interaction-rail-width, 320px) !important;
      min-width: 240px !important; max-width: calc(100% - 240px) !important;
    }
    .left-chat-rail { flex: 1 1 0 !important; min-width: 240px !important; }
    .interaction-container.gbs-selected-interaction-resizable { position: relative !important; overflow: visible !important; }
    .gbs-interaction-queue-resizer, .gbs-selected-interaction-resizer {
      position: absolute !important; z-index: 900 !important; top: 0 !important; left: -7px !important; right: auto !important;
      width: 14px !important; height: 100% !important; margin: 0 !important; padding: 0 !important;
      cursor: col-resize !important; touch-action: none !important; pointer-events: auto !important; background: transparent !important;
      overflow: visible !important; opacity: 1 !important; visibility: visible !important;
    }
    .gbs-interaction-queue-resizer::before, .gbs-selected-interaction-resizer::before {
      content: "" !important; position: absolute !important; top: 0 !important; bottom: 0 !important;
      left: 5px !important; width: 4px !important; border-radius: 3px !important;
      background: #475569 !important; border-left: 1px solid #64748b !important;
    }
    .gbs-interaction-queue-resizer:hover::before,
    .gbs-selected-interaction-resizer:hover::before,
    body.gbs-interaction-queue-resizing .gbs-interaction-queue-resizer::before {
      background: #64748b !important; border-color: #94a3b8 !important;
      box-shadow: 0 0 5px rgba(148,163,184,.45) !important;
    }
    .no-interactions-roster-text,
    .no-interactions-roster-text > span:not(.sr-only),
    .no-interactions-roster-text .or {
      color: #f8fafc !important; opacity: 1 !important;
    }
    .no-interactions-roster-text gux-button.onQueueButton {
      color: #fff !important; opacity: 1 !important;
    }
    .command-panel .toggle-item-container .toggle-item:hover,
    .command-panel .toggle-item-container .toggle-item.active {
      background: #343d49 !important; color: #fff !important;
    }
    .command-panel .toggle-switch { background: #77828f !important; border-color: #4b596a !important; }
    .command-panel .toggle-switch .toggle { background: #cbd5e1 !important; border-color: #4b596a !important; }
    .command-panel .phone-settings .device-selection,
    .command-panel .phone-settings .entry-row,
    .command-panel .phone-settings .entry-label,
    .command-panel .phone-settings .entry-values,
    .command-panel .phone-settings .default-profile-wrapper {
      background: #252b33 !important; color: #e5e7eb !important; border-color: #4b596a !important;
    }
    .command-panel .phone-settings .entry-row:hover { background: #2d3540 !important; }
    .command-panel .phone-settings label,
    .command-panel .phone-settings .entry-row gux-icon { color: #cbd5e1 !important; }
    .command-panel .phone-settings select,
    .command-panel .phone-settings option { background: #1d2025 !important; color: #f8fafc !important; border-color: #4b596a !important; }

    /* Calls: common surfaces used by Call History, Dialpad, Inbox, Phone Details and Phone Settings. */
    .command-panel .panel-container, .command-panel .panel-content, .command-panel .panel-body,
    .command-panel .call-controls-panels, .command-panel .call-scroll,
    .command-panel .inbox-panel-container, .command-panel .inbox-panel,
    .command-panel .ib-panelcontent-v2, .command-panel .inbox-panel-content,
    .command-panel .inbox-listing, .command-panel .list-scrollable,
    .command-panel .phone-settings-container, .command-panel .follow-me-settings-container,
    .command-panel .follow-me-settings-panel, .command-panel .profile-selection-v2,
    .command-panel .station-setting, .command-panel .current-station,
    .command-panel .device-selection, .command-panel .actions,
    .command-panel .dialpad, .command-panel .dialpad-numbers-container,
    .command-panel .input, .command-panel .form-group, .command-panel .drag-drop-area {
      background: #1d2025 !important; color: #e5e7eb !important; border-color: #3a4655 !important;
    }
    .command-panel .inbox-row, .command-panel .inbox-message,
    .command-panel .dropdown-container, .command-panel .dropdown-menu-view,
    .command-panel .entry-row, .command-panel .panel-section,
    .command-panel .device-selection > *, .command-panel .current-station > * {
      background: #252b33 !important; color: #e5e7eb !important; border-color: #3a4655 !important;
    }
    .command-panel input, .command-panel textarea, .command-panel select,
    .command-panel .form-control, .command-panel .tags-input,
    .command-panel .purecloud-input, .command-panel .target-input {
      background: #171b20 !important; color: #f8fafc !important;
      border: 1px solid #4b596a !important; box-shadow: none !important;
    }
    .command-panel input::placeholder, .command-panel textarea::placeholder { color: #94a3b8 !important; opacity: 1 !important; }
    .command-panel .btn:not(.btn-hangup), .command-panel .btn-link,
    .command-panel .profile-dropdown-toggle, .command-panel .dropdown-menu-view > button,
    .command-panel .action-fetch-more {
      background: #252b33 !important; color: #f1f5f9 !important; border-color: #4b596a !important;
    }
    .command-panel .btn:not(.btn-hangup):hover, .command-panel .btn-link:hover,
    .command-panel .profile-dropdown-toggle:hover, .command-panel .dropdown-menu-view > button:hover {
      background: #343d49 !important; color: #fff !important;
    }
    .command-panel gux-icon, .command-panel .app-img.icon,
    .command-panel .document-icon-container, .command-panel .status-icon-container {
      color: #cbd5e1 !important; fill: currentColor !important; opacity: 1 !important; filter: none !important;
    }
    .command-panel .toggle-item-container gux-icon { color: #f8fafc !important; }
    .command-panel .phone-label, .command-panel .call-controls-subheader,
    .command-panel .file-name, .command-panel .name, .command-panel label,
    .command-panel h4, .command-panel h5 { color: #f8fafc !important; }
    .command-panel .view-name, .command-panel .time, .command-panel .letters,
    .command-panel .optional, .command-panel .page-number-indicator { color: #aeb9c8 !important; }

    /* Persistent light/dark-mode button in the global action bar. */
    .gbs-theme-toggle-wrap { display: inline-flex !important; align-items: center !important; align-self: center !important; height: var(--gbs-theme-height, 32px) !important; margin: 0 4px !important; padding: 0 !important; line-height: 1 !important; transform: translateY(-2px) !important; }
    .gbs-theme-toggle { box-sizing: border-box !important; width: var(--gbs-theme-height, 32px) !important; min-width: var(--gbs-theme-height, 32px) !important; height: var(--gbs-theme-height, 32px) !important; min-height: 0 !important; display: inline-flex !important; align-items: center !important; justify-content: center !important; padding: 0 !important; margin: 0 !important; background: #2d3540 !important; color: #e5e7eb !important; border: 1px solid #4b596a !important; border-radius: 4px !important; cursor: pointer !important; vertical-align: middle !important; }
    .gbs-theme-toggle:hover { background: #343d49 !important; color: #fff !important; border-color: #7897ea !important; }
    .gbs-theme-toggle svg { width: 18px !important; height: 18px !important; stroke: currentColor !important; }
    .command-global-search { position: relative !important; overflow: visible !important; }
    /* Coordinates are supplied from the live command-bar/search geometry.
       Fixed positioning prevents the developer control from participating in
       (or shifting) Genesys's responsive menu layout. */
    .gbs-call-dev-toggle-wrap { position: fixed !important; left: var(--gbs-call-dev-x, -9999px) !important; top: var(--gbs-call-dev-y, -9999px) !important; transform: translateY(-50%) !important; display: inline-flex !important; align-items: center !important; margin: 0 !important; z-index: 2147483000 !important; }
    body .gbs-call-dev-toggle {
      box-sizing: border-box !important; width: 92px !important; min-width: 92px !important; max-width: 92px !important;
      height: 28px !important; min-height: 28px !important; padding: 0 8px !important; font-size: 11px !important;
      line-height: 26px !important; white-space: nowrap !important; overflow: hidden !important; text-overflow: clip !important;
      display: inline-flex !important; align-items: center !important; justify-content: center !important;
      color: #a5f3fc !important; border-color: #22d3ee !important;
    }
    .gbs-call-dev-toggle.gbs-call-dev-active { background: rgba(34,211,238,.16) !important; color: #ecfeff !important; box-shadow: 0 0 8px rgba(34,211,238,.28) !important; }
    .gbs-settings-popover {
      position: fixed !important; z-index: 2147483640 !important; left:50% !important; top:50% !important; right:auto !important;
      transform:translate(-50%, -50%) !important; box-sizing:border-box !important; width:min(620px, calc(100vw - 32px)) !important;
      max-height:min(680px, calc(100vh - 32px)) !important; overflow:hidden !important; display:flex !important; flex-direction:column !important;
      background: #252b33 !important; color: #f8fafc !important; border: 1px solid #64748b !important;
      border-radius: 10px !important; box-shadow: 0 16px 42px rgba(0,0,0,.52), 0 0 18px rgba(100,116,139,.2) !important;
    }
    .gbs-settings-popover[hidden] { display: none !important; }
    .gbs-settings-head { display:flex !important; align-items:center !important; gap:9px !important; padding:13px 15px !important; border-bottom:1px solid #3a4655 !important; font-size:16px !important; font-weight:750 !important; }
    .gbs-settings-back, .gbs-settings-close { display:inline-flex !important; align-items:center !important; justify-content:center !important; width:30px !important; height:30px !important; padding:0 !important; color:#e2e8f0 !important; background:#1d2025 !important; border:1px solid #4b596a !important; border-radius:6px !important; cursor:pointer !important; }
    .gbs-settings-back { width:36px !important; height:36px !important; margin:-4px 0 !important; background:transparent !important; border:0 !important; border-radius:50% !important; }
    .gbs-settings-back svg { width:30px !important; height:30px !important; }
    .gbs-settings-close { margin-left:auto !important; }
    .gbs-settings-body { flex:1 1 auto !important; min-height:0 !important; overflow:auto !important; padding:10px !important; }
    .gbs-settings-entry { width:100% !important; display:flex !important; align-items:center !important; gap:10px !important; padding:12px !important; color:#f8fafc !important; background:#1d2025 !important; border:1px solid #3a4655 !important; border-radius:7px !important; text-align:left !important; cursor:pointer !important; }
    .gbs-settings-entry:hover { background:#343d49 !important; border-color:#64748b !important; }
    .gbs-status-setting-row { padding:10px !important; margin-bottom:8px !important; background:#1d2025 !important; border:1px solid #3a4655 !important; border-radius:7px !important; }
    .gbs-status-setting-label { display:flex !important; align-items:center !important; justify-content:space-between !important; gap:10px !important; font-weight:700 !important; text-transform:capitalize !important; }
    .gbs-status-setting-label input { position:absolute !important; width:1px !important; height:1px !important; opacity:0 !important; pointer-events:none !important; }
    .gbs-status-example { margin-top:8px !important; padding:7px 9px !important; border:1px solid var(--gbs-preview-color) !important; border-left:4px solid var(--gbs-preview-color) !important; border-radius:5px !important; color:var(--gbs-preview-color) !important; background:color-mix(in srgb, var(--gbs-preview-color) 14%, #1d2025) !important; box-shadow:0 0 7px color-mix(in srgb, var(--gbs-preview-color) 34%, transparent) !important; }
    .gbs-status-palette { display:flex !important; align-items:center !important; flex-wrap:wrap !important; gap:6px !important; max-width:100% !important; margin-top:8px !important; }
    .gbs-status-reset, .gbs-status-swatch { width:30px !important; height:30px !important; min-width:30px !important; padding:0 !important; display:inline-flex !important; align-items:center !important; justify-content:center !important; border:1px solid #4b596a !important; border-radius:6px !important; cursor:pointer !important; background:#252b33 !important; color:#e2e8f0 !important; box-sizing:border-box !important; }
    .gbs-status-reset svg { width:18px !important; height:18px !important; }
    .gbs-status-swatch::before { content:"" !important; width:18px !important; height:18px !important; border-radius:50% !important; background:var(--gbs-swatch-color) !important; border:1px solid color-mix(in srgb, var(--gbs-swatch-color) 75%, white) !important; box-sizing:border-box !important; }
    .gbs-status-custom { height:30px !important; padding:0 8px !important; display:inline-flex !important; align-items:center !important; gap:6px !important; border:1px solid #4b596a !important; border-radius:6px !important; cursor:pointer !important; background:#252b33 !important; color:#e2e8f0 !important; font-weight:700 !important; }
    .gbs-status-custom-swatch { width:16px !important; height:16px !important; border-radius:3px !important; background:var(--gbs-preview-color) !important; border:1px solid rgba(255,255,255,.72) !important; box-sizing:border-box !important; }
    .gbs-status-reset:hover, .gbs-status-swatch:hover, .gbs-status-custom:hover { border-color:#f8fafc !important; background:#343d49 !important; }
    .gbs-settings-footer { flex:0 0 auto !important; display:flex !important; gap:8px !important; justify-content:flex-end !important; padding:10px !important; border-top:1px solid #3a4655 !important; }
    .gbs-settings-footer button { padding:7px 11px !important; border:1px solid #4b596a !important; border-radius:6px !important; color:#f8fafc !important; background:#343d49 !important; cursor:pointer !important; }
    .gbs-settings-footer .gbs-settings-save { background:#126b47 !important; border-color:#39d98a !important; }
    .gbs-settings-footer .gbs-settings-default { margin-right:auto !important; }

    /* Collaborate Chat runs in its own frame and receives this stylesheet there. */
    .chat-room, .chat-room-content, .chat-content, .chat-main, .chat-history, .chat-messages,
    .conversation, .conversation-content, .conversation-view, .conversation-header,
    .room-header, .chat-room-header, .chat-header, .message-list, .message-container,
    .compose-container, .composer-container, .message-composer, .chat-input-container,
    .chat-footer, .right-chat-content { background: #1d2025 !important; color: #e5e7eb !important; border-color: #3a4655 !important; }
    .chat-room input, .chat-room textarea, .chat-content input, .chat-content textarea,
    .message-composer input, .message-composer textarea, [contenteditable="true"] {
      background: #171b20 !important; color: #f8fafc !important; border-color: #4b596a !important; caret-color: #f8fafc !important;
    }
    .chat-message, .message-row, .message-body, .message-text, .message-content,
    .message-card, .quoted-message, .quote, .reply-preview {
      background: #20262d !important; color: #e5e7eb !important; border-color: #4b596a !important;
    }
    .chat-message a, .message-row a, .message-content a { color: #93c5fd !important; }
    .chat-content .selected, .conversation.selected, .room.selected { background: #2d3540 !important; }
    /* Exact Collaborate Chat DOM captured from the live iframe. */
    .chat-pane, .conversation-pane, .conversation-pane-body-container,
    #full-messages-pane, .messages-pane-scrolling-container, .messages-pane,
    .chat-text-container, .chat-textarea-container, .chat-fileupload-container,
    .chat-header-top-container, .chat-header-bottom-container,
    .roster-chat-container, .roster-chat, .chat-group,
    .message-item, .message-main-content, .message-head, .message-body,
    .message-actions-bar, .chat-preferences-popover-content,
    .chat-quick-access-popover-container {
      background: #1d2025 !important; color: #e5e7eb !important; border-color: #3a4655 !important;
    }
    .chat-textarea, #chat-main-textarea {
      background: #171b20 !important; color: #f8fafc !important; border-color: #4b596a !important; caret-color: #f8fafc !important;
    }
    .chat-group-item, .message-action-button, .text-area-action,
    .chat-fileupload-container .fileupload-btn {
      background: transparent !important; color: #e5e7eb !important; border-color: transparent !important;
    }
    .chat-group-item:hover, .chat-group-item[aria-selected="true"],
    .button-group.room-selected .chat-group-item { background: #2d3540 !important; }
    .message-item.separator-line { border-color: #3a4655 !important; }
    .quoted-message, .quote, .reply-preview, .message-quote, .quoted-message-content {
      background: #252b33 !important; color: #e5e7eb !important; border-color: #4b596a !important;
    }

    /* Analytics tab/navigation strips outside the dashboard canvas. */
    .tabs-container, .tab-container, .tab-strip, .tab-list, .tabbed-workspace,
    .dashboard-tabs, .dashboard-tab-bar, gux-tabs, gux-tab-list,
    .navigation-header, .page-header, .sub-header {
      background: #252b33 !important; color: #e5e7eb !important; border-color: #3a4655 !important;
    }
    gux-tab, [role="tab"] { background: #252b33 !important; color: #cbd5e1 !important; border-color: #3a4655 !important; }
    gux-tab[selected], [role="tab"][aria-selected="true"] { background: #343d49 !important; color: #fff !important; }

    /* Exact Analytics UI navigation elements verified on the live dashboard. */
    .secondary-nav-bar,
    .secondary-nav-bar.dashboard-dark-mode-enabled,
    .secondary-nav-bar .button-search-interval-picker-bar,
    .secondary-nav-bar .button-search-bar,
    .secondary-nav-bar .bar-center,
    .secondary-nav-bar .bar-right,
    .secondary-nav-bar .other-actions,
    .secondary-nav-bar .button-bar,
    .secondary-nav-bar .entity-breadcrumb,
    .secondary-nav-bar .favorite-toggle,
    .secondary-nav-bar .button-bar-section,
    .secondary-nav-bar .grid-size-picker-wrapper {
      background: #252b33 !important; color: #e5e7eb !important; border-color: #4b596a !important;
    }
    .secondary-nav-bar { border-top: 1px solid #3a4655 !important; border-bottom: 1px solid #4b596a !important; }
    .secondary-nav-bar .entity-name { color: #f1f5f9 !important; }
    .secondary-nav-bar button { background: transparent !important; color: #cbd5e1 !important; border-color: #4b596a !important; }
    .secondary-nav-bar button:hover:not(:disabled) { background: #343d49 !important; color: #fff !important; }
    .secondary-nav-bar button:disabled { color: #7b8794 !important; opacity: .72 !important; }
    .secondary-nav-bar gux-icon { color: #cbd5e1 !important; }
    .secondary-nav-bar .gux-rating-active { color: #facc15 !important; }

    gux-tabs-advanced.analytics-ui-main-app-tabs,
    gux-tabs-advanced.analytics-ui-main-app-tabs gux-tab-advanced-list,
    gux-tabs-advanced.analytics-ui-main-app-tabs .gux-tab-container,
    gux-tabs-advanced.analytics-ui-main-app-tabs .gux-scrollable-section,
    gux-tabs-advanced.analytics-ui-main-app-tabs .gux-tablist {
      background: #252b33 !important; color: #e5e7eb !important; border-color: #3a4655 !important;
    }
    gux-tabs-advanced.analytics-ui-main-app-tabs .gux-tab,
    gux-tabs-advanced.analytics-ui-main-app-tabs .gux-buttons,
    gux-tabs-advanced.analytics-ui-main-app-tabs .gux-tab-options {
      background: #252b33 !important; color: #e5e7eb !important;
    }
    gux-tabs-advanced.analytics-ui-main-app-tabs .gux-tab-button,
    gux-tabs-advanced.analytics-ui-main-app-tabs .gux-tab-options-trigger {
      background: transparent !important; color: #cbd5e1 !important; border-color: #4b596a !important;
    }
    gux-tabs-advanced.analytics-ui-main-app-tabs .gux-tab:hover,
    gux-tabs-advanced.analytics-ui-main-app-tabs .gux-tab:hover .gux-buttons,
    gux-tabs-advanced.analytics-ui-main-app-tabs .gux-tab:hover .gux-tab-button,
    gux-tabs-advanced.analytics-ui-main-app-tabs .gux-tab:hover .gux-tab-options,
    gux-tabs-advanced.analytics-ui-main-app-tabs .gux-tab:hover .gux-tab-options-trigger {
      background: #2d3540 !important; color: #fff !important;
    }
    gux-tabs-advanced.analytics-ui-main-app-tabs .gux-tab.gux-selected,
    gux-tabs-advanced.analytics-ui-main-app-tabs .gux-tab.gux-selected .gux-tab-button,
    gux-tabs-advanced.analytics-ui-main-app-tabs .gux-tab.gux-selected .gux-tab-options,
    gux-tabs-advanced.analytics-ui-main-app-tabs .gux-tab.gux-selected .gux-tab-options-trigger,
    gux-tabs-advanced.analytics-ui-main-app-tabs .gux-tab:has(.gux-tab-button[aria-selected="true"]),
    gux-tabs-advanced.analytics-ui-main-app-tabs .gux-tab:has(.gux-tab-button[aria-selected="true"]) .gux-buttons,
    gux-tabs-advanced.analytics-ui-main-app-tabs .gux-tab:has(.gux-tab-button[aria-selected="true"]) .gux-tab-options-trigger {
      background: #3b4655 !important; color: #fff !important; border-bottom-color: #3a4655 !important;
    }
    gux-tabs-advanced.analytics-ui-main-app-tabs .gux-tab.gux-selected .gux-tab-button,
    gux-tabs-advanced.analytics-ui-main-app-tabs .gux-tab:has(.gux-tab-button[aria-selected="true"]) .gux-tab-button { box-shadow: none !important; }
    gux-tabs-advanced.analytics-ui-main-app-tabs .gux-tab {
      position: relative !important; border-bottom: 2px solid transparent !important; background-image: none !important;
    }
    gux-tabs-advanced.analytics-ui-main-app-tabs .gux-tab::after,
    gux-tabs-advanced.analytics-ui-main-app-tabs .gux-buttons::after {
      content: none !important; display: none !important; background: transparent !important;
    }
    gux-tabs-advanced.analytics-ui-main-app-tabs .gux-tab.gux-selected,
    gux-tabs-advanced.analytics-ui-main-app-tabs .gux-tab:has(.gux-tab-button[aria-selected="true"]) {
      border-bottom-color: transparent !important;
    }
    gux-tabs-advanced.analytics-ui-main-app-tabs .gux-tab:hover {
      border-bottom-color: transparent !important;
    }
    gux-tabs-advanced.analytics-ui-main-app-tabs .gbs-tab-underline {
      display: block !important; position: absolute !important; z-index: 10002 !important; pointer-events: none !important;
      left: 0 !important; right: 0 !important; bottom: -3px !important; height: 2px !important; background: #4b596a !important;
    }
    gux-tabs-advanced.analytics-ui-main-app-tabs .gux-tab.gux-selected > .gbs-tab-underline,
    gux-tabs-advanced.analytics-ui-main-app-tabs .gux-tab:has(.gux-tab-button[aria-selected="true"]) > .gbs-tab-underline { display: block !important; background: #22d3ee !important; }
    gux-tabs-advanced.analytics-ui-main-app-tabs .gux-tab:hover > .gbs-tab-underline { display: block !important; background: #18bdd2 !important; }
    @media (max-width: 2100px) {
      gux-tabs-advanced.analytics-ui-main-app-tabs .gbs-tab-underline { bottom: 4px !important; }
    }
    gux-tabs-advanced.analytics-ui-main-app-tabs .gux-divider {
      background: #4b596a !important; color: #4b596a !important; border-color: #4b596a !important;
    }
    gux-tabs-advanced.analytics-ui-main-app-tabs .gux-title-container,
    gux-tabs-advanced.analytics-ui-main-app-tabs .gux-tab-button-text,
    gux-tabs-advanced.analytics-ui-main-app-tabs .tab-name,
    gux-tabs-advanced.analytics-ui-main-app-tabs gux-icon {
      background: transparent !important; color: inherit !important;
    }
    gux-tabs-advanced.analytics-ui-main-app-tabs .gux-dropdown-options-container {
      background: #252b33 !important; color: #f1f5f9 !important; border: 1px solid #4b596a !important;
    }
    gux-tabs-advanced.analytics-ui-main-app-tabs .gux-dropdown-options-container::before,
    gux-tabs-advanced.analytics-ui-main-app-tabs .gux-dropdown-options-container::after {
      background: #252b33 !important; border-color: #4b596a !important;
    }
    gux-tabs-advanced.analytics-ui-main-app-tabs [aria-label*="Create"],
    gux-tabs-advanced.analytics-ui-main-app-tabs .gux-add-tab-button,
    gux-tabs-advanced.analytics-ui-main-app-tabs .gux-tab-add-button,
    gux-tabs-advanced.analytics-ui-main-app-tabs .gux-tab-container gux-button-slot:has(gux-icon[icon-name="fa/plus-regular"]),
    gux-tabs-advanced.analytics-ui-main-app-tabs .gux-tab-container gux-button-slot:has(gux-icon[icon-name="fa/plus-regular"]) > button,
    gux-tabs-advanced.analytics-ui-main-app-tabs gux-tab-advanced-list > .gux-tab-container > button,
    gux-tabs-advanced.analytics-ui-main-app-tabs gux-icon[icon-name="fa/plus-regular"] { color: #22d3ee !important; }
    gux-tabs-advanced.analytics-ui-main-app-tabs .gux-tab-container gux-button-slot:has(gux-icon[icon-name="fa/plus-regular"]),
    gux-tabs-advanced.analytics-ui-main-app-tabs .gux-tab-container gux-button-slot:has(gux-icon[icon-name="fa/plus-regular"]) > button,
    gux-tabs-advanced.analytics-ui-main-app-tabs gux-tab-advanced-list > .gux-tab-container > button {
      width: 26px !important; min-width: 26px !important; height: 26px !important; min-height: 26px !important;
      padding: 5px !important; display: flex !important; align-items: center !important; justify-content: center !important;
      transform: translateX(3px) !important;
    }
    gux-tabs-advanced.analytics-ui-main-app-tabs .gux-tab-container gux-button-slot:has(gux-icon[icon-name="fa/plus-regular"]) > button {
      transform: none !important;
    }
    gux-tabs-advanced.analytics-ui-main-app-tabs .gux-tab-container gux-button-slot:has(gux-icon[icon-name="fa/plus-regular"]):hover,
    gux-tabs-advanced.analytics-ui-main-app-tabs .gux-tab-container gux-button-slot:has(gux-icon[icon-name="fa/plus-regular"]):hover > button,
    gux-tabs-advanced.analytics-ui-main-app-tabs .gux-tab-container gux-button-slot:has(gux-icon[icon-name="fa/plus-regular"]):hover gux-icon[icon-name="fa/plus-regular"],
    gux-tabs-advanced.analytics-ui-main-app-tabs gux-tab-advanced-list > .gux-tab-container > button:hover,
    gux-tabs-advanced.analytics-ui-main-app-tabs gux-tab-advanced-list > .gux-tab-container > button:hover gux-icon[icon-name="fa/plus-regular"] {
      color: #111827 !important;
    }
    gux-tabs-advanced.analytics-ui-main-app-tabs .gux-tab-container gux-button-slot:has(gux-icon[icon-name="fa/plus-regular"]):hover > button { background: #475569 !important; }
    /* The options control shares the selected fill, but only the tab gets its cyan underline. */
    gux-tabs-advanced.analytics-ui-main-app-tabs .gux-tab-options,
    gux-tabs-advanced.analytics-ui-main-app-tabs .gux-tab-options-trigger {
      box-shadow: none !important; border-bottom-color: #3a4655 !important; border-radius: 0 !important;
    }
    gux-list, gux-list-item,
    .gux-dropdown-options-container, .gux-dropdown-options-container gux-list,
    .gux-dropdown-options-container gux-list-item {
      background: #252b33 !important; color: #f1f5f9 !important; border-color: #4b596a !important;
    }
    .gux-dropdown-options-container gux-list-item:hover { background: #343d49 !important; color: #fff !important; }
    /* Keep the native popover geometry, but do not clip its panel below the tab row. */
    gux-tabs-advanced.analytics-ui-main-app-tabs,
    gux-tabs-advanced.analytics-ui-main-app-tabs .gux-tab-container,
    gux-tabs-advanced.analytics-ui-main-app-tabs .gux-scrollable-section,
    gux-tabs-advanced.analytics-ui-main-app-tabs .gux-tab-options {
      overflow: visible !important;
    }
    gux-tabs-advanced.analytics-ui-main-app-tabs .gux-tab-options { position: relative !important; z-index: 10000 !important; }
    gux-tabs-advanced.analytics-ui-main-app-tabs .gux-tab-options gux-popover-list { position: relative !important; z-index: 10001 !important; }
    gux-tabs-advanced.analytics-ui-main-app-tabs .gux-dropdown-options-container,
    gux-tabs-advanced.analytics-ui-main-app-tabs .gux-dropdown-options-container gux-list,
    gux-tabs-advanced.analytics-ui-main-app-tabs .gux-dropdown-options-container gux-list-item {
      display: block !important; width: 100% !important; box-sizing: border-box !important;
    }
    gux-tabs-advanced.analytics-ui-main-app-tabs .gux-dropdown-options-container {
      width: 165px !important; min-width: 165px !important;
      border: 0 !important; border-radius: 0 !important;
    }
    gux-tabs-advanced.analytics-ui-main-app-tabs .gux-dropdown-options-container gux-list-item:hover {
      background: #343d49 !important; color: #fff !important;
    }

    /* The badge must win at every screen width, not only in compact navigation. */
    .command-bar .global-actions, .command-bar .all-but-global-search { overflow: visible !important; }
    .command-bar-inbox { position: relative !important; isolation: isolate !important; z-index: 2147483645 !important; }
    .command-bar-inbox > button { position: relative !important; z-index: 2147483646 !important; }
    .command-bar-inbox .alert-badge-unread-holder { position: absolute !important; z-index: 2147483647 !important; }
    .command-bar-inbox .alert-badge-unread { position: relative !important; z-index: 2147483647 !important; }

    /* Preferences content slotted into the Genesys modal. */
    .preferences-modal, .preferences, .preferences-layout, .preferences-main,
    .preferences-side-nav, .preferences-nav, .preference-tab-notifications,
    .preferences-notifications, .preference-setting, .settings-preference,
    .preference-container, .profile-selection-container {
      background: #1d2025 !important; color: #e5e7eb !important; border-color: #3a4655 !important;
    }
    .preferences-side-nav { background: #252b33 !important; border-right: 1px solid #4b596a !important; }
    .preferences-title, .preferences h1, .preferences h2, .preferences h3, .preferences h4,
    .preferences label, .preferences .settings-header-text, .preferences .sub-label { color: #e5e7eb !important; }
    .preferences-nav li[role="tab"] { background: #252b33 !important; color: #cbd5e1 !important; border-color: #3a4655 !important; }
    .preferences-nav li[role="tab"]:hover { background: #2d3540 !important; color: #fff !important; }
    .preferences-nav li[role="tab"].active, .preferences-nav li[role="tab"][aria-selected="true"] { background: #343d49 !important; color: #fff !important; }
    .preferences-nav .active-indicator { background: #60a5fa !important; }
    .preferences .btn, .preferences .btn-link, .preferences .btn-toggle,
    .preferences input, .preferences select, .preferences textarea {
      background: #252b33 !important; color: #f8fafc !important; border-color: #4b596a !important;
    }
    .preferences .btn:hover, .preferences .btn-link:hover, .preferences .btn-toggle:hover { background: #343d49 !important; color: #fff !important; }
    .preferences .alert, .preferences .alert-warning { background: #3a3120 !important; color: #fde68a !important; border-color: #a16207 !important; }
    .user-settings-popover, .user-settings-popover .info-card, .user-settings-popover .user-information,
    .user-settings-popover .avatar-header, .user-settings-popover .user-sub-info,
    .user-settings-popover .status-container, .user-settings-popover .presence-section,
    .user-settings-popover .user-settings-footer { background: #252b33 !important; color: #e5e7eb !important; border-color: #3a4655 !important; }
    .user-settings-popover .user-name, .user-settings-popover .org-name,
    .user-settings-popover label, .user-settings-popover span, .user-settings-popover h2 { color: #e5e7eb !important; }
    .user-settings-popover input { background: transparent !important; color: #f8fafc !important; border: 0 !important; outline: 0 !important; box-shadow: none !important; }
    .user-settings-popover button, .user-settings-popover [role="button"], .user-settings-popover [role="menuitem"] {
      background: #20262d !important; color: #f8fafc !important; border-color: #3a4655 !important;
    }
    .user-settings-popover button:hover, .user-settings-popover [role="button"]:hover,
    .user-settings-popover [role="menuitem"]:hover { background: #343d49 !important; }
    .user-settings-popover button:disabled, .user-settings-popover [aria-disabled="true"] { color: #7b8794 !important; opacity: .72 !important; }
    /* The cyan brand mark must sit inside its 28px navigation rail. Earlier
       responsive rules gave its SVG a 30×28 paint box, so its bottom stroke
       visually escaped the parent on compact headers. */
    .command-nav .logo-group { align-items: center !important; }
    .command-nav .logo {
      box-sizing: border-box !important; flex: 0 0 26px !important;
      width: 26px !important; height: 26px !important; min-height: 26px !important;
      margin: 1px 6px 1px 0 !important; background-size: 22px 22px !important;
    }
    @media (max-width: 1040px) {
      .command-nav .logo { flex-basis: 24px !important; width: 24px !important; height: 24px !important; min-height: 24px !important; margin: 2px 5px 2px 0 !important; background-size: 20px 20px !important; }
    }
    /* Use the same visually verified logo placement on medium headers as on
       compact headers. The navigation rail is full height at both sizes. */
    @media (min-width: 1201px) and (max-width: 2100px) {
      .command-nav .logo { transform: translate(-10px, -2px) !important; }
    }
    /* Every non-desktop size shares the same 28px Menu control reference.
       Only the mark may scale on very narrow screens; its anchor must not. */
    @media (max-width: 1200px) {
      .command-nav .logo-group { top: 7px !important; height: 28px !important; min-height: 28px !important; transform: none !important; }
      .command-nav .logo { flex-basis: 26px !important; width: 26px !important; height: 26px !important; min-height: 26px !important; margin: 0 4px 2px 0 !important; background-size: 22px 22px !important; transform: translate(-10px, -2px) !important; }
    }
    @media (max-width: 760px) {
      .command-nav .logo-group { height: 28px !important; min-height: 28px !important; }
      .command-nav .logo { flex-basis: 20px !important; width: 20px !important; height: 20px !important; min-height: 20px !important; margin: 1px 3px 1px 0 !important; background-size: 16px 16px !important; }
    }
    /* Final shared non-desktop alignment: retain the verified 10px left
       offset and raise the mark a further 2px at every compact breakpoint. */
    @media (max-width: 2100px) {
      .command-nav .logo { transform: translate(-10px, -4px) !important; }
    }

    /* Login — a deliberately self-contained V2 space treatment. */
    html:has(#pc-auth-app), body:has(#pc-auth-app) { min-height: 100% !important; background: #050913 !important; color: #e8f3ff !important; }
    #pc-auth-app { position: relative !important; isolation: isolate !important; min-height: 100vh !important; overflow: hidden !important; color: #e8f3ff !important; background: radial-gradient(ellipse 85% 68% at 50% 12%, rgba(14, 116, 144, .23), transparent 65%), radial-gradient(circle at 14% 82%, rgba(30, 64, 175, .16), transparent 32%), linear-gradient(145deg, #060a12 0%, #0b1322 48%, #060a12 100%) !important; }
    #pc-auth-app::before { content: '' !important; position: fixed !important; z-index: 0 !important; inset: -110px !important; pointer-events: none !important; opacity: .94 !important; background-image: radial-gradient(1px 1px at 15% 20%, #fff, transparent 70%), radial-gradient(1px 1px at 72% 18%, #bff8ff, transparent 70%), radial-gradient(1.5px 1.5px at 86% 63%, #fff, transparent 70%), radial-gradient(1px 1px at 31% 77%, #83eaff, transparent 70%), radial-gradient(1px 1px at 57% 47%, #fff, transparent 70%), radial-gradient(1px 1px at 12% 63%, #b9d7ff, transparent 70%), radial-gradient(1px 1px at 9% 36%, #fff, transparent 70%), radial-gradient(1px 1px at 43% 12%, #9aefff, transparent 70%), radial-gradient(1.5px 1.5px at 93% 29%, #fff, transparent 70%), radial-gradient(1px 1px at 68% 74%, #bff8ff, transparent 70%), radial-gradient(1px 1px at 24% 91%, #fff, transparent 70%), radial-gradient(1px 1px at 48% 58%, #83eaff, transparent 70%), radial-gradient(1px 1px at 79% 46%, #fff, transparent 70%), radial-gradient(1px 1px at 4% 82%, #b9d7ff, transparent 70%), radial-gradient(1px 1px at 37% 39%, #fff, transparent 70%), radial-gradient(1px 1px at 61% 7%, #9aefff, transparent 70%) !important; background-size: 210px 210px, 310px 310px, 380px 380px, 260px 260px, 440px 440px, 520px 520px, 290px 290px, 360px 360px, 470px 470px, 250px 250px, 410px 410px, 330px 330px, 510px 510px, 280px 280px, 390px 390px, 460px 460px !important; animation: gbs-login-star-drift 14s linear infinite alternate !important; }
    #pc-auth-app::after { content: '' !important; position: fixed !important; z-index: 0 !important; inset: -20vmax !important; pointer-events: none !important; opacity: .8 !important; background: radial-gradient(circle at 22% 28%, rgba(34,211,238,.14), transparent 19%), radial-gradient(circle at 77% 72%, rgba(59,130,246,.13), transparent 24%), radial-gradient(circle at 52% 47%, transparent 30%, rgba(2,6,23,.32) 72%) !important; animation: gbs-login-nebula 13s ease-in-out infinite alternate !important; }
    /* 4K-friendly pass: retain the same constellation positions but make
       individual points readable at desktop-scale pixel density. */
    #pc-auth-app::before { background-image: radial-gradient(2px 2px at 15% 20%, #fff, transparent 70%), radial-gradient(2px 2px at 72% 18%, #bff8ff, transparent 70%), radial-gradient(3px 3px at 86% 63%, #fff, transparent 70%), radial-gradient(2px 2px at 31% 77%, #83eaff, transparent 70%), radial-gradient(2px 2px at 57% 47%, #fff, transparent 70%), radial-gradient(2px 2px at 12% 63%, #b9d7ff, transparent 70%), radial-gradient(2px 2px at 9% 36%, #fff, transparent 70%), radial-gradient(2px 2px at 43% 12%, #9aefff, transparent 70%), radial-gradient(3px 3px at 93% 29%, #fff, transparent 70%), radial-gradient(2px 2px at 68% 74%, #bff8ff, transparent 70%), radial-gradient(2px 2px at 24% 91%, #fff, transparent 70%), radial-gradient(2px 2px at 48% 58%, #83eaff, transparent 70%), radial-gradient(2px 2px at 79% 46%, #fff, transparent 70%), radial-gradient(2px 2px at 4% 82%, #b9d7ff, transparent 70%), radial-gradient(2px 2px at 37% 39%, #fff, transparent 70%), radial-gradient(2px 2px at 61% 7%, #9aefff, transparent 70%) !important; animation-duration: 12s !important; }
    #pc-auth-app .gbs-login-shooting-stars { position: fixed !important; z-index: 0 !important; inset: 0 !important; overflow: hidden !important; pointer-events: none !important; }
    #pc-auth-app .gbs-login-shooting-stars i { position: absolute !important; width: 3px !important; height: 3px !important; border-radius: 50% !important; background: #effeff !important; box-shadow: 0 0 12px 3px rgba(34,211,238,.9) !important; animation: gbs-shooting-star 3.6s cubic-bezier(.15,.8,.25,1) infinite !important; }
    #pc-auth-app .gbs-login-shooting-stars i::after { content: '' !important; position: absolute !important; right: 1px !important; top: 1px !important; width: 92px !important; height: 1px !important; transform: rotate(31deg) !important; transform-origin: right center !important; background: linear-gradient(90deg, transparent, rgba(103,232,249,.1), rgba(217,251,255,.92)) !important; box-shadow: 0 0 7px rgba(34,211,238,.55) !important; }
    #pc-auth-app .gbs-login-shooting-stars i:nth-child(1) { left: 8% !important; top: 15% !important; animation-delay: -.8s !important; } #pc-auth-app .gbs-login-shooting-stars i:nth-child(2) { left: 66% !important; top: 28% !important; animation-delay: -2.1s !important; } #pc-auth-app .gbs-login-shooting-stars i:nth-child(3) { left: 38% !important; top: 77% !important; animation-delay: -3s !important; }
    @keyframes gbs-login-star-drift { to { transform: translate3d(-90px, 70px, 0); } } @keyframes gbs-login-nebula { to { transform: scale(1.11) rotate(8deg); filter: blur(12px); } }
    #pc-auth-app .auth-chrome, #pc-auth-app .auth-chrome-content { min-height: 100vh !important; background: transparent !important; }
    #pc-auth-app .auth-chrome-content { position: relative !important; z-index: 1 !important; display: grid !important; place-items: center !important; padding: 74px 24px 96px !important; }
    #pc-auth-app .auth-chrome-body, #pc-auth-app .auth-panel, #pc-auth-app .auth-form { width: min(430px, calc(100vw - 40px)) !important; margin: 0 !important; padding: 0 !important; border: 0 !important; background: transparent !important; box-shadow: none !important; }
    #pc-auth-app .logo-container { position: relative !important; top: auto !important; left: auto !important; display: flex !important; align-items: center !important; justify-content: center !important; gap: 10px !important; margin: 0 auto 34px !important; }
    #pc-auth-app .logo { width: 38px !important; height: 38px !important; margin: 0 !important; background: center / contain no-repeat url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Ccircle cx='32' cy='11' r='7' fill='%2322d3ee'/%3E%3Crect x='10' y='24' width='44' height='18' rx='9' fill='none' stroke='%2322d3ee' stroke-width='6'/%3E%3Crect x='17' y='48' width='30' height='11' rx='5.5' fill='%2322d3ee'/%3E%3C/svg%3E") !important; filter: drop-shadow(0 0 16px rgba(34,211,238,1)) !important; }
    #pc-auth-app .logo-container::after { content: 'GENESYS V2' !important; color: #e4f8ff !important; font-size: 16px !important; font-weight: 760 !important; letter-spacing: .09em !important; text-shadow: 0 0 18px rgba(34,211,238,.38) !important; }
    #pc-auth-app .auth-form-body { width: min(430px, calc(100vw - 40px)) !important; padding: 30px 32px 28px !important; border: 1px solid rgba(103,232,249,.5) !important; border-radius: 18px !important; background: linear-gradient(145deg, rgba(22,32,48,.94), rgba(7,13,24,.94)) !important; box-shadow: 0 24px 70px rgba(0,0,0,.54), inset 0 1px 0 rgba(255,255,255,.1), 0 0 92px rgba(34,211,238,.34) !important; }
    #pc-auth-app .form-group > label, #pc-auth-app .form-group label, #pc-auth-app .org-name { color: #cbd5e1 !important; font-weight: 650 !important; }
    #pc-auth-app .input-group { border-radius: 9px !important; overflow: hidden !important; background: #0b1422 !important; border: 1px solid #3a536d !important; box-shadow: inset 0 1px 3px rgba(0,0,0,.42) !important; transition: border-color .16s ease, box-shadow .16s ease !important; }
    #pc-auth-app .input-group:focus-within { border-color: #22d3ee !important; box-shadow: 0 0 0 3px rgba(34,211,238,.13), inset 0 1px 3px rgba(0,0,0,.42) !important; }
    #pc-auth-app input.form-control, #pc-auth-app input.form-control:focus { height: 46px !important; color: #eefaff !important; caret-color: #67e8f9 !important; background: #0b1422 !important; border: 0 !important; box-shadow: none !important; }
    #pc-auth-app input.form-control:-webkit-autofill, #pc-auth-app input.form-control:-webkit-autofill:hover, #pc-auth-app input.form-control:-webkit-autofill:focus { -webkit-text-fill-color: #eefaff !important; caret-color: #67e8f9 !important; -webkit-box-shadow: 0 0 0 1000px #0b1422 inset !important; box-shadow: 0 0 0 1000px #0b1422 inset !important; transition: background-color 99999s ease-out 0s !important; }
    #pc-auth-app .input-group-addon, #pc-auth-app .input-group .pc { color: #67e8f9 !important; background: #0b1422 !important; border: 0 !important; }
    #pc-auth-app .btn-login, #pc-auth-app .select-org, #pc-auth-app .auth-form-body .btn.btn-primary { width: 100% !important; min-height: 45px !important; margin-top: 10px !important; border: 1px solid #67e8f9 !important; border-radius: 9px !important; color: #041017 !important; background: linear-gradient(135deg, #67e8f9, #22d3ee) !important; font-weight: 780 !important; box-shadow: 0 8px 22px rgba(34,211,238,.21) !important; transition: transform .16s ease, filter .16s ease, box-shadow .16s ease !important; }
    #pc-auth-app .btn-login:hover, #pc-auth-app .select-org:hover, #pc-auth-app .auth-form-body .btn.btn-primary:hover { transform: translateY(-1px) !important; filter: brightness(1.08) !important; box-shadow: 0 11px 28px rgba(34,211,238,.34) !important; }
    #pc-auth-app .auth-form-assistance a, #pc-auth-app .change-org { color: #67e8f9 !important; }
    #pc-auth-app .org-panel { display: none !important; }
    #pc-auth-app .gbs-login-org-inline { display: flex !important; align-items: center !important; gap: 8px !important; min-width: 0 !important; margin: 11px 0 17px !important; padding: 0 !important; color: #b9cde0 !important; font-size: 13px !important; line-height: 20px !important; }
    #pc-auth-app .gbs-login-org-inline::before { content: '◈' !important; flex: 0 0 auto !important; color: #67e8f9 !important; font-size: 13px !important; text-shadow: 0 0 10px rgba(34,211,238,.5) !important; }
    #pc-auth-app .gbs-login-org-inline .org-name { min-width: 0 !important; overflow: hidden !important; text-overflow: ellipsis !important; white-space: nowrap !important; color: #cbd5e1 !important; font-size: 13px !important; font-weight: 650 !important; }
    #pc-auth-app .gbs-login-org-inline .change-org { flex: 0 0 auto !important; color: #67e8f9 !important; font-size: 13px !important; font-weight: 650 !important; text-decoration: none !important; }
    #pc-auth-app .gbs-login-org-inline .change-org:hover { color: #e0faff !important; text-decoration: underline !important; }
    #pc-auth-app .logon-banner, #pc-auth-app .brand-footer, #pc-auth-app .auth-footer .footer-links { display: none !important; }
    #pc-auth-app .auth-form-footer { margin-top: 18px !important; padding: 0 !important; border: 0 !important; background: transparent !important; text-align: center !important; }
    #pc-auth-app .auth-form-footer a { color: #67e8f9 !important; font-size: 13px !important; text-decoration: none !important; }
    #pc-auth-app .auth-form-footer a:hover { color: #e0faff !important; text-decoration: underline !important; }
    #pc-auth-app .auth-footer { position: absolute !important; z-index: 2 !important; right: 24px !important; bottom: 20px !important; width: auto !important; height: auto !important; padding: 0 !important; background: transparent !important; border: 0 !important; }
    #pc-auth-app .auth-footer .footer-menu { display: none !important; }
    #pc-auth-app .locale-picker { display: flex !important; align-items: center !important; gap: 9px !important; color: #a8bfd0 !important; font-size: 12px !important; }
    #pc-auth-app #languages { position: relative !important; z-index: 3 !important; min-width: 156px !important; height: 34px !important; padding: 0 30px 0 10px !important; appearance: auto !important; pointer-events: auto !important; border: 1px solid #4a718f !important; border-radius: 7px !important; color: #e8f3ff !important; background: #0b1422 !important; box-shadow: inset 0 1px 3px rgba(0,0,0,.35), 0 0 14px rgba(34,211,238,.14) !important; }
    #pc-auth-app #languages:focus { border-color: #22d3ee !important; outline: 0 !important; box-shadow: 0 0 0 3px rgba(34,211,238,.13) !important; }
    @media (max-width: 620px) { #pc-auth-app .auth-chrome-content { padding: 86px 16px 84px !important; } #pc-auth-app .logo-container { top: 20px !important; left: 20px !important; } #pc-auth-app .auth-form-body { padding: 26px 22px 24px !important; } #pc-auth-app .auth-footer { right: 16px !important; bottom: 14px !important; } }
    .gbs-resizing, .gbs-resizing * { user-select: none !important; cursor: col-resize !important; }
    body.gbs-resizing .gbs-sidebar,
    body.gbs-resizing .gbs-sidebar *,
    body.gbs-resizing .main-grid,
    body.gbs-resizing .main-grid * { transition: none !important; }
  `;

  const LIGHT_CSS = `
    html.gbs-light-mode, html.gbs-light-mode body { background: #f4f6f8 !important; color: #1f2937 !important; }
    html.gbs-light-mode .command-bar, html.gbs-light-mode .command-nav,
    html.gbs-light-mode .command-view header, html.gbs-light-mode .secondary-nav-bar,
    html.gbs-light-mode .tabs-container, html.gbs-light-mode .tab-container,
    html.gbs-light-mode .gux-tab-container { background: #f8fafc !important; color: #1f2937 !important; border-color: #cbd5e1 !important; }
    html.gbs-light-mode .command-bar button, html.gbs-light-mode .global-queue,
    html.gbs-light-mode .gbs-theme-toggle, html.gbs-light-mode .gux-tab,
    html.gbs-light-mode .gux-tab-button, html.gbs-light-mode .gux-tab-options-trigger {
      background: #fff !important; color: #334155 !important; border-color: #cbd5e1 !important;
    }
    html.gbs-light-mode .analytics-ui-dashboard-widget-grid, html.gbs-light-mode .parent-grid,
    html.gbs-light-mode .widget-body, html.gbs-light-mode .widget-content,
    html.gbs-light-mode .gbs-sidebar, html.gbs-light-mode .gbs-sidebar .sidebar-widget,
    html.gbs-light-mode .gbs-sidebar .analytics-ui-dashboard-widget-agent-list-display,
    html.gbs-light-mode table.gbs-board { background: #f4f6f8 !important; color: #1f2937 !important; }
    html.gbs-light-mode .analytics-ui-dashboard-widget, html.gbs-light-mode .gbs-summary-card,
    html.gbs-light-mode .command-panel, html.gbs-light-mode .command-panel .heading,
    html.gbs-light-mode .command-panel .toggle-item-container { background: #fff !important; color: #1f2937 !important; border-color: #cbd5e1 !important; }
    html.gbs-light-mode .gbs-summary-title, html.gbs-light-mode .gbs-summary-value,
    html.gbs-light-mode .command-panel *, html.gbs-light-mode table.gbs-board td,
    html.gbs-light-mode table.gbs-board th { color: #1f2937 !important; }
    html.gbs-light-mode .gbs-theme-toggle { background: #e2e8f0 !important; color: #334155 !important; }
    html.gbs-light-mode .dashboard-dark-mode-enabled,
    html.gbs-light-mode .analytics-ui-dashboard-widget,
    html.gbs-light-mode .widget-container, html.gbs-light-mode .widget-header,
    html.gbs-light-mode .widget-body, html.gbs-light-mode .widget-content,
    html.gbs-light-mode .gbs-sidebar, html.gbs-light-mode .gbs-board-area,
    html.gbs-light-mode .gbs-summary-area, html.gbs-light-mode .gbs-summary-row,
    html.gbs-light-mode .panel-container, html.gbs-light-mode .panel-content,
    html.gbs-light-mode .panel-body, html.gbs-light-mode .call-controls-panels,
    html.gbs-light-mode .call-scroll, html.gbs-light-mode .inbox-panel-container,
    html.gbs-light-mode .inbox-panel, html.gbs-light-mode .ib-panelcontent-v2,
    html.gbs-light-mode .inbox-panel-content, html.gbs-light-mode .inbox-listing,
    html.gbs-light-mode .list-scrollable, html.gbs-light-mode .phone-settings-container,
    html.gbs-light-mode .follow-me-settings-container, html.gbs-light-mode .follow-me-settings-panel,
    html.gbs-light-mode .profile-selection-v2, html.gbs-light-mode .station-setting,
    html.gbs-light-mode .current-station, html.gbs-light-mode .device-selection,
    html.gbs-light-mode .dialpad, html.gbs-light-mode .dialpad-numbers-container {
      background: #f4f6f8 !important; color: #1f2937 !important; border-color: #cbd5e1 !important;
    }
    html.gbs-light-mode .gbs-summary-card, html.gbs-light-mode .inbox-row,
    html.gbs-light-mode .inbox-message, html.gbs-light-mode .dropdown-container,
    html.gbs-light-mode .dropdown-menu-view, html.gbs-light-mode .entry-row,
    html.gbs-light-mode .panel-section, html.gbs-light-mode .command-panel .btn:not(.btn-hangup),
    html.gbs-light-mode .command-panel .btn-link, html.gbs-light-mode .dialpad-number,
    html.gbs-light-mode .command-panel .toggle-item-container .toggle-item,
    html.gbs-light-mode .command-panel .toggle-item-container .toggle-item .app-img,
    html.gbs-light-mode .dropdown-menu, html.gbs-light-mode .dropdown-menu li,
    html.gbs-light-mode .dropdown-menu a {
      background: #fff !important; color: #1f2937 !important; border-color: #cbd5e1 !important;
    }
    html.gbs-light-mode input, html.gbs-light-mode textarea, html.gbs-light-mode select,
    html.gbs-light-mode .form-control, html.gbs-light-mode .tags-input,
    html.gbs-light-mode .purecloud-input, html.gbs-light-mode .target-input {
      background: #fff !important; color: #1f2937 !important; border-color: #94a3b8 !important; box-shadow: none !important;
    }
    html.gbs-light-mode .command-panel gux-icon,
    html.gbs-light-mode .toggle-item-container .toggle-item gux-icon { color: #475569 !important; fill: currentColor !important; }
    html.gbs-light-mode .gbs-summary-title, html.gbs-light-mode .gbs-summary-value,
    html.gbs-light-mode .phone-label, html.gbs-light-mode .call-controls-subheader,
    html.gbs-light-mode .file-name, html.gbs-light-mode label,
    html.gbs-light-mode .command-panel h4, html.gbs-light-mode .command-panel h5 {
      color: #1f2937 !important;
    }
  `;

  /* Always-on control styling. Light mode disables every other custom visual rule. */
  const BASE_CSS = `
    body .gbs-sidebar .analytics-ui-dashboard-widget-agent-list-display .gbs-summary-cards .gbs-summary-value,
    body .gbs-sidebar .analytics-ui-dashboard-widget-agent-list-display .gbs-summary-cards .gbs-summary-title { color: #fff !important; }
    /* Let the command-bar surface show through the profile control at every
       viewport instead of retaining Genesys' separate grey tile. */
    .command-bar .command-user-settings,
    .command-bar .command-user-settings-button,
    .command-bar #user-settings-button { background: transparent !important; }
    .avatar-header .user-avatar {
      display: inline-flex !important; align-items: center !important; justify-content: center !important;
      box-sizing: border-box !important; background: transparent !important;
    }
    html.gbs-light-mode .gbs-summary-cards,
    html.gbs-light-mode table.gbs-board .gbs-rank-header,
    html.gbs-light-mode table.gbs-board .gbs-rank-cell { display: none !important; }
    .gbs-theme-toggle-wrap {
      display: inline-flex !important; align-items: center !important; align-self: center !important;
      height: var(--gbs-theme-height, 32px) !important; margin: 0 4px !important; padding: 0 !important;
      line-height: 1 !important; transform: translateY(-2px) !important;
    }
    .gbs-theme-toggle {
      box-sizing: border-box !important; width: var(--gbs-theme-height, 32px) !important;
      min-width: var(--gbs-theme-height, 32px) !important; height: var(--gbs-theme-height, 32px) !important;
      min-height: 0 !important; display: inline-flex !important; align-items: center !important;
      justify-content: center !important; padding: 0 !important; margin: 0 !important;
      border: 1px solid currentColor !important; border-radius: 4px !important; cursor: pointer !important;
      vertical-align: middle !important;
    }
    .gbs-theme-toggle svg { width: 18px !important; height: 18px !important; stroke: currentColor !important; }
  `;

  const SHADOW_CSS = `
    /* Components inherit the surrounding dark surface. A host-level fill here
       creates a visible extra tile for icons, truncates, and other nested UI. */
    :host { color-scheme: dark !important; color: #e5e7eb !important; background: transparent !important; background-color: transparent !important; border-color: #4b596a !important; }
    /* Icons must never create a second tile inside an already styled button. */
    :host([icon-name]) {
      background: transparent !important; background-color: transparent !important;
      border: 0 !important; outline: 0 !important; box-shadow: none !important;
    }
    /* Command-bar components are nested web components. Override the generic
       host/button surface here as well, otherwise their shadow roots recreate
       the unwanted dark square behind the icon. */
    :host-context(.command-bar), :host-context(.command-nav), :host-context(.nav-v2-main) {
      background: transparent !important; background-color: transparent !important;
      box-shadow: none !important;
    }
    :host-context(.command-bar) button,
    :host-context(.command-nav) button,
    :host-context(.nav-v2-main) button {
      background: transparent !important; background-color: transparent !important;
      box-shadow: none !important;
    }
    /* Gux truncate renders its visible wrapper in a shadow root. In profile
       menus that wrapper must inherit the menu-row hover/active surface rather
       than draw an additional dark text tile. */
    :host-context(.user-settings-popover) .gux-truncate-slot-container,
    :host-context(.user-settings-popover) .gux-truncate-slot-container > div,
    :host-context(.user-settings-popover) .gux-truncate-slot-container span {
      background: transparent !important; background-color: transparent !important;
      border-color: transparent !important; box-shadow: none !important; color: inherit !important;
    }
    :host(#command-bar-queue-toggle) {
      background: transparent !important; border: 0 !important; box-shadow: none !important;
    }
    :host(#command-bar-queue-toggle) * {
      opacity: 0 !important; box-shadow: none !important;
    }
    /* The carousel's legacy toolbar is rendered inside its own shadow tree;
       style its actual surface rather than only the host element. */
    :host-context(html.gbs-dark-mode) .app-carousel-togglers,
    :host-context(html.gbs-dark-mode) .app-header,
    :host-context(html.gbs-dark-mode) .app-wrapper-item,
    :host-context(html.gbs-dark-mode) .content,
    :host-context(html.gbs-dark-mode) .app-carousel-toolbar,
    :host-context(html.gbs-dark-mode) .app-carousel-toolbar-container,
    :host-context(html.gbs-dark-mode) .app-carousel-toolbar-container.legacy {
      background: #252b33 !important; color: #e5e7eb !important;
      border-color: #4b596a !important; box-shadow: none !important;
    }
    /* Profile Panel ships hashed CSS-module classes. These prefix selectors
       intentionally survive a rebuilt module hash. */
    :host-context(html.gbs-dark-mode) #root.rootContainer,
    :host-context(html.gbs-dark-mode) #root.rootContainer [class*="searchPage"],
    :host-context(html.gbs-dark-mode) #root.rootContainer [class*="contactCardContainer"],
    :host-context(html.gbs-dark-mode) #root.rootContainer [class*="outerCard"],
    :host-context(html.gbs-dark-mode) #root.rootContainer [class*="cardBody"],
    :host-context(html.gbs-dark-mode) #root.rootContainer [class*="contactMedia"] {
      background: #1d2025 !important; color: #e5e7eb !important;
      border-color: #4b596a !important;
    }
    :host-context(html.gbs-dark-mode) [class*="card"] {
      background-color: #252b33 !important; color: #e5e7eb !important;
      border-color: #4b596a !important; box-shadow: none !important;
    }
    /* Gux Table paints its empty-state canvas inside a Shadow DOM. The outer
       Analytics iframe stylesheet cannot cross that boundary, so darken the
       actual internal table, body, empty-state and pagination components here. */
    :host-context(html.gbs-dark-mode) .gux-table-container,
    :host-context(html.gbs-dark-mode) .gux-table-wrapper,
    :host-context(html.gbs-dark-mode) .gux-table,
    :host-context(html.gbs-dark-mode) .gux-table-body,
    :host-context(html.gbs-dark-mode) .gux-table-empty,
    :host-context(html.gbs-dark-mode) [class*="empty"],
    :host-context(html.gbs-dark-mode) [class*="no-data"],
    :host-context(html.gbs-dark-mode) [class*="noData"],
    :host-context(html.gbs-dark-mode) table,
    :host-context(html.gbs-dark-mode) tbody,
    :host-context(html.gbs-dark-mode) tr,
    :host-context(html.gbs-dark-mode) td {
      background: #1d2025 !important; background-color: #1d2025 !important;
      color: #e5e7eb !important; border-color: #3a4655 !important;
    }
    :host-context(html.gbs-dark-mode) th,
    :host-context(html.gbs-dark-mode) thead {
      background: #252b33 !important; background-color: #252b33 !important;
      color: #f8fafc !important; border-color: #4b596a !important;
    }
    :host-context(.analytics-ui-gux-table) button.gux-ghost[aria-label="Deactivate"],
    :host-context(.analytics-ui-gux-table) button.gux-ghost[aria-label="Activate"] {
      background: color-mix(in srgb, #22d3ee 8%, #1d2025) !important;
      color: #a5f3fc !important; border: 1px solid #22d3ee !important;
      border-radius: 5px !important; box-shadow: 0 0 7px rgba(34,211,238,.22) !important;
    }
    :host-context(.analytics-ui-gux-table) button.gux-ghost[aria-label="Deactivate"]:hover,
    :host-context(.analytics-ui-gux-table) button.gux-ghost[aria-label="Activate"]:hover {
      background: color-mix(in srgb, #22d3ee 17%, #1d2025) !important; color: #ecfeff !important;
    }
    :host-context(.analytics-ui-gux-table) .gux-tooltip,
    :host-context(.analytics-ui-gux-table) [role="tooltip"] { display: none !important; visibility: hidden !important; }
    :host-context(html.gbs-dark-mode) h1,
    :host-context(html.gbs-dark-mode) h2,
    :host-context(html.gbs-dark-mode) h3,
    :host-context(html.gbs-dark-mode) h4,
    :host-context(html.gbs-dark-mode) label,
    :host-context(html.gbs-dark-mode) p,
    :host-context(html.gbs-dark-mode) span { color: #e5e7eb !important; }
    .gux-input, .gux-input-container, .gux-input-and-error-container {
      background: #171b20 !important; color: #f8fafc !important; border-color: #4b596a !important;
    }
    .gux-input-container {
      border: 1px solid #4b596a !important; outline: 0 !important; box-shadow: none !important;
    }
    @media (max-width: 2100px) {
      /* MEDIUM and below: the search is a compact 24px control including its
         visible focus border, rather than keeping Genesys' native 32px field. */
      :host-context(.global-search-narrow-view) .gux-form-field-container { height: 24px !important; min-height: 24px !important; }
      :host-context(.global-search-narrow-view) .gux-form-field-label {
        box-sizing: border-box !important; height: 0 !important; min-height: 0 !important; padding: 0 !important;
      }
      :host-context(.global-search-narrow-view) .gux-input-and-error-container,
      :host-context(.global-search-narrow-view) .gux-input,
      :host-context(.global-search-narrow-view) .gux-input-container {
        box-sizing: border-box !important; height: 24px !important; min-height: 24px !important;
      }
      :host-context(.global-search-narrow-view) .gux-input-container { padding: 3px 8px !important; }
    }
    .gux-input-container input, ::slotted(input), ::slotted(textarea) {
      background: transparent !important; color: #f8fafc !important; border: 0 !important; outline: 0 !important; box-shadow: none !important;
    }
    .gux-input-container:focus-within { border-color: #7897ea !important; box-shadow: none !important; }
    @media (max-width: 1040px) {
      :host-context(.global-search-narrow-view) .gux-input-container {
        border: 1px solid #4b596a !important; outline: 0 !important; box-shadow: none !important;
      }
      :host-context(.global-search-narrow-view) .gux-input-container:focus-within {
        border: 1px solid #7897ea !important; outline: 0 !important; box-shadow: none !important;
      }
    }
    .gux-input-container gux-icon { color: #94a3b8 !important; }
    /* The established custom ring layout. The status variable changes colour,
       never its geometry. */
    :host-context(#user-settings-button) .gux-avatar.gux-ring,
    :host-context(.avatar-header) .gux-avatar.gux-ring,
    :host-context(.user-avatar) .gux-avatar.gux-ring,
    :host([slot="avatar"]) .gux-avatar.gux-ring {
      background: transparent !important;
      border: 0 !important;
      outline: 0 !important;
      box-shadow: none !important;
    }
    :host-context(#user-settings-button) .gux-content,
    :host-context(.avatar-header) .gux-content,
    :host-context(.user-avatar) .gux-content,
    :host([slot="avatar"]) .gux-content {
      border: 3px solid var(--gbs-my-status-color, #64748b) !important;
      box-shadow: inset 0 0 0 1px #fff !important;
    }
    :host-context(#user-settings-button) .gux-content { border-width: 2px !important; }
    :host-context(#user-settings-button) .gux-avatar-badge,
    :host-context(.avatar-header) .gux-avatar-badge,
    :host-context(.user-avatar) .gux-avatar-badge,
    :host([slot="avatar"]) .gux-avatar-badge {
      display: none !important; visibility: hidden !important;
    }
    /* The native busy slash is redundant once the badge itself carries the
       status colour, and otherwise paints an unrelated icon over the avatar. */
    :host-context(#user-settings-button) .gux-avatar-badge .gux-icon-container,
    :host-context(.avatar-header) .gux-avatar-badge .gux-icon-container,
    :host-context(.user-avatar) .gux-avatar-badge .gux-icon-container,
    :host([slot="avatar"]) .gux-avatar-badge .gux-icon-container {
      display: none !important; visibility: hidden !important;
    }
    :host-context(.avatar-header) .gux-avatar.gux-large,
    :host-context(.user-avatar) .gux-avatar.gux-large,
    :host([slot="avatar"]) .gux-avatar.gux-large {
      width: 72px !important; min-width: 72px !important; height: 72px !important; min-height: 72px !important;
    }
    :host-context(.avatar-header) .gux-avatar.gux-large .gux-content,
    :host-context(.user-avatar) .gux-avatar.gux-large .gux-content,
    :host([slot="avatar"]) .gux-avatar.gux-large .gux-content {
      width: 68px !important; min-width: 68px !important; height: 68px !important; min-height: 68px !important;
      border-width: 4px !important; box-shadow: inset 0 0 0 1px #fff !important;
    }
    :host-context(.avatar-header) .gux-avatar-badge.gux-large,
    :host-context(.user-avatar) .gux-avatar-badge.gux-large,
    :host([slot="avatar"]) .gux-avatar-badge.gux-large {
      display: none !important; visibility: hidden !important;
    }
    :host-context(.avatar-header) .gux-avatar-badge.gux-large gux-icon,
    :host-context(.user-avatar) .gux-avatar-badge.gux-large gux-icon,
    :host([slot="avatar"]) .gux-avatar-badge.gux-large gux-icon {
      width: 12px !important; min-width: 12px !important; height: 12px !important; min-height: 12px !important;
      color: #fff !important;
    }
    @media (max-width: 2100px) {
      :host-context(#user-settings-button) .gux-avatar {
        width: 28px !important; min-width: 28px !important; height: 28px !important; min-height: 28px !important;
      }
      :host-context(#user-settings-button) .gux-content {
        width: 24px !important; min-width: 24px !important; height: 24px !important; min-height: 24px !important;
      }
    }
    svg, svg path { fill: currentColor !important; }
    :host([icon-name="fa/plus-regular"]) { color: inherit !important; background: transparent !important; }
    :host([icon-name="fa/plus-regular"]) .gux-icon-container svg,
    :host([icon-name="fa/plus-regular"]) .gux-icon-container svg path {
      fill: currentColor !important; color: currentColor !important;
    }
    .gux-container, .gux-content, .gux-calendar, .gux-calendar-container,
    .gux-month, .gux-month-header, .gux-weekdays, .gux-days,
    .gux-time-picker, .gux-time-zone-picker, .gux-listbox,
    .gux-accordion, .gux-accordion-container, .gux-accordion-section,
    .gux-accordion-section-header, .gux-accordion-section-content,
    .gux-dropdown, .gux-pagination, .gux-pagination-container,
    .gux-pagination-info, .gux-pagination-change, .gux-pagination-spacer,
    .gux-pagination-item-counts-container, .gux-pagination-buttons-container,
    .gux-pagination-buttons-group, .gux-pagination-buttons-list-container,
    .gux-table, table, thead, tbody, tr, th, td {
      background: #252b33 !important; color: #e5e7eb !important; border-color: #3a4655 !important;
    }
    .gux-day, [role="gridcell"], [role="option"], option {
      background: #252b33 !important; color: #e5e7eb !important; border-color: #4b596a !important;
    }
    .gux-day:hover, [role="gridcell"]:hover, [role="option"]:hover {
      background: #343d49 !important; color: #fff !important;
    }
    /* The board table's actual backdrop is inside the gux-table shadow root. */
    .gux-table, .gux-table-container { background: #1d2025 !important; }
    :host(.analytics-ui-gux-table),
    :host(.analytics-ui-gux-table) .gux-table,
    :host(.analytics-ui-gux-table) .gux-table-container,
    :host(.analytics-ui-gux-table) table { background: transparent !important; }
    :host(.analytics-ui-gux-table) .gux-table,
    :host(.analytics-ui-gux-table) .gux-table-container { overflow-x: hidden !important; }
    .gux-tabs, .gux-tab-list, .gux-tab-container, .gux-tab, .gux-buttons,
    .gux-tab-options, .gux-dropdown-options, [role="tab"], button {
      background: #252b33 !important; color: #e5e7eb !important; border-color: #3a4655 !important;
    }
    .gux-tab { border-right: 1px solid #3a4655 !important; border-bottom: 2px solid transparent !important; background-image: none !important; }
    .gux-tab::after, .gux-buttons::after { content: none !important; display: none !important; background: transparent !important; }
    .gux-tab-button, .gux-tab-options-trigger, .gux-tab-button-text, .gux-title-container,
    .tab-name, gux-tooltip-title, gux-icon {
      background: transparent !important; color: #e5e7eb !important; border-color: #4b596a !important;
    }
    .gux-tab.gux-selected, .gux-tab.gux-selected .gux-tab-button,
    .gux-tab.gux-selected .gux-tab-options, .gux-tab.gux-selected .gux-tab-options-trigger,
    .gux-tab:has(.gux-tab-button[aria-selected="true"]),
    .gux-tab:has(.gux-tab-button[aria-selected="true"]) .gux-buttons,
    .gux-tab:has(.gux-tab-button[aria-selected="true"]) .gux-tab-options-trigger {
      background: #3b4655 !important; color: #fff !important;
    }
    .gux-tab.gux-selected,
    .gux-tab:has(.gux-tab-button[aria-selected="true"]) {
      border-bottom-color: transparent !important;
    }
    .gux-tab:hover {
      border-bottom-color: transparent !important;
    }
    .gux-tab.gux-selected .gux-tab-button,
    .gux-tab:has(.gux-tab-button[aria-selected="true"]) .gux-tab-button { box-shadow: none !important; }
    .gux-tab-options, .gux-tab-options-trigger {
      box-shadow: none !important; border-bottom-color: #3a4655 !important; border-radius: 0 !important;
    }
    .gux-divider { background: #4b596a !important; border-color: #4b596a !important; }
    [aria-label*="Create"], .gux-add-tab-button, .gux-tab-add-button { color: #22d3ee !important; }
    .gux-dropdown-options-container, .gux-list, .gux-list-item, .gux-tooltip, .gux-tooltip-content,
    [role="menu"], [role="menuitem"], [role="tooltip"] {
      background: #252b33 !important; color: #f1f5f9 !important; border-color: #4b596a !important;
    }
    .gux-dropdown-options-container::before, .gux-dropdown-options-container::after {
      background: #252b33 !important; border-color: #4b596a !important;
    }
    .gux-list-item:hover, [role="menuitem"]:hover { background: #343d49 !important; color: #fff !important; }
    .gux-modal-container, .gux-modal-content, .gux-button-footer,
    .gux-start-align-buttons, .gux-end-align-buttons {
      background: #1d2025 !important; color: #e5e7eb !important; border-color: #4b596a !important;
    }
    .gux-modal-container { border: 1px solid #4b596a !important; box-shadow: 0 20px 50px rgba(0,0,0,.55) !important; }
    .gux-button-footer { border-top: 1px solid #3a4655 !important; }
    /* Native dialog backdrop belongs to the modal shadow root, not the modal
       container. Keep it translucent so the underlying workspace is visible. */
    :host dialog::backdrop, dialog::backdrop {
      background: rgba(15, 23, 42, .68) !important;
    }
    .gux-tab[aria-selected="true"], [role="tab"][aria-selected="true"], button[aria-selected="true"] {
      background: #343d49 !important; color: #fff !important;
    }
    :host(.gbs-light-mode) { color-scheme: light !important; color: #1f2937 !important; }
    :host(.gbs-light-mode) .gux-input, :host(.gbs-light-mode) .gux-input-container,
    :host(.gbs-light-mode) .gux-input-and-error-container,
    :host(.gbs-light-mode) .gux-tabs, :host(.gbs-light-mode) .gux-tab-list,
    :host(.gbs-light-mode) .gux-tab-container, :host(.gbs-light-mode) .gux-tab,
    :host(.gbs-light-mode) .gux-buttons, :host(.gbs-light-mode) .gux-tab-options,
    :host(.gbs-light-mode) .gux-dropdown-options, :host(.gbs-light-mode) [role="tab"],
    :host(.gbs-light-mode) button, :host(.gbs-light-mode) .gux-dropdown-options-container,
    :host(.gbs-light-mode) .gux-popover, :host(.gbs-light-mode) .gux-popover-container,
    :host(.gbs-light-mode) .gux-list, :host(.gbs-light-mode) .gux-list-item,
    :host(.gbs-light-mode) [role="menu"], :host(.gbs-light-mode) [role="menuitem"],
    :host(.gbs-light-mode) .gux-modal-container, :host(.gbs-light-mode) .gux-modal-content,
    :host(.gbs-light-mode) .gux-button-footer {
      background: #fff !important; color: #1f2937 !important; border-color: #cbd5e1 !important;
    }
    :host(.gbs-light-mode) .gux-input-container input,
    :host(.gbs-light-mode) ::slotted(input), :host(.gbs-light-mode) ::slotted(textarea) {
      color: #1f2937 !important;
    }
  `;

  /* Kept deliberately small: popovers own their surface and positioning rules. */
  const POPOVER_SHADOW_CSS = `
    .gux-popover-wrapper {
      background: #252b33 !important; border: 1px solid #7c8da3 !important;
      border-radius: 6px !important; z-index: 2147483647 !important;
      color: #e5e7eb !important;
      box-shadow: 0 12px 28px rgba(0,0,0,.42), 0 0 0 1px rgba(148,163,184,.08) !important;
    }
    .gux-popover-content, [role="menu"], [role="listbox"] { background: transparent !important; color: #e5e7eb !important; }
    .gux-arrow { background: transparent !important; }
    .gux-arrow-caret {
      background: #252b33 !important; border-color: #7c8da3 !important;
    }
  `;

  function timeInSeconds(text) {
    let total = 0;
    const value = (text || '').trim();
    const colon = value.match(/^(\d+):(\d{2})(?::(\d{2}))?$/);
    if (colon) return colon[3]
      ? Number(colon[1]) * 3600 + Number(colon[2]) * 60 + Number(colon[3])
      : Number(colon[1]) * 60 + Number(colon[2]);
    const hours = value.match(/(\d+)\s*h/i);
    const minutes = value.match(/(\d+)\s*m/i);
    const seconds = value.match(/(\d+)\s*s/i);
    if (hours) total += Number(hours[1]) * 3600;
    if (minutes) total += Number(minutes[1]) * 60;
    if (seconds) total += Number(seconds[1]);
    return total;
  }

  function statusKey(text) {
    const key = (text || '').trim().toLowerCase().replace(/\s+/g, '-');
    return key === 'in-call' ? 'interacting' : key;
  }

  function statusRank(text) {
    const key = (text || '').trim().toLowerCase().replace(/^in call$/, 'interacting');
    return STATUS_RANK.has(key) ? STATUS_RANK.get(key) : STATUS_ORDER.length;
  }

  function isAgentBoard(table) {
    const headers = Array.from(table.querySelectorAll('thead th[data-column-name]'));
    const names = new Set(headers.map(header => header.dataset.columnName));
    return names.has('agent') && names.has('timeInStatus') && names.has('status');
  }

  function componentLoader(target, kind) {
    if (!target?.isConnected) return null;
    let loader = target.querySelector(':scope > .gbs-component-loader');
    if (!loader) {
      loader = target.ownerDocument.createElement('div');
      loader.className = 'gbs-component-loader';
      loader.setAttribute('aria-live', 'polite');
      loader.setAttribute('aria-label', `Loading ${kind}`);
      loader.innerHTML = `<span class="gbs-component-loader-spinner" aria-hidden="true"></span><span class="gbs-component-loader-label">Loading ${kind}</span>`;
      target.appendChild(loader);
    }
    return loader;
  }

  function beginComponentLoad(target, kind) {
    if (!target?.isConnected || target.classList.contains('gbs-component-loading')) return;
    componentLoader(target, kind);
    target.dataset.gbsComponentKind = kind;
    target.removeAttribute('data-gbs-component-ready');
    target.setAttribute('aria-busy', 'true');
    target.classList.add('gbs-component-loading');
  }

  function finishComponentLoad(target, settleFrames = 1) {
    if (!target?.isConnected || !target.classList.contains('gbs-component-loading')) return;
    // Frames let enhanced classes and inline geometry paint behind the overlay
    // before it fades, rather than revealing one native-layout frame.
    const view = target.ownerDocument.defaultView;
    if (target.__gbsLoaderFinishFrame) view.cancelAnimationFrame(target.__gbsLoaderFinishFrame);
    let remainingFrames = Math.max(1, settleFrames);
    const settle = () => {
      target.__gbsLoaderFinishFrame = 0;
      remainingFrames -= 1;
      if (remainingFrames > 0) {
        target.__gbsLoaderFinishFrame = view.requestAnimationFrame(settle);
        return;
      }
      target.classList.remove('gbs-component-loading');
      target.dataset.gbsComponentReady = 'true';
      target.removeAttribute('aria-busy');
      try {
        if (window.top !== window) {
          window.top.postMessage({
            type: 'gbs-startup-component-ready',
            kind: target.dataset.gbsComponentKind
          }, location.origin);
        }
      } catch (_) {}
      // This lifecycle point occurs only after Board layout and its scroll
      // viewport are settled. The top-level startup screen can safely reveal
      // the iframe now without trying to observe its high-volume DOM churn.
      if (target.dataset.gbsComponentKind === 'Board') {
        window.__gbsStartupEmbeddedBoardReady = true;
      }
    };
    target.__gbsLoaderFinishFrame = view.requestAnimationFrame(settle);
  }

  function finishReadyComponentLoads(doc) {
    const dashboard = doc.querySelector('.main-grid.gbs-component-loading');
    if (dashboard && dashboard.querySelector('.analytics-ui-dashboard-widget, .widget-container .js-draggableObject')) {
      finishComponentLoad(dashboard);
    }
    const board = doc.querySelector('.grid-sidebar.gbs-component-loading, .gbs-sidebar.gbs-component-loading');
    const boardTable = board?.querySelector('table.gbs-board');
    if (!boardTable) return;
    const wrapper = boardTable.closest('.table-wrapper');
    const shadowViewport = wrapper?.querySelector('gux-table')?.shadowRoot?.querySelector('.gux-table-container');
    if (!wrapper || !shadowViewport) {
      // Gux hydrates its scroll viewport just after it inserts the table. Probe
      // briefly at animation-frame speed, instead of leaving the final layout
      // correction to the normal one-second maintenance cycle.
      const probes = Number(board.dataset.gbsLoaderProbeCount || 0);
      if (probes < 18) {
        board.dataset.gbsLoaderProbeCount = String(probes + 1);
        scheduleComponentRender(doc);
      }
      return;
    }
    delete board.dataset.gbsLoaderProbeCount;
    applyResponsiveBoardColumns(boardTable);
    // The first frame applies the scroll-safe width; the second confirms the
    // browser's table layout has used it before the overlay fades.
    finishComponentLoad(board, 2);
  }

  function scheduleComponentRender(doc) {
    if (doc.__gbsComponentRenderFrame) return;
    doc.__gbsComponentRenderFrame = doc.defaultView.requestAnimationFrame(() => {
      doc.__gbsComponentRenderFrame = 0;
      sortDocument(doc);
    });
  }

  function ensureComponentLoadMonitor(doc) {
    if (!doc.body || doc.__gbsComponentLoadMonitor) return;
    const findMatches = (node, selector) => {
      if (node.nodeType !== 1) return [];
      return [node.matches?.(selector) ? node : null, ...node.querySelectorAll?.(selector) || []].filter(Boolean);
    };
    const observer = new doc.defaultView.MutationObserver(mutations => {
      let shouldRender = false;
      mutations.forEach(mutation => {
        if (mutation.type !== 'childList') return;
        mutation.removedNodes.forEach(node => {
          if (findMatches(node, '.main-grid').length) doc.__gbsDashboardAwaitingMount = true;
          if (findMatches(node, '.grid-sidebar, .gbs-sidebar').length) doc.__gbsBoardAwaitingMount = true;
          const dashboard = mutation.target.nodeType === 1 ? mutation.target.closest?.('.main-grid') : null;
          const board = mutation.target.nodeType === 1 ? mutation.target.closest?.('.grid-sidebar, .gbs-sidebar') : null;
          if (dashboard && !dashboard.querySelector('.analytics-ui-dashboard-widget')) beginComponentLoad(dashboard, 'Dashboard');
          if (board && !board.querySelector('table')) beginComponentLoad(board, 'Board');
        });
        mutation.addedNodes.forEach(node => {
          const dashboards = findMatches(node, '.main-grid');
          const boards = findMatches(node, '.grid-sidebar, .gbs-sidebar');
          dashboards.forEach(dashboard => {
            if (dashboard.dataset.gbsComponentReady !== 'true' || doc.__gbsDashboardAwaitingMount) beginComponentLoad(dashboard, 'Dashboard');
            shouldRender = true;
          });
          boards.forEach(board => {
            if (board.dataset.gbsComponentReady !== 'true' || doc.__gbsBoardAwaitingMount) beginComponentLoad(board, 'Board');
            shouldRender = true;
          });
          const dashboard = node.nodeType === 1 ? node.closest?.('.main-grid') : null;
          const board = node.nodeType === 1 ? node.closest?.('.grid-sidebar, .gbs-sidebar') : null;
          if (dashboard?.classList.contains('gbs-component-loading') || board?.classList.contains('gbs-component-loading')) shouldRender = true;
        });
      });
      if (shouldRender) {
        doc.__gbsDashboardAwaitingMount = false;
        doc.__gbsBoardAwaitingMount = false;
        scheduleComponentRender(doc);
      }
    });
    observer.observe(doc.body, { childList: true, subtree: true });
    doc.__gbsComponentLoadMonitor = observer;
    const dashboard = doc.querySelector('.main-grid');
    const board = doc.querySelector('.grid-sidebar, .gbs-sidebar');
    if (dashboard && dashboard.dataset.gbsComponentReady !== 'true') beginComponentLoad(dashboard, 'Dashboard');
    if (board && board.dataset.gbsComponentReady !== 'true') beginComponentLoad(board, 'Board');
  }

  function injectStyles(doc) {
    // login.mypurecloud.de rejects ordinary inline <style> elements through
    // its CSP. Tampermonkey's managed insertion is CSP-safe and keeps this
    // login-only theme separate from the authenticated app's page-context CSS.
    if (doc === document && location.hostname === 'login.mypurecloud.de' && typeof GM_addStyle === 'function') {
      if (!doc.__gbsLoginStyleInjected) {
        GM_addStyle(CSS);
        doc.__gbsLoginStyleInjected = true;
      }
      return;
    }
    if (!doc.getElementById(STYLE_ID)) {
      const style = doc.createElement('style');
      style.id = STYLE_ID;
      style.textContent = CSS;
      (doc.head || doc.documentElement).appendChild(style);
    }
    if (!doc.getElementById(LIGHT_STYLE_ID)) {
      const lightStyle = doc.createElement('style');
      lightStyle.id = LIGHT_STYLE_ID;
      lightStyle.textContent = BASE_CSS;
      (doc.head || doc.documentElement).appendChild(lightStyle);
    }
  }

  function installLoginOrganizationLayout(doc) {
    const moveOrganization = () => {
      const panel = doc.querySelector('#pc-auth-app .org-panel');
      const regionControl = doc.querySelector('#pc-auth-app .region-switcher-control');
      if (!panel || !regionControl || doc.querySelector('#pc-auth-app .gbs-login-org-inline')) return false;
      const orgName = panel.querySelector('.org-name');
      const changeLink = panel.querySelector('.change-org');
      if (!orgName && !changeLink) return false;
      const inline = doc.createElement('div');
      inline.className = 'gbs-login-org-inline';
      inline.title = orgName?.textContent.trim() || '';
      if (orgName) inline.appendChild(orgName);
      if (changeLink) inline.appendChild(changeLink);
      regionControl.after(inline);
      panel.remove();
      return true;
    };
    if (moveOrganization()) return;
    const observer = new doc.defaultView.MutationObserver(() => {
      if (!moveOrganization()) return;
      observer.disconnect();
    });
    const begin = () => observer.observe(doc.body, { childList: true, subtree: true });
    if (doc.body) begin(); else doc.addEventListener('DOMContentLoaded', begin, { once: true });
    // Ember normally renders this immediately; this simply prevents keeping a
    // login-only observer alive if a tenant renders a different flow.
    doc.defaultView.setTimeout(() => observer.disconnect(), 12000);
  }

  function installLoginSpaceScene(doc) {
    const mount = () => {
      const app = doc.querySelector('#pc-auth-app');
      if (!app || app.querySelector('.gbs-login-shooting-stars')) return false;
      const stars = doc.createElement('div');
      stars.className = 'gbs-login-shooting-stars';
      stars.setAttribute('aria-hidden', 'true');
      stars.innerHTML = '<i></i><i></i><i></i>';
      app.prepend(stars);
      return true;
    };
    if (mount()) return;
    const observer = new doc.defaultView.MutationObserver(() => {
      if (!mount()) return;
      observer.disconnect();
    });
    const begin = () => observer.observe(doc.body, { childList: true, subtree: true });
    if (doc.body) begin(); else doc.addEventListener('DOMContentLoaded', begin, { once: true });
    doc.defaultView.setTimeout(() => observer.disconnect(), 12000);
  }

  function installLoginBrandLayout(doc) {
    const moveBrand = () => {
      const logo = doc.querySelector('#pc-auth-app .logo-container');
      const form = doc.querySelector('#pc-auth-app .auth-form-body');
      if (!logo || !form || logo.parentElement === form) return Boolean(logo && form);
      form.prepend(logo);
      return true;
    };
    if (moveBrand()) return;
    const observer = new doc.defaultView.MutationObserver(() => {
      if (!moveBrand()) return;
      observer.disconnect();
    });
    const begin = () => observer.observe(doc.body, { childList: true, subtree: true });
    if (doc.body) begin(); else doc.addEventListener('DOMContentLoaded', begin, { once: true });
    doc.defaultView.setTimeout(() => observer.disconnect(), 12000);
  }

  function themeMode(doc) {
    try { return doc.defaultView.localStorage.getItem(THEME_KEY) || 'dark'; } catch (_) { return 'dark'; }
  }

  function savedStatusColors(doc) {
    try {
      const parsed = JSON.parse(doc.defaultView.localStorage.getItem(STATUS_COLOR_SETTINGS_KEY) || '{}');
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (_) { return {}; }
  }

  function applyStatusColorOverrides(doc, overrides = doc.__gbsStatusColorDraft || savedStatusColors(doc)) {
    if (themeMode(doc) === 'light') return;
    const rootStyle = doc.documentElement.style;
    Object.entries(STATUS_DEFINITIONS).forEach(([key, definition]) => {
      rootStyle.setProperty(`--gbs-status-${key}`, overrides[definition.group] || definition.color);
    });
    // The command-bar/profile avatar has its own published variable. Refresh
    // it inside the same synchronous palette update rather than waiting for
    // the next maintenance tick.
    const myKey = profileStatusKey(doc);
    const myColor = myKey === 'on-queue'
      ? boardStatusColorForAgent(doc, currentAgentName(doc)) || resolvedStatusColor(doc, myKey)
      : resolvedStatusColor(doc, myKey);
    rootStyle.setProperty('--gbs-my-status-color', myColor);
    try { doc.defaultView.top.__gbsCurrentProfileStatusColor = myColor; } catch (_) { /* cross-origin parent */ }
  }

  function settingsIcon() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"/><circle cx="12" cy="12" r="3"/></svg>';
  }

  function closeSettings(doc) {
    doc.querySelector('.gbs-settings-popover')?.setAttribute('hidden', '');
    doc.querySelector('.gbs-settings-backdrop')?.setAttribute('hidden', '');
    delete doc.__gbsStatusColorDraft;
    applyStatusColorOverrides(doc);
  }

  function ensureSettingsStyle(doc) {
    if (doc.getElementById('gbs-settings-ui-style')) return;
    const style = doc.createElement('style');
    style.id = 'gbs-settings-ui-style';
    style.textContent = `
      .gbs-settings-backdrop {position:fixed;inset:0;z-index:2147483646!important;background:rgba(14,20,25,.72)}
      body:has(>.gbs-settings-backdrop:not([hidden])) > :not(.gbs-settings-backdrop):not(.gbs-settings-popover):not(#gbs-official-update-notice){isolation:isolate;z-index:0!important}
      body>.gbs-settings-popover{z-index:2147483647!important}
      .gbs-board-preview table.gbs-board tbody td{transition:height 120ms ease,min-height 120ms ease,padding 120ms ease,background-color 120ms ease!important}
      .gbs-settings-backdrop[hidden],.gbs-settings-popover[hidden]{display:none!important}
      .gbs-settings-popover {position:fixed!important;z-index:2147483640!important;left:50%!important;top:50%!important;transform:translate(-50%,-50%)!important;width:min(720px,calc(100vw - 32px))!important;max-height:calc(100dvh - 40px)!important;display:flex!important;flex-direction:column!important;overflow:hidden!important;box-sizing:border-box!important;background:#202a30!important;color:#e2f5f7!important;border:1px solid #328c9b!important;border-radius:16px!important;box-shadow:0 20px 70px #0008,0 0 28px #22d3ee30!important}
      .gbs-settings-head{display:flex!important;align-items:center!important;gap:10px!important;padding:18px!important;border-bottom:1px solid #327280!important;font-size:18px!important}
      .gbs-settings-title-icon{display:inline-flex;color:#22d3ee}.gbs-settings-title-icon svg{width:24px;height:24px}
      .gbs-theme-toggle-wrap{position:relative!important;overflow:visible!important}
      .gbs-update-badge{position:absolute!important;right:-5px!important;top:-5px!important;display:flex!important;align-items:center!important;justify-content:center!important;width:16px!important;height:16px!important;border-radius:50%!important;background:#22d3ee!important;color:#102127!important;border:1px solid #102127!important;font:700 11px/1 system-ui!important;pointer-events:none!important;z-index:2!important;box-shadow:0 0 7px #22d3ee55!important}
      .gbs-settings-update-link{display:flex;align-items:center;justify-content:center;gap:8px;padding:10px 14px;border:1px solid #22d3ee;border-radius:7px;background:#25282d;color:#a5f3fc;text-decoration:none;font-size:14px;transition:background .15s,color .15s}.gbs-settings-update-link:hover{background:#0891b2;color:#fff}.gbs-settings-update-link svg{width:24px;height:24px;flex:none}.gbs-settings-popover[data-gbs-settings-page="home"] .gbs-settings-footer{flex-wrap:wrap}
      .gbs-settings-popover .gbs-settings-body>a.gbs-settings-update-link{box-sizing:border-box;width:100%;min-height:64px;margin:0 0 18px;padding:16px 22px;font-size:17px;font-weight:600;gap:12px;color:#a5f3fc!important;border-color:#22d3ee!important;background:#25282d!important;text-decoration:none!important;box-shadow:0 0 12px #22d3ee25}
      .gbs-settings-popover .gbs-settings-body>a.gbs-settings-update-link svg,.gbs-settings-popover .gbs-settings-body>a.gbs-settings-update-link span{color:inherit!important;stroke:currentColor}
      .gbs-settings-popover .gbs-settings-body>a.gbs-settings-update-link:hover{background:#22d3ee!important;color:#fff!important}
      .gbs-settings-popover .gbs-settings-update-link>.gbs-update-link-badge{display:inline-flex;align-items:center;justify-content:center;flex:none;width:22px;height:22px;border-radius:50%;background:#22d3ee!important;color:#102127!important;font:700 12px/1 system-ui;border:1px solid #102127;box-shadow:0 0 7px #22d3ee55}
      .gbs-settings-popover .gbs-settings-body>a.gbs-settings-update-link>span.gbs-update-link-badge{color:#000!important;-webkit-text-fill-color:#000!important;text-shadow:none!important}
      .gbs-settings-popover .gbs-current-agent-badge{display:inline-flex;align-items:center;justify-content:center;padding:1px 5px;min-height:18px;box-sizing:border-box;border:1px solid var(--gbs-status);border-radius:4px;background:color-mix(in srgb,var(--gbs-status) 12%,#1d2025);color:var(--gbs-status)!important;font-size:11px!important;font-weight:800;line-height:16px!important;letter-spacing:.04em;white-space:nowrap;box-shadow:0 0 3px color-mix(in srgb,var(--gbs-status) 52%,transparent);text-shadow:0 0 3px color-mix(in srgb,var(--gbs-status) 62%,#fff)}
      .gbs-settings-body{padding:18px!important;overflow:auto!important;min-height:0!important;flex:1!important}
      .gbs-settings-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}
      .gbs-settings-tile{min-width:0;min-height:170px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:22px;padding:20px 8px;background:#26373e!important;color:#82acb4!important;border:1px solid #397382!important;border-radius:12px;cursor:pointer;transition:box-shadow .22s,border-color .22s,background .22s}
      .gbs-settings-tile:hover,.gbs-settings-tile:focus-visible{border-color:#22d3ee!important;box-shadow:0 0 18px #22d3ee48,inset 0 0 12px #22d3ee12;outline:none}
      .gbs-settings-tile>svg,.gbs-power-icons{width:46px;height:46px;flex:none}.gbs-settings-tile>span:last-child{font-size:14px;text-align:center;font-weight:600}
      .gbs-power-icons{position:relative;display:block}.gbs-power-icons svg{position:absolute;inset:0;width:46px;height:46px;color:#849ba3;transition:opacity .18s,color .18s,filter .18s}
      .gbs-power-on{opacity:0;filter:none}.gbs-power-off{opacity:1}.gbs-settings-tile.is-on .gbs-power-on{opacity:1;color:#22d3ee;filter:drop-shadow(0 0 4px #22d3ee) drop-shadow(0 0 10px #22d3ee88)}.gbs-settings-tile.is-on .gbs-power-off{opacity:0}
      .gbs-settings-tile.power-unglow .gbs-power-on{filter:none}.gbs-settings-tile.power-grey .gbs-power-on{color:#849ba3;filter:none}.gbs-settings-tile.power-crossfade .gbs-power-on{opacity:0}.gbs-settings-tile.power-crossfade .gbs-power-off{opacity:1}
      .gbs-settings-close,.gbs-settings-back,.gbs-settings-footer button,.gbs-status-custom,.gbs-status-reset{background:#283b43!important;color:#b6e8ef!important;border:1px solid #398797!important;border-radius:7px!important;cursor:pointer}.gbs-settings-close{margin-left:auto!important;width:30px;height:30px}.gbs-settings-back{width:30px!important;height:30px!important}.gbs-settings-back svg{width:24px!important;height:24px!important}
      .gbs-settings-footer{border-top:1px solid #327280!important}.gbs-settings-footer .gbs-settings-save{background:#225763!important;border-color:#22d3ee!important}.gbs-status-setting-row{border-color:#397382!important;background:#1c282e!important}
      .gbs-settings-grid .gbs-settings-tile{aspect-ratio:1;min-height:0;padding:18px 10px;gap:24px}.gbs-settings-grid .gbs-settings-tile>svg,.gbs-settings-grid .gbs-power-icons{width:58px;height:58px}.gbs-settings-grid .gbs-power-icons svg{width:58px;height:58px}.gbs-settings-grid .gbs-settings-tile>span:last-child{font-size:16px}
      .gbs-board-slider{display:grid;grid-template-columns:1fr auto;gap:10px;margin-bottom:18px;color:#dce8eb}.gbs-board-slider input{grid-column:1/-1;width:100%;accent-color:#22d3ee;cursor:pointer}.gbs-board-slider output{color:#67e8f9}
      .gbs-board-column-options{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:6px}.gbs-board-column-options button{min-width:0;padding:12px 3px;background:#25282d;color:#93a0a8;border:1px solid #5b6870;border-radius:7px;font-size:12px;cursor:pointer}.gbs-board-column-options button.is-active{color:#22d3ee;border-color:#22d3ee;box-shadow:0 0 8px #22d3ee40}
      .gbs-board-preview{margin-top:22px;overflow:hidden}.gbs-board-preview table.gbs-board{width:100%!important;font-size:16px;border-spacing:0!important}.gbs-board-preview table.gbs-board thead tr,.gbs-board-preview table.gbs-board tbody tr{display:grid!important;width:100%!important;table-layout:auto!important}.gbs-board-preview table.gbs-board tbody{display:flex!important;gap:var(--preview-gap)!important}.gbs-board-preview table.gbs-board td,.gbs-board-preview table.gbs-board th{width:auto!important;min-width:0!important;max-width:none!important;overflow:hidden;text-overflow:ellipsis;padding:var(--preview-padding) 5px!important;box-sizing:border-box!important;font-size:14px!important;line-height:20px!important}.gbs-board-preview table.gbs-board th{background:#34393f!important;margin-bottom:8px}.gbs-board-preview table.gbs-board td.column-agent,.gbs-board-preview table.gbs-board td.column-status{color:var(--gbs-status)!important;font-weight:600!important}
      .gbs-board-preview table.gbs-board td,.gbs-board-preview table.gbs-board th{display:flex;align-items:center!important;white-space:nowrap!important;font-size:var(--preview-font,16px)!important;line-height:var(--preview-line,20px)!important;justify-content:flex-start;transition:padding 120ms ease,background-color 120ms ease!important}
      .gbs-board-preview table.gbs-board th{height:auto!important;min-height:32px!important;word-break:normal!important;overflow:hidden!important;flex-wrap:nowrap!important}.gbs-board-preview table.gbs-board th.gbs-rank-cell,.gbs-board-preview table.gbs-board td.gbs-rank-cell,.gbs-board-preview table.gbs-board .column-agentPresence{justify-content:center!important;text-align:center!important}
      .gbs-board-preview table.gbs-board .gbs-preview-circle{display:block!important;flex:none!important;width:18px!important;height:18px!important;box-sizing:border-box!important;border:2px solid #fff!important;border-radius:50%!important;background:var(--gbs-status)!important;margin:0!important}.gbs-board-preview table.gbs-board .gbs-preview-circle-header{background:#89949e!important;border-color:#c4cbd0!important}
      .gbs-board-preview table.gbs-board tbody tr{transform-origin:center top}.gbs-board-preview table.gbs-board tbody{transition:gap 120ms ease!important}
      .gbs-theme-toggle-wrap{display:inline-flex;align-items:center;margin:0 4px}.gbs-theme-toggle{width:32px;height:32px;display:inline-flex;align-items:center;justify-content:center;background:#25282d!important;color:#22d3ee!important;border:1px solid #22d3ee!important;border-radius:5px;cursor:pointer}.gbs-theme-toggle svg{width:18px;height:18px}
      .gbs-settings-popover{background:#1d2025!important;border-color:#22d3ee!important;box-shadow:0 20px 70px #0009,0 0 26px #22d3ee35!important}
      .gbs-settings-head,.gbs-settings-footer{border-color:#22d3ee55!important}
      .gbs-settings-tile{background:#25282d!important;color:#67dbe9!important;border-color:#22d3ee80!important}
      .gbs-settings-tile[data-setting="power"]{border-color:#647078!important;color:#9aa7ad!important}
      .gbs-settings-tile[data-setting="power"]:hover{border-color:#94a3ab!important;box-shadow:0 0 16px #94a3ab45!important}
      .gbs-settings-tile[data-setting="power"].is-on{border-color:#22d3ee!important;box-shadow:0 0 13px #22d3ee45!important;color:#67e8f9!important}
      .gbs-settings-tile[data-setting="power"].is-on:hover{box-shadow:0 0 20px #22d3ee65!important}
      .gbs-settings-tile,.gbs-power-icons svg{transition:opacity .12s ease,color .12s ease,filter .12s ease,box-shadow .12s ease,border-color .12s ease!important}
      .gbs-settings-close,.gbs-settings-back,.gbs-settings-footer button,.gbs-status-custom,.gbs-status-reset{background:#25282d!important;color:#a5f3fc!important;border-color:#22d3ee80!important}
      .gbs-settings-footer .gbs-settings-save{background:#25282d!important;color:#a5f3fc!important;border-color:#22d3ee!important;transition:background .15s,color .15s!important}
      .gbs-settings-footer .gbs-settings-save:hover{background:#22d3ee!important;color:#fff!important}
      .gbs-status-setting-row{background:#202328!important;border-color:#22d3ee55!important}
      @media(max-width:480px){.gbs-settings-grid{gap:8px}.gbs-settings-tile{min-height:145px;padding:12px 4px}.gbs-settings-tile>span:last-child{font-size:12px}}
      @media(prefers-reduced-motion:reduce){.gbs-settings-tile,.gbs-power-icons svg{transition:none}}
    `;
    doc.head.appendChild(style);
  }

  function settingsHeading(title, back = false) {
    const icon = settingsHeading.icons?.[title] || settingsIcon();
    return `<div class="gbs-settings-head">${back ? '<button class="gbs-settings-back" type="button" aria-label="Back">‹</button>' : ''}<span class="gbs-settings-title-icon">${icon}</span><span>${title}</span><button class="gbs-settings-close" type="button" aria-label="Close">×</button></div>`;
  }

  const ADMIN_CALL_BUTTON_KEY = 'genesys-v2-admin-show-call-button';
  const LAST_CALL_DATA_KEY = 'genesys-v2-last-call-data';
  const CALL_TEST_MODE_KEY = 'genesys-v2-call-test-mode';
  const CALL_HISTORY_KEY = 'genesys-v2-call-history';
  const SNOW_NEW_CALL_URL = 'https://kingfisher.service-now.com/now/nav/ui/classic/params/target/new_call.do%3Fsys_id%3D-1%26sysparm_stack%3Dnew_call_list.do';
  let testCallSession = null;
  let testNativeAnswer = null;
  function callTestEnabled(doc) {
    try { return isSavedAdmin(doc) && GM_getValue(CALL_TEST_MODE_KEY, false) === true; } catch (_) { return false; }
  }
  function persistTestCall() {
    if (!testCallSession) return;
    try {
      const history = GM_getValue(CALL_HISTORY_KEY, []);
      const index = history.findIndex(item => item.id === testCallSession.id);
      if (index < 0) history.push({ ...testCallSession });
      else history[index] = { ...testCallSession };
      GM_setValue(CALL_HISTORY_KEY, history);
    } catch (error) { console.warn('[Genesys V2] Call history save failed', error); }
  }
  function syncCallTestLayout(doc) {
    const on = callTestEnabled(doc);
    doc.documentElement.classList.toggle('gbs-call-test-mode', on);
    let style = doc.getElementById('gbs-call-test-layout');
    if (!style) {
      style = doc.createElement('style'); style.id = 'gbs-call-test-layout';
      style.textContent = `html.gbs-call-test-mode .command-panel.active.agent{position:fixed!important;left:-20000px!important;right:auto!important;top:0!important;width:1000px!important;height:100vh!important;opacity:0!important;pointer-events:none!important;transform:none!important;contain:layout paint!important}html.gbs-call-test-mode .gbs-agent-workspace-resizer{display:none!important}html.gbs-call-test-mode main.center-stage{width:100%!important;max-width:100%!important;flex:1 1 auto!important}html.gbs-call-test-mode .messenger-message:has([data-action="answerInteraction"]){display:none!important}`;
      doc.head.appendChild(style);
    }
  }
  let incomingCallRecord = null;
  let incomingCallPresent = false;
  let incomingCallCaptureUntil = 0;
  function saveLastCallRecord() {
    if (incomingCallRecord) {
      try { GM_setValue(LAST_CALL_DATA_KEY, incomingCallRecord); }
      catch (error) { console.warn('[Genesys V2] Call record save failed', error); }
    }
  }
  function watchIncomingCall(doc) {
    const action = doc.querySelector('.messenger-shown [data-action="answerInteraction"], .messenger-shown [data-action="openAcdInteraction"]');
    const alert = action?.closest('.messenger-message');
    if (alert) {
      alert.style.setProperty('background', '#1d2228', 'important');
      alert.style.setProperty('color', '#e7f5f8', 'important');
      alert.style.setProperty('border', '1px solid #22d3ee', 'important');
      alert.style.setProperty('box-shadow', '0 0 14px #22d3ee45', 'important');
      alert.style.setProperty('border-radius', '10px', 'important');
      alert.querySelectorAll('.messenger-actions a').forEach(link => {
        if (link.dataset.gbsIncomingStyled) return;
        link.dataset.gbsIncomingStyled = 'true';
        link.style.cssText += ';color:#a5f3fc!important;background:#243039!important;border:1px solid #22d3ee!important;border-radius:5px!important;padding:7px 12px!important;display:inline-block!important;';
      });
    }
    if (alert && !incomingCallPresent) {
      doc.getElementById('gbs-incoming-call-notice')?.remove();
      const notice = doc.createElement('div');
      notice.id = 'gbs-incoming-call-notice';
      notice.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:2147483647;background:#1d2228;color:#a5f3fc;border:1px solid #22d3ee;border-radius:10px;padding:14px 20px;box-shadow:0 0 12px #22d3ee30;';
      notice.textContent = 'Incoming-call notification appeared. ';
      const close = doc.createElement('button');
      close.textContent = '×'; close.setAttribute('aria-label', 'Dismiss notification');
      close.style.cssText = 'background:transparent;border:0;color:#a5f3fc;cursor:pointer;font-size:20px';
      close.addEventListener('click', () => notice.remove());
      notice.appendChild(close); doc.body.appendChild(notice);
      doc.defaultView.setTimeout(() => notice.remove(), 60000);
      if (isSavedAdmin(doc)) {
        incomingCallRecord = { schemaVersion: 1, appearedAt: new Date().toISOString(), actions: [], observations: [], limitations: 'Observed DOM outcomes only; internal JavaScript source is not captured. Customer details remain in local Tampermonkey storage until overwritten by the next answered call.' };
      }
    }
    incomingCallPresent = Boolean(alert);
    if (callTestEnabled(doc)) {
      syncCallTestLayout(doc);
      if (alert && (!testCallSession || testCallSession.finishedAt)) {
        testNativeAnswer = alert.querySelector('[data-action="answerInteraction"] a');
        testCallSession = { id: String(Date.now()), incomingAt: new Date().toISOString(), startedMs: Date.now(), hovered: false, actions: [], country: null, phoneNumber: null };
        persistTestCall();
      }
      if (alert && testCallSession && !testCallSession.backgroundViewRequestedAt) {
        const view = alert.querySelector('[data-action="openAcdInteraction"] a');
        if (view) {
          testCallSession.backgroundViewRequestedAt = new Date().toISOString();
          persistTestCall();
          view.click();
        }
      }
      if (testCallSession && !testCallSession.finishedAt) {
        const elapsed = Date.now() - testCallSession.startedMs;
        if (elapsed >= 29000 && !testCallSession.answeredAt && !testCallSession.timeoutAt) {
          testCallSession.timeoutAt = new Date().toISOString();
          testCallSession.outcome = 'unanswered-at-29-second-timeout';
          persistTestCall();
        }
        if (!alert && !testCallSession.ringingEndedAt) {
          testCallSession.ringingEndedAt = new Date().toISOString();
          testCallSession.ringingDurationMs = elapsed;
          persistTestCall();
        }
        syncCallInformationPopup(doc);
      }
    }
    if (incomingCallRecord && Date.now() < incomingCallCaptureUntil && isSavedAdmin(doc)) {
      const popup = doc.getElementById('gbs-call-information');
      const selected = doc.querySelector('.selected-interaction-container');
      const observation = {
        details: popup?.dataset.details || '',
        workspaceVisible: workspaceVisibleInTopDocument(doc),
        selectedVisible: Boolean(selected?.getBoundingClientRect().width),
        ratio: doc.querySelector('.left-chat-rail')?.dataset.gbsSelectedInteractionRatio || '',
        callText: (selected?.innerText || '').slice(0, 6000)
      };
      const signature = JSON.stringify(observation);
      if (incomingCallRecord.observations.at(-1)?.signature !== signature) {
        incomingCallRecord.observations.push({ at: new Date().toISOString(), ...observation, signature });
        if (incomingCallRecord.observations.length > 30) incomingCallRecord.observations.shift();
        if (incomingCallRecord.answeredAt) saveLastCallRecord();
      }
    }
  }
  function recordIncomingCallAction(event) {
    const action = event.target.closest?.('.messenger-actions [data-action]');
    const name = action?.dataset.action;
    if (!['answerInteraction', 'openAcdInteraction'].includes(name) || !isSavedAdmin(document)) return;
    if (!incomingCallRecord) incomingCallRecord = { schemaVersion: 1, appearedAt: new Date().toISOString(), actions: [], observations: [] };
    incomingCallRecord.actions.push({ action: name, at: new Date().toISOString(), notificationHtml: action.closest('.messenger-message')?.outerHTML || '' });
    if (testCallSession && !testCallSession.finishedAt) {
      testCallSession.actions.push({ action: name, at: new Date().toISOString() });
      if (name === 'answerInteraction') {
        testCallSession.answeredAt = new Date().toISOString();
        testCallSession.ringingDurationMs = Date.now() - testCallSession.startedMs;
        testCallSession.outcome = 'answer-clicked';
      }
      persistTestCall();
    }
    incomingCallCaptureUntil = Date.now() + 20000;
    if (name === 'answerInteraction') {
      incomingCallRecord.answeredAt = new Date().toISOString();
      saveLastCallRecord();
    }
    // Do not prevent or replace Genesys' native Answer/View handlers.
  }
  function isSavedAdmin(doc) {
    return currentAgentName(doc) === 'laszlo akim';
  }
  function showAdminCallButton(doc) {
    try { return doc.defaultView.localStorage.getItem(ADMIN_CALL_BUTTON_KEY) !== 'false'; } catch (_) { return true; }
  }
  function renderAdminSettings(doc, popover) {
    if (!isSavedAdmin(doc)) return;
    popover.dataset.gbsSettingsPage = 'admin';
    popover.innerHTML = settingsHeading('Admin', true) + '<div class="gbs-settings-body"><label style="display:flex;align-items:center;gap:10px"><input type="checkbox" data-admin-call-button style="accent-color:#22d3ee">Show Have a call button</label></div><div class="gbs-settings-footer"><button type="button" class="gbs-settings-cancel">Cancel</button><button type="button" class="gbs-settings-save">Save</button></div>';
    const checkbox = popover.querySelector('[data-admin-call-button]');
    const body = popover.querySelector('.gbs-settings-body');
    body.style.cssText = 'display:grid;gap:18px';
    const testCard = doc.createElement('label');
    testCard.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:18px;background:#242a30;border:1px solid #22d3ee80;border-radius:12px';
    testCard.appendChild(doc.createTextNode('Call Test mode ON/OFF'));
    const testToggle = doc.createElement('input'); testToggle.type = 'checkbox'; testToggle.checked = callTestEnabled(doc); testToggle.style.accentColor = '#22d3ee';
    testCard.appendChild(testToggle); body.prepend(testCard);
    const lastCall = doc.createElement('section');
    const title = doc.createElement('h3'); title.textContent = 'Last Call data';
    const info = doc.createElement('pre');
    info.style.cssText = 'white-space:pre-wrap;overflow-wrap:anywhere;max-height:260px;overflow:auto;font:13px/1.5 system-ui';
    let record = null;
    try { record = GM_getValue(LAST_CALL_DATA_KEY, null); } catch (_) {}
    const latest = record?.observations?.at(-1);
    info.textContent = record ? (latest?.callText || 'Answered call recorded; waiting for available details.') : 'No answered call recorded yet.';
    const download = doc.createElement('button');
    download.className = 'gbs-settings-save'; download.textContent = 'Download gathered data'; download.disabled = !record;
    download.addEventListener('click', () => {
      const url = doc.defaultView.URL.createObjectURL(new Blob([JSON.stringify(record, null, 2)], { type: 'application/json' }));
      const link = doc.createElement('a'); link.href = url; link.download = 'genesys-v2-last-call.json'; link.click();
      doc.defaultView.setTimeout(() => doc.defaultView.URL.revokeObjectURL(url), 1000);
    });
    lastCall.style.cssText = 'padding:18px;border:1px solid #22d3ee70;border-radius:12px;background:#242a30';
    const historyDownload = doc.createElement('button'); historyDownload.className = 'gbs-settings-save'; historyDownload.textContent = 'Download incoming-call history';
    historyDownload.addEventListener('click', () => {
      const history = GM_getValue(CALL_HISTORY_KEY, []);
      const url = URL.createObjectURL(new Blob([JSON.stringify(history, null, 2)], { type: 'application/json' }));
      const link = doc.createElement('a'); link.href = url; link.download = 'genesys-v2-incoming-calls.json'; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    lastCall.append(title, info, download, historyDownload); body.appendChild(lastCall);
    checkbox.checked = showAdminCallButton(doc);
    popover.querySelector('.gbs-settings-footer .gbs-settings-save').addEventListener('click', () => {
      if (!isSavedAdmin(doc)) return;
      try { doc.defaultView.localStorage.setItem(ADMIN_CALL_BUTTON_KEY, String(checkbox.checked)); } catch (_) {}
      GM_setValue(CALL_TEST_MODE_KEY, testToggle.checked);
      syncCallTestLayout(doc);
      ensureCallDeveloperToggle(doc);
      closeSettings(doc);
    });
    popover.querySelector('.gbs-settings-back').addEventListener('click', () => renderSettingsHome(doc, popover));
    popover.querySelector('.gbs-settings-cancel').addEventListener('click', () => closeSettings(doc));
    popover.querySelector('.gbs-settings-close').addEventListener('click', () => closeSettings(doc));
  }

  function renderStatusColorSettings(doc, popover, initialDraft = doc.__gbsStatusColorDraft || savedStatusColors(doc)) {
    popover.dataset.gbsSettingsPage = 'status-colors';
    const draft = { ...initialDraft };
    const palette = [...new Set(Object.values(STATUS_COLOR_GROUPS).map(entry => entry.color))];
    const rows = Object.entries(STATUS_COLOR_GROUPS).map(([group, entry]) => {
      const color = draft[group] || entry.color;
      const swatches = palette.map(paletteColor => `<button class="gbs-status-swatch" type="button" title="Use ${paletteColor}" aria-label="Use ${paletteColor}" style="--gbs-swatch-color:${paletteColor}" data-gbs-color="${paletteColor}"></button>`).join('');
      return `<div class="gbs-status-setting-row" data-gbs-status-group="${group}" data-gbs-default-color="${entry.color}" style="--gbs-preview-color:${color}"><div class="gbs-status-setting-label"><span>${group.replace(/-/g, ' ')}</span><button class="gbs-status-custom" type="button" title="Choose a custom color">Custom <span class="gbs-status-custom-swatch" aria-hidden="true"></span></button><input type="color" value="${color}" aria-label="Choose ${group} color"></div><div class="gbs-status-example">Example status row</div><div class="gbs-status-palette"><button class="gbs-status-reset" type="button" title="Restore default color" aria-label="Restore default color"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg></button>${swatches}</div></div>`;
    }).join('');
    popover.innerHTML = `<div class="gbs-settings-head"><button class="gbs-settings-back" type="button" aria-label="Back"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="m14 16-4-4 4-4"/></svg></button><span>Status colors</span><button class="gbs-settings-close" type="button" aria-label="Close">×</button></div><div class="gbs-settings-body">${rows}</div><div class="gbs-settings-footer"><button class="gbs-settings-default" type="button">Default</button><button class="gbs-settings-cancel" type="button">Cancel</button><button class="gbs-settings-save" type="button">Save</button></div>`;
    const applyDraftColor = (row, color) => {
      const group = row.dataset.gbsStatusGroup;
      draft[group] = color;
      row.querySelector('input[type="color"]').value = color;
      row.style.setProperty('--gbs-preview-color', color);
      doc.__gbsStatusColorDraft = draft;
      applyStatusColorOverrides(doc, draft);
    };
    // Render the public label synchronously before the dialog can paint.
    popover.querySelector('[data-gbs-status-group="interacting"] .gbs-status-setting-label>span').textContent = 'In Call';
    popover.querySelector('[data-gbs-status-group="interacting"] input[type="color"]').setAttribute('aria-label', 'Choose In Call color');
    popover.querySelector('.gbs-settings-head').outerHTML = settingsHeading('Status Colors', true);
    popover.querySelectorAll('.gbs-status-setting-row input[type="color"]').forEach(input => input.addEventListener('input', () => {
      const row = input.closest('[data-gbs-status-group]');
      applyDraftColor(row, input.value);
    }));
    popover.querySelectorAll('.gbs-status-custom').forEach(button => button.addEventListener('click', () => {
      button.closest('[data-gbs-status-group]').querySelector('input[type="color"]').click();
    }));
    popover.querySelectorAll('.gbs-status-swatch').forEach(button => button.addEventListener('click', () => applyDraftColor(button.closest('[data-gbs-status-group]'), button.dataset.gbsColor)));
    popover.querySelectorAll('.gbs-status-reset').forEach(button => button.addEventListener('click', () => {
      const row = button.closest('[data-gbs-status-group]');
      applyDraftColor(row, row.dataset.gbsDefaultColor);
    }));
    popover.querySelector('.gbs-settings-back').addEventListener('click', () => renderSettingsHome(doc, popover));
    popover.querySelector('.gbs-settings-close').addEventListener('click', () => { delete doc.__gbsStatusColorDraft; applyStatusColorOverrides(doc); closeSettings(doc); });
    popover.querySelector('.gbs-settings-cancel').addEventListener('click', () => { delete doc.__gbsStatusColorDraft; applyStatusColorOverrides(doc); closeSettings(doc); });
    popover.querySelector('.gbs-settings-default').addEventListener('click', () => {
      Object.keys(draft).forEach(key => delete draft[key]);
      doc.__gbsStatusColorDraft = draft;
      applyStatusColorOverrides(doc, draft);
      renderStatusColorSettings(doc, popover, draft);
    });
    popover.querySelector('.gbs-settings-footer .gbs-settings-save').addEventListener('click', () => {
      try { doc.defaultView.localStorage.setItem(STATUS_COLOR_SETTINGS_KEY, JSON.stringify(draft)); } catch (_) { /* storage unavailable */ }
      delete doc.__gbsStatusColorDraft; applyStatusColorOverrides(doc, draft); closeSettings(doc);
    });
  }

  function renderSettingsHome(doc, popover) {
    popover.dataset.gbsSettingsPage = 'home';
    const sparkle = '<path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z"/>';
    const svg = paths => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
    const on = themeMode(doc) !== 'light';
    popover.innerHTML = settingsHeading('Genesys V2 Settings') + `<div class="gbs-settings-body"><div class="gbs-settings-grid"><button type="button" class="gbs-settings-tile ${on ? 'is-on' : ''}" data-setting="power" aria-pressed="${on}"><span class="gbs-power-icons">${svg(sparkle).replace('<svg ', '<svg class="gbs-power-off" ')}${svg(sparkle + '<path d="M20 2v4"/><path d="M22 4h-4"/><circle cx="4" cy="20" r="2"/>').replace('<svg ', '<svg class="gbs-power-on" ')}</span><span>Genesys V2 ${on ? 'ON' : 'OFF'}</span></button><button type="button" class="gbs-settings-tile" data-setting="dashboard">${svg('<path d="M15.536 11.293a1 1 0 0 0 0 1.414l2.376 2.377a1 1 0 0 0 1.414 0l2.377-2.377a1 1 0 0 0 0-1.414l-2.377-2.377a1 1 0 0 0-1.414 0z"/><path d="M2.297 11.293a1 1 0 0 0 0 1.414l2.377 2.377a1 1 0 0 0 1.414 0l2.377-2.377a1 1 0 0 0 0-1.414L6.088 8.916a1 1 0 0 0-1.414 0z"/><path d="M8.916 17.912a1 1 0 0 0 0 1.415l2.377 2.376a1 1 0 0 0 1.414 0l2.377-2.376a1 1 0 0 0 0-1.415l-2.377-2.376a1 1 0 0 0-1.414 0z"/><path d="M8.916 4.674a1 1 0 0 0 0 1.414l2.377 2.376a1 1 0 0 0 1.414 0l2.377-2.376a1 1 0 0 0 0-1.414l-2.377-2.377a1 1 0 0 0-1.414 0z"/>')}<span>Dashboard</span></button><button type="button" class="gbs-settings-tile" data-setting="colors">${svg('<path d="m14.622 17.897-10.68-2.913"/><path d="M18.376 2.622a1 1 0 1 1 3.002 3.002L17.36 9.643a.5.5 0 0 0 0 .707l.944.944a2.41 2.41 0 0 1 0 3.408l-.944.944a.5.5 0 0 1-.707 0L8.354 7.348a.5.5 0 0 1 0-.707l.944-.944a2.41 2.41 0 0 1 3.408 0l.944.944a.5.5 0 0 0 .707 0z"/><path d="M9 8c-1.804 2.71-3.97 3.46-6.583 3.948a.507.507 0 0 0-.302.819l7.32 8.883a1 1 0 0 0 1.185.204C12.735 20.405 16 16.792 16 15"/>')}<span>Status Colors</span></button></div></div>`;
    popover.querySelector('[data-setting="power"]').lastElementChild.textContent = `Genesys V2 is ${on ? 'ON' : 'OFF'}`;
    settingsHeading.icons = { Dashboard: popover.querySelector('[data-setting="dashboard"] svg').outerHTML, 'Status Colors': popover.querySelector('[data-setting="colors"] svg').outerHTML };
    const powerCard = doc.createElement('label');
    powerCard.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:16px;padding:16px;margin-top:18px;border:1px solid #22d3ee80;border-radius:10px;background:#242a30;color:#a5f3fc';
    powerCard.appendChild(doc.createTextNode('Power saving'));
    const powerSelect = doc.createElement('select'); powerSelect.setAttribute('aria-label', 'Power saving mode');
    powerSelect.style.cssText = 'background:#1d2025;color:#a5f3fc;border:1px solid #22d3ee;border-radius:5px;padding:8px';
    for (const [value, label] of [['auto', 'Auto'], ['full', 'Full effects'], ['low', 'Low-power']]) {
      const option = doc.createElement('option'); option.value = value; option.textContent = label; powerSelect.appendChild(option);
    }
    powerSelect.value = powerMode();
    powerSelect.addEventListener('change', () => {
      GM_setValue(POWER_MODE_KEY, powerSelect.value);
      collectReachableDocuments().forEach(applyPowerMode);
    });
    powerCard.appendChild(powerSelect); popover.querySelector('.gbs-settings-body').appendChild(powerCard);
    const updateFooter = doc.createElement('div'); updateFooter.className = 'gbs-settings-footer';
    const updateButton = doc.createElement('button'); updateButton.type = 'button'; updateButton.textContent = 'Check for updates'; updateButton.className = 'gbs-settings-check-updates';
    updateButton.addEventListener('click', () => checkGenesysUpdates(true));
    updateFooter.appendChild(updateButton); popover.appendChild(updateFooter);
    syncGenesysUpdateControls(doc);
    if (isSavedAdmin(doc)) {
      const adminIcon = svg('<path d="M10 15H6a4 4 0 0 0-4 4v2"/><path d="M22 17.5c0 2.499-1.75 3.749-3.83 4.474a.5.5 0 0 1-.335-.005c-2.085-.72-3.835-1.97-3.835-4.47V14a.5.5 0 0 1 .5-.499c1 0 2.25-.6 3.12-1.36a.6.6 0 0 1 .76-.001c.875.765 2.12 1.36 3.12 1.36a.5.5 0 0 1 .5.5z"/><circle cx="9" cy="7" r="4"/>');
      const tile = doc.createElement('button');
      tile.type = 'button'; tile.className = 'gbs-settings-tile'; tile.dataset.setting = 'admin';
      tile.innerHTML = adminIcon + '<span>Admin</span>';
      settingsHeading.icons.Admin = adminIcon;
      tile.addEventListener('click', () => renderAdminSettings(doc, popover));
      popover.querySelector('.gbs-settings-grid').appendChild(tile);
    }
    popover.querySelector('[data-setting="colors"]').addEventListener('click', () => renderStatusColorSettings(doc, popover));
    popover.querySelector('[data-setting="dashboard"]').addEventListener('click', () => {
      renderDashboardSettings(doc, popover);
    });
    popover.querySelector('[data-setting="power"]').addEventListener('click', async event => {
      const tile = event.currentTarget;
      tile.disabled = true;
      const wasOn = tile.classList.contains('is-on');
      if (wasOn && (!doc.defaultView.confirm('Do you really want to turn off Genesys V2?')
          || !doc.defaultView.confirm('Confirm again: turn off Genesys V2 and reload this page?'))) {
        tile.disabled = false;
        return;
      }
      const wait = () => new Promise(resolve => doc.defaultView.setTimeout(resolve, 85));
      if (wasOn) {
        tile.classList.add('power-unglow'); await wait();
        tile.classList.add('power-grey'); await wait();
        tile.classList.add('power-crossfade'); await wait();
        tile.classList.remove('is-on');
      } else {
        tile.classList.add('power-grey', 'power-unglow', 'is-on'); await wait();
        tile.classList.remove('power-grey'); await wait();
        tile.classList.remove('power-unglow'); await wait();
      }
      tile.classList.remove('power-grey', 'power-unglow', 'power-crossfade');
      try { doc.defaultView.localStorage.setItem(THEME_KEY, wasOn ? 'light' : 'dark'); } catch (_) {}
      tile.setAttribute('aria-pressed', String(!wasOn));
      tile.lastElementChild.textContent = `Genesys V2 is ${wasOn ? 'OFF' : 'ON'}`;
      tile.disabled = false;
      // Reload discards every installed observer, hook, inline layout change,
      // and pending animation. OFF then starts only the settings launcher.
      doc.defaultView.setTimeout(() => doc.defaultView.location.reload(), 100);
    });
    popover.querySelector('.gbs-settings-close').addEventListener('click', () => closeSettings(doc));
  }

  function renderDashboardSettings(doc, popover, draft = boardSettings(doc)) {
    popover.dataset.gbsSettingsPage = 'dashboard';
    // Startup may have cached metrics before Genesys finished styling its
    // rows. Settings must sample the fully rendered Board afresh.
    delete doc.__gbsBoardDefaultMetrics;
    const base = boardDefaultMetrics(doc);
    const examples = [['Nova Reed','busy','Busy','4m 12s','4m 12s'],['Kai Storm','idle','Idle','2m 38s','2m 38s'],['Zara Fox','idle','Idle','7m 06s','7m 06s'],['Leo Frost','interacting','In Call','1m 45s','1m 32s'],['Mira Vale','meal','Meal','12m 09s','12m 09s']];
    let ownName = '';
    try { ownName = doc.defaultView.localStorage.getItem(CURRENT_AGENT_KEY) || ''; } catch (_) {}
    ownName ||= currentAgentName(doc).replace(/\b\w/g, letter => letter.toUpperCase()) || 'You';
    examples[1][0] = ownName.replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
    const classes = ['column-agentPresence','gbs-rank-cell','column-agent','column-timeInStatus','column-status','column-duration'];
    const rows = examples.map(([name,key,status,time,duration], index) => `<tr class="gbs-status-${key}" style="--gbs-status:${STATUS_DEFINITIONS[key].color}">${['<span style="display:inline-block;width:15px;height:15px;border:2px solid white;border-radius:50%;background:var(--gbs-status)"></span>',index + 1,name,time,status,duration].map((value,i) => `<td class="${classes[i]}">${value}</td>`).join('')}</tr>`).join('');
    popover.innerHTML = settingsHeading('Dashboard', true) + `<div class="gbs-settings-body"><label class="gbs-board-slider">Space between Rows <output data-gap-output>${draft.gap}px</output><input data-board-gap type="range" min="1" max="10" step="1" value="${draft.gap}"></label><label class="gbs-board-slider">Row height <output data-padding-output>${draft.padding}px padding</output><input data-board-padding type="range" min="0" max="8" step="1" value="${draft.padding}"></label><div style="margin:16px 0 10px">Visible Columns</div><div class="gbs-board-column-options">${BOARD_COLUMNS.map(([label],i) => `<button type="button" data-board-column="${i}" aria-pressed="${draft.columns[i]}" class="${draft.columns[i] ? 'is-active' : ''}">${label}</button>`).join('')}</div><div class="gbs-board-preview"><table class="gbs-board" aria-label="Board preview"><thead><tr>${BOARD_COLUMNS.map(([label],i) => `<th class="${classes[i]}">${label === 'Status Circle' ? '' : label}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div></div><div class="gbs-settings-footer"><button type="button" class="gbs-settings-default">Default</button><button type="button" class="gbs-settings-cancel">Cancel</button><button type="button" class="gbs-settings-save">Save</button></div>`;
    const preview = popover.querySelector('table');
    const fontLabel = doc.createElement('label');
    fontLabel.className = 'gbs-board-slider';
    fontLabel.innerHTML = 'Font size<input data-board-font type="range" min="-5" max="5" step="any">';
    popover.querySelector('[data-board-padding]').closest('label').after(fontLabel);
    const fontSlider = fontLabel.querySelector('input');
    fontSlider.max = String(Math.max(5, draft.fontOffset));
    fontSlider.value = String(draft.fontOffset || 0);
    const youLabel = doc.createElement('label');
    youLabel.style.cssText = 'display:flex;align-items:center;gap:8px;margin:16px 0;color:#dce8eb';
    youLabel.innerHTML = '<input data-board-you type="checkbox" style="accent-color:#22d3ee;width:22px;height:22px;flex:none">Show <span class="gbs-current-agent-badge" style="color:#22d3ee">YOU</span> marker';
    popover.querySelector('.gbs-board-column-options').previousElementSibling.before(youLabel);
    const youCheckbox = youLabel.querySelector('input');
    youCheckbox.checked = draft.showYou !== false;
    const whiteLabel = doc.createElement('label');
    whiteLabel.style.cssText = youLabel.style.cssText;
    whiteLabel.innerHTML = '<input type="checkbox" style="accent-color:#22d3ee;width:22px;height:22px;flex:none">Use white colored names';
    youLabel.after(whiteLabel);
    const whiteCheckbox = whiteLabel.querySelector('input');
    whiteCheckbox.checked = draft.whiteNames === true;
    const ownRow = preview.querySelectorAll('tbody tr')[1];
    ownRow.classList.add('gbs-current-agent');
    const ownCell = ownRow.querySelector('td.column-agent');
    ownCell.innerHTML = `<span class="gbs-current-agent-badge">YOU</span><span>${examples[1][0]}</span>`;
    ownCell.style.gap = '3px';
    ownCell.querySelector('.gbs-current-agent-badge').style.setProperty('margin-right', '0', 'important');
    ownCell.lastElementChild.style.setProperty('text-shadow', '0 0 3px color-mix(in srgb, var(--gbs-status) 62%, #fff)', 'important');
    popover.querySelectorAll('output').forEach(output => output.remove());
    const gapSlider = popover.querySelector('[data-board-gap]');
    const paddingSlider = popover.querySelector('[data-board-padding]');
    gapSlider.step = paddingSlider.step = 'any';
    // A 12.5px range means 2% thumb travel changes the value by 0.25px.
    gapSlider.max = '13.5';
    paddingSlider.min = '1';
    paddingSlider.max = '13.5';
    gapSlider.value = String(draft.gap);
    paddingSlider.value = String(draft.rowPadding ?? 8);
    preview.querySelector('th.column-agentPresence').innerHTML = '<span class="gbs-preview-circle gbs-preview-circle-header"></span>';
    preview.querySelectorAll('td.column-agentPresence').forEach(cell => { cell.innerHTML = '<span class="gbs-preview-circle"></span>'; });
    // Match the actual Board typography and horizontal padding at this screen
    // size. Only the preview's width is constrained by the settings window.
    const liveTable = [...collectReachableDocuments()].map(frameDoc => frameDoc.querySelector('table.gbs-board:not([aria-label="Board preview"])')).find(Boolean);
    if (liveTable) {
      const sample = liveTable.querySelector('td.column-agent');
      if (sample) {
        const metrics = liveTable.ownerDocument.defaultView.getComputedStyle(sample);
        preview.style.setProperty('--preview-font', metrics.fontSize);
        preview.style.setProperty('--preview-line', metrics.lineHeight);
        preview.style.fontFamily = metrics.fontFamily;
        const preferenceStyle = liveTable.ownerDocument.getElementById('gbs-board-preferences');
        const wasDisabled = preferenceStyle?.disabled;
        if (preferenceStyle) preferenceStyle.disabled = true;
        const defaultMetrics = liveTable.ownerDocument.defaultView.getComputedStyle(sample);
        const defaultHeight = sample.getBoundingClientRect().height;
        base.gap = 4;
        base.height = defaultHeight;
        base.padding = parseFloat(defaultMetrics.paddingTop) || 0;
        doc.__gbsBoardDefaultMetrics = base;
        let saved = {};
        try { saved = JSON.parse(doc.defaultView.localStorage.getItem(BOARD_SETTINGS_KEY) || '{}'); } catch (_) {}
        // Keep deliberately saved preferences, but never keep an early
        // fallback value in an unsaved draft.
        draft.gap = Number.isFinite(saved.gap) ? saved.gap : base.gap;
        draft.padding = draft.rowPadding;
        gapSlider.max = '13.5';
        gapSlider.value = String(draft.gap);
        preview.style.setProperty('--preview-base-height', `${defaultHeight}px`);
        preview.style.setProperty('--preview-base-padding', `${parseFloat(defaultMetrics.paddingTop) || 0}px`);
        if (preferenceStyle) preferenceStyle.disabled = wasDisabled;
      }
    }
    const edgeStyle = doc.createElement('style');
    popover.appendChild(edgeStyle);
    const update = (animateColumns = true) => {
      const before = [...preview.querySelectorAll('tr')].map(row => ({row,rect:row.getBoundingClientRect()}));
      const cellBefore = new Map([...preview.querySelectorAll('th,td')].map(cell => [cell,cell.getBoundingClientRect()]));
      preview.style.setProperty('--preview-gap', `${draft.gap}px`);
      preview.style.setProperty('--preview-font', `${16 + (draft.fontOffset || 0)}px`);
      preview.style.setProperty('--preview-line', `${19 + (draft.fontOffset || 0)}px`);
      ownCell.querySelector('.gbs-current-agent-badge').style.setProperty('display', draft.showYou === false ? 'none' : 'inline-flex', 'important');
      youLabel.style.setProperty('--gbs-status', doc.defaultView.getComputedStyle(ownRow).getPropertyValue('--gbs-status').trim() || STATUS_DEFINITIONS.idle.color);
      const circleSize = Math.min(18, 14 + Math.max(0, draft.rowPadding - 1) * 2);
      preview.querySelectorAll('td .gbs-preview-circle').forEach(circle => {
        circle.style.setProperty('width', `${circleSize}px`, 'important');
        circle.style.setProperty('height', `${circleSize}px`, 'important');
      });
      preview.querySelectorAll('td.column-status').forEach(cell => {if (cell.textContent.trim() === 'Interacting') cell.textContent = 'In Call';});
      preview.style.setProperty('--preview-padding', `${draft.padding}px`);
      preview.querySelectorAll('tbody tr').forEach(row => {
        row.style.setProperty('min-height', '0', 'important');
        row.querySelectorAll('td').forEach(cell => {
          const height = `calc(var(--preview-line, 19px) + 2px + ${2 * draft.rowPadding}px)`;
          cell.style.setProperty('height', height, 'important');
          cell.style.setProperty('min-height', height, 'important');
          cell.style.setProperty('box-sizing', 'border-box', 'important');
        });
      });
      preview.querySelectorAll('tr').forEach(row => {
        [...row.children].forEach((cell,i) => cell.style.setProperty('display', draft.columns[i] ? 'flex' : 'none', 'important'));
        row.style.setProperty('grid-template-columns', ['32px','26px','minmax(0,2fr)','minmax(0,1fr)','minmax(0,1fr)','minmax(0,1fr)'].filter((_,i) => draft.columns[i]).join(' '), 'important');
      });
      edgeStyle.textContent = (boardEdgeCSS(draft) + boardNameColorCSS(draft)).replaceAll('table.gbs-board', '.gbs-board-preview table.gbs-board');
      if (animateColumns) before.forEach(({row,rect}) => {
        const next = row.getBoundingClientRect();
        row.getAnimations().forEach(animation => animation.cancel());
        if (rect.height && next.height && !doc.defaultView.matchMedia('(prefers-reduced-motion: reduce)').matches) row.animate([{transform:`translateY(${rect.top-next.top}px) scaleY(${rect.height/next.height})`},{transform:'none'}],{duration:140,easing:'ease-out'});
      });
      if (animateColumns && !doc.defaultView.matchMedia('(prefers-reduced-motion: reduce)').matches) preview.querySelectorAll('th,td').forEach(cell => {
        const old = cellBefore.get(cell), next = cell.getBoundingClientRect();
        cell.getAnimations().forEach(animation => animation.cancel());
        if (next.width && old.width && Math.abs(old.left-next.left) > 1) cell.animate([{transform:`translateX(${old.left-next.left}px)`},{transform:'none'}],{duration:140,easing:'ease-out'});
        else if (next.width && !old.width) cell.animate([{opacity:0},{opacity:1}],{duration:140,easing:'ease-out'});
      });
    };
    let sliderFrame = 0;
    let resetFrame = 0;
    const slide = (key, value) => {
      const quantized = Math.round(Number(value) * 4) / 4;
      if (draft[key] === quantized) return;
      draft[key] = quantized;
      if (key === 'rowPadding') draft.padding = quantized;
      if (!sliderFrame) sliderFrame = doc.defaultView.requestAnimationFrame(() => {sliderFrame = 0;update(false);});
    };
    gapSlider.addEventListener('input', event => {doc.defaultView.cancelAnimationFrame(resetFrame);slide('gap', event.target.value);});
    paddingSlider.addEventListener('input', event => {doc.defaultView.cancelAnimationFrame(resetFrame);slide('rowPadding', event.target.value);});
    fontSlider.addEventListener('input', event => {doc.defaultView.cancelAnimationFrame(resetFrame);slide('fontOffset', event.target.value);});
    youCheckbox.addEventListener('change', () => {draft.showYou = youCheckbox.checked;update();});
    whiteCheckbox.addEventListener('change', () => {draft.whiteNames = whiteCheckbox.checked;update();});
    popover.querySelectorAll('[data-board-column]').forEach(button => button.addEventListener('click', () => {
      const index = Number(button.dataset.boardColumn);
      if (draft.columns[index] && draft.columns.filter(Boolean).length === 1) return;
      draft.columns[index] = !draft.columns[index];
      button.classList.toggle('is-active', draft.columns[index]); button.setAttribute('aria-pressed', String(draft.columns[index])); update();
    }));
    popover.querySelector('.gbs-settings-default').addEventListener('click', () => {
      doc.defaultView.cancelAnimationFrame(resetFrame);
      const fromGap = Number(gapSlider.value), fromHeight = Number(paddingSlider.value);
      const fromFont = Number(fontSlider.value);
      draft.showYou = true; youCheckbox.checked = true;
      draft.whiteNames = false; whiteCheckbox.checked = false;
      draft.columns = BOARD_COLUMNS.map(() => true);
      popover.querySelectorAll('[data-board-column]').forEach(button => {button.classList.add('is-active');button.setAttribute('aria-pressed','true');});
      update();
      const started = doc.defaultView.performance.now();
      const tick = now => {
        if (!preview.isConnected || popover.hidden) return;
        const progress = Math.min(1, (now - started) / 260);
        const eased = 1 - Math.pow(1 - progress, 3);
        gapSlider.value = String(fromGap + (base.gap - fromGap) * eased);
        paddingSlider.value = String(fromHeight + (8 - fromHeight) * eased);
        fontSlider.value = String(fromFont + (-1 - fromFont) * eased);
        draft.fontOffset = Math.round(Number(fontSlider.value) * 4) / 4;
        draft.gap = progress === 1 ? base.gap : Math.round(Number(gapSlider.value) * 4) / 4;
        draft.rowPadding = draft.padding = Math.round(Number(paddingSlider.value) * 4) / 4;
        update(false);
        if (progress < 1) resetFrame = doc.defaultView.requestAnimationFrame(tick);
      };
      resetFrame = doc.defaultView.requestAnimationFrame(tick);
    });
    popover.querySelector('.gbs-settings-cancel').addEventListener('click', () => closeSettings(doc));
    popover.querySelector('.gbs-settings-footer .gbs-settings-save').addEventListener('click', () => {
      doc.defaultView.localStorage.setItem(BOARD_SETTINGS_KEY, JSON.stringify(draft));
      collectReachableDocuments().forEach(frameDoc => { applyBoardSettings(frameDoc, draft); frameDoc.querySelectorAll('table.gbs-board').forEach(table => applyResponsiveBoardColumns(table)); });
      closeSettings(doc);
    });
    popover.querySelector('.gbs-settings-back').addEventListener('click', () => renderSettingsHome(doc, popover));
    popover.querySelector('.gbs-settings-close').addEventListener('click', () => closeSettings(doc));
    update();
  }

  function openSettings(doc, anchor) {
    ensureSettingsStyle(doc);
    let backdrop = doc.querySelector('.gbs-settings-backdrop');
    if (!backdrop) { backdrop = doc.createElement('div'); backdrop.className = 'gbs-settings-backdrop'; doc.body.appendChild(backdrop); }
    backdrop.removeAttribute('hidden');
    let popover = doc.querySelector('.gbs-settings-popover');
    if (!popover) {
      popover = doc.createElement('section');
      popover.className = 'gbs-settings-popover';
      popover.setAttribute('role', 'dialog');
      popover.setAttribute('aria-modal', 'true');
      popover.setAttribute('aria-label', 'Genesys V2 Settings');
      doc.body.appendChild(popover);
      // Capture phase sees an ordinary click outside before any application
      // handlers redraw the command bar. Native color-picker interaction starts
      // from the input (which is inside the popover), so it remains open.
      doc.addEventListener('pointerdown', event => {
        const active = doc.querySelector('.gbs-settings-popover:not([hidden])');
        const eventPath = event.composedPath?.() || [];
        const clickedSettings = eventPath.includes(active) || active?.contains(event.target);
        const clickedGear = eventPath.some(node => node?.classList?.contains?.('gbs-theme-toggle-wrap')) || event.target.closest?.('.gbs-theme-toggle-wrap');
        const clickedUpdateNotice = eventPath.some(node => node?.id === 'gbs-official-update-notice');
        if (!active || clickedSettings || clickedGear || clickedUpdateNotice) return;
        delete doc.__gbsStatusColorDraft;
        applyStatusColorOverrides(doc);
        closeSettings(doc);
      }, true);
      doc.addEventListener('keydown', event => {
        if (event.key === 'Escape' && !popover.hasAttribute('hidden')) closeSettings(doc);
      });
    }
    if (popover.dataset.gbsSettingsPage === 'status-colors') renderStatusColorSettings(doc, popover);
    else renderSettingsHome(doc, popover);
    // Settings is a modal-style editor: centering prevents its wider palette
    // from overflowing against the global-action edge on compact screens.
    popover.style.left = '50%';
    popover.style.top = '50%';
    popover.style.right = 'auto';
    popover.removeAttribute('hidden');
    // Same maximum stacking level as settings; last DOM position keeps the
    // notification above it, even if settings was reopened afterward.
    const updateNotice = doc.getElementById('gbs-official-update-notice');
    if (updateNotice) doc.body.appendChild(updateNotice);
  }

  function syncThemeToggleSize(doc) {
    const wrapper = doc.querySelector('.gbs-theme-toggle-wrap');
    if (!wrapper) return;
    let sibling = wrapper.previousElementSibling;
    while (sibling && sibling.getBoundingClientRect().height < 20) sibling = sibling.previousElementSibling;
    const reference = sibling?.matches('button') ? sibling : sibling?.querySelector('button, [role="button"]');
    const height = Math.round(reference?.getBoundingClientRect().height || 32);
    if (height >= 24 && height <= 48) wrapper.style.setProperty('--gbs-theme-height', `${height}px`);
  }

  function applyThemeMode(doc) {
    const mode = themeMode(doc);
    const light = mode === 'light';
    doc.documentElement.classList.toggle('gbs-light-mode', mode === 'light');
    doc.documentElement.classList.toggle('gbs-dark-mode', mode !== 'light');
    const customVisuals = doc.getElementById(STYLE_ID);
    if (customVisuals) customVisuals.disabled = light;
    applyStatusColorOverrides(doc);
    const button = doc.querySelector('.gbs-theme-toggle');
    if (button) syncThemeToggleSize(doc);
  }

  function syncInteractionAppTheme(doc) {
    const dark = themeMode(doc) !== 'light';
    doc.querySelectorAll('app-view-stack, app-carousel-toolbar, app-carousel-view').forEach(host => {
      if (!host.dataset.gbsOriginalTheme) host.dataset.gbsOriginalTheme = host.getAttribute('theme') || 'legacy';
      host.setAttribute('theme', dark ? 'dark' : host.dataset.gbsOriginalTheme);
      host.style.setProperty('color-scheme', dark ? 'dark' : 'light', 'important');
      if (dark) {
        host.style.setProperty('--gbs-app-background', '#1d2025');
        host.style.setProperty('--gux-background-color', '#1d2025');
        host.style.setProperty('--gse-semantic-color-background-primary', '#1d2025');
        host.style.setProperty('--gse-semantic-color-background-secondary', '#252b33');
        host.style.setProperty('--gse-semantic-color-content-primary', '#e5e7eb');
      } else {
        host.style.removeProperty('--gbs-app-background');
        host.style.removeProperty('--gux-background-color');
        host.style.removeProperty('--gse-semantic-color-background-primary');
        host.style.removeProperty('--gse-semantic-color-background-secondary');
        host.style.removeProperty('--gse-semantic-color-content-primary');
      }
    });
  }

  function ensureThemeToggle(doc) {
    ensureSettingsStyle(doc);
    syncGenesysUpdateControls(doc);
    const actions = doc.querySelector('.global-actions .all-but-global-search');
    if (!actions || actions.querySelector('.gbs-theme-toggle')) return;
    const wrapper = doc.createElement('div');
    wrapper.className = 'gbs-theme-toggle-wrap';
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'gbs-theme-toggle';
    button.setAttribute('aria-label', 'Genesys V2 Settings');
    button.title = 'Genesys V2 Settings';
    button.innerHTML = settingsIcon();
    button.addEventListener('click', () => {
      const popover = doc.querySelector('.gbs-settings-popover');
      if (popover && !popover.hasAttribute('hidden')) {
        delete doc.__gbsStatusColorDraft;
        applyStatusColorOverrides(doc);
        closeSettings(doc);
      } else {
        openSettings(doc, button);
      }
    });
    wrapper.appendChild(button);
    const profile = actions.querySelector('.command-user-settings');
    actions.insertBefore(wrapper, profile || null);
    if (themeMode(doc) !== 'light') applyThemeMode(doc);
  }

  function markCompactActionWrappers(doc) {
    doc.querySelectorAll('gux-button-slot.global-action-icon-button').forEach(slot => {
      const button = slot.querySelector('button');
      const label = (button?.getAttribute('aria-label') || button?.textContent || '').replace(/\s+/g, ' ').trim();
      const wrapper = slot.parentElement;
      if (!wrapper) return;
      wrapper.classList.toggle('gbs-compact-action-wrapper', /^(Help|Calls|Chat|Inbox|Agent Workspace)$/i.test(label));
    });
  }

  function syncQueueVisualState(doc) {
    const queue = doc.querySelector('#command-bar-queue, .global-queue');
    if (!queue) return;
    const toggle = queue.querySelector('#command-bar-queue-toggle, gux-toggle, [role="switch"], input[type="checkbox"]');
    const shadowControl = toggle?.shadowRoot?.querySelector('input[type="checkbox"], [role="switch"]');
    const control = shadowControl || toggle;
    const checked = control?.checked === true
      || control?.getAttribute?.('aria-checked') === 'true'
      || control?.getAttribute?.('checked') !== null
      || toggle?.getAttribute?.('value') === 'true';
    queue.classList.toggle('gbs-on-queue', Boolean(checked));
  }

  function ensureQueueVisualStateHook(doc) {
    if (doc.__gbsQueueVisualStateHook) return;
    const queue = doc.querySelector('#command-bar-queue, .global-queue');
    if (!queue) return;
    const view = doc.defaultView;
    let syncFrame = 0;
    const syncSoon = () => {
      if (syncFrame) view.cancelAnimationFrame(syncFrame);
      // The native GUX toggle changes its checked state after its click
      // handler. Sync on the next paint rather than waiting for the global
      // maintenance sweep, which previously added up to one second of lag.
      syncFrame = view.requestAnimationFrame(() => {
        syncFrame = 0;
        syncQueueVisualState(doc);
      });
      view.setTimeout(() => syncQueueVisualState(doc), 90);
      view.setTimeout(() => syncQueueVisualState(doc), 260);
    };
    queue.addEventListener('click', syncSoon, true);
    queue.addEventListener('input', syncSoon, true);
    queue.addEventListener('change', syncSoon, true);
    doc.__gbsQueueVisualStateHook = true;
  }

  function syncHoverCardToggleVisuals(doc) {
    doc.querySelectorAll('.entity-v3-hover-card-popover .gux-toggle-wrapper').forEach(wrapper => {
      const toggle = wrapper.querySelector('gux-toggle');
      const control = toggle?.shadowRoot?.querySelector('input[type="checkbox"], [role="switch"]') || toggle;
      const checked = control?.checked === true
        || control?.getAttribute?.('aria-checked') === 'true'
        || control?.getAttribute?.('checked') !== null
        || toggle?.getAttribute?.('value') === 'true';
      wrapper.classList.toggle('gbs-toggle-on', Boolean(checked));
      let label = wrapper.querySelector(':scope > .gbs-popup-queue-label');
      if (!label) {
        label = doc.createElement('span');
        label.className = 'gbs-popup-queue-label';
        label.setAttribute('aria-hidden', 'true');
        wrapper.appendChild(label);
      }
      label.textContent = checked ? 'On Queue' : 'Off Queue';
    });
  }

  function applyNoActiveConversationsRatio(rail, ratio) {
    // The idle pane and active call share a flex rail. Its idle ResizeObserver
    // must never overwrite the selected-call split when View opens a call.
    const activeCall = rail.parentElement?.querySelector('.selected-interaction-container');
    if (activeCall && activeCall.getBoundingClientRect().width > 0
      && activeCall.getBoundingClientRect().height > 0) return ratio;
    const layout = rail.parentElement;
    const layoutWidth = layout?.clientWidth || rail.ownerDocument.defaultView.innerWidth || 1200;
    const minimumRatio = Math.min(.8, 240 / layoutWidth);
    const maximumRatio = Math.max(minimumRatio, 1 - (240 / layoutWidth));
    const safeRatio = Math.max(minimumRatio, Math.min(maximumRatio, Number(ratio) || .4));
    // The left rail is the actual flex item. Give it the complement of the
    // stored right-pane ratio, allowing the No active conversations pane to
    // fill all remaining space naturally.
    const width = Math.round(layoutWidth * (1 - safeRatio));
    rail.style.setProperty('--gbs-interaction-rail-width', `${width}px`);
    rail.dataset.gbsNoActiveConversationsRatio = String(safeRatio);
    return safeRatio;
  }

  function createWorkspaceResizeCapture(doc) {
    doc.querySelectorAll('.gbs-workspace-resize-capture').forEach(layer => layer.remove());
    const layer = doc.createElement('div');
    layer.className = 'gbs-workspace-resize-capture';
    layer.setAttribute('aria-hidden', 'true');
    doc.body.appendChild(layer);
    return layer;
  }

  function ensureInteractionQueueResizer(doc) {
    doc.querySelectorAll('.interaction-queue-status-container').forEach(container => {
      const layout = container.closest('.interactions.chat-container');
      const pane = container.closest('.interaction-container');
      const rail = layout?.querySelector(':scope > .left-chat-rail');
      if (!layout || !pane || !rail) return;
      // Clear the previous nested-pane override, then use the proven flex
      // rail target from the earlier working implementation.
      container.classList.remove('gbs-no-active-conversations-resizable');
      pane.classList.remove('gbs-no-active-conversations-resizable');
      pane.style.removeProperty('--gbs-no-active-conversations-width');
      rail.classList.add('gbs-interaction-rail-resizable');
      let handle = container.querySelector(':scope > .gbs-interaction-queue-resizer');
      // A userscript update can leave an old handle mounted until Genesys
      // remounts this pane. Replace it once so its legacy listeners cannot
      // keep intercepting the current ratio-aware implementation.
      if (handle && handle.dataset.gbsResizeRevision !== '6') {
        handle.remove();
        handle = null;
      }
      if (!handle) {
        handle = doc.createElement('div');
        handle.className = 'gbs-interaction-queue-resizer';
        handle.title = 'Drag to resize Conversations and No active conversations';
        handle.setAttribute('role', 'separator');
        handle.setAttribute('aria-orientation', 'vertical');
        handle.innerHTML = '<span class="gbs-resize-grip-button" aria-hidden="true"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 4v16"/><path d="M15 4v16"/></svg></span>';
        container.appendChild(handle);
        const beginDrag = event => {
          event.preventDefault();
          event.stopImmediatePropagation();
          doc.body.classList.add('gbs-interaction-queue-resizing');
          const view = doc.defaultView;
          const captureLayer = createWorkspaceResizeCapture(doc);
          const bounds = layout.getBoundingClientRect();
          const startX = event.clientX;
          const startRightWidth = pane.getBoundingClientRect().width;
          let active = true;
          const onMove = moveEvent => {
            if (!active) return;
            if ((moveEvent.buttons & 1) !== 1) {
              onEnd();
              return;
            }
            const nextRightWidth = startRightWidth + (startX - moveEvent.clientX);
            applyNoActiveConversationsRatio(rail, nextRightWidth / Math.max(1, bounds.width));
          };
          const onEnd = () => {
            if (!active) return;
            active = false;
            doc.body.classList.remove('gbs-interaction-queue-resizing');
            try { doc.defaultView.localStorage.setItem(INTERACTION_RAIL_WIDTH_KEY, rail.dataset.gbsNoActiveConversationsRatio || '0.4'); } catch (_) { /* storage unavailable */ }
            captureLayer.removeEventListener('mousemove', onMove, true);
            captureLayer.removeEventListener('mouseup', onEnd, true);
            view.removeEventListener('blur', onEnd, true);
            captureLayer.remove();
          };
          // The transparent layer remains above embedded iframes, preserving
          // the drag stream even when the pointer crosses into Analytics.
          captureLayer.addEventListener('mousemove', onMove, true);
          captureLayer.addEventListener('mouseup', onEnd, true);
          view.addEventListener('blur', onEnd, true);
        };
        handle.dataset.gbsResizeRevision = '6';
        handle.addEventListener('mousedown', beginDrag, true);
      }
      if (!rail.dataset.gbsNoActiveConversationsRatio) {
        let stored = 0;
        try { stored = Number(doc.defaultView.localStorage.getItem(INTERACTION_RAIL_WIDTH_KEY)); } catch (_) { /* storage unavailable */ }
        // Migrate a legacy pixel value from earlier releases to the same
        // proportion, then persist only the ratio going forward.
        const initialRatio = Number.isFinite(stored) && stored > 0
          // Legacy v330 stored the left-rail pixels; newer releases stored
          // the desired No-active-conversations ratio directly.
          ? (stored > 1
            ? 1 - (stored / Math.max(1, layout.clientWidth))
            : stored)
          // Fresh Agent Workspace starts from an even Call Area / No-active
          // split. A persisted ratio above always represents the user's own
          // divider movement and is never replaced by this default.
          : .5;
        applyNoActiveConversationsRatio(rail, initialRatio);
      }
      if (!rail.__gbsNoActiveConversationsResizeObserver && doc.defaultView.ResizeObserver) {
        let previousLayoutWidth = Math.round(layout.clientWidth);
        const observer = new doc.defaultView.ResizeObserver(() => {
          const nextLayoutWidth = Math.round(layout.clientWidth);
          if (Math.abs(nextLayoutWidth - previousLayoutWidth) < 2) return;
          previousLayoutWidth = nextLayoutWidth;
          applyNoActiveConversationsRatio(rail, Number(rail.dataset.gbsNoActiveConversationsRatio) || .4);
        });
        observer.observe(layout);
        rail.__gbsNoActiveConversationsResizeObserver = observer;
      }
    });
  }

  function ensureSelectedInteractionResizer(doc) {
    doc.querySelectorAll('.interactions.chat-container').forEach(layout => {
      const rail = layout.querySelector(':scope > .left-chat-rail');
      const pane = layout.querySelector(':scope > .interaction-container');
      const selected = pane?.querySelector(':scope > .selected-interaction-container > .acd-interaction');
      if (!rail || !pane || !selected) return;
      rail.classList.add('gbs-interaction-rail-resizable');
      pane.classList.add('gbs-selected-interaction-resizable');
      let handle = pane.querySelector(':scope > .gbs-selected-interaction-resizer');
      if (handle && handle.dataset.gbsResizeRevision !== '1') {
        handle.remove();
        handle = null;
      }
      if (!handle) {
        handle = doc.createElement('div');
        handle.className = 'gbs-selected-interaction-resizer';
        handle.title = 'Drag to resize Conversations and selected interaction';
        handle.setAttribute('role', 'separator');
        handle.setAttribute('aria-orientation', 'vertical');
        handle.innerHTML = '<span class="gbs-resize-grip-button" aria-hidden="true"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 4v16"/><path d="M15 4v16"/></svg></span>';
        pane.appendChild(handle);
        const beginDrag = event => {
          event.preventDefault();
          event.stopImmediatePropagation();
          const view = doc.defaultView;
          const bounds = layout.getBoundingClientRect();
          const startX = event.clientX;
          const startWidth = pane.getBoundingClientRect().width;
          const captureLayer = createWorkspaceResizeCapture(doc);
          let active = true;
          const apply = width => {
            const min = Math.min(.8, 240 / Math.max(1, bounds.width));
            const max = Math.max(min, 1 - (240 / Math.max(1, bounds.width)));
            const ratio = Math.max(min, Math.min(max, width / Math.max(1, bounds.width)));
            rail.style.setProperty('--gbs-interaction-rail-width', `${Math.round(bounds.width * (1 - ratio))}px`);
            rail.dataset.gbsSelectedInteractionRatio = String(ratio);
          };
          const onMove = moveEvent => {
            if (!active) return;
            if ((moveEvent.buttons & 1) !== 1) return onEnd();
            apply(startWidth + (startX - moveEvent.clientX));
          };
          const onEnd = () => {
            if (!active) return;
            active = false;
            writePersistentNumber(doc, SELECTED_INTERACTION_RATIO_KEY, Number(rail.dataset.gbsSelectedInteractionRatio) || .74);
            captureLayer.removeEventListener('mousemove', onMove, true);
            captureLayer.removeEventListener('mouseup', onEnd, true);
            view.removeEventListener('blur', onEnd, true);
            captureLayer.remove();
          };
          captureLayer.addEventListener('mousemove', onMove, true);
          captureLayer.addEventListener('mouseup', onEnd, true);
          view.addEventListener('blur', onEnd, true);
        };
        handle.dataset.gbsResizeRevision = '1';
        handle.addEventListener('mousedown', beginDrag, true);
      }
      if (!rail.dataset.gbsSelectedInteractionRatio) {
        const stored = readPersistentNumber(doc, SELECTED_INTERACTION_RATIO_KEY);
        // Corrected screenshot default: Conversations 26%, selected call area 74%.
        const ratio = Number.isFinite(stored) && stored > 0 && stored < 1 ? stored : .74;
        const width = layout.clientWidth * ratio;
        rail.style.setProperty('--gbs-interaction-rail-width', `${Math.round(layout.clientWidth - width)}px`);
        rail.dataset.gbsSelectedInteractionRatio = String(ratio);
      }
      // Reassert the active split after native layout/outer workspace resizing.
      // Dragging updates this same dataset, so the user's movement is preserved.
      const activeRatio = Number(rail.dataset.gbsSelectedInteractionRatio) || .74;
      const targetRailWidth = `${Math.round(layout.clientWidth * (1 - activeRatio))}px`;
      if (rail.style.getPropertyValue('--gbs-interaction-rail-width') !== targetRailWidth) {
        rail.style.setProperty('--gbs-interaction-rail-width', targetRailWidth);
      }
    });
  }

  let activeCallSummary = null;
  let lastCallSummary = null;
  function callClock(value) {
    return new Intl.DateTimeFormat(undefined, {
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    }).format(new Date(value));
  }
  function syncLastCallDataPopup(doc, wrapup) {
    if (window !== window.top) { doc.getElementById('gbs-last-call-data')?.remove(); return; }
    let popup = doc.getElementById('gbs-last-call-data');
    if (!lastCallSummary || lastCallSummary.dismissed || Date.now() - lastCallSummary.endedAt < 25000) { popup?.remove(); return; }
    if (popup?.__gbsDragging) return;
    const liveDuration = wrapup?.querySelector('[data-testid="wrapup-header-message-duration"]')?.textContent?.trim();
    if (liveDuration && /^\d{1,2}:\d{2}$/.test(liveDuration)) {
      const [minutes, seconds] = liveDuration.split(':').map(Number);
      lastCallSummary.wrapupSeconds = minutes * 60 + seconds;
      lastCallSummary.wrapupObservedAt = Date.now();
    }
    if (!popup) {
      popup = doc.createElement('section');
      popup.id = 'gbs-last-call-data';
      popup.setAttribute('aria-label', 'Last call data');
      popup.style.cssText = 'position:fixed;right:20px;top:80px;width:300px;max-width:calc(100vw - 24px);max-height:70vh;overflow:auto;z-index:2147483643;background:#1d2228;color:#e7f5f8;border:1px solid #22d3ee;border-radius:12px;box-shadow:0 0 16px #22d3ee35;font:14px/1.5 system-ui;';
      doc.body.appendChild(popup);
    }
    const heading = doc.createElement('div');
    heading.style.cssText = 'padding:12px 16px;border-bottom:1px solid #22d3ee70;color:#67e8f9;font-weight:600;user-select:none;cursor:move;touch-action:none';
    heading.textContent = `Last call data - ${callClock(lastCallSummary.startedAt)} until ${callClock(lastCallSummary.endedAt)}`;
    const close = doc.createElement('button'); close.type = 'button'; close.textContent = '×'; close.setAttribute('aria-label', 'Close last call data');
    close.style.cssText = 'float:right;background:transparent;border:0;color:inherit;font-size:20px;cursor:pointer';
    close.addEventListener('click', () => {lastCallSummary.dismissed = true; popup.remove();}); heading.append(close);
    heading.addEventListener('pointerdown', event => {
      if (event.button !== 0 || event.target === close) return;
      event.preventDefault(); const rect = popup.getBoundingClientRect(), x = event.clientX, y = event.clientY;
      popup.__gbsDragging = true; heading.setPointerCapture(event.pointerId);
      popup.style.setProperty('transition', 'none', 'important');
      const move = e => {
        if (!(e.buttons & 1)) return end();
        popup.style.right = 'auto';
        popup.style.left = `${Math.max(0, Math.min(doc.defaultView.innerWidth - rect.width, rect.left + e.clientX - x))}px`;
        popup.style.top = `${Math.max(0, Math.min(doc.defaultView.innerHeight - 40, rect.top + e.clientY - y))}px`;
      };
      const end = () => {
        popup.__gbsDragging = false;
        heading.removeEventListener('pointermove', move); heading.removeEventListener('pointerup', end);
        heading.removeEventListener('pointercancel', end); heading.removeEventListener('lostpointercapture', end);
        doc.defaultView.removeEventListener('blur', end);
      };
      heading.addEventListener('pointermove', move); heading.addEventListener('pointerup', end);
      heading.addEventListener('pointercancel', end); heading.addEventListener('lostpointercapture', end);
      doc.defaultView.addEventListener('blur', end);
    });
    const body = doc.createElement('div'); body.style.padding = '12px 16px';
    for (const [label, value] of lastCallSummary.details) {
      const row = doc.createElement('div'); row.style.cssText = 'margin-bottom:8px;overflow-wrap:anywhere';
      const title = doc.createElement('div'); title.textContent = label; title.style.cssText = 'color:#8fb2bd;font-size:12px';
      const content = doc.createElement('div'); content.textContent = value;
      row.append(title, content); body.appendChild(row);
    }
    if (Number.isFinite(lastCallSummary.wrapupSeconds)) {
      const elapsed = Math.floor((Date.now() - lastCallSummary.wrapupObservedAt) / 1000);
      const remaining = Math.max(0, lastCallSummary.wrapupSeconds - elapsed);
      const row = doc.createElement('div'); row.style.cssText = 'margin-top:10px;padding-top:10px;border-top:1px solid #22d3ee40';
      const title = doc.createElement('div'); title.textContent = 'After Call Work'; title.style.cssText = 'color:#8fb2bd;font-size:12px';
      const value = doc.createElement('div');
      value.textContent = `${String(Math.floor(remaining / 60)).padStart(2, '0')}:${String(remaining % 60).padStart(2, '0')}`;
      value.setAttribute('role', 'timer');
      value.style.userSelect = 'none';
      row.append(title, value); body.appendChild(row);
    }
    popup.replaceChildren(heading, body);
  }

  function syncCallInformationPopup(doc) {
    if (window !== window.top) {
      doc.getElementById('gbs-last-call-data')?.remove();
      doc.getElementById('gbs-call-information')?.remove();
      return;
    }
    // Customer details stay in the live DOM only; never persist or transmit them.
    const visible = element => element && element.getBoundingClientRect().width > 0
      && element.getBoundingClientRect().height > 0;
    const incomingAction = doc.querySelector('.messenger-shown [data-action="answerInteraction"]');
    // The native Genesys Answer action is the authoritative ringing signal in
    // normal operation too. Restrict only the synthetic fallback to call-test
    // mode; otherwise a real selected interaction is mislabeled Connected and
    // exposes Mute/Hold/Hang up before the agent has answered it.
    const incoming = Boolean(incomingAction) || (callTestEnabled(doc) && Boolean(testCallSession
      && !testCallSession.answeredAt && !testCallSession.finishedAt && !testCallSession.timeoutAt));
    const selected = [...doc.querySelectorAll('.selected-interaction-container')].find(visible);
    const wrapup = [...doc.querySelectorAll('[data-testid="wrapup-main-container"]')].find(visible);
    let popup = doc.getElementById('gbs-call-information');
    if ((!selected || wrapup) && !incoming) {
      // Panel disappearance is not an explicit Disconnected transition.
      syncLastCallDataPopup(doc, wrapup);
      if (popup && testCallSession && !testCallSession.finishedAt) {
        testCallSession.finishedAt = new Date().toISOString();
        testCallSession.popupVisibleMs = Date.now() - testCallSession.startedMs;
        persistTestCall();
      }
      popup?.remove(); return;
    }
    if (popup?.__gbsDragging) return;
    const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
    const details = new Map();
    const documents = [doc];
    const visit = (root, depth = 0) => {
      if (depth > 3) return;
      root.querySelectorAll('iframe').forEach(frame => {
        try {
          const nested = accessibleFrameDocument(frame);
          if (nested && !documents.includes(nested)) { documents.push(nested); visit(nested, depth + 1); }
        } catch (_) { /* Cross-origin details are unavailable, not guessed. */ }
      });
    };
    if (selected) visit(selected);
    const scopes = [selected || incomingAction?.closest('.messenger-message'), ...documents.slice(1).map(frame => frame.body).filter(Boolean)].filter(Boolean);
    const add = (label, value) => {
      value = clean(value);
      if (value && value.length < 300 && !details.has(label)) details.set(label, value);
    };
    for (const scope of scopes) {
      const text = scope.innerText || '';
      const phone = text.match(/(?:tel:)?\+\d[\d ()-]{6,}\d/);
      if (phone) add('Phone number', phone[0].replace(/^tel:/, ''));
      for (const label of ['Interaction State', 'Queue Name', "Customer's Number", 'Customer Name', 'Country', 'Location']) {
        const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const match = text.match(new RegExp(escaped + '\\s*:\\s*([^\\n]+)', 'i'));
        if (match) add(label === "Customer's Number" ? 'Phone number' : label, match[1]);
      }
    }
    const roster = [...doc.querySelectorAll('.interaction-group.is-selected')].find(visible);
    if (roster) {
      add('Caller / location', roster.querySelector('.participant-name')?.textContent);
      add('Queue Name', roster.querySelector('.int-queue')?.textContent);
    }
    // Header often provides the number's country, not a verified physical location.
    add('Call label', selected?.querySelector('.participant-name, .interaction-name')?.textContent);
    const state = incoming ? 'Incoming' : details.get('Interaction State') || '';
    details.delete('Interaction State');
    const seenValues = new Set();
    for (const [label, value] of details) {
      const key = /^\+?[\d ()-]+$/.test(value.replace(/^tel:/, ''))
        ? value.replace(/\D/g, '') : value.toLocaleLowerCase();
      if (seenValues.has(key)) details.delete(label);
      else seenValues.add(key);
    }
    if (!activeCallSummary) activeCallSummary = { ringingAt: Date.now(), connectedAt: null, details: [] };
    if (/^disconnected$/i.test(state)) {
      if (activeCallSummary.connectedAt) {
        lastCallSummary = { startedAt: activeCallSummary.connectedAt, endedAt: Date.now(),
          details: details.size ? [...details] : activeCallSummary.details, wrapupSeconds: null, wrapupObservedAt: Date.now() };
        activeCallSummary = null;
      }
      popup?.remove(); syncLastCallDataPopup(doc, wrapup); return;
    }
    if (!incoming && /^connected$/i.test(state) && !activeCallSummary.connectedAt) activeCallSummary.connectedAt = Date.now();
    activeCallSummary.details = [...details];
    doc.getElementById('gbs-last-call-data')?.remove();
    if (!popup) {
      popup = doc.createElement('section');
      popup.id = 'gbs-call-information';
      popup.setAttribute('aria-label', 'Current call information');
      popup.style.cssText = 'position:fixed;right:20px;top:80px;width:300px;max-width:calc(100vw - 24px);max-height:70vh;overflow:auto;z-index:2147483644;background:#1d2228;color:#e7f5f8;border:1px solid #22d3ee;border-radius:12px;box-shadow:0 0 16px #22d3ee35;font:14px/1.5 system-ui;';
      const heading = doc.createElement('div');
      heading.textContent = 'Call information';
      heading.className = 'gbs-call-information-heading';
      heading.style.cssText = 'padding:12px 16px;border-bottom:1px solid #22d3ee70;color:#67e8f9;font-weight:600;cursor:move;touch-action:none;user-select:none;';
      const body = doc.createElement('div');
      body.className = 'gbs-call-information-body';
      body.style.padding = '12px 16px';
      popup.append(heading, body);
      doc.body.appendChild(popup);
      popup.addEventListener('pointermove', event => {
        if (event.pointerType !== 'mouse' || !testCallSession || testCallSession.hovered) return;
        testCallSession.hovered = true; testCallSession.firstHoverAt = new Date().toISOString(); persistTestCall();
      });
      // Native global transitions must not interpolate pointer coordinates.
      popup.style.setProperty('transition', 'none', 'important');
      popup.style.setProperty('animation', 'none', 'important');
      heading.addEventListener('pointerdown', event => {
        if (event.button !== 0) return;
        event.preventDefault();
        const bounds = popup.getBoundingClientRect();
        popup.__gbsDragging = true;
        const offsetX = event.clientX - bounds.left, offsetY = event.clientY - bounds.top;
        const maxX = Math.max(0, doc.defaultView.innerWidth - bounds.width);
        const maxY = Math.max(0, doc.defaultView.innerHeight - 50);
        let x = bounds.left, y = bounds.top, frame = 0;
        popup.style.right = 'auto';
        popup.style.left = `${bounds.left}px`;
        popup.style.top = `${bounds.top}px`;
        popup.style.setProperty('will-change', 'transform');
        popup.style.setProperty('contain', 'layout paint');
        const paint = () => {
          frame = 0;
          popup.style.setProperty('transform', `translate3d(${x - bounds.left}px,${y - bounds.top}px,0)`, 'important');
        };
        // Pointer capture avoids inserting a viewport-sized layer on every
        // drag. That layer forced Genesys to repaint its full application and
        // made a compositor-only card transform feel severely delayed.
        const pointerId = event.pointerId;
        heading.setPointerCapture(pointerId);
        let active = true;
        const end = () => {
          if (!active) return;
          active = false;
          popup.__gbsDragging = false;
          if (heading.hasPointerCapture(pointerId)) heading.releasePointerCapture(pointerId);
          if (frame) doc.defaultView.cancelAnimationFrame(frame);
          popup.style.left = `${x}px`;
          popup.style.top = `${y}px`;
          popup.style.setProperty('transform', 'none', 'important');
          popup.style.removeProperty('will-change');
          popup.style.removeProperty('contain');
          heading.removeEventListener('pointermove', move);
          heading.removeEventListener('pointerup', end);
          heading.removeEventListener('pointercancel', end);
          heading.removeEventListener('lostpointercapture', end);
          doc.defaultView.removeEventListener('blur', end);
        };
        const move = moveEvent => {
          if (!active) return;
          if (!(moveEvent.buttons & 1)) { end(); return; }
          const samples = moveEvent.getCoalescedEvents?.() || [moveEvent];
          const latest = samples[samples.length - 1];
          x = Math.max(0, Math.min(maxX, latest.clientX - offsetX));
          y = Math.max(0, Math.min(maxY, latest.clientY - offsetY));
          if (!frame) frame = doc.defaultView.requestAnimationFrame(paint);
        };
        heading.addEventListener('pointermove', move);
        heading.addEventListener('pointerup', end);
        heading.addEventListener('pointercancel', end);
        heading.addEventListener('lostpointercapture', end);
        doc.defaultView.addEventListener('blur', end);
      });
    }
    const snowAction = scopes.flatMap(scope => [...scope.querySelectorAll('a,button,input[type="button"]')])
      .find(element => visible(element) && /open in snow/i.test(element.textContent || element.value || ''));
    popup.__gbsSnowAction = snowAction;
    const callControls = [
      { selector: 'button.interaction-mute-btn', fallback: 'Mute' },
      { selector: 'button.interaction-hold-btn', fallback: 'Hold' },
      { selector: 'button.interaction-end-btn', fallback: 'Hang up', hangup: true }
    ].map(control => {
      const native = selected?.querySelector(control.selector);
      return { ...control, native, label: control.hangup ? 'Hang up' : native?.getAttribute('aria-label') || control.fallback };
    });
    const signature = JSON.stringify([...details]) + state + Boolean(snowAction)
      + (incoming ? Math.floor((Date.now() - (testCallSession?.startedMs || Date.now())) / 1000) : '')
      + JSON.stringify(callControls.map(control => [control.label, Boolean(control.native), control.native?.disabled, control.native?.getAttribute('aria-pressed')]));
    if (popup.dataset.details === signature) return;
    popup.dataset.details = signature;
    if (testCallSession && !testCallSession.finishedAt) {
      testCallSession.details = Object.fromEntries(details);
      testCallSession.phoneNumber = details.get('Phone number') || null;
      testCallSession.country = details.get('Country') || null;
      testCallSession.callerLocationLabel = details.get('Caller / location') || details.get('Call label') || details.get('Location') || null;
      persistTestCall();
    }
    const heading = popup.querySelector('.gbs-call-information-heading');
    heading.replaceChildren(doc.createTextNode('Call information '));
    if (state) {
      const badge = doc.createElement('span');
      badge.textContent = state;
      const color = state.toLowerCase() === 'connected' ? '#22ff88' : '#a0a8b0';
      badge.style.cssText = `display:inline-block;margin-left:8px;padding:1px 5px;border:1px solid ${color};border-radius:4px;color:${color};font-size:12px;box-shadow:0 0 4px ${color}40;`;
      heading.appendChild(badge);
    }
    const body = popup.querySelector('.gbs-call-information-body');
    body.replaceChildren();
    if (!details.size) body.textContent = 'Waiting for call details…';
    for (const [label, value] of details) {
      const row = doc.createElement('div');
      row.style.cssText = 'margin-bottom:8px;overflow-wrap:anywhere';
      const title = doc.createElement('div');
      title.textContent = label;
      title.style.cssText = 'color:#8fb2bd;font-size:12px';
      const content = doc.createElement('div');
      content.textContent = value;
      row.append(title, content);
      body.appendChild(row);
    }
    if (incoming || snowAction || callTestEnabled(doc)) {
      const button = doc.createElement('button');
      button.type = 'button';
      button.textContent = 'Open in SNOW';
      button.style.cssText = 'padding:8px 12px;background:#22343b;color:#a5f3fc;border:1px solid #22d3ee;border-radius:5px;cursor:pointer';
      button.addEventListener('click', () => {
        const action = popup.__gbsSnowAction;
        if (action?.isConnected && visible(action)) action.click();
        else if (callTestEnabled(doc)) doc.defaultView.open(SNOW_NEW_CALL_URL, '_blank', 'noopener');
      });
      body.appendChild(button);
    }
    const controls = doc.createElement('div');
    controls.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin-top:12px;padding-top:12px;border-top:1px solid #22d3ee40';
    if (incoming) {
      const answer = doc.createElement('button'); answer.type = 'button'; answer.textContent = 'Answer';
      answer.style.cssText = 'padding:8px 12px;background:#243039;color:#22ff88;border:1px solid #22ff88;border-radius:6px;cursor:pointer';
      answer.addEventListener('click', () => {
        const native = doc.querySelector('.messenger-shown [data-action="answerInteraction"] a')
          || selected?.querySelector('button[aria-label="Answer"]')
          || (testNativeAnswer?.isConnected ? testNativeAnswer : null);
        if (native && !native.disabled) {
          if (testCallSession) {
            testCallSession.answeredAt = new Date().toISOString();
            testCallSession.ringingDurationMs = Date.now() - testCallSession.startedMs;
            testCallSession.outcome = 'answer-clicked'; persistTestCall();
          }
          native.click();
        } else {
          answer.textContent = 'Answer unavailable'; answer.disabled = true;
        }
      });
      controls.appendChild(answer);
      const snow = [...body.querySelectorAll('button')].find(button => button.textContent === 'Open in SNOW');
      if (snow) { snow.style.marginLeft = 'auto'; controls.appendChild(snow); }
      const ringingStartedAt = testCallSession?.startedMs || activeCallSummary?.ringingAt || Date.now();
      const timer = doc.createElement('div'); timer.textContent = `${Math.max(0, 29 - Math.floor((Date.now() - ringingStartedAt) / 1000))}s to answer`;
      timer.style.cssText = 'width:100%;color:#a0a8b0;font-size:12px;user-select:none'; controls.prepend(timer);
    }
    for (const control of incoming ? [] : callControls) {
      const button = doc.createElement('button');
      button.type = 'button';
      button.textContent = control.label;
      button.disabled = !control.native || control.native.disabled || control.native.getAttribute('aria-disabled') === 'true';
      const pressed = control.native?.getAttribute('aria-pressed');
      if (pressed !== null && pressed !== undefined) button.setAttribute('aria-pressed', pressed);
      const color = control.hangup ? '#fb7185' : '#22d3ee';
      button.style.cssText = `padding:8px 12px;background:#243039;color:${color};border:1px solid ${color};border-radius:6px;cursor:pointer;opacity:${button.disabled ? '.45' : '1'}`;
      button.addEventListener('click', () => {
        // Resolve the current native button, not a stale Ember node. Never
        // duplicate its business logic or submit a second action ourselves.
        const current = [...doc.querySelectorAll('.selected-interaction-container')].find(visible);
        const action = current?.querySelector(control.selector);
        if (!action || action.disabled || action.getAttribute('aria-disabled') === 'true') return;
        if (control.hangup && !doc.defaultView.confirm('Are you sure you want to hang up this call?')) return;
        action.click();
        button.disabled = true;
        doc.defaultView.setTimeout(() => {
          if (popup.isConnected) { delete popup.dataset.details; syncCallInformationPopup(doc); }
        }, 200);
      });
      controls.appendChild(button);
    }
    body.appendChild(controls);
  }

  function closeWorkspaceAfterCallEnds(doc) {
    const panel = doc.querySelector('.command-panel.active.agent');
    if (!panel || panel.classList.contains('hidden')) return;
    const wrapup = panel.querySelector('[data-testid="wrapup-main-container"]');
    const activeCall = panel.querySelector('.selected-interaction-container .acd-interaction, .selected-interaction-container [class*="interaction-grid"]');
    if (activeCall && !wrapup) {
      panel.dataset.gbsHadSelectedInteraction = 'true';
      if (panel.__gbsCallEndCloseTimer) {
        doc.defaultView.clearTimeout(panel.__gbsCallEndCloseTimer);
        panel.__gbsCallEndCloseTimer = 0;
      }
      return;
    }
    // Only react after a real selected interaction was present. This prevents
    // a manually opened empty Workspace from being closed on initial mount.
    if (panel.dataset.gbsHadSelectedInteraction !== 'true' || panel.__gbsCallEndCloseTimer) return;
    panel.__gbsCallEndCloseTimer = doc.defaultView.setTimeout(() => {
      panel.__gbsCallEndCloseTimer = 0;
      if (!panel.isConnected || panel.querySelector('.selected-interaction-container .acd-interaction, .selected-interaction-container [class*="interaction-grid"]')) return;
      delete panel.dataset.gbsHadSelectedInteraction;
      panel.querySelector('#panel-agent-close-button')?.click();
    }, 450);
  }

  function applyAgentWorkspaceRatio(panel, ratio) {
    const viewWidth = panel.ownerDocument.defaultView.innerWidth || 1200;
    const minimumRatio = Math.min(.9, 500 / viewWidth);
    // Workspace may occupy at most 60% of the viewport, retaining at least
    // the complementary 40% Homepage area. On very narrow screens the native
    // 500px accessibility floor necessarily wins over that proportional cap.
    const maximumRatio = Math.max(minimumRatio, .60);
    const safeRatio = Math.max(minimumRatio, Math.min(maximumRatio, Number(ratio) || (defaultAgentWorkspaceWidth(panel.ownerDocument) / viewWidth)));
    const safeWidth = Math.round(viewWidth * safeRatio);
    panel.style.setProperty('--gbs-agent-workspace-width', `${safeWidth}px`);
    panel.dataset.gbsAgentWorkspaceRatio = String(safeRatio);
    writePersistentNumber(panel.ownerDocument, AGENT_PANEL_WIDTH_KEY, safeRatio);
    // Resize the paired analytics frame in the same pointer event rather than
    // waiting for the periodic synchronizer.
    syncAnalyticsHostWidth(panel.ownerDocument);
    return safeRatio;
  }

  function defaultAgentWorkspaceWidth(doc) {
    // Measured compact Workspace layout: 36% Workspace / 64% Homepage. Round
    // this to a calm, memorable 35:65 first-use default; saved user ratios are
    // still restored without being changed by this fallback.
    return Math.min(760, Math.max(500, Math.round((doc.defaultView.innerWidth || 1200) * .35)));
  }

  function savedAgentWorkspaceRatio(doc) {
    const stored = readPersistentNumber(doc, AGENT_PANEL_WIDTH_KEY);
    const width = doc.defaultView.innerWidth || 1200;
    // Migrate legacy saved pixels to a ratio. Reject an accidentally persisted
    // native-expanded value and retain the compact default instead.
    const ratio = stored > 1 ? stored / width : stored;
    return Number.isFinite(ratio) && ratio >= (500 / width) && ratio <= .60
      ? ratio
      : (defaultAgentWorkspaceWidth(doc) / width);
  }

  function syncAnalyticsHostWidth(doc, requestedPanelWidth = 0) {
    if (callTestEnabled(doc)) requestedPanelWidth = 0;
    const hosts = [...doc.querySelectorAll('.application-scroll')]
      .filter(host => host.querySelector('frame-router.main-iframe, .main-iframe'));
    const panel = doc.querySelector('.command-panel.active.agent');
    const panelVisible = !callTestEnabled(doc) && Boolean(panel && panel.getBoundingClientRect().width > 0 && !panel.classList.contains('hidden'));
    const panelWidth = Number(requestedPanelWidth)
      || (Number(panel?.dataset.gbsAgentWorkspaceRatio) * (doc.defaultView.innerWidth || 0))
      || parseFloat(panel?.style.getPropertyValue('--gbs-agent-workspace-width'))
      || panel?.getBoundingClientRect().width || 0;
    hosts.forEach(host => {
      const stage = host.closest('main.center-stage');
      if (!stage || (panel && agentWorkspaceIsFullscreen(panel))) {
        ['width', 'flex', 'max-width', 'float'].forEach(property => {
          if (host.style.getPropertyValue(property)) host.style.removeProperty(property);
        });
        return;
      }
      // Keep every center-stage iframe app—not only Analytics—inside the
      // shared left-side Homepage area while Workspace is visible.
      const stageLeft = Math.max(0, stage.getBoundingClientRect().left);
      const available = (panelVisible || requestedPanelWidth > 0) && panelWidth
        ? Math.max(320, Math.round(doc.defaultView.innerWidth - stageLeft - panelWidth))
        : Math.max(320, Math.round(doc.defaultView.innerWidth - stageLeft));
      const setStable = (property, value) => {
        if (host.style.getPropertyValue(property) !== value) host.style.setProperty(property, value, 'important');
      };
      setStable('width', `${available}px`);
      setStable('max-width', `${available}px`);
      setStable('flex', `0 0 ${available}px`);
      setStable('float', 'left');
    });
  }

  function agentWorkspaceIsFullscreen(panel) {
    // Fullscreen deliberately is not supported: it removes the Homepage.
    return false;
  }

  function beginAgentWorkspaceTransition(doc) {
    const body = doc?.body;
    if (!body) return;
    body.classList.add('gbs-agent-workspace-transitioning');
    if (body.__gbsAgentWorkspaceTransitionTimer) doc.defaultView.clearTimeout(body.__gbsAgentWorkspaceTransitionTimer);
    body.__gbsAgentWorkspaceTransitionTimer = doc.defaultView.setTimeout(() => {
      body.classList.remove('gbs-agent-workspace-transitioning');
      body.__gbsAgentWorkspaceTransitionTimer = 0;
    }, 430);
  }

  function agentWorkspaceToggle(doc) {
    return doc.querySelector('[data-test-id="command-bar-agent"], button[aria-label="Agent Workspace"]');
  }

  function createAgentWorkspaceOrb(doc, from, to, duration = 170) {
    const orb = doc.createElement('div');
    orb.className = 'gbs-agent-workspace-orb';
    orb.style.left = `${from.x}px`;
    orb.style.top = `${from.y}px`;
    // Escape the command bar's stacking context so the orb is visible from
    // the moment it leaves the Agent Workspace button.
    doc.documentElement.appendChild(orb);
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    orb.animate([
      { transform: 'translate(0, 0) scale(.58)', opacity: .35 },
      { transform: `translate(${dx}px, ${dy}px) scale(1)`, opacity: 1 },
    ], { duration, easing: 'cubic-bezier(.22,.78,.25,1)', fill: 'forwards' });
    return orb;
  }

  function startAgentWorkspaceOpenAnimation(doc, toggle) {
    const body = doc.body;
    if (!body || body.dataset.gbsAgentWorkspaceOpening === 'true') return;
    const targetWidth = Math.round(savedAgentWorkspaceRatio(doc) * (doc.defaultView.innerWidth || 1200));
    const sourceRect = toggle?.getBoundingClientRect();
    const source = sourceRect
      ? { x: sourceRect.left + sourceRect.width / 2, y: sourceRect.top + sourceRect.height / 2 }
      : { x: doc.defaultView.innerWidth - 30, y: 28 };
    const target = { x: doc.defaultView.innerWidth - targetWidth / 2, y: doc.defaultView.innerHeight / 2 };
    body.dataset.gbsAgentWorkspaceOpening = 'true';
    body.classList.add('gbs-agent-workspace-opening');
    beginAgentWorkspaceTransition(doc);
    // Shrink HOMEpage toward its final left-side width before revealing the
    // panel. This uses the same saved width that the real panel will receive.
    syncAnalyticsHostWidth(doc, targetWidth);
    const orb = createAgentWorkspaceOrb(doc, source, target);
    doc.defaultView.setTimeout(() => {
      if (!orb.isConnected) return;
      orb.classList.add('gbs-orb-burst');
      doc.defaultView.setTimeout(() => orb.remove(), 190);
    }, 165);
    // Genesys occasionally cancels a Workspace mount (for example while its
    // native panel state is still settling). Never leave the entire page in
    // the hidden opening state in that case.
    doc.defaultView.setTimeout(() => {
      if (!body.classList.contains('gbs-agent-workspace-opening')) return;
      if (doc.querySelector('.command-panel.active.agent')) return;
      body.classList.remove('gbs-agent-workspace-opening');
      delete body.dataset.gbsAgentWorkspaceOpening;
      doc.querySelectorAll('.gbs-agent-workspace-orb').forEach(item => item.remove());
      syncAnalyticsHostWidth(doc);
    }, 650);
  }

  function revealAgentWorkspaceAfterOpening(panel) {
    const doc = panel.ownerDocument;
    const body = doc.body;
    if (!body?.classList.contains('gbs-agent-workspace-opening') || panel.dataset.gbsAgentWorkspaceRevealed === 'true') return;
    panel.dataset.gbsAgentWorkspaceRevealed = 'true';
    // Let the left-side homepage complete its first movement before the panel
    // bursts from the orb. The panel is already correctly sized behind this.
    doc.defaultView.setTimeout(() => {
      if (!panel.isConnected) return;
      panel.classList.add('gbs-agent-workspace-revealing');
      body.classList.remove('gbs-agent-workspace-opening');
      delete body.dataset.gbsAgentWorkspaceOpening;
      doc.defaultView.setTimeout(() => {
        panel.classList.remove('gbs-agent-workspace-revealing');
        delete panel.dataset.gbsAgentWorkspaceRevealed;
      }, 230);
    }, 170);
  }

  function startAgentWorkspaceCloseAnimation(doc, panel, toggle, closeControl) {
    if (!panel || panel.dataset.gbsAgentWorkspaceClosing === 'true') return;
    panel.dataset.gbsAgentWorkspaceClosing = 'true';
    beginAgentWorkspaceTransition(doc);
    const panelRect = panel.getBoundingClientRect();
    const source = { x: panelRect.left + panelRect.width / 2, y: panelRect.top + panelRect.height / 2 };
    const toggleRect = toggle?.getBoundingClientRect();
    const target = toggleRect
      ? { x: toggleRect.left + toggleRect.width / 2, y: toggleRect.top + toggleRect.height / 2 }
      : { x: doc.defaultView.innerWidth - 30, y: 28 };
    const orb = createAgentWorkspaceOrb(doc, source, target, 190);
    panel.classList.add('gbs-agent-workspace-closing');
    doc.defaultView.setTimeout(() => {
      orb.remove();
      closeControl.dataset.gbsAgentWorkspaceAnimationClose = 'true';
      closeControl.click();
      delete closeControl.dataset.gbsAgentWorkspaceAnimationClose;
    }, 155);
  }

  function releaseAgentWorkspaceResize(panel) {
    panel.classList.remove('gbs-agent-workspace-resizable');
    panel.style.removeProperty('--gbs-agent-workspace-width');
    panel.querySelector(':scope > .gbs-agent-workspace-resizer')?.remove();
    syncAnalyticsHostWidth(panel.ownerDocument);
  }

  function removeAgentWorkspaceResizeHandle(panel) {
    panel.querySelector(':scope > .gbs-agent-workspace-resizer')?.remove();
  }

  function cleanupInactiveAgentWorkspaceResizers(doc) {
    // Genesys preserves the closed Workspace as `.panel-not-active` and keeps
    // its hidden wrapper in the DOM. This path deliberately starts from our
    // handle instead of `.active.agent`, which no longer matches after Close.
    doc.querySelectorAll('.gbs-agent-workspace-resizer').forEach(handle => {
      const panel = handle.closest('.command-panel');
      const isInactive = !panel
        || panel.classList.contains('panel-not-active')
        || Boolean(panel.querySelector(':scope > .command-panel-wrapper.hidden, :scope > .command-panel-wrapper[aria-hidden="true"]'));
      if (isInactive) {
        if (panel) releaseAgentWorkspaceResize(panel);
        else handle.remove();
      }
    });
  }

  function ensureAgentWorkspaceResizer(doc) {
    if (callTestEnabled(doc)) return;
    cleanupInactiveAgentWorkspaceResizers(doc);
    doc.querySelectorAll('.command-panel.active.agent').forEach(panel => {
      // A hidden native panel node is retained in the DOM after Close. Do not
      // recreate our splitter on that retained node.
      const toggle = agentWorkspaceToggle(doc);
      if (toggle && toggle.getAttribute('aria-expanded') !== 'true') {
        releaseAgentWorkspaceResize(panel);
        return;
      }
      if (!panel.getBoundingClientRect().width) return;
      const fullscreenControl = panel.querySelector('#panel-agent-expand-button');
      if (fullscreenControl && !fullscreenControl.dataset.gbsResizeReleaseHook) {
        fullscreenControl.dataset.gbsResizeReleaseHook = 'true';
        // Keep the unsupported native fullscreen control visually hidden.
        fullscreenControl.setAttribute('aria-hidden', 'true');
      }
      if (fullscreenControl?.getAttribute('aria-label')?.startsWith('Collapse')) {
        scheduleNativeAgentWorkspaceCompact(panel);
        return;
      }
      const closeControl = panel.querySelector('#panel-agent-close-button');
      if (closeControl && !closeControl.dataset.gbsLayoutReleaseHook) {
        closeControl.dataset.gbsLayoutReleaseHook = 'true';
        // Genesys updates the panel's state after its click handler. Run once
        // immediately and once after that state change instead of waiting for
        // the periodic pass to give the dashboard its space back.
        closeControl.addEventListener('click', event => {
          // Keep the real panel visible long enough to complete its reverse
          // bubble motion. The marked synthetic click below then invokes the
          // native Genesys close handler exactly once.
          if (closeControl.dataset.gbsAgentWorkspaceAnimationClose !== 'true') {
            event.preventDefault();
            event.stopImmediatePropagation();
            // Remove the visible grab bar at the beginning of the close
            // gesture. Genesys retains the parent panel briefly for its own
            // animation, so waiting for its final state can leave it behind.
            removeAgentWorkspaceResizeHandle(panel);
            startAgentWorkspaceCloseAnimation(doc, panel, agentWorkspaceToggle(doc), closeControl);
            return;
          }
          beginAgentWorkspaceTransition(doc);
          panel.dataset.gbsAgentWorkspaceActive = 'false';
          // The native close hides the existing panel node instead of removing
          // it, so release our custom splitter explicitly on the close path.
          doc.defaultView.setTimeout(() => releaseAgentWorkspaceResize(panel), 0);
          doc.defaultView.setTimeout(() => syncAnalyticsHostWidth(doc), 0);
          doc.defaultView.setTimeout(() => syncAnalyticsHostWidth(doc), 80);
          doc.defaultView.setTimeout(() => syncAnalyticsHostWidth(doc), 180);
        }, true);
      }
      // Genesys initially adds `expanded` to every Workspace mount. Compact
      // Workspace is the only supported mode, so normalise it before paint.
      panel.dataset.gbsAgentWorkspaceNormalOverride = 'true';
      panel.classList.remove('expanded', 'fullscreen');
      panel.classList.add('gbs-agent-workspace-resizable');
      let handle = panel.querySelector(':scope > .gbs-agent-workspace-resizer');
      // Replace a preserved handle from an older script run. Genesys keeps
      // the panel node between opens, so merely finding a handle is not proof
      // that it owns the current drag callbacks.
      if (handle && handle.dataset.gbsResizeRevision !== '6') {
        handle.remove();
        handle = null;
      }
      if (!handle) {
        handle = doc.createElement('div');
        handle.className = 'gbs-agent-workspace-resizer';
        handle.title = 'Drag to resize Agent Workspace';
        handle.setAttribute('role', 'separator');
        handle.setAttribute('aria-orientation', 'vertical');
        handle.innerHTML = '<span class="gbs-resize-grip-button" aria-hidden="true"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 4v16"/><path d="M15 4v16"/></svg></span>';
        panel.appendChild(handle);
        const beginDrag = event => {
          event.preventDefault();
          event.stopImmediatePropagation();
          doc.body.classList.add('gbs-agent-workspace-resizing');
          const view = doc.defaultView;
          const captureLayer = createWorkspaceResizeCapture(doc);
          const startX = event.clientX;
          const startWidth = panel.getBoundingClientRect().width;
          let active = true;
          const onMove = moveEvent => {
            if (!active) return;
            if ((moveEvent.buttons & 1) !== 1) {
              onEnd();
              return;
            }
            const nextWidth = startWidth + (startX - moveEvent.clientX);
            applyAgentWorkspaceRatio(panel, nextWidth / Math.max(1, view.innerWidth));
          };
          const onEnd = () => {
            if (!active) return;
            active = false;
            doc.body.classList.remove('gbs-agent-workspace-resizing');
            captureLayer.removeEventListener('mousemove', onMove, true);
            captureLayer.removeEventListener('mouseup', onEnd, true);
            view.removeEventListener('blur', onEnd, true);
            captureLayer.remove();
          };
          captureLayer.addEventListener('mousemove', onMove, true);
          captureLayer.addEventListener('mouseup', onEnd, true);
          view.addEventListener('blur', onEnd, true);
        };
        handle.dataset.gbsResizeRevision = '6';
        handle.addEventListener('mousedown', beginDrag, true);
      }
      // Genesys can hide and re-show the same panel node. Reapply the saved
      // width on each reappearance, not solely when a new node is created.
      const restoringWorkspace = panel.dataset.gbsAgentWorkspaceActive !== 'true';
      panel.dataset.gbsAgentWorkspaceActive = 'true';
      // Genesys can clear our inline CSS variable while retaining the node
      // and dataset. Restore the actual panel width in that case too; without
      // this the Board changes but the Workspace remains at its 760px default.
      if (restoringWorkspace || !panel.dataset.gbsAgentWorkspaceRatio || !panel.style.getPropertyValue('--gbs-agent-workspace-width')) {
        applyAgentWorkspaceRatio(panel, savedAgentWorkspaceRatio(doc));
      }
      if (!panel.__gbsAgentWorkspaceRatioResizeHandler) {
        const onResize = () => {
          if (!panel.isConnected || panel.classList.contains('hidden')) return;
          applyAgentWorkspaceRatio(panel, Number(panel.dataset.gbsAgentWorkspaceRatio) || savedAgentWorkspaceRatio(doc));
        };
        doc.defaultView.addEventListener('resize', onResize, { passive: true });
        panel.__gbsAgentWorkspaceRatioResizeHandler = onResize;
      }
      syncAnalyticsHostWidth(doc);
      revealAgentWorkspaceAfterOpening(panel);
    });
  }

  function scheduleNativeAgentWorkspaceCompact(panel) {
    if (!panel || panel.dataset.gbsNativeCompactPending === 'true') return;
    panel.dataset.gbsNativeCompactPending = 'true';
    // Let Genesys finish its expanded-mount route transaction first. Calling
    // Collapse in the same animation frame changes the button state, but can
    // leave frame-router's child iframe at about:blank. A short settle window
    // matches the successful native/manual sequence, while our opening scene
    // keeps this intermediate state out of sight.
    panel.ownerDocument.defaultView.setTimeout(() => {
      delete panel.dataset.gbsNativeCompactPending;
      if (!panel.isConnected) return;
      const collapse = panel.querySelector('#panel-agent-expand-button[aria-label^="Collapse"]');
      if (collapse) collapse.click();
    }, 260);
  }

  function ensureAgentWorkspaceCompactMonitor(doc) {
    if (!doc.body || doc.__gbsAgentWorkspaceCompactMonitor) return;
    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = doc.defaultView.requestAnimationFrame(() => {
        frame = 0;
        ensureAgentWorkspaceResizer(doc);
      });
    };
    const relevant = node => {
      if (node?.nodeType !== 1) return false;
      return node.matches?.('.command-panel, .gbs-agent-workspace-resizer, #panel-agent-expand-button')
        || Boolean(node.querySelector?.('.command-panel, .gbs-agent-workspace-resizer, #panel-agent-expand-button'));
    };
    const observer = new doc.defaultView.MutationObserver(mutations => {
      if (mutations.some(mutation => {
        if (mutation.type === 'attributes') return relevant(mutation.target);
        return [...mutation.addedNodes].some(relevant);
      })) schedule();
    });
    observer.observe(doc.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'aria-label']
    });
    doc.__gbsAgentWorkspaceCompactMonitor = observer;
    schedule();
  }

  function injectShadowStyles(doc, startRoot = doc) {
    const roots = [startRoot];
    const light = themeMode(doc) === 'light';
    // These are the actual Shadow-host components used by the screens we
    // style. Keeping the list explicit avoids the old querySelectorAll('*')
    // walk across the whole Genesys application during startup.
    const selector = 'gux-form-field-search, gux-form-field-text-like, gux-avatar-beta, gux-tabs, gux-tab, gux-tab-list, gux-button-slot, gux-button, gux-list, gux-listbox, gux-list-item, gux-option, gux-dropdown, gux-popover, gux-popover-list, gux-popover-list-beta, gux-cta-group, gux-toggle, gux-switch-legacy, gux-switch-item, gux-accordion, gux-accordion-section, gux-calendar, gux-time-picker, gux-time-zone-picker-beta, gux-pagination, gux-pagination-item-counts, gux-pagination-buttons, gux-pagination-ellipsis-button, gux-table, gux-sort-control, gux-tooltip, gux-tooltip-title, gux-modal, gux-dismiss-button, app-view-stack, app-carousel-toolbar, app-carousel-view';
    for (let index = 0; index < roots.length; index += 1) {
      const root = roots[index];
      const hosts = new Set();
      if (root.nodeType === 1 && root.shadowRoot) hosts.add(root);
      if (root.nodeType === 1 && root.matches?.(selector)) hosts.add(root);
      root.querySelectorAll?.(selector).forEach(host => hosts.add(host));
      root.querySelectorAll?.('.app-view-stack-container, .app-carousel-toolbar-container, .app-carousel-view-container, gux-card').forEach(host => hosts.add(host));
      hosts.forEach(host => {
        const shadow = host.shadowRoot;
        if (!shadow) return;
        if (!shadow.getElementById(SHADOW_STYLE_ID)) {
          const style = doc.createElement('style');
          style.id = SHADOW_STYLE_ID;
          style.textContent = SHADOW_CSS;
          shadow.appendChild(style);
        }
        shadow.getElementById(SHADOW_STYLE_ID).disabled = light;
        roots.push(shadow);
      });

      const popovers = [];
      if (root.nodeType === 1 && root.matches?.('gux-popover, gux-popover-list, gux-popover-list-beta')) popovers.push(root);
      root.querySelectorAll?.('gux-popover, gux-popover-list, gux-popover-list-beta').forEach(host => popovers.push(host));
      popovers.forEach(host => {
        const shadow = host.shadowRoot;
        if (!shadow || shadow.getElementById(POPOVER_STYLE_ID)) return;
        const style = doc.createElement('style');
        style.id = POPOVER_STYLE_ID;
        style.textContent = POPOVER_SHADOW_CSS;
        shadow.appendChild(style);
      });
    }
  }

  function installAvatarShadowStyleHook(doc) {
    const view = doc.defaultView;
    const prototype = view?.Element?.prototype;
    if (!prototype || view.__gbsAvatarShadowHookInstalled) return;
    const originalAttachShadow = prototype.attachShadow;
    if (typeof originalAttachShadow !== 'function') return;
    prototype.attachShadow = function gbsAttachAvatarShadow(init) {
      const shadow = originalAttachShadow.call(this, init);
      if (this.matches?.('gux-avatar-beta') && !shadow.getElementById(SHADOW_STYLE_ID)) {
        const style = this.ownerDocument.createElement('style');
        style.id = SHADOW_STYLE_ID;
        style.textContent = SHADOW_CSS;
        style.disabled = themeMode(this.ownerDocument) === 'light';
        shadow.appendChild(style);
      }
      return shadow;
    };
    view.__gbsAvatarShadowHookInstalled = true;
  }

  function refreshShadowThemes() {
    injectShadowStyles(document);
    document.querySelectorAll('iframe').forEach(frame => {
      try { const frameDocument = accessibleFrameDocument(frame); if (frameDocument) injectShadowStyles(frameDocument); } catch (_) { /* cross-origin */ }
    });
  }

  function workspaceVisibleInTopDocument(doc) {
    try {
      const topDoc = doc.defaultView.top.document;
      if (callTestEnabled(topDoc)) return false;
      const workspace = topDoc.querySelector('.command-panel.active.agent .command-panel-wrapper.active:not(.hidden)');
      return Boolean(workspace && workspace.getBoundingClientRect().width > 0);
    } catch (_) { return false; }
  }

  function compactNativeAgentWorkspaceAfterMount(doc) {
    let frames = 0;
    const compact = () => {
      frames += 1;
      const panel = doc.querySelector('.command-panel.active.agent');
      const collapse = panel?.querySelector('#panel-agent-expand-button[aria-label^="Collapse"]');
      if (collapse) {
        scheduleNativeAgentWorkspaceCompact(panel);
        return;
      }
      if (frames < 24) doc.defaultView.requestAnimationFrame(compact);
    };
    doc.defaultView.requestAnimationFrame(compact);
  }

  function nativeCommandNavForToggle(toggle) {
    try {
      const actionAttribute = [...toggle.attributes].find(attribute => /^data-ember-action-\d+$/.test(attribute.name));
      const actionId = actionAttribute?.name.slice('data-ember-action-'.length);
      const requireFn = PAGE_WINDOW.__gbsNativeRuntime?.require || PAGE_WINDOW.require || window.require;
      const manager = requireFn?.('@ember/-internals/views/lib/system/action_manager')?.default;
      let component = manager?.registeredActions?.[actionId]?.implicitTarget?.lastValue;
      const visited = new Set();
      while (component && !visited.has(component)) {
        visited.add(component);
        const commandNav = component.get?.('commandNav');
        if (commandNav && typeof commandNav.selectPanel === 'function') return commandNav;
        component = component.parentView || component._target;
      }
    } catch (_) { /* Native fallback remains available if Ember changes. */ }
    return null;
  }

  function sidebarStorageKey(doc, workspaceVisible) {
    // The dashboard iframe owns the Board divider. Its synchronized state is
    // more reliable than querying the outer document during a panel transition.
    const dashboardState = doc.querySelector('.main-grid')?.dataset.gbsWorkspaceVisible;
    const isWorkspace = typeof workspaceVisible === 'boolean'
      ? workspaceVisible
      : dashboardState === 'true' || workspaceVisibleInTopDocument(doc);
    return `${RESIZE_KEY_PREFIX}${doc.location.pathname}${isWorkspace ? ':workspace' : ''}`;
  }

  function sidebarRatioStorageKey(doc, workspaceVisible) {
    const dashboardState = doc.querySelector('.main-grid')?.dataset.gbsWorkspaceVisible;
    const isWorkspace = typeof workspaceVisible === 'boolean'
      ? workspaceVisible
      : dashboardState === 'true' || workspaceVisibleInTopDocument(doc);
    return `${RESIZE_RATIO_KEY_PREFIX}${doc.location.pathname}${isWorkspace ? ':workspace' : ''}`;
  }

  function workspaceDashboardStateKey(doc) {
    return `${WORKSPACE_DASHBOARD_STATE_KEY_PREFIX}${doc.location.pathname}`;
  }

  function readWorkspaceDashboardCollapsed(doc) {
    const stored = readPersistentText(doc, workspaceDashboardStateKey(doc));
    if (stored === 'open') return false;
    if (stored === 'collapsed') return true;
    return true;
  }

  function saveWorkspaceDashboardCollapsed(doc, collapsed) {
    writePersistentText(doc, workspaceDashboardStateKey(doc), collapsed ? 'collapsed' : 'open');
  }

  function readSidebarRatio(sidebar, workspaceVisible) {
    const doc = sidebar.ownerDocument;
    const total = sidebar.parentElement?.clientWidth || doc.defaultView.innerWidth || 1;
    let ratio = readPersistentNumber(doc, sidebarRatioStorageKey(doc, workspaceVisible));
    if (Number.isFinite(ratio) && ratio > 0 && ratio < 1) return ratio;

    // One-time migration from the old absolute-width preference. From this
    // point onward only the ratio key is read or written.
    const oldWidth = readPersistentNumber(doc, sidebarStorageKey(doc, workspaceVisible));
    let stableTotal = total;
    try {
      const topDoc = doc.defaultView.top.document;
      const stageWidth = topDoc.querySelector('main.center-stage')?.getBoundingClientRect().width || 0;
      if (stageWidth) {
        const panel = topDoc.querySelector('.command-panel.active.agent');
        const panelWidth = workspaceVisible
          ? (Number(panel?.dataset.gbsAgentWorkspaceRatio) * (topDoc.defaultView.innerWidth || 0)) || parseFloat(panel?.style.getPropertyValue('--gbs-agent-workspace-width')) || panel?.getBoundingClientRect().width || 0
          : 0;
        stableTotal = Math.max(1, stageWidth - panelWidth);
      }
    } catch (_) { /* cross-origin parent */ }
    ratio = Number.isFinite(oldWidth) && oldWidth >= 320
      ? oldWidth / stableTotal
      // Measured live in both layouts: a fresh Board/Dashboard starts 50:50.
      // This is a default only; a stored manual divider choice always wins.
      : .5;
    ratio = Math.max(0.05, Math.min(0.95, ratio));
    writePersistentNumber(doc, sidebarRatioStorageKey(doc, workspaceVisible), ratio);
    return ratio;
  }

  function saveSidebarRatio(sidebar, workspaceVisible) {
    const total = sidebar.parentElement?.clientWidth || 0;
    if (!total) return;
    const ratio = Math.max(0.05, Math.min(0.95, sidebar.getBoundingClientRect().width / total));
    writePersistentNumber(sidebar.ownerDocument, sidebarRatioStorageKey(sidebar.ownerDocument, workspaceVisible), ratio);
    sidebar.dataset.gbsSidebarRatio = String(ratio);
  }

  function applySidebarWidth(sidebar, handle, width) {
    const grid = sidebar.parentElement;
    // During workspace restoration the Board parent begins at its collapsed
    // transition width. Capping against that temporary value was turning a
    // saved 624px Board into 320px. Use the stable viewport capacity instead.
    const viewWidth = sidebar.ownerDocument.defaultView.innerWidth || 1600;
    const totalWidth = grid?.clientWidth || viewWidth;
    // The Board has six live data columns.  Below 400px there is no readable,
    // stable arrangement once time values gain another digit, so keep the drag
    // floor here rather than letting a later DOM update push the table outward.
    const minimumBoardWidth = 400;
    // Ordinarily the Board remains capped at 50% of the screen. While Agent
    // Workspace is visible the dedicated saved layout may use up to 75%,
    // while still leaving at least 190px for an open Dashboard.
    const dashboard = sidebar.ownerDocument.querySelector('.main-grid');
    const workspaceVisible = dashboard?.dataset.gbsWorkspaceVisible === 'true'
      || workspaceVisibleInTopDocument(sidebar.ownerDocument);
    const screenLimitWidth = Math.floor(viewWidth * (workspaceVisible ? .75 : .5));
    const maxWidth = Math.max(minimumBoardWidth, Math.min(1400, totalWidth - 190, screenLimitWidth));
    const safeWidth = Math.max(minimumBoardWidth, Math.min(maxWidth, Math.round(width)));
    const dashboardWidth = Math.max(0, (grid?.clientWidth || dashboard?.getBoundingClientRect().width || 0) - safeWidth);
    if (dashboard) {
      // Keep every intermediate layout explicit. Falling back to Genesys'
      // native responsive rule caused a direct four-to-one column jump.
      const dashboardStyle = sidebar.ownerDocument.defaultView.getComputedStyle(dashboard);
      const horizontalPadding = (parseFloat(dashboardStyle.paddingLeft) || 0) + (parseFloat(dashboardStyle.paddingRight) || 0);
      const gap = parseFloat(dashboardStyle.columnGap) || 10;
      const contentWidth = Math.max(0, dashboardWidth - horizontalPadding);
      // A card remains useful down to 190px. Choose the largest count that
      // satisfies that minimum, then CSS Grid distributes every leftover pixel
      // equally so the row always consumes the full available width.
      // Four cards is the normal maximum.  Five made the standard Dashboard
      // overly dense and bypassed the intended 4 -> 3 responsive transition.
      const columnCount = Math.max(1, Math.min(4, Math.floor((contentWidth + gap) / (190 + gap))));
      [1, 2, 3, 4].forEach(count => {
        dashboard.classList.toggle(`gbs-dashboard-columns-${count}`, count === columnCount);
      });
      dashboard.classList.remove('gbs-dashboard-columns-5');
    }
    if (sidebar.dataset.gbsSidebarWidth === String(safeWidth)) return;
    sidebar.dataset.gbsSidebarWidth = String(safeWidth);
    sidebar.style.width = `${safeWidth}px`;
    sidebar.style.minWidth = `${safeWidth}px`;
    sidebar.style.maxWidth = `${safeWidth}px`;
    sidebar.style.flex = `0 0 ${safeWidth}px`;
    grid?.style.setProperty('--gbs-board-width', `${safeWidth}px`);
    // The Board divider changes dashboard-card widths on every pointer frame.
    // Recalculate their width/content scale in that exact frame too; waiting
    // for the periodic enhancement pass left the text stack using stale width
    // metrics, so its line boxes briefly collapsed then recovered.
    const summaryGrid = sidebar.querySelector('.gbs-summary-cards[data-gbs-owner="genesys-board-sorter"]');
    if (summaryGrid?.isConnected) {
      const summaryScale = Number(summaryGrid.dataset.gbsSummaryScale) || 1;
      applySummaryCardScale(summaryGrid, summaryScale);
    }
  }

  function applySidebarRatio(sidebar, workspaceVisible) {
    const grid = sidebar?.parentElement;
    // A saved ratio must never compete with an active manual drag. This is a
    // central guard because several lifecycle paths can request a restore.
    if (sidebar?.ownerDocument.body.classList.contains('gbs-resizing')) return;
    if (!sidebar || !grid?.clientWidth) return;
    const ratio = readSidebarRatio(sidebar, workspaceVisible);
    sidebar.dataset.gbsSidebarRatio = String(ratio);
    applySidebarWidth(sidebar, null, grid.clientWidth * ratio);
  }

  const SUMMARY_ORDER = ['idle', 'interacting', 'available', 'busy', 'break', 'meal', 'meeting', 'training'];
  function refreshSummaryCards(sidebar) {
    const source = sidebar.querySelector('.analytics-ui-dashboard-widget-agent-list-summary');
    const display = sidebar.querySelector('.analytics-ui-dashboard-widget-agent-list-display');
    if (!source || !display) return;

    const values = new Map();
    source.querySelectorAll(':scope > .agent-list-summary').forEach(card => {
      const name = card.querySelector('.agent-item-label')?.textContent.trim().toLowerCase();
      if (name && !values.has(name)) values.set(name, card.querySelector('.agent-item-value')?.textContent.trim() || '0');
    });

    let grid = sidebar.querySelector('.gbs-summary-cards[data-gbs-owner="genesys-board-sorter"]') || sidebar.querySelector('.gbs-summary-cards');
    if (grid && !grid.dataset.gbsOwner) grid.dataset.gbsOwner = 'genesys-board-sorter';
    if (!grid) {
      grid = display.ownerDocument.createElement('div');
      grid.className = 'gbs-summary-cards';
      grid.dataset.gbsOwner = 'genesys-board-sorter';
      SUMMARY_ORDER.forEach(name => {
        const card = display.ownerDocument.createElement('div');
        card.className = `gbs-summary-card gbs-summary-${name}${name === 'busy' ? ' gbs-summary-busy' : ''}`;
        card.dataset.gbsSummary = name;
        card.innerHTML = `<div class="gbs-summary-title">${name === 'interacting' ? 'In Call' : name.replace(/^./, value => value.toUpperCase())}</div><div class="gbs-summary-line"><span class="gbs-summary-value">0</span><span class="gbs-summary-dot" aria-hidden="true"></span></div>`;
        grid.appendChild(card);
      });
      source.before(grid);
    }

    SUMMARY_ORDER.forEach(name => {
      const card = grid.querySelector(`[data-gbs-summary="${name}"]`);
      if (!card) return;
      const nextValue = values.get(name) || '0';
      const valueNode = card.querySelector('.gbs-summary-value');
      if (valueNode && valueNode.textContent !== nextValue) valueNode.textContent = nextValue;
      card.classList.toggle('gbs-summary-hidden', (name === 'meeting' || name === 'training') && Number(nextValue) === 0);
    });
  }

  function ensureSummaryHeightResizer(sidebar) {
    const grid = sidebar.querySelector('.gbs-summary-cards[data-gbs-owner="genesys-board-sorter"]');
    if (!grid) return;
    const doc = grid.ownerDocument;
    grid.classList.add('gbs-summary-height-resizable');
    let scale = Number(grid.dataset.gbsSummaryScale);
    if (!Number.isFinite(scale)) {
      try { scale = Number(doc.defaultView.localStorage.getItem('genesys-board-sorter-summary-card-scale')) || 1; } catch (_) { scale = 1; }
    }
    // Width changes and pointer movement call applySummaryCardScale directly.
    // Do not rewrite the same five CSS variables on every maintenance pass;
    // that was continuously retriggering grid width transitions.
    if (!grid.dataset.gbsSummaryScale) applySummaryCardScale(grid, scale);
    if (grid.querySelector(':scope > .gbs-summary-height-resizer')) return;
    const handle = doc.createElement('div');
    handle.className = 'gbs-summary-height-resizer';
    handle.title = 'Drag to resize Board summary cards';
    handle.setAttribute('role', 'separator');
    handle.setAttribute('aria-orientation', 'horizontal');
    handle.addEventListener('pointerdown', event => {
      event.preventDefault();
      const startY = event.clientY;
      const startScale = Number(grid.dataset.gbsSummaryScale) || 1;
      handle.setPointerCapture(event.pointerId);
      doc.body.classList.add('gbs-summary-resizing');
      let active = true;
      const move = moveEvent => {
        if (!active) return;
        if ((moveEvent.buttons & 1) !== 1) {
          end(moveEvent);
          return;
        }
        const next = Math.max(.55, Math.min(1.25, startScale + (moveEvent.clientY - startY) / 140));
        applySummaryCardScale(grid, next);
      };
      const end = endEvent => {
        if (!active) return;
        active = false;
        if (endEvent?.pointerId !== undefined && handle.hasPointerCapture(endEvent.pointerId)) handle.releasePointerCapture(endEvent.pointerId);
        doc.body.classList.remove('gbs-summary-resizing');
        const boardTable = grid.closest('.gbs-sidebar')?.querySelector('table.gbs-board');
        if (boardTable?.isConnected) applyResponsiveBoardColumns(boardTable);
        fitDashboardMetricSpacing(doc);
        try { doc.defaultView.localStorage.setItem('genesys-board-sorter-summary-card-scale', grid.dataset.gbsSummaryScale); } catch (_) { /* storage unavailable */ }
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', end);
        handle.removeEventListener('pointercancel', end);
        doc.defaultView.removeEventListener('blur', end, true);
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', end);
      handle.addEventListener('pointercancel', end);
      doc.defaultView.addEventListener('blur', end, true);
    });
    grid.appendChild(handle);
  }

  function applySummaryCardScale(grid, requestedScale) {
    const scale = Math.max(.55, Math.min(1.25, Number(requestedScale) || 1));
    // SBL (space between lines) and normal text metrics remain unchanged while
    // Keep the text stack inside the card at every intermediate drag position.
    // Previously the text stayed nearly full size below the card's height, so
    // flexbox temporarily shrank its line boxes to their minimum and restored
    // them once the pointer paused. Scaling text with the card avoids that
    // competing layout calculation entirely.
    const textScale = scale >= 1 ? 1 : Math.max(.5, scale);
    // The Board itself can be resized while the viewport remains wide, so the
    // media-query layout alone cannot protect these cards.  Resolve their
    // width against the Board display, not against the possibly-overflowing
    // grid's old rendered width.
    const holder = grid.parentElement;
    const holderStyle = holder ? getComputedStyle(holder) : null;
    const holderPadding = holderStyle
      ? (parseFloat(holderStyle.paddingLeft) || 0) + (parseFloat(holderStyle.paddingRight) || 0)
      : 0;
    const usableWidth = Math.max(0, (holder?.clientWidth || grid.clientWidth || 0) - holderPadding);
    const widthScale = usableWidth > 0
      ? Math.max(.68, Math.min(1, (usableWidth - 12) / (3 * 142)))
      : 1;
    const gridStyle = getComputedStyle(grid);
    const columnGap = parseFloat(gridStyle.columnGap) || 6;
    const busyCardWidth = Math.max(0, ((grid.clientWidth || usableWidth) - columnGap * 2) / 3);
    grid.dataset.gbsSummaryScale = String(scale);
    grid.style.setProperty('--gbs-summary-card-scale', scale.toFixed(3));
    grid.style.setProperty('--gbs-summary-text-scale', textScale.toFixed(3));
    grid.style.setProperty('--gbs-summary-width-scale', widthScale.toFixed(3));
    grid.style.setProperty('--gbs-summary-content-scale', (textScale * widthScale).toFixed(3));
    grid.style.setProperty('--gbs-summary-dot-scale', (scale * widthScale).toFixed(3));
    grid.style.setProperty('--gbs-summary-busy-width', `${busyCardWidth.toFixed(3)}px`);
  }

  function ensureSidebarEnhancements(doc) {
    const sidebar = doc.querySelector('.grid-sidebar');
    if (!sidebar) return;
    injectStyles(doc);
    sidebar.classList.add('gbs-sidebar');
    if (themeMode(doc) !== 'light') refreshSummaryCards(sidebar);
    ensureSummaryHeightResizer(sidebar);

    const grid = sidebar.parentElement;
    if (!grid) return;
    grid.classList.add('gbs-grid-scroll');

    let handle = grid.querySelector(':scope > .gbs-resizer');
    if (!handle) handle = sidebar.querySelector(':scope > .gbs-resizer');
    if (!handle) {
      handle = doc.createElement('div');
      handle.className = 'gbs-resizer';
      handle.title = 'Drag to resize the agent board';
      handle.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 4v16"/><path d="M15 4v16"/></svg>';
      sidebar.style.position = 'relative';
      sidebar.appendChild(handle);

      applySidebarRatio(sidebar, workspaceVisibleInTopDocument(doc));

      handle.addEventListener('pointerdown', event => {
        event.preventDefault();
        handle.setPointerCapture(event.pointerId);
        doc.body.classList.add('gbs-resizing');

        const gridRight = grid.getBoundingClientRect().right;
        let pendingWidth = null;
        let resizeFrame = 0;
        let active = true;
        const onMove = moveEvent => {
          if (!active) return;
          if ((moveEvent.buttons & 1) !== 1) {
            onEnd(moveEvent);
            return;
          }
          // The rail is on the Board block's left edge: left grows it, right shrinks it.
          pendingWidth = gridRight - moveEvent.clientX;
          if (resizeFrame) return;
          resizeFrame = doc.defaultView.requestAnimationFrame(() => {
            resizeFrame = 0;
            applySidebarWidth(sidebar, handle, pendingWidth);
            const boardTable = sidebar.querySelector('table.gbs-board');
            if (boardTable?.isConnected) applyResponsiveBoardColumns(boardTable, true);
          });
        };
        const onEnd = endEvent => {
          if (!active) return;
          active = false;
          if (resizeFrame) {
            doc.defaultView.cancelAnimationFrame(resizeFrame);
            resizeFrame = 0;
          }
          if (pendingWidth !== null) applySidebarWidth(sidebar, handle, pendingWidth);
          if (endEvent?.pointerId !== undefined && handle.hasPointerCapture(endEvent.pointerId)) handle.releasePointerCapture(endEvent.pointerId);
          doc.body.classList.remove('gbs-resizing');
          // Manual divider movement is the only action allowed to change a
          // saved ratio. All other layout changes merely reapply it.
          saveSidebarRatio(sidebar, workspaceVisibleInTopDocument(doc));
          const boardTable = sidebar.querySelector('table.gbs-board');
          if (boardTable) {
            boardTable.__gbsSuppressColumnResizeUntil = doc.defaultView.performance.now() + 260;
            applyResponsiveBoardColumns(boardTable);
          }
          const summaryGrid = sidebar.querySelector('.gbs-summary-cards[data-gbs-owner="genesys-board-sorter"]');
          if (summaryGrid?.isConnected) applySummaryCardScale(summaryGrid, Number(summaryGrid.dataset.gbsSummaryScale) || 1);
          fitDashboardMetricSpacing(doc);
          handle.removeEventListener('pointermove', onMove);
          handle.removeEventListener('pointerup', onEnd);
          handle.removeEventListener('pointercancel', onEnd);
          doc.defaultView.removeEventListener('blur', onEnd, true);
        };
        handle.addEventListener('pointermove', onMove);
        handle.addEventListener('pointerup', onEnd);
        handle.addEventListener('pointercancel', onEnd);
        doc.defaultView.addEventListener('blur', onEnd, true);
      });
    } else {
      if (handle.parentElement !== sidebar) {
        sidebar.style.position = 'relative';
        sidebar.appendChild(handle);
      }
    }

    if (!grid.__gbsSidebarRatioObserver && doc.defaultView.ResizeObserver) {
      let ratioFrame = 0;
      let observedGridWidth = Math.round(grid.getBoundingClientRect().width);
      grid.__gbsSidebarRatioObserver = new doc.defaultView.ResizeObserver(() => {
        const nextGridWidth = Math.round(grid.getBoundingClientRect().width);
        // Ignore child/card/table relayout notifications. Only a meaningful
        // change to the Board's parent width can require ratio restoration.
        if (Math.abs(nextGridWidth - observedGridWidth) < 2) return;
        observedGridWidth = nextGridWidth;
        if (doc.body.classList.contains('gbs-resizing')) return;
        if (ratioFrame) doc.defaultView.cancelAnimationFrame(ratioFrame);
        ratioFrame = doc.defaultView.requestAnimationFrame(() => {
          ratioFrame = 0;
          if (sidebar.isConnected && !doc.body.classList.contains('gbs-resizing')) {
            applySidebarRatio(sidebar, workspaceVisibleInTopDocument(doc));
          }
        });
      });
      grid.__gbsSidebarRatioObserver.observe(grid);
    }
    // Initial mount needs a saved ratio. After that, the ResizeObserver and
    // explicit workspace transitions are the only owners of restoration.
    // Reapplying here every maintenance tick caused the Board to jump by
    // itself and to snap while a pointer was held on the divider.
    if (!doc.body.classList.contains('gbs-resizing') && !sidebar.dataset.gbsSidebarWidth) {
      applySidebarRatio(sidebar, workspaceVisibleInTopDocument(doc));
    }
  }

  function ensureRankColumn(table) {
    const doc = table.ownerDocument;
    const agentHeader = table.querySelector('thead th.column-agent, thead th[data-column-name="agent"]');
    if (agentHeader && !table.querySelector('thead .gbs-rank-header')) {
      const header = doc.createElement('th');
      header.className = 'gbs-rank-header';
      header.dataset.gbsRank = 'true';
      header.textContent = '#';
      agentHeader.before(header);
    }
  }

  function setRowPresentation(row, number, key) {
    const doc = row.ownerDocument;
    let rankCell = row.querySelector(':scope > td.gbs-rank-cell');
    const agentCell = row.querySelector(':scope > td.column-agent');
    if (!rankCell && agentCell) {
      rankCell = doc.createElement('td');
      rankCell.className = 'gbs-rank-cell';
      agentCell.before(rankCell);
    }
    if (rankCell) rankCell.textContent = String(number);
    // Ember can briefly clear the Status cell while it removes a colleague.
    // Retain a row's last known real colour during that single reconciliation
    // frame rather than repainting every row with the unknown/grey fallback.
    const previousKey = row.dataset.gbsStatus || Array.from(row.classList)
      .find(name => name.startsWith('gbs-status-'))?.slice('gbs-status-'.length) || '';
    const stableKey = key && key !== 'unknown' ? key : (previousKey && previousKey !== 'unknown' ? previousKey : 'unknown');
    row.classList.remove(...Array.from(row.classList).filter(name => name.startsWith('gbs-status-')));
    row.classList.add(`gbs-status-${stableKey}`);
    row.dataset.gbsStatus = stableKey;
  }

  function ensureCompleteBoardRow(row) {
    const agentCell = row.querySelector(':scope > td.column-agent');
    if (!agentCell) return;
    const doc = row.ownerDocument;
    let presenceCell = row.querySelector(':scope > td.column-agentPresence');
    if (!presenceCell) {
      presenceCell = doc.createElement('td');
      presenceCell.className = 'column-agentPresence gbs-empty-board-cell';
      presenceCell.setAttribute('aria-label', 'Presence');
      row.insertBefore(presenceCell, row.firstElementChild);
    }
    let timeCell = row.querySelector(':scope > td.column-timeInStatus');
    if (!timeCell) {
      timeCell = doc.createElement('td');
      timeCell.className = 'column-timeInStatus nowrap-cell blue-cell gbs-empty-board-cell';
      timeCell.setAttribute('aria-label', 'Time');
      agentCell.after(timeCell);
    }
    let statusCell = row.querySelector(':scope > td.column-status');
    if (!statusCell) {
      statusCell = doc.createElement('td');
      statusCell.className = 'column-status nowrap-cell blue-cell gbs-empty-board-cell';
      statusCell.setAttribute('aria-label', 'Status');
      timeCell.after(statusCell);
    }
    if (!row.querySelector(':scope > td.column-duration, :scope > td.column-duration-one')) {
      const durationCell = doc.createElement('td');
      durationCell.className = 'column-duration column-duration-one duration nowrap-cell blue-cell gbs-empty-board-cell';
      durationCell.setAttribute('aria-label', 'Duration');
      statusCell.after(durationCell);
    }
  }

  function normalizeAgentName(value) {
    return (value || '').replace(/\s+/g, ' ').trim().toLocaleLowerCase();
  }

  function syncHoverCardStatusColors(doc) {
    const statusByAgent = new Map();
    doc.querySelectorAll('table.gbs-board tbody tr').forEach(row => {
      const name = row.querySelector('td.column-agent a')?.textContent || row.querySelector('td.column-agent')?.textContent;
      const key = Array.from(row.classList).find(name => name.startsWith('gbs-status-'))?.slice('gbs-status-'.length);
      if (name && key) statusByAgent.set(normalizeAgentName(name), key);
    });
    doc.querySelectorAll('.entity-v3-hover-card-popover .entity-v3-mini-card').forEach(card => {
      const name = card.querySelector('.name-header')?.textContent;
      const key = statusByAgent.get(normalizeAgentName(name));
      if (key) {
        // Queue membership (on_queue) is not the same thing as an agent's
        // current board status. The matched row is authoritative for the ring.
        card.style.setProperty('--gbs-hover-status', `var(--gbs-status-${key})`);
      } else {
        card.style.removeProperty('--gbs-hover-status');
      }
    });
  }

  function profileAgentName(doc) {
    const label = doc.querySelector('#user-settings-button[aria-label]')?.getAttribute('aria-label') || '';
    return (label.split(',')[1] || '').replace(/\s+/g, ' ').trim();
  }

  function rememberCurrentAgentName(doc) {
    // One tiny identity lookup in the top shell every five seconds. Child
    // documents must not overwrite the authenticated top-shell identity.
    try { doc = doc.defaultView.top.document; } catch (_) { return; }
    if (Date.now() - (doc.__gbsLastIdentityCheck || 0) < 5000) return;
    doc.__gbsLastIdentityCheck = Date.now();
    const name = profileAgentName(doc) || doc.querySelector('.avatar-header.avatar-small .user-name, .avatar-header.avatar-small [data-testid="userNameSmall"]')?.textContent;
    const normalized = (name || '').replace(/\s+/g, ' ').trim();
    if (!normalized) return;
    let previous = '';
    try { previous = doc.defaultView.localStorage.getItem(CURRENT_AGENT_KEY) || ''; } catch (_) {}
    const changed = normalizeAgentName(previous) !== normalizeAgentName(normalized)
      || doc.__gbsRecognizedIdentity !== normalizeAgentName(normalized);
    try { doc.defaultView.localStorage.setItem(CURRENT_AGENT_KEY, normalized); } catch (_) { /* storage unavailable */ }
    doc.__gbsRecognizedIdentity = normalizeAgentName(normalized);
    if (changed) {
      const settings = doc.querySelector('.gbs-settings-popover:not([hidden])');
      if (settings && (settings.dataset.gbsSettingsPage === 'home'
        || (settings.dataset.gbsSettingsPage === 'admin' && !isSavedAdmin(doc)))) {
        renderSettingsHome(doc, settings);
      }
      ensureCallDeveloperToggle(doc);
    }
  }

  function currentAgentName(doc) {
    try {
      const topDoc = doc.defaultView.top.document;
      const labelName = normalizeAgentName(profileAgentName(topDoc));
      if (labelName) return labelName;
      return normalizeAgentName(topDoc.defaultView.localStorage.getItem(CURRENT_AGENT_KEY));
    } catch (_) { return ''; }
  }

  function positionCallDeveloperToggle(doc, wrapper, searchBar) {
    if (!wrapper?.isConnected || !searchBar?.isConnected) return;
    const view = doc.defaultView;
    const searchRect = searchBar.getBoundingClientRect();
    const commandBar = searchBar.closest('.command-bar, .command-bar-container, header') || searchBar.parentElement;
    const barRect = commandBar?.getBoundingClientRect?.() || searchRect;
    const width = 92;
    const gap = 8;
    const edge = 8;
    // Prefer directly after the search. If the responsive command bar no
    // longer has room, place it directly before the search; final fallback
    // remains on the same command-bar line at the viewport edge.
    let left = searchRect.right + gap;
    if (left + width > view.innerWidth - edge) left = searchRect.left - width - gap;
    if (left < edge || !Number.isFinite(left)) left = Math.max(edge, view.innerWidth - width - edge);
    const top = barRect.top + (barRect.height / 2);
    wrapper.style.setProperty('--gbs-call-dev-x', `${Math.round(left)}px`);
    wrapper.style.setProperty('--gbs-call-dev-y', `${Math.round(top)}px`);
  }

  function captureCallWorkspace(doc) {
    // Capture the complete live call area—not just whichever embedded app is
    // mounted first. Text and form values are redacted so the resulting file
    // remains a structural/style diagnostic rather than customer data.
    const redact = html => String(html || '')
      .replace(/>([^<]+)</g, '>[redacted]<')
      .replace(/\s(value|placeholder|aria-label|title)="[^"]*"/gi, '');
    const roots = [
      '.interactions', '.selected-interaction-container', '.interaction-container',
      '.agent-workspace', '.acd-interactions-panel'
    ].flatMap(selector => [...doc.querySelectorAll(selector)]);
    const uniqueRoots = [...new Set(roots)];
    const log = {
      version: '1.451.0', capturedAt: new Date().toISOString(),
      rootUrl: doc.location.href, roots: uniqueRoots.map(root => ({
        selector: root.className || root.id || root.tagName,
        html: redact(root.outerHTML)
      })),
      frames: [], mutations: []
    };
    Object.defineProperty(log, '_gbsDocuments', { value: [], enumerable: false });
    const visited = new Set();
    const snapshotDocument = (frameDoc, label, depth = 0) => {
      if (!frameDoc || visited.has(frameDoc) || depth > 4) return;
      visited.add(frameDoc);
      log._gbsDocuments.push(frameDoc);
      const scripts = [...frameDoc.scripts].map(script => ({
        src: script.src || '', type: script.type || '', inlineLength: script.src ? 0 : script.textContent.length
      }));
      const stylesheets = [...frameDoc.styleSheets].map(sheet => ({
        href: sheet.href || '', rules: (() => {
          try { return [...sheet.cssRules].map(rule => rule.cssText); }
          catch (_) { return ['[cross-origin stylesheet]']; }
        })()
      }));
      const frameRoots = [
        '.interactions', '.selected-interaction-container', '.interaction-container',
        '.sub-container.run-mode', '[data-testid="wrapup-main-container"]',
        '.app-view-stack', '.app-carousel-view', '#app', '#root'
      ].flatMap(selector => [...frameDoc.querySelectorAll(selector)]);
      log.frames.push({
        label, url: frameDoc.location.href, html: redact(frameDoc.documentElement.outerHTML),
        callRoots: [...new Set(frameRoots)].map(root => ({ selector: root.className || root.id || root.tagName, html: redact(root.outerHTML) })),
        stylesheets, scripts
      });
      [...frameDoc.querySelectorAll('iframe')].filter(frame => depth > 0
        || frame.matches('iframe.interaction-script, iframe[title="Wrap-up Codes"], iframe[title="Profile"]')
        || uniqueRoots.some(root => root.contains(frame))).forEach((frame, index) => {
        try { snapshotDocument(accessibleFrameDocument(frame), `${label}/iframe-${index}:${frame.title || 'untitled'}`, depth + 1); } catch (_) { /* isolated app */ }
      });
    };
    // Include the top document so the roster/card itself is preserved.
    snapshotDocument(doc, 'call-shell');
    return log;
  }

  function ensureCallDeveloperToggle(doc) {
    try { if (doc.defaultView !== doc.defaultView.top) return; } catch (_) { return; }
    const allowed = isSavedAdmin(doc) && showAdminCallButton(doc) && themeMode(doc) !== 'light';
    if (!allowed) {
      doc.querySelectorAll('.gbs-call-dev-toggle-wrap').forEach(wrapper => wrapper.style.setProperty('display', 'none', 'important'));
      return;
    }
    const searchBar = doc.querySelector('#search-field')?.closest('.command-global-search');
    // Earlier builds could leave an old overlay behind after a Genesys shell
    // re-render. Keep one canonical control, never two.
    const wrappers = [...doc.querySelectorAll('.gbs-call-dev-toggle-wrap')];
    const existing = wrappers.shift();
    wrappers.forEach(wrapper => wrapper.remove());
    if (!searchBar) return;
    if (existing) { existing.style.removeProperty('display'); positionCallDeveloperToggle(doc, existing, searchBar); return; }
    const wrapper = doc.createElement('div');
    wrapper.className = 'gbs-call-dev-toggle-wrap';
    const button = doc.createElement('button');
    button.type = 'button'; button.className = 'gbs-theme-toggle gbs-call-dev-toggle';
    button.textContent = 'Have a call'; button.title = 'Capture active-call structure and styling';
    button.addEventListener('click', () => {
      const state = doc.defaultView.__gbsCallCapture;
      if (state?.active) {
        state.active = false; state.observers?.forEach(observer => observer.disconnect());
        const payload = JSON.stringify(state.log, null, 2);
        const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }));
        const link = doc.createElement('a'); link.href = url; link.download = `genesys-v2-call-style-${Date.now()}.json`; link.click();
        doc.defaultView.setTimeout(() => URL.revokeObjectURL(url), 1000);
        delete doc.defaultView.__gbsCallCapture; button.textContent = 'Have a call'; button.classList.remove('gbs-call-dev-active'); return;
      }
      const log = captureCallWorkspace(doc);
      const observers = log._gbsDocuments.map(trackedDocument => {
        const observer = new trackedDocument.defaultView.MutationObserver(items => items.forEach(item => log.mutations.push({ type:item.type, target:item.target.nodeName, at:Date.now() })));
        observer.observe(trackedDocument.documentElement, { childList:true, subtree:true, attributes:true });
        return observer;
      });
      const captureState = { active: true, log, observers };
      doc.defaultView.__gbsCallCapture = captureState; button.textContent = 'Stop call capture'; button.classList.add('gbs-call-dev-active');
    });
    wrapper.appendChild(button);
    // A fixed overlay is deliberately mounted at document level: it never
    // contributes width to the command bar, but follows the actual menu/search
    // geometry so it still reads as one of that line's controls.
    (doc.body || doc.documentElement).appendChild(wrapper);
    const updatePosition = () => positionCallDeveloperToggle(doc, wrapper, searchBar);
    updatePosition();
    doc.defaultView.addEventListener('resize', updatePosition, { passive: true });
    if (typeof doc.defaultView.ResizeObserver !== 'undefined') {
      const observer = new doc.defaultView.ResizeObserver(updatePosition);
      observer.observe(searchBar);
      const commandBar = searchBar.closest('.command-bar, .command-bar-container, header');
      if (commandBar) observer.observe(commandBar);
      wrapper._gbsPositionObserver = observer;
    }
  }

  function boardStatusColorForAgent(doc, agentName) {
    const target = normalizeAgentName(agentName);
    if (!target) return '';
    let rootDoc = doc;
    try { rootDoc = doc.defaultView.top.document; } catch (_) { /* use local document */ }
    const pending = [rootDoc];
    const visited = new Set();
    while (pending.length) {
      const currentDoc = pending.shift();
      if (!currentDoc || visited.has(currentDoc)) continue;
      visited.add(currentDoc);
      for (const row of currentDoc.querySelectorAll('table.gbs-board tbody tr')) {
        const cell = row.querySelector('td.column-agent');
        const name = cell?.querySelector('a')?.textContent || cell?.textContent || '';
        if (normalizeAgentName(name) !== target) continue;
        const status = row.querySelector('td.column-status')?.textContent || '';
        const key = statusKey(status);
        return resolvedStatusColor(currentDoc, key);
      }
      currentDoc.querySelectorAll('iframe').forEach(frame => {
        try { const frameDocument = accessibleFrameDocument(frame); if (frameDocument) pending.push(frameDocument); } catch (_) { /* cross-origin */ }
      });
    }
    return '';
  }

  function profileStatusKey(doc) {
    const label = doc.querySelector('#user-settings-button[aria-label]')?.getAttribute('aria-label') || '';
    // This label is always present on the top profile control, before either
    // the board or profile popover is mounted. Its final segment is canonical.
    // Example: "User settings, Laszlo Akim, Chat" -> chat (Busy group).
    // Any unrecognized label uses the neutral fallback below.
    const value = label.split(',').pop()?.trim().toLocaleLowerCase() || '';
    const aliases = {
      chat: 'chat', email: 'email', other: 'other', 'outgoing call': 'outgoing-call',
      'remote session': 'remote-session', 'technical problem': 'technical-problem',
      interacting: 'interacting', busy: 'busy', idle: 'idle', available: 'available',
      'on queue': 'on-queue', 'off queue': 'off-queue', break: 'break', meal: 'meal',
      'not responding': 'not-responding', training: 'training', meeting: 'meeting', away: 'away',
      'personal reason': 'personal-reason', 'out of office': 'out-of-office',
      'out of office status': 'out-of-office-status', offline: 'offline'
    };
    if (aliases[value]) return aliases[value];
    // Some tenants append a channel or qualifier to a status name.
    const matched = Object.keys(aliases).sort((a, b) => b.length - a.length).find(name => value.includes(name));
    return matched ? aliases[matched] : 'unknown';
  }

  function profileStatusColor(doc) {
    const key = profileStatusKey(doc);
    return resolvedStatusColor(doc, key);
  }

  function resolvedStatusColor(doc, key) {
    const fallback = STATUS_DEFINITIONS[key]?.color || STATUS_DEFINITIONS.unknown.color;
    try {
      // Saved palette choices are applied as document-root variables. Reading
      // the computed value keeps the Board, command avatar, and profile cards
      // in exactly the same color family.
      return doc.defaultView.getComputedStyle(doc.documentElement)
        .getPropertyValue(`--gbs-status-${key}`).trim() || fallback;
    } catch (_) { return fallback; }
  }

  function publishCurrentAgentStatus(doc, color) {
    if (!color) return;
    let view = doc.defaultView;
    const visited = new Set();
    while (view && !visited.has(view)) {
      visited.add(view);
      try {
        view.document.documentElement.style.setProperty('--gbs-my-status-color', color);
        if (view === view.parent) break;
        view = view.parent;
      } catch (_) {
        break;
      }
    }
    try { doc.defaultView.top.__gbsCurrentProfileStatusColor = color; } catch (_) { /* cross-origin parent */ }
  }

  function publishTopProfileStatus(doc) {
    const profileButton = doc.querySelector('#user-settings-button[aria-label]');
    if (profileButton) {
      const label = profileButton.getAttribute('aria-label') || '';
      const profileName = normalizeAgentName(profileAgentName(doc));
      const key = profileStatusKey(doc);
      // "On Queue" describes queue membership, not the live presence. Resolve
      // the matching board row so Idle stays green and Interacting stays cyan.
      const color = key === 'on-queue'
        ? boardStatusColorForAgent(doc, profileName) || profileStatusColor(doc)
        : profileStatusColor(doc);
      // Keep the authoritative color on the document root before profile cards
      // mount, then make it available to same-origin embedded profile surfaces.
      doc.documentElement.style.setProperty('--gbs-my-status-color', color);
      try { doc.defaultView.top.__gbsCurrentProfileStatusColor = color; } catch (_) { /* cross-origin parent */ }
      return true;
    }
    // A profile card may be rendered in a same-origin child document, where it
    // cannot see the top command bar's :has() rule. Reuse the already-known
    // color rather than briefly falling back to grey.
    try {
      const color = doc.defaultView.top.__gbsCurrentProfileStatusColor;
      if (color) {
        doc.documentElement.style.setProperty('--gbs-my-status-color', color);
        return true;
      }
    } catch (_) { /* cross-origin parent */ }
    return false;
  }

  function highlightCurrentAgent(table) {
    const targetName = currentAgentName(table.ownerDocument);
    const showYou = boardSettings(table.ownerDocument).showYou !== false;
    let currentRow = null;
    table.querySelectorAll('tbody tr').forEach(row => {
      const agentCell = row.querySelector('td.column-agent');
      const agentLink = agentCell?.querySelector('a');
      const name = agentLink?.textContent || agentCell?.textContent;
      const isCurrent = Boolean(targetName) && normalizeAgentName(name) === targetName;
      if (isCurrent) currentRow = row;
      row.classList.toggle('gbs-current-agent', isCurrent);
      agentCell?.classList.toggle('gbs-current-agent-cell', isCurrent);

      // The application wraps the link differently between live updates.  Look
      // through the whole cell (rather than only direct children), remove any
      // stale duplicate markers, and then retain/create exactly one marker.
      const badges = agentCell ? Array.from(agentCell.querySelectorAll('.gbs-current-agent-badge')) : [];
      let badge = badges.shift();
      badges.forEach(item => item.remove());
      if (isCurrent && showYou && agentCell && !badge) {
        badge = table.ownerDocument.createElement('span');
        badge.className = 'gbs-current-agent-badge';
        badge.textContent = 'YOU';
        badge.setAttribute('aria-label', 'Current user');
        (agentLink || agentCell.firstChild).before(badge);
      } else if (!isCurrent || !showYou) {
        badge?.remove();
        badge = null;
      }
      if (isCurrent && badge) {
        const badgeStyle = getComputedStyle(badge);
        // Use the rendered badge width, including its gap, both for the visible
        // name area and for responsive Agent-column measurement below.
        const badgeSpace = Math.ceil(badge.getBoundingClientRect().width + (parseFloat(badgeStyle.marginRight) || 0));
        agentCell.style.setProperty('--gbs-agent-badge-space', `${badgeSpace}px`);
      } else {
        agentCell?.style.removeProperty('--gbs-agent-badge-space');
      }
    });
    // The top-menu accessibility label is available immediately and represents
    // the authoritative current profile state. The board remains the fallback.
    if (!publishTopProfileStatus(table.ownerDocument) && currentRow) {
      const color = table.ownerDocument.defaultView.getComputedStyle(currentRow).getPropertyValue('--gbs-status').trim();
      publishCurrentAgentStatus(table.ownerDocument, color);
    }
  }

  function measureAgentColumnWidth(table) {
    const cells = Array.from(table.querySelectorAll('thead .column-agent, tbody td.column-agent'));
    if (!cells.length) return 100;
    const doc = table.ownerDocument;
    const ruler = doc.createElement('span');
    ruler.setAttribute('aria-hidden', 'true');
    ruler.style.cssText = 'position:fixed;left:-10000px;top:-10000px;visibility:hidden;pointer-events:none;white-space:nowrap;width:max-content;max-width:none;';
    (doc.body || doc.documentElement).appendChild(ruler);
    let widest = 0;
    cells.forEach(cell => {
      const content = cell.querySelector('a, .label-value') || cell;
      const text = (content.textContent || '').replace(/\s+/g, ' ').trim();
      if (!text) return;
      const contentStyle = getComputedStyle(content);
      const cellStyle = getComputedStyle(cell);
      ruler.style.fontFamily = contentStyle.fontFamily;
      ruler.style.fontSize = contentStyle.fontSize;
      ruler.style.fontStyle = contentStyle.fontStyle;
      ruler.style.fontWeight = contentStyle.fontWeight;
      ruler.style.fontStretch = contentStyle.fontStretch;
      ruler.style.letterSpacing = contentStyle.letterSpacing;
      ruler.style.textTransform = contentStyle.textTransform;
      ruler.textContent = text;
      const padding = (parseFloat(cellStyle.paddingLeft) || 0) + (parseFloat(cellStyle.paddingRight) || 0);
      const badge = cell.querySelector('.gbs-current-agent-badge');
      const badgeStyle = badge ? getComputedStyle(badge) : null;
      const badgeWidth = badge ? (parseFloat(cell.style.getPropertyValue('--gbs-agent-badge-space')) ||
        badge.getBoundingClientRect().width + (parseFloat(badgeStyle.marginRight) || 0)) : 0;
      widest = Math.max(widest, ruler.getBoundingClientRect().width + badgeWidth + padding + 3);
    });
    ruler.remove();
    return Math.max(80, Math.ceil(widest));
  }

  function measureBoardColumnContentWidth(table, selector, fallback = 0) {
    const cells = Array.from(table.querySelectorAll(selector));
    if (!cells.length) return fallback;
    const doc = table.ownerDocument;
    const ruler = doc.createElement('span');
    ruler.setAttribute('aria-hidden', 'true');
    ruler.style.cssText = 'position:fixed;left:-10000px;top:-10000px;visibility:hidden;pointer-events:none;white-space:nowrap;width:max-content;max-width:none;';
    (doc.body || doc.documentElement).appendChild(ruler);
    let widest = fallback;
    cells.forEach(cell => {
      // Some Genesys headers retain an invisible long accessibility label
      // (for example “Time in Status”) after their visible caption becomes
      // “Time”. innerText measures the actual rendered label instead.
      const text = (cell.innerText || cell.textContent || '').replace(/\s+/g, ' ').trim();
      const content = cell.querySelector('.unescaped-html-cell, .idle-timer, .time-duration, .duration, .cell-display-text, span') || cell;
      const contentStyle = getComputedStyle(content);
      const cellStyle = getComputedStyle(cell);
      ruler.style.fontFamily = contentStyle.fontFamily;
      ruler.style.fontSize = contentStyle.fontSize;
      ruler.style.fontStyle = contentStyle.fontStyle;
      ruler.style.fontWeight = contentStyle.fontWeight;
      ruler.style.fontStretch = contentStyle.fontStretch;
      ruler.style.letterSpacing = contentStyle.letterSpacing;
      ruler.style.textTransform = contentStyle.textTransform;
      ruler.textContent = text;
      const iconWidth = Array.from(cell.querySelectorAll('gux-icon, img, .svg-icon'))
        .reduce((total, icon) => total + Math.ceil(icon.getBoundingClientRect().width || 0), 0);
      const padding = (parseFloat(cellStyle.paddingLeft) || 0) + (parseFloat(cellStyle.paddingRight) || 0);
      widest = Math.max(widest, ruler.getBoundingClientRect().width + iconWidth + padding + 3);
    });
    ruler.remove();
    return Math.max(0, Math.ceil(widest));
  }

  function measureBoardDurationColumnWidth(table) {
    const cells = Array.from(table.querySelectorAll('thead .column-duration, thead .column-duration-one, tbody td.column-duration, tbody td.column-duration-one'));
    if (!cells.length) return 40;
    const doc = table.ownerDocument;
    const ruler = doc.createElement('span');
    ruler.setAttribute('aria-hidden', 'true');
    ruler.style.cssText = 'position:fixed;left:-10000px;top:-10000px;visibility:hidden;pointer-events:none;white-space:nowrap;width:max-content;max-width:none;';
    (doc.body || doc.documentElement).appendChild(ruler);
    let widest = 40;
    const measureLine = (line, cell) => {
      const text = (line.textContent || '').replace(/\s+/g, ' ').trim();
      if (!text) return;
      const textNode = line.querySelector('.time-duration, .activity-duration, .cell-display-text, span:last-child') || line;
      const textStyle = getComputedStyle(textNode);
      ruler.style.fontFamily = textStyle.fontFamily;
      ruler.style.fontSize = textStyle.fontSize;
      ruler.style.fontStyle = textStyle.fontStyle;
      ruler.style.fontWeight = textStyle.fontWeight;
      ruler.style.fontStretch = textStyle.fontStretch;
      ruler.style.letterSpacing = textStyle.letterSpacing;
      ruler.textContent = text;
      const iconWidth = Array.from(line.querySelectorAll('gux-icon, img, .svg-icon'))
        .reduce((total, icon) => total + Math.ceil(icon.getBoundingClientRect().width || 0), 0);
      const cellStyle = getComputedStyle(cell);
      const padding = (parseFloat(cellStyle.paddingLeft) || 0) + (parseFloat(cellStyle.paddingRight) || 0);
      widest = Math.max(widest, ruler.getBoundingClientRect().width + iconWidth + padding + 3);
    };
    cells.forEach(cell => {
      const stackedLines = cell.querySelectorAll('.conversation-duration-cell-v2 > .duration, .conversation-duration-cell-v2 > .activity-duration');
      if (stackedLines.length) stackedLines.forEach(line => measureLine(line, cell));
      else measureLine(cell, cell);
    });
    ruler.remove();
    return Math.max(0, Math.ceil(widest));
  }

  function updateWrappedBoardRows(table) {
    // Batch geometry reads before class writes; only run on settled content
    // passes, not for every pointer movement during a resize.
    const states = [...table.querySelectorAll('tbody tr')].map(row => {
      const name = row.querySelector('td.column-agent a');
      const line = name ? parseFloat(table.ownerDocument.defaultView.getComputedStyle(name).lineHeight) : 0;
      const durationCell = row.querySelector('td.column-duration,td.column-duration-one');
      const duration = durationCell?.querySelector('.conversation-duration-cell-v2, .unescaped-html') || durationCell?.firstElementChild;
      const durationLine = durationCell ? parseFloat(table.ownerDocument.defaultView.getComputedStyle(durationCell).lineHeight) : 0;
      const durationWrapped = Boolean(duration && durationLine && duration.getBoundingClientRect().height > durationLine * 1.5);
      return [row, Boolean(name && line && name.getBoundingClientRect().height > line * 1.5), durationWrapped];
    });
    states.forEach(([row, wrapped, durationWrapped]) => {
      row.classList.toggle('gbs-name-wrapped', wrapped);
      row.classList.toggle('gbs-duration-wrapped', durationWrapped);
    });
  }

  function applyResponsiveBoardColumns(table, fast = false) {
    if (table.closest('.gbs-board-preview')) return;
    if (table.classList.contains('gbs-custom-columns')) {
      // The visible-column grid owns sizing. Do not allocate space to hidden
      // columns or reapply six-column font/width constraints on every tick.
      table.classList.remove('gbs-font-scaled', 'gbs-agent-font-scaled', 'gbs-time-font-scaled', 'gbs-duration-font-scaled', 'gbs-status-font-scaled', 'gbs-status-cell-compact', 'gbs-time-cell-compact', 'gbs-time-padding-balanced', 'gbs-data-padding-balanced', 'gbs-agent-compact', 'gbs-current-agent-badge-stacked');
      delete table.dataset.gbsColumnWidths;
      table.__gbsResponsiveMetrics = null;
      if (!fast) updateWrappedBoardRows(table);
      return;
    }
    const wrapper = table.closest('.table-wrapper');
    const shadowViewport = wrapper?.querySelector('gux-table')?.shadowRoot?.querySelector('.gux-table-container');
    // The scrollbar belongs to the Gux shadow viewport, so resolving it here
    // makes width allocation and the right-edge inset one atomic operation.
    if (wrapper) {
      const hasScrollbar = shadowViewport
        ? shadowViewport.scrollHeight > shadowViewport.clientHeight + 1
        : wrapper.scrollHeight > wrapper.clientHeight + 1;
      wrapper.classList.toggle('gbs-board-has-scrollbar', hasScrollbar);
    }
    const widthSources = [
      table.closest('.gbs-sidebar'),
      table.closest('.table-wrapper'),
      table.parentElement,
    ].filter(Boolean).map(element => {
      const style = getComputedStyle(element);
      const horizontalPadding = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
      return element.clientWidth - horizontalPadding;
    }).filter(width => width > 0);
    // Gux owns the vertical scrollbar inside its shadow viewport. The wrapper
    // stays wider than the actual visible table area (370px versus 363px at
    // the 400px Board floor), so wrapper-only measurements let Duration sit
    // underneath the scrollbar. Use the viewport's real client width whenever
    // it is available; clientWidth already excludes the scrollbar gutter.
    const shadowViewportWidth = shadowViewport?.clientWidth || 0;
    if (shadowViewportWidth > 0) widthSources.push(shadowViewportWidth);
    const renderedTableWidth = table.getBoundingClientRect().width;
    if (renderedTableWidth > 0) widthSources.push(renderedTableWidth);
    const availableWidth = widthSources.length
      ? Math.min(...widthSources)
      : table.getBoundingClientRect().width;
    // During a parent remount the browser can report a one-frame sliver before
    // it restores the actual sidebar width. Never replace a healthy six-column
    // layout with that temporary geometry; the next rAF/tick will use the real
    // width. Manual drag updates are exempt so they still track the pointer.
    const previousWidth = Number(table.dataset.gbsStableAvailableWidth || 0);
    const previousAt = Number(table.dataset.gbsStableAvailableAt || 0);
    const now = Date.now();
    const transientSliver = availableWidth < 120 || (
      !table.ownerDocument.body.classList.contains('gbs-resizing') &&
      previousWidth > 360 && availableWidth < previousWidth * .38 && now - previousAt < 280
    );
    if (transientSliver) return;
    table.dataset.gbsStableAvailableWidth = String(Math.round(availableWidth));
    table.dataset.gbsStableAvailableAt = String(now);
    // This is intentionally tied to the Board's own content area. A 400px
    // Board on a 2500px monitor still needs its compact cell padding.
    table.classList.toggle('gbs-board-narrow', availableWidth <= 410);
    let metrics = table.__gbsResponsiveMetrics;
    if (!fast || !metrics) {
      // Full content passes start from native font metrics. The result is cached
      // and reused during pointer movement, avoiding all per-cell text/icon
      // measurement and computed-style reads in the live path.
      table.classList.remove('gbs-font-scaled', 'gbs-agent-font-scaled', 'gbs-time-font-scaled', 'gbs-duration-font-scaled', 'gbs-status-font-scaled', 'gbs-status-cell-compact', 'gbs-time-cell-compact', 'gbs-time-padding-balanced', 'gbs-data-padding-balanced');
      table.style.setProperty('--gbs-board-font-scale', '1');
      table.style.setProperty('--gbs-agent-font-scale', '1');
      table.style.removeProperty('--gbs-time-font-size');
      table.style.removeProperty('--gbs-duration-font-size');
      table.style.removeProperty('--gbs-status-cell-font-size');
      const timeMeasureCell = table.querySelector('tbody td.column-timeInStatus, thead .column-timeInStatus');
      const timeMeasureStyle = getComputedStyle(timeMeasureCell || table);
      const measuredTimePadLeft = parseFloat(timeMeasureStyle.paddingLeft) || 0;
      const measuredTimePadRight = parseFloat(timeMeasureStyle.paddingRight) || 0;
      const bodyTimeMeasure = measureBoardColumnContentWidth(table, 'tbody td.column-timeInStatus', 0);
      const agentCell = table.querySelector('tbody td.column-agent');
      const baseBoardFont = parseFloat(getComputedStyle(agentCell || table).fontSize) || 16;
      const statusCell = table.querySelector('tbody td.column-status, thead .column-status');
      const measuredStatusFont = parseFloat(getComputedStyle(statusCell || table).fontSize) || baseBoardFont;
      // Status can be mounted while Genesys briefly applies an oversized
      // transition font.  Never preserve that transient value as the table's
      // baseline: Status must only shrink from the Board's normal text size,
      // never grow beyond it.
      const nativeStatusFont = Math.min(baseBoardFont, measuredStatusFont);
      const statusBaseFont = Math.min(
        baseBoardFont,
        Math.max(10, Number(table.dataset.gbsStatusBaseFont || 0) || nativeStatusFont),
      );
      if (!table.dataset.gbsStatusBaseFont) table.dataset.gbsStatusBaseFont = String(statusBaseFont);
      metrics = {
        agentPreferred: measureAgentColumnWidth(table),
        timeInStatus: measureBoardColumnContentWidth(table, 'tbody td.column-timeInStatus', 40),
        longestTimeTextWidth: Math.max(0, bodyTimeMeasure - measuredTimePadLeft - measuredTimePadRight),
        duration: measureBoardDurationColumnWidth(table),
        statusContent: measureBoardColumnContentWidth(table, 'thead .column-status, tbody td.column-status', 0),
        baseBoardFont,
        statusBaseFont,
      };
      table.__gbsResponsiveMetrics = metrics;
    }
    const agentPreferred = metrics.agentPreferred;
    let timeInStatus = metrics.timeInStatus;
    const longestTimeTextWidth = metrics.longestTimeTextWidth;
    let duration = metrics.duration;
    const statusContent = metrics.statusContent;
    const baseBoardFont = metrics.baseBoardFont;
    const statusBaseFont = metrics.statusBaseFont;
    const minimumStatus = 60;
    const preferredPresence = 32;
    const preferredRank = 26;
    const minimumPresence = 28;
    const minimumRank = 22;
    const agentFloorBeforeFixedShrink = 100;
    const minimumAgent = 80;
    // Reserve the shadow-DOM scrollbar's 6px gutter before deciding whether
    // the content needs to shrink. A vertical scrollbar can appear only after
    // this pass has laid out a newly added row; without this reservation the
    // right-most duration border briefly sits underneath it. Do not reserve it
    // once even the requested hard minimums cannot fit — at that point every
    // pixel must remain available to the six actual columns.
    const minimumColumnTotal = minimumPresence + minimumRank + minimumAgent +
      timeInStatus + minimumStatus + duration;
    // Do not deduct the gutter twice when the shadow viewport supplied the
    // available width. Before Gux has mounted, retain the predictive reserve
    // so a scrollbar created by the first layout still cannot cover the edge.
    const scrollbarReserve = shadowViewportWidth > 0
      ? 0
      : (availableWidth >= minimumColumnTotal + 7 ? 7 : 0);
    const allocatableWidth = Math.max(0, availableWidth - scrollbarReserve);
    let presenceWidth = preferredPresence;
    let rankWidth = preferredRank;
    let agent = agentPreferred;
    let status = minimumStatus;
    const preferredColumnTotal = agent + presenceWidth + rankWidth + timeInStatus + duration + status;
    let shortage = Math.max(0, agent + presenceWidth + rankWidth + timeInStatus + duration + status - allocatableWidth);
    // First preserve normal presence/rank dimensions while Agent reduces down
    // to 100px. The compact fixed columns only start yielding after that.
    const reduceAgentBeforeFixed = Math.min(shortage, Math.max(0, agent - agentFloorBeforeFixedShrink));
    agent -= reduceAgentBeforeFixed;
    shortage -= reduceAgentBeforeFixed;
    const reducePresence = Math.min(shortage, presenceWidth - minimumPresence);
    presenceWidth -= reducePresence;
    shortage -= reducePresence;
    const reduceRank = Math.min(shortage, rankWidth - minimumRank);
    rankWidth -= reduceRank;
    shortage -= reduceRank;
    // Only after the circle/# columns have reached their requested minimums
    // may Agent use its final 80px width. Time/Duration remain content-safe.
    const reduceAgentToMinimum = Math.min(shortage, Math.max(0, agent - minimumAgent));
    agent -= reduceAgentToMinimum;
    shortage -= reduceAgentToMinimum;
    let boardFontScale = 1;
    const columnFonts = {
      time: baseBoardFont,
      duration: baseBoardFont,
      status: statusBaseFont,
      agent: baseBoardFont,
    };
    // If the hard-width layout cannot fit, yield fonts in a deterministic
    // round-robin: Time -> Duration -> Status -> Agent. Every visit is exactly
    // one pixel; only then does the next cycle begin. This preserves the most
    // important labels for as long as the available width permits.
    if (shortage > .5) {
      let compactLayout = null;
      const minimumFont = 10 + (boardSettings(table.ownerDocument).fontOffset || 0);
      const fitAtCurrentFonts = () => {
        const scaleFor = key => columnFonts[key] / baseBoardFont;
        const candidate = {
          presence: minimumPresence,
          rank: minimumRank,
          agent: Math.max(40, Math.min(minimumAgent, Math.ceil(agentPreferred * scaleFor('agent')))),
          time: Math.max(30, Math.ceil(timeInStatus * scaleFor('time'))),
          status: Math.max(32, Math.ceil(statusContent * (columnFonts.status / statusBaseFont))),
          duration: Math.max(30, Math.ceil(duration * scaleFor('duration'))),
        };
        const total = candidate.presence + candidate.rank + candidate.agent +
          candidate.time + candidate.status + candidate.duration;
        return total <= allocatableWidth ? candidate : null;
      };
      compactLayout = fitAtCurrentFonts();
      const fontOrder = ['time', 'duration', 'status', 'agent'];
      while (!compactLayout) {
        let changed = false;
        for (const key of fontOrder) {
          if (columnFonts[key] > minimumFont) {
            columnFonts[key] -= 1;
            changed = true;
          }
          compactLayout = fitAtCurrentFonts();
          if (compactLayout) break;
        }
        if (!changed) break;
      }
      if (compactLayout) {
        presenceWidth = compactLayout.presence;
        rankWidth = compactLayout.rank;
        agent = compactLayout.agent;
        timeInStatus = compactLayout.time;
        status = compactLayout.status;
        duration = compactLayout.duration;
        shortage = 0;
      } else {
        // The available width is below even the legible 10px arrangement.
        // Keep the existing structural floors, but never reduce text past 10px.
        for (const key of Object.keys(columnFonts)) columnFonts[key] = minimumFont;
      }
    }
    const surplus = Math.max(0, allocatableWidth - (agent + presenceWidth + rankWidth + timeInStatus + duration + status));
    let allocatedTime = timeInStatus;
    let allocatedDuration = duration;
    if (!shortage) {
      // Once every preferred column fits, distribute surplus exactly as the
      // former wide layout did, without making Agent wider than its content.
      status += surplus / 3;
      // Time and Duration receive equal room after their measured minima.
      // Agent stays at its calculated content maximum.
      allocatedTime += surplus / 3;
      allocatedDuration += surplus / 3;
    }

    // A fresh duration can become wider between the initial row render and
    // this allocator's next measurement.  Keep a final hard-fit pass after
    // surplus distribution so that one longer value can never make the table
    // (or its 4px coloured end borders) escape the 400px Board floor.
    let renderedTotal = presenceWidth + rankWidth + agent + allocatedTime + status + allocatedDuration;
    let visualOverflow = Math.max(0, renderedTotal - allocatableWidth);
    const yieldWidth = (value, floor, assign) => {
      const reduction = Math.min(visualOverflow, Math.max(0, value - floor));
      if (reduction) {
        assign(value - reduction);
        visualOverflow -= reduction;
      }
    };
    if (visualOverflow > .1) {
      yieldWidth(agent, 40, value => { agent = value; });
      yieldWidth(presenceWidth, minimumPresence, value => { presenceWidth = value; });
      yieldWidth(rankWidth, minimumRank, value => { rankWidth = value; });
      yieldWidth(allocatedTime, 30, value => { allocatedTime = value; });
      yieldWidth(status, 32, value => { status = value; });
      yieldWidth(allocatedDuration, 30, value => { allocatedDuration = value; });
      renderedTotal = presenceWidth + rankWidth + agent + allocatedTime + status + allocatedDuration;
    }

    // If the narrow layout has spare Status width, lend only that unused space
    // to Time before considering clipping.  This preserves the centred Status
    // title while allowing a longer timer to remain naturally left-aligned.
    const statusContentFloor = Math.max(48, statusContent - 8);
    const statusSpare = Math.max(0, status - statusContentFloor);
    const compactTimeNeed = Math.max(0, longestTimeTextWidth + 4 - allocatedTime);
    const timeTransfer = Math.min(statusSpare, Math.max(compactTimeNeed, compactTimeNeed > 0 ? 3 : 0));
    if (timeTransfer > 0) {
      status -= timeTransfer;
      allocatedTime += timeTransfer;
    }

    // Status content and all body-only padding use their own calculated font.
    // Header text is intentionally excluded from these decisions.
    const statusContentAtFont = statusContent * (columnFonts.status / statusBaseFont);
    const statusWouldTruncate = statusContentAtFont > status + .5;
    const compactStatusFont = columnFonts.status;
    table.classList.toggle('gbs-status-cell-compact', statusWouldTruncate);
    // Always explicitly own the Status size.  Genesys occasionally writes an
    // enlarged inline font to an individual Status cell during a table update;
    // leaving the variable unset in the ordinary state let that value win.
    table.classList.add('gbs-status-font-scaled');
    table.style.setProperty('--gbs-status-cell-font-size', `${Math.min(statusBaseFont, compactStatusFont)}px`);
    const resolveDataPadding = (selector, innerSelector, columnWidth, fontScale = 1) => {
      const cells = Array.from(table.querySelectorAll(selector));
      const sample = cells[0];
      if (!sample) return { left: 0, right: 0 };
      const sampleStyle = getComputedStyle(sample);
      const cap = availableWidth <= 410 ? 3 : Math.min(
        parseFloat(sampleStyle.paddingLeft) || 0,
        parseFloat(sampleStyle.paddingRight) || 0,
      );
      const contentWidth = cells.reduce((widest, cell) => {
        const content = cell.querySelector(innerSelector);
        if (!content) return widest;
        const box = content.getBoundingClientRect();
        return Math.max(widest, Math.ceil(Math.max(box.width || 0, content.scrollWidth || 0) * fontScale));
      }, 0);
      const free = Math.max(0, columnWidth - contentWidth);
      const left = Math.min(cap, Math.floor(free / 2));
      const right = Math.min(cap, Math.max(left, Math.ceil(free / 2)));
      return { left, right };
    };
    const existingPadding = name => parseFloat(table.style.getPropertyValue(name)) || 0;
    const timePadding = fast
      ? { left: existingPadding('--gbs-time-pad-left'), right: existingPadding('--gbs-time-pad-right') }
      : resolveDataPadding('tbody td.column-timeInStatus', '.unescaped-html-cell, .idle-timer, .cell-display-text, span', allocatedTime, columnFonts.time / baseBoardFont);
    const agentPadding = fast
      ? { left: existingPadding('--gbs-agent-pad-left'), right: existingPadding('--gbs-agent-pad-right') }
      : resolveDataPadding('tbody td.column-agent', 'a', agent, columnFonts.agent / baseBoardFont);
    const durationPadding = fast
      ? { left: existingPadding('--gbs-duration-pad-left'), right: existingPadding('--gbs-duration-pad-right') }
      : resolveDataPadding(
        'tbody td.column-duration, tbody td.column-duration-one',
        '.conversation-duration-cell-v2, .duration, .time-duration, .unescaped-html-cell, .cell-display-text',
        allocatedDuration,
        columnFonts.duration / baseBoardFont,
      );
    const timeWouldCrowd = longestTimeTextWidth * (columnFonts.time / baseBoardFont) + timePadding.left + timePadding.right > allocatedTime + .5;
    table.classList.toggle('gbs-time-cell-compact', timeWouldCrowd);
    table.classList.add('gbs-time-padding-balanced', 'gbs-data-padding-balanced');
    table.style.setProperty('--gbs-time-pad-left', `${timePadding.left}px`);
    table.style.setProperty('--gbs-time-pad-right', `${timePadding.right}px`);
    table.style.setProperty('--gbs-agent-pad-left', `${agentPadding.left}px`);
    table.style.setProperty('--gbs-agent-pad-right', `${agentPadding.right}px`);
    table.style.setProperty('--gbs-duration-pad-left', `${durationPadding.left}px`);
    table.style.setProperty('--gbs-duration-pad-right', `${durationPadding.right}px`);

    // Width reduction may wrap a name, but must never secretly scale it.  The
    // Agent font is exclusively controlled by the final position in the
    // Time -> Duration -> Status -> Agent one-pixel reduction cycle above.
    const agentNeedsWrap = agentPreferred > 0 && agent < agentPreferred - .5;
    const agentFontScale = columnFonts.agent < baseBoardFont - .01
      ? columnFonts.agent / baseBoardFont
      : 1;
    table.classList.toggle('gbs-agent-font-scaled', agentFontScale < .999);
    table.style.setProperty('--gbs-agent-font-scale', agentFontScale.toFixed(3));
    table.classList.toggle('gbs-time-font-scaled', columnFonts.time < baseBoardFont - .01);
    table.classList.toggle('gbs-duration-font-scaled', columnFonts.duration < baseBoardFont - .01);
    table.style.setProperty('--gbs-time-font-size', `${columnFonts.time}px`);
    table.style.setProperty('--gbs-duration-font-size', `${columnFonts.duration}px`);
    table.classList.remove('gbs-font-scaled');
    table.style.setProperty('--gbs-board-font-scale', '1');
    // This comparison deliberately uses the original preferred total. It is
    // stable across renders, so a badge cannot flicker between inline and
    // stacked merely because a wrapped name changed the table's height.
    table.classList.toggle('gbs-current-agent-badge-stacked', preferredColumnTotal > allocatableWidth + 1);

    const widths = {
      '.column-agentPresence': presenceWidth,
      '.gbs-rank-header, .gbs-rank-cell': rankWidth,
      '.column-agent': agent,
      '.column-timeInStatus': allocatedTime,
      '.column-status': status,
      '.column-duration': allocatedDuration,
      '.column-duration-one': allocatedDuration,
    };
    table.classList.toggle('gbs-agent-compact', agentNeedsWrap);
    // Include the number of matching cells. Genesys appends rows without
    // changing the calculated widths; a width-only signature therefore left
    // new/single rows at native widths and visually short of six columns.
    const signature = `font:${columnFonts.time}:${columnFonts.duration}:${columnFonts.status}:${columnFonts.agent}:${agentFontScale.toFixed(3)}:${agentNeedsWrap ? 1 : 0}|status-compact:${statusWouldTruncate ? compactStatusFont : 'no'}|time-compact:${timeWouldCrowd ? 1 : 0}|time-pad:${timePadding.left}:${timePadding.right}|agent-pad:${agentPadding.left}:${agentPadding.right}|duration-pad:${durationPadding.left}:${durationPadding.right}|` + Object.entries(widths).map(([key, value]) => {
      const count = fast ? 'cached' : table.querySelectorAll(`thead ${key}, tbody td${key}`).length;
      return `${key}:${Math.round(value)}:${count}`;
    }).join('|');
    if (table.dataset.gbsColumnWidths === signature) {
      if (!fast) updateWrappedBoardRows(table);
      return;
    }
    table.dataset.gbsColumnWidths = signature;
    // Older releases wrote width/min/max to every cell on each pass (roughly
    // 250 inline mutations for a 13-row Board). Migrate those old important
    // declarations once, then drive the complete table with six inherited CSS
    // variables. New Genesys rows automatically receive the current widths.
    if (table.dataset.gbsVariableColumns !== 'true') {
      table.querySelectorAll('thead th, tbody td').forEach(cell => {
        ['width', 'min-width', 'max-width'].forEach(property => {
          if (cell.style.getPropertyPriority(property) === 'important') cell.style.removeProperty(property);
        });
      });
      table.dataset.gbsVariableColumns = 'true';
    }
    const columnVariables = {
      '--gbs-col-presence': presenceWidth,
      '--gbs-col-rank': rankWidth,
      '--gbs-col-agent': agent,
      '--gbs-col-time': allocatedTime,
      '--gbs-col-status': status,
      '--gbs-col-duration': allocatedDuration,
    };
    Object.entries(columnVariables).forEach(([property, width]) => {
      table.style.setProperty(property, `${Math.max(0, Math.round(width))}px`);
    });
    if (!fast) updateWrappedBoardRows(table);
  }

  function ensureBoardColumnResizeObserver(table) {
    if (table.__gbsColumnResizeObserver || !table.ownerDocument.defaultView.ResizeObserver) return;
    const target = table.closest('.gbs-sidebar') || table.closest('.table-wrapper') || table.parentElement;
    if (!target) return;
    const view = table.ownerDocument.defaultView;
    const observer = new view.ResizeObserver(() => {
      if (table.ownerDocument.body.classList.contains('gbs-resizing')) return;
      if (view.performance.now() < (table.__gbsSuppressColumnResizeUntil || 0)) return;
      // Workspace/window animation gets a measurement-free cached fit on each
      // paint, followed by one authoritative content pass after 90ms quiet.
      if (table.__gbsResponsiveMetrics && !table.__gbsColumnResizeFrame) {
        table.__gbsColumnResizeFrame = view.requestAnimationFrame(() => {
          table.__gbsColumnResizeFrame = 0;
          if (table.isConnected) applyResponsiveBoardColumns(table, true);
        });
      }
      if (table.__gbsColumnResizeTimer) view.clearTimeout(table.__gbsColumnResizeTimer);
      table.__gbsColumnResizeTimer = view.setTimeout(() => {
        table.__gbsColumnResizeTimer = 0;
        if (!table.isConnected) return;
        applyResponsiveBoardColumns(table);
        fitDashboardMetricSpacing(table.ownerDocument);
      }, 90);
    });
    observer.observe(target);
    table.__gbsColumnResizeObserver = observer;
  }

  function shortenTimeHeader(table) {
    const header = table.querySelector('thead th[data-column-name="timeInStatus"], thead th.column-timeInStatus');
    if (!header || header.dataset.gbsShortTimeHeader === 'true') return;
    const walker = table.ownerDocument.createTreeWalker(header, 4);
    let textNode;
    while ((textNode = walker.nextNode())) {
      if (/^\s*Time\s+in\s+Status\s*$/i.test(textNode.nodeValue || '')) {
        textNode.nodeValue = (textNode.nodeValue || '').replace(/Time\s+in\s+Status/i, 'Time');
        header.dataset.gbsShortTimeHeader = 'true';
        break;
      }
    }
  }

  function sortBoard(table) {
    if (table.closest('.gbs-board-preview')) return;
    const body = table.tBodies[0];
    if (!body) return;
    injectStyles(table.ownerDocument);
    table.classList.add('gbs-board');
    shortenTimeHeader(table);
    if (themeMode(table.ownerDocument) !== 'light') ensureRankColumn(table);
    ensureBoardColumnResizeObserver(table);
    // The live divider owns sizing while held. The one-second maintenance
    // tick must not enter the full sorter/measurement path mid-drag.
    if (table.ownerDocument.body.classList.contains('gbs-resizing')) {
      highlightCurrentAgent(table);
      return;
    }

    // Genesys updates every visible duration once per second. Those text-only
    // ticks do not change status order or column requirements, but the old
    // path remeasured every cell and rewrote every row each time. Cache the
    // structural/layout shape while deliberately ignoring changing digits.
    const structuralRows = Array.from(body.rows).filter(row => row.querySelector('td.column-agent'));
    const knownStatuses = table.__gbsAgentStatusByIdentity || (table.__gbsAgentStatusByIdentity = new Map());
    // Keep a tiny identity -> colour cache. Ember can replace the whole tbody
    // when somebody enters/leaves, creating new rows one frame before its
    // Status text arrives. The cache lets those replacement rows retain their
    // own last colour instead of every visible row flashing grey.
    structuralRows.forEach(row => {
      const agentCell = row.querySelector('td.column-agent');
      const identity = agentCell?.querySelector('a[href]')?.getAttribute('href') || agentCell?.textContent.trim() || '';
      const key = statusKey(row.querySelector('td.column-status')?.textContent || '');
      if (identity && key && key !== 'unknown') knownStatuses.set(identity, key);
    });
    const boardShape = [
      Math.round(table.closest('.table-wrapper')?.getBoundingClientRect().width || table.getBoundingClientRect().width),
      ...structuralRows.map(row => {
        const agent = row.querySelector('td.column-agent a[href]')?.getAttribute('href') || row.querySelector('td.column-agent')?.textContent.trim() || '';
        const status = statusKey(row.querySelector('td.column-status')?.textContent || '');
        const timeShape = (row.querySelector('td.column-timeInStatus')?.textContent || '').replace(/\d/g, '0').replace(/\s+/g, ' ').trim();
        const durationCell = row.querySelector('td.column-duration, td.column-duration-one');
        const durationShape = (durationCell?.textContent || '').replace(/\d/g, '0').replace(/\s+/g, ' ').trim();
        const mediaCount = durationCell?.querySelectorAll('gux-icon, .media-icon, .activity-icon').length || 0;
        return `${agent}|${status}|${timeShape}|${durationShape}|${mediaCount}`;
      })
    ].join('~');
    if (table.dataset.gbsBoardShape === boardShape) {
      highlightCurrentAgent(table);
      return;
    }
    table.dataset.gbsBoardShape = boardShape;
    table.__gbsResponsiveMetrics = null;

    const seenAgents = new Set();
    Array.from(body.rows).forEach(row => {
      const agentCell = row.querySelector('td.column-agent');
      if (!agentCell) return;
      ensureCompleteBoardRow(row);
      const agentLink = agentCell.querySelector('a[href]');
      const identity = agentLink?.getAttribute('href') || agentCell.textContent.trim();
      if (!identity || !seenAgents.has(identity)) {
        if (identity) seenAgents.add(identity);
        return;
      }
      // These are stale rows produced by the previous physical reordering.
      // Removing only an exact agent identity is safe and prevents their return.
      row.remove();
    });

    const rows = Array.from(body.rows).filter(row => row.querySelector('td.column-agent'));
    const ordered = rows.map((row, index) => {
      const status = row.querySelector('td.column-status')?.textContent || '';
      const time = row.querySelector('td.column-timeInStatus')?.textContent || '';
      return { row, index, key: statusKey(status), rank: statusRank(status), time: timeInSeconds(time) };
    }).sort((a, b) => a.rank - b.rank || b.time - a.time || a.index - b.index);

    // # restarts at 1 for each status category.
    let previousKey = null;
    let categoryPosition = 0;
    ordered.forEach((item, order) => {
      categoryPosition = item.key === previousKey ? categoryPosition + 1 : 1;
      previousKey = item.key;
      setRowPresentation(item.row, categoryPosition, item.key);
      item.row.style.order = String(order);
    });
    highlightCurrentAgent(table);
    // Rank and any conditionally omitted Genesys cells now exist, so all six
    // columns receive their widths together on this same render pass.
    applyResponsiveBoardColumns(table);
  }

  function ensureImmediateBoardStatusRefresh(doc) {
    if (doc.__gbsImmediateStatusObserver || !doc.body || !doc.defaultView?.MutationObserver) return;
    let frame = 0;
    const pendingTables = new Set();
    const tableFor = node => {
      const element = node?.nodeType === 1 ? node : node?.parentElement;
      return element?.closest?.('table.gbs-board') || null;
    };
    const affectsStatus = mutation => {
      const nodes = [mutation.target, ...mutation.addedNodes];
      return nodes.some(node => {
        const element = node?.nodeType === 1 ? node : node?.parentElement;
        if (!element) return false;
        return element.closest?.('td.column-status') || element.matches?.('td.column-status') || element.querySelector?.('td.column-status');
      });
    };
    const affectsBoardRows = mutation => {
      if (mutation.type !== 'childList') return false;
      const target = mutation.target?.nodeType === 1 ? mutation.target : mutation.target?.parentElement;
      const body = target?.closest?.('tbody');
      if (!body?.closest?.('table.gbs-board')) return false;
      // A whole row is the normal Genesys join/leave update. Do not treat the
      // once-per-second timer text updates as a structural refresh.
      return [...mutation.addedNodes, ...mutation.removedNodes].some(node =>
        node?.nodeType === 1 && (node.matches?.('tr, td.column-agent, td.column-status') || node.querySelector?.('tr, td.column-agent, td.column-status')),
      );
    };
    const stabilizeBoardRowColors = table => {
      const knownStatuses = table.__gbsAgentStatusByIdentity || (table.__gbsAgentStatusByIdentity = new Map());
      table.tBodies[0]?.querySelectorAll(':scope > tr').forEach(row => {
        const agentCell = row.querySelector('td.column-agent');
        if (!agentCell) return;
        const identity = agentCell.querySelector('a[href]')?.getAttribute('href') || agentCell.textContent.trim() || '';
        const observedKey = statusKey(row.querySelector('td.column-status')?.textContent || '');
        const previousKey = row.dataset.gbsStatus || knownStatuses.get(identity) || '';
        const stableKey = observedKey && observedKey !== 'unknown' ? observedKey : previousKey;
        if (!stableKey || stableKey === 'unknown') return;
        if (identity) knownStatuses.set(identity, stableKey);
        row.classList.remove(...Array.from(row.classList).filter(name => name.startsWith('gbs-status-')));
        row.classList.add(`gbs-status-${stableKey}`);
        row.dataset.gbsStatus = stableKey;
      });
    };
    const flush = () => {
      frame = 0;
      const tables = [...pendingTables];
      pendingTables.clear();
      tables.forEach(table => {
        if (table.isConnected && isAgentBoard(table)) sortBoard(table);
      });
      if (tables.length) {
        publishTopProfileStatus(doc);
        // The Board normally lives in Homepage's iframe while the command
        // bar lives in the top document.  Update that companion surface in
        // this same frame rather than waiting for its next maintenance pass.
        try { publishTopProfileStatus(doc.defaultView.top.document); } catch (_) { /* cross-origin parent */ }
        syncHoverCardStatusColors(doc);
      }
    };
    const observer = new doc.defaultView.MutationObserver(mutations => {
      mutations.forEach(mutation => {
        if (!affectsStatus(mutation) && !affectsBoardRows(mutation)) return;
        const table = tableFor(mutation.target) || [...mutation.addedNodes].map(tableFor).find(Boolean);
        if (table) pendingTables.add(table);
      });
      // This runs in the MutationObserver microtask, before the next paint.
      // Sorting/ranking remains deferred to rAF, but row colours never wait.
      pendingTables.forEach(table => {
        renameInCallLabels(table);
        stabilizeBoardRowColors(table);
      });
      if (pendingTables.size && !frame) frame = doc.defaultView.requestAnimationFrame(flush);
    });
    observer.observe(doc.body, { childList: true, characterData: true, subtree: true });
    doc.__gbsImmediateStatusObserver = observer;
  }

  function shortenDashboardQueueLink(link) {
    const visibleLabel = link?.textContent?.trim() || '';
    if (!visibleLabel.startsWith('KITS_')) {
      link?.removeAttribute('data-gbs-short-label');
      return;
    }
    link.dataset.gbsShortLabel = visibleLabel.slice(5);
    link.title = visibleLabel;
  }

  function shortenDashboardQueueLabels(doc) {
    doc.querySelectorAll('.main-grid .analytics-ui-dashboard-widget a').forEach(shortenDashboardQueueLink);
  }

  function suppressQueueActionTooltips(doc) {
    doc.querySelectorAll('.analytics-ui-gux-table button.gux-ghost[aria-label="Deactivate"], .analytics-ui-gux-table button.gux-ghost[aria-label="Activate"]').forEach(button => {
      button.removeAttribute('title');
      const tooltipId = button.getAttribute('aria-describedby');
      if (tooltipId) {
        button.removeAttribute('aria-describedby');
        doc.getElementById(tooltipId)?.remove();
      }
    });
    // Genesys portals these tooltips at document level, outside the table and
    // button Shadow DOM. Hide only the two Queue-action labels, leaving every
    // other product tooltip available.
    doc.querySelectorAll('gux-tooltip, [role="tooltip"]').forEach(tooltip => {
      if (!/^(deactivate|activate)$/i.test((tooltip.textContent || '').trim())) return;
      tooltip.style.setProperty('display', 'none', 'important');
      tooltip.style.setProperty('visibility', 'hidden', 'important');
      tooltip.setAttribute('aria-hidden', 'true');
    });
  }

  function ensureTabUnderlines(doc) {
    doc.querySelectorAll('gux-tabs-advanced.analytics-ui-main-app-tabs .gux-tab').forEach(tab => {
      if (tab.querySelector(':scope > .gbs-tab-underline')) return;
      const underline = doc.createElement('span');
      underline.className = 'gbs-tab-underline';
      underline.setAttribute('aria-hidden', 'true');
      tab.appendChild(underline);
    });
  }

  function metricValue(widget, metricClass) {
    const text = widget.querySelector(`.${metricClass} .cell-display-text`)?.textContent || '';
    const value = Number(text.replace(/[^0-9.-]/g, ''));
    return Number.isFinite(value) ? value : 0;
  }

  function updateSlaBadges(doc) {
    doc.querySelectorAll('.analytics-ui-dashboard-widget').forEach(widget => {
      const title = widget.querySelector('.widget-title-display');
      const heading = title?.querySelector('h2');
      const titleText = heading?.textContent.trim() || '';
      const isPrimarySla = titleText === 'SLA';
      const isRegionalSla = /^(UK|PL|FR)\s+SLA$/i.test(titleText);
      if (!title || (!isPrimarySla && !isRegionalSla)) return;
      const answered = metricValue(widget, 'data-cell-metric-ANSWERED_COUNT');
      const metSla = metricValue(widget, 'data-cell-metric-MET_SERVICE_LEVEL');
      // Every SLA card uses the same direct operational measure.
      const denominator = answered;
      const percentage = denominator > 0 ? Number(((metSla / denominator) * 100).toFixed(1)) : null;
      let badge = title.querySelector('.gbs-sla-badge');
      if (!badge) {
        badge = doc.createElement('span');
        badge.className = 'gbs-sla-badge';
        title.appendChild(badge);
      }
      title.classList.add('gbs-sla-title');
      badge.textContent = percentage === null ? '—' : `${percentage.toFixed(1)}%`;
      badge.classList.toggle('gbs-sla-good', percentage !== null && percentage >= 90);
      badge.classList.toggle('gbs-sla-low', percentage !== null && percentage < 90);
      badge.classList.toggle('gbs-sla-neutral', percentage === null);
    });
  }

  function fitDashboardToViewport(doc) {
    const dashboard = doc.querySelector('.main-grid');
    if (!dashboard) return;
    // getBoundingClientRect().top already includes the current compact/full menu
    // height. Adding a menu offset here made the board overflow the iframe.
    const availableHeight = Math.max(0, Math.floor(doc.defaultView.innerHeight - dashboard.getBoundingClientRect().top));
    const signature = String(availableHeight);
    if (dashboard.dataset.gbsViewportHeight !== signature) {
      dashboard.dataset.gbsViewportHeight = signature;
      dashboard.style.setProperty('min-height', `${availableHeight}px`, 'important');
    }
    // The Board is a sibling dashboard layout, rather than a child of .main-grid.
    // Its own flex chain therefore must receive the compact-menu height as well.
    const sidebar = doc.querySelector('.gbs-sidebar');
    const boardLayout = sidebar?.parentElement;
    const rail = sidebar?.querySelector(':scope > .gbs-resizer');
    if (!sidebar || !boardLayout || !rail) return;
    const targetBottom = dashboard.getBoundingClientRect().top + availableHeight;
    const heightToBottom = element => Math.max(0, Math.ceil(targetBottom - element.getBoundingClientRect().top));
    const layoutChain = [];
    let layoutNode = boardLayout;
    while (layoutNode && layoutNode !== doc.body) {
      layoutChain.push(layoutNode);
      // The engine wrapper was the final 49px limiter on compact windows.
      if (layoutNode.classList.contains('analytics-ui-application')) break;
      layoutNode = layoutNode.parentElement;
    }
    layoutChain.forEach(element => {
      const targetHeight = heightToBottom(element);
      element.style.setProperty('min-height', `${targetHeight}px`, 'important');
      element.style.setProperty('height', `${targetHeight}px`, 'important');
    });
    const boardHeight = heightToBottom(boardLayout);
    sidebar.style.setProperty('min-height', `${boardHeight}px`, 'important');
    sidebar.style.setProperty('height', `${boardHeight}px`, 'important');
    rail.style.setProperty('height', `${heightToBottom(rail)}px`, 'important');
  }

  function fitAnalyticsFrameToViewport(doc) {
    // Apply the compact-shell height correction to every center-stage iframe
    // client (Analytics, Profile, and future embedded applications).
    doc.querySelectorAll('.application-scroll').forEach(host => {
      const frameRouter = host.querySelector('frame-router.main-iframe, .main-iframe');
      if (!frameRouter) return;
      const height = Math.max(0, Math.ceil(doc.defaultView.innerHeight - host.getBoundingClientRect().top));
      if (host.dataset.gbsViewportHeight === String(height)) return;
      host.dataset.gbsViewportHeight = String(height);
      [host, frameRouter, frameRouter.querySelector('iframe')].filter(Boolean).forEach(element => {
        element.style.setProperty('height', `${height}px`, 'important');
        element.style.setProperty('min-height', `${height}px`, 'important');
      });
    });
  }

  function setDashboardBoardMode(dashboard, board, boardLayout, collapsed) {
    const wasCollapsed = dashboard.classList.contains('gbs-dashboard-widgets-collapsed');
    dashboard.classList.toggle('gbs-dashboard-widgets-collapsed', collapsed);
    board?.classList.toggle('gbs-board-expanded', collapsed);
    boardLayout?.classList.toggle('gbs-board-layout-expanded', collapsed);
    if (wasCollapsed === collapsed) return;
    if (collapsed && board) {
      // A previous normal Dashboard split leaves width/flex inline on the
      // Board. CSS can override it visually, but layout measurements still
      // observe the stale 50% basis. Clear it so the Board truly owns all
      // remaining space next to Agent Workspace.
      ['width', 'min-width', 'max-width', 'flex'].forEach(property => board.style.removeProperty(property));
      boardLayout?.style.removeProperty('--gbs-board-width');
    } else if (board) {
      applySidebarRatio(board, workspaceVisibleInTopDocument(board.ownerDocument));
    }
    // A changed Dashboard visibility changes the Board's true viewport width.
    // Refit against that settled width on the next paint rather than retaining
    // column variables calculated for the previous split.
    const view = board?.ownerDocument.defaultView;
    view?.requestAnimationFrame(() => {
      const table = board?.querySelector('table.gbs-board');
      if (table?.isConnected) applyResponsiveBoardColumns(table);
    });
  }

  function syncDashboardWidgetsForWorkspace(doc) {
    const dashboard = doc.querySelector('.main-grid');
    if (!dashboard) return;
    const board = doc.querySelector('.gbs-sidebar, .grid-sidebar');
    const boardLayout = board?.parentElement;
    const workspaceVisible = workspaceVisibleInTopDocument(doc);
    const previousWorkspaceState = dashboard.dataset.gbsWorkspaceVisible;
    let toggle = doc.body?.querySelector('.gbs-dashboard-widgets-reopen');
    if (!workspaceVisible) {
      toggle?.remove();
      setDashboardBoardMode(dashboard, board, boardLayout, false);
      delete dashboard.dataset.gbsDashboardWidgetsUserOpen;
      dashboard.dataset.gbsWorkspaceVisible = 'false';
      // A resize observer owns ordinary viewport changes. Restore the saved
      // non-workspace ratio only once when the workspace actually closes.
      if (board && previousWorkspaceState !== 'false') applySidebarRatio(board, false);
      return;
    }
    dashboard.dataset.gbsWorkspaceVisible = 'true';
    // Restore the user's last Agent Workspace-specific Dashboard state. This
    // preference is independent of the normal non-Workspace layout.
    if (previousWorkspaceState !== 'true') {
      const collapsed = readWorkspaceDashboardCollapsed(doc);
      setDashboardBoardMode(dashboard, board, boardLayout, collapsed);
      dashboard.dataset.gbsDashboardWidgetsUserOpen = collapsed ? 'false' : 'true';
    }
    if (!toggle) {
      toggle = doc.createElement('button');
      toggle.type = 'button';
      toggle.className = 'gbs-dashboard-widgets-reopen';
      toggle.addEventListener('click', () => {
        const collapsed = !dashboard.classList.contains('gbs-dashboard-widgets-collapsed');
        setDashboardBoardMode(dashboard, board, boardLayout, collapsed);
        dashboard.dataset.gbsDashboardWidgetsUserOpen = collapsed ? 'false' : 'true';
        saveWorkspaceDashboardCollapsed(doc, collapsed);
        toggle.textContent = collapsed ? 'DASHBOARD' : 'HIDE DASHBOARD';
        toggle.setAttribute('aria-expanded', String(!collapsed));
        fitDashboardMetricSpacing(doc);
      });
      doc.body.appendChild(toggle);
    }
    const collapsed = dashboard.classList.contains('gbs-dashboard-widgets-collapsed');
    setDashboardBoardMode(dashboard, board, boardLayout, collapsed);
    toggle.textContent = collapsed ? 'DASHBOARD' : 'HIDE DASHBOARD';
    toggle.title = collapsed ? 'Show Dashboard' : 'Hide Dashboard';
    toggle.setAttribute('aria-label', toggle.title);
    toggle.setAttribute('aria-expanded', String(!collapsed));
    // Do not reapply the saved width on every maintenance tick. That caused
    // a held divider to snap and also overwrote stable live layouts.
    if (board && previousWorkspaceState !== 'true') applySidebarRatio(board, true);
  }

  // Keep Agent Workspace in Genesys' native layout.  The only custom width
  // control here is the divider immediately left of “No active conversations”.
  function restoreNativeAgentWorkspaceLayout(doc) {
    const dashboardHost = doc.querySelector('.application-scroll.center-stage-frame-analyticsUi-internal');
    dashboardHost?.classList.remove('gbs-dashboard-collapsed');
    if (dashboardHost) {
      delete dashboardHost.dataset.gbsDashboardUserOpen;
      dashboardHost.querySelector(':scope > .gbs-dashboard-reopen')?.remove();
    }
    doc.querySelectorAll('aside.gbs-agent-panel-resizable').forEach(aside => {
      aside.classList.remove('gbs-agent-panel-resizable', 'gbs-agent-panel-fullscreen');
      aside.style.removeProperty('--gbs-agent-panel-width');
      aside.querySelector(':scope > .gbs-agent-panel-resizer')?.remove();
    });
  }

function fitDashboardMetricSpacing(doc) {
    const dashboard = doc.querySelector('.main-grid');
    if (!dashboard) return;
    // Divider movement must retain the settled line-height / row-gap geometry.
    // Resizing used to reset these variables to their smallest values on every
    // frame, which made every dashboard-card line jump upward until the pointer
    // paused and the next frame restored the calculated spacing.
    if (doc.body.classList.contains('gbs-resizing')) return;
    const grids = [...dashboard.querySelectorAll('.analytics-ui-dashboard-widget-grid-display .grid-container')];
    if (!grids.length) return;
    const readMetric = (name, fallback) => {
      const value = parseFloat(dashboard.style.getPropertyValue(name));
      return Number.isFinite(value) ? value : fallback;
    };
  const baseGap = 8;
  const baseInset = 8;
  if (dashboard.dataset.gbsMetricSpacingVersion !== '10') {
    dashboard.dataset.gbsMetricSpacingVersion = '10';
    dashboard.dataset.gbsMetricLayoutKey = '';
    }
    const gridShape = grids.map(grid => grid.children.length).join(',');
  const layoutKey = `v10:${dashboard.clientHeight}:${dashboard.scrollHeight}:${gridShape}:${dashboard.style.getPropertyValue('--gbs-metric-row-gap')}:${dashboard.style.getPropertyValue('--gbs-metric-inset')}`;
    if (dashboard.dataset.gbsMetricLayoutKey === layoutKey) return;

    // Measure the already-settled geometry.  Only reduce it if the completed
    // layout genuinely lacks height; never collapse-and-rebuild it as a probe.
    const currentGap = readMetric('--gbs-metric-row-gap', baseGap);
    const currentInset = readMetric('--gbs-metric-inset', baseInset);
    const visibleCards = [...dashboard.querySelectorAll(':scope > .widget-container')]
      .filter(card => card.querySelector('.analytics-ui-dashboard-widget-grid-display') && card.getBoundingClientRect().height > 0);
    const rows = new Map();
    visibleCards.forEach(card => {
      const top = Math.round(card.getBoundingClientRect().top);
      const cardGapSlots = Math.max(0, ...[...card.querySelectorAll('.grid-container')].map(grid =>
        getComputedStyle(grid).gridTemplateRows.trim().split(/\s+/).filter(Boolean).length - 1));
      rows.set(top, Math.max(rows.get(top) || 0, cardGapSlots));
    });
    const dashboardRect = dashboard.getBoundingClientRect();
    const bottomPadding = parseFloat(getComputedStyle(dashboard).paddingBottom || '0');
    const cardsBottom = Math.max(...visibleCards.map(card => card.getBoundingClientRect().bottom), dashboardRect.top);
    const freeHeight = dashboardRect.bottom - bottomPadding - cardsBottom;
    const rowGapSlots = [...rows.values()].reduce((total, slots) => total + slots, 0);
    const insetSlots = Math.max(1, rows.size * 4);
    // `freeHeight` reflects the spacing currently painted on screen.  Convert
    // it to the baseline-layout value before deciding the target.  Otherwise
    // a compact card looks as though it has spare room, gets expanded, then
    // immediately gets compacted again by ResizeObserver (a visible loop).
    const freeHeightAtBase = freeHeight
      - ((baseGap - currentGap) * rowGapSlots)
      - ((baseInset - currentInset) * insetSlots);
  // Always begin from the intended comfortable layout.  Previous versions
  // started from an already-compressed value, so a card could never expand
  // its row spacing again once it had briefly been height-constrained.
  let fittedGap = baseGap;
  let fittedInset = baseInset;
    if (freeHeightAtBase < -.5) {
      let deficit = -freeHeightAtBase;
      const gapReduction = rowGapSlots ? Math.min(fittedGap, deficit / rowGapSlots) : 0;
      fittedGap -= gapReduction;
      deficit -= gapReduction * rowGapSlots;
      // Preserve a small readable vertical inset before touching card content.
      fittedInset -= Math.min(Math.max(0, fittedInset - 2), deficit / insetSlots);
    }
    dashboard.style.setProperty('--gbs-metric-row-gap', `${fittedGap.toFixed(2)}px`);
    dashboard.style.setProperty('--gbs-metric-inset', `${fittedInset.toFixed(2)}px`);
    dashboard.dataset.gbsMetricLayoutKey = `v10:${dashboard.clientHeight}:${dashboard.scrollHeight}:${gridShape}:${dashboard.style.getPropertyValue('--gbs-metric-row-gap')}:${dashboard.style.getPropertyValue('--gbs-metric-inset')}`;
  }

  function ensureDashboardMetricSpacingResizeHandler(doc) {
    const dashboard = doc.querySelector('.main-grid');
    if (!dashboard || dashboard.__gbsMetricResizeHandler) return;
    const fitImmediately = () => {
      if (doc.body.classList.contains('gbs-resizing')) return;
      if (dashboard.__gbsMetricResizeTimer) doc.defaultView.clearTimeout(dashboard.__gbsMetricResizeTimer);
      dashboard.__gbsMetricResizeTimer = doc.defaultView.setTimeout(() => {
        dashboard.__gbsMetricResizeTimer = 0;
        if (!dashboard.isConnected || doc.body.classList.contains('gbs-resizing')) return;
        dashboard.dataset.gbsMetricLayoutKey = '';
        fitDashboardMetricSpacing(doc);
      }, 90);
    };
    doc.defaultView.addEventListener('resize', fitImmediately, { passive: true });
    if (doc.defaultView.ResizeObserver) {
      const observer = new doc.defaultView.ResizeObserver(() => fitImmediately());
      observer.observe(dashboard);
      dashboard.__gbsMetricResizeObserver = observer;
    }
    dashboard.__gbsMetricResizeHandler = true;
  }

  function ensureQueueLabelObserver(doc) {
    const grid = doc.querySelector('.main-grid');
    if (!grid || grid.__gbsQueueLabelObserver) return;
    const observer = new doc.defaultView.MutationObserver(mutations => {
      mutations.forEach(mutation => {
        const targetLink = mutation.target.nodeType === 1
          ? mutation.target.closest?.('.analytics-ui-dashboard-widget a')
          : mutation.target.parentElement?.closest?.('.analytics-ui-dashboard-widget a');
        if (targetLink) shortenDashboardQueueLink(targetLink);
        mutation.addedNodes.forEach(node => {
          if (node.nodeType !== 1) return;
          if (node.matches?.('.analytics-ui-dashboard-widget a')) shortenDashboardQueueLink(node);
          node.querySelectorAll?.('.analytics-ui-dashboard-widget a').forEach(shortenDashboardQueueLink);
        });
      });
    });
    observer.observe(grid, { childList: true, characterData: true, subtree: true });
    grid.__gbsQueueLabelObserver = observer;
  }

  function ensureTopAgentWorkspaceToggleHook(doc) {
    try { if (doc.defaultView !== doc.defaultView.top) return; } catch (_) { return; }
    const toggle = doc.querySelector('[data-test-id="command-bar-agent"], button[aria-label="Agent Workspace"]');
    if (!toggle || toggle.dataset.gbsWorkspaceToggleHook) return;
    toggle.dataset.gbsWorkspaceToggleHook = 'true';
    toggle.addEventListener('click', event => {
      closeSettings(doc);
      const wasOpen = workspaceVisibleInTopDocument(doc) || toggle.getAttribute('aria-expanded') === 'true';
      toggle.dataset.gbsWorkspaceWasOpen = wasOpen ? 'true' : 'false';
      if (wasOpen) return;
      const commandNav = nativeCommandNavForToggle(toggle);
      if (!commandNav) {
        startAgentWorkspaceOpenAnimation(doc, toggle);
        // Current Genesys no longer exposes its private Ember action manager.
        // Let it mount once, while our entrance scene hides that intermediate
        // state, then invoke its own compact/shrink action immediately.
        compactNativeAgentWorkspaceAfterMount(doc);
        return;
      }

      // The stock command-bar action calls selectPanel('agent', true), which
      // guarantees the first Workspace mount is expanded. Call the exact same
      // native service with false instead, before its action dispatcher runs.
      event.preventDefault();
      event.stopImmediatePropagation();
      toggle.dataset.gbsNativeCompactOpen = 'true';
      startAgentWorkspaceOpenAnimation(doc, toggle);
      commandNav.selectPanel('agent', false);

      let frames = 0;
      const synchronizeCompactMount = () => {
        frames += 1;
        ensureAgentWorkspaceResizer(doc);
        syncAnalyticsHostWidth(doc);
        if (workspaceVisibleInTopDocument(doc) || frames >= 30) {
          tick();
          return;
        }
        doc.defaultView.requestAnimationFrame(synchronizeCompactMount);
      };
      doc.defaultView.requestAnimationFrame(synchronizeCompactMount);
    }, true);
    toggle.addEventListener('click', () => {
      const opening = toggle.dataset.gbsWorkspaceWasOpen !== 'true';
      if (opening) startAgentWorkspaceOpenAnimation(doc, toggle);
      else beginAgentWorkspaceTransition(doc);
      let frames = 0;
      const syncAtNativeState = () => {
        frames += 1;
        if (opening) {
          ensureAgentWorkspaceResizer(doc);
          syncAnalyticsHostWidth(doc);
        }
        const visible = workspaceVisibleInTopDocument(doc);
        if (visible === opening || frames >= 30) {
          // Apply once, at the actual Genesys state change. Fixed-delay passes
          // were responsible for the competing intermediate size.
          if (opening && visible) {
            // The native compact preference is applied before this mount, so
            // only synchronize the custom layout after it becomes visible.
          }
          tick();
          return;
        }
        doc.defaultView.requestAnimationFrame(syncAtNativeState);
      };
      doc.defaultView.requestAnimationFrame(() => {
        if (opening) {
          // Set the single final target as soon as Genesys mounts the panel;
          // the later state synchronization now confirms rather than retargets.
          ensureAgentWorkspaceResizer(doc);
          syncAnalyticsHostWidth(doc);
        }
        syncAtNativeState();
      });
    });
  }

  function renameInCallLabels(root) {
    // Keep Genesys' internal state keys unchanged; rename presentation only.
    root.querySelectorAll('.column-status, .gbs-summary-title, .gbs-status-setting-label, .label-value, .status-label, .presence-label, [role="option"], [role="menuitem"]').forEach(element => {
      const nodes = [element, ...element.querySelectorAll('*')];
      nodes.forEach(node => [...node.childNodes].forEach(child => {
        if (child.nodeType === 3 && child.textContent.trim().toLowerCase() === 'interacting') child.textContent = child.textContent.replace(/interacting/i, 'In Call');
      }));
    });
    root.querySelectorAll('[title="Interacting"], [aria-label="Interacting"]').forEach(element => {
      if (element.getAttribute('title') === 'Interacting') element.setAttribute('title', 'In Call');
      if (element.getAttribute('aria-label') === 'Interacting') element.setAttribute('aria-label', 'In Call');
    });
  }

  function sortDocument(doc) {
    applyPowerMode(doc);
    syncCallTestLayout(doc);
    injectStyles(doc);
    applyBoardSettings(doc);
    renameInCallLabels(doc);
    const settingsWorkspaceVisible = workspaceVisibleInTopDocument(doc);
    if (settingsWorkspaceVisible && !doc.__gbsSettingsWorkspaceVisible) closeSettings(doc);
    doc.__gbsSettingsWorkspaceVisible = settingsWorkspaceVisible;
    if (!doc.documentElement.dataset.gbsResizeSkeletonsRemoved) {
      doc.querySelectorAll('.gbs-layout-skeleton').forEach(node => node.remove());
      doc.body?.classList.remove('gbs-layout-glass-active', 'gbs-layout-glass-leaving');
      doc.documentElement.dataset.gbsResizeSkeletonsRemoved = 'true';
    }
    ensureComponentLoadMonitor(doc);
    rememberCurrentAgentName(doc);
    applyThemeMode(doc);
    installAvatarShadowStyleHook(doc);
    publishTopProfileStatus(doc);
    syncInteractionAppTheme(doc);
    ensureTopAgentWorkspaceToggleHook(doc);
    ensureAgentWorkspaceCompactMonitor(doc);
    ensureThemeToggle(doc);
    ensureCallDeveloperToggle(doc);
    markCompactActionWrappers(doc);
    syncQueueVisualState(doc);
    ensureQueueVisualStateHook(doc);
    syncHoverCardToggleVisuals(doc);
    ensureInteractionQueueResizer(doc);
    ensureSelectedInteractionResizer(doc);
    syncCallInformationPopup(doc);
    closeWorkspaceAfterCallEnds(doc);
    ensureAgentWorkspaceResizer(doc);
    syncAnalyticsHostWidth(doc);
    restoreNativeAgentWorkspaceLayout(doc);
    syncDashboardWidgetsForWorkspace(doc);
    ensureTabUnderlines(doc);
    fitAnalyticsFrameToViewport(doc);
    if (Date.now() < themeTransitionUntil) return;
    shortenDashboardQueueLabels(doc);
    suppressQueueActionTooltips(doc);
    ensureQueueLabelObserver(doc);
    updateSlaBadges(doc);
    fitDashboardToViewport(doc);
    ensureSidebarEnhancements(doc);
    ensureDashboardMetricSpacingResizeHandler(doc);
    fitDashboardMetricSpacing(doc);
    // Presence updates are emitted as DOM mutations by Genesys.  React on the
    // next paint instead of making the user wait for the 1-second maintenance
    // cycle that keeps the rest of the dashboard inexpensive.
    ensureImmediateBoardStatusRefresh(doc);
    // Once marked, only revisit the one board that needs the once-per-second update.
    const markedBoards = doc.querySelectorAll('table.gbs-board');
    if (markedBoards.length) {
      markedBoards.forEach(sortBoard);
    } else {
      doc.querySelectorAll('table').forEach(table => {
        if (isAgentBoard(table)) sortBoard(table);
      });
    }
    syncHoverCardStatusColors(doc);
    finishReadyComponentLoads(doc);
  }

  function registerEmbeddedDocument(frame, seenDocuments = MANAGED_DOCUMENTS) {
    if (!frame) return;
    const activateLoadedDocument = () => {
      try {
        const frameDocument = accessibleFrameDocument(frame);
        if (!frameDocument || seenDocuments.has(frameDocument)) return;
        // Avoid doing work against the short-lived blank document created
        // before Homepage's real route arrives.
        if (frameDocument.location?.href === 'about:blank') return;
        seenDocuments.add(frameDocument);
        // Run only after the iframe's own first paint. This prevents the
        // board enhancements from competing with Homepage's native load.
        frameDocument.defaultView.requestAnimationFrame(() => {
          try {
            injectStyles(frameDocument);
            sortDocument(frameDocument);
            injectShadowStyles(frameDocument);
            sortReachableEmbeddedDocuments(frameDocument, seenDocuments);
          } catch (_) { /* contextual frame may have navigated again */ }
        });
      } catch (_) { /* cross-origin contextual application */ }
    };
    if (!EMBEDDED_FRAME_LOAD_HOOKS.has(frame)) {
      EMBEDDED_FRAME_LOAD_HOOKS.add(frame);
      frame.addEventListener('load', activateLoadedDocument);
    }
    try {
      if (accessibleFrameDocument(frame)?.readyState === 'complete') activateLoadedDocument();
    } catch (_) { /* cross-origin contextual application */ }
  }

  function sortReachableEmbeddedDocuments(root, seenDocuments = MANAGED_DOCUMENTS) {
    if (!root?.querySelectorAll) return;
    root.querySelectorAll('.app-view-stack-container, .app-carousel-toolbar-container, .app-carousel-view-container, gux-card').forEach(host => {
      if (host.shadowRoot) {
        injectShadowStyles(host.ownerDocument, host);
        sortReachableEmbeddedDocuments(host.shadowRoot, seenDocuments);
      }
    });
    const candidates = root.querySelectorAll('iframe, gux-form-field-search, gux-form-field-text-like, gux-avatar-beta, gux-tabs, gux-tab-list, gux-button-slot, gux-button, gux-list, gux-listbox, gux-dropdown, gux-popover, gux-popover-list, gux-popover-list-beta, gux-cta-group, gux-toggle, gux-switch-legacy, gux-accordion, gux-calendar, gux-time-picker, gux-pagination, gux-table, gux-sort-control, gux-tooltip, gux-modal, gux-dismiss-button, app-view-stack, app-carousel-toolbar, app-carousel-view');
    candidates.forEach(element => {
      if (element.shadowRoot) {
        injectShadowStyles(element.ownerDocument, element);
        sortReachableEmbeddedDocuments(element.shadowRoot, seenDocuments);
      }
      if (element.tagName === 'IFRAME') registerEmbeddedDocument(element, seenDocuments);
    });
  }

  function refreshEmbeddedFrameRegistrations(root = document) {
    // New Analytics routers can reuse an already-observed frame host after
    // the initial mutation/idle pass. Checking only iframe nodes is tiny
    // compared with a Shadow-DOM walk and guarantees the replacement document
    // receives the V2 stylesheet and Board enhancements.
    root.querySelectorAll?.('iframe').forEach(frame => {
      registerEmbeddedDocument(frame);
      try {
        const frameDocument = accessibleFrameDocument(frame);
        const href = frameDocument?.location?.href || '';
        if (!frameDocument || frameDocument.readyState !== 'complete' || !/\/analytics-ui\//i.test(href)) return;
        // A frame-router can complete a document replacement between the load
        // event and its deferred callback. Install the static style immediately
        // here as well, so the rendered Analytics page never remains native
        // styled merely because that callback belonged to the prior document.
        injectStyles(frameDocument);
        if (!MANAGED_DOCUMENTS.has(frameDocument)) {
          MANAGED_DOCUMENTS.add(frameDocument);
          sortDocument(frameDocument);
          injectShadowStyles(frameDocument);
        }
      } catch (_) { /* inaccessible contextual application */ }
    });
  }

  function collectReachableDocuments(root = document, reachable = new Set()) {
    if (!root || reachable.has(root)) return reachable;
    reachable.add(root);
    root.querySelectorAll?.('iframe').forEach(frame => {
      try {
        const frameDocument = accessibleFrameDocument(frame);
        // Do not retain the transient blank document which precedes a router
        // replacement; it is the main source of stale-frame retention.
        if (frameDocument && frameDocument.location?.href !== 'about:blank') {
          collectReachableDocuments(frameDocument, reachable);
        }
      } catch (_) { /* cross-origin frame */ }
    });
    return reachable;
  }

  function scheduleDeferredDeepDiscovery() {
    if (window.__gbsDeepDiscoveryScheduled) return;
    window.__gbsDeepDiscoveryScheduled = true;
    const discover = () => {
      window.__gbsDeepDiscoveryScheduled = false;
      // Deep Shadow DOM discovery is needed for late custom components, but
      // does not need to compete with Genesys' first application render.
      sortReachableEmbeddedDocuments(document);
      refreshShadowThemes();
    };
    const scheduleIdle = () => {
      if (typeof window.requestIdleCallback === 'function') {
        window.requestIdleCallback(discover, { timeout: 2500 });
      } else {
        window.setTimeout(discover, 200);
      }
    };
    window.setTimeout(scheduleIdle, 900);
  }

  function tick() {
    MANAGED_DOCUMENTS.add(document);
    refreshEmbeddedFrameRegistrations(document);
    const reachable = collectReachableDocuments(document);
    [...MANAGED_DOCUMENTS].forEach(doc => {
      try {
        // A replaced iframe's old Window continues to point at its old
        // Document, so `doc.defaultView.document === doc` alone cannot prove
        // that it is still reachable from the current application. Prune by
        // the live iframe tree to release it and all its observers promptly.
        if (!reachable.has(doc)) {
          MANAGED_DOCUMENTS.delete(doc);
          return;
        }
        if (doc.defaultView?.document === doc) sortDocument(doc);
        else MANAGED_DOCUMENTS.delete(doc);
      } catch (_) { MANAGED_DOCUMENTS.delete(doc); }
    });
  }

  // OFF runs only the independent settings launcher. No loader, logo rewrite,
  // sorting, iframe work, styling, native recovery, or layout hooks are started.
  if (themeMode(document) === 'light') {
    const mountSettings = () => {
      if (!document.head || !document.body) return;
      ensureThemeToggle(document);
    };
    const settingsObserver = new MutationObserver(mountSettings);
    settingsObserver.observe(document.documentElement, { childList: true, subtree: true });
    mountSettings();
    rememberCurrentAgentName(document);
    const offIdentityTimer = window.setInterval(() => rememberCurrentAgentName(document), 5000);
    window.addEventListener('pagehide', () => window.clearInterval(offIdentityTimer), { once: true });
    return;
  }

  // Silent polling every ten seconds in the enabled top-level page.
  // Iframes never check, and OFF never schedules a background request.
  scheduleGenesysUpdateCheck();

  // Login uses the same injected stylesheet but none of the authenticated
  // application's observers, iframes, or one-second dashboard maintenance.
  if (location.hostname === 'login.mypurecloud.de') {
    applyPowerMode(document);
    injectStyles(document);
    installLoginSpaceScene(document);
    installLoginBrandLayout(document);
    installLoginOrganizationLayout(document);
    return;
  }

  // Install the static avatar-shadow CSS hook before the first application
  // render pass; opening the profile never needs a per-popup style mutation.
  installAvatarShadowStyleHook(document);
  resetLayoutPreferencesOnce(document);
  MANAGED_DOCUMENTS.add(document);
  tick();
  // The app becomes usable before its optional nested web components are
  // present. Delay their expensive full-tree Shadow DOM scan until idle.
  scheduleDeferredDeepDiscovery();
  const shadowObserver = new MutationObserver(mutations => {
    mutations.forEach(mutation => mutation.addedNodes.forEach(node => {
      if (node.nodeType !== 1) return;
      // Avoid a full descendant scan for ordinary Ember text/layout churn.
      // Only scan an added subtree when it can contain a Shadow host or iframe.
      const mayContainCustomUi = node.shadowRoot || node.tagName.includes('-') ||
        node.querySelector?.('iframe, gux-popover, gux-button, gux-avatar-beta, gux-tabs, gux-dropdown, gux-modal');
      if (mayContainCustomUi) injectShadowStyles(document, node);
      if (node.matches?.('iframe')) registerEmbeddedDocument(node);
      node.querySelectorAll?.('iframe').forEach(frame => registerEmbeddedDocument(frame));
    }));
    if (!document.querySelector('.gbs-theme-toggle')) ensureThemeToggle(document);
  });
  shadowObserver.observe(document.documentElement, { childList: true, subtree: true });
  let lastMaintenanceAt = 0;
  const timer = window.setInterval(() => {
    applyPowerMode(document);
    const interval = document.hidden ? 10000 : lowPowerMode() ? 2000 : INTERVAL_MS;
    if (Date.now() - lastMaintenanceAt < interval) return;
    lastMaintenanceAt = Date.now(); tick();
  }, INTERVAL_MS);
  const identityTimer = window.setInterval(() => rememberCurrentAgentName(document), 5000);
  document.addEventListener('click', recordIncomingCallAction, true);
  const incomingCallTimer = window.setInterval(() => watchIncomingCall(document), 1000);
  watchIncomingCall(document);
  // A low-frequency safety sweep covers late-attached closed app widgets
  // without imposing the old every-second full-tree traversal.
  let lastShadowSweepAt = 0;
  const shadowTimer = window.setInterval(() => {
    if (document.hidden || (lowPowerMode() && Date.now() - lastShadowSweepAt < 90000)) return;
    lastShadowSweepAt = Date.now();
    refreshShadowThemes();
    sortReachableEmbeddedDocuments(document);
  }, 30000);
  window.__genesysBoardSorterStop = () => {
    window.clearInterval(updateCheckTimer); updateCheckTimer = 0;
    window.clearInterval(timer);
    window.clearInterval(identityTimer);
    window.clearInterval(incomingCallTimer);
    document.removeEventListener('click', recordIncomingCallAction, true);
    document.getElementById('gbs-incoming-call-notice')?.remove();
    window.clearInterval(shadowTimer);
    shadowObserver.disconnect();
    delete window[INSTANCE_KEY];
  };
})();
