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
 * - A.L Systems logo badge fixed top-left (links to the site).
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
  // A.L Systems brand badge, fixed top-left on every demo (user request 2026-11-06).
  // Layout offsets keep it off each demo's own controls; a new demo may need its own line here.
  function brand() {
    var css = document.createElement('style');
    css.textContent = '#alBrand{position:fixed;top:10px;left:10px;z-index:3150;display:flex;align-items:center;gap:8px;background:rgba(255,255,255,.96);border:1px solid rgba(201,166,92,.55);border-radius:12px;padding:5px 12px 5px 8px;box-shadow:0 6px 18px rgba(0,0,0,.18);text-decoration:none;direction:ltr;font-family:Heebo,Assistant,system-ui,sans-serif;line-height:1.1}' +
      '#alBrand img{width:30px;height:27px;object-fit:contain}#alBrand b{display:block;color:#1a1a1a;font-size:13.5px;letter-spacing:.2px}#alBrand small{display:block;color:#8a6a2c;font-size:10.5px;direction:rtl;text-align:left}' +
      'body.al-brand .stage{padding-top:64px}' +                      /* StopZkor */
      'body.al-brand .topbar{padding-left:176px}' +                   /* ShiftSync / FileManager top bars */
      'body.al-brand .mtop{padding-left:176px}' +                     /* Callio mobile nav */
      '@media (min-width:901px){body.al-brand #tour{top:64px!important;max-height:calc(100vh - 80px)!important}}' + /* Callio / FileManager side guide */
      '@media (max-width:600px){#alBrand{top:6px;left:6px;padding:4px 9px 4px 6px}#alBrand img{width:24px;height:22px}#alBrand b{font-size:12px}#alBrand small{display:none}body.al-brand .topbar,body.al-brand .mtop{padding-left:128px}}';
    document.head.appendChild(css);
    var a = document.createElement('a'); a.id = 'alBrand'; a.href = 'https://al-systems.co.il/'; a.target = '_blank'; a.rel = 'noopener'; a.setAttribute('aria-label', 'A.L Systems - לאתר');
    a.innerHTML = '<img src="/assets/logo-mark-transparent.png" alt=""><span><b>A.L Systems</b><small>מערכות AI לעסקים</small></span>';
    document.body.appendChild(a); document.body.classList.add('al-brand');
  }
  // "Leave your details" form on the final screen of every demo. Optional: it never
  // blocks anything, and the WhatsApp / call buttons stay. It is added to the end of
  // the demo's guide panel (#tour / #demoTour) once demoTrack(demo,'complete') fires,
  // and re-attached if the guide re-renders. Leads land in the site's Supabase
  // (dashboard.html -> ניהול לידים) and in the owner's email.
  var LEAD_URL = 'https://iwixjlfbifsbxtyppvqb.supabase.co/functions/v1/al-contact-form';
  var leadBox = null;
  function leadForm(demo) {
    if (leadBox) return;
    var css = document.createElement('style');
    css.textContent = '#alLead{position:relative;margin:12px 14px 14px;padding:14px;border-radius:14px;background:rgba(221,176,95,.1);border:1px solid rgba(221,176,95,.45);color:#f1efe8;direction:rtl;font:13.5px/1.5 Heebo,Assistant,system-ui,sans-serif}' +
      '#alLead b.t{display:block;font-size:15px;color:#fff;margin-bottom:2px}#alLead p{margin:0 0 10px;color:#cfd3de;font-size:12.5px}' +
      '#alLead input[type=text],#alLead input[type=tel]{width:100%;box-sizing:border-box;margin:0 0 8px;padding:9px 11px;border-radius:9px;border:1px solid rgba(255,255,255,.25);background:#fff;color:#111;font:inherit;font-size:14px}' +
      '#alLead label.c{display:flex;gap:7px;align-items:flex-start;font-size:11.5px;color:#cfd3de;margin:2px 0 10px;cursor:pointer}#alLead label.c input{margin-top:3px}' +
      '#alLead button{width:100%;border:0;border-radius:10px;padding:10px;font:inherit;font-weight:800;font-size:14px;cursor:pointer;background:linear-gradient(135deg,#DDB05F,#9C7530);color:#141b2d}#alLead button:disabled{opacity:.6}' +
      '#alLead .s{font-size:11px;color:#9aa1b2;margin-top:8px}#alLead .s a{color:#DDB05F}#alLead .err{color:#ffb4a8;font-size:12px;margin-top:6px}#alLead .hp{position:absolute;left:0;top:0;width:1px;height:1px;overflow:hidden;opacity:0;clip-path:inset(50%);pointer-events:none}' +
      '#alLead.done{text-align:center}#alLead.done b.t{font-size:16px}';
    document.head.appendChild(css);
    leadBox = document.createElement('form'); leadBox.id = 'alLead'; leadBox.noValidate = true;
    leadBox.innerHTML = '<b class="t">רוצים לדעת איך זה ייראה אצלכם?</b><p>השאירו שם וטלפון, ואדיר יחזור אליכם לשיחה קצרה. בלי התחייבות.</p>' +
      '<input type="text" name="name" placeholder="שם מלא" autocomplete="name" maxlength="120">' +
      '<input type="tel" name="phone" placeholder="טלפון" autocomplete="tel" inputmode="tel" maxlength="30" dir="rtl">' +
      '<input type="text" name="website" class="hp" tabindex="-1" autocomplete="off" aria-hidden="true">' +
      '<label class="c"><input type="checkbox" name="consent"> אשמח לקבל מדי פעם עדכונים ורעיונות מ-A.L Systems (אפשר להסיר בכל עת)</label>' +
      '<button type="submit">חזרו אליי</button><div class="err" hidden></div>' +
      '<div class="s">נשתמש בפרטים רק כדי לחזור אליכם. <a href="/privacy.html" target="_blank" rel="noopener">מדיניות פרטיות</a></div>';
    leadBox.addEventListener('submit', function (e) {
      e.preventDefault();
      var f = leadBox, err = f.querySelector('.err'), btn = f.querySelector('button');
      var name = f.name.value.trim(), phone = f.phone.value.trim();
      err.hidden = true;
      if (name.length < 2) { err.textContent = 'כתבו שם'; err.hidden = false; f.name.focus(); return; }
      if (phone.replace(/\D/g, '').length < 9) { err.textContent = 'כתבו מספר טלפון תקין'; err.hidden = false; f.phone.focus(); return; }
      var ref = ''; try { var r = new URL(document.referrer); if (r.host === location.host && r.pathname.indexOf('/demo/') !== 0) ref = r.pathname; } catch (x) {}
      btn.disabled = true; btn.textContent = 'שולח...';
      fetch(LEAD_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        name: name, phone: phone, source: 'demo', demo_name: demo, page_path: ref || location.pathname,
        marketing_consent: !!f.consent.checked, website: f.website.value,
        message: ref ? 'הגיע/ה לדמו מהעמוד ' + ref : ''
      }) }).then(function (r) { return r.json().then(function (d) { if (!r.ok || !d.ok) throw 0; }); }).then(function () {
        try { gtag('event', 'generate_lead', { method: 'demo_form', demo_name: demo, page_path: location.pathname }); } catch (x) {}
        f.className = 'done';
        f.innerHTML = '<b class="t">תודה, ' + name.split(' ')[0].replace(/[<>&"]/g, '') + '! ✓</b><p style="margin:4px 0 0">קיבלנו את הפרטים. אדיר יחזור אליכם בהקדם.</p>';
      }).catch(function () {
        btn.disabled = false; btn.textContent = 'חזרו אליי';
        err.textContent = 'משהו השתבש בשליחה. אפשר לנסות שוב, או לכתוב לנו בוואטסאפ.'; err.hidden = false;
      });
    });
    function attach() {
      var host = document.querySelector('#tour .tb, #tour, #demoTour .dt-body, #demoTour');
      if (host && leadBox.parentNode !== host) host.appendChild(leadBox);
    }
    attach();
    var obs = new MutationObserver(function () { if (!document.body.contains(leadBox)) attach(); });
    obs.observe(document.body, { childList: true, subtree: true });
  }
  var origTrack = window.demoTrack;
  window.demoTrack = function (demo, step, name) {
    origTrack(demo, step, name);
    if (step === 'complete') setTimeout(function () { leadForm(demo); }, 50);
  };

  function boot() { brand(); banner(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
