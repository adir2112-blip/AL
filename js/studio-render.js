/* Studio AL (dashboard.html#studio): turns the JSON that the studio function
   returns into the finished files, always in the A.L Systems look.
   - deck  -> PowerPoint (.pptx) built with PptxGenJS, plus an HTML preview
   - doc   -> one HTML page in the A.L quote template, saved as Word (.doc)
              or printed to PDF
   Claude only writes the content; the design lives here, so every file comes
   out the same. Works in the browser (window.ALStudioRender) and in Node
   (module.exports) for local tests. */
(function (root) {
  'use strict';

  // ---------- brand ----------
  var C = {
    navy: '142A45', navy2: '1C3D5E', gold: 'C99A3A', goldPale: 'F3E7CF',
    ink: '1B2430', soft: '4B5563', faint: '8992A0', band: 'EEF2F6', line: 'DDE2E8',
    paper: 'FFFFFF', green: '1F7A43', red: 'B3261E', box: 'E3EBF3'
  };
  var FONT = 'Arial';
  var W = 13.333, H = 7.5; // 16:9 in inches

  function s(v) { return v == null ? '' : String(v); }
  // PowerPoint flips Latin/number runs inside Hebrew ("TOP 10" shows as
  // "10TOP"). Writing each Latin chunk as its own left-to-right run keeps it
  // in order; the paragraph itself stays right-to-left.
  var LATIN = /([A-Za-z0-9][A-Za-z0-9 .,:&'+/%-]*[A-Za-z0-9%])/;
  function splitRun(run) {
    var t = s(run.text), o = run.options || {};
    var parts = t.split(LATIN).filter(function (x) { return x !== ''; });
    if (parts.length < 2 && !/[A-Za-z]/.test(t)) return [{ text: t, options: Object.assign({ lang: 'he-IL', rtlMode: true }, o) }];
    return parts.map(function (x, i) {
      var po = {};
      for (var k in o) if (!((k === 'bullet' || k === 'paraSpaceAfter' || k === 'indentLevel') && i > 0) && !(k === 'breakLine' && i < parts.length - 1)) po[k] = o[k];
      return { text: x, options: Object.assign(po, /[A-Za-z]/.test(x) ? { lang: 'en-US', rtlMode: false } : { lang: 'he-IL', rtlMode: true }) };
    });
  }
  function toRuns(text) {
    if (typeof text === 'string') return splitRun({ text: text });
    if (Array.isArray(text)) return text.reduce(function (all, r) { return all.concat(splitRun(r)); }, []);
    return text;
  }
  // every slide's addText goes through toRuns
  function newSlide(pres) {
    var slide = pres.addSlide(), add = slide.addText;
    slide.addText = function (text, opts) { return add.call(slide, toRuns(text), opts); };
    return slide;
  }

  function arr(v) { return Array.isArray(v) ? v : []; }
  function nonEmpty(list) { return arr(list).map(s).map(function (x) { return x.trim(); }).filter(Boolean); }

  // font size that keeps a block of text inside its box
  function fitSize(lines, base, min, perLine) {
    var total = lines.reduce(function (n, l) { return n + Math.max(1, Math.ceil(l.length / perLine)); }, 0);
    var size = base;
    while (size > min && total * size * 1.55 > 330) size -= 1;
    return size;
  }

  // ---------- PowerPoint ----------
  // A table taller than this is split over several slides.
  var MAX_ROWS = 11;

  function frame(pres, slide, n, assets) {
    // white content slide: gold rule under the title, logo and number at the bottom
    slide.background = { color: C.paper };
    slide.addShape(pres.shapes.RECTANGLE, { x: 0, y: H - 0.08, w: W, h: 0.08, fill: { color: C.navy } });
    if (assets.mark) slide.addImage({ data: assets.mark, x: 0.45, y: H - 0.62, w: 0.5, h: 0.44 });
    slide.addText('A.L Systems', { x: 1.0, y: H - 0.58, w: 2.4, h: 0.34, fontFace: FONT, fontSize: 10, color: C.faint, align: 'left' });
    slide.addText(String(n), { x: W - 1.0, y: H - 0.58, w: 0.6, h: 0.34, fontFace: FONT, fontSize: 10, color: C.faint, align: 'right' });
  }

  function title(pres, slide, text, sub) {
    slide.addText(s(text), {
      x: 0.6, y: 0.35, w: W - 1.2, h: 0.75, fontFace: FONT, fontSize: s(text).length > 50 ? 24 : 28, bold: true,
      color: C.navy, align: 'right', rtlMode: true, lang: 'he-IL', valign: 'bottom'
    });
    slide.addShape(pres.shapes.RECTANGLE, { x: W - 0.6 - 1.4, y: 1.17, w: 1.4, h: 0.06, fill: { color: C.gold } });
    if (sub) slide.addText(s(sub), {
      x: 0.6, y: 1.28, w: W - 1.2, h: 0.42, fontFace: FONT, fontSize: 14, color: C.soft, align: 'right', rtlMode: true, lang: 'he-IL'
    });
    return sub ? 1.85 : 1.5; // where the body starts
  }

  function bulletRuns(items, size, color) {
    return items.map(function (t) {
      return { text: t, options: { bullet: { code: '25A0', indent: 22 }, fontSize: size, color: color || C.ink, paraSpaceAfter: 8, breakLine: true } };
    });
  }

  function slideCover(pres, sl, deck, assets) {
    var slide = newSlide(pres);
    slide.background = { color: C.navy };
    slide.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 0.22, h: H, fill: { color: C.gold } });
    // soft circle behind the logo
    slide.addShape(pres.shapes.OVAL, { x: 1.0, y: 2.05, w: 3.0, h: 3.0, fill: { color: '1E3A5C' }, line: { color: C.gold, width: 1.5 } });
    if (assets.mark) slide.addImage({ data: assets.mark, x: 1.6, y: 2.75, w: 1.8, h: 1.59 });
    slide.addText(s(sl.title || deck.title), {
      x: 4.4, y: 2.0, w: 8.3, h: 1.7, fontFace: FONT, fontSize: s(sl.title || deck.title).length > 40 ? 34 : 42, bold: true,
      color: 'FFFFFF', align: 'right', valign: 'bottom', rtlMode: true, lang: 'he-IL'
    });
    slide.addShape(pres.shapes.RECTANGLE, { x: 12.7 - 1.8, y: 3.85, w: 1.8, h: 0.06, fill: { color: C.gold } });
    var sub = s(sl.subtitle || deck.subtitle);
    if (sub) slide.addText(sub, { x: 4.4, y: 4.0, w: 8.3, h: 0.7, fontFace: FONT, fontSize: 20, color: C.gold, align: 'right', rtlMode: true, lang: 'he-IL' });
    var meta = [s(deck.date_label), 'A.L Systems'].filter(Boolean).join('  |  ');
    slide.addText(meta, { x: 4.4, y: 6.4, w: 8.3, h: 0.4, fontFace: FONT, fontSize: 12, color: 'A9B7C9', align: 'right', rtlMode: true });
    if (sl.notes) slide.addNotes(s(sl.notes));
  }

  function slideSection(pres, sl, n) {
    var slide = newSlide(pres);
    slide.background = { color: C.navy };
    slide.addShape(pres.shapes.RECTANGLE, { x: W - 0.22, y: 0, w: 0.22, h: H, fill: { color: C.gold } });
    slide.addText(s(sl.title), { x: 0.8, y: 2.6, w: W - 1.8, h: 1.2, fontFace: FONT, fontSize: 38, bold: true, color: 'FFFFFF', align: 'right', rtlMode: true, lang: 'he-IL' });
    if (sl.subtitle) slide.addText(s(sl.subtitle), { x: 0.8, y: 3.8, w: W - 1.8, h: 0.7, fontFace: FONT, fontSize: 18, color: C.gold, align: 'right', rtlMode: true, lang: 'he-IL' });
    slide.addText(String(n), { x: W - 1.2, y: H - 0.6, w: 0.6, h: 0.34, fontFace: FONT, fontSize: 10, color: 'A9B7C9', align: 'right' });
    if (sl.notes) slide.addNotes(s(sl.notes));
  }

  function slideBullets(pres, sl, n, assets) {
    var slide = newSlide(pres);
    frame(pres, slide, n, assets);
    var top = title(pres, slide, sl.title, sl.subtitle);
    var items = nonEmpty(sl.bullets);
    var size = fitSize(items, items.length <= 4 ? 26 : 22, 13, 70);
    slide.addText(bulletRuns(items, size), {
      x: 0.9, y: top, w: W - 1.8, h: H - top - 0.9, fontFace: FONT, align: 'right', valign: 'top', rtlMode: true, lang: 'he-IL'
    });
    if (sl.notes) slide.addNotes(s(sl.notes));
  }

  function slideColumns(pres, sl, n, assets) {
    var slide = newSlide(pres);
    frame(pres, slide, n, assets);
    var top = title(pres, slide, sl.title, sl.subtitle);
    var cols = arr(sl.columns).slice(0, 3);
    if (!cols.length) return;
    var gap = 0.35, w = (W - 1.2 - gap * (cols.length - 1)) / cols.length, h = H - top - 0.95;
    cols.forEach(function (c, i) {
      var x = W - 0.6 - w - i * (w + gap); // first column on the right
      slide.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: x, y: top, w: w, h: h, rectRadius: 0.18, fill: { color: C.box }, line: { color: 'C9D6E3', width: 1 } });
      slide.addShape(pres.shapes.RECTANGLE, { x: x + 0.25, y: top + 0.78, w: w - 0.5, h: 0.035, fill: { color: C.gold } });
      slide.addText(s(c.heading), { x: x + 0.25, y: top + 0.15, w: w - 0.5, h: 0.6, fontFace: FONT, fontSize: 18, bold: true, color: C.navy, align: 'right', rtlMode: true, lang: 'he-IL' });
      var items = nonEmpty(c.bullets);
      var size = fitSize(items, cols.length > 2 ? 15 : 17, 11, cols.length > 2 ? 26 : 40);
      slide.addText(bulletRuns(items, size), { x: x + 0.2, y: top + 0.95, w: w - 0.4, h: h - 1.1, fontFace: FONT, align: 'right', valign: 'top', rtlMode: true, lang: 'he-IL' });
    });
    if (sl.notes) slide.addNotes(s(sl.notes));
  }

  function slideStats(pres, sl, n, assets) {
    var slide = newSlide(pres);
    frame(pres, slide, n, assets);
    var top = title(pres, slide, sl.title, sl.subtitle);
    var st = arr(sl.stats).slice(0, 4);
    var gap = 0.3, w = (W - 1.2 - gap * (st.length - 1)) / Math.max(1, st.length), h = 2.6;
    st.forEach(function (k, i) {
      var x = W - 0.6 - w - i * (w + gap);
      slide.addShape(pres.shapes.RECTANGLE, { x: x, y: top + 0.2, w: w, h: h, fill: { color: 'F6F8FA' }, line: { color: C.line, width: 1 } });
      slide.addShape(pres.shapes.RECTANGLE, { x: x, y: top + 0.2, w: w, h: 0.08, fill: { color: C.gold } });
      slide.addText(s(k.value), { x: x + 0.1, y: top + 0.5, w: w - 0.2, h: 1.0, fontFace: FONT, fontSize: s(k.value).length > 8 ? 30 : 40, bold: true, color: C.navy, align: 'center' });
      slide.addText(s(k.label), { x: x + 0.15, y: top + 1.5, w: w - 0.3, h: 0.55, fontFace: FONT, fontSize: 15, bold: true, color: C.ink, align: 'center', rtlMode: true, lang: 'he-IL' });
      if (k.note) {
        var good = /^\s*\+|↑|עלי/.test(s(k.note)), bad = /^\s*-|↓|ירי/.test(s(k.note));
        slide.addText(s(k.note), { x: x + 0.15, y: top + 2.0, w: w - 0.3, h: 0.6, fontFace: FONT, fontSize: 12, color: good ? C.green : bad ? C.red : C.soft, align: 'center', rtlMode: true, lang: 'he-IL' });
      }
    });
    var items = nonEmpty(sl.bullets);
    if (items.length) slide.addText(bulletRuns(items, 15, C.soft), { x: 0.9, y: top + 3.1, w: W - 1.8, h: H - top - 4.0, fontFace: FONT, align: 'right', valign: 'top', rtlMode: true, lang: 'he-IL' });
    if (sl.notes) slide.addNotes(s(sl.notes));
  }

  function tableChunks(t) {
    var rows = arr(t.rows).map(function (r) { return arr(r).map(s); });
    var total = t.total_row && rows.length ? rows.pop() : null;
    var out = [];
    for (var i = 0; i < rows.length || (i === 0 && !out.length); i += MAX_ROWS) out.push(rows.slice(i, i + MAX_ROWS));
    return { chunks: out, total: total };
  }

  function slideTable(pres, sl, n, assets) {
    var t = sl.table || {};
    var heads = arr(t.headers).map(s);
    var tc = tableChunks(t);
    var made = 0;
    tc.chunks.forEach(function (rows, ci) {
      var last = ci === tc.chunks.length - 1;
      var slide = newSlide(pres);
      frame(pres, slide, n + made, assets); made++;
      var top = title(pres, slide, s(sl.title) + (ci ? ' (המשך)' : ''), ci ? '' : sl.subtitle);
      var all = rows.concat(last && tc.total ? [tc.total] : []);
      var size = all.length > 8 ? 12 : 14;
      // RTL: PowerPoint tables run left to right, so reverse each row
      var head = heads.slice().reverse().map(function (h) {
        return { text: toRuns(h), options: { bold: true, color: 'FFFFFF', fill: { color: C.navy2 }, align: 'center', fontSize: size } };
      });
      var body = all.map(function (r, ri) {
        var isTotal = last && tc.total && ri === all.length - 1;
        return r.slice().reverse().map(function (c, i) {
          var first = i === r.length - 1;
          return { text: toRuns(c), options: {
            fontSize: size, color: isTotal ? C.green : C.ink, bold: isTotal || first,
            fill: { color: isTotal ? 'E7F5EC' : (ri % 2 ? C.band : C.paper) },
            align: first ? 'right' : 'center', rtlMode: true, lang: 'he-IL'
          } };
        });
      });
      var rowH = Math.min(0.42, (H - top - 1.0) / (all.length + 1));
      slide.addTable([head].concat(body), {
        x: 0.6, y: top + 0.05, w: W - 1.2, fontFace: FONT, rowH: rowH, valign: 'middle',
        border: { type: 'solid', pt: 0.75, color: C.line }, autoPage: false
      });
      if (last && t.note) slide.addText(s(t.note), { x: 0.6, y: H - 0.98, w: W - 1.2, h: 0.32, fontFace: FONT, fontSize: 11, color: C.faint, align: 'right', rtlMode: true, lang: 'he-IL' });
      if (sl.notes && !ci) slide.addNotes(s(sl.notes));
    });
    return made;
  }

  function slideChart(pres, sl, n, assets) {
    var slide = newSlide(pres);
    frame(pres, slide, n, assets);
    var top = title(pres, slide, sl.title, sl.subtitle);
    var ch = sl.chart || {};
    var labels = arr(ch.labels).map(s);
    var series = arr(ch.series).filter(function (x) { return x && arr(x.values).length; }).map(function (x) {
      return { name: s(x.name), labels: labels, values: arr(x.values).map(function (v) { return Number(v) || 0; }) };
    });
    if (!series.length) return slideBullets(pres, sl, n, assets);
    var type = { bar: pres.charts.BAR, line: pres.charts.LINE, pie: pres.charts.DOUGHNUT }[ch.type] || pres.charts.BAR;
    var items = nonEmpty(sl.bullets);
    var cw = items.length ? 8.0 : W - 1.2;
    var opts = {
      x: 0.6, y: top, w: cw, h: H - top - 0.9,
      chartColors: series.length === 1 && ch.type !== 'pie' ? [C.navy2] : [C.navy2, C.gold, '5B8DB8', 'A7B4C2', '7A5A24'],
      catAxisOrientation: ch.type === 'pie' ? 'minMax' : 'maxMin',
      showLegend: series.length > 1 || ch.type === 'pie', legendPos: 'b', legendFontFace: FONT, legendFontSize: 11,
      catAxisLabelFontFace: FONT, catAxisLabelFontSize: 11, valAxisLabelFontFace: FONT, valAxisLabelFontSize: 10,
      valGridLine: { color: 'E5E9EE', size: 0.5 }, catGridLine: { style: 'none' },
      showValue: ch.type !== 'line', dataLabelFontSize: 10, dataLabelColor: C.ink, dataLabelPosition: ch.type === 'pie' ? 'bestFit' : 'outEnd',
      barGapWidthPct: 60, lineSize: 3, lineDataSymbolSize: 8, holeSize: 55, showPercent: ch.type === 'pie'
    };
    if (ch.type === 'pie') { opts.showValue = false; }
    slide.addChart(type, ch.type === 'pie' ? series.slice(0, 1) : series, opts);
    if (items.length) {
      slide.addShape(pres.shapes.RECTANGLE, { x: 8.9, y: top, w: W - 9.5, h: H - top - 0.9, fill: { color: 'F6F8FA' }, line: { color: C.line, width: 1 } });
      slide.addText(bulletRuns(items, fitSize(items, 15, 11, 26)), { x: 9.05, y: top + 0.15, w: W - 9.8, h: H - top - 1.2, fontFace: FONT, align: 'right', valign: 'top', rtlMode: true, lang: 'he-IL' });
    }
    if (sl.notes) slide.addNotes(s(sl.notes));
  }

  function slideClosing(pres, sl, deck, assets) {
    var slide = newSlide(pres);
    slide.background = { color: C.navy };
    slide.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 0.22, h: H, fill: { color: C.gold } });
    if (assets.mark) slide.addImage({ data: assets.mark, x: 1.3, y: 2.6, w: 2.0, h: 1.77 });
    slide.addText(s(sl.title) || 'תודה', { x: 4.2, y: 2.4, w: 8.5, h: 1.2, fontFace: FONT, fontSize: 46, bold: true, color: 'FFFFFF', align: 'right', rtlMode: true, lang: 'he-IL' });
    slide.addText(s(sl.subtitle) || 'שאלות והערות', { x: 4.2, y: 3.6, w: 8.5, h: 0.7, fontFace: FONT, fontSize: 20, color: C.gold, align: 'right', rtlMode: true, lang: 'he-IL' });
    var items = nonEmpty(sl.bullets);
    if (items.length) slide.addText(items.join('\n'), { x: 4.2, y: 4.5, w: 8.5, h: 1.4, fontFace: FONT, fontSize: 14, color: 'C8D3E0', align: 'right', rtlMode: true, lang: 'he-IL' });
    if (sl.notes) slide.addNotes(s(sl.notes));
  }

  // deck: {title, subtitle, date_label, slides:[{layout,...}]}
  // assets: {mark: dataURL of the A.L mark}
  function buildDeck(PptxGenJS, deck, assets) {
    assets = assets || {};
    var pres = new PptxGenJS();
    pres.layout = 'LAYOUT_WIDE';
    pres.rtlMode = true;
    pres.author = 'A.L Systems';
    pres.company = 'A.L Systems';
    pres.title = s(deck.title);
    var slides = arr(deck.slides);
    if (!slides.length || slides[0].layout !== 'cover') slides = [{ layout: 'cover', title: deck.title, subtitle: deck.subtitle }].concat(slides);
    var n = 1;
    slides.forEach(function (sl) {
      switch (sl.layout) {
        case 'cover': slideCover(pres, sl, deck, assets); n++; break;
        case 'section': slideSection(pres, sl, n); n++; break;
        case 'table': n += slideTable(pres, sl, n, assets); break;
        case 'stats': slideStats(pres, sl, n, assets); n++; break;
        case 'two_columns': slideColumns(pres, sl, n, assets); n++; break;
        case 'chart': slideChart(pres, sl, n, assets); n++; break;
        case 'closing': slideClosing(pres, sl, deck, assets); n++; break;
        default: slideBullets(pres, sl, n, assets); n++;
      }
    });
    return pres;
  }

  // ---------- editing ----------
  // In edit mode every text in the preview carries data-p="path.in.json" and
  // is contenteditable; readEdits() writes the texts back into the JSON, so
  // the downloads always come from the (edited) JSON.
  function esc(v) { return s(v).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function E(path, text, edit, tag, cls, num) {
    tag = tag || 'span';
    return '<' + tag + (cls ? ' class="' + cls + '"' : '') + (edit ? ' data-p="' + path + '" contenteditable="true"' + (num ? ' data-num="1"' : '') : '') + '>' +
      esc(text).replace(/\n/g, '<br>') + '</' + tag + '>';
  }
  function setPath(obj, path, val) {
    var keys = path.split('.'), o = obj;
    for (var i = 0; i < keys.length - 1; i++) {
      var k = keys[i], next = /^\d+$/.test(keys[i + 1]) ? [] : {};
      if (o[k] == null || typeof o[k] !== 'object') o[k] = next;
      o = o[k];
    }
    o[keys[keys.length - 1]] = val;
  }
  // root: element holding the preview; obj: the JSON to update (a copy)
  function readEdits(root, obj) {
    Array.prototype.forEach.call(root.querySelectorAll('[data-p]'), function (el) {
      var t = (el.innerText || el.textContent || '').replace(/ /g, ' ').replace(/\n{3,}/g, '\n\n').trim();
      if (el.getAttribute('data-num')) {
        var n = Number(t.replace(/[^\d.\-]/g, ''));
        setPath(obj, el.getAttribute('data-p'), isFinite(n) ? n : 0);
      } else setPath(obj, el.getAttribute('data-p'), t);
    });
    return obj;
  }

  // ---------- HTML preview of a deck (what the dashboard shows) ----------
  function deckPreview(deck, markUrl, edit) {
    var slides = arr(deck.slides), auto = !slides.length || slides[0].layout !== 'cover';
    if (auto) slides = [{ layout: 'cover', title: deck.title, subtitle: deck.subtitle }].concat(slides);
    return slides.map(function (sl, i) {
      var L = sl.layout, inner = '', P = auto ? (i === 0 ? null : 'slides.' + (i - 1)) : 'slides.' + i;
      var pth = function (k) { return P ? P + '.' + k : k; }; // auto cover edits the deck title
      if (L === 'cover' || L === 'closing' || L === 'section') {
        inner = '<div class="sp-dark">' + (L !== 'section' && markUrl ? '<img src="' + esc(markUrl) + '" alt="">' : '') +
          '<div>' + E(pth('title'), sl.title || (L === 'closing' ? 'תודה' : deck.title), edit, 'b') + E(pth('subtitle'), sl.subtitle || (L === 'cover' ? deck.subtitle : ''), edit, 'span') + '</div></div>';
      } else {
        var body = '';
        if (L === 'table' && sl.table) {
          body = '<table><tr>' + arr(sl.table.headers).map(function (h, j) { return E(pth('table.headers.' + j), h, edit, 'th'); }).join('') + '</tr>' +
            arr(sl.table.rows).map(function (r, ri) { return '<tr>' + arr(r).map(function (c, ci) { return E(pth('table.rows.' + ri + '.' + ci), c, edit, 'td'); }).join('') + '</tr>'; }).join('') + '</table>';
        } else if (L === 'stats') {
          body = '<div class="sp-stats">' + arr(sl.stats).map(function (k, j) {
            return '<div>' + E(pth('stats.' + j + '.value'), k.value, edit, 'b') + E(pth('stats.' + j + '.label'), k.label, edit, 'span') + (k.note || edit ? E(pth('stats.' + j + '.note'), k.note, edit, 'small') : '') + '</div>';
          }).join('') + '</div>';
        } else if (L === 'two_columns') {
          body = '<div class="sp-cols">' + arr(sl.columns).map(function (c, j) {
            return '<div>' + E(pth('columns.' + j + '.heading'), c.heading, edit, 'b') + '<ul>' + arr(c.bullets).map(function (b, k) { return E(pth('columns.' + j + '.bullets.' + k), b, edit, 'li'); }).join('') + '</ul></div>';
          }).join('') + '</div>';
        } else if (L === 'chart' && sl.chart) {
          var labels = arr(sl.chart.labels), ser = arr(sl.chart.series)[0] || {}, vals = arr(ser.values).map(Number), mx = Math.max.apply(null, vals.concat([1]));
          body = edit
            ? '<table><tr><th>' + esc(ser.name || 'ערך') + '</th>' + labels.map(function (l, j) { return E(pth('chart.labels.' + j), l, edit, 'th'); }).join('') + '</tr><tr><td></td>' +
              vals.map(function (v, j) { return E(pth('chart.series.0.values.' + j), v, edit, 'td', '', true); }).join('') + '</tr></table>'
            : '<div class="sp-chart">' + vals.map(function (v, j) { return '<i style="height:' + Math.max(4, Math.round(v / mx * 100)) + '%" title="' + esc(labels[j]) + ': ' + v + '"></i>'; }).join('') + '</div>';
          if (arr(sl.bullets).length) body += '<ul>' + arr(sl.bullets).map(function (b, k) { return E(pth('bullets.' + k), b, edit, 'li'); }).join('') + '</ul>';
        } else {
          body = '<ul>' + arr(sl.bullets).map(function (b, k) { return E(pth('bullets.' + k), b, edit, 'li'); }).join('') + '</ul>';
        }
        inner = '<div class="sp-light">' + E(pth('title'), sl.title, edit, 'h5') + (sl.subtitle || edit ? E(pth('subtitle'), sl.subtitle, edit, 'p', 'sp-sub') : '') + body + '<em>' + (i + 1) + '</em></div>';
      }
      return '<div class="sp-slide' + (edit ? ' sp-edit' : '') + '">' + inner + '</div>';
    }).join('');
  }

  // ---------- money ----------
  function nis(n) { return (Math.round(Number(n || 0) * 100) / 100).toLocaleString('he-IL', { maximumFractionDigits: 2 }) + ' ₪'; }
  function newPricing(p) { return arr(p.rows).some(function (r) { return typeof r.quantity === 'number' || typeof r.unit_price === 'number'; }); }
  // {rows:[{...line}], sub, vat, total, vatPct, mode}
  function priceTotals(p, vatPct) {
    var v = Number(vatPct == null ? 18 : vatPct) / 100, mode = p.vat_mode || 'plus_vat';
    var rows = arr(p.rows).map(function (r) { return Number(r.quantity || 0) * Number(r.unit_price || 0); });
    var sum = rows.reduce(function (a, b) { return a + b; }, 0), sub, vat, total;
    if (mode === 'included') { total = sum; sub = sum / (1 + v); vat = total - sub; }
    else if (mode === 'none') { sub = sum; vat = 0; total = sum; }
    else { sub = sum; vat = sum * v; total = sum + vat; }
    return { lines: rows, sub: sub, vat: vat, total: total, vatPct: Math.round(v * 1000) / 10, mode: mode };
  }

  // ---------- documents (the A.L quote template) ----------
  var DOC_CSS = [
    '@page{size:A4;margin:14mm 12mm}',
    'body{margin:0;background:#eef1f4;color:#1b2430;font-family:Heebo,Arial,sans-serif;direction:rtl;line-height:1.65}',
    '.sheet{max-width:780px;margin:24px auto;background:#fff;border:1px solid #dde2e8;border-radius:4px;box-shadow:0 16px 40px -24px rgba(15,20,30,.25);padding:28px 44px 30px}',
    '.brandbar{width:100%;border-collapse:collapse;margin:0 0 22px;border-bottom:3px solid #c99a3a}',
    '.brandbar td{padding:0 0 14px;vertical-align:middle;border:none;background:none}',
    '.brandbar img{width:62px;height:55px;display:block}',
    '.brandbar .bt{padding-right:14px}',
    '.brandbar b{display:block;font-size:24px;font-weight:800;color:#142a45;letter-spacing:.3px;line-height:1.15}',
    '.brandbar span{display:block;font-size:13px;color:#9c7530;font-weight:600}',
    '.brandbar .bc{text-align:left;font-size:12px;color:#8992a0;line-height:1.7;direction:ltr}',
    'h1{font-weight:800;font-size:26px;line-height:1.3;margin:0 0 6px;color:#1c3d5e}',
    '.subtitle{font-size:14.5px;color:#4b5563;margin:0 0 18px}',
    '.meta-row{display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;font-size:13px;color:#4b5563;border-top:1px solid #dde2e8;border-bottom:1px solid #dde2e8;padding:10px 0;margin-bottom:26px}',
    '.meta-row strong{color:#1b2430}',
    '.section{margin:0 0 28px;page-break-inside:avoid}',
    'h2{font-weight:700;font-size:16px;color:#1c3d5e;margin:0 0 4px;padding-bottom:9px;border-bottom:3px solid #c99a3a;display:block;width:fit-content}',
    '.section p{margin:12px 0 0;font-size:14.5px;color:#4b5563}',
    '.section ul.bul{margin:12px 0 0;padding:0 18px 0 0;font-size:14.5px;color:#4b5563}',
    '.section ul.bul li{margin-bottom:6px}',
    'table{width:100%;border-collapse:collapse;font-size:13.5px;margin-top:14px}',
    'thead th{background:#1c3d5e;color:#fff;font-weight:700;font-size:13px;text-align:right;padding:10px 12px}',
    'tbody td{padding:10px 12px;border-bottom:1px solid #dde2e8;vertical-align:top}',
    'tbody tr:nth-child(even){background:#f4f6f8}',
    'td.num-col{font-weight:700;color:#1c3d5e;width:28px}',
    '.price-table th:last-child,.price-table td:last-child{text-align:left;white-space:nowrap}',
    '.price-table tfoot td{border-top:1px solid #dde2e8;padding:9px 12px;font-weight:700;color:#4b5563}',
    '.price-table tfoot tr.grand td{border-top:2px solid #1c3d5e;padding:13px 12px;font-weight:800;font-size:15.5px;background:#e7f5ec;color:#1f7a43}',
    '.price-note{margin-top:10px;font-size:12px;color:#8992a0}',
    '.terms-box{background:#eaf3fa;border-right:4px solid #1c3d5e;border-radius:3px;padding:16px 18px;margin-top:14px}',
    '.terms-box .cap{font-weight:700;font-size:14px;color:#1c3d5e;margin:0 0 10px}',
    '.terms-box ul{list-style:none;margin:0;padding:0;font-size:13.5px;color:#4b5563}',
    '.terms-box li{padding-right:14px;position:relative;margin-bottom:7px}',
    '.terms-box li:before{content:"\\2014";position:absolute;right:0;color:#1c3d5e}',
    '.callout{background:#fbf6ec;border-right:4px solid #c99a3a;border-radius:3px;padding:14px 18px;margin-top:14px;font-size:14.5px;color:#1b2430}',
    '.callout p{margin:0 0 8px;color:#1b2430}',
    '.sign-table td{border:1px solid #dde2e8;padding:14px 12px;font-weight:700;font-size:12.5px;color:#1c3d5e}',
    '.sign-table tr:first-child td{background:#f4f6f8}',
    '.foot{margin-top:26px;padding-top:14px;border-top:2px solid #c99a3a;display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;font-size:12px;color:#8992a0}',
    '.sources{font-size:12px;color:#8992a0;word-break:break-all}',
    '[contenteditable]{outline:1px dashed rgba(201,154,58,.55);outline-offset:2px;border-radius:2px;cursor:text}',
    '[contenteditable]:hover{background:#fffaf0}[contenteditable]:focus{outline:2px solid #c99a3a;background:#fffdf7}',
    '@media print{body{background:#fff}.sheet{box-shadow:none;border:none;margin:0;max-width:none;padding:0}}',
    '@media (max-width:560px){.sheet{padding:20px 18px}h1{font-size:21px}table{font-size:12px}thead th,tbody td{padding:7px}}'
  ].join('\n');

  // Word reads the same HTML but knows only simple CSS
  var WORD_CSS = '\nbody{background:#fff;font-family:Arial,sans-serif}.sheet{border:none;box-shadow:none;margin:0;padding:0;max-width:none}' +
    'h2{display:inline-block}.meta-row div{display:block}';

  function docSection(sec, i, edit, vatPct) {
    var P = 'sections.' + i + '.', k = sec.kind;
    var h = sec.heading || edit ? E(P + 'heading', sec.heading, edit, 'h2') : '', b = '';
    var paras = arr(sec.paragraphs).map(function (x, j) { return E(P + 'paragraphs.' + j, x, edit, 'p'); }).join('');
    var buls = function (cls) { return '<ul' + (cls ? ' class="' + cls + '"' : '') + '>' + arr(sec.bullets).map(function (x, j) { return E(P + 'bullets.' + j, x, edit, 'li'); }).join('') + '</ul>'; };
    if (k === 'bullets') b = paras + buls('bul');
    else if (k === 'table' && sec.table) {
      var t = sec.table, numbered = !!t.numbered;
      b = paras + '<table><thead><tr>' + (numbered ? '<th style="width:28px">#</th>' : '') + arr(t.headers).map(function (x, j) { return E(P + 'table.headers.' + j, x, edit, 'th'); }).join('') + '</tr></thead><tbody>' +
        arr(t.rows).map(function (r, ri) {
          return '<tr>' + (numbered ? '<td class="num-col">' + (ri + 1) + '</td>' : '') + arr(r).map(function (c, ci) {
            return '<td>' + (ci === 0 && numbered ? '<strong>' + E(P + 'table.rows.' + ri + '.' + ci, c, edit) + '</strong>' : E(P + 'table.rows.' + ri + '.' + ci, c, edit)) + '</td>';
          }).join('') + '</tr>';
        }).join('') + '</tbody></table>';
    } else if (k === 'pricing' && sec.pricing) {
      var p = sec.pricing;
      if (newPricing(p)) {
        var T = priceTotals(p, vatPct);
        b = paras + '<table class="price-table"><thead><tr><th>תיאור</th><th>כמות</th><th>מחיר ליחידה</th><th>סה"כ</th></tr></thead><tbody>' +
          arr(p.rows).map(function (r, ri) {
            var R = P + 'pricing.rows.' + ri + '.';
            return '<tr><td>' + E(R + 'description', r.description, edit) + '</td><td>' + E(R + 'quantity', r.quantity, edit, 'span', '', true) + ' ' + E(R + 'unit', r.unit, edit) + '</td>' +
              '<td>' + E(R + 'unit_price', r.unit_price, edit, 'span', '', true) + ' ₪</td><td>' + nis(T.lines[ri]) + '</td></tr>';
          }).join('') + '</tbody><tfoot>' +
          (T.mode === 'plus_vat' ? '<tr><td colspan="3">סה"כ לפני מע"מ</td><td>' + nis(T.sub) + '</td></tr><tr><td colspan="3">מע"מ ' + T.vatPct + '%</td><td>' + nis(T.vat) + '</td></tr>' : '') +
          '<tr class="grand"><td colspan="3">סה"כ לתשלום' + (T.mode === 'included' ? ' (כולל מע"מ)' : T.mode === 'none' ? '' : ' כולל מע"מ') + '</td><td>' + nis(T.total) + '</td></tr></tfoot></table>' +
          (p.note || edit ? E(P + 'pricing.note', p.note, edit, 'div', 'price-note') : '');
      } else { // results made before VAT was calculated
        b = paras + '<table class="price-table"><thead><tr><th>תיאור</th><th>כמות / שעות</th><th>מחיר</th><th>סה"כ</th></tr></thead><tbody>' +
          arr(p.rows).map(function (r) { return '<tr><td>' + esc(r.description) + '</td><td>' + esc(r.quantity) + '</td><td>' + esc(r.rate) + '</td><td>' + esc(r.total) + '</td></tr>'; }).join('') +
          '</tbody><tfoot><tr class="grand"><td colspan="3">סה"כ לתשלום</td><td>' + esc(p.total) + '</td></tr></tfoot></table>' + (p.note ? '<div class="price-note">' + esc(p.note) + '</div>' : '');
      }
    } else if (k === 'terms') {
      b = '<div class="terms-box">' + (arr(sec.paragraphs)[0] != null ? E(P + 'paragraphs.0', sec.paragraphs[0], edit, 'div', 'cap') : '') + buls() +
        (arr(sec.paragraphs)[1] != null ? '<p style="font-size:12px;color:#8992a0;margin:12px 0 0">' + E(P + 'paragraphs.1', sec.paragraphs[1], edit) + '</p>' : '') + '</div>';
    } else if (k === 'signature') {
      b = '<table class="sign-table"><tr><td colspan="2">' + E(P + 'paragraphs.0', arr(sec.paragraphs)[0] || 'סוג תשלום: העברה בנקאית', edit) + '</td></tr><tr><td>שם חברה</td><td>ח.פ</td></tr><tr><td>תאריך חתימה</td><td>חתימה</td></tr></table>';
    } else if (k === 'callout') {
      b = '<div class="callout">' + paras + '</div>';
    } else b = paras + (arr(sec.bullets).length ? buls('bul') : '');
    return '<div class="section">' + h + b + '</div>';
  }

  // The A.L Systems letterhead (as on the site header). A table, because Word ignores flexbox.
  function letterhead(markUrl) {
    return '<table class="brandbar"><tr>' +
      '<td style="width:62px"><img src="' + esc(markUrl) + '" width="62" height="55" alt="A.L Systems"></td>' +
      '<td class="bt"><b>A.L Systems</b><span>מערכות AI לעסקים</span></td>' +
      '<td class="bc">al-systems.co.il<br>050-9143496</td></tr></table>';
  }

  // doc: {title, subtitle, to, date, sections, sources, footer_note, quote_no?, to_company_no?, vat_pct?}
  // markUrl: absolute URL of assets/studio-mark.png
  function docHtml(doc, markUrl, forWord, edit) {
    var right = (doc.to || edit ? 'לכבוד: <strong>' + E('to', doc.to, edit) + '</strong>' : '') + (doc.to_company_no ? ' · ח.פ ' + esc(doc.to_company_no) : '');
    var left = (doc.quote_no ? 'הצעה מס\' <strong>' + esc(doc.quote_no) + '</strong>' + (doc.date ? ' · ' : '') : '') + (doc.date || edit ? 'תאריך: <strong>' + E('date', doc.date, edit) + '</strong>' : '');
    var meta = right || left ? '<div class="meta-row"><div>' + right + '</div><div>' + left + '</div></div>' : '';
    var src = nonEmpty(doc.sources);
    var body = '<div class="sheet">' + (markUrl ? letterhead(markUrl) : '') +
      E('title', doc.title, edit, 'h1') + (doc.subtitle || edit ? E('subtitle', doc.subtitle, edit, 'p', 'subtitle') : '') + meta +
      arr(doc.sections).map(function (sec, i) { return docSection(sec, i, edit, doc.vat_pct); }).join('') +
      (src.length ? '<div class="section"><h2>מקורות</h2><ol class="sources">' + src.map(function (u) { return '<li>' + esc(u) + '</li>'; }).join('') + '</ol></div>' : '') +
      '<div class="foot"><div>' + E('footer_note', doc.footer_note || '', edit) + '</div><div>A.L Systems · al-systems.co.il</div></div></div>';
    return '<!DOCTYPE html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>' + esc(doc.title) + '</title>' +
      (forWord ? '' : '<link href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;500;700;800&display=swap" rel="stylesheet">') +
      '<style>' + DOC_CSS + (forWord ? WORD_CSS : '') + '</style></head><body>' + body + '</body></html>';
  }

  // plain text of a doc, for "copy"
  function docText(doc) {
    var out = [s(doc.title), s(doc.subtitle), ''];
    if (doc.to) out.splice(2, 0, 'לכבוד: ' + doc.to);
    if (doc.quote_no) out.splice(2, 0, 'הצעה מס\' ' + doc.quote_no);
    arr(doc.sections).forEach(function (sec) {
      if (sec.heading) out.push(s(sec.heading));
      nonEmpty(sec.paragraphs).forEach(function (p) { out.push(p); });
      nonEmpty(sec.bullets).forEach(function (b) { out.push('• ' + b); });
      if (sec.kind === 'table' && sec.table) arr(sec.table.rows).forEach(function (r) { out.push(arr(r).join(' | ')); });
      if (sec.kind === 'pricing' && sec.pricing && newPricing(sec.pricing)) {
        var T = priceTotals(sec.pricing, doc.vat_pct);
        arr(sec.pricing.rows).forEach(function (r, i) { out.push(s(r.description) + ' | ' + r.quantity + ' ' + s(r.unit) + ' × ' + nis(r.unit_price) + ' = ' + nis(T.lines[i])); });
        if (T.mode === 'plus_vat') { out.push('לפני מע"מ: ' + nis(T.sub)); out.push('מע"מ ' + T.vatPct + '%: ' + nis(T.vat)); }
        out.push('סה"כ לתשלום: ' + nis(T.total));
      }
      out.push('');
    });
    return out.join('\n').trim();
  }

  // ---------- real Word file (.docx) ----------
  // X: the docx library (window.docx); mark: ArrayBuffer of the A.L mark
  function buildDocx(X, doc, mark) {
    var NAVY = '1C3D5E', GOLD = 'C99A3A', SOFT = '4B5563', FAINT = '8992A0', LINE = 'DDE2E8';
    var F = 'Arial';
    function run(t, o) { o = o || {}; return new X.TextRun({ text: s(t), font: F, rightToLeft: true, size: o.size || 22, bold: !!o.bold, color: o.color || '1B2430' }); }
    function para(t, o) {
      o = o || {};
      return new X.Paragraph({
        bidirectional: true, alignment: o.align || X.AlignmentType.LEFT, spacing: { before: o.before || 0, after: o.after == null ? 120 : o.after },
        children: Array.isArray(t) ? t : [run(t, o)], border: o.border, shading: o.shading, indent: o.indent
      });
    }
    var none = { style: X.BorderStyle.NONE, size: 0, color: 'FFFFFF' };
    var noBorders = { top: none, bottom: none, left: none, right: none, insideHorizontal: none, insideVertical: none };
    function cell(t, o) {
      o = o || {};
      return new X.TableCell({
        children: (Array.isArray(t) ? t : [t]).map(function (x) { return x instanceof X.Paragraph ? x : para(x, { bold: o.bold, color: o.color, size: o.size || 20, after: 0, align: o.align }); }),
        shading: o.fill ? { fill: o.fill, type: X.ShadingType.CLEAR, color: 'auto' } : undefined,
        margins: { top: 90, bottom: 90, left: 120, right: 120 }, columnSpan: o.span, width: o.width,
        borders: o.borders, verticalAlign: X.VerticalAlign ? X.VerticalAlign.CENTER : undefined
      });
    }
    function table(rows, widths) {
      return new X.Table({
        rows: rows, visuallyRightToLeft: true, width: { size: 100, type: X.WidthType.PERCENTAGE },
        columnWidths: widths,
        borders: { top: none, left: none, right: none, bottom: { style: X.BorderStyle.SINGLE, size: 4, color: LINE }, insideHorizontal: { style: X.BorderStyle.SINGLE, size: 4, color: LINE }, insideVertical: none }
      });
    }
    function headRow(hs) { return new X.TableRow({ tableHeader: true, children: hs.map(function (h) { return cell(h, { fill: NAVY, color: 'FFFFFF', bold: true }); }) }); }
    function h2(t) { return para(t, { bold: true, size: 26, color: NAVY, before: 280, after: 140, border: { bottom: { style: X.BorderStyle.SINGLE, size: 18, color: GOLD, space: 4 } } }); }

    var kids = [];
    // letterhead: mark | name + tagline | contact
    kids.push(new X.Table({
      visuallyRightToLeft: true, width: { size: 100, type: X.WidthType.PERCENTAGE }, borders: Object.assign({}, noBorders, { bottom: { style: X.BorderStyle.SINGLE, size: 18, color: GOLD } }),
      rows: [new X.TableRow({ children: [
        new X.TableCell({ width: { size: 12, type: X.WidthType.PERCENTAGE }, borders: noBorders, margins: { bottom: 120 }, children: [new X.Paragraph({ children: mark ? [new X.ImageRun({ data: mark, transformation: { width: 62, height: 55 } })] : [] })] }),
        new X.TableCell({ width: { size: 58, type: X.WidthType.PERCENTAGE }, borders: noBorders, margins: { bottom: 120 }, children: [para('A.L Systems', { bold: true, size: 40, color: '142A45', after: 0 }), para('מערכות AI לעסקים', { bold: true, size: 22, color: '9C7530', after: 0 })] }),
        new X.TableCell({ width: { size: 30, type: X.WidthType.PERCENTAGE }, borders: noBorders, margins: { bottom: 120 }, children: [para('al-systems.co.il', { size: 18, color: FAINT, after: 0, align: X.AlignmentType.RIGHT }), para('050-9143496', { size: 18, color: FAINT, after: 0, align: X.AlignmentType.RIGHT })] })
      ] })]
    }));
    kids.push(para(doc.title, { bold: true, size: 40, color: NAVY, before: 300, after: 80 }));
    if (doc.subtitle) kids.push(para(doc.subtitle, { size: 22, color: SOFT, after: 200 }));
    var metaR = (doc.to ? 'לכבוד: ' + doc.to : '') + (doc.to_company_no ? ' · ח.פ ' + doc.to_company_no : '');
    var metaL = (doc.quote_no ? 'הצעה מס\' ' + doc.quote_no + (doc.date ? ' · ' : '') : '') + (doc.date ? 'תאריך: ' + doc.date : '');
    if (metaR || metaL) {
      var line = { style: X.BorderStyle.SINGLE, size: 4, color: LINE };
      kids.push(new X.Table({
        visuallyRightToLeft: true, width: { size: 100, type: X.WidthType.PERCENTAGE }, borders: Object.assign({}, noBorders, { top: line, bottom: line }),
        rows: [new X.TableRow({ children: [cell(metaR, { bold: true, borders: noBorders }), cell(metaL, { bold: true, align: X.AlignmentType.RIGHT, borders: noBorders })] })]
      }));
    }
    arr(doc.sections).forEach(function (sec) {
      if (sec.heading) kids.push(h2(sec.heading));
      var paras = nonEmpty(sec.paragraphs), buls = nonEmpty(sec.bullets);
      if (sec.kind === 'terms') {
        var tb = [];
        if (paras[0]) tb.push(para(paras[0], { bold: true, color: NAVY, size: 21 }));
        buls.forEach(function (b) { tb.push(para('— ' + b, { color: SOFT, size: 21, after: 60 })); });
        if (paras[1]) tb.push(para(paras[1], { color: FAINT, size: 17, before: 100, after: 0 }));
        kids.push(new X.Table({ visuallyRightToLeft: true, width: { size: 100, type: X.WidthType.PERCENTAGE }, borders: Object.assign({}, noBorders, { right: { style: X.BorderStyle.SINGLE, size: 24, color: NAVY } }),
          rows: [new X.TableRow({ children: [new X.TableCell({ children: tb, shading: { fill: 'EAF3FA', type: X.ShadingType.CLEAR, color: 'auto' }, margins: { top: 160, bottom: 160, left: 220, right: 220 } })] })] }));
        return;
      }
      if (sec.kind === 'callout') {
        kids.push(new X.Table({ visuallyRightToLeft: true, width: { size: 100, type: X.WidthType.PERCENTAGE }, borders: Object.assign({}, noBorders, { right: { style: X.BorderStyle.SINGLE, size: 24, color: GOLD } }),
          rows: [new X.TableRow({ children: [new X.TableCell({ children: paras.map(function (p) { return para(p, { size: 22 }); }), shading: { fill: 'FBF6EC', type: X.ShadingType.CLEAR, color: 'auto' }, margins: { top: 140, bottom: 140, left: 220, right: 220 } })] })] }));
        return;
      }
      if (sec.kind === 'signature') {
        var b2 = { style: X.BorderStyle.SINGLE, size: 4, color: LINE }, all = { top: b2, bottom: b2, left: b2, right: b2 };
        kids.push(new X.Table({ visuallyRightToLeft: true, width: { size: 100, type: X.WidthType.PERCENTAGE },
          rows: [
            new X.TableRow({ children: [cell(paras[0] || 'סוג תשלום: העברה בנקאית', { bold: true, color: NAVY, span: 2, fill: 'F4F6F8', borders: all })] }),
            new X.TableRow({ height: { value: 600, rule: 'atLeast' }, children: [cell('שם חברה', { bold: true, color: NAVY, borders: all }), cell('ח.פ', { bold: true, color: NAVY, borders: all })] }),
            new X.TableRow({ height: { value: 600, rule: 'atLeast' }, children: [cell('תאריך חתימה', { bold: true, color: NAVY, borders: all }), cell('חתימה', { bold: true, color: NAVY, borders: all })] })
          ] }));
        return;
      }
      paras.forEach(function (p) { kids.push(para(p, { color: SOFT, size: 22 })); });
      if (sec.kind === 'bullets' || (sec.kind === 'text' && buls.length)) buls.forEach(function (b) { kids.push(para('• ' + b, { color: SOFT, size: 22, after: 60 })); });
      if (sec.kind === 'table' && sec.table) {
        var t = sec.table, num = !!t.numbered;
        var hs = (num ? ['#'] : []).concat(arr(t.headers).map(s));
        kids.push(table([headRow(hs)].concat(arr(t.rows).map(function (r, i) {
          return new X.TableRow({ children: (num ? [cell(String(i + 1), { bold: true, color: NAVY, fill: i % 2 ? 'F4F6F8' : undefined })] : []).concat(arr(r).map(function (c, j) {
            return cell(s(c), { bold: num && j === 0, fill: i % 2 ? 'F4F6F8' : undefined });
          })) });
        }))));
      }
      if (sec.kind === 'pricing' && sec.pricing) {
        var p = sec.pricing;
        if (newPricing(p)) {
          var T = priceTotals(p, doc.vat_pct), rows = [headRow(['תיאור', 'כמות', 'מחיר ליחידה', 'סה"כ'])];
          arr(p.rows).forEach(function (r, i) { rows.push(new X.TableRow({ children: [cell(s(r.description)), cell(r.quantity + ' ' + s(r.unit)), cell(nis(r.unit_price)), cell(nis(T.lines[i]), { align: X.AlignmentType.RIGHT })] })); });
          if (T.mode === 'plus_vat') {
            rows.push(new X.TableRow({ children: [cell('סה"כ לפני מע"מ', { span: 3, bold: true, color: SOFT }), cell(nis(T.sub), { bold: true, color: SOFT, align: X.AlignmentType.RIGHT })] }));
            rows.push(new X.TableRow({ children: [cell('מע"מ ' + T.vatPct + '%', { span: 3, bold: true, color: SOFT }), cell(nis(T.vat), { bold: true, color: SOFT, align: X.AlignmentType.RIGHT })] }));
          }
          rows.push(new X.TableRow({ children: [cell('סה"כ לתשלום' + (T.mode === 'none' ? '' : ' כולל מע"מ'), { span: 3, bold: true, color: '1F7A43', fill: 'E7F5EC', size: 24 }), cell(nis(T.total), { bold: true, color: '1F7A43', fill: 'E7F5EC', size: 24, align: X.AlignmentType.RIGHT })] }));
          kids.push(table(rows));
        } else {
          kids.push(table([headRow(['תיאור', 'כמות / שעות', 'מחיר', 'סה"כ'])].concat(arr(p.rows).map(function (r) { return new X.TableRow({ children: [cell(s(r.description)), cell(s(r.quantity)), cell(s(r.rate)), cell(s(r.total))] }); }))
            .concat([new X.TableRow({ children: [cell('סה"כ לתשלום', { span: 3, bold: true, color: '1F7A43', fill: 'E7F5EC' }), cell(s(p.total), { bold: true, color: '1F7A43', fill: 'E7F5EC' })] })])));
        }
        if (p.note) kids.push(para(p.note, { size: 17, color: FAINT, before: 100 }));
      }
    });
    var src = nonEmpty(doc.sources);
    if (src.length) { kids.push(h2('מקורות')); src.forEach(function (u, i) { kids.push(para((i + 1) + '. ' + u, { size: 17, color: FAINT, after: 40 })); }); }
    kids.push(para([run(s(doc.footer_note || ''), { size: 17, color: FAINT }), run('    A.L Systems · al-systems.co.il', { size: 17, color: FAINT })],
      { before: 360, border: { top: { style: X.BorderStyle.SINGLE, size: 12, color: GOLD, space: 6 } } }));
    return new X.Document({
      creator: 'A.L Systems', title: s(doc.title),
      styles: { default: { document: { run: { font: F, rightToLeft: true } } } },
      sections: [{ properties: { page: { margin: { top: 900, bottom: 900, left: 1000, right: 1000 } } }, children: kids }]
    });
  }

  var api = { buildDeck: buildDeck, deckPreview: deckPreview, docHtml: docHtml, docText: docText, buildDocx: buildDocx, readEdits: readEdits, priceTotals: priceTotals };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ALStudioRender = api;
})(typeof window !== 'undefined' ? window : this);
