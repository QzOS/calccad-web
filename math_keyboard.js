/* An on-screen keyboard for formulas: tabs 123, f(x), ABC and αβγ.

   It knows nothing of how a formula is kept: a key asks its listener
   for one thing, and the listener (the app) does it with the editor's
   own operations:

     listener.insertString(text)     text typed: "7", "x", "+"
     listener.insertName(name, ch)   a named symbol: ("alpha", "α"), ("pi", "π")
     listener.insertFunction(text)   a function as the catalog has it: "sin("
     listener.onArrow(dir)           "left", "right", "up", "down"
     listener.onKey(name)            "Backspace", "Delete", "Enter", "Escape", " ", "Home", "End"
     listener.operation(name, arg)   "fraction", "power", "sqrt", "abs", "deriv", "index",
                                     "integral", "sum", "define", "eval", "symbolic",
                                     "matrix" (arg [rows, cols], or none: ask), "unit", "function"
     listener.systemKeyboard()       the device's own keyboard instead
     listener.hide()                 this keyboard away

   A key must never move the focus or the selection from the editor (the
   page keeps both in a hidden text field): no pointer, mouse or touch
   event on the keyboard does its default, so the browser neither moves
   the focus nor sends compatibility mouse events. A key acts when the
   finger or button lets go on it: for a finger in the touchend itself
   (iOS lets a page focus a field, or show its keyboard, only there).
   Backspace, Delete and the arrows repeat while held. */
(function () {
  'use strict';

  function T(label, text, title) { return {label: label, act: ['text', text || label], title: title}; }
  function N(label, name) { return {label: label, act: ['name', name, label]}; }
  function F(label, text) { return {label: label, act: ['func', text || label + '(']}; }
  function O(label, op, title, arg) { return {label: label, act: ['op', op, arg], title: title, cls: 'op'}; }
  function K(label, key, title, w) { return {label: label, act: ['key', key], title: title, w: w, cls: 'fn', repeat: key === 'Backspace' || key === 'Delete'}; }
  function A(label, dir) { return {label: label, act: ['arrow', dir], cls: 'fn', repeat: true, title: 'Pil'}; }

  var BACK = K('⌫', 'Backspace', 'Radera', 1.5);

  /* the tabs: rows of keys; w is a width in key units (1 when none) */
  var TABS = {
    '123': [
      [T('x'), T('y'), T('t'), N('π', 'pi'), {gap: 0.3}, T('7'), T('8'), T('9'), T('×', '*', 'Gånger'), O('a⁄b', 'fraction', 'Bråk')],
      [O('aⁿ', 'power', 'Potens'), O('√', 'sqrt', 'Kvadratrot'), O('|a|', 'abs', 'Belopp'), T('('), T(')'), {gap: 0.3},
       T('4'), T('5'), T('6'), T('+'), T('−', '-', 'Minus')],
      [O(':=', 'define', 'Definition'), O('=', 'eval', 'Visa resultatet'), O('→', 'symbolic', 'Symboliskt'), T(','), T('.'),
       {gap: 0.3}, T('1'), T('2'), T('3'), BACK],
      [T('i', 'i', 'Imaginära enheten (efter ett tal: 8i)'), T('e'), T('<'), T('>'), T('..', '..', 'Intervall'), {gap: 0.3},
       {label: '0', act: ['text', '0'], w: 2}, K('mellanslag', ' ', 'Markera mer av uttrycket', 2)]
    ],
    'f(x)': [
      [F('sin'), F('cos'), F('tan'), F('ln'), F('log'), F('exp'), O('d/dx', 'deriv', 'Derivata'), O('∫', 'integral', 'Integral'),
       O('Σ', 'sum', 'Summa')],
      [F('asin'), F('acos'), F('atan'), F('sinh'), F('cosh'), F('tanh'), O('xₙ', 'index', 'Index'), F('abs'), F('sqrt')],
      [F('Re'), F('Im'), F('max'), F('min'), F('round'), F('mod'), F('if'), F('root'), BACK],
      [O('[2×2]', 'matrix', 'Matris 2×2', [2, 2]), O('[3×3]', 'matrix', 'Matris 3×3', [3, 3]),
       O('[3×1]', 'matrix', 'Vektor 3×1', [3, 1]), O('m×n', 'matrix', 'Matris av vald storlek'),
       O('enhet', 'unit', 'Infoga enhet'), O('f…', 'function', 'Infoga funktion'), F('deg', 'deg'), T('°', 'deg')]
    ],
    'ABC': [
      'qwertyuiopå'.split('').map(function (c) { return T(c); }),
      'asdfghjklöä'.split('').map(function (c) { return T(c); }),
      [{label: '⇧', act: ['shift'], cls: 'fn', w: 1.5, title: 'Versaler'}].concat(
        'zxcvbnm'.split('').map(function (c) { return T(c); }), [T('_', '_', 'Index i ett namn: R_1'), BACK]),
      [T('"', '"', 'Ny textregion'), T('@', '@', 'Nytt diagram'), T(':', ':', 'Definition'), T('='),
       K('mellanslag', ' ', 'Mellanslag', 4), T('-'), T('/')]
    ],
    'αβγ': [
      [N('α', 'alpha'), N('β', 'beta'), N('γ', 'gamma'), N('δ', 'delta'), N('ε', 'epsilon'),
       N('ζ', 'zeta'), N('η', 'eta'), N('θ', 'theta'), N('ι', 'iota'), N('κ', 'kappa')],
      [N('λ', 'lambda'), N('μ', 'mu'), N('ν', 'nu'), N('ξ', 'xi'), N('π', 'pi'), N('ρ', 'rho'),
       N('σ', 'sigma'), N('τ', 'tau'), N('υ', 'upsilon'), N('φ', 'phi')],
      [{label: '⇧', act: ['shift'], cls: 'fn', w: 1.5, title: 'Versaler'}, N('χ', 'chi'), N('ψ', 'psi'),
       N('ω', 'omega'), N('Ω', 'Omega'), N('Δ', 'Delta'), N('Σ', 'Sigma'), N('Φ', 'Phi'), BACK]
    ]
  };

  /* Greek capitals by their names: those that differ from Latin ones */
  var GREEK_UP = {gamma: 'Gamma', delta: 'Delta', theta: 'Theta', lambda: 'Lambda', xi: 'Xi', pi: 'Pi', sigma: 'Sigma',
                  phi: 'Phi', psi: 'Psi', omega: 'Omega'};

  /* the row under every tab: the tabs, the arrows, Enter, the system keyboard, away */
  function bottomRow(tabs) {
    return tabs.map(function (t) { return {label: t, act: ['tab', t], cls: 'tab'}; }).concat([
      {gap: 0.3}, A('◀', 'left'), A('▶', 'right'), A('▲', 'up'), A('▼', 'down'),
      K('↵', 'Enter', 'Enter', 1.5),
      {label: '⌨', act: ['system'], cls: 'fn', title: 'Enhetens tangentbord'},
      {label: '✕', act: ['hide'], cls: 'fn', title: 'Dölj tangentbordet'}
    ]);
  }

  function MathKeyboard(root, listener) {
    var self = this, tab = '123', shift = false, pressed = null, repeat = null;
    var names = Object.keys(TABS);

    this.root = root;
    root.classList.add('mkb');
    root.setAttribute('role', 'group');
    root.setAttribute('aria-label', 'Matematiktangentbord');

    function upper(k) {
      var a = k.act;
      if (!shift || !a)
        return k;
      if (a[0] === 'text' && a[1].length === 1 && a[1] !== a[1].toUpperCase())
        return {label: k.label.toUpperCase(), act: ['text', a[1].toUpperCase()], title: k.title};
      if (a[0] === 'name' && GREEK_UP[a[1]])
        return {label: a[2].toUpperCase(), act: ['name', GREEK_UP[a[1]], a[2].toUpperCase()]};
      return k;
    }

    function build() {
      var rows = TABS[tab].concat([bottomRow(names)]);
      root.textContent = '';
      rows.forEach(function (row) {
        var r = document.createElement('div');
        r.className = 'mkb-row';
        row.forEach(function (k0) {
          var k = upper(k0), b;
          if (k.gap) {
            b = document.createElement('span');
            b.className = 'mkb-gap';
            b.style.flexGrow = String(k.gap);
            r.appendChild(b);
            return;
          }
          b = document.createElement('span');
          b.className = 'mkb-key' + (k.cls ? ' mkb-' + k.cls : '') +
            ((k.act[0] === 'tab' && k.act[1] === tab) || (k.act[0] === 'shift' && shift) ? ' mkb-on' : '');
          b.textContent = k.label;
          if (k.label.length > 4 && !k.w)
            b.className += ' mkb-small'; /* a long label in a narrow key */
          b.style.flexGrow = String(k.w || 1);
          b.setAttribute('role', 'button');
          b.setAttribute('aria-label', k.title || k.label);
          if (k.title)
            b.title = k.title;
          b.mkbKey = k;
          r.appendChild(b);
        });
        root.appendChild(r);
      });
    }

    function act(k) {
      var a = k.act;
      switch (a[0]) {
      case 'text': listener.insertString(a[1]); break;
      case 'name': listener.insertName(a[1], a[2]); break;
      case 'func': listener.insertFunction(a[1]); break;
      case 'op': listener.operation(a[1], a[2]); break;
      case 'key': listener.onKey(a[1]); break;
      case 'arrow': listener.onArrow(a[1]); break;
      case 'tab': tab = a[1]; shift = false; build(); return;
      case 'shift': shift = !shift; build(); return;
      case 'system': listener.systemKeyboard(); return;
      case 'hide': listener.hide(); return;
      }
      if (shift && (a[0] === 'text' || a[0] === 'name')) {
        shift = false; /* one capital, as a phone's shift */
        build();
      }
    }

    function keyAt(t) {
      while (t && t !== root && !t.mkbKey)
        t = t.parentNode;
      return t && t.mkbKey ? t : null;
    }

    function stopRepeat() {
      if (repeat) {
        clearTimeout(repeat.t);
        clearInterval(repeat.i);
      }
      repeat = null;
    }

    function press(el) {
      release();
      pressed = el;
      el.classList.add('mkb-down');
      if (el.mkbKey.repeat) {
        /* held: the first now, more after a moment */
        act(el.mkbKey);
        repeat = {el: el, t: setTimeout(function () {
          repeat.i = setInterval(function () { act(el.mkbKey); }, 60);
        }, 400)};
      }
    }

    function release() {
      if (pressed)
        pressed.classList.remove('mkb-down');
      pressed = null;
      stopRepeat();
    }

    /* let go on the key pressed: it acts (a repeating key already did) */
    function up(el) {
      var k = pressed;
      var repeated = !!repeat;
      release();
      if (k && el === k && !repeated)
        act(k.mkbKey);
    }

    /* a finger: its own events, every default prevented (no focus moved,
       no compatibility mouse events, no zoom, no selection) */
    root.addEventListener('touchstart', function (e) {
      var el = keyAt(e.target);
      e.preventDefault();
      if (el && e.touches.length === 1)
        press(el);
    }, {passive: false});
    root.addEventListener('touchmove', function (e) {
      var t = e.changedTouches[0], el = keyAt(document.elementFromPoint(t.clientX, t.clientY));
      e.preventDefault();
      if (pressed && el !== pressed)
        release(); /* slid off: nothing */
    }, {passive: false});
    root.addEventListener('touchend', function (e) {
      var t = e.changedTouches[0];
      e.preventDefault();
      up(keyAt(document.elementFromPoint(t.clientX, t.clientY)));
    }, {passive: false});
    root.addEventListener('touchcancel', function () { release(); });

    /* the mouse and a pen: pointer events (a finger is the touch events') */
    root.addEventListener('pointerdown', function (e) {
      var el;
      e.preventDefault();
      if (e.pointerType === 'touch' || e.button !== 0)
        return;
      el = keyAt(e.target);
      if (el)
        press(el);
    });
    root.addEventListener('pointerup', function (e) {
      e.preventDefault();
      if (e.pointerType !== 'touch')
        up(keyAt(e.target));
    });
    root.addEventListener('pointerleave', function (e) {
      if (e.pointerType !== 'touch')
        release();
    });
    root.addEventListener('mousedown', function (e) { e.preventDefault(); });
    root.addEventListener('contextmenu', function (e) { e.preventDefault(); });

    this.setTab = function (t) {
      if (TABS[t]) {
        tab = t;
        shift = false;
        build();
      }
    };
    this.tab = function () { return tab; };
    build();
    self.tabs = names;
  }

  window.MathKeyboard = MathKeyboard;
})();
