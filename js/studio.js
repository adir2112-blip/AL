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
  var XLSX_LIB = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
  var DOCX_LIB = 'https://cdn.jsdelivr.net/npm/docx@8.5.0/build/index.umd.js';
  var PDF_LIB = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';
  var BANNER = new URL('assets/studio-mark.png', location.href).href;
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
    { k: 'deck_upgrade', t: 'שדרוג מצגת', d: 'מצגת קיימת ← עיצוב מקצועי', accept: '.pptx,.pdf,.xlsx,.xls,.csv,image/*', ph: 'העלה את המצגת. מה לשפר? (למשל: להוסיף גרפים, לקצר את הטקסט, להוסיף שקף סיכום)', needFile: true },
    { k: 'deck_new', t: 'מצגת חדשה', d: 'מאפס, לפי נושא או טקסט', accept: '.xlsx,.xls,.csv,.pptx,.docx,.pdf,.txt,image/*', ph: 'על מה המצגת? למי היא מיועדת? אפשר להדביק כאן נתונים או לצרף קבצים.\nלמשל: מצגת סיכום חודשי למנהלי המוקד, עם הנתונים מהקובץ המצורף' },
    { k: 'deck_editable', t: 'הפיכה לעריכה', d: 'תמונות / PDF ← מצגת שאפשר לערוך', accept: 'image/*,.pdf', ph: 'העלה צילומי מסך או PDF של המצגת. הכל יועתק למצגת PowerPoint שאפשר לערוך.', needFile: true },
    { k: 'doc', t: 'מסמך Word / PDF', d: 'הצעת מחיר, דוח, מכתב', accept: '.xlsx,.xls,.csv,.pptx,.docx,.pdf,.txt,image/*', ph: 'איזה מסמך? למשל: הצעת מחיר לחברת מובמנט על חיבור תיבת גיבוי מיילים, 3 שעות עבודה, 300 ₪ לשעה' },
    { k: 'analyze', t: 'ניתוח קובץ', d: 'סיכום ותובנות מקובץ', accept: '.xlsx,.xls,.csv,.pptx,.docx,.pdf,.txt,image/*', ph: 'העלה קובץ. על מה לשים דגש? (לא חובה)', needFile: true },
    { k: 'research', t: 'מחקר על נושא', d: 'איסוף מידע מהאינטרנט', accept: '.xlsx,.xls,.csv,.pptx,.docx,.pdf,.txt,image/*', ph: 'מה לחקור? למשל: מתחרים של Callio בישראל, מחירים ויכולות' },
    { k: 'free', t: 'משימה חופשית', d: 'כל דבר אחר', accept: '.xlsx,.xls,.csv,.pptx,.docx,.pdf,.txt,image/*', ph: 'מה צריך?' }
  ];
  var KIND_LABEL = {}; TASKS.forEach(function (t) { KIND_LABEL[t.k] = t.t; });
  var MODELS = [
    { k: 'opus', t: 'Opus', d: 'מומלץ' },
    { k: 'fable', t: 'Fable', d: 'הכי חזק, יקר פי 2.5' },
    { k: 'sonnet', t: 'Sonnet', d: 'מהיר וזול' }
  ];

  var state = { kind: 'deck_new', model: 'opus', web: false, files: [], job: null, poll: null, jobs: [],
    template: '', templates: [], quote: true, client: '', clients: [], settings: { hourly_rate: 300, vat_pct: 18 }, editing: false };

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
          '<div class="st-extra" id="stTplBox"><span>תבנית קבועה</span><select id="stTpl" aria-label="תבנית"></select>' +
            '<button type="button" class="st-mini" id="stTplDel" title="מחק את התבנית">🗑</button>' +
            '<small id="stTplHint"></small></div>' +
          '<div class="st-extra" id="stQuoteBox">' +
            '<label class="st-check"><input type="checkbox" id="stQuote"> הצעת מחיר (מספור, לקוח ומע"מ)</label>' +
            '<div class="st-qopts" id="stQuoteOpts">' +
              '<label>לקוח <select id="stClient" aria-label="לקוח"></select></label>' +
              '<button type="button" class="st-mini" id="stClientNew">+ לקוח חדש</button>' +
              '<label>תעריף לשעה <input id="stRate" type="number" min="0" step="10" inputmode="decimal"> ₪</label>' +
              '<label>מע"מ <input id="stVat" type="number" min="0" max="100" step="0.5" inputmode="decimal"> %</label>' +
              '<button type="button" class="st-mini" id="stSaveDefaults">שמור כברירת מחדל</button>' +
            '</div>' +
            '<div class="st-cform st-hide" id="stClientForm">' +
              '<input id="cfName" placeholder="שם הלקוח / החברה *" aria-label="שם הלקוח">' +
              '<input id="cfNo" placeholder="ח.פ / ע.מ" aria-label="ח.פ">' +
              '<input id="cfContact" placeholder="איש קשר" aria-label="איש קשר">' +
              '<input id="cfPhone" placeholder="טלפון" aria-label="טלפון" inputmode="tel">' +
              '<input id="cfEmail" placeholder="אימייל" aria-label="אימייל" type="email">' +
              '<input id="cfAddress" placeholder="כתובת" aria-label="כתובת">' +
              '<textarea id="cfNotes" rows="2" placeholder="הערות (למשל: מה כבר עשינו עבורם)" aria-label="הערות"></textarea>' +
              '<div><button type="button" class="btn btn-gold" id="cfSave">שמור לקוח</button> <button type="button" class="btn btn-ghost" id="cfCancel">ביטול</button></div>' +
            '</div>' +
          '</div>' +
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
    var tplOn = state.kind === 'deck_new' || state.kind === 'deck_upgrade';
    $('stTplBox').classList.toggle('st-hide', !tplOn);
    $('stTpl').innerHTML = '<option value="">ללא, מצגת רגילה</option>' + state.templates.map(function (t) {
      return '<option value="' + t.id + '"' + (String(t.id) === String(state.template) ? ' selected' : '') + '>' + esc(t.name) + '</option>';
    }).join('');
    $('stTplDel').classList.toggle('st-hide', !state.template);
    var tp = state.templates.filter(function (t) { return String(t.id) === String(state.template); })[0];
    $('stTplHint').textContent = tp ? (tp.last_result ? 'המבנה הקבוע, עם השוואה לפעם הקודמת (' + new Date(tp.updated_at).toLocaleDateString('he-IL') + ')' : 'המבנה הקבוע') : (state.templates.length ? '' : 'אחרי שתכין מצגת, אפשר לשמור אותה כתבנית לדוח החודשי');
    $('stQuoteBox').classList.toggle('st-hide', state.kind !== 'doc');
    $('stQuote').checked = state.quote;
    $('stQuoteOpts').classList.toggle('st-hide', !state.quote);
    $('stClient').innerHTML = '<option value="">בלי לקוח שמור</option>' + state.clients.map(function (c) {
      return '<option value="' + c.id + '"' + (String(c.id) === String(state.client) ? ' selected' : '') + '>' + esc(c.name) + (c.company_no ? ' · ' + esc(c.company_no) : '') + '</option>';
    }).join('');
    if (!$('stRate').value) $('stRate').value = state.settings.hourly_rate;
    if (!$('stVat').value) $('stVat').value = state.settings.vat_pct;
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

  // ---------- templates, clients, quote defaults ----------
  $('stTpl').addEventListener('change', function () {
    state.template = this.value;
    var t = state.templates.filter(function (x) { return String(x.id) === String(state.template); })[0];
    if (t && t.prompt && !$('stPrompt').value.trim()) $('stPrompt').value = t.prompt;
    paint();
  });
  $('stTplDel').addEventListener('click', async function () {
    var t = state.templates.filter(function (x) { return String(x.id) === String(state.template); })[0];
    if (!t) return;
    if (this.dataset.sure !== '1') { this.dataset.sure = '1'; this.textContent = 'בטוח? לחץ שוב'; var b = this; setTimeout(function () { b.dataset.sure = ''; b.textContent = '🗑'; }, 3000); return; }
    var q = await D.sb.from('studio_templates').delete().eq('id', t.id);
    if (q.error) return err(q.error.message);
    state.template = ''; this.dataset.sure = ''; this.textContent = '🗑'; await loadLists();
  });
  $('stQuote').addEventListener('change', function () { state.quote = this.checked; paint(); });
  $('stClient').addEventListener('change', function () { state.client = this.value; });
  $('stClientNew').addEventListener('click', function () { $('stClientForm').classList.toggle('st-hide'); $('cfName').focus(); });
  $('cfCancel').addEventListener('click', function () { $('stClientForm').classList.add('st-hide'); });
  $('cfSave').addEventListener('click', async function () {
    var v = function (id) { var x = $(id).value.trim(); return x || null; };
    if (!v('cfName')) return err('כתוב את שם הלקוח');
    var q = await D.sb.from('studio_clients').insert({ name: v('cfName'), company_no: v('cfNo'), contact: v('cfContact'), phone: v('cfPhone'), email: v('cfEmail'), address: v('cfAddress'), notes: v('cfNotes') }).select().single();
    if (q.error) return err(q.error.message);
    ['cfName', 'cfNo', 'cfContact', 'cfPhone', 'cfEmail', 'cfAddress', 'cfNotes'].forEach(function (id) { $(id).value = ''; });
    $('stClientForm').classList.add('st-hide');
    state.client = String(q.data.id); err(''); await loadLists();
  });
  $('stSaveDefaults').addEventListener('click', async function () {
    var rate = Number($('stRate').value), vat = Number($('stVat').value), b = this;
    if (!(rate >= 0) || !(vat >= 0)) return err('תעריף ומע"מ צריכים להיות מספרים');
    var q = await D.sb.from('studio_settings').update({ hourly_rate: rate, vat_pct: vat }).eq('id', 1);
    if (q.error) return err(q.error.message);
    state.settings.hourly_rate = rate; state.settings.vat_pct = vat;
    b.textContent = 'נשמר ✓'; setTimeout(function () { b.textContent = 'שמור כברירת מחדל'; }, 1500);
  });
  async function loadLists() {
    var r = await Promise.all([
      D.sb.from('studio_templates').select('id,name,prompt,updated_at,last_result').order('name'),
      D.sb.from('studio_clients').select('*').order('name'),
      D.sb.from('studio_settings').select('*').eq('id', 1).maybeSingle()
    ]);
    if (!r[0].error) state.templates = (r[0].data || []).map(function (t) { return { id: t.id, name: t.name, prompt: t.prompt, updated_at: t.updated_at, last_result: !!t.last_result }; });
    if (!r[1].error) state.clients = r[1].data || [];
    if (!r[2].error && r[2].data) state.settings = r[2].data;
    paint();
  }

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
  // Excel: every sheet as CSV text (the first 2,000 rows of each)
  async function xlsxText(file) {
    await loadScript(XLSX_LIB);
    var wb = window.XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
    return wb.SheetNames.map(function (name) {
      var csv = window.XLSX.utils.sheet_to_csv(wb.Sheets[name], { blankrows: false, dateNF: 'dd.mm.yyyy' });
      var rows = csv.split('\n').filter(function (l) { return l.replace(/,/g, '').trim(); });
      return '--- גיליון: ' + name + ' (' + rows.length + ' שורות) ---\n' + rows.slice(0, 2000).join('\n') + (rows.length > 2000 ? '\n... (עוד ' + (rows.length - 2000) + ' שורות לא נשלחו)' : '');
    }).join('\n\n');
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
      else if (/\.(xlsx|xls|xlsm)$/.test(n)) out.push({ name: f.name, type: 'text', text: await xlsxText(f) });
      else if (/\.(txt|csv|md)$/.test(n)) out.push({ name: f.name, type: 'text', text: await f.text() });
      else if (/^image\//.test(f.type)) out.push({ name: f.name, type: 'image/jpeg', data: await shrinkImage(f) });
      else if (f.type === 'application/pdf' || /\.pdf$/.test(n)) out.push({ name: f.name, type: 'application/pdf', data: b64(await f.arrayBuffer()) });
      else throw new Error('סוג קובץ לא נתמך: ' + f.name);
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
      var body = { action: 'start', kind: state.kind, prompt: prompt, model: state.model, web: state.web, files: files };
      if ((state.kind === 'deck_new' || state.kind === 'deck_upgrade') && state.template) body.template_id = Number(state.template);
      if (state.kind === 'doc' && state.quote) body.quote = { client_id: state.client ? Number(state.client) : null, rate: $('stRate').value, vat: $('stVat').value };
      var j = await call(body);
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
  function show(row, keepEdit) {
    current = row;
    if (!keepEdit) state.editing = false;
    var res = row.result || {}, el = $('stResult'), ed = state.editing;
    var head = '<div class="st-res-head"><div><span class="st-kind">' + esc(KIND_LABEL[row.kind] || '') + '</span><h3>' + esc(res.title || row.title) + '</h3>' +
      (res.summary ? '<p>' + esc(res.summary) + '</p>' : '') +
      '<small>' + (row.duration_s ? Math.round(row.duration_s / 6) / 10 + ' דק\' · ' : '') + 'עלות ' + money(row.cost_usd) + ' · ' + esc(row.model) + '</small></div></div>';
    var actions, body;
    if (res.type === 'deck') {
      actions = ed ? '' : '<button type="button" class="btn btn-gold" data-a="pptx">⬇ הורד PowerPoint</button>' +
        '<button type="button" class="btn btn-ghost" data-a="tpl">💾 שמור כתבנית</button>';
      body = '<div class="st-deck" id="stDeck">' + R.deckPreview(res, MARK, ed) + '</div>';
    } else {
      actions = ed ? '' : '<button type="button" class="btn btn-gold" data-a="pdf">⬇ PDF</button><button type="button" class="btn btn-ghost" data-a="word">⬇ Word</button><button type="button" class="btn btn-ghost" data-a="copy">העתק טקסט</button>';
      body = '<iframe class="st-doc" id="stDocFrame" title="תצוגה מקדימה"></iframe>';
    }
    actions = ed
      ? '<button type="button" class="btn btn-gold" data-a="save">✓ שמור שינויים</button><button type="button" class="btn btn-ghost" data-a="cancel">ביטול</button><span class="st-edit-hint">לוחצים על טקסט ומתקנים. מספרים בתמחור מתעדכנים בסכומים אחרי השמירה.</span>'
      : actions + '<button type="button" class="btn btn-ghost" data-a="edit">✎ עריכה</button>';
    actions += '<div class="st-tplsave st-hide" id="stTplSave"><input id="stTplName" placeholder="שם התבנית, למשל: פריפיט מכירות חודשי" aria-label="שם התבנית"><button type="button" class="btn btn-gold" data-a="tplok">שמור</button></div>';
    el.innerHTML = head + '<div class="st-actions">' + actions + '</div>' + body +
      '<form class="st-improve" id="stImprove"><textarea id="stImpText" rows="2" placeholder="רוצה לשנות משהו? למשל: להוסיף שקף על יעדים, לקצר את התנאים, לשנות את המחיר ל-1,200 ₪"></textarea>' +
      '<button type="submit" class="btn btn-ghost">המשך שיפור ✨</button></form>';
    el.classList.remove('st-hide');
    if (res.type !== 'deck') {
      var fr = $('stDocFrame');
      fr.srcdoc = R.docHtml(res, BANNER, false, ed);
      fr.onload = function () { try { fr.style.height = (fr.contentDocument.documentElement.scrollHeight + 10) + 'px'; } catch (x) { /* same origin, so this works */ } };
    }
    $('stImprove').classList.toggle('st-hide', ed);
    if (!keepEdit) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
        b.disabled = true;
        await loadScript(DOCX_LIB);
        var mark = await (await fetch(MARK)).arrayBuffer();
        download(await window.docx.Packer.toBlob(R.buildDocx(window.docx, res, mark)), fileName(res, 'docx'));
        b.disabled = false;
      } else if (a === 'pdf') {
        b.disabled = true; b.textContent = 'מכין PDF...';
        download(await makePdf(res), fileName(res, 'pdf'));
        b.disabled = false; b.textContent = '⬇ PDF';
      } else if (a === 'edit') {
        state.editing = true; show(current, true);
      } else if (a === 'cancel') {
        state.editing = false; show(current, true);
      } else if (a === 'save') {
        var root = res.type === 'deck' ? $('stDeck') : $('stDocFrame').contentDocument;
        var edited = R.readEdits(root, JSON.parse(JSON.stringify(res)));
        var q = await D.sb.from('studio_jobs').update({ result: edited }).eq('id', current.id);
        if (q.error) throw new Error('השמירה נכשלה: ' + q.error.message);
        current.result = edited; state.editing = false; show(current, true);
      } else if (a === 'tpl') {
        $('stTplSave').classList.toggle('st-hide'); $('stTplName').focus();
      } else if (a === 'tplok') {
        var name = $('stTplName').value.trim();
        if (!name) return err('תן לתבנית שם');
        var structure = JSON.parse(JSON.stringify(res)); delete structure.summary;
        var q2 = await D.sb.from('studio_templates').insert({ name: name, prompt: current.prompt || '', structure: structure, last_result: structure }).select('id').single();
        if (q2.error) throw new Error(q2.error.message);
        $('stTplSave').classList.add('st-hide');
        err(''); b.textContent = 'נשמר ✓';
        await loadLists();
      } else if (a === 'copy') {
        await navigator.clipboard.writeText(R.docText(res));
        b.textContent = 'הועתק ✓'; setTimeout(function () { b.textContent = 'העתק טקסט'; }, 1500);
      }
    } catch (x) { err(x.message); b.disabled = false; }
  });

  // A real PDF file: the document page rendered in a hidden frame and saved
  // with html2pdf (text as an image, exactly like the preview).
  function makePdf(res) {
    return new Promise(function (ok, bad) {
      var fr = document.createElement('iframe');
      fr.style.cssText = 'position:fixed;left:-10000px;top:0;width:820px;height:1200px;border:0';
      document.body.appendChild(fr);
      var done = function (f, v) { setTimeout(function () { fr.remove(); }, 500); f(v); };
      fr.onload = function () {
        var w = fr.contentWindow, d = fr.contentDocument;
        var sc = d.createElement('script'); sc.src = PDF_LIB;
        sc.onerror = function () { done(bad, new Error('טעינת ספריית PDF נכשלה')); };
        sc.onload = function () {
          (d.fonts ? d.fonts.ready : Promise.resolve()).then(function () {
            var sheet = d.querySelector('.sheet');
            // html2canvas measures Hebrew words itself and loses the spaces
            // between bold words and flips end punctuation; one element per word
            // and per punctuation mark keeps the browser's own layout
            var walker = d.createTreeWalker(sheet, NodeFilter.SHOW_TEXT), nodes = [];
            while (walker.nextNode()) if (walker.currentNode.nodeValue.trim()) nodes.push(walker.currentNode);
            nodes.forEach(function (t) {
              var frag = d.createDocumentFragment();
              t.nodeValue.split(/(\s+|[.,:;!?()\-])/).forEach(function (part) {
                if (!part) return;
                if (/^\s+$/.test(part)) frag.appendChild(d.createTextNode(part));
                else { var sp = d.createElement('x-w'); sp.textContent = part; frag.appendChild(sp); }
              });
              t.parentNode.replaceChild(frag, t);
            });
            sheet.style.boxShadow = 'none'; sheet.style.border = 'none'; sheet.style.margin = '0';
            // options are built in the frame's own realm: html2pdf checks "instanceof Array"
            return w.html2pdf().set(w.JSON.parse(JSON.stringify({
              margin: [8, 6, 10, 6], image: { type: 'jpeg', quality: 0.95 },
              html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
              jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
              pagebreak: { mode: ['css', 'legacy'], avoid: ['.section', 'tr', '.terms-box', '.callout'] }
            }))).from(sheet).outputPdf('blob');
          }).then(function (blob) { done(ok, blob); }, function (x) { done(bad, x); });
        };
        d.head.appendChild(sc);
      };
      fr.srcdoc = R.docHtml(res, BANNER).replace('body{margin:0;background:#eef1f4', 'body{margin:0;background:#fff');
    });
  }

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
    var q = await D.sb.from('studio_jobs').select('id,created_at,kind,title,status,cost_usd,model,parent_id,quote_no').order('created_at', { ascending: false }).limit(40);
    if (q.error) { $('stHist').innerHTML = '<p class="dash-error">' + esc(q.error.message) + '</p>'; return; }
    state.jobs = q.data || [];
    var spent = state.jobs.filter(function (j) { return Date.now() - new Date(j.created_at) < 864e5; }).reduce(function (n, j) { return n + Number(j.cost_usd || 0); }, 0);
    $('stHist').innerHTML = (state.jobs.length ? '<p class="st-spent">ב-24 השעות האחרונות: ' + money(spent) + '</p>' : '<p class="dash-empty">עוד אין משימות.</p>') +
      state.jobs.map(function (j) {
        var when = new Date(j.created_at).toLocaleString('he-IL', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });
        return '<div class="st-h st-' + j.status + '" data-id="' + j.id + '"><b>' + (j.parent_id ? '↻ ' : '') + esc(j.title) + '</b>' +
          '<small>' + (j.quote_no ? 'הצעה ' + esc(j.quote_no) : esc(KIND_LABEL[j.kind] || '')) + ' · ' + when + '</small>' +
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
  function loadAll() { return Promise.all([loadHist(), loadLists()]); }
  window.ALStudio = { load: loadAll };
  D.sb.auth.getSession().then(function (r) { if (r.data && r.data.session) loadAll(); });
})();
