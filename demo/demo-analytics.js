/*
 * Shared analytics for every live demo page (demo/<name>/index.html).
 * Load it in <head> of each demo, BEFORE the demo's own scripts:
 *   <script src="../demo-analytics.js"></script>
 *
 * - Google Analytics (same property as the main site), consent mode: analytics
 *   only after the visitor agrees (same localStorage key as the main site's
 *   cookie banner, so a visitor who already chose on the site is not asked again).
 * - gtag.js loads lazily on first interaction, like the main site.
 * - WhatsApp / phone clicks are sent as generate_lead (same as the main site).
 * - window.demoTrack(demo, stepNumber, stepName) sends a demo_step event;
 *   window.demoTrack(demo, 'complete') sends demo_complete.
 */
(function () {
  'use strict';
  var GA_ID = 'G-KERKL716HL';
  var KEY = 'al_cookie_consent', KEY_TS = 'al_cookie_consent_date';
  function getConsent() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }

  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function () { dataLayer.push(arguments); };
  gtag('consent', 'default', { analytics_storage: getConsent() === 'granted' ? 'granted' : 'denied', ad_storage: 'denied' });
  gtag('js', new Date());
  gtag('config', GA_ID);

  // lazy-load gtag.js on first interaction (or after 10s), like the main site
  var loaded = false, evs = ['scroll', 'pointerdown', 'keydown', 'touchstart', 'mousemove'];
  function load() {
    if (loaded) return; loaded = true;
    evs.forEach(function (e) { removeEventListener(e, load, true); });
    var s = document.createElement('script'); s.async = true; s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_ID; document.head.appendChild(s);
  }
  evs.forEach(function (e) { addEventListener(e, load, { capture: true, passive: true, once: true }); });
  addEventListener('load', function () { setTimeout(load, 10000); });

  // demo progress events
  var sent = {};
  window.demoTrack = function (demo, step, name) {
    try {
      if (step === 'complete') { if (sent[demo + ':c']) return; sent[demo + ':c'] = 1; gtag('event', 'demo_complete', { demo_name: demo, page_path: location.pathname }); return; }
      var k = demo + ':' + step; if (sent[k]) return; sent[k] = 1;
      gtag('event', 'demo_step', { demo_name: demo, step_number: step, step_name: String(name || '').slice(0, 80), page_path: location.pathname });
    } catch (e) {}
  };

  // WhatsApp / phone clicks = lead (same event as the main site)
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href]'); if (!a) return;
    var href = a.getAttribute('href') || '', method = null;
    if (/^https:\/\/(wa\.me|api\.whatsapp\.com)\//i.test(href)) method = 'whatsapp';
    else if (/^tel:/i.test(href)) method = 'phone';
    if (method) try { gtag('event', 'generate_lead', { method: method, page_path: location.pathname, link_text: (a.textContent || '').trim().slice(0, 60) }); } catch (err) {}
  }, true);

  // compact consent banner (top of the screen, so it never covers a demo's guide panel)
  function save(granted) {
    try { localStorage.setItem(KEY, granted ? 'granted' : 'denied'); localStorage.setItem(KEY_TS, new Date().toISOString()); } catch (e) {}
    gtag('consent', 'update', { analytics_storage: granted ? 'granted' : 'denied' });
  }
  function banner() {
    if (getConsent()) return;
    var css = document.createElement('style');
    css.textContent = '#alCookie{position:fixed;top:10px;left:50%;transform:translateX(-50%);z-index:2147483600;width:min(560px,calc(100vw - 20px));background:#1b1a2e;color:#e9e7f2;border:1px solid rgba(221,176,95,.45);border-radius:14px;box-shadow:0 14px 40px rgba(0,0,0,.35);padding:12px 14px;display:flex;gap:12px;align-items:center;flex-wrap:wrap;direction:rtl;font:13px/1.5 Heebo,Assistant,system-ui,sans-serif}' +
      '#alCookie p{margin:0;flex:1;min-width:200px}#alCookie a{color:#DDB05F}#alCookie .b{display:flex;gap:8px}' +
      '#alCookie button{border-radius:9px;padding:7px 12px;font:inherit;font-weight:700;cursor:pointer;border:1px solid rgba(233,231,242,.3);background:transparent;color:#e9e7f2}' +
      '#alCookie button.y{background:linear-gradient(135deg,#DDB05F,#9C7530);border-color:transparent;color:#141b2d}';
    document.head.appendChild(css);
    var d = document.createElement('div'); d.id = 'alCookie'; d.setAttribute('role', 'dialog'); d.setAttribute('aria-label', 'הסכמה לעוגיות');
    d.innerHTML = '<p>אנחנו משתמשים בעוגיות אנליטיות כדי להבין איך משתמשים בהדגמה ולשפר אותה. <a href="/privacy.html" target="_blank" rel="noopener">מדיניות פרטיות</a></p><div class="b"><button type="button" class="n">רק הכרחיות</button><button type="button" class="y">קבלת הכל</button></div>';
    d.querySelector('.n').onclick = function () { save(false); d.remove(); };
    d.querySelector('.y').onclick = function () { save(true); d.remove(); };
    document.body.appendChild(d);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', banner); else banner();
})();
