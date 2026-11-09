(function () {
  var STORAGE_KEY = 'al_cookie_consent';
  var STORAGE_KEY_TS = 'al_cookie_consent_date';

  // Microsoft Clarity (heatmaps + anonymous session recordings, inputs masked).
  // Loads only after the visitor accepts analytics cookies. Empty ID = off.
  var CLARITY_ID = '';
  function loadClarity() {
    if (!CLARITY_ID || window.clarity) return;
    (function (c, l, a, r, i, t, y) {
      c[a] = c[a] || function () { (c[a].q = c[a].q || []).push(arguments); };
      t = l.createElement(r); t.async = 1; t.src = 'https://www.clarity.ms/tag/' + i;
      y = l.getElementsByTagName(r)[0]; y.parentNode.insertBefore(t, y);
    })(window, document, 'clarity', 'script', CLARITY_ID);
  }

  function updateGtagConsent(granted) {
    if (typeof gtag === 'function') {
      gtag('consent', 'update', {
        analytics_storage: granted ? 'granted' : 'denied'
      });
    }
  }

  function saveConsent(granted) {
    try {
      localStorage.setItem(STORAGE_KEY, granted ? 'granted' : 'denied');
      localStorage.setItem(STORAGE_KEY_TS, new Date().toISOString());
    } catch (e) {}
    updateGtagConsent(granted);
    if (granted) loadClarity();
  }

  function getConsent() {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch (e) {
      return null;
    }
  }

  function buildBanner() {
    var wrap = document.createElement('div');
    wrap.className = 'cookie-banner';
    wrap.id = 'cookieBanner';
    wrap.innerHTML =
      '<div class="cookie-banner-main">' +
        '<p>אנחנו משתמשים בעוגיות אנליטיות כדי להבין איך משתמשים באתר ולשפר אותו. תוכלו לבחור אילו עוגיות לאפשר.</p>' +
        '<div class="cookie-banner-actions">' +
          '<button type="button" class="btn btn-ghost cookie-btn-settings">הגדרות</button>' +
          '<button type="button" class="btn btn-ghost cookie-btn-necessary">רק הכרחיות</button>' +
          '<button type="button" class="btn btn-gold cookie-btn-accept">קבלת הכל</button>' +
        '</div>' +
      '</div>' +
      '<div class="cookie-banner-settings" hidden>' +
        '<div class="cookie-toggle-row">' +
          '<div>' +
            '<strong>עוגיות הכרחיות</strong>' +
            '<p>נדרשות לתפעול בסיסי של האתר, כגון שמירת ההעדפה שלכם לגבי עוגיות. תמיד פעילות.</p>' +
          '</div>' +
          '<label class="cookie-switch cookie-switch--disabled"><input type="checkbox" checked disabled><span></span></label>' +
        '</div>' +
        '<div class="cookie-toggle-row">' +
          '<div>' +
            '<strong>עוגיות אנליטיות</strong>' +
            '<p>עוזרות לנו להבין כיצד מבקרים משתמשים באתר, דרך Google Analytics ו-Microsoft Clarity (מפות חום והקלטות גלישה אנונימיות, בלי תוכן של שדות טופס).</p>' +
          '</div>' +
          '<label class="cookie-switch"><input type="checkbox" id="cookieAnalyticsToggle"><span></span></label>' +
        '</div>' +
        '<div class="cookie-banner-actions">' +
          '<button type="button" class="btn btn-gold cookie-btn-save">שמירת ההעדפות</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(wrap);
    return wrap;
  }

  function showBanner(openSettings) {
    var banner = document.getElementById('cookieBanner') || buildBanner();
    banner.classList.add('is-visible');
    var settingsPanel = banner.querySelector('.cookie-banner-settings');
    var mainPanel = banner.querySelector('.cookie-banner-main');

    if (openSettings) {
      settingsPanel.hidden = false;
      mainPanel.hidden = true;
    }

    banner.querySelector('.cookie-btn-settings').addEventListener('click', function () {
      settingsPanel.hidden = false;
      mainPanel.hidden = true;
    });

    banner.querySelector('.cookie-btn-necessary').addEventListener('click', function () {
      saveConsent(false);
      hideBanner();
    });

    banner.querySelector('.cookie-btn-accept').addEventListener('click', function () {
      saveConsent(true);
      hideBanner();
    });

    banner.querySelector('.cookie-btn-save').addEventListener('click', function () {
      var analyticsOn = document.getElementById('cookieAnalyticsToggle').checked;
      saveConsent(analyticsOn);
      hideBanner();
    });

    var existing = getConsent();
    var toggle = document.getElementById('cookieAnalyticsToggle');
    if (toggle) toggle.checked = existing === 'granted';
  }

  function hideBanner() {
    var banner = document.getElementById('cookieBanner');
    if (banner) banner.classList.remove('is-visible');
  }

  document.addEventListener('DOMContentLoaded', function () {
    if (getConsent() === 'granted') loadClarity();
    var consent = getConsent();
    if (consent === null) {
      showBanner(false);
    } else {
      updateGtagConsent(consent === 'granted');
    }

    var reopenBtn = document.getElementById('privacyCookieSettingsBtn');
    if (reopenBtn) {
      reopenBtn.addEventListener('click', function () {
        showBanner(true);
      });
    }
  });
})();
