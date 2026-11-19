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

  // ---------- HTML preview of a deck (what the dashboard shows) ----------
  function esc(v) { return s(v).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function deckPreview(deck, markUrl) {
    var slides = arr(deck.slides);
    if (!slides.length || slides[0].layout !== 'cover') slides = [{ layout: 'cover', title: deck.title, subtitle: deck.subtitle }].concat(slides);
    return slides.map(function (sl, i) {
      var L = sl.layout, inner = '';
      if (L === 'cover' || L === 'closing' || L === 'section') {
        inner = '<div class="sp-dark">' + (L !== 'section' && markUrl ? '<img src="' + esc(markUrl) + '" alt="">' : '') +
          '<div><b>' + esc(sl.title || (L === 'closing' ? 'תודה' : deck.title)) + '</b><span>' + esc(sl.subtitle || (L === 'cover' ? deck.subtitle : '')) + '</span></div></div>';
      } else {
        var body = '';
        if (L === 'table' && sl.table) {
          body = '<table><tr>' + arr(sl.table.headers).map(function (h) { return '<th>' + esc(h) + '</th>'; }).join('') + '</tr>' +
            arr(sl.table.rows).slice(0, 7).map(function (r) { return '<tr>' + arr(r).map(function (c) { return '<td>' + esc(c) + '</td>'; }).join('') + '</tr>'; }).join('') + '</table>';
        } else if (L === 'stats') {
          body = '<div class="sp-stats">' + arr(sl.stats).map(function (k) { return '<div><b>' + esc(k.value) + '</b><span>' + esc(k.label) + '</span></div>'; }).join('') + '</div>';
        } else if (L === 'two_columns') {
          body = '<div class="sp-cols">' + arr(sl.columns).map(function (c) { return '<div><b>' + esc(c.heading) + '</b><ul>' + nonEmpty(c.bullets).slice(0, 5).map(function (b) { return '<li>' + esc(b) + '</li>'; }).join('') + '</ul></div>'; }).join('') + '</div>';
        } else if (L === 'chart' && sl.chart) {
          var vals = arr((arr(sl.chart.series)[0] || {}).values).map(Number), mx = Math.max.apply(null, vals.concat([1]));
          body = '<div class="sp-chart">' + vals.map(function (v, j) { return '<i style="height:' + Math.max(4, Math.round(v / mx * 100)) + '%" title="' + esc(arr(sl.chart.labels)[j]) + ': ' + v + '"></i>'; }).join('') + '</div>';
        } else {
          body = '<ul>' + nonEmpty(sl.bullets).slice(0, 7).map(function (b) { return '<li>' + esc(b) + '</li>'; }).join('') + '</ul>';
        }
        inner = '<div class="sp-light"><h5>' + esc(sl.title) + '</h5>' + body + '<em>' + (i + 1) + '</em></div>';
      }
      return '<div class="sp-slide">' + inner + '</div>';
    }).join('');
  }

  // ---------- documents (the A.L quote template) ----------
  var DOC_CSS = [
    '@page{size:A4;margin:14mm 12mm}',
    'body{margin:0;background:#eef1f4;color:#1b2430;font-family:Heebo,Arial,sans-serif;direction:rtl;line-height:1.65}',
    '.sheet{max-width:780px;margin:24px auto;background:#fff;border:1px solid #dde2e8;border-radius:4px;box-shadow:0 16px 40px -24px rgba(15,20,30,.25);padding:28px 44px 30px}',
    '.brandbar{width:100%;border-collapse:collapse;margin:0 0 22px;border-bottom:3px solid #c99a3a}',
    '.brandbar td{padding:0 0 14px;vertical-align:middle;border:none}',
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
    '.price-table th:last-child,.price-table td:last-child{text-align:left}',
    '.price-table tfoot td{border-top:2px solid #1c3d5e;padding:13px 12px;font-weight:800;font-size:15.5px;background:#e7f5ec;color:#1f7a43}',
    '.price-note{margin-top:10px;font-size:12px;color:#8992a0}',
    '.terms-box{background:#eaf3fa;border-right:4px solid #1c3d5e;border-radius:3px;padding:16px 18px;margin-top:14px}',
    '.terms-box .cap{font-weight:700;font-size:14px;color:#1c3d5e;margin:0 0 10px}',
    '.terms-box ul{list-style:none;margin:0;padding:0;font-size:13.5px;color:#4b5563}',
    '.terms-box li{padding-right:14px;position:relative;margin-bottom:7px}',
    '.terms-box li:before{content:"\\2014";position:absolute;right:0;color:#1c3d5e}',
    '.callout{background:#fbf6ec;border-right:4px solid #c99a3a;border-radius:3px;padding:14px 18px;margin-top:14px;font-size:14.5px;color:#1b2430}',
    '.sign-table td{border:1px solid #dde2e8;padding:14px 12px;font-weight:700;font-size:12.5px;color:#1c3d5e}',
    '.sign-table tr:first-child td{background:#f4f6f8}',
    '.foot{margin-top:26px;padding-top:14px;border-top:2px solid #c99a3a;display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;font-size:12px;color:#8992a0}',
    '.sources{font-size:12px;color:#8992a0;word-break:break-all}',
    '@media print{body{background:#fff}.sheet{box-shadow:none;border:none;margin:0;max-width:none;padding:0}}',
    '@media (max-width:560px){.sheet{padding:20px 18px}h1{font-size:21px}table{font-size:12px}thead th,tbody td{padding:7px}}'
  ].join('\n');

  // Word reads the same HTML but knows only simple CSS: a plain white page,
  // no card, the logo at its real proportions.
  var WORD_CSS = '\nbody{background:#fff;font-family:Arial,sans-serif}.sheet{border:none;box-shadow:none;margin:0;padding:0;max-width:none}' +
    'h2{display:inline-block}.meta-row div{display:block}';

  function para(text) { return nonEmpty(s(text).split(/\n{2,}/)).map(function (p) { return '<p>' + esc(p).replace(/\n/g, '<br>') + '</p>'; }).join(''); }

  function docSection(sec) {
    var k = sec.kind, h = sec.heading ? '<h2>' + esc(sec.heading) + '</h2>' : '', b = '';
    var paras = nonEmpty(sec.paragraphs).map(para).join('');
    if (k === 'bullets') b = paras + '<ul class="bul">' + nonEmpty(sec.bullets).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>';
    else if (k === 'table' && sec.table) {
      var t = sec.table, numbered = !!t.numbered;
      b = paras + '<table><thead><tr>' + (numbered ? '<th style="width:28px">#</th>' : '') + arr(t.headers).map(function (x) { return '<th>' + esc(x) + '</th>'; }).join('') + '</tr></thead><tbody>' +
        arr(t.rows).map(function (r, i) { return '<tr>' + (numbered ? '<td class="num-col">' + (i + 1) + '</td>' : '') + arr(r).map(function (c, j) { return '<td>' + (j === 0 && numbered ? '<strong>' + esc(c) + '</strong>' : esc(c)) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table>';
    } else if (k === 'pricing' && sec.pricing) {
      var p = sec.pricing;
      b = paras + '<table class="price-table"><thead><tr><th>תיאור</th><th>כמות / שעות</th><th>מחיר</th><th>סה"כ</th></tr></thead><tbody>' +
        arr(p.rows).map(function (r) { return '<tr><td>' + esc(r.description) + '</td><td>' + esc(r.quantity) + '</td><td>' + esc(r.rate) + '</td><td>' + esc(r.total) + '</td></tr>'; }).join('') +
        '</tbody><tfoot><tr><td colspan="3">סה"כ לתשלום</td><td>' + esc(p.total) + '</td></tr></tfoot></table>' + (p.note ? '<div class="price-note">' + esc(p.note) + '</div>' : '');
    } else if (k === 'terms') {
      b = '<div class="terms-box">' + (sec.paragraphs && sec.paragraphs[0] ? '<div class="cap">' + esc(sec.paragraphs[0]) + '</div>' : '') + '<ul>' + nonEmpty(sec.bullets).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' +
        (sec.paragraphs && sec.paragraphs[1] ? '<p style="font-size:12px;color:#8992a0;margin:12px 0 0">' + esc(sec.paragraphs[1]) + '</p>' : '') + '</div>';
    } else if (k === 'signature') {
      b = '<table class="sign-table"><tr><td colspan="2">' + esc(nonEmpty(sec.paragraphs)[0] || 'סוג תשלום: העברה בנקאית') + '</td></tr><tr><td>שם חברה</td><td>ח.פ</td></tr><tr><td>תאריך חתימה</td><td>חתימה</td></tr></table>';
    } else if (k === 'callout') {
      b = '<div class="callout">' + nonEmpty(sec.paragraphs).map(esc).join('<br><br>') + '</div>';
    } else b = paras + (nonEmpty(sec.bullets).length ? '<ul class="bul">' + nonEmpty(sec.bullets).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' : '');
    return '<div class="section">' + h + b + '</div>';
  }

  // doc: {title, subtitle, to, date, sections:[...], sources:[...], footer_note}
  // The A.L Systems letterhead (the brand as on the site header): the A.L
  // mark, the name and the tagline, contact details on the left. A table,
  // because Word ignores flexbox.
  function letterhead(markUrl) {
    return '<table class="brandbar"><tr>' +
      '<td style="width:62px"><img src="' + esc(markUrl) + '" width="62" height="55" alt="A.L Systems"></td>' +
      '<td class="bt"><b>A.L Systems</b><span>מערכות AI לעסקים</span></td>' +
      '<td class="bc">al-systems.co.il<br>050-9143496</td></tr></table>';
  }

  // bannerUrl: absolute URL of assets/studio-mark.png (the A.L mark)
  function docHtml(doc, bannerUrl, forWord) {
    var meta = (doc.to || doc.date) ? '<div class="meta-row"><div>' + (doc.to ? 'לכבוד: <strong>' + esc(doc.to) + '</strong>' : '') + '</div><div>' + (doc.date ? 'תאריך: <strong>' + esc(doc.date) + '</strong>' : '') + '</div></div>' : '';
    var src = nonEmpty(doc.sources);
    var body = '<div class="sheet">' +
      (bannerUrl ? letterhead(bannerUrl) : '') +
      '<h1>' + esc(doc.title) + '</h1>' + (doc.subtitle ? '<p class="subtitle">' + esc(doc.subtitle) + '</p>' : '') + meta +
      arr(doc.sections).map(docSection).join('') +
      (src.length ? '<div class="section"><h2>מקורות</h2><ol class="sources">' + src.map(function (u) { return '<li>' + esc(u) + '</li>'; }).join('') + '</ol></div>' : '') +
      '<div class="foot"><div>' + esc(doc.footer_note || '') + '</div><div>A.L Systems · al-systems.co.il</div></div></div>';
    return '<!DOCTYPE html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>' + esc(doc.title) + '</title>' +
      (forWord ? '' : '<link href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;500;700;800&display=swap" rel="stylesheet">') +
      '<style>' + DOC_CSS + (forWord ? WORD_CSS : '') + '</style></head><body>' + body + '</body></html>';
  }

  // plain text of a doc, for "copy"
  function docText(doc) {
    var out = [s(doc.title), s(doc.subtitle), ''];
    arr(doc.sections).forEach(function (sec) {
      if (sec.heading) out.push(s(sec.heading));
      nonEmpty(sec.paragraphs).forEach(function (p) { out.push(p); });
      nonEmpty(sec.bullets).forEach(function (b) { out.push('• ' + b); });
      if (sec.table) arr(sec.table.rows).forEach(function (r) { out.push(arr(r).join(' | ')); });
      if (sec.pricing) { arr(sec.pricing.rows).forEach(function (r) { out.push(s(r.description) + ' | ' + s(r.total)); }); out.push('סה"כ: ' + s(sec.pricing.total)); }
      out.push('');
    });
    return out.join('\n').trim();
  }

  var api = { buildDeck: buildDeck, deckPreview: deckPreview, docHtml: docHtml, docText: docText };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ALStudioRender = api;
})(typeof window !== 'undefined' ? window : this);
