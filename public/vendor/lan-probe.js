// ============================================================================
// chunked-upload-kit — lan-probe (在家高速上傳: 在家就走家裡網路)
// ----------------------------------------------------------------------------
// A home-hosted service reached through a tunnel (Cloudflare etc.) is slow to upload to *from home*:
// the bytes go out to the edge and come back (measured 2.4 MB/s vs 21.7 MB/s on the LAN).
// If the server also answers on a "LAN host" (a public name that resolves to the home IP, with a real
// certificate — e.g. CloudPipe's lan-gateway), the page can send upload bytes there when it's reachable.
//
//   const base = await LanProbe.probeLan(LanProbe.lanBaseFor(location.hostname, { sub: 'lan' }))
//   const url = (base || '') + '/upload/chunk'      // base = 'https://app.lan.example.com' or null
//
// probeLan GETs `${lanBase}/__lan/ping` (the gateway answers it, with CORS + Private-Network headers).
// Reachable → returns lanBase; otherwise null. The answer is cached in sessionStorage for 5 minutes.
// Call it when an upload starts, not on page load: Chrome asks the user once before a public page may
// reach the home network, and that question should come when it means something.
//
// Plain script on purpose (no import/export): works as <script src>, require(), or an ESM side-effect
// import (client/index.mjs re-exports it). Zero dependencies.
// ============================================================================
(function (root) {
  'use strict';

  /** `app.example.com` → `https://app.lan.example.com`; null for localhost / IPs / two-label hosts. */
  function lanBaseFor(hostname, opts) {
    var sub = (opts && opts.sub) || 'lan';
    var h = String(hostname || '').toLowerCase();
    if (!h || h === 'localhost' || /^[\d.]+$/.test(h) || h.indexOf(':') >= 0) return null;
    var parts = h.split('.');
    if (parts.length < 3 || parts[1] === sub) return null;   // need <app>.<zone>; already a LAN host → no
    return 'https://' + parts[0] + '.' + sub + '.' + parts.slice(1).join('.');
  }

  function cacheGet(storage, key, now) {
    try {
      var v = JSON.parse(storage.getItem(key) || 'null');
      return v && v.until > now ? v : null;
    } catch (e) { return null; }
  }
  function cacheSet(storage, key, ok, now, cacheMs) {
    try { storage.setItem(key, JSON.stringify({ ok: ok, until: now + cacheMs })); } catch (e) { /* private mode */ }
  }

  var PROMPT_BUDGET_MS = 20000;

  /** How long to wait: Chrome's "allow local network?" question needs time for a human to answer. */
  function waitBudget(defaultMs) {
    var perms = root.navigator && root.navigator.permissions;
    if (!perms || !perms.query) return Promise.resolve(defaultMs);
    return perms.query({ name: 'local-network-access' }).then(function (s) {
      if (s.state === 'denied') return 0;
      if (s.state === 'prompt') return PROMPT_BUDGET_MS;
      return defaultMs;
    }, function () { return defaultMs; });   // browser doesn't know that permission → normal budget
  }

  /**
   * @param {string|null} lanBase  e.g. 'https://app.lan.example.com' (null → resolves null right away)
   * @param {{timeoutMs?:number, cacheMs?:number, fetch?:Function, storage?:Storage, now?:Function}} [opts]
   * @returns {Promise<string|null>} lanBase when reachable, else null. Never throws.
   */
  function probeLan(lanBase, opts) {
    opts = opts || {};
    if (!lanBase) return Promise.resolve(null);
    var f = opts.fetch || (root.fetch && root.fetch.bind(root));
    if (!f) return Promise.resolve(null);
    var storage = opts.storage !== undefined ? opts.storage : (root.sessionStorage || null);
    var now = (opts.now || Date.now)();
    var cacheMs = opts.cacheMs != null ? opts.cacheMs : 5 * 60 * 1000;
    var key = 'lan-probe:' + lanBase;
    var hit = storage ? cacheGet(storage, key, now) : null;
    if (hit) return Promise.resolve(hit.ok ? lanBase : null);
    return waitBudget(opts.timeoutMs != null ? opts.timeoutMs : 1500).then(function (budget) {
      if (!budget) return null;
      var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, budget);
      return f(lanBase.replace(/\/$/, '') + '/__lan/ping', { cache: 'no-store', signal: ctrl ? ctrl.signal : undefined })
        .then(function (r) { return r && r.ok; }, function () { return false; })
        .then(function (ok) {
          clearTimeout(timer);
          // a "no" while Chrome's question was still on screen isn't an answer — ask again next upload
          if (storage && (ok || budget !== PROMPT_BUDGET_MS)) cacheSet(storage, key, ok, (opts.now || Date.now)(), cacheMs);
          return ok ? lanBase : null;
        });
    });
  }

  var api = { probeLan: probeLan, lanBaseFor: lanBaseFor };
  root.LanProbe = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
