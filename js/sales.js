/* Sales center, agent page (sales.html).
   An agent signs in with his username + password, sees only the leads the
   owner assigned to him, opens a call with the script of the lead's
   industry, and saves the outcome. Changes go through the "sales" edge
   function; the page itself only reads (row level security). */
(function () {
  'use strict';
  var SUPABASE_URL = 'https://iwixjlfbifsbxtyppvqb.supabase.co';
  var SUPABASE_KEY = 'sb_publishable_iY-jr6JMmtFmyrS8QVQ5lA_qOKK9UrF';
  var AGENT_DOMAIN = 'agents.al-systems.co.il';
  var sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

  var ST = {
    new: { t: 'חדש', c: 'new' }, no_answer: { t: 'אין מענה', c: 'na' }, callback: { t: 'לחזור', c: 'cb' },
    meeting: { t: 'נקבעה פגישה', c: 'mt' }, not_interested: { t: 'לא מעוניין', c: 'ni' }
  };
  var CHIPS = [
    { k: 'todo', t: 'לחיוג' }, { k: 'callback', t: 'לחזור' }, { k: 'no_answer', t: 'אין מענה' },
    { k: 'new', t: 'חדשים' }, { k: 'meeting', t: 'פגישות' }, { k: 'all', t: 'הכל' }
  ];
  var S = { agent: null, leads: [], scripts: {}, chip: 'todo', ind: '', q: '', shift: null, calls: [], timer: null, lead: null };

  function $(id) { return document.getElementById(id); }
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function show(id) { ['slLogin', 'slList', 'slCall'].forEach(function (x) { $(x).classList.toggle('sl-hide', x !== id); }); scrollTo(0, 0); }
  function hm(ms) { var m = Math.floor(ms / 60000); return Math.floor(m / 60) + ':' + String(m % 60).padStart(2, '0'); }
  function fmt(iso) { return iso ? new Date(iso).toLocaleString('he-IL', { weekday: 'short', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''; }
  function telHref(p) { return 'tel:' + String(p || '').replace(/[^\d+]/g, ''); }

  async function call(body) {
    var s = (await sb.auth.getSession()).data.session;
    var r = await fetch(SUPABASE_URL + '/functions/v1/sales', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (s ? s.access_token : '') }, body: JSON.stringify(body) });
    var j = await r.json().catch(function () { return {}; });
    if (!r.ok || !j.ok) throw new Error(j.error || ('שגיאה ' + r.status));
    return j;
  }

  // ---------- login ----------
  $('slLoginForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    $('slLoginErr').textContent = '';
    var u = $('slUser').value.trim().toLowerCase();
    var email = u.indexOf('@') > 0 ? u : u + '@' + AGENT_DOMAIN;
    var r = await sb.auth.signInWithPassword({ email: email, password: $('slPass').value });
    if (r.error) { $('slLoginErr').textContent = 'שם משתמש או סיסמה שגויים'; return; }
    start();
  });
  $('slOut').addEventListener('click', async function () { await sb.auth.signOut(); location.reload(); });

  async function start() {
    var uid = (await sb.auth.getSession()).data.session.user.id;
    var a = await sb.from('sales_agents').select('*').eq('user_id', uid).eq('active', true).maybeSingle();
    if (!a.data) {
      show('slLogin');
      $('slLoginErr').textContent = 'המשתמש הזה אינו נציג פעיל. מנהל? הדשבורד נמצא ב-dashboard.html';
      await sb.auth.signOut();
      return;
    }
    S.agent = a.data;
    $('slName').textContent = S.agent.name;
    $('slHello').textContent = 'שלום ' + S.agent.name.split(' ')[0];
    $('slMe').classList.remove('sl-hide');
    await Promise.all([loadScripts(), loadLeads(), loadShift(), loadCalls()]);
    show('slList');
    if (location.hash.indexOf('#lead-') === 0) openLead(Number(location.hash.slice(6)));
  }

  async function loadScripts() {
    var r = await sb.from('sales_scripts').select('industry,label,script,sort').eq('active', true).order('sort');
    S.scripts = {}; (r.data || []).forEach(function (x) { S.scripts[x.industry] = x; });
    $('slInd').innerHTML = '<option value="">כל התחומים</option>' + (r.data || []).map(function (x) { return '<option value="' + x.industry + '">' + esc(x.label) + '</option>'; }).join('');
  }
  async function loadLeads() {
    var r = await sb.from('sales_leads').select('*').order('id').limit(3000);
    S.leads = r.data || [];
    paintList();
  }
  async function loadCalls() {
    var d = new Date(); d.setHours(0, 0, 0, 0);
    var r = await sb.from('sales_calls').select('id,status,created_at').gte('created_at', d.toISOString()).limit(2000);
    S.calls = r.data || [];
    $('slToday').textContent = S.calls.length;
    $('slMeetToday').textContent = S.calls.filter(function (c) { return c.status === 'meeting'; }).length;
  }

  // ---------- time clock ----------
  async function loadShift() {
    var r = await sb.from('sales_shifts').select('*').is('ended_at', null).maybeSingle();
    S.shift = r.data || null;
    paintClock();
  }
  function paintClock() {
    var on = !!S.shift, b = $('slClock');
    b.classList.toggle('on', on);
    $('slShiftWarn').classList.toggle('sl-hide', on);
    clearInterval(S.timer);
    var tick = function () { $('slClockTxt').textContent = on ? 'במשמרת ' + hm(Date.now() - new Date(S.shift.started_at)) + ' · יציאה' : 'כניסה למשמרת'; };
    tick(); if (on) S.timer = setInterval(tick, 30000);
  }
  $('slClock').addEventListener('click', async function () {
    var b = this; b.disabled = true;
    try {
      if (S.shift && !b.dataset.sure) { b.dataset.sure = '1'; $('slClockTxt').textContent = 'לסיים את המשמרת? לחץ שוב'; setTimeout(function () { b.dataset.sure = ''; paintClock(); }, 3500); b.disabled = false; return; }
      b.dataset.sure = '';
      var r = await call({ action: 'clock', dir: S.shift ? 'out' : 'in' });
      S.shift = r.shift && !r.shift.ended_at ? r.shift : null;
      paintClock();
    } catch (x) { alertBar(x.message); }
    b.disabled = false;
  });

  // ---------- list ----------
  function inChip(l) {
    if (S.chip === 'all') return true;
    if (S.chip === 'todo') return l.status === 'new' || l.status === 'no_answer' || (l.status === 'callback' && (!l.callback_at || new Date(l.callback_at) <= new Date(Date.now() + 3600e3)));
    return l.status === S.chip;
  }
  // the list in calling order: callbacks that are due, then new, then no-answer by fewest attempts
  var RANK = { callback: 0, new: 1, no_answer: 2, meeting: 3, not_interested: 4 };
  function visible() {
    var q = S.q.toLowerCase();
    return S.leads.filter(inChip).filter(function (l) {
      return (!S.ind || l.industry === S.ind) && (!q || (l.business + ' ' + (l.city || '') + ' ' + (l.contact_name || '')).toLowerCase().indexOf(q) >= 0);
    }).sort(function (a, b) { return (RANK[a.status] - RANK[b.status]) || ((a.callback_at || '') < (b.callback_at || '') ? -1 : (a.callback_at || '') > (b.callback_at || '') ? 1 : 0) || (a.attempts - b.attempts) || (a.id - b.id); });
  }
  function paintList() {
    var counts = {};
    CHIPS.forEach(function (c) { var k = S.chip; S.chip = c.k; counts[c.k] = S.leads.filter(inChip).length; S.chip = k; });
    $('slChips').innerHTML = CHIPS.map(function (c) { return '<button type="button" data-c="' + c.k + '" class="' + (S.chip === c.k ? 'on' : '') + '">' + c.t + ' · ' + counts[c.k] + '</button>'; }).join('');
    var rows = visible();
    $('slRows').innerHTML = rows.length ? rows.map(function (l) {
      var st = ST[l.status], sc = S.scripts[l.industry];
      return '<div class="sl-row st-' + st.c + '">' +
        '<div class="sl-row-main"><b>' + esc(l.business) + '</b>' +
          '<span>' + (l.contact_name ? esc(l.contact_name) + ' · ' : '') + esc(l.city || '') + '</span>' +
          '<span class="sl-tags"><i class="sl-st ' + st.c + '">' + st.t + '</i>' + (sc ? '<i>' + esc(sc.label) + '</i>' : '') +
          (l.attempts ? '<i>' + l.attempts + ' ניסיונות</i>' : '') + (l.callback_at && l.status === 'callback' ? '<i class="cb">לחזור ' + fmt(l.callback_at) + '</i>' : '') +
          (l.meeting_at && l.status === 'meeting' ? '<i class="mt">פגישה ' + fmt(l.meeting_at) + '</i>' : '') + '</span></div>' +
        '<div class="sl-row-act"><a class="sl-btn ghost" href="' + telHref(l.phone) + '">חיוג</a><button type="button" class="sl-btn" data-open="' + l.id + '">פתיחת שיחה</button></div>' +
      '</div>';
    }).join('') : '<p class="sl-empty">' + (S.leads.length ? 'אין כאן לידים כרגע. נסה סינון אחר.' : 'עוד לא הוקצו לך לידים. מנהל המוקד יקצה לך רשימה.') + '</p>';
  }
  $('slChips').addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) { S.chip = b.dataset.c; paintList(); } });
  $('slInd').addEventListener('change', function () { S.ind = this.value; paintList(); });
  $('slSearch').addEventListener('input', function () { S.q = this.value.trim(); paintList(); });
  $('slRows').addEventListener('click', function (e) { var b = e.target.closest('[data-open]'); if (b) openLead(Number(b.dataset.open)); });

  // ---------- call ----------
  var DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
  // the next two working days (Sunday-Thursday): "מחר" / "ביום שלישי"
  function nextDays() {
    var out = [], d = new Date(), tomorrow = new Date(Date.now() + 864e5).toDateString();
    while (out.length < 2) {
      d = new Date(d.getTime() + 864e5);
      if (d.getDay() === 5 || d.getDay() === 6) continue;
      out.push(d.toDateString() === tomorrow ? 'מחר' : 'ביום ' + DAYS[d.getDay()]);
    }
    return out;
  }
  function fill(text, lead, sc) {
    var days = nextDays(), first = String(S.agent.name).split(' ')[0];
    // first name, keeping a title with it ("ד"ר רון", "עו"ד דנה")
    var parts = String(lead.contact_name || '').trim().split(/\s+/);
    var name = !parts[0] ? '' : /^(ד["״]ר|עו["״]ד|רו["״]ח|פרופ['׳]?|מר|גב['׳])$/.test(parts[0]) && parts[1] ? parts[0] + ' ' + parts[1] : parts[0];
    return esc(text)
      .replace(/\{name\}\?/g, name ? '<mark>' + esc(name) + '</mark>?' : 'אני מדבר עם בעל/ת <mark>' + esc(lead.business) + '</mark>?')
      .replace(/\{name\}/g, name ? '<mark>' + esc(name) + '</mark>' : '')
      .replace(/\{agent\}/g, '<mark>' + esc(first) + '</mark>')
      .replace(/\{business\}/g, '<mark>' + esc(lead.business) + '</mark>')
      .replace(/\{topic\}/g, esc((sc && sc.script.topic) || 'המערכת'))
      .replace(/\{day1\}/g, '<mark>' + days[0] + '</mark>').replace(/\{day2\}/g, '<mark>' + days[1] + '</mark>')
      .replace(/\{day\}/g, '___').replace(/\{hour\}/g, '___');
  }

  function openLead(id) {
    var l = S.leads.filter(function (x) { return x.id === id; })[0];
    if (!l) return;
    S.lead = l;
    history.replaceState(null, '', '#lead-' + id);
    var sc = S.scripts[l.industry], sp = sc ? sc.script : { steps: [], objections: [], guide: { do: [], dont: [] } };
    $('slCall').innerHTML =
      '<div class="sl-callbar"><button type="button" class="sl-btn ghost" id="slBack">→ חזרה לרשימה</button>' +
        '<div class="sl-callwho"><b>' + esc(l.business) + '</b><span>' + (l.contact_name ? esc(l.contact_name) + ' · ' : '') + '<span dir="ltr">' + esc(l.phone) + '</span></span></div>' +
        '<a class="sl-btn call" href="' + telHref(l.phone) + '">📞 חיוג</a></div>' +
      '<div class="sl-info">' + [sc ? '<i>' + esc(sc.label) + '</i>' : '', l.city ? esc(l.city) : '', l.address ? esc(l.address) : '',
        l.website ? '<a href="' + esc(l.website) + '" target="_blank" rel="noopener">אתר העסק ↗</a>' : '', l.rating ? '⭐ ' + l.rating + (l.reviews ? ' (' + l.reviews + ')' : '') : '',
        l.attempts ? l.attempts + ' ניסיונות קודמים' : ''].filter(Boolean).join(' · ') + '</div>' +
      (l.notes ? '<div class="sl-notes"><b>הערות קודמות</b><pre>' + esc(l.notes) + '</pre></div>' : '') +
      (sp.pitch ? '<div class="sl-pitch"><b>בשורה אחת:</b> ' + esc(sp.pitch) + '</div>' : '') +
      sp.steps.map(function (st, i) {
        return '<div class="sl-step"><p class="sl-eyebrow">שלב ' + (i + 1) + '</p><h3>' + esc(st.title) + '</h3>' + (st.note ? '<p class="sl-note">' + esc(st.note) + '</p>' : '') +
          st.lines.map(function (t) { return '<div class="sl-say"><small>נציג/ה</small>' + fill(t, l, sc) + '</div>'; }).join('') +
          (st.replies && st.replies.length ? '<div class="sl-replies">' + st.replies.map(function (r) {
            return '<div class="sl-reply ' + r.tone + '"><b>' + esc(r.label) + '</b><p>' + fill(r.say, l, sc) + '</p></div>';
          }).join('') + '</div>' : '') + '</div>';
      }).join('') +
      (sp.objections && sp.objections.length ? '<details class="sl-obj"><summary>מענה להתנגדויות</summary>' + sp.objections.map(function (o) {
        return '<div><b>"' + esc(o.q) + '"</b><p>' + fill(o.a, l, sc) + '</p></div>';
      }).join('') + '</details>' : '') +
      (sp.guide ? '<details class="sl-obj"><summary>מה עושים ומה לא</summary><div class="sl-guide"><div><b>עושים</b><ul>' + (sp.guide.do || []).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div><div><b>לא עושים</b><ul>' + (sp.guide.dont || []).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div></div></details>' : '') +
      '<div class="sl-result" id="slResult"><h3>תוצאת השיחה</h3>' +
        '<div class="sl-res-btns">' +
          '<button type="button" data-s="no_answer" class="na">אין מענה</button>' +
          '<button type="button" data-s="callback" class="cb">לחזור</button>' +
          '<button type="button" data-s="meeting" class="mt">נקבעה פגישה</button>' +
          '<button type="button" data-s="not_interested" class="ni">לא מעוניין</button>' +
        '</div>' +
        '<div class="sl-when sl-hide" id="slWhen"><label for="slWhenIn" id="slWhenLbl"></label><input type="datetime-local" id="slWhenIn"></div>' +
        '<textarea id="slNote" rows="2" placeholder="הערה (לא חובה): עם מי דיברת, מה חשוב לדעת לפגישה"></textarea>' +
        '<button type="button" class="btn btn-gold" id="slSave" disabled>שמור ועבור לבא</button>' +
        '<p class="sl-err" id="slSaveErr"></p>' +
      '</div>';
    show('slCall');
  }

  var pick = null;
  $('slCall').addEventListener('click', async function (e) {
    if (e.target.id === 'slBack') { history.replaceState(null, '', location.pathname); show('slList'); return; }
    var b = e.target.closest('[data-s]');
    if (b) {
      pick = b.dataset.s;
      Array.prototype.forEach.call($('slResult').querySelectorAll('[data-s]'), function (x) { x.classList.toggle('on', x === b); });
      var needs = pick === 'meeting' || pick === 'callback';
      $('slWhen').classList.toggle('sl-hide', !needs);
      if (needs) {
        $('slWhenLbl').textContent = pick === 'meeting' ? 'מועד הפגישה בזום' : 'מתי לחזור';
        var d = new Date(Date.now() + 864e5); d.setHours(pick === 'meeting' ? 10 : 11, 0, 0, 0);
        if (!$('slWhenIn').value) $('slWhenIn').value = new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 16);
      }
      $('slSave').disabled = false;
      return;
    }
    if (e.target.id === 'slSave') {
      var btn = e.target; btn.disabled = true; $('slSaveErr').textContent = '';
      try {
        var body = { action: 'log_call', lead_id: S.lead.id, status: pick, note: $('slNote').value.trim() };
        var w = $('slWhenIn').value ? new Date($('slWhenIn').value).toISOString() : null;
        if (pick === 'meeting') body.meeting_at = w;
        if (pick === 'callback') body.callback_at = w;
        await call(body);
        var done = S.lead.id;
        await Promise.all([loadLeads(), loadCalls()]);
        pick = null;
        // the next lead in the same list
        var next = visible().filter(function (l) { return l.id !== done; })[0];
        if (next) openLead(next.id); else { history.replaceState(null, '', location.pathname); show('slList'); }
        alertBar(body.status === 'meeting' ? 'הפגישה נשמרה ונשלחה למנהל 🎉' : 'נשמר');
      } catch (x) { $('slSaveErr').textContent = x.message; btn.disabled = false; }
    }
  });

  function alertBar(msg) {
    var d = document.createElement('div'); d.className = 'sl-toast'; d.textContent = msg; document.body.appendChild(d);
    setTimeout(function () { d.remove(); }, 2600);
  }

  sb.auth.getSession().then(function (r) { if (r.data.session) start(); else show('slLogin'); });
})();
