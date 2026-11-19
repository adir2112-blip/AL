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

  app.innerHTML =
    '<div class="sa-bar"><div class="lead-filters" id="saRange">' +
      ['today:היום', 'yesterday:אתמול', 'week:השבוע', 'month:החודש', 'custom:תאריכים'].map(function (x) { var p = x.split(':'); return '<button type="button" data-r="' + p[0] + '">' + p[1] + '</button>'; }).join('') +
      '<span class="sa-custom st-hide" id="saCustom"><input type="date" id="saFrom" aria-label="מתאריך"> עד <input type="date" id="saTo" aria-label="עד תאריך"></span></div>' +
      '<a class="btn btn-ghost" href="sales.html" target="_blank" rel="noopener" style="padding:7px 14px;font-size:.84rem">↗ דף הנציגים</a></div>' +
    '<p class="dash-error" id="saErr"></p>' +
    '<div class="sa-kpis" id="saKpis"></div>' +
    '<div class="sa-grid"><div class="sa-card"><h3>לפי תחום <small>איפה להשקיע</small></h3><div id="saByInd"></div></div>' +
      '<div class="sa-card"><h3>לפי נציג</h3><div id="saByAgent"></div></div></div>' +
    '<div class="sa-card"><h3>פגישות קרובות</h3><div id="saMeet"></div></div>' +
    '<div class="sa-card"><h3>מאגר הלידים</h3><div id="saPool"></div>' +
      '<div class="sa-forms">' +
        '<form id="saAssign" class="sa-form"><b>הקצאה לנציג</b>' +
          '<select id="saAsAgent" aria-label="נציג"></select><select id="saAsInd" aria-label="תחום"></select>' +
          '<input id="saAsCity" placeholder="עיר (לא חובה)" aria-label="עיר"><input id="saAsCount" type="number" min="1" max="500" value="30" aria-label="כמה">' +
          '<button class="btn btn-gold" type="submit">הקצה</button></form>' +
        '<form id="saImport" class="sa-form"><b>ייבוא מגוגל מפות</b>' +
          '<select id="saImInd" aria-label="תחום"></select><input id="saImCity" placeholder="עיר, למשל חולון" aria-label="עיר" required>' +
          '<button class="btn btn-gold" type="submit">חפש וייבא (עד 60)</button><small id="saImRes"></small></form>' +
        '<form id="saPaste" class="sa-form"><b>הדבקת רשימה</b><select id="saPaInd" aria-label="תחום"></select>' +
          '<textarea id="saPaText" rows="3" placeholder="שורה לכל עסק: שם העסק, טלפון, עיר, איש קשר"></textarea>' +
          '<button class="btn btn-ghost" type="submit">הוסף למאגר</button><small id="saPaRes"></small></form>' +
      '</div></div>' +
    '<div class="sa-card"><h3>נציגים</h3><div id="saAgents"></div>' +
      '<form id="saNewAgent" class="sa-form sa-inline"><b>נציג חדש</b><input id="naName" placeholder="שם מלא" required aria-label="שם">' +
        '<input id="naUser" placeholder="שם משתמש (אנגלית)" dir="ltr" autocapitalize="none" required aria-label="שם משתמש">' +
        '<input id="naPass" type="password" placeholder="סיסמה (8+ תווים)" dir="ltr" autocomplete="new-password" required aria-label="סיסמה">' +
        '<input id="naRate" type="number" min="0" step="1" value="50" aria-label="תעריף לשעה"> ₪/שעה' +
        '<button class="btn btn-gold" type="submit">צור נציג</button></form></div>' +
    '<div class="sa-card"><h3>דוח נוכחות ושכר</h3><div class="sa-inline"><input type="month" id="saMonth" aria-label="חודש"><button type="button" class="btn btn-ghost" id="saCsv">⬇ ייצוא לאקסל (CSV)</button></div><div id="saPay"></div></div>';

  // ---------- load ----------
  async function load() {
    err('');
    var r = await Promise.all([
      D.sb.from('sales_agents').select('*').order('name'),
      D.sb.from('sales_scripts').select('industry,label,sort,active').order('sort'),
      D.sb.from('sales_leads').select('id,industry,city,agent_id,status,dnc,meeting_at,business,contact_name,phone').limit(20000)
    ]);
    var bad = r.filter(function (x) { return x.error; })[0];
    if (bad) return err('טעינה נכשלה: ' + bad.error.message);
    S.agents = r[0].data || []; S.scripts = r[1].data || []; S.leads = r[2].data || [];
    S.loaded = true;
    fillSelects(); paintPool(); paintAgents(); paintMeetings();
    await loadPeriod(); await loadPay();
  }
  async function loadPeriod() {
    if (!S.from) setRange(S.range);
    var r = await Promise.all([
      D.sb.from('sales_calls').select('id,created_at,agent_id,industry,status').gte('created_at', S.from.toISOString()).lt('created_at', S.to.toISOString()).limit(20000),
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
  function paintStats() {
    var c = S.calls, n = c.length, by = function (s) { return c.filter(function (x) { return x.status === s; }).length; };
    var work = S.shifts.reduce(function (t, sh) { return t + inside(sh, S.from, S.to); }, 0);
    $('saKpis').innerHTML = [
      ['שיחות', n, ''], ['נקבעו פגישות', by('meeting'), pct(by('meeting'), n) + ' מהשיחות'], ['אין מענה', by('no_answer'), pct(by('no_answer'), n)],
      ['לחזור', by('callback'), pct(by('callback'), n)], ['לא מעוניין', by('not_interested'), pct(by('not_interested'), n)],
      ['שעות עבודה', hm(work), work ? Math.round(n / (work / 36e5) * 10) / 10 + ' שיחות לשעה' : '']
    ].map(function (k, i) { return '<div class="sa-kpi' + (i === 1 ? ' hi' : '') + '"><span>' + k[0] + '</span><b>' + k[1] + '</b><small>' + k[2] + '</small></div>'; }).join('');
    // by industry, best meeting rate first
    var inds = {};
    c.forEach(function (x) { (inds[x.industry] = inds[x.industry] || []).push(x); });
    var rows = Object.keys(inds).map(function (k) {
      var l = inds[k], m = l.filter(function (x) { return x.status === 'meeting'; }).length;
      return { k: k, n: l.length, m: m, rate: l.length ? m / l.length : 0, na: l.filter(function (x) { return x.status === 'no_answer'; }).length, ni: l.filter(function (x) { return x.status === 'not_interested'; }).length };
    }).sort(function (a, b) { return b.rate - a.rate || b.n - a.n; });
    $('saByInd').innerHTML = rows.length ? '<table class="dash-table"><tr><th>תחום</th><th>שיחות</th><th>פגישות</th><th>% פגישות</th><th>אין מענה</th><th>לא מעוניין</th></tr>' +
      rows.map(function (r, i) { return '<tr' + (i === 0 && r.m ? ' class="sa-best"' : '') + '><td>' + esc(label(r.k)) + '</td><td>' + r.n + '</td><td>' + r.m + '</td><td><b>' + pct(r.m, r.n) + '</b></td><td>' + pct(r.na, r.n) + '</td><td>' + pct(r.ni, r.n) + '</td></tr>'; }).join('') + '</table>'
      : '<p class="dash-empty">אין שיחות בתקופה הזו.</p>';
    // by agent
    var ag = S.agents.map(function (a) {
      var l = c.filter(function (x) { return x.agent_id === a.id; }), w = S.shifts.filter(function (sh) { return sh.agent_id === a.id; }).reduce(function (t, sh) { return t + inside(sh, S.from, S.to); }, 0);
      var m = l.filter(function (x) { return x.status === 'meeting'; }).length;
      return '<tr><td>' + esc(a.name) + (S.shifts.some(function (sh) { return sh.agent_id === a.id && !sh.ended_at; }) ? ' <i class="sa-on">במשמרת</i>' : '') + '</td><td>' + hm(w) + '</td><td>' + l.length + '</td><td>' + (w ? Math.round(l.length / (w / 36e5) * 10) / 10 : '–') + '</td><td>' + m + '</td><td><b>' + pct(m, l.length) + '</b></td></tr>';
    });
    $('saByAgent').innerHTML = S.agents.length ? '<table class="dash-table"><tr><th>נציג</th><th>שעות</th><th>שיחות</th><th>לשעה</th><th>פגישות</th><th>%</th></tr>' + ag.join('') + '</table>' : '<p class="dash-empty">עוד אין נציגים. צור נציג למטה.</p>';
  }

  function paintMeetings() {
    var now = Date.now();
    var m = S.leads.filter(function (l) { return l.status === 'meeting' && l.meeting_at && +new Date(l.meeting_at) > now - 36e5; })
      .sort(function (a, b) { return a.meeting_at < b.meeting_at ? -1 : 1; });
    $('saMeet').innerHTML = m.length ? '<table class="dash-table"><tr><th>מתי</th><th>עסק</th><th>איש קשר</th><th>טלפון</th><th>תחום</th><th>נקבע ע"י</th></tr>' +
      m.map(function (l) { return '<tr><td><b>' + dt(l.meeting_at) + '</b></td><td>' + esc(l.business) + '</td><td>' + esc(l.contact_name || '') + '</td><td dir="ltr"><a href="tel:' + esc(l.phone) + '">' + esc(l.phone) + '</a></td><td>' + esc(label(l.industry)) + '</td><td>' + esc(agentName(l.agent_id)) + '</td></tr>'; }).join('') + '</table>'
      : '<p class="dash-empty">אין פגישות קרובות.</p>';
  }

  // ---------- pool ----------
  function fillSelects() {
    var ind = S.scripts.map(function (s) { return '<option value="' + s.industry + '">' + esc(s.label) + '</option>'; }).join('');
    $('saAsInd').innerHTML = '<option value="">כל התחומים</option>' + ind;
    $('saImInd').innerHTML = ind; $('saPaInd').innerHTML = ind;
    $('saAsAgent').innerHTML = S.agents.filter(function (a) { return a.active; }).map(function (a) { return '<option value="' + a.id + '">' + esc(a.name) + '</option>'; }).join('') + '<option value="">החזר למאגר (בלי נציג)</option>';
  }
  function paintPool() {
    var rows = S.scripts.map(function (s) {
      var l = S.leads.filter(function (x) { return x.industry === s.industry; });
      var cnt = function (f) { return l.filter(f).length; };
      return '<tr><td>' + esc(s.label) + '</td><td>' + l.length + '</td><td><b>' + cnt(function (x) { return !x.agent_id && x.status === 'new' && !x.dnc; }) + '</b></td><td>' + cnt(function (x) { return x.agent_id && ['new', 'no_answer', 'callback'].indexOf(x.status) >= 0; }) + '</td><td>' + cnt(function (x) { return x.status === 'meeting'; }) + '</td><td>' + cnt(function (x) { return x.status === 'not_interested'; }) + '</td></tr>';
    });
    $('saPool').innerHTML = '<table class="dash-table"><tr><th>תחום</th><th>סה"כ</th><th>פנויים להקצאה</th><th>אצל נציגים</th><th>פגישות</th><th>לא מעוניינים</th></tr>' + rows.join('') + '</table>';
  }
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
    $('saAgents').innerHTML = S.agents.length ? '<table class="dash-table"><tr><th>שם</th><th>שם משתמש</th><th>₪ לשעה</th><th>פעיל</th><th>לידים פתוחים</th><th></th></tr>' +
      S.agents.map(function (a) {
        var open = S.leads.filter(function (l) { return l.agent_id === a.id && ['new', 'no_answer', 'callback'].indexOf(l.status) >= 0; }).length;
        return '<tr data-a="' + a.id + '"><td>' + esc(a.name) + '</td><td dir="ltr">' + esc(a.username) + '</td>' +
          '<td><input type="number" class="sa-rate" value="' + a.hourly_rate + '" min="0" aria-label="תעריף"></td>' +
          '<td><input type="checkbox" class="sa-active"' + (a.active ? ' checked' : '') + ' aria-label="פעיל"></td><td>' + open + '</td>' +
          '<td><button type="button" class="st-mini sa-pw">סיסמה חדשה</button></td></tr>';
      }).join('') + '</table><p class="sa-hint">הנציג נכנס ב-<b dir="ltr">al-systems.co.il/sales.html</b> עם שם המשתמש והסיסמה.</p>' : '';
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
