/* Studio AL panel (dashboard.html#studio).
   The owner picks a task, writes what he needs and attaches files; the studio
   edge function has Claude write the content and this page turns it into the
   finished PowerPoint / Word / PDF with js/studio-render.js.
   Needs window.ALDash = {sb, SUPABASE_URL, authHeader} from dashboard.html. */
(function () {
  'use strict';
  var D = window.ALDash, R = window.ALStudioRender;
  var app = document.getElementById('studioApp');
  if (!D || !R || !app) return;

  var PPTX_LIB = 'https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/dist/pptxgen.bundle.js';
  var JSZIP_LIB = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
  var BANNER = new URL('assets/logo-banner.png', location.href).href;
  var MARK = 'assets/studio-mark.png';
  var MAX_BYTES = 18 * 1024 * 1024;

  var ICO = {
    deck_upgrade: '<path d="M12 3l2.4 4.9 5.4.8-3.9 3.8.9 5.4L12 15.4 7.2 17.9l.9-5.4L4.2 8.7l5.4-.8z"/>',
    deck_new: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4M7 12l3-3 2 2 4-4"/>',
    deck_editable: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
    doc: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>',
    analyze: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3M8 11h6M11 8v6"/>',
    research: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
    free: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>'
  };
  var TASKS = [
    { k: 'deck_upgrade', t: 'שדרוג מצגת', d: 'מצגת קיימת ← עיצוב מקצועי', accept: '.pptx,.pdf,image/*', ph: 'העלה את המצגת. מה לשפר? (למשל: להוסיף גרפים, לקצר את הטקסט, להוסיף שקף סיכום)', needFile: true },
    { k: 'deck_new', t: 'מצגת חדשה', d: 'מאפס, לפי נושא או טקסט', accept: '.pptx,.docx,.pdf,.txt,.csv,image/*', ph: 'על מה המצגת? למי היא מיועדת? אפשר להדביק כאן נתונים או לצרף קבצים.\nלמשל: מצגת סיכום חודשי למנהלי המוקד, עם הנתונים מהקובץ המצורף' },
    { k: 'deck_editable', t: 'הפיכה לעריכה', d: 'תמונות / PDF ← מצגת שאפשר לערוך', accept: 'image/*,.pdf', ph: 'העלה צילומי מסך או PDF של המצגת. הכל יועתק למצגת PowerPoint שאפשר לערוך.', needFile: true },
    { k: 'doc', t: 'מסמך Word / PDF', d: 'הצעת מחיר, דוח, מכתב', accept: '.pptx,.docx,.pdf,.txt,.csv,image/*', ph: 'איזה מסמך? למשל: הצעת מחיר לחברת מובמנט על חיבור תיבת גיבוי מיילים, 3 שעות עבודה, 300 ₪ לשעה' },
    { k: 'analyze', t: 'ניתוח קובץ', d: 'סיכום ותובנות מקובץ', accept: '.pptx,.docx,.pdf,.txt,.csv,image/*', ph: 'העלה קובץ. על מה לשים דגש? (לא חובה)', needFile: true },
    { k: 'research', t: 'מחקר על נושא', d: 'איסוף מידע מהאינטרנט', accept: '.pptx,.docx,.pdf,.txt,.csv,image/*', ph: 'מה לחקור? למשל: מתחרים של Callio בישראל, מחירים ויכולות' },
    { k: 'free', t: 'משימה חופשית', d: 'כל דבר אחר', accept: '.pptx,.docx,.pdf,.txt,.csv,image/*', ph: 'מה צריך?' }
  ];
  var KIND_LABEL = {}; TASKS.forEach(function (t) { KIND_LABEL[t.k] = t.t; });
  var MODELS = [
    { k: 'opus', t: 'Opus', d: 'מומלץ' },
    { k: 'fable', t: 'Fable', d: 'הכי חזק, יקר פי 2.5' },
    { k: 'sonnet', t: 'Sonnet', d: 'מהיר וזול' }
  ];

  var state = { kind: 'deck_new', model: 'opus', web: false, files: [], job: null, poll: null, jobs: [] };

  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function $(id) { return document.getElementById(id); }
  function svg(p) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + p + '</svg>'; }
  function task() { return TASKS.filter(function (t) { return t.k === state.kind; })[0]; }
  function loadScript(src) {
    return new Promise(function (ok, bad) {
      if (document.querySelector('script[src="' + src + '"]')) return ok();
      var s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = function () { bad(new Error('טעינת ספרייה נכשלה')); };
      document.head.appendChild(s);
    });
  }

  // ---------- layout ----------
  app.innerHTML =
    '<div class="st-layout">' +
      '<div class="st-main">' +
        '<p class="st-q">מה מכינים היום?</p>' +
        '<div class="st-tiles" id="stTiles">' + TASKS.map(function (t) {
          return '<button type="button" class="st-tile" data-k="' + t.k + '"><span class="st-ico">' + svg(ICO[t.k]) + '</span><b>' + t.t + '</b><small>' + t.d + '</small></button>';
        }).join('') + '</div>' +
        '<form id="stForm" class="st-form">' +
          '<textarea id="stPrompt" rows="5"></textarea>' +
          '<label class="st-drop" id="stDrop"><input type="file" id="stFile" multiple hidden>' +
            '<span>📎 גרור לכאן קבצים או לחץ לבחירה <small id="stAccept"></small></span></label>' +
          '<div class="st-files" id="stFiles"></div>' +
          '<div class="st-opts">' +
            '<div class="st-opt"><span>מקור מידע</span><div class="st-chips" id="stWeb">' +
              '<button type="button" data-v="0">הידע של Claude</button><button type="button" data-v="1">+ חיפוש באינטרנט</button></div></div>' +
            '<div class="st-opt"><span>מודל</span><div class="st-chips" id="stModel">' + MODELS.map(function (m) {
              return '<button type="button" data-v="' + m.k + '" title="' + m.d + '">' + m.t + ' <small>' + m.d + '</small></button>';
            }).join('') + '</div></div>' +
          '</div>' +
          '<div class="st-go"><button type="submit" class="btn btn-gold" id="stGo">צא לדרך 🚀</button>' +
            '<button type="button" class="btn btn-ghost st-hide" id="stStop">■ עצור</button>' +
            '<span class="st-err" id="stErr"></span></div>' +
        '</form>' +
        '<div id="stRun" class="st-run st-hide"></div>' +
        '<div id="stResult" class="st-result st-hide"></div>' +
      '</div>' +
      '<aside class="st-hist"><div class="st-hist-head"><b>היסטוריה</b><button type="button" id="stHistRefresh" title="רענון">↻</button></div><div id="stHist"><p class="dash-empty">טוען...</p></div></aside>' +
    '</div>';

  function paint() {
    var t = task();
    app.querySelectorAll('.st-tile').forEach(function (b) { b.classList.toggle('on', b.dataset.k === state.kind); });
    app.querySelectorAll('#stModel button').forEach(function (b) { b.classList.toggle('on', b.dataset.v === state.model); });
    var forcedWeb = state.kind === 'research';
    app.querySelectorAll('#stWeb button').forEach(function (b) {
      b.classList.toggle('on', (b.dataset.v === '1') === (state.web || forcedWeb));
      b.disabled = forcedWeb;
    });
    $('stPrompt').placeholder = t.ph;
    $('stFile').accept = t.accept;
    $('stAccept').textContent = '(' + t.accept.replace(/image\/\*/, 'תמונות').replace(/\./g, '').toUpperCase().replace(/,/g, ' / ') + ')';
    $('stFiles').innerHTML = state.files.map(function (f, i) {
      return '<span class="st-file">' + esc(f.name) + ' <small>' + Math.max(1, Math.round(f.size / 1024)) + 'KB</small><button type="button" data-i="' + i + '" aria-label="הסר">×</button></span>';
    }).join('');
  }

  $('stTiles').addEventListener('click', function (e) {
    var b = e.target.closest('.st-tile'); if (!b) return;
    state.kind = b.dataset.k; paint(); $('stPrompt').focus();
  });
  $('stModel').addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) { state.model = b.dataset.v; paint(); } });
  $('stWeb').addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) { state.web = b.dataset.v === '1'; paint(); } });
  $('stFiles').addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) { state.files.splice(Number(b.dataset.i), 1); paint(); } });
  $('stFile').addEventListener('change', function () { addFiles(this.files); this.value = ''; });
  var drop = $('stDrop');
  ['dragenter', 'dragover'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('over'); }); });
  ['dragleave', 'drop'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('over'); }); });
  drop.addEventListener('drop', function (e) { addFiles(e.dataTransfer.files); });
  function addFiles(list) {
    Array.prototype.forEach.call(list || [], function (f) { if (state.files.length < 20) state.files.push(f); });
    paint();
  }
  function err(msg) { $('stErr').textContent = msg || ''; }

  // ---------- files -> what the function accepts ----------
  function b64(buf) {
    var bytes = new Uint8Array(buf), out = '', CH = 0x8000;
    for (var i = 0; i < bytes.length; i += CH) out += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    return btoa(out);
  }
  function xmlText(xml) { return new DOMParser().parseFromString(xml, 'application/xml'); }
  // PowerPoint: the text of every slide in order, tables as rows "a | b | c"
  async function pptxText(file) {
    await loadScript(JSZIP_LIB);
    var zip = await window.JSZip.loadAsync(file);
    var names = Object.keys(zip.files).filter(function (n) { return /^ppt\/slides\/slide\d+\.xml$/.test(n); })
      .sort(function (a, b) { return Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]); });
    var out = [];
    for (var i = 0; i < names.length; i++) {
      var doc = xmlText(await zip.file(names[i]).async('string'));
      var lines = [];
      var walk = function (node) {
        for (var c = node.firstElementChild; c; c = c.nextElementSibling) {
          if (c.localName === 'tbl') {
            Array.prototype.forEach.call(c.getElementsByTagNameNS('*', 'tr'), function (tr) {
              var row = Array.prototype.map.call(tr.getElementsByTagNameNS('*', 'tc'), function (tc) {
                return Array.prototype.map.call(tc.getElementsByTagNameNS('*', 't'), function (t) { return t.textContent; }).join(' ').trim();
              });
              if (row.join('')) lines.push(row.join(' | '));
            });
          } else if (c.localName === 'p') {
            var t = Array.prototype.map.call(c.getElementsByTagNameNS('*', 't'), function (t) { return t.textContent; }).join('').trim();
            if (t) lines.push(t);
          } else walk(c);
        }
      };
      walk(doc.documentElement);
      out.push('--- שקף ' + (i + 1) + ' ---\n' + lines.join('\n'));
    }
    return out.join('\n\n');
  }
  async function docxText(file) {
    await loadScript(JSZIP_LIB);
    var zip = await window.JSZip.loadAsync(file);
    var doc = xmlText(await zip.file('word/document.xml').async('string'));
    var lines = [];
    var walk = function (node) {
      for (var c = node.firstElementChild; c; c = c.nextElementSibling) {
        if (c.localName === 'tbl') {
          Array.prototype.forEach.call(c.getElementsByTagNameNS('*', 'tr'), function (tr) {
            var row = Array.prototype.map.call(tr.getElementsByTagNameNS('*', 'tc'), function (tc) {
              return Array.prototype.map.call(tc.getElementsByTagNameNS('*', 't'), function (t) { return t.textContent; }).join('').trim();
            });
            if (row.join('')) lines.push(row.join(' | '));
          });
        } else if (c.localName === 'p') {
          var t = Array.prototype.map.call(c.getElementsByTagNameNS('*', 't'), function (t) { return t.textContent; }).join('').trim();
          if (t) lines.push(t);
        } else walk(c);
      }
    };
    walk(doc.documentElement);
    return lines.join('\n');
  }
  // big photos are scaled down: enough for Claude to read, much smaller to send
  function shrinkImage(file) {
    return new Promise(function (ok, bad) {
      var img = new Image(), url = URL.createObjectURL(file);
      img.onload = function () {
        var max = 2000, sc = Math.min(1, max / Math.max(img.width, img.height));
        var c = document.createElement('canvas'); c.width = Math.round(img.width * sc); c.height = Math.round(img.height * sc);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        ok(c.toDataURL('image/jpeg', 0.88).split(',')[1]);
      };
      img.onerror = function () { bad(new Error('לא הצלחתי לקרוא את התמונה ' + file.name)); };
      img.src = url;
    });
  }
  async function prepFiles() {
    var out = [], total = 0;
    for (var i = 0; i < state.files.length; i++) {
      var f = state.files[i], n = f.name.toLowerCase();
      if (/\.pptx$/.test(n)) out.push({ name: f.name, type: 'text', text: await pptxText(f) });
      else if (/\.docx$/.test(n)) out.push({ name: f.name, type: 'text', text: await docxText(f) });
      else if (/\.(txt|csv|md)$/.test(n)) out.push({ name: f.name, type: 'text', text: await f.text() });
      else if (/^image\//.test(f.type)) out.push({ name: f.name, type: 'image/jpeg', data: await shrinkImage(f) });
      else if (f.type === 'application/pdf' || /\.pdf$/.test(n)) out.push({ name: f.name, type: 'application/pdf', data: b64(await f.arrayBuffer()) });
      else throw new Error('סוג קובץ לא נתמך: ' + f.name + ' (Excel: שמור כ-CSV)');
      total += (out[out.length - 1].data || out[out.length - 1].text || '').length;
    }
    if (total > MAX_BYTES * 1.37) throw new Error('הקבצים גדולים מדי (עד 18MB ביחד)');
    return out;
  }

  // ---------- run ----------
  async function call(body) {
    var r = await fetch(D.SUPABASE_URL + '/functions/v1/studio', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: await D.authHeader() }, body: JSON.stringify(body) });
    var j = await r.json().catch(function () { return {}; });
    if (!r.ok || !j.ok) throw new Error(j.error || ('שגיאה ' + r.status));
    return j;
  }

  $('stForm').addEventListener('submit', async function (e) {
    e.preventDefault(); err('');
    var t = task(), prompt = $('stPrompt').value.trim();
    if (t.needFile && !state.files.length) return err('צרף קובץ למשימה הזו');
    if (!prompt && !state.files.length) return err('כתוב מה להכין');
    busy(true, 'מכין את הקבצים...');
    try {
      var files = await prepFiles();
      var j = await call({ action: 'start', kind: state.kind, prompt: prompt, model: state.model, web: state.web, files: files });
      watch(j.id);
    } catch (x) { busy(false); err(x.message); }
  });
  $('stStop').addEventListener('click', async function () {
    if (!state.job) return;
    try { await call({ action: 'cancel', id: state.job }); } catch (x) { /* the poll shows the state */ }
    stopPoll(); busy(false); loadHist();
  });

  function busy(on, msg) {
    $('stGo').disabled = on;
    $('stStop').classList.toggle('st-hide', !on);
    $('stRun').classList.toggle('st-hide', !on);
    if (on) $('stRun').innerHTML = '<span class="st-spin"></span><b id="stRunMsg">' + esc(msg || 'עובד על זה...') + '</b> <small id="stClock"></small>';
  }
  function stopPoll() { clearInterval(state.poll); state.poll = null; state.job = null; }

  function watch(id) {
    stopPoll();
    state.job = id;
    var t0 = Date.now();
    busy(true, state.web || state.kind === 'research' ? 'מחפש באינטרנט וכותב... (מחקר לוקח כמה דקות)' : 'Claude כותב... (משימה גדולה יכולה לקחת כמה דקות)');
    $('stResult').classList.add('st-hide');
    loadHist();
    state.poll = setInterval(async function () {
      var s = Math.round((Date.now() - t0) / 1000);
      var c = $('stClock'); if (c) c.textContent = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
      if (s % 3) return;
      var q = await D.sb.from('studio_jobs').select('*').eq('id', id).maybeSingle();
      var row = q.data;
      if (!row || row.status === 'running') {
        if (s > 480) { stopPoll(); busy(false); err('המשימה לא הסתיימה אחרי 8 דקות. נסה שוב, או בקש תוצר קצר יותר.'); }
        return;
      }
      stopPoll(); busy(false); loadHist();
      if (row.status === 'done') show(row);
      else if (row.status === 'error') err('המשימה נכשלה: ' + (row.error || ''));
    }, 1000);
  }

  // ---------- result ----------
  var current = null;
  function money(v) { return '$' + Number(v || 0).toFixed(2); }
  function show(row) {
    current = row;
    var res = row.result || {}, el = $('stResult');
    var head = '<div class="st-res-head"><div><span class="st-kind">' + esc(KIND_LABEL[row.kind] || '') + '</span><h3>' + esc(res.title || row.title) + '</h3>' +
      (res.summary ? '<p>' + esc(res.summary) + '</p>' : '') +
      '<small>' + (row.duration_s ? Math.round(row.duration_s / 6) / 10 + ' דק\' · ' : '') + 'עלות ' + money(row.cost_usd) + ' · ' + esc(row.model) + '</small></div></div>';
    var actions, body;
    if (res.type === 'deck') {
      actions = '<button type="button" class="btn btn-gold" data-a="pptx">⬇ הורד PowerPoint</button>';
      body = '<div class="st-deck">' + R.deckPreview(res, MARK) + '</div>';
    } else {
      actions = '<button type="button" class="btn btn-gold" data-a="pdf">⬇ PDF</button><button type="button" class="btn btn-ghost" data-a="word">⬇ Word</button><button type="button" class="btn btn-ghost" data-a="copy">העתק טקסט</button>';
      body = '<iframe class="st-doc" id="stDocFrame" title="תצוגה מקדימה"></iframe>';
    }
    el.innerHTML = head + '<div class="st-actions">' + actions + '</div>' + body +
      '<form class="st-improve" id="stImprove"><textarea id="stImpText" rows="2" placeholder="רוצה לשנות משהו? למשל: להוסיף שקף על יעדים, לקצר את התנאים, לשנות את המחיר ל-1,200 ₪"></textarea>' +
      '<button type="submit" class="btn btn-ghost">המשך שיפור ✨</button></form>';
    el.classList.remove('st-hide');
    if (res.type !== 'deck') {
      var fr = $('stDocFrame');
      fr.srcdoc = R.docHtml(res, BANNER);
      fr.onload = function () { try { fr.style.height = (fr.contentDocument.documentElement.scrollHeight + 10) + 'px'; } catch (x) { /* same origin, so this works */ } };
    }
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function fileName(res, ext) { return String(res.title || 'סטודיו AL').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80) + '.' + ext; }
  function download(blob, name) {
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  async function markData() {
    var b = await (await fetch(MARK)).blob();
    return new Promise(function (ok) { var r = new FileReader(); r.onload = function () { ok(r.result); }; r.readAsDataURL(b); });
  }

  $('stResult').addEventListener('click', async function (e) {
    var b = e.target.closest('button[data-a]'); if (!b || !current) return;
    var res = current.result, a = b.dataset.a;
    try {
      if (a === 'pptx') {
        b.disabled = true; b.textContent = 'בונה את הקובץ...';
        await loadScript(PPTX_LIB);
        await R.buildDeck(window.PptxGenJS, res, { mark: await markData() }).writeFile({ fileName: fileName(res, 'pptx') });
        b.disabled = false; b.textContent = '⬇ הורד PowerPoint';
      } else if (a === 'word') {
        download(new Blob(['﻿' + R.docHtml(res, BANNER, true)], { type: 'application/msword' }), fileName(res, 'doc'));
      } else if (a === 'pdf') {
        // the browser's print dialog -> "Save as PDF"
        var fr = document.createElement('iframe');
        fr.style.cssText = 'position:fixed;width:0;height:0;border:0;left:-9999px';
        document.body.appendChild(fr);
        fr.onload = function () { setTimeout(function () { fr.contentWindow.focus(); fr.contentWindow.print(); setTimeout(function () { fr.remove(); }, 60000); }, 700); };
        fr.srcdoc = R.docHtml(res, BANNER);
      } else if (a === 'copy') {
        await navigator.clipboard.writeText(R.docText(res));
        b.textContent = 'הועתק ✓'; setTimeout(function () { b.textContent = 'העתק טקסט'; }, 1500);
      }
    } catch (x) { err(x.message); b.disabled = false; }
  });

  $('stResult').addEventListener('submit', async function (e) {
    if (e.target.id !== 'stImprove') return;
    e.preventDefault(); err('');
    var text = $('stImpText').value.trim();
    if (!text) return;
    busy(true, 'משפר...');
    try { var j = await call({ action: 'start', parent_id: current.id, prompt: text, model: state.model, web: false, files: [] }); watch(j.id); }
    catch (x) { busy(false); err(x.message); }
  });

  // ---------- history ----------
  var ST = { running: 'בעבודה', done: 'הושלם', error: 'נכשל', cancelled: 'בוטל' };
  async function loadHist() {
    var q = await D.sb.from('studio_jobs').select('id,created_at,kind,title,status,cost_usd,model,parent_id').order('created_at', { ascending: false }).limit(40);
    if (q.error) { $('stHist').innerHTML = '<p class="dash-error">' + esc(q.error.message) + '</p>'; return; }
    state.jobs = q.data || [];
    var spent = state.jobs.filter(function (j) { return Date.now() - new Date(j.created_at) < 864e5; }).reduce(function (n, j) { return n + Number(j.cost_usd || 0); }, 0);
    $('stHist').innerHTML = (state.jobs.length ? '<p class="st-spent">ב-24 השעות האחרונות: ' + money(spent) + '</p>' : '<p class="dash-empty">עוד אין משימות.</p>') +
      state.jobs.map(function (j) {
        var when = new Date(j.created_at).toLocaleString('he-IL', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });
        return '<div class="st-h st-' + j.status + '" data-id="' + j.id + '"><b>' + (j.parent_id ? '↻ ' : '') + esc(j.title) + '</b>' +
          '<small>' + esc(KIND_LABEL[j.kind] || '') + ' · ' + when + '</small>' +
          '<span class="st-badge">' + ST[j.status] + '</span>' +
          (j.status !== 'running' ? '<button type="button" class="st-del" data-del="' + j.id + '" aria-label="מחק">🗑</button>' : '') + '</div>';
      }).join('');
  }
  $('stHistRefresh').addEventListener('click', loadHist);
  $('stHist').addEventListener('click', async function (e) {
    var del = e.target.closest('[data-del]');
    if (del) {
      e.stopPropagation();
      var q = await D.sb.from('studio_jobs').delete().eq('id', Number(del.dataset.del));
      if (q.error) err(q.error.message); else loadHist();
      return;
    }
    var h = e.target.closest('.st-h'); if (!h) return;
    var id = Number(h.dataset.id);
    var row = (await D.sb.from('studio_jobs').select('*').eq('id', id).maybeSingle()).data;
    if (!row) return;
    if (row.status === 'done') show(row);
    else if (row.status === 'running') watch(id);
    else err(row.status === 'error' ? 'המשימה נכשלה: ' + (row.error || '') : 'המשימה בוטלה');
  });

  paint();
  window.ALStudio = { load: loadHist };
  D.sb.auth.getSession().then(function (r) { if (r.data && r.data.session) loadHist(); });
})();
