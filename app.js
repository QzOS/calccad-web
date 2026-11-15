/* The page around calccad's WebAssembly module (shell_web.c): the
   canvas, the scroll container whose bars are the view's, the menu bar
   (src/app/menu.c's table), the tools and the status bar; the mouse and
   the keys handed to the module as the Win32 window takes them (a key,
   then the character it types); the files (/work kept in IndexedDB, the
   examples in /examples), the clipboard, the dialogs and printing. */
(function () {
  'use strict';
  var C = {NEW: 100, OPEN: 101, SAVE: 102, SAVEAS: 103, EXIT: 104, PRINT: 105, SAVE_EMF: 106,
           UNDO: 200, REDO: 201, CUT: 202, DELETE: 205, COPY: 203, PASTE: 204, COPY_IMAGE: 207,
           INS_MATRIX: 303, INS_UNIT: 308, INS_FUNC: 309, INS_TABLE_CSV: 313, SYM_EVAL: 314,
           ZOOM_IN: 502, ZOOM_OUT: 503, ZOOM_100: 504, HELP: 600, ABOUT: 601, EXAMPLE: 602,
           VIEW_PAL0: 900, VIEW_STANDARD: 950, VIEW_RULER: 951, VIEW_STATUS: 952, VIEW_FORMAT: 953,
           /* the browser's own, in the File menu */
           UPLOAD: 1001, DOWNLOAD: 1002, FILES: 1003};
  var AM_END = 0, AM_ITEM = 1, AM_SEP = 2, AM_POPUP = 3;
  /* calccad's key codes (src/app/keys.h) */
  var AK = {Backspace: 8, Tab: 9, Enter: 13, Escape: 27, ' ': 32, ArrowLeft: 256, ArrowRight: 257, ArrowUp: 258,
            ArrowDown: 259, Home: 260, End: 261, PageUp: 262, PageDown: 263, Insert: 264, Delete: 265,
            '.': 266, '+': 267, '-': 268};
  var AK_F1 = 269;
  var view = document.getElementById('view'), canvas = document.getElementById('sheet');
  var scroller = document.getElementById('scroller'), spacer = document.getElementById('spacer');
  var keys = document.getElementById('keys'), dlg = document.getElementById('dlg');
  var M, FS, surface = 0, ratio = 1, pending = false, echo = null, clip = '', syncing = null;

  /* ---- drawing, the view, the status ---- */

  function paint() {
    if (pending)
      return;
    pending = true;
    requestAnimationFrame(function () {
      pending = false;
      M._cw_paint();
    });
  }

  /* the canvas covers the scroller's client (its bars beside it) in device pixels */
  function layout() {
    var w = scroller.clientWidth, h = scroller.clientHeight;
    ratio = window.devicePixelRatio || 1;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    canvas.width = Math.max(1, Math.round(w * ratio));
    canvas.height = Math.max(1, Math.round(h * ratio));
    return [canvas.width, canvas.height];
  }

  function resized() {
    var s = layout();
    M._cw_resize(s[0], s[1], ratio);
    /* the formula keyboard took the bottom: the input kept above it */
    if (!document.getElementById('mkb').classList.contains('hidden'))
      M._cw_reveal_input();
    paint();
  }

  /* the view's bars (device pixels, NT's ranges) as the spacer's size and the scroll position */
  function bars(vmax, vpage, vpos, hmax, hpage, hpos) {
    spacer.style.height = Math.max(1, (vmax + 1) / ratio) + 'px';
    spacer.style.width = Math.max(1, (hmax + 1) / ratio) + 'px';
    scroller.scrollTop = vpos / ratio;
    scroller.scrollLeft = hpos / ratio;
    /* the scroll event this causes is the view's own, not the user's: known
       by where it puts the scroller (not by time: a frame can be late) */
    echo = [scroller.scrollTop, scroller.scrollLeft];
    /* the bars may have taken or given back room */
    if (canvas.width !== Math.round(scroller.clientWidth * ratio) ||
        canvas.height !== Math.round(scroller.clientHeight * ratio))
      setTimeout(resized, 0);
  }

  function status(hint, note, manual) {
    document.getElementById('hint').textContent = hint;
    document.getElementById('note').textContent = note;
    document.getElementById('mode').textContent = manual ? 'MANUELL' : 'AUTO';
    document.getElementById('zoom').textContent = Math.round(M._cw_info(2) * 100) + ' %';
  }

  function str(p) {
    var t;
    if (!p)
      return null;
    t = M.UTF8ToString(p);
    M._free(p);
    return t;
  }

  function path() {
    var p = M._malloc(4096), t;
    M._cw_get_text(-3, p, 4096);
    t = M.UTF8ToString(p);
    M._free(p);
    return t;
  }

  /* ---- files: /work in IndexedDB, the examples in /examples ---- */

  function sync() {
    /* /work to IndexedDB, one at a time, the last change included; until
       it is written, leaving the page asks first (beforeunload) */
    if (syncing) {
      syncing.again = true;
      return;
    }
    syncing = {again: false};
    window.calccadSyncing = true;
    FS.syncfs(false, function () {
      var again = syncing.again;
      syncing = null;
      if (again)
        sync();
      else
        window.calccadSyncing = false;
    });
  }

  function mountWork() {
    return new Promise(function (resolve) {
      try { FS.mkdir('/work'); } catch (e) { /* there */ }
      try { FS.mkdir('/examples'); } catch (e) { /* there */ }
      try {
        FS.mount(M.IDBFS, {}, '/work');
      } catch (e) {
        resolve();
        return;
      }
      FS.syncfs(true, function () { resolve(); });
    });
  }

  function workFiles() {
    try {
      return FS.readdir('/work').filter(function (n) { return n !== '.' && n !== '..'; }).sort();
    } catch (e) {
      return [];
    }
  }

  function exists(p) {
    try { FS.stat(p); return true; } catch (e) { return false; }
  }

  function download(name, data, type) {
    var a = document.createElement('a'), url = URL.createObjectURL(new Blob([data], {type: type}));
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  /* a file from the computer: its name and text (or bytes) */
  function pick(accept, binary) {
    var input = document.getElementById('pick');
    return new Promise(function (resolve) {
      input.value = '';
      input.accept = accept || '';
      input.onchange = function () {
        var f = input.files[0];
        if (!f) {
          resolve(null);
          return;
        }
        (binary ? f.arrayBuffer() : f.text()).then(function (d) { resolve({name: f.name, data: d}); });
      };
      input.click();
    });
  }

  function load(name) {
    /* an example: fetched into /examples, opened from there */
    return fetch('examples/' + name).then(function (r) {
      if (!r.ok)
        throw new Error(name + ': ' + r.status);
      return r.text();
    }).then(function (text) {
      M._cw_probe(0, 0, 0); /* a new sheet: no measuring point */
      FS.writeFile('/examples/' + name, text);
      if (!M.ccall('cw_open_path', 'number', ['string'], ['/examples/' + name]))
        throw new Error(name + ': inget calccad-blad');
      window.calccadLoaded = name;
      focusKeys();
    });
  }

  /* ---- dialogs (one at a time, on <dialog>) ---- */

  function el(tag, attrs, kids) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'text') e.textContent = attrs[k];
      else if (k.slice(0, 2) === 'on') e[k] = attrs[k];
      else e.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (k) { e.appendChild(k); });
    return e;
  }

  /* a dialog with a title, a body and buttons [[label, value], ...]: the value of the one pressed */
  function ask(title, body, buttons) {
    return new Promise(function (resolve) {
      var row = el('div', {class: 'buttons'});
      dlg.innerHTML = '';
      dlg.appendChild(el('h2', {text: title}));
      if (body)
        dlg.appendChild(body);
      buttons.forEach(function (b, i) {
        row.appendChild(el('button', {text: b[0], value: String(i), onclick: function (e) {
          e.preventDefault();
          dlg.close(String(i));
        }}));
      });
      dlg.appendChild(row);
      dlg.onclose = function () {
        var i = dlg.returnValue === '' ? -1 : +dlg.returnValue;
        dlg.onclose = null;
        focusKeys();
        resolve(i >= 0 && i < buttons.length ? buttons[i][1] : null);
      };
      dlg.returnValue = '';
      dlg.showModal();
      if (body && body.querySelector && body.querySelector('input'))
        body.querySelector('input').focus();
    });
  }

  /* "save the changes?" before the sheet goes: true to go on */
  function confirmDiscard() {
    if (!M._cw_info(17))
      return Promise.resolve(true);
    return ask('Spara ändringarna i bladet?', null,
               [['Spara', 'save'], ['Spara inte', 'drop'], ['Avbryt', null]]).then(function (r) {
      if (r === 'drop') {
        M._cw_answer_save(0);
        return true;
      }
      if (r === 'save')
        return save(false);
      return false;
    });
  }

  /* a name in /work to save as: the path, or null */
  function askName() {
    var cur = path(), base = cur ? cur.replace(/^.*\//, '') : 'blad.ccad';
    var input = el('input', {type: 'text', value: base, size: '40'});
    var body = el('div', {}, [el('div', {text: 'Bladet sparas i webbläsarens arbetsfiler (Arkiv > Arbetsfiler).'}),
                              el('p', {}, [input])]);
    return ask('Spara som', body, [['Spara', 'ok'], ['Avbryt', null]]).then(function (r) {
      var n = input.value.trim().replace(/[\/\\]/g, '_');
      if (r !== 'ok' || !n)
        return null;
      if (!/\.ccad$/i.test(n))
        n += '.ccad';
      if (!exists('/work/' + n) || '/work/' + n === cur)
        return '/work/' + n;
      return ask(n + ' finns redan. Ersätta den?', null, [['Ersätt', 'yes'], ['Avbryt', null]]).then(function (y) {
        return y === 'yes' ? '/work/' + n : null;
      });
    });
  }

  /* Save (as: Save as): true when saved */
  function save(as) {
    var p = path();
    if (!as && p.indexOf('/work/') === 0) {
      M._cw_command(C.SAVE);
      return Promise.resolve(!M._cw_info(17));
    }
    return askName().then(function (np) {
      if (!np)
        return false;
      M.ccall('cw_answer_path', null, ['string'], [np]);
      M._cw_command(C.SAVEAS);
      return !M._cw_info(17);
    });
  }

  function openDialog() {
    var list = el('div', {class: 'list'}), chosen = null, body;
    var files = workFiles().filter(function (n) { return /\.ccad$/i.test(n); });
    files.forEach(function (n) {
      var row = el('div', {text: n, onclick: function () {
        Array.prototype.forEach.call(list.children, function (c) { c.classList.remove('sel'); });
        row.classList.add('sel');
        chosen = n;
      }, ondblclick: function () { chosen = n; dlg.close('0'); }});
      list.appendChild(row);
    });
    if (!files.length)
      list.appendChild(el('div', {text: '(inga sparade blad än)'}));
    body = el('div', {}, [el('div', {text: 'Blad i webbläsarens arbetsfiler:'}), list]);
    return ask('Öppna', body, [['Öppna', 'open'], ['Från datorn…', 'upload'], ['Avbryt', null]]).then(function (r) {
      if (r === 'open' && chosen) {
        if (!M.ccall('cw_open_path', 'number', ['string'], ['/work/' + chosen]))
          return ask('Filen kunde inte läsas som ett calccad-blad.', null, [['OK', null]]);
      } else if (r === 'upload') {
        return pick('.ccad,text/plain').then(function (f) {
          if (!f)
            return;
          FS.writeFile('/work/' + f.name, f.data);
          sync();
          if (!M.ccall('cw_open_path', 'number', ['string'], ['/work/' + f.name]))
            return ask('Filen kunde inte läsas som ett calccad-blad.', null, [['OK', null]]);
        });
      }
    });
  }

  function filesDialog() {
    var tbody = el('tbody');
    workFiles().forEach(function (n) {
      var size = FS.stat('/work/' + n).size;
      tbody.appendChild(el('tr', {}, [
        el('td', {text: n}), el('td', {text: size + ' B'}),
        el('td', {}, [el('button', {text: 'Ladda ner', onclick: function (e) {
          e.preventDefault();
          download(n, FS.readFile('/work/' + n), 'application/octet-stream');
        }})]),
        el('td', {}, [el('button', {text: 'Ta bort', onclick: function (e) {
          e.preventDefault();
          FS.unlink('/work/' + n);
          sync();
          e.target.closest('tr').remove();
        }})])]));
    });
    if (!tbody.children.length)
      tbody.appendChild(el('tr', {}, [el('td', {text: '(inga filer)'})]));
    return ask('Arbetsfiler', el('div', {}, [
      el('div', {text: 'Bladen och datafilerna (READPRN, WRITEPRN, READCSV …) i webbläsaren. Ett blad läser och skriver datafiler bredvid sig.'}),
      el('table', {}, [tbody])]), [['Ladda upp…', 'up'], ['Stäng', null]]).then(function (r) {
      if (r === 'up')
        return upload();
    });
  }

  function upload() {
    return pick('', true).then(function (f) {
      if (!f)
        return;
      FS.writeFile('/work/' + f.name, new Uint8Array(f.data));
      sync();
      document.getElementById('hint').textContent = f.name + ' finns nu i arbetsfilerna.';
    });
  }

  function listDialog(title, note, rows, show) {
    var filter = el('input', {type: 'search', placeholder: 'Sök', size: '40'}), list = el('div', {class: 'list'});
    var chosen = null;
    function fill() {
      var q = filter.value.toLowerCase();
      list.innerHTML = '';
      rows.forEach(function (r) {
        var t = show(r);
        if (q && t.toLowerCase().indexOf(q) < 0)
          return;
        list.appendChild(el('div', {text: t, onclick: function (e) {
          Array.prototype.forEach.call(list.children, function (c) { c.classList.remove('sel'); });
          e.target.classList.add('sel');
          chosen = r;
        }, ondblclick: function () { chosen = r; dlg.close('0'); }}));
      });
    }
    filter.oninput = fill;
    fill();
    return ask(title, el('div', {}, [el('div', {text: note}), el('p', {}, [filter]), list]),
               [['Infoga', 'ok'], ['Avbryt', null]]).then(function (r) {
      return r === 'ok' ? chosen : null;
    });
  }

  function matrixDialog() {
    var r = el('input', {type: 'number', min: '1', max: '100', value: String(M._cw_matrix_size(0)), size: '4'});
    var c = el('input', {type: 'number', min: '1', max: '100', value: String(M._cw_matrix_size(1)), size: '4'});
    return ask('Infoga matris', el('div', {}, [el('label', {text: 'Rader '}), r, el('label', {text: '  Kolumner '}), c]),
               [['OK', 'ok'], ['Avbryt', null]]).then(function (x) {
      var rows = Math.round(+r.value), cols = Math.round(+c.value);
      if (x === 'ok' && rows >= 1 && cols >= 1 && rows <= 100 && cols <= 100)
        M._cw_insert_matrix(rows, cols);
    });
  }

  /* ---- printing and pictures ---- */

  /* a canvas of w x h, white, as a surface; done(id) draws on it */
  function onCanvas(w, h, done) {
    var c = document.createElement('canvas'), g, id;
    c.width = w;
    c.height = h;
    g = c.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, w, h);
    id = M.cvwebRegister(c);
    done(id);
    M.cvwebUnregister(id);
    return c;
  }

  function printSheet() {
    /* A4 at 150 dpi, as Win32 prints on a printer of that resolution */
    var dpi = 150, pw = Math.round(8.27 * dpi), ph = Math.round(11.69 * dpi), out = document.getElementById('print');
    var n = M._cw_print_begin(dpi, pw, ph), k;
    out.innerHTML = '';
    for (k = 0; k < n; k++) {
      var c = onCanvas(pw, ph, function (id) { M._cw_print_page(k, id); });
      out.appendChild(el('img', {src: c.toDataURL('image/png'), alt: 'sida ' + (k + 1)}));
    }
    M._cw_print_end();
    window.calccadPrinted = n;
    if (!window.calccadNoPrint)
      setTimeout(function () { window.print(); }, 50);
  }

  function picture() {
    var w = M._cw_image_size(0), h = M._cw_image_size(1);
    if (!w || !h)
      return null;
    return onCanvas(w, h, function (id) { M._cw_image_draw(id); });
  }

  /* ---- the menu bar: src/app/menu.c's table ---- */

  /* the items the browser does not have */
  function off(id) {
    return id === C.EXIT || id === C.VIEW_RULER || id === C.VIEW_FORMAT || (id >= C.VIEW_PAL0 && id < C.VIEW_STANDARD);
  }

  function label(t) {
    /* "&Spara\tCtrl+S": the mnemonic underlined, the shortcut apart */
    var parts = t.split('\t'), name = parts[0], i = name.indexOf('&'), span = el('span');
    if (i >= 0 && i + 1 < name.length) {
      span.appendChild(document.createTextNode(name.slice(0, i)));
      span.appendChild(el('u', {text: name[i + 1]}));
      span.appendChild(document.createTextNode(name.slice(i + 2)));
    } else {
      span.textContent = name.replace('&', '');
    }
    return [span, parts[1] || ''];
  }

  function closeMenus() {
    Array.prototype.forEach.call(document.querySelectorAll('#menubar .top.open'), function (t) {
      t.classList.remove('open');
    });
  }

  function menuItem(id, text) {
    var l;
    if (id === C.SAVE_EMF)
      text = text.replace('EMF', 'PNG'); /* the browser saves a picture as PNG */
    l = label(text);
    var item = el('div', {class: 'item' + (off(id) ? ' off' : ''), 'data-id': String(id)},
                                         [l[0], el('span', {class: 'key', text: l[1]})]);
    item.onclick = function (e) {
      e.stopPropagation();
      if (off(id))
        return;
      closeMenus();
      command(id);
    };
    return item;
  }

  function buildMenu(table) {
    var bar = document.getElementById('menubar'), i = 0, stack = [];
    function items(menu) {
      for (; i < table.length; i++) {
        var t = table[i];
        if (t[0] === AM_END)
          return;
        if (t[0] === AM_SEP) {
          menu.appendChild(el('hr'));
        } else if (t[0] === AM_ITEM) {
          menu.appendChild(menuItem(t[1], t[2]));
          if (t[1] === C.SAVEAS && menu.dataset.file) {
            /* the browser's own beside Save as */
            menu.appendChild(el('hr'));
            menu.appendChild(menuItem(C.UPLOAD, '&Ladda upp fil till arbetsfilerna...'));
            menu.appendChild(menuItem(C.DOWNLOAD, 'Ladda &ner bladet'));
            menu.appendChild(menuItem(C.FILES, 'Arbets&filer...'));
          }
        } else if (t[0] === AM_POPUP) {
          var sub = el('div', {class: 'menu'}), item = el('div', {class: 'item sub'}, [label(t[2])[0]]);
          /* a tap opens it (no hover on a touch screen) */
          item.onclick = function (e) {
            if (e.target === e.currentTarget || e.target.parentNode === e.currentTarget) {
              e.stopPropagation();
              e.currentTarget.classList.toggle('open');
            }
          };
          i++;
          items(sub);
          item.appendChild(sub);
          menu.appendChild(item);
        }
        /* AM_PALETTES: Win32's toolbar palettes */
      }
    }
    for (; i < table.length && table[i][0] === AM_POPUP; i++) {
      var top = el('div', {class: 'top'}), menu = el('div', {class: 'menu'}), btn = el('button', {}, [label(table[i][2])[0]]);
      if (stack.length === 0)
        menu.dataset.file = '1';
      stack.push(top);
      btn.onclick = function (e) {
        var t = e.currentTarget.parentNode, was = t.classList.contains('open');
        e.stopPropagation();
        closeMenus();
        if (!was) {
          checks(t);
          t.classList.add('open');
        }
      };
      btn.onmouseenter = function (e) {
        var t = e.currentTarget.parentNode;
        if (document.querySelector('#menubar .top.open') && !t.classList.contains('open')) {
          closeMenus();
          checks(t);
          t.classList.add('open');
        }
      };
      i++;
      items(menu);
      top.appendChild(btn);
      top.appendChild(menu);
      bar.appendChild(top);
    }
    document.addEventListener('click', closeMenus);
  }

  /* the checks as the sheet stands */
  function checks(top) {
    Array.prototype.forEach.call(top.querySelectorAll('.item[data-id]'), function (it) {
      var id = +it.getAttribute('data-id'), c = M._cw_menu_checked(id);
      if (id === C.VIEW_STATUS)
        c = document.getElementById('status').classList.contains('hidden') ? 0 : 1;
      else if (id === C.VIEW_STANDARD)
        c = document.getElementById('tools').classList.contains('hidden') ? 0 : 1;
      it.classList.toggle('checked', c === 1);
    });
  }

  /* ---- the commands: the browser's own first, else src/app's ---- */

  function command(id) {
    var p;
    switch (id) {
    case C.NEW:
    case C.EXAMPLE:
      return confirmDiscard().then(function (go) { if (go) M._cw_command(id); focusKeys(); });
    case C.OPEN:
      return confirmDiscard().then(function (go) { if (go) return openDialog(); });
    case C.SAVE:
      return save(false);
    case C.SAVEAS:
      return save(true);
    case C.UPLOAD:
      return upload();
    case C.DOWNLOAD:
      p = path();
      download(p ? p.replace(/^.*\//, '') : 'blad.ccad', str(M._cw_sheet_text()) || '', 'text/plain;charset=utf-8');
      return;
    case C.FILES:
      return filesDialog();
    case C.PRINT:
      return printSheet();
    case C.SAVE_EMF: {
      var c = picture();
      if (c)
        c.toBlob(function (b) { download('calccad.png', b, 'image/png'); });
      return;
    }
    case C.COPY_IMAGE: {
      var pc = picture();
      if (pc && navigator.clipboard && window.ClipboardItem)
        pc.toBlob(function (b) { navigator.clipboard.write([new ClipboardItem({'image/png': b})]).catch(function () {}); });
      return;
    }
    case C.CUT:
    case C.COPY:
      clip = '';
      if (M._cw_copy(id === C.CUT ? 1 : 0) && clip && navigator.clipboard)
        navigator.clipboard.writeText(clip).catch(function () {});
      return;
    case C.PASTE:
      /* the system's clipboard; refused (a permission, iOS), what was
         copied here last */
      if (navigator.clipboard && navigator.clipboard.readText)
        navigator.clipboard.readText().then(function (t) { M.ccall('cw_paste', null, ['string'], [t]); }, function () {
          if (window.calccadLastClip)
            M.ccall('cw_paste', null, ['string'], [window.calccadLastClip]);
        });
      else if (window.calccadLastClip)
        M.ccall('cw_paste', null, ['string'], [window.calccadLastClip]);
      return;
    case C.INS_MATRIX:
      return matrixDialog();
    case C.INS_UNIT:
      return listDialog('Infoga enhet', 'Enheten multipliceras in där markören står (5*kV).',
                        JSON.parse(str(M._cw_list_json(0))), function (u) {
        return u[1] + '\t' + u[2] + '\t' + u[3];
      }).then(function (u) { if (u) M.ccall('cw_insert_text', null, ['string'], [u[0]]); });
    case C.INS_FUNC:
      return listDialog('Infoga funktion', 'Funktionens namn och ( skrivs in; skriv argumenten och ).',
                        JSON.parse(str(M._cw_list_json(1))), function (f) { return f[1]; }).then(function (f) {
        if (f) M.ccall('cw_insert_text', null, ['string'], [f[0]]);
      });
    case C.INS_TABLE_CSV:
      return pick('.csv,.txt,text/csv,text/plain').then(function (f) {
        var name;
        if (!f)
          return;
        name = (f.name.replace(/\..*$/, '').match(/[A-Za-z][A-Za-z0-9]*/) || ['data'])[0].slice(0, 20);
        M.ccall('cw_table_csv', 'number', ['string', 'string'], [name, f.data]);
      });
    case C.SYM_EVAL:
      M._cw_sym_eval();
      return;
    case C.VIEW_STATUS:
      document.getElementById('status').classList.toggle('hidden');
      return resized();
    case C.VIEW_STANDARD:
      document.getElementById('tools').classList.toggle('hidden');
      return resized();
    case C.HELP:
      return ask('calccad – hjälp', el('pre', {text: JSON.parse(str(M._cw_list_json(2)))}), [['Stäng', null]]);
    case C.ABOUT:
      return ask('Om calccad', el('div', {text: 'calccad – ett Mathcad-inspirerat räkneblad i C99, här i webbläsaren som WebAssembly. ' +
        'Numerik från QzOS/matlab1982 (LINPACK, EISPACK), formeleditor från QzOS/calculator. Apache License 2.0.'}), [['OK', null]]);
    default:
      M._cw_command(id);
    }
  }

  /* ---- the keys and the mouse ---- */

  /* The keys' focus. With the formula keyboard on a touch screen the page
     focuses no field at all (iOS brought its own keyboard for any focused
     field, read-only too): the editor is told it has the focus, and a
     hardware keyboard's keys come to the document (keysToDocument). */
  function focusKeys(forceSystem) {
    /* on a touch screen the field only when the device's keyboard was
       chosen (the keyboard key) and a formula or text is edited: any focus
       brings iOS's keyboard */
    if (M && touchy && !forceSystem && (!sysKb || M._cw_info(11) < 0)) {
      if (document.activeElement === keys)
        keys.blur();
      M._cw_focus(1);
      return;
    }
    keys.focus({preventScroll: true});
  }

  /* calccad's key for a keyboard event (keys.h), 0 for none */
  function keyOf(e) {
    var m;
    if (AK[e.key] !== undefined)
      return AK[e.key];
    if (e.key === '=' && e.ctrlKey)
      return AK['+']; /* Ctrl+= as Ctrl+Plus on a US keyboard */
    if ((m = /^F([0-9]+)$/.exec(e.key)) && +m[1] >= 1 && +m[1] <= 12)
      return AK_F1 + +m[1] - 1;
    if ((m = /^Key([A-Z])$/.exec(e.code)))
      return m[1].charCodeAt(0);
    if ((m = /^(?:Digit|Numpad)([0-9])$/.exec(e.code)))
      return m[1].charCodeAt(0);
    return 0;
  }

  /* the character a key types, as WM_CHAR has it; 0 for none */
  function charOf(e) {
    var altgr = e.getModifierState && e.getModifierState('AltGraph');
    if ((e.ctrlKey || e.metaKey || e.altKey) && !altgr)
      return 0;
    if (e.key === 'Enter') return 13;
    if (e.key === 'Tab') return 9;
    if (e.key === 'Backspace') return 8;
    if (e.key === 'Escape') return 27;
    if (e.key.length === 1 || (e.key.length === 2 && e.key.codePointAt(0) > 0xFFFF))
      return e.key.codePointAt(0);
    return 0; /* a dead key, a modifier, a named key */
  }

  function onKey(e) {
    var altgr = e.getModifierState && e.getModifierState('AltGraph');
    var ctrl = (e.ctrlKey || e.metaKey) && !altgr, k = keyOf(e), c = charOf(e), done = 0;
    if (e.isComposing)
      return;
    if (ctrl && (k === 67 || k === 86 || k === 88) && !e.shiftKey && !e.altKey)
      return; /* Ctrl+C, V, X: the browser's copy, paste and cut events */
    if (ctrl && !e.altKey) {
      /* the browser's own commands under their Win32 shortcuts */
      if (k === 83) { e.preventDefault(); command(e.shiftKey ? C.SAVEAS : C.SAVE); return; }
      if (k === 79) { e.preventDefault(); command(C.OPEN); return; }
      if (k === 78 && !e.shiftKey) { e.preventDefault(); command(C.NEW); return; }
      if (k === 80) { e.preventDefault(); command(C.PRINT); return; }
      if (k === 77) { e.preventDefault(); command(C.INS_MATRIX); return; }
    }
    if (k)
      done = M._cw_key(k, ctrl ? 1 : 0, e.shiftKey ? 1 : 0);
    if (c)
      M._cw_char(c);
    if (done || c)
      e.preventDefault(); /* not the browser's: scrolling, focus, going back */
  }

  /* text that came without a key: each character as typed */
  function typed(t) {
    var i, c;
    if (!t)
      return;
    for (i = 0; i < t.length; i += c > 0xFFFF ? 2 : 1) {
      c = t.codePointAt(i);
      M._cw_char(c === 10 ? 13 : c);
    }
  }

  /* The text field holds two blanks with the caret at their end: an
     on-screen keyboard (Android, iOS) sends its Backspace as an input
     event only when there is something to delete, and its keys mostly
     as "Unidentified" key events with the text in the input event. */
  function sentinel() {
    keys.value = '  ';
    try { keys.setSelectionRange(2, 2); } catch (e) { /* not focused */ }
  }

  function onInput(e) {
    if (e.isComposing || e.inputType === 'insertCompositionText')
      return; /* the input method's text comes whole at compositionend */
    if (e.inputType === 'insertFromPaste')
      return; /* the paste event's */
    if (e.inputType === 'deleteContentBackward') {
      M._cw_key(AK.Backspace, 0, 0);
      M._cw_char(8);
    } else if (e.inputType === 'deleteContentForward') {
      M._cw_key(AK.Delete, 0, 0);
    } else if (e.inputType === 'insertLineBreak' || e.inputType === 'insertParagraph') {
      M._cw_key(AK.Enter, 0, 0);
      M._cw_char(13);
    } else if (e.data) {
      typed(e.data);
    }
    e.preventDefault();
    sentinel();
  }

  function onCopy(e) {
    clip = '';
    if (M._cw_copy(e.type === 'cut' ? 1 : 0) && clip) {
      e.clipboardData.setData('text/plain', clip);
      e.preventDefault();
    }
  }

  function onPaste(e) {
    var t = e.clipboardData.getData('text/plain');
    e.preventDefault();
    if (t)
      M.ccall('cw_paste', null, ['string'], [t]);
  }

  /* the canvas point (device pixels) of a pointer event; null on the scroll bars */
  function at(e) {
    var r = scroller.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    if (x < 0 || y < 0 || x >= scroller.clientWidth || y >= scroller.clientHeight)
      return null;
    return [Math.round(x * ratio), Math.round(y * ratio)];
  }

  /* a client point in the canvas's device pixels */
  function dev(x, y) {
    var r = scroller.getBoundingClientRect();
    return [Math.round((x - r.left) * ratio), Math.round((y - r.top) * ratio)];
  }

  /* ---- the mouse (and a pen): as the Win32 window has it ---- */

  function mouseDown(e) {
    var p = at(e);
    if (e.button !== 0 || !p)
      return;
    focusKeys();
    scroller.setPointerCapture(e.pointerId);
    M._cw_mouse_down(p[0], p[1], (e.ctrlKey || e.metaKey) ? 1 : 0, e.shiftKey ? 1 : 0, e.detail >= 2 ? 1 : 0);
    e.preventDefault();
  }

  function mouseMove(e) {
    var p = dev(e.clientX, e.clientY);
    M._cw_mouse_move(p[0], p[1], (e.buttons & 1) ? 1 : 0);
  }

  function mouseUp(e) {
    var p = dev(e.clientX, e.clientY);
    if (e.button !== 0)
      return;
    if (scroller.hasPointerCapture(e.pointerId))
      scroller.releasePointerCapture(e.pointerId);
    M._cw_mouse_up(p[0], p[1], e.shiftKey ? 1 : 0);
  }

  /* ---- a finger: the page's own, not the browser's (the scroller's
     touch-action: none). A drag scrolls the sheet, gliding on after the
     finger lets go; a tap is a click, a second tap soon and near a double
     click; a long press, then a drag, is the mouse's drag (moving regions,
     the rubber band); two fingers zoom the sheet about their middle. The
     browser scrolling by itself took the finger from a long press as soon
     as it moved (iOS Safari: pointercancel), so regions could not move. ---- */

  var SLOP = 10;
  var fingers = {}, one = null, pinch = null, lastTap = null, tapped = false, glide = null, tapEnd = false;

  /* the sheet scrolled by the finger: the scroller's own scroll event
     tells the sheet */
  function panTo(e) {
    var t = performance.now();
    scroller.scrollLeft = one.sl - (e.clientX - one.x0);
    scroller.scrollTop = one.st - (e.clientY - one.y0);
    one.track.push({t: t, x: e.clientX, y: e.clientY});
    while (one.track.length > 2 && t - one.track[0].t > 100)
      one.track.shift();
  }

  /* after the finger lets go: on at its speed (of its last 0.1 s), slowing */
  function glideFrom(track) {
    var a = track[0], b = track[track.length - 1], dt = b.t - a.t, vx, vy, last;
    if (track.length < 2 || dt <= 0 || performance.now() - b.t > 80)
      return;
    vx = (b.x - a.x) / dt;
    vy = (b.y - a.y) / dt;
    if (Math.hypot(vx, vy) < 0.2)
      return;
    last = performance.now();
    glide = requestAnimationFrame(function step(now) {
      var dt2 = Math.min(now - last, 50), f = Math.pow(0.996, dt2);
      last = now;
      scroller.scrollLeft -= vx * dt2;
      scroller.scrollTop -= vy * dt2;
      vx *= f;
      vy *= f;
      glide = Math.hypot(vx, vy) > 0.02 ? requestAnimationFrame(step) : null;
    });
  }

  function stopGlide() {
    if (glide !== null)
      cancelAnimationFrame(glide);
    glide = null;
  }

  function fingerList() {
    return Object.keys(fingers).map(function (k) { return fingers[k]; });
  }

  /* The finger's mode (the toolbar, a touch screen): 'edit', a tap places
     the caret or the crosshair and a drag scrolls; 'move', a drag on a
     region moves it (with what else is selected), a drag on nothing is
     the rubber band, a tap selects a region or lets it go; 'probe', a
     finger on a plot reads the sample nearest it (a cross and the values
     follow the finger along the curves; the reading stays when it lifts),
     elsewhere a drag scrolls. Two fingers zoom and pan in all; the mouse
     and a pen are as ever. */
  var fingerMode = 'edit';

  /* a drag in the move mode: the mouse's drag from where the finger
     went down (the view starts it past its own slop) */
  function startDrag(e) {
    var p = dev(one.x0, one.y0);
    one.drag = true;
    M._cw_mouse_down(p[0], p[1], 0, 0, 0);
    p = dev(e.clientX, e.clientY);
    M._cw_mouse_move(p[0], p[1], 1);
  }

  function dropOne() {
    if (!one)
      return;
    if (one.drag) {
      var p = dev(one.x0, one.y0);
      M._cw_mouse_up(p[0], p[1], 0);
    }
    one = null;
  }

  function fingerDown(e) {
    var f;
    if (!at(e))
      return;
    /* no compatibility mouse events after it (their mousedown would take the
       focus from the keys) */
    e.preventDefault();
    stopGlide();
    fingers[e.pointerId] = {x: e.clientX, y: e.clientY};
    f = fingerList();
    if (f.length === 2) {
      dropOne();
      pinch = {d: Math.hypot(f[0].x - f[1].x, f[0].y - f[1].y), zoom: M._cw_info(2),
               mx: (f[0].x + f[1].x) / 2, my: (f[0].y + f[1].y) / 2};
    } else if (f.length === 1) {
      one = {id: e.pointerId, x0: e.clientX, y0: e.clientY, moved: false, drag: false,
             sl: scroller.scrollLeft, st: scroller.scrollTop, track: []};
      var q = dev(e.clientX, e.clientY);
      if (fingerMode === 'probe')
        one.probe = M._cw_probe(q[0], q[1], 1) === 1; /* on a plot: read; else the point goes */
      else if (fingerMode === 'edit' && M._cw_info(16) === 1 && M._cw_hit(q[0], q[1]) === M._cw_info(11))
        one.select = true; /* in the text being edited: a drag selects in it */
    }
  }

  function setFingerMode(m) {
    fingerMode = m;
    document.getElementById('modeEdit').classList.toggle('on', m === 'edit');
    document.getElementById('modeMove').classList.toggle('on', m === 'move');
    document.getElementById('modeProbe').classList.toggle('on', m === 'probe');
    if (m !== 'probe')
      M._cw_probe(0, 0, 0); /* the measuring point goes with its mode */
    if (m !== 'edit') {
      if (M._cw_info(11) >= 0)
        M._cw_key(AK.Escape, 0, 0); /* what is edited ends: regions are moved or read now */
      if (mkbTouch())
        showMathKeyboard(false, false);
    }
    focusKeys();
  }

  function pinchFrame() {
    var f, d, c, mx, my;
    if (!pinch)
      return;
    pinch.frame = 0;
    f = fingerList();
    if (f.length < 2 || pinch.d <= 0)
      return;
    mx = (f[0].x + f[1].x) / 2;
    my = (f[0].y + f[1].y) / 2;
    d = Math.hypot(f[0].x - f[1].x, f[0].y - f[1].y);
    c = dev(mx, my);
    M._cw_zoom(pinch.zoom * d / pinch.d, c[0], c[1]);
    /* and pans with the fingers' middle, as a map does: told to the view
       at once (the zoom's bars just put the scroller where the view has
       it, so a change of the scroller would be lost) */
    M._cw_scroll(1, Math.round(M._cw_info(5) + (pinch.my - my) * ratio));
    M._cw_scroll(0, Math.round(M._cw_info(4) + (pinch.mx - mx) * ratio));
    pinch.mx = mx;
    pinch.my = my;
  }

  function fingerMove(e) {
    var f, d, c, p;
    if (!fingers[e.pointerId])
      return;
    fingers[e.pointerId] = {x: e.clientX, y: e.clientY};
    if (pinch) {
      /* once a frame, with both fingers where they are now (each finger's
         move is an event of its own: one moved, the other not yet, the
         zoom went to and fro about two middles and the sheet drifted) */
      if (!pinch.frame)
        pinch.frame = requestAnimationFrame(pinchFrame);
      return;
    }
    if (!one || one.id !== e.pointerId)
      return;
    if (one.probe) {
      p = dev(e.clientX, e.clientY);
      M._cw_probe(p[0], p[1], 2); /* the reading follows the finger */
    } else if (one.drag) {
      p = dev(e.clientX, e.clientY);
      M._cw_mouse_move(p[0], p[1], 1);
    } else if (one.moved) {
      panTo(e);
    } else if (Math.hypot(e.clientX - one.x0, e.clientY - one.y0) > SLOP) {
      if (fingerMode === 'move' || one.select) {
        startDrag(e); /* moves the region, or the rubber band; in the edited text, selects */
      } else {
        one.moved = true; /* the edit mode: it scrolls */
        panTo(e);
      }
    }
  }

  function fingerUp(e) {
    var p, q, now, dbl;
    if (!fingers[e.pointerId])
      return;
    delete fingers[e.pointerId];
    if (pinch) {
      if (fingerList().length < 2)
        pinch = null;
      return;
    }
    if (!one || one.id !== e.pointerId)
      return;
    if (one.drag) {
      p = dev(e.clientX, e.clientY);
      M._cw_mouse_up(p[0], p[1], 0);
    } else if (one.moved) {
      if (e.type === 'pointerup')
        glideFrom(one.track);
    } else if (one.probe || (e.type === 'pointerup' && fingerMode === 'probe')) {
      tapEnd = true; /* the reading stays; nothing edited */
    } else if (e.type === 'pointerup' && fingerMode === 'move') {
      /* a tap: a region joins the selection or leaves it (Ctrl+click: not
         edited); on nothing the selection is let go */
      q = dev(one.x0, one.y0);
      M._cw_mouse_down(q[0], q[1], 1, 0, 0);
      M._cw_mouse_up(q[0], q[1], 0);
      tapEnd = true;
      focusKeys();
    } else if (e.type === 'pointerup') {
      q = dev(one.x0, one.y0);
      now = Date.now();
      dbl = lastTap && now - lastTap.t < 350 && Math.hypot(one.x0 - lastTap.x, one.y0 - lastTap.y) < 25;
      M._cw_mouse_down(q[0], q[1], 0, 0, dbl ? 1 : 0);
      M._cw_mouse_up(q[0], q[1], 0);
      lastTap = dbl ? null : {t: now, x: one.x0, y: one.y0};
      tapEnd = true; /* its touchend's default prevented */
      if (sysKb && M._cw_info(11) >= 0) {
        /* the device's keyboard chosen (the keyboard key) and a formula or
           text edited: the field, focused again in the touchend (iOS shows
           its keyboard only there) */
        focusKeys();
        tapped = true;
      } else {
        /* a formula or text edited: the formula keyboard, as GeoGebra's
           (not the device's, which only the keyboard key brings) */
        if (!sysKb && M._cw_info(11) >= 0 && !mkbTouch())
          showMathKeyboard(true, false);
        focusKeys(); /* the editor's focus, no field's */
      }
    }
    one = null;
  }

  function onDown(e) {
    closeMenus();
    if (e.pointerType === 'touch')
      fingerDown(e);
    else
      mouseDown(e);
  }

  function onMove(e) {
    if (e.pointerType === 'touch')
      fingerMove(e);
    else
      mouseMove(e);
  }

  function onUp(e) {
    if (e.pointerType === 'touch')
      fingerUp(e);
    else
      mouseUp(e);
  }

  function events() {
    scroller.addEventListener('scroll', function () {
      if (echo && scroller.scrollTop === echo[0] && scroller.scrollLeft === echo[1])
        return; /* where bars() put it */
      if (pinch)
        return; /* two fingers move the view itself; the scroller follows it */
      echo = null;
      /* both read first: the view's answer to the one (bars) puts the
         scroller back where the view had it, the other way too, so the
         sheet never scrolled sideways */
      var top = Math.round(scroller.scrollTop * ratio), left = Math.round(scroller.scrollLeft * ratio);
      M._cw_scroll(1, top);
      M._cw_scroll(0, left);
    });
    scroller.addEventListener('wheel', function (e) {
      var r;
      if (!e.ctrlKey)
        return; /* the scroller scrolls */
      e.preventDefault();
      r = scroller.getBoundingClientRect();
      M._cw_zoom(M._cw_info(2) * Math.pow(1.1, -e.deltaY / 100),
                 Math.round((e.clientX - r.left) * ratio), Math.round((e.clientY - r.top) * ratio));
    }, {passive: false});
    /* the keys go to a text field out of sight: its input events carry
       what no key event does (an input method, a character not on the
       keyboard's layout); its copy, cut and paste events are the clipboard */
    keys.addEventListener('keydown', onKey);
    keys.addEventListener('beforeinput', onInput);
    keys.addEventListener('compositionend', function (e) { typed(e.data); sentinel(); });
    keys.addEventListener('focus', function () { sentinel(); M._cw_focus(1); });
    keys.addEventListener('blur', function () { M._cw_focus(0); });
    keys.addEventListener('copy', onCopy);
    keys.addEventListener('cut', onCopy);
    keys.addEventListener('paste', onPaste);
    scroller.addEventListener('pointerdown', onDown);
    scroller.addEventListener('pointermove', onMove);
    scroller.addEventListener('pointerup', onUp);
    scroller.addEventListener('pointercancel', onUp);
    /* A tap's touchend: the keys focused in it (iOS shows its keyboard only
       for a focus in a touchend or a click), and its default prevented, the
       one way that keeps every browser (iOS Safari too) from sending the
       compatibility mousedown and click after it, whose mousedown took the
       focus from the keys: the caret flashed and went, no keyboard came. */
    scroller.addEventListener('touchend', function (e) {
      if (!tapEnd)
        return;
      tapEnd = false;
      e.preventDefault();
      if (tapped)
        focusKeys();
      tapped = false;
    }, {passive: false});
    /* a hardware keyboard's keys while no field has the focus (the formula
       keyboard on a touch screen): the keys' as ever */
    document.addEventListener('keydown', function (e) {
      if ((e.target === document.body || e.target === document.documentElement) && !dlg.open)
        onKey(e);
    });
    /* nor may any mousedown on the sheet move the focus: the page keeps it on the keys */
    scroller.addEventListener('mousedown', function (e) { e.preventDefault(); });
    /* the finger is the page's: no scrolling or zooming by the browser
       (as touch-action: none; for a browser that would anyway) */
    scroller.addEventListener('touchmove', function (e) { e.preventDefault(); }, {passive: false});
    scroller.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    window.addEventListener('beforeunload', function (e) {
      if (M._cw_info(17) || syncing) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
    document.getElementById('zoomin').onclick = function () { M._cw_command(C.ZOOM_IN); focusKeys(); };
    document.getElementById('zoomout').onclick = function () { M._cw_command(C.ZOOM_OUT); focusKeys(); };
    document.getElementById('zoom100').onclick = function () { M._cw_command(C.ZOOM_100); focusKeys(); };
    /* Undo and Redo: the document's own history (Edit > Undo, Redo), moved
       regions too; the buttons take no focus from the keys */
    /* the finger's modes (a touch screen): Edit and Move */
    ['modeEdit', 'modeMove', 'modeProbe'].forEach(function (id) {
      var b = document.getElementById(id);
      b.classList.toggle('hidden', !touchy);
      b.addEventListener('mousedown', function (e) { e.preventDefault(); });
      b.onclick = function () { setFingerMode({modeEdit: 'edit', modeMove: 'move', modeProbe: 'probe'}[id]); };
    });
    document.getElementById('modeSep').classList.toggle('hidden', !touchy);
    /* Undo, Redo, Cut, Copy, Paste: the Edit menu's (the selected regions,
       the text selected in a text, the formula's selection) */
    var EDIT_BUTTONS = {undo: C.UNDO, redo: C.REDO, cut: C.CUT, copy: C.COPY, paste: C.PASTE, del: C.DELETE};
    Object.keys(EDIT_BUTTONS).forEach(function (id) {
      var b = document.getElementById(id);
      b.addEventListener('mousedown', function (e) { e.preventDefault(); });
      b.onclick = function () {
        if (id === 'del' && M._cw_info(11) >= 0)
          M._cw_key(AK.Delete, 0, 0); /* in what is edited: its selection, or what follows the caret */
        else
          command(EDIT_BUTTONS[id]); /* the selected regions */
        focusKeys();
      };
    });
    mathKeyboard();
    if (new URLSearchParams(location.search).has('debug'))
      debugPanel();
    new ResizeObserver(resized).observe(view);
    /* a new device pixel ratio (the window moved to another screen, the browser's zoom) */
    (function watch() {
      matchMedia('(resolution: ' + (window.devicePixelRatio || 1) + 'dppx)').addEventListener('change', function () {
        resized();
        watch();
      }, {once: true});
    })();
    focusKeys();
  }

  /* ---- the formula keyboard (math_keyboard.js): its keys ask, the
     editor's own operations do; it never takes the focus from the keys ---- */

  var TEMPLATE_CHAR = {fraction: '/', power: '^', sqrt: '\\', abs: '|', deriv: '?', index: '[', integral: '&',
                       sum: '$', define: ':', eval: '=', symbolic: '->'};
  var CHAR_OF_KEY = {Backspace: 8, Enter: 13, Tab: 9, Escape: 27, ' ': 32};
  /* a touch screen: any, not only the primary pointer (an iPad with a
     keyboard or trackpad attached says pointer: fine) */
  var touchy = (navigator.maxTouchPoints || 0) > 0 || matchMedia('(any-pointer: coarse)').matches;

  function inText() {
    return M._cw_info(16) === 1; /* a text region edited (RG_TEXT) */
  }

  /* the keys keep the focus; a key acts in a touchend or pointerup, so a
     focus here is the user's (iOS) */
  function keepFocus() {
    if (mkbTouch() || document.activeElement !== keys)
      focusKeys();
  }

  /* the formula keyboard shown on a touch screen */
  function mkbTouch() {
    return touchy && mkb !== null && !document.getElementById('mkb').classList.contains('hidden');
  }

  var editorKeys = {
    insertString: function (t) { keepFocus(); typed(t); },
    insertName: function (name, ch) {
      keepFocus();
      if (inText())
        typed(ch);
      else
        M.ccall('cw_insert_text', null, ['string'], [name]);
    },
    insertFunction: function (t) {
      keepFocus();
      if (inText())
        typed(t);
      else
        M.ccall('cw_insert_text', null, ['string'], [t]);
    },
    onArrow: function (dir) {
      keepFocus();
      M._cw_key(AK['Arrow' + dir.charAt(0).toUpperCase() + dir.slice(1)], 0, 0);
    },
    onKey: function (name) {
      keepFocus();
      if (AK[name] !== undefined)
        M._cw_key(AK[name], 0, 0);
      if (CHAR_OF_KEY[name])
        M._cw_char(CHAR_OF_KEY[name]);
    },
    operation: function (op, arg) {
      keepFocus();
      if (TEMPLATE_CHAR[op] !== undefined)
        return typed(TEMPLATE_CHAR[op]);
      if (op === 'matrix')
        return arg ? M._cw_insert_matrix(arg[0], arg[1]) : command(C.INS_MATRIX);
      if (op === 'unit')
        return command(C.INS_UNIT);
      if (op === 'function')
        return command(C.INS_FUNC);
    },
    systemKeyboard: function () {
      showMathKeyboard(false, true);
    },
    hide: function () {
      showMathKeyboard(false, false);
    }
  };

  var mkb = null;
  /* the device's keyboard chosen (the keyboard key; kept as 'sys'): on a
     touch screen it comes for nothing else */
  var sysKb = false;

  /* The device's on-screen keyboard kept away while this one is shown on
     a touch screen: the field read-only (as GeoGebra's: iOS shows no
     keyboard for it, even on the first tap; inputmode none alone did not
     stop that), its key events (a hardware keyboard's) still the keys'. */
  function deviceKeyboard(on) {
    keys.readOnly = !on;
    keys.inputMode = on ? 'text' : 'none';
  }

  /* shown or hidden; hidden on a touch screen, the device's keyboard comes
     again, at once when asked (system) */
  function showMathKeyboard(on, system) {
    var el = document.getElementById('mkb');
    el.classList.toggle('hidden', !on);
    document.getElementById('mkbtoggle').classList.toggle('on', on);
    if (system)
      sysKb = true; /* the keyboard key: the device's keyboard from now on */
    else if (on)
      sysKb = false;
    try { localStorage.setItem('calccad-mkb', on ? '1' : sysKb ? 'sys' : '0'); } catch (e) { /* no storage */ }
    if (touchy || keys.readOnly) {
      deviceKeyboard(sysKb || !touchy);
      if (system || on) {
        /* counted from the next focus; shown: no field's; the device's
           keyboard only when asked for (the keyboard key) */
        keys.blur();
        focusKeys(system && !on);
      }
    }
    resized();
  }

  /* ?debug=1: a log on the page of what moves the focus and when the
     device's keyboard comes (the visual viewport shrinks), for a device
     the tests cannot see (an iPad) */
  function debugPanel() {
    var box = document.createElement('pre'), lines = [], lastH = 0, lastActive = '';
    box.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:99;margin:0;max-height:40%;overflow:auto;' +
      'background:rgba(255,255,220,0.94);font:11px monospace;padding:4px;pointer-events:none;white-space:pre-wrap';
    document.body.appendChild(box);
    function name(el) {
      return !el ? '-' : el === document.body ? 'body' : (el.id ? '#' + el.id : el.tagName.toLowerCase());
    }
    function log(s) {
      var t = (performance.now() / 1000).toFixed(2);
      lines.push(t + ' ' + s);
      if (lines.length > 40)
        lines.shift();
      box.textContent = lines.join('\n');
      box.scrollTop = 1e6;
    }
    log('touchy ' + touchy + ' maxTouchPoints ' + navigator.maxTouchPoints + ' pointer:coarse ' +
        matchMedia('(pointer: coarse)').matches + ' any-pointer:coarse ' + matchMedia('(any-pointer: coarse)').matches +
        ' mkbTouch ' + mkbTouch() + ' sysKb ' + sysKb + ' keys.readOnly ' + keys.readOnly + ' inputMode ' + keys.inputMode);
    log(navigator.userAgent);
    document.addEventListener('focusin', function (e) {
      log('focusin ' + name(e.target) + ' (editing ' + M._cw_info(11) + ', mkbTouch ' + mkbTouch() + ')\n' +
          (new Error().stack || '').split('\n').slice(1, 6).join(' | '));
    }, true);
    document.addEventListener('focusout', function (e) { log('focusout ' + name(e.target)); }, true);
    ['touchstart', 'touchend', 'pointerdown', 'pointerup', 'click', 'mousedown'].forEach(function (t) {
      document.addEventListener(t, function (e) {
        log(t + ' on ' + name(e.target) + (e.defaultPrevented ? ' (prevented)' : '') + ' active ' + name(document.activeElement));
      }, true);
    });
    function viewport() {
      var h = window.visualViewport ? Math.round(window.visualViewport.height) : window.innerHeight;
      var a = name(document.activeElement);
      if (h !== lastH) {
        log('viewport h ' + lastH + ' -> ' + h + (lastH && h < lastH - 100 ? '  << KEYBOARD? active ' + a : ''));
        lastH = h;
      }
      if (a !== lastActive) {
        log('active ' + lastActive + ' -> ' + a);
        lastActive = a;
      }
    }
    if (window.visualViewport)
      window.visualViewport.addEventListener('resize', viewport);
    setInterval(viewport, 300);
    viewport();
  }

  function mathKeyboard() {
    var stored = null, btn = document.getElementById('mkbtoggle');
    mkb = new window.MathKeyboard(document.getElementById('mkb'), editorKeys);
    window.calccadMathKeyboard = mkb;
    try { stored = localStorage.getItem('calccad-mkb'); } catch (e) { /* no storage */ }
    btn.addEventListener('mousedown', function (e) { e.preventDefault(); }); /* the keys keep the focus */
    /* shows or hides this keyboard; hidden, the device's comes only when a
       formula is edited (the keyboard key asks for it at once) */
    btn.onclick = function () { showMathKeyboard(document.getElementById('mkb').classList.contains('hidden'), false); };
    /* hidden when the page loads: it comes with a tap into a formula or
       text on a touch screen, or by the button; only the choice of the
       device's keyboard is kept */
    sysKb = stored === 'sys';
    if (touchy && !sysKb)
      deviceKeyboard(false);
  }

  createCalccad({
    /* the .wasm (and the threads' script) under the page's version, as the
       scripts (index.html) */
    locateFile: function (f, prefix) { return prefix + f + (window.calccadVersion || ''); },
    onInvalidate: paint,
    onBars: function () { bars.apply(null, arguments); },
    onStatus: function (h, n, m) { if (M) status(h, n, m); },
    onTitle: function (t) { document.title = t; },
    onSaved: function () { if (FS) sync(); },
    onClip: function (t) { clip = t; window.calccadLastClip = t; },
  }).then(function (mod) {
    M = mod;
    FS = M.FS;
    window.calccad = M;
    window.calccadCommand = command;
    return Promise.all([M.cvwebLoadFonts('fonts'), mountWork()]);
  }).then(function () {
    var s;
    surface = M.cvwebRegister(canvas);
    s = layout();
    if (!M._cw_open(surface, s[0], s[1], ratio))
      throw new Error('cw_open');
    buildMenu(JSON.parse(str(M._cw_menu_json())));
    events();
    return fetch('examples/index.json').then(function (r) { return r.json(); });
  }).then(function (names) {
    var sel = document.getElementById('sheets'), want = new URLSearchParams(location.search).get('sheet') || 'demo.ccad';
    names.forEach(function (n) {
      var o = document.createElement('option');
      o.value = o.textContent = n;
      sel.appendChild(o);
    });
    sel.value = want;
    sel.dataset.shown = want;
    sel.onchange = function () {
      var name = sel.value;
      /* the list lets go of the focus first: the question's dialog gives
         it back when it closes, and iOS opens a focused list again */
      sel.blur();
      confirmDiscard().then(function (go) {
        if (go) {
          sel.dataset.shown = name;
          load(name);
        } else {
          sel.value = sel.dataset.shown; /* cancelled: the sheet shown */
        }
      });
    };
    return load(want);
  }).catch(function (e) {
    document.getElementById('hint').textContent = 'Fel: ' + e.message;
    window.calccadError = String(e);
  });
})();
