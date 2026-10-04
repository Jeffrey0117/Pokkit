/**
 * onboarding-kit — vanilla build (zero-dep, no React/Tailwind).
 *
 * Same "spotlight + card + next" tour as DemoOverlay.tsx, for plain-JS apps
 * (pokkit, quickky, wemeet...). One file, drop it in, call OnboardTour.start().
 *
 *   OnboardTour.start(steps, opts)
 *     steps: [{ sel?, title, body }]        — sel omitted = centered card
 *     opts : {
 *       labels:     { next, prev, skip, done }   — i18n injection (defaults EN)
 *       onComplete: fn    — fired ONLY when the user reaches the last step and
 *                           clicks done (skipping is NOT completion — same
 *                           milestone semantics as the React build)
 *       onClose:    fn    — fired on any dismiss (skip or done)
 *       accent:     css color for the primary button (default #18181b)
 *     }
 *
 * Behaviors ported from the React build: spotlight via giant box-shadow,
 * position follows the target on scroll/resize (rAF-throttled), user scroll is
 * locked during the tour (programmatic scrollIntoView still works), steps whose
 * target is missing or invisible are skipped automatically, small screens get
 * a bottom-sheet card instead of side placement.
 */
(function () {
  'use strict';

  var active = null; // { steps, i, els, opts, raf }

  function visible(el) {
    return !!(el && el.offsetParent !== null);
  }

  function resolveStep(steps, from, dir) {
    // Skip steps whose target doesn't exist / isn't visible (mobile hides the
    // sidebar, feature flags hide buttons...). Centered steps always qualify.
    var i = from;
    while (i >= 0 && i < steps.length) {
      var s = steps[i];
      if (!s.sel || visible(document.querySelector(s.sel))) return i;
      i += dir;
    }
    return -1;
  }

  function lockScroll(lock) {
    document.documentElement.style.overflow = lock ? 'hidden' : '';
    document.body.style.overflow = lock ? 'hidden' : '';
  }

  function build(opts) {
    var backdrop = document.createElement('div');
    backdrop.className = 'obk-backdrop';
    var spot = document.createElement('div');
    spot.className = 'obk-spot';
    var card = document.createElement('div');
    card.className = 'obk-card';
    card.setAttribute('role', 'dialog');
    card.innerHTML =
      '<div class="obk-title"></div>' +
      '<div class="obk-body"></div>' +
      '<div class="obk-foot">' +
      '  <span class="obk-progress"></span>' +
      '  <span class="obk-btns">' +
      '    <button type="button" class="obk-btn obk-skip"></button>' +
      '    <button type="button" class="obk-btn obk-prev"></button>' +
      '    <button type="button" class="obk-btn obk-next obk-primary"></button>' +
      '  </span>' +
      '</div>';
    document.body.appendChild(backdrop);
    document.body.appendChild(spot);
    document.body.appendChild(card);
    if (opts.accent) card.querySelector('.obk-next').style.background = opts.accent;
    return { backdrop: backdrop, spot: spot, card: card };
  }

  function injectCss() {
    if (document.getElementById('obk-css')) return;
    var css = [
      '.obk-backdrop{position:fixed;inset:0;z-index:9998;}',
      // The spotlight IS the dimmer: a transparent window with a huge shadow.
      '.obk-spot{position:fixed;z-index:9999;border-radius:12px;pointer-events:none;',
      ' box-shadow:0 0 0 9999px rgba(0,0,0,.62);transition:all .25s ease;}',
      '.obk-spot.obk-center{box-shadow:0 0 0 9999px rgba(0,0,0,.62);width:0;height:0;border-radius:0;}',
      '.obk-card{position:fixed;z-index:10000;width:300px;max-width:calc(100vw - 32px);',
      ' background:#fff;color:#1e293b;border-radius:14px;padding:16px 16px 12px;',
      ' box-shadow:0 12px 40px rgba(0,0,0,.35);font:14px/1.6 system-ui,sans-serif;transition:all .25s ease;}',
      '@media (prefers-color-scheme: dark){.obk-card{background:#1c1c1f;color:#e4e4e7;}}',
      '[data-theme="dark"] .obk-card{background:#1c1c1f;color:#e4e4e7;}',
      '.obk-title{font-weight:700;font-size:15px;margin-bottom:6px;}',
      '.obk-body{opacity:.85;margin-bottom:12px;}',
      '.obk-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;}',
      '.obk-progress{font-size:12px;opacity:.55;}',
      '.obk-btns{display:flex;gap:6px;}',
      '.obk-btn{border:1px solid rgba(128,128,128,.35);background:transparent;color:inherit;',
      ' border-radius:8px;padding:5px 12px;font-size:13px;cursor:pointer;}',
      '.obk-btn[hidden]{display:none;}',
      '.obk-primary{background:#18181b;border-color:transparent;color:#fff;}',
      '@media (max-width:560px){.obk-card{left:16px!important;right:16px;width:auto;bottom:18px!important;top:auto!important;}}',
    ].join('\n');
    var el = document.createElement('style');
    el.id = 'obk-css';
    el.textContent = css;
    document.head.appendChild(el);
  }

  function place() {
    if (!active) return;
    var step = active.steps[active.i];
    var spot = active.els.spot;
    var card = active.els.card;
    var target = step.sel ? document.querySelector(step.sel) : null;

    if (!target || !visible(target)) {
      // Centered card, full dim
      spot.className = 'obk-spot obk-center';
      spot.style.left = '50vw';
      spot.style.top = '40vh';
      card.style.left = 'calc(50vw - 150px)';
      card.style.top = 'calc(40vh + 20px)';
      return;
    }
    spot.className = 'obk-spot';
    var r = target.getBoundingClientRect();
    var pad = 6;
    spot.style.left = (r.left - pad) + 'px';
    spot.style.top = (r.top - pad) + 'px';
    spot.style.width = (r.width + pad * 2) + 'px';
    spot.style.height = (r.height + pad * 2) + 'px';

    // Card beside the target: below if room, else above; clamp into viewport
    var cw = 300, ch = card.offsetHeight || 150, gap = 12;
    var left = Math.min(Math.max(r.left, 16), window.innerWidth - cw - 16);
    var top = r.bottom + gap;
    if (top + ch > window.innerHeight - 16) top = Math.max(16, r.top - ch - gap);
    card.style.left = left + 'px';
    card.style.top = top + 'px';
  }

  function render() {
    var step = active.steps[active.i];
    var els = active.els;
    var labels = active.opts.labels || {};
    els.card.querySelector('.obk-title').textContent = step.title || '';
    els.card.querySelector('.obk-body').textContent = step.body || '';
    els.card.querySelector('.obk-progress').textContent = (active.i + 1) + ' / ' + active.steps.length;
    var isLast = resolveStep(active.steps, active.i + 1, 1) === -1;
    var isFirst = resolveStep(active.steps, active.i - 1, -1) === -1;
    els.card.querySelector('.obk-next').textContent = isLast ? (labels.done || 'Done') : (labels.next || 'Next');
    var prevBtn = els.card.querySelector('.obk-prev');
    prevBtn.textContent = labels.prev || 'Back';
    prevBtn.hidden = isFirst;
    var skipBtn = els.card.querySelector('.obk-skip');
    skipBtn.textContent = labels.skip || 'Skip';
    skipBtn.hidden = isLast;

    var target = step.sel ? document.querySelector(step.sel) : null;
    if (target && visible(target)) {
      try { target.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (_) { /* old browsers */ }
    }
    place();
    // Re-place once layout/scroll settles (smooth scroll takes a beat)
    setTimeout(place, 300);
  }

  function stop(completed) {
    if (!active) return;
    var a = active;
    active = null;
    cancelAnimationFrame(a.raf);
    lockScroll(false);
    a.els.backdrop.remove();
    a.els.spot.remove();
    a.els.card.remove();
    window.removeEventListener('resize', place);
    if (completed && a.opts.onComplete) { try { a.opts.onComplete(); } catch (_) {} }
    if (a.opts.onClose) { try { a.opts.onClose(completed === true); } catch (_) {} }
  }

  function tick() {
    if (!active) return;
    place(); // follow the target through animations/layout shifts
    active.raf = requestAnimationFrame(tick);
  }

  function start(steps, opts) {
    if (active) stop(false);
    opts = opts || {};
    var first = resolveStep(steps, 0, 1);
    if (first === -1) return; // nothing visible to show
    injectCss();
    var els = build(opts);
    active = { steps: steps, i: first, els: els, opts: opts, raf: 0 };
    lockScroll(true);

    els.card.querySelector('.obk-next').addEventListener('click', function () {
      var next = resolveStep(active.steps, active.i + 1, 1);
      if (next === -1) { stop(true); return; } // last step → milestone
      active.i = next;
      render();
    });
    els.card.querySelector('.obk-prev').addEventListener('click', function () {
      var prev = resolveStep(active.steps, active.i - 1, -1);
      if (prev !== -1) { active.i = prev; render(); }
    });
    els.card.querySelector('.obk-skip').addEventListener('click', function () { stop(false); });

    render();
    active.raf = requestAnimationFrame(tick);
  }

  window.OnboardTour = { start: start, stop: function () { stop(false); } };
})();
