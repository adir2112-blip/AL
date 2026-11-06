// ═══ DEMO TOUR: guided 4-step walkthrough on top of the real ShiftSync UI ═══
(function () {
  var STEP_KEY = 'shiftsync_demo_step';
  var AGENT_KEY = 'shiftsync_demo_agent';
  var DEMO_AGENT = 'demo_dana';
  try { DEMO_AGENT = sessionStorage.getItem(AGENT_KEY) || DEMO_AGENT; } catch (e) {}
  var MGR_EMAIL = 'manager@demo.co.il';
  var SITE = '../../';
  var WA = 'https://wa.me/972509143496?text=' + encodeURIComponent('היי, ניסיתי את הדמו של ShiftSync באתר ואשמח לשמוע עוד');
  var TEL = 'tel:0509143496';

  // No background timers in the demo
  window.scheduleAutoReset = function () {};
  window.scheduleWeeklySave = function () {};
  window.checkAutoReset = function () {};

  var step = 0;
  try { step = Number(sessionStorage.getItem(STEP_KEY) || 0); } catch (e) {}

  // visible step number (1-4) for each internal step
  var VIS = { 1: 1, 2: 2, 3: 3, 4: 3, 5: 4, 6: 4 };

  var STEPS = {
    0: {
      title: 'ברוכים הבאים להדגמה של ShiftSync',
      html: '<p>זו המערכת האמיתית, עם נתונים לדוגמה. תעברו את כל המסלול בעצמכם: עובדת מגישה אילוצים, המנהלת מאשרת, והסידור יוצא לעובדים במייל.</p><p>זה לוקח בערך 2 דקות.</p>',
      actions: [{ label: 'בואו נתחיל', gold: true, fn: function () { go(1); } }]
    },
    1: {
      title: 'התחברות העובדת למערכת',
      html: '<p>לחצו על הכרטיס של <b>דנה כהן</b> והקישו את הקוד <code>0000</code>.</p><p>במערכת האמיתית כל עובד נכנס עם 4 הספרות האחרונות של תעודת הזהות שלו.</p>'
    },
    2: {
      title: 'בחירת אילוצים לשבוע הבא',
      html: '<p>בחרו אילוץ לאחד הימים, למשל ביום שלישי <b>יציאה מוקדמת</b>, ובחרו שעה. כתבו הערה קצרה (למשל "לימודים").</p><p>אחר כך לחצו <b>סקירה לפני שליחה</b> ואז אשרו ושלחו.</p>'
    },
    3: {
      title: 'עכשיו אתם המנהלת',
      html: '<p>האילוץ נשלח למנהלת וממתין לאישור. עכשיו נחליף כובע ונראה מה המנהלת רואה.</p><p>התחברו עם המייל <code>' + MGR_EMAIL + '</code> והסיסמה <code>0000</code> (כבר מילאנו לכם).</p>',
      actions: [{ label: 'עברו למסך המנהלת', gold: true, fn: toManager }]
    },
    4: {
      title: 'אישור או שינוי של האילוץ',
      html: '<p>בלשונית <b>נציגים ואישורים</b> מופיע האילוץ ששלחתם, מסומן <b>ממתין</b>.</p><p>לחצו <b>אשר</b>, או לחצו <b>ערוך</b>, שנו את האילוץ ולחצו <b>שמור ואשר</b>.</p>',
      actions: [{ label: 'קחו אותי לאישורים', fn: function () { tab('agents'); } }]
    },
    5: {
      title: 'הסידור השבועי מוכן',
      html: '<p>המערכת בנתה לבד את הסידור לשבוע הבא לפי כל האילוצים שאושרו: מי עובד בכל יום, באיזו משמרת ומי בחופש. אפשר לגלול ולראות את כל הטבלה.</p><p>כשהסידור נראה טוב, לחצו <b>📧 שלח סידור לעובדים במייל</b>.</p>',
      actions: [{ label: 'הראו לי את הסידור', fn: showSchedule }]
    },
    6: {
      title: 'זהו, הסידור הופץ',
      html: '<p>כל עובד קיבל במייל את השעות שלו לשבוע הבא, כולל אתם. ככה זה עובד כל שבוע: בלי אקסלים, בלי הודעות בוואטסאפ ובלי טלפונים.</p><p><b>רוצים ShiftSync בעסק שלכם?</b></p>',
      actions: [
        { label: 'וואטסאפ אלינו', gold: true, href: WA, ext: true },
        { label: 'חייגו אלינו', href: TEL },
        { label: 'הצג שוב את המייל', fn: function () { showInbox(); } },
        { label: 'חזרה לאתר', href: SITE + 'systems.html#shifts' }
      ]
    }
  };

  var panel = document.createElement('div');
  panel.id = 'demoTour';
  document.body.appendChild(panel);

  function save() { try { sessionStorage.setItem(STEP_KEY, String(step)); } catch (e) {} }
  function go(n) { if (n < step && n !== 0) return; step = n; save(); render(); highlight(); }

  function render() {
    var s = STEPS[step];
    var vis = VIS[step] || 0;
    var prog = '';
    for (var i = 1; i <= 4; i++) prog += '<span class="' + (i <= vis ? 'on' : '') + '"></span>';
    var actions = (s.actions || []).map(function (a, i) {
      var cls = 'dt-btn ' + (a.gold ? 'dt-btn-gold' : 'dt-btn-ghost');
      return a.href ? '<a class="' + cls + '" href="' + a.href + '"' + (a.ext ? ' target="_blank" rel="noopener"' : '') + '>' + a.label + '</a>'
                    : '<button class="' + cls + '" data-act="' + i + '">' + a.label + '</button>';
    }).join('');
    panel.innerHTML =
      '<div class="dt-head"><span class="dt-badge">מצב הדגמה · ShiftSync</span><div class="dt-icons">' +
      '<button class="dt-icon" data-ui="restart">התחלה מחדש</button><button class="dt-icon" data-ui="min">' + (panel.classList.contains('min') ? 'הצג' : 'מזער') + '</button></div></div>' +
      '<div class="dt-body">' + (vis ? '<div class="dt-progress">' + prog + '</div><div class="dt-step">שלב ' + vis + ' מתוך 4</div>' : '') +
      '<h3>' + s.title + '</h3>' + s.html + (actions ? '<div class="dt-actions">' + actions + '</div>' : '') +
      (step < 6 ? '<div class="dt-contact"><span>שאלות?</span><a href="' + WA + '" target="_blank" rel="noopener">וואטסאפ</a><a href="' + TEL + '">חיוג</a></div>' : '') + '<div class="dt-note">הנתונים מדומים. שום דבר לא נשמר ולא נשלח באמת.</div></div>';
    panel.querySelectorAll('[data-act]').forEach(function (b) {
      b.onclick = function () { s.actions[Number(b.getAttribute('data-act'))].fn(); };
    });
    panel.querySelector('[data-ui="restart"]').onclick = function () { window.DEMO_RESET(); };
    panel.querySelector('[data-ui="min"]').onclick = function () { panel.classList.toggle('min'); render(); };
  }

  function clearPulse() { document.querySelectorAll('.demo-pulse').forEach(function (el) { el.classList.remove('demo-pulse'); }); }
  function highlight() {
    clearPulse();
    if (step === 1) {
      document.querySelectorAll('#agentGrid .agent-card').forEach(function (c) {
        if (c.textContent.indexOf('דנה כהן') >= 0) c.classList.add('demo-pulse');
      });
    } else if (step === 3) {
      var b = document.querySelector('#managerLoginSection .btn-primary');
      if (b && document.getElementById('managerLoginSection').style.display !== 'none') b.classList.add('demo-pulse');
    } else if (step === 4) {
      var t = document.getElementById('mgTab2'); if (t) t.classList.add('demo-pulse');
    } else if (step === 5) {
      var e = document.getElementById('sendEmailsBtn');
      if (e) e.classList.add('demo-pulse');
      else document.querySelectorAll('#mgSchedulePane .btn-success').forEach(function (x) { x.classList.add('demo-pulse'); });
    }
  }

  function tab(name) {
    var id = name === 'agents' ? 'mgTab2' : 'mgTab1';
    var btn = document.getElementById(id);
    if (btn && document.getElementById('managerScreen').classList.contains('active')) { mgTab(name, btn); highlight(); }
  }

  function showSchedule() {
    tab('schedule');
    if (!document.getElementById('sendEmailsBtn')) generateAndRender();
    setTimeout(function () {
      var out = document.getElementById('scheduleOutput');
      if (out) out.scrollIntoView({ behavior: 'smooth', block: 'start' });
      highlight();
    }, 200);
  }

  function toManager() {
    logout();
    setRole('manager');
    document.getElementById('loginEmail').value = MGR_EMAIL;
    document.getElementById('loginPass').value = '0000';
    highlight();
  }

  function danaApproved() {
    var a = localAgents.find(function (x) { return x.key === DEMO_AGENT; });
    return a && a.submitted && a.approved;
  }

  // wrap app functions (globals) to advance the tour
  function after(name, fn) {
    var orig = window[name];
    if (typeof orig !== 'function') return;
    window[name] = function () {
      var args = arguments, r = orig.apply(this, args);
      Promise.resolve(r).then(function () { try { fn.apply(null, args); } catch (e) { console.warn(e); } });
      return r;
    };
  }

  after('renderAgentGrid', function () { if (step === 1) highlight(); });
  after('setRole', function () { if (step === 1 || step === 3) highlight(); });
  after('loginAsAgent', function (key) {
    if (step <= 2) {
      DEMO_AGENT = key;
      try { sessionStorage.setItem(AGENT_KEY, key); } catch (e) {}
      var a = localAgents.find(function (x) { return x.key === key; });
      // already-submitted sample worker: reopen the form so the tour can continue
      if (a && a.submitted) {
        a.submitted = false; a.approved = false;
        DAYS.forEach(function (d) { a.constraints[d] = { type: 'none', time: '', note: '' }; });
        saveAgent(a).then(renderAgentContent);
      }
      if (step <= 1) go(2);
    }
  });
  after('agentConfirmAndSubmit', function () {
    var a = localAgents.find(function (x) { return x.key === DEMO_AGENT; });
    if (step === 2 && a && a.submitted) go(3);
    if (step === 3) addManagerCta();
  });
function addManagerCta() {
    var box = document.getElementById('agentContent');
    if (!box || document.getElementById('demoMgrCta')) return;
    var d = document.createElement('div');
    d.id = 'demoMgrCta';
    d.style.cssText = 'margin-top:18px;padding:18px;border-radius:14px;background:#141b2d;color:#fff;text-align:center;border:1px solid rgba(221,176,95,.5)';
    d.innerHTML = '<div style="font-size:.78rem;color:#DDB05F;font-weight:800;margin-bottom:4px">שלב 3 מתוך 4</div><div style="font-weight:800;font-size:1.05rem;margin-bottom:6px">עכשיו תראו את זה מהצד של המנהלת</div><div style="font-size:.88rem;color:#d1d5db;margin-bottom:12px">המנהלת רואה את האילוץ שלכם ומאשרת או משנה אותו</div>';
    var b = document.createElement('button');
    b.className = 'demo-pulse';
    b.textContent = 'עברו למסך המנהלת ←';
    b.style.cssText = 'border:none;border-radius:10px;padding:11px 22px;font-family:inherit;font-size:.95rem;font-weight:800;cursor:pointer;background:linear-gradient(135deg,#DDB05F,#9C7530);color:#141b2d';
    b.onclick = toManager;
    d.appendChild(b);
    box.appendChild(d);
  }
  after('renderAgentContent', function () { if (step === 3) addManagerCta(); });

  after('enterManager', function () {
    if (step === 3) { go(4); tab('agents'); }
    else if (step === 4) tab('agents');
    else if (step === 5) showSchedule();
  });
  ['approveAgent', 'saveAndApproveAgent', 'approveAllPending'].forEach(function (n) {
    after(n, function () { if (step === 4 && danaApproved()) { go(5); setTimeout(showSchedule, 400); } });
  });
  after('renderMgSchedule', function () { if (step === 5) highlight(); });
  after('generateAndRender', function () { if (step === 5) highlight(); });
  after('mgTab', function () { if (step === 4 || step === 5) highlight(); });
  after('sendEmailsManually', function () {
    if (window.DEMO_MAILS.some(function (m) { return m.to_email && mine(m); })) {
      if (step === 5) go(6);
      showInbox();
    }
  });

  // in-page demo inbox
  function mine(m) { var a = localAgents.find(function (x) { return x.key === DEMO_AGENT; }); return !!(a && m.to_email === a.email); }
  function esc(s) { return String(s || '').replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function showInbox() {
    var mails = window.DEMO_MAILS.slice();
    if (!mails.length) return;
    mails.sort(function (a, b) { return mine(b) - mine(a); });
    var old = document.getElementById('demoInbox'); if (old) old.remove();
    var box = document.createElement('div');
    box.id = 'demoInbox';
    box.innerHTML = '<div class="di-box"><div class="di-top"><span>📬 תיבת הדואר של העובדים (הדגמה)</span><button aria-label="סגירה">✕</button></div>' +
      '<div class="di-wrap"><div class="di-list"></div><div class="di-mail"></div></div>' +
      '<div class="di-foot">בהדגמה המיילים מוצגים כאן ולא נשלחים בפועל. במערכת האמיתית כל עובד מקבל את המייל הזה לתיבה שלו.</div></div>';
    document.body.appendChild(box);
    var list = box.querySelector('.di-list'), view = box.querySelector('.di-mail');
    function open(i) {
      var m = mails[i];
      list.querySelectorAll('.di-item').forEach(function (el, j) { el.classList.toggle('on', i === j); });
      view.innerHTML = '<div class="di-subj">סידור העבודה שלך לשבוע הבא</div>' +
        '<div class="di-meta">מאת: <b>ShiftSync – סידור עבודה</b><br>אל: <b>' + esc(m.to_name) + '</b> &lt;' + esc(m.to_email) + '&gt;</div>' +
        '<p style="margin:0 0 12px;font-size:.92rem">שלום ' + esc(m.to_name) + ',<br>המנהלת אישרה את האילוצים שלך. זה הסידור שלך לשבוע הבא:</p>' +
        m.schedule_html;
    }
    list.innerHTML = mails.map(function (m, i) {
      return '<div class="di-item" data-i="' + i + '"><b>' + esc(m.to_name) + '</b>סידור העבודה שלך לשבוע הבא</div>';
    }).join('');
    list.querySelectorAll('.di-item').forEach(function (el) { el.onclick = function () { open(Number(el.getAttribute('data-i'))); }; });
    open(0);
    box.querySelector('.di-top button').onclick = function () { box.remove(); };
    box.onclick = function (e) { if (e.target === box) box.remove(); };
  }

  render();
  setTimeout(highlight, 600);
  if (step === 3) { setTimeout(toManager, 300); }
})();
