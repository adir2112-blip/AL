/* Sales center, owner side (dashboard.html#sales).
   Statistics by period / industry / agent, upcoming meetings, the lead pool
   (assign to an agent, import from Google, paste a list), the agents and
   their logins, and the monthly payroll from the time clock.
   Needs window.ALDash = {sb, SUPABASE_URL, authHeader}. */
(function () {
  'use strict';
  var D = window.ALDash, app = document.getElementById('salesApp');
  if (!D || !app) return;
  var ST = { no_answer: 'אין מענה', callback: 'לחזור', meeting: 'נקבעה פגישה', not_interested: 'לא מעוניין', new: 'חדש' };
  var S = { range: 'today', from: null, to: null, calls: [], shifts: [], leads: [], agents: [], scripts: [], loaded: false };

  function $(id) { return document.getElementById(id); }
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function pct(a, b) { return b ? Math.round(a / b * 1000) / 10 + '%' : '–'; }
  function hours(ms) { return Math.round(ms / 36e5 * 100) / 100; }
  function hm(ms) { var m = Math.round(ms / 6e4); return Math.floor(m / 60) + ':' + String(m % 60).padStart(2, '0'); }
  function dt(iso) { return iso ? new Date(iso).toLocaleString('he-IL', { weekday: 'short', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''; }
  function label(ind) { var s = S.scripts.filter(function (x) { return x.industry === ind; })[0]; return s ? s.label : ind; }
  function agentName(id) { var a = S.agents.filter(function (x) { return x.id === id; })[0]; return a ? a.name : 'ללא נציג'; }
  function err(msg) { $('saErr').textContent = msg || ''; }
  async function call(body) {
    var r = await fetch(D.SUPABASE_URL + '/functions/v1/sales', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: await D.authHeader() }, body: JSON.stringify(body) });
    var j = await r.json().catch(function () { return {}; });
    if (!r.ok || !j.ok) throw new Error(j.error || ('שגיאה ' + r.status));
    return j;
  }

  // ---------- periods ----------
  function day0(d) { d = new Date(d); d.setHours(0, 0, 0, 0); return d; }
  function setRange(k) {
    S.range = k;
    var now = new Date(), t0 = day0(now);
    if (k === 'today') { S.from = t0; S.to = new Date(+t0 + 864e5); }
    else if (k === 'yesterday') { S.from = new Date(+t0 - 864e5); S.to = t0; }
    else if (k === 'week') { S.from = new Date(+t0 - t0.getDay() * 864e5); S.to = new Date(+t0 + 864e5); } // Sunday
    else if (k === 'month') { S.from = new Date(now.getFullYear(), now.getMonth(), 1); S.to = new Date(+t0 + 864e5); }
    else if (k === 'custom') {
      var a = $('saFrom').value, b = $('saTo').value;
      if (!a || !b) return;
      S.from = day0(a); S.to = new Date(+day0(b) + 864e5);
    }
  }

  function svg(d) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + d + '</svg>'; }
  var IC = {
    over: '<path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-6"/>',
    pool: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>',
    team: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
    pay: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h4"/>',
    dial: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/>',
    cal: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
    talk: '<path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.6 8.6 0 0 1-3.8-.9L3 21l1.9-5.1A8.4 8.4 0 0 1 12 3a8.4 8.4 0 0 1 9 8.5z"/>',
    no: '<circle cx="12" cy="12" r="10"/><path d="M4.9 4.9l14.2 14.2"/>',
    clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>'
  };
  var TABS = [['ov', 'סקירה', IC.over], ['pool', 'מאגר לידים', IC.pool], ['team', 'נציגים', IC.team], ['pay', 'נוכחות ושכר', IC.pay]];

  app.innerHTML =
    '<div class="sa-top"><div class="sa-tabs" role="tablist">' + TABS.map(function (t) {
      return '<button type="button" role="tab" data-tab="' + t[0] + '">' + svg(t[2]) + '<span>' + t[1] + '</span><i class="sa-tabn" id="saTabN_' + t[0] + '"></i></button>';
    }).join('') + '</div><a class="sa-agentlink" href="sales.html" target="_blank" rel="noopener">' + svg(IC.dial) + 'דף הנציגים ↗</a></div>' +
    '<p class="dash-error" id="saErr"></p>' +
    // overview
    '<section class="sa-pane" data-pane="ov">' +
      '<div class="sa-range"><div class="sa-seg" id="saRange">' +
        ['today:היום', 'yesterday:אתמול', 'week:השבוע', 'month:החודש', 'custom:תאריכים'].map(function (x) { var p = x.split(':'); return '<button type="button" data-r="' + p[0] + '">' + p[1] + '</button>'; }).join('') +
        '</div><span class="sa-custom st-hide" id="saCustom"><input type="date" id="saFrom" aria-label="מתאריך"> עד <input type="date" id="saTo" aria-label="עד תאריך"></span><small id="saRangeTxt"></small></div>' +
      '<div class="sa-kpis" id="saKpis"></div>' +
      '<div class="sa-card sa-funnelcard"><div class="sa-card-h"><h3>משפך השיחות</h3><small>כל עסק נספר פעם אחת, גם אם חייגו אליו כמה פעמים</small></div><div id="saFunnel"></div></div>' +
      '<div class="sa-grid">' +
        '<div class="sa-card"><div class="sa-card-h"><h3>לפי תחום</h3><small>איפה להשקיע: הכי משתלם למעלה</small></div><div id="saByInd"></div></div>' +
        '<div class="sa-card"><div class="sa-card-h"><h3>לפי נציג</h3></div><div id="saByAgent"></div></div>' +
      '</div>' +
      '<div class="sa-card"><div class="sa-card-h"><h3>פגישות קרובות</h3><small>נשלחות אליך גם בווטסאפ</small></div><div id="saMeet"></div></div>' +
    '</section>' +
    // pool
    '<section class="sa-pane" data-pane="pool">' +
      '<div class="sa-card-h sa-pool-h"><h3>אחוזי הצלחה ומלאי לפי תחום</h3><small>מכל השיחות מאז ההתחלה. לחיצה על תחום פותחת את כל הלידים והסיווגים שלו</small></div>' +
      '<div class="sa-indcards" id="saIndCards"></div>' +
      '<div class="sa-actions">' +
        '<form id="saAssign" class="sa-form"><b>' + svg(IC.team) + 'הקצאה לנציג</b>' +
          '<select id="saAsAgent" aria-label="נציג"></select><select id="saAsInd" aria-label="תחום"></select>' +
          '<div class="sa-row2"><input id="saAsCity" placeholder="עיר (לא חובה)" aria-label="עיר"><input id="saAsCount" type="number" min="1" max="500" value="30" aria-label="כמה"></div>' +
          '<button class="btn btn-gold" type="submit">הקצה לידים פנויים</button></form>' +
        '<form id="saImport" class="sa-form"><b>' + svg('<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>') + 'ייבוא מגוגל מפות</b>' +
          '<select id="saImInd" aria-label="תחום"></select><input id="saImCity" placeholder="עיר, למשל חולון" aria-label="עיר" required>' +
          '<button class="btn btn-gold" type="submit">חפש וייבא (עד 60)</button><small id="saImRes"></small><small class="sa-use" id="saImUse"></small></form>' +
        '<form id="saPaste" class="sa-form"><b>' + svg('<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/>') + 'הדבקת רשימה</b><select id="saPaInd" aria-label="תחום"></select>' +
          '<textarea id="saPaText" rows="3" placeholder="שורה לכל עסק: שם העסק, טלפון, עיר, איש קשר"></textarea>' +
          '<button class="btn btn-ghost" type="submit">הוסף למאגר</button><small id="saPaRes"></small></form>' +
      '</div>' +
      '<div class="sa-card"><div class="sa-card-h"><h3>כל הלידים</h3><small id="saLeadCount"></small></div>' +
        '<div class="sa-lfilters"><input type="search" id="saLq" placeholder="חיפוש: שם עסק, איש קשר, טלפון, עיר" aria-label="חיפוש">' +
          '<select id="saLind" aria-label="תחום"></select><select id="saLst" aria-label="סטטוס"></select><select id="saLag" aria-label="נציג"></select></div>' +
        '<div class="sa-bulk st-hide" id="saBulk"><span id="saBulkN"></span><select id="saBulkAg" aria-label="נציג"></select><button type="button" class="btn btn-gold" id="saBulkGo">העבר</button></div>' +
        '<div class="sa-tablewrap" id="saLeads"></div><div class="sa-pager" id="saPager"></div>' +
      '</div>' +
    '</section>' +
    // team
    '<section class="sa-pane" data-pane="team">' +
      '<div class="sa-card"><div class="sa-card-h"><h3>נציגים</h3><small>נכנסים ב-<b dir="ltr">al-systems.co.il/sales.html</b></small></div><div id="saAgents"></div></div>' +
      '<form id="saNewAgent" class="sa-card sa-newagent"><div class="sa-card-h"><h3>נציג חדש</h3><small>את הסיסמה אתה בוחר ומוסר לנציג</small></div>' +
        '<div class="sa-fgrid"><label>שם מלא<input id="naName" required></label>' +
        '<label>שם משתמש (אנגלית)<input id="naUser" dir="ltr" autocapitalize="none" required></label>' +
        '<label>סיסמה (8+ תווים)<input id="naPass" type="password" dir="ltr" autocomplete="new-password" required></label>' +
        '<label>תעריף לשעה (₪)<input id="naRate" type="number" min="0" step="1" value="50"></label></div>' +
        '<button class="btn btn-gold" type="submit">צור נציג</button></form>' +
    '</section>' +
    // payroll
    '<section class="sa-pane" data-pane="pay">' +
      '<div class="sa-card"><div class="sa-card-h"><h3>דוח נוכחות ושכר</h3><div class="sa-inline"><input type="month" id="saMonth" aria-label="חודש"><button type="button" class="btn btn-ghost" id="saCsv">⬇ ייצוא לאקסל</button></div></div><div id="saPay"></div></div>' +
    '</section>';

  // tabs (the last one is remembered on this device)
  function showTab(t) {
    app.querySelectorAll('[data-tab]').forEach(function (b) { b.classList.toggle('on', b.dataset.tab === t); b.setAttribute('aria-selected', b.dataset.tab === t); });
    app.querySelectorAll('[data-pane]').forEach(function (x) { x.classList.toggle('on', x.dataset.pane === t); });
    try { localStorage.setItem('al_sales_tab', t); } catch (x) { /* private mode */ }
  }
  app.querySelector('.sa-tabs').addEventListener('click', function (e) { var b = e.target.closest('[data-tab]'); if (b) showTab(b.dataset.tab); });
  var savedTab = 'ov'; try { savedTab = localStorage.getItem('al_sales_tab') || 'ov'; } catch (x) { /* private mode */ }
  showTab(TABS.some(function (t) { return t[0] === savedTab; }) ? savedTab : 'ov');

  // ---------- load ----------
  async function load() {
    err('');
    var r = await Promise.all([
      D.sb.from('sales_agents').select('*').order('name'),
      D.sb.from('sales_scripts').select('industry,label,sort,active').order('sort'),
      D.sb.from('sales_leads').select('*').order('id', { ascending: false }).limit(20000),
      D.sb.from('sales_places_usage').select('month,requests'),
      D.sb.from('sales_calls').select('lead_id,industry,status,agent_id').limit(50000)
    ]);
    var bad = r.filter(function (x) { return x.error; })[0];
    if (bad) return err('טעינה נכשלה: ' + bad.error.message);
    S.agents = r[0].data || []; S.scripts = r[1].data || []; S.leads = r[2].data || []; S.allCalls = r[4].data || [];
    // Google searches this month: free up to 1,000, the function stops at 900
    var now = new Date(), month = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
    var used = ((r[3].data || []).filter(function (x) { return x.month === month; })[0] || {}).requests || 0;
    $('saImUse').textContent = 'החודש: ' + used + ' מתוך 900 חיפושים (חינם עד 1,000). עד 30 ביום. כל חיפוש מביא עד 20 עסקים.';
    $('saImUse').classList.toggle('warn', used >= 800);
    S.loaded = true;
    fillSelects(); paintPool(); paintLeads(); paintAgents(); paintMeetings();
    var free = S.leads.filter(function (x) { return !x.agent_id && x.status === 'new' && !x.dnc; }).length;
    $('saTabN_pool').textContent = free ? free + ' פנויים' : '';
    $('saTabN_team').textContent = S.agents.filter(function (a) { return a.active; }).length || '';
    await loadPeriod(); await loadPay();
  }
  async function loadPeriod() {
    if (!S.from) setRange(S.range);
    var r = await Promise.all([
      D.sb.from('sales_calls').select('id,created_at,agent_id,industry,status,lead_id').gte('created_at', S.from.toISOString()).lt('created_at', S.to.toISOString()).limit(20000),
      D.sb.from('sales_shifts').select('*').lt('started_at', S.to.toISOString()).or('ended_at.is.null,ended_at.gte.' + S.from.toISOString()).limit(5000)
    ]);
    S.calls = r[0].data || []; S.shifts = r[1].data || [];
    paintStats();
  }
  // hours of a shift that fall inside [from, to)
  function inside(sh, from, to) {
    var a = Math.max(+new Date(sh.started_at), +from), b = Math.min(+(sh.ended_at ? new Date(sh.ended_at) : new Date()), +to);
    return Math.max(0, b - a);
  }

  // ---------- statistics ----------
  // Success is measured per BUSINESS, not per call: calling one accountant
  // three times until he answers is one business. For a group of calls:
  //   dialed   = businesses called at least once
  //   reached  = businesses that answered at least once (any outcome but "no answer")
  //   meetings = businesses where a meeting was booked
  //   success  = meetings / dialed        (e.g. 10 of 50 accountants = 20%)
  //   of reached = meetings / reached     (how well the script works once they answer)
  function funnel(list) {
    var dialed = {}, reached = {}, met = {}, ni = {};
    list.forEach(function (x) {
      dialed[x.lead_id] = 1;
      if (x.status !== 'no_answer') reached[x.lead_id] = 1;
      if (x.status === 'meeting') met[x.lead_id] = 1;
      if (x.status === 'not_interested') ni[x.lead_id] = 1;
    });
    var d = Object.keys(dialed).length, r = Object.keys(reached).length, m = Object.keys(met).length;
    return { calls: list.length, dialed: d, reached: r, meetings: m, ni: Object.keys(ni).length, rate: d ? m / d : 0, rateReached: r ? m / r : 0 };
  }
  function bar(rate, best) { return '<span class="sa-bar' + (best ? ' best' : '') + '"><i style="width:' + Math.min(100, Math.round(rate * 100 * 2)) + '%"></i></span>'; }

  function paintStats() {
    var c = S.calls, all = funnel(c), by = function (s) { return c.filter(function (x) { return x.status === s; }).length; };
    var work = S.shifts.reduce(function (t, sh) { return t + inside(sh, S.from, S.to); }, 0);
    $('saRangeTxt').textContent = S.from.toLocaleDateString('he-IL') + (+S.to - +S.from > 864e5 ? ' – ' + new Date(+S.to - 1).toLocaleDateString('he-IL') : '');
    $('saKpis').innerHTML = [
      ['target', 'אחוז הצלחה', pct(all.meetings, all.dialed), 'פגישות מתוך העסקים שחויגו', 'hi'],
      ['cal', 'פגישות נקבעו', all.meetings, all.meetings ? 'מתוך ' + all.dialed + ' עסקים' : '', 'ok'],
      ['dial', 'עסקים שחויגו', all.dialed, all.calls + ' שיחות בסה"כ', ''],
      ['talk', 'ענו', all.reached, pct(all.meetings, all.reached) + ' מהם קבעו פגישה', ''],
      ['no', 'לא מעוניינים', all.ni, pct(all.ni, all.dialed) + ' מהעסקים', 'bad'],
      ['clock', 'שעות עבודה', hm(work), work ? Math.round(all.calls / (work / 36e5) * 10) / 10 + ' שיחות לשעה' : 'אין משמרות', '']
    ].map(function (k) { return '<div class="sa-kpi ' + k[4] + '"><span class="sa-kico">' + svg(IC[k[0]]) + '</span><div><span>' + k[1] + '</span><b>' + k[2] + '</b><small>' + k[3] + '</small></div></div>'; }).join('');
    // funnel: dialed -> answered -> meetings
    var steps = [['חויגו', all.dialed], ['ענו', all.reached], ['פגישות', all.meetings]];
    $('saFunnel').innerHTML = all.dialed ? '<div class="sa-funnel-steps">' + steps.map(function (st, i) {
      var w = Math.max(6, Math.round(st[1] / all.dialed * 100));
      return (i ? '<div class="sa-fconv">' + pct(st[1], steps[i - 1][1]) + '<i>←</i></div>' : '') +
        '<div class="sa-fstep s' + i + '"><b>' + st[1] + '</b><span>' + st[0] + '</span><em style="width:' + w + '%"></em></div>';
    }).join('') + '</div>' : '<p class="dash-empty">אין שיחות בתקופה הזו.</p>';
    // by industry, best success rate first
    var inds = {};
    c.forEach(function (x) { (inds[x.industry] = inds[x.industry] || []).push(x); });
    var rows = Object.keys(inds).map(function (k) { return Object.assign({ k: k }, funnel(inds[k])); })
      .sort(function (a, b) { return b.rate - a.rate || b.dialed - a.dialed; });
    $('saByInd').innerHTML = rows.length ? '<table class="dash-table sa-funnel"><tr><th>תחום</th><th>עסקים שחויגו</th><th>ענו</th><th>פגישות</th><th>אחוז הצלחה</th><th>מתוך מי שענה</th></tr>' +
      rows.map(function (r, i) {
        var best = i === 0 && r.meetings > 0;
        return '<tr data-ind="' + esc(r.k) + '" tabindex="0" class="sa-indrow' + (best ? ' sa-best' : '') + '"><td>' + esc(label(r.k)) + (best ? ' <i class="sa-on">הכי משתלם</i>' : '') + '</td><td>' + r.dialed + '</td><td>' + r.reached + '</td><td>' + r.meetings + '</td>' +
          '<td><b class="sa-rate">' + pct(r.meetings, r.dialed) + '</b>' + bar(r.rate, best) + '</td><td>' + pct(r.meetings, r.reached) + '</td></tr>';
      }).join('') + '</table><p class="sa-hint">אחוז הצלחה = כמה עסקים קבעו פגישה מתוך כל העסקים שחויגו (עסק שחויג כמה פעמים נספר פעם אחת). "מתוך מי שענה" מראה כמה התסריט עובד כשעונים.</p>'
      : '<p class="dash-empty">אין שיחות בתקופה הזו.</p>';
    // by agent
    var ag = S.agents.map(function (a) {
      var l = c.filter(function (x) { return x.agent_id === a.id; }), f = funnel(l);
      var w = S.shifts.filter(function (sh) { return sh.agent_id === a.id; }).reduce(function (t, sh) { return t + inside(sh, S.from, S.to); }, 0);
      return '<tr><td>' + esc(a.name) + (S.shifts.some(function (sh) { return sh.agent_id === a.id && !sh.ended_at; }) ? ' <i class="sa-on">במשמרת</i>' : '') + '</td><td>' + hm(w) + '</td><td>' + f.calls + '</td><td>' + (w ? Math.round(f.calls / (w / 36e5) * 10) / 10 : '–') + '</td><td>' + f.dialed + '</td><td>' + f.meetings + '</td><td><b>' + pct(f.meetings, f.dialed) + '</b></td></tr>';
    });
    $('saByAgent').innerHTML = S.agents.length ? '<table class="dash-table"><tr><th>נציג</th><th>שעות</th><th>שיחות</th><th>לשעה</th><th>עסקים</th><th>פגישות</th><th>אחוז הצלחה</th></tr>' + ag.join('') + '</table>' : '<p class="dash-empty">עוד אין נציגים. צור נציג למטה.</p>';
  }

  function paintMeetings() {
    var now = Date.now();
    var m = S.leads.filter(function (l) { return l.status === 'meeting' && l.meeting_at && +new Date(l.meeting_at) > now - 36e5; })
      .sort(function (a, b) { return a.meeting_at < b.meeting_at ? -1 : 1; });
    var more = m.length - 8; m = m.slice(0, 8);
    $('saMeet').innerHTML = m.length ? '<table class="dash-table"><tr><th>מתי</th><th>עסק</th><th>איש קשר</th><th>טלפון</th><th>תחום</th><th>נקבע ע"י</th></tr>' +
      m.map(function (l) { return '<tr><td><b>' + dt(l.meeting_at) + '</b></td><td>' + esc(l.business) + '</td><td>' + esc(l.contact_name || '') + '</td><td dir="ltr"><a href="tel:' + esc(l.phone) + '">' + esc(l.phone) + '</a></td><td>' + esc(label(l.industry)) + '</td><td>' + esc(agentName(l.agent_id)) + '</td></tr>'; }).join('') + '</table>' +
      (more > 0 ? '<p class="sa-hint">ועוד ' + more + ' פגישות. כולן מופיעות ב"מאגר לידים" עם סינון "נקבעה פגישה".</p>' : '')
      : '<p class="dash-empty">אין פגישות קרובות.</p>';
  }

  // ---------- pool ----------
  function fillSelects() {
    var ind = S.scripts.map(function (s) { return '<option value="' + s.industry + '">' + esc(s.label) + '</option>'; }).join('');
    $('saAsInd').innerHTML = '<option value="">כל התחומים</option>' + ind;
    $('saImInd').innerHTML = ind; $('saPaInd').innerHTML = ind;
    var act = S.agents.filter(function (a) { return a.active; }).map(function (a) { return '<option value="' + a.id + '">' + esc(a.name) + '</option>'; }).join('');
    $('saAsAgent').innerHTML = act + '<option value="">החזר למאגר (בלי נציג)</option>';
    $('saBulkAg').innerHTML = act + '<option value="">החזר למאגר</option>';
    var keep = function (id, html) { var v = $(id).value; $(id).innerHTML = html; $(id).value = v; };
    keep('saLind', '<option value="">כל התחומים</option>' + ind);
    keep('saLst', Object.keys(LST).map(function (k) { return '<option value="' + k + '">' + LST[k] + '</option>'; }).join(''));
    keep('saLag', '<option value="">כל הנציגים</option><option value="none">במאגר (לא הוקצו)</option>' + S.agents.map(function (a) { return '<option value="' + a.id + '">' + esc(a.name) + '</option>'; }).join(''));
  }
  function paintPool() {
    var cards = S.scripts.map(function (sc) {
      var l = S.leads.filter(function (x) { return x.industry === sc.industry; });
      var f = funnel(S.allCalls.filter(function (x) { return x.industry === sc.industry; }));
      var cnt = function (fn) { return l.filter(fn).length; };
      return { sc: sc, f: f, total: l.length, free: cnt(function (x) { return !x.agent_id && x.status === 'new' && !x.dnc; }),
        work: cnt(function (x) { return x.agent_id && ['new', 'no_answer', 'callback'].indexOf(x.status) >= 0; }) };
    }).sort(function (a, b) { return b.f.rate - a.f.rate || b.total - a.total; });
    var best = cards[0] && cards[0].f.meetings ? cards[0].sc.industry : '';
    $('saIndCards').innerHTML = cards.map(function (c) {
      var isBest = c.sc.industry === best;
      return '<div class="sa-ind' + (isBest ? ' best' : '') + '" data-ind="' + esc(c.sc.industry) + '" role="button" tabindex="0" aria-label="' + esc(c.sc.label) + ': פירוט הלידים והסיווגים">' + (isBest ? '<i class="sa-ribbon">הכי משתלם</i>' : '') +
        '<div class="sa-ind-h"><b>' + esc(c.sc.label) + '</b><span class="sa-ind-rate">' + (c.f.dialed ? pct(c.f.meetings, c.f.dialed) : '–') + '</span></div>' +
        '<span class="sa-bar' + (isBest ? ' best' : '') + '"><i style="width:' + Math.min(100, Math.round(c.f.rate * 200)) + '%"></i></span>' +
        '<p class="sa-ind-sub">' + (c.f.dialed ? c.f.meetings + ' פגישות מתוך ' + c.f.dialed + ' עסקים שחויגו' : 'עוד לא חויגו עסקים בתחום') + '</p>' +
        '<div class="sa-ind-stats"><span><b>' + c.total + '</b>במאגר</span><span><b>' + c.free + '</b>פנויים</span><span><b>' + c.work + '</b>אצל נציגים</span></div></div>';
    }).join('');
  }

  // ---------- one industry: every lead and every classification ----------
  // Opened from an industry card (pool tab) or an industry row (overview).
  // Shows the leads called in the chosen period with each call the agent
  // logged (when, who, what), and lets the owner correct a classification
  // (public.sales_fix_call keeps the agent's original choice).
  var M = { ind: '', range: 'month', from: null, to: null, calls: [], filter: '', open: null, dirty: false, last: null };
  function mRange(k) {
    M.range = k;
    var now = new Date(), t0 = day0(now);
    if (k === 'all') { M.from = null; M.to = null; }
    else if (k === 'today') { M.from = t0; M.to = new Date(+t0 + 864e5); }
    else if (k === 'yesterday') { M.from = new Date(+t0 - 864e5); M.to = t0; }
    else if (k === 'week') { M.from = new Date(+t0 - t0.getDay() * 864e5); M.to = new Date(+t0 + 864e5); }
    else if (k === 'month') { M.from = new Date(now.getFullYear(), now.getMonth(), 1); M.to = new Date(+t0 + 864e5); }
    else if (k === 'custom') {
      var a = $('saMFrom').value, b = $('saMTo').value;
      if (!a || !b) return false;
      M.from = day0(a); M.to = new Date(+day0(b) + 864e5);
    }
    return true;
  }
  function localInput(iso) {
    if (!iso) return '';
    var d = new Date(iso), p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function leadOf(id) { return S.leads.filter(function (l) { return l.id === id; })[0] || { id: id, business: 'ליד #' + id }; }

  var pop = document.createElement('div');
  pop.className = 'sa-pop st-hide';
  pop.innerHTML = '<div class="sa-pop-box" role="dialog" aria-modal="true" aria-labelledby="saMTitle">' +
    '<div class="sa-pop-h"><div><h3 id="saMTitle"></h3><small id="saMSub"></small></div><button type="button" class="sa-pop-x" id="saMClose" aria-label="סגירה">✕</button></div>' +
    '<div class="sa-range"><div class="sa-seg" id="saMRange">' +
      ['today:היום', 'yesterday:אתמול', 'week:השבוע', 'month:החודש', 'all:הכל', 'custom:תאריכים'].map(function (x) { var p = x.split(':'); return '<button type="button" data-r="' + p[0] + '">' + p[1] + '</button>'; }).join('') +
    '</div><span class="sa-custom st-hide" id="saMCustom"><input type="date" id="saMFrom" aria-label="מתאריך"> עד <input type="date" id="saMTo" aria-label="עד תאריך"></span></div>' +
    '<div class="sa-mkpis" id="saMKpis"></div>' +
    '<div class="sa-mchips" id="saMChips"></div>' +
    '<p class="dash-error" id="saMErr"></p>' +
    '<div class="sa-mlist" id="saMList"></div></div>';
  document.body.appendChild(pop);

  async function openInd(ind) {
    M.ind = ind; M.filter = ''; M.open = null; M.dirty = false; M.last = document.activeElement;
    $('saMTitle').textContent = label(ind);
    mRange(M.range);
    pop.classList.remove('st-hide'); document.body.classList.add('sa-noscroll');
    $('saMClose').focus();
    await mLoad();
  }
  function closeInd() {
    pop.classList.add('st-hide'); document.body.classList.remove('sa-noscroll');
    if (M.last && M.last.focus) M.last.focus();
    if (M.dirty) load();
  }
  async function mLoad() {
    $('saMErr').textContent = '';
    $('saMList').innerHTML = '<p class="dash-empty">טוען…</p>';
    var q = D.sb.from('sales_calls').select('*').eq('industry', M.ind).order('created_at', { ascending: false }).limit(5000);
    if (M.from) q = q.gte('created_at', M.from.toISOString()).lt('created_at', M.to.toISOString());
    var r = await q;
    if (r.error) { $('saMErr').textContent = 'טעינה נכשלה: ' + r.error.message; return; }
    M.calls = (r.data || []).sort(function (x, y) { return x.created_at < y.created_at ? 1 : x.created_at > y.created_at ? -1 : y.id - x.id; });
    mPaint();
  }
  function mPaint() {
    pop.querySelectorAll('#saMRange [data-r]').forEach(function (b) { b.classList.toggle('on', b.dataset.r === M.range); });
    $('saMCustom').classList.toggle('st-hide', M.range !== 'custom');
    $('saMSub').textContent = M.from ? M.from.toLocaleDateString('he-IL') + (+M.to - +M.from > 864e5 ? ' – ' + new Date(+M.to - 1).toLocaleDateString('he-IL') : '') : 'מאז ההתחלה';
    var f = funnel(M.calls);
    $('saMKpis').innerHTML = [['עסקים שחויגו', f.dialed], ['ענו', f.reached], ['פגישות', f.meetings], ['לא מעוניינים', f.ni], ['אחוז הצלחה', pct(f.meetings, f.dialed)], ['שיחות', f.calls]]
      .map(function (k) { return '<div><span>' + k[0] + '</span><b>' + k[1] + '</b></div>'; }).join('');
    // one entry per lead; its classification in this period = its latest call
    var by = {}, order = [];
    M.calls.forEach(function (c) { if (!by[c.lead_id]) { by[c.lead_id] = []; order.push(c.lead_id); } by[c.lead_id].push(c); });
    var cnt = { '': order.length };
    order.forEach(function (id) { var s = by[id][0].status; cnt[s] = (cnt[s] || 0) + 1; });
    $('saMChips').innerHTML = [['', 'כל הלידים'], ['meeting', ST.meeting], ['callback', ST.callback], ['no_answer', ST.no_answer], ['not_interested', ST.not_interested]]
      .map(function (c) { return '<button type="button" data-f="' + c[0] + '" class="' + (M.filter === c[0] ? 'on' : '') + '">' + c[1] + ' <i>' + (cnt[c[0]] || 0) + '</i></button>'; }).join('');
    var ids = order.filter(function (id) { return !M.filter || by[id][0].status === M.filter; });
    $('saMList').innerHTML = ids.length ? ids.map(function (id) {
      var l = leadOf(id), calls = by[id];
      return '<article class="sa-mlead"><div class="sa-mlead-h"><div><b>' + esc(l.business) + '</b>' +
          '<small>' + [l.contact_name, l.city].filter(Boolean).map(esc).join(' · ') + '</small></div>' +
          '<div class="sa-mlead-side">' + (l.phone ? '<a dir="ltr" href="tel:' + esc(l.phone) + '">' + esc(l.phone) + '</a>' : '') +
          '<span>עכשיו: <i class="sa-st ' + (l.status || 'new') + '">' + (ST[l.status] || '') + '</i></span></div></div>' +
        '<ol class="sa-mcalls">' + calls.map(function (c) {
          var extra = c.status === 'meeting' && c.meeting_at ? 'פגישה: ' + dt(c.meeting_at) : c.status === 'callback' && c.callback_at ? 'לחזור: ' + dt(c.callback_at) : '';
          var row = '<li data-c="' + c.id + '"><div class="sa-mcall"><time>' + dt(c.created_at) + '</time><span>' + esc(agentName(c.agent_id)) + '</span>' +
            '<i class="sa-st ' + c.status + '">' + ST[c.status] + '</i>' + (extra ? '<small>' + extra + '</small>' : '') +
            (c.original_status && c.original_status !== c.status ? '<small class="sa-medited">תוקן על ידך (הנציג סימן: ' + ST[c.original_status] + ')</small>' : '') +
            '<button type="button" class="sa-mfix" data-fix="' + c.id + '">שנה סיווג</button></div>' +
            (c.note ? '<p class="sa-mnote">' + esc(c.note) + '</p>' : '');
          if (M.open === c.id) {
            row += '<form class="sa-mform" data-form="' + c.id + '"><select name="st" aria-label="סיווג חדש">' +
              ['no_answer', 'callback', 'meeting', 'not_interested'].map(function (s) { return '<option value="' + s + '"' + (s === c.status ? ' selected' : '') + '>' + ST[s] + '</option>'; }).join('') +
              '</select><input type="datetime-local" name="at" aria-label="תאריך ושעה" value="' + localInput(c.meeting_at || c.callback_at) + '">' +
              '<button class="btn btn-gold" type="submit">שמור</button><button class="btn btn-ghost" type="button" data-cancel>ביטול</button></form>';
          }
          return row + '</li>';
        }).join('') + '</ol></article>';
    }).join('') : '<p class="dash-empty">' + (order.length ? 'אין לידים בסיווג הזה בתקופה הזו.' : 'לא היו שיחות בתחום הזה בתקופה הזו.') + '</p>';
    var fm = pop.querySelector('.sa-mform');
    if (fm) { syncAt(fm); fm.querySelector('select').focus(); }
  }
  // the date field is needed only for "meeting" (required) and "call back"
  function syncAt(fm) {
    var st = fm.st.value, at = fm.at;
    at.classList.toggle('st-hide', st !== 'meeting' && st !== 'callback');
    at.required = st === 'meeting';
  }
  pop.addEventListener('click', function (e) {
    if (e.target === pop || e.target.closest('#saMClose')) return closeInd();
    var r = e.target.closest('#saMRange [data-r]');
    if (r) { if (mRange(r.dataset.r)) mLoad(); else mPaint(); return; }
    var f = e.target.closest('[data-f]');
    if (f) { M.filter = f.dataset.f; mPaint(); return; }
    var fx = e.target.closest('[data-fix]');
    if (fx) { M.open = Number(fx.dataset.fix); mPaint(); return; }
    if (e.target.closest('[data-cancel]')) { M.open = null; mPaint(); }
  });
  pop.addEventListener('change', function (e) {
    if (e.target.name === 'st') syncAt(e.target.form);
    if ((e.target.id === 'saMFrom' || e.target.id === 'saMTo') && mRange('custom')) mLoad();
  });
  pop.addEventListener('submit', async function (e) {
    e.preventDefault();
    var fm = e.target, st = fm.st.value, at = fm.at.value ? new Date(fm.at.value).toISOString() : null;
    if (st === 'meeting' && !at) { $('saMErr').textContent = 'בחר תאריך ושעה לפגישה'; return; }
    var btn = fm.querySelector('[type=submit]'); btn.disabled = true;
    var r = await D.sb.rpc('sales_fix_call', { p_call: Number(fm.dataset.form), p_status: st, p_meeting_at: st === 'meeting' ? at : null, p_callback_at: st === 'callback' ? at : null });
    if (r.error) { btn.disabled = false; $('saMErr').textContent = 'השינוי לא נשמר: ' + r.error.message; return; }
    M.dirty = true; M.open = null;
    // the lead's current status may have changed too
    var lr = await D.sb.from('sales_leads').select('*').eq('id', (M.calls.filter(function (c) { return c.id === Number(fm.dataset.form); })[0] || {}).lead_id).maybeSingle();
    if (lr.data) S.leads = S.leads.map(function (l) { return l.id === lr.data.id ? lr.data : l; });
    await mLoad();
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !pop.classList.contains('st-hide')) closeInd(); });
  function indClick(e) {
    var el = e.target.closest('[data-ind]');
    if (!el || (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ')) return;
    e.preventDefault(); openInd(el.dataset.ind);
  }
  ['saIndCards', 'saByInd'].forEach(function (id) { $(id).addEventListener('click', indClick); $(id).addEventListener('keydown', indClick); });

  // ---------- all leads: search, filter, move between agents ----------
  var LP = { page: 0, size: 25, sel: {} };
  var LST = { '': 'כל הסטטוסים', new: 'חדש', no_answer: 'אין מענה', callback: 'לחזור', meeting: 'נקבעה פגישה', not_interested: 'לא מעוניין', dnc: 'חסום' };
  function leadRows() {
    var q = $('saLq').value.trim().toLowerCase(), ind = $('saLind').value, st = $('saLst').value, ag = $('saLag').value;
    return S.leads.filter(function (l) {
      if (ind && l.industry !== ind) return false;
      if (st === 'dnc' ? !l.dnc : st && l.status !== st) return false;
      if (ag === 'none' ? l.agent_id : ag && String(l.agent_id) !== ag) return false;
      return !q || [l.business, l.contact_name, l.phone, l.city].join(' ').toLowerCase().indexOf(q) >= 0;
    });
  }
  function paintLeads() {
    var rows = leadRows(), pages = Math.max(1, Math.ceil(rows.length / LP.size));
    if (LP.page >= pages) LP.page = pages - 1;
    var view = rows.slice(LP.page * LP.size, LP.page * LP.size + LP.size);
    $('saLeadCount').textContent = rows.length + ' מתוך ' + S.leads.length;
    $('saLeads').innerHTML = view.length ? '<table class="dash-table sa-leadtable"><tr><th><input type="checkbox" id="saLall" aria-label="בחר הכל"></th><th>עסק</th><th>טלפון</th><th>עיר</th><th>תחום</th><th>סטטוס</th><th>נציג</th><th>ניסיונות</th><th>שיחה אחרונה</th></tr>' +
      view.map(function (l) {
        var stc = l.dnc && l.status !== 'not_interested' ? 'dnc' : l.status;
        return '<tr data-l="' + l.id + '"><td><input type="checkbox" class="sa-lsel"' + (LP.sel[l.id] ? ' checked' : '') + ' aria-label="בחר"></td>' +
          '<td><b>' + esc(l.business) + '</b>' + (l.contact_name ? '<small>' + esc(l.contact_name) + '</small>' : '') + (l.notes ? '<details><summary>הערות</summary><pre>' + esc(l.notes) + '</pre></details>' : '') + '</td>' +
          '<td dir="ltr"><a href="tel:' + esc(l.phone) + '">' + esc(l.phone) + '</a></td><td>' + esc(l.city || '') + '</td><td>' + esc(label(l.industry)) + '</td>' +
          '<td><i class="sa-st ' + stc + '">' + (stc === 'dnc' ? 'חסום' : ST[l.status]) + '</i>' + (l.status === 'meeting' && l.meeting_at ? '<small>' + dt(l.meeting_at) + '</small>' : l.status === 'callback' && l.callback_at ? '<small>' + dt(l.callback_at) + '</small>' : '') + '</td>' +
          '<td>' + (l.agent_id ? esc(agentName(l.agent_id)) : '<span class="sa-muted">במאגר</span>') + '</td><td>' + (l.attempts || 0) + '</td><td>' + (l.last_call_at ? dt(l.last_call_at) : '<span class="sa-muted">–</span>') + '</td></tr>';
      }).join('') + '</table>' : '<p class="dash-empty">' + (S.leads.length ? 'אין לידים שמתאימים לסינון.' : 'המאגר ריק. ייבא עסקים מגוגל מפות או הדבק רשימה.') + '</p>';
    $('saPager').innerHTML = pages > 1 ? '<button type="button" data-pg="-1"' + (LP.page ? '' : ' disabled') + '>→ הקודם</button><span>עמוד ' + (LP.page + 1) + ' מתוך ' + pages + '</span><button type="button" data-pg="1"' + (LP.page < pages - 1 ? '' : ' disabled') + '>הבא ←</button>' : '';
    paintBulk();
  }
  function paintBulk() {
    var n = Object.keys(LP.sel).length;
    $('saBulk').classList.toggle('st-hide', !n);
    $('saBulkN').textContent = n + ' נבחרו · להעביר ל:';
  }
  ['saLq', 'saLind', 'saLst', 'saLag'].forEach(function (id) { $(id).addEventListener(id === 'saLq' ? 'input' : 'change', function () { LP.page = 0; paintLeads(); }); });
  $('saPager').addEventListener('click', function (e) { var b = e.target.closest('[data-pg]'); if (b) { LP.page += Number(b.dataset.pg); paintLeads(); } });
  $('saLeads').addEventListener('change', function (e) {
    if (e.target.id === 'saLall') {
      var on = e.target.checked;
      $('saLeads').querySelectorAll('tr[data-l]').forEach(function (tr) { if (on) LP.sel[tr.dataset.l] = 1; else delete LP.sel[tr.dataset.l]; tr.querySelector('.sa-lsel').checked = on; });
    } else if (e.target.classList.contains('sa-lsel')) {
      var id = e.target.closest('tr').dataset.l; if (e.target.checked) LP.sel[id] = 1; else delete LP.sel[id];
    }
    paintBulk();
  });
  $('saBulkGo').addEventListener('click', async function () {
    var ids = Object.keys(LP.sel).map(Number); if (!ids.length) return;
    try { var r = await call({ action: 'assign', agent_id: $('saBulkAg').value || null, lead_ids: ids }); LP.sel = {}; alertMsg('הועברו ' + r.assigned + ' לידים'); await load(); }
    catch (x) { err(x.message); }
  });

  $('saAssign').addEventListener('submit', async function (e) {
    e.preventDefault(); err('');
    try {
      var r = await call({ action: 'assign', agent_id: $('saAsAgent').value || null, industry: $('saAsInd').value, city: $('saAsCity').value.trim(), count: Number($('saAsCount').value) });
      alertMsg('הוקצו ' + r.assigned + ' לידים'); await load();
    } catch (x) { err(x.message); }
  });
  $('saImport').addEventListener('submit', async function (e) {
    e.preventDefault(); err('');
    var b = this.querySelector('button'); b.disabled = true; $('saImRes').textContent = 'מחפש בגוגל...';
    try {
      var r = await call({ action: 'import_places', industry: $('saImInd').value, city: $('saImCity').value.trim() });
      $('saImRes').textContent = '"' + r.query + '": נמצאו ' + r.found + ', עם טלפון ' + r.with_phone + ', נוספו ' + r.added + ' חדשים.';
      await load();
    } catch (x) { $('saImRes').textContent = ''; err(x.message); }
    b.disabled = false;
  });
  $('saPaste').addEventListener('submit', async function (e) {
    e.preventDefault(); err('');
    var rows = $('saPaText').value.split('\n').map(function (l) { var p = l.split(/[,\t]/).map(function (x) { return x.trim(); }); return { business: p[0], phone: p[1], city: p[2], contact_name: p[3] }; }).filter(function (r) { return r.business && r.phone; });
    if (!rows.length) return err('לא מצאתי שורות בפורמט: שם העסק, טלפון, עיר');
    try { var r = await call({ action: 'add_leads', industry: $('saPaInd').value, rows: rows }); $('saPaRes').textContent = 'נוספו ' + r.added + ' מתוך ' + r.received; $('saPaText').value = ''; await load(); }
    catch (x) { err(x.message); }
  });

  // ---------- agents ----------
  function paintAgents() {
    $('saAgents').innerHTML = S.agents.length ? '<table class="dash-table"><tr><th>שם</th><th>שם משתמש</th><th>₪ לשעה</th><th>פעיל</th><th>לידים פתוחים</th><th>אחוז הצלחה</th><th></th></tr>' +
      S.agents.map(function (a) {
        var open = S.leads.filter(function (l) { return l.agent_id === a.id && ['new', 'no_answer', 'callback'].indexOf(l.status) >= 0; }).length;
        var f = funnel(S.allCalls.filter(function (x) { return x.agent_id === a.id; }));
        return '<tr data-a="' + a.id + '"><td><span class="sa-avatar">' + esc(String(a.name).trim().charAt(0)) + '</span>' + esc(a.name) + '</td><td dir="ltr">' + esc(a.username) + '</td>' +
          '<td><input type="number" class="sa-rate" value="' + a.hourly_rate + '" min="0" aria-label="תעריף"></td>' +
          '<td><input type="checkbox" class="sa-active"' + (a.active ? ' checked' : '') + ' aria-label="פעיל"></td><td>' + open + '</td><td><b>' + (f.dialed ? pct(f.meetings, f.dialed) : '–') + '</b> <small class="sa-muted">' + f.meetings + '/' + f.dialed + '</small></td>' +
          '<td><button type="button" class="st-mini sa-pw">סיסמה חדשה</button></td></tr>';
      }).join('') + '</table>' : '<p class="dash-empty">עוד אין נציגים. צור את הראשון למטה.</p>';
  }
  $('saAgents').addEventListener('change', async function (e) {
    var tr = e.target.closest('tr[data-a]'); if (!tr) return;
    var id = Number(tr.dataset.a), patch = e.target.classList.contains('sa-rate') ? { hourly_rate: Number(e.target.value) } : e.target.classList.contains('sa-active') ? { active: e.target.checked } : null;
    if (!patch) return;
    var q = await D.sb.from('sales_agents').update(patch).eq('id', id);
    if (q.error) err(q.error.message); else { alertMsg('נשמר'); await load(); }
  });
  $('saAgents').addEventListener('click', async function (e) {
    if (!e.target.classList.contains('sa-pw')) return;
    var tr = e.target.closest('tr[data-a]'), cell = e.target.parentNode;
    cell.innerHTML = '<input type="password" class="sa-newpw" placeholder="8+ תווים" dir="ltr" autocomplete="new-password" aria-label="סיסמה חדשה"><button type="button" class="st-mini sa-pwok">שמור</button>';
    cell.querySelector('.sa-pwok').addEventListener('click', async function () {
      try { await call({ action: 'set_password', agent_id: Number(tr.dataset.a), password: cell.querySelector('.sa-newpw').value }); alertMsg('הסיסמה עודכנה'); paintAgents(); }
      catch (x) { err(x.message); }
    });
  });
  $('saNewAgent').addEventListener('submit', async function (e) {
    e.preventDefault(); err('');
    try {
      await call({ action: 'create_agent', name: $('naName').value.trim(), username: $('naUser').value.trim().toLowerCase(), password: $('naPass').value, hourly_rate: $('naRate').value });
      ['naName', 'naUser', 'naPass'].forEach(function (id) { $(id).value = ''; });
      alertMsg('הנציג נוצר'); await load();
    } catch (x) { err(x.message); }
  });

  // ---------- payroll ----------
  var pay = [];
  async function loadPay() {
    var m = $('saMonth').value; if (!m) { var n = new Date(); m = n.getFullYear() + '-' + String(n.getMonth() + 1).padStart(2, '0'); $('saMonth').value = m; }
    var p = m.split('-'), from = new Date(+p[0], +p[1] - 1, 1), to = new Date(+p[0], +p[1], 1);
    var r = await D.sb.from('sales_shifts').select('*').lt('started_at', to.toISOString()).or('ended_at.is.null,ended_at.gte.' + from.toISOString()).order('started_at').limit(5000);
    var sh = r.data || [];
    pay = S.agents.map(function (a) {
      var mine = sh.filter(function (x) { return x.agent_id === a.id; }), ms = mine.reduce(function (t, x) { return t + inside(x, from, to); }, 0);
      return { a: a, shifts: mine, ms: ms, total: Math.round(hours(ms) * a.hourly_rate * 100) / 100 };
    });
    $('saPay').innerHTML = pay.length ? '<table class="dash-table"><tr><th>נציג</th><th>משמרות</th><th>שעות</th><th>₪ לשעה</th><th>לתשלום</th></tr>' +
      pay.map(function (x, i) {
        return '<tr><td>' + esc(x.a.name) + '</td><td>' + x.shifts.length + '</td><td>' + hm(x.ms) + ' <small>(' + hours(x.ms) + ')</small></td><td>' + x.a.hourly_rate + '</td><td><b>' + x.total.toLocaleString('he-IL') + ' ₪</b></td></tr>' +
          (x.shifts.length ? '<tr class="sa-sub"><td colspan="5"><details><summary>פירוט המשמרות</summary><table class="dash-table">' + x.shifts.map(function (s) {
            return '<tr><td>' + new Date(s.started_at).toLocaleDateString('he-IL', { weekday: 'short', day: 'numeric', month: 'numeric' }) + '</td><td>' + new Date(s.started_at).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }) + '</td><td>' +
              (s.ended_at ? new Date(s.ended_at).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }) : '<i class="sa-on">פתוחה</i> <button type="button" class="st-mini" data-close="' + s.id + '">סגור עכשיו</button>') + '</td><td>' + hm(inside(s, from, to)) + '</td></tr>';
          }).join('') + '</table></details></td></tr>' : '');
      }).join('') + '</table>' : '<p class="dash-empty">אין נציגים.</p>';
  }
  $('saMonth').addEventListener('change', loadPay);
  $('saPay').addEventListener('click', async function (e) {
    var id = e.target.dataset && e.target.dataset.close; if (!id) return;
    var q = await D.sb.from('sales_shifts').update({ ended_at: new Date().toISOString() }).eq('id', Number(id));
    if (q.error) err(q.error.message); else loadPay();
  });
  $('saCsv').addEventListener('click', function () {
    var lines = [['נציג', 'תאריך', 'כניסה', 'יציאה', 'שעות', 'תעריף', 'סכום'].join(',')];
    pay.forEach(function (x) {
      x.shifts.forEach(function (s) {
        var h = hours(inside(s, new Date(0), new Date(8.64e15)));
        lines.push([x.a.name, new Date(s.started_at).toLocaleDateString('he-IL'), new Date(s.started_at).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }),
          s.ended_at ? new Date(s.ended_at).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }) : 'פתוחה', h, x.a.hourly_rate, Math.round(h * x.a.hourly_rate * 100) / 100].join(','));
      });
      lines.push([x.a.name + ' - סה"כ', '', '', '', hours(x.ms), x.a.hourly_rate, x.total].join(','));
    });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' }));
    a.download = 'נוכחות ושכר ' + $('saMonth').value + '.csv'; document.body.appendChild(a); a.click(); setTimeout(function () { a.remove(); }, 500);
  });

  // ---------- range ----------
  $('saRange').addEventListener('click', function (e) {
    var b = e.target.closest('[data-r]'); if (!b) return;
    app.querySelectorAll('[data-r]').forEach(function (x) { x.classList.toggle('on', x === b); });
    $('saCustom').classList.toggle('st-hide', b.dataset.r !== 'custom');
    if (b.dataset.r === 'custom') { if (!$('saFrom').value) { $('saFrom').value = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10); $('saTo').value = new Date().toISOString().slice(0, 10); } }
    setRange(b.dataset.r); loadPeriod();
  });
  ['saFrom', 'saTo'].forEach(function (id) { $(id).addEventListener('change', function () { setRange('custom'); loadPeriod(); }); });
  app.querySelector('[data-r="today"]').classList.add('on');

  function alertMsg(m) { var d = document.createElement('div'); d.className = 'sa-toast'; d.textContent = m; document.body.appendChild(d); setTimeout(function () { d.remove(); }, 2200); }

  window.ALSales = { load: function () { return load().catch(function (x) { err(x.message); }); } };
  D.sb.auth.getSession().then(function (r) { if (r.data && r.data.session) window.ALSales.load(); });
})();
