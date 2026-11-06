// ═══ DEMO MODE: in-browser mock of Firebase / EmailJS / WhatsApp API ═══
// Nothing leaves the browser. Data lives in sessionStorage for this tab only.
(function () {
  var DB_KEY = 'shiftsync_demo_db_v1';
  var DAYS = ['ראשון','שני','שלישי','רביעי','חמישי','שישי'];

  function week(over) {
    var c = {};
    DAYS.forEach(function (d) { c[d] = { type: 'none', time: '', note: '' }; });
    Object.keys(over || {}).forEach(function (d) { c[d] = over[d]; });
    return c;
  }
  function agent(id, fn, ln, activity, opts) {
    opts = opts || {};
    return {
      key: 'demo_' + id, fullName: fn + ' ' + ln, firstName: fn, lastName: ln,
      phone: '', activity: activity, allowedActivity: activity, movementType: null,
      email: id + '@demo-company.co.il', pin: '0000',
      joinDate: '01/09/2026', submitted: !!opts.submitted, approved: !!opts.approved,
      submittedAt: opts.submitted ? '05/11/26, 10:12' : '', submittedAtTs: opts.submitted ? Date.now() - 3600e3 : 0,
      constraints: week(opts.c)
    };
  }
  function seed() {
    var S = 'מוקד מכירות', T = 'תמיכה טכנית';
    var list = [
      agent('dana', 'דנה', 'כהן', S),
      agent('yossi', 'יוסי', 'לוי', S, { submitted: true, approved: true, c: { 'שני': { type: 'off', time: '', note: 'יום הולדת לבן' } } }),
      agent('michal', 'מיכל', 'אברהם', S, { submitted: true, approved: true, c: { 'רביעי': { type: 'early', time: '15:00', note: 'לימודים' } } }),
      agent('omer', 'עומר', 'פרץ', S, { submitted: true, approved: true }),
      agent('noa', 'נועה', 'מזרחי', S, { submitted: true, approved: false, c: { 'חמישי': { type: 'late', time: '11:00', note: 'תור לרופא' } } }),
      agent('avi', 'אבי', 'ביטון', S, { submitted: true, approved: true, c: { 'שישי': { type: 'off', time: '', note: 'אירוע משפחתי' } } }),
      agent('shira', 'שירה', 'גולן', T, { submitted: true, approved: true }),
      agent('itay', 'איתי', 'שושן', T, { submitted: true, approved: true, c: { 'ראשון': { type: 'late', time: '10:00', note: '' } } }),
      agent('maya', 'מאיה', 'דהן', T, { submitted: false }),
      agent('ron', 'רון', 'אוחיון', T, { submitted: true, approved: true })
    ];
    var agents = {};
    list.forEach(function (a) { agents[a.key] = a; });
    return {
      agents: agents,
      managers: { demo_manager: { email: 'manager@demo.co.il', password: '0000', name: 'מנהלת המוקד', isAdmin: true, activities: [] } },
      customActivities: null, logs: null, scheduleHistory: null, waReminderConfig: null,
      lastAutoReset: Date.now()
    };
  }

  var db;
  try { db = JSON.parse(sessionStorage.getItem(DB_KEY) || 'null'); } catch (e) { db = null; }
  if (!db) db = seed();
  function persist() { try { sessionStorage.setItem(DB_KEY, JSON.stringify(db)); } catch (e) {} }
  persist();

  function walk(parts, create) {
    var node = db;
    for (var i = 0; i < parts.length - 1; i++) {
      if (node[parts[i]] == null || typeof node[parts[i]] !== 'object') {
        if (!create) return null;
        node[parts[i]] = {};
      }
      node = node[parts[i]];
    }
    return node;
  }
  function resolveSv(v) {
    if (v && typeof v === 'object' && v['.sv'] === 'timestamp') return Date.now();
    return v;
  }
  function respond(body, status) {
    return Promise.resolve(new Response(JSON.stringify(body), { status: status || 200, headers: { 'Content-Type': 'application/json' } }));
  }

  var realFetch = window.fetch.bind(window);
  window.fetch = function (url, opts) {
    var u = String(url && url.url ? url.url : url);
    if (u.indexOf('securetoken.googleapis.com') >= 0 || u.indexOf('identitytoolkit.googleapis.com') >= 0) {
      return respond({ idToken: 'demo', id_token: 'demo', refreshToken: 'demo', refresh_token: 'demo' });
    }
    if (u.indexOf('https://demo.local') !== 0) return realFetch(url, opts);
    if (u.indexOf('https://demo.local/wa') === 0) return respond({ ok: true, sent: 0, demo: true });

    var method = ((opts && opts.method) || 'GET').toUpperCase();
    var p = u.slice('https://demo.local/'.length).split('?')[0].replace(/\.json$/, '');
    var parts = p.split('/').filter(Boolean).map(decodeURIComponent);
    var body = null;
    if (opts && opts.body) { try { body = JSON.parse(opts.body); } catch (e) { body = null; } }

    if (method === 'GET') {
      var node = db;
      for (var i = 0; i < parts.length; i++) { node = node == null ? null : node[parts[i]]; }
      return respond(node == null ? null : JSON.parse(JSON.stringify(node)));
    }
    var parent = walk(parts, true), leaf = parts[parts.length - 1];
    if (method === 'PUT') { parent[leaf] = resolveSv(body); persist(); return respond(parent[leaf]); }
    if (method === 'PATCH') {
      if (parent[leaf] == null || typeof parent[leaf] !== 'object') parent[leaf] = {};
      Object.keys(body || {}).forEach(function (k) { parent[leaf][k] = resolveSv(body[k]); });
      persist(); return respond(body);
    }
    if (method === 'POST') {
      if (parent[leaf] == null || typeof parent[leaf] !== 'object') parent[leaf] = {};
      var id = '-demo' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      parent[leaf][id] = resolveSv(body); persist(); return respond({ name: id });
    }
    if (method === 'DELETE') { if (parent) delete parent[leaf]; persist(); return respond(null); }
    return respond(null);
  };

  // EmailJS stand-in: collects mails for the in-page demo inbox
  window.DEMO_MAILS = [];
  window.emailjs = {
    init: function () {},
    send: function (service, template, params) {
      window.DEMO_MAILS.push(params);
      return Promise.resolve({ status: 200, text: 'OK (demo)' });
    }
  };
  window.DEMO_RESET = function () {
    try { sessionStorage.removeItem(DB_KEY); sessionStorage.removeItem('shiftsync_demo_step'); sessionStorage.removeItem('shiftsync_demo_agent'); } catch (e) {}
    location.reload();
  };
})();
