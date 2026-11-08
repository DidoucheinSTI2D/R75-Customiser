/*
 * R75 Customiser: VIA protocol (QMK raw HID), keycodes, physical layout and macro codec.
 * Loaded as a classic <script> in the app (browser globals) and with require() in tests.
 */
(function (root) {
  'use strict';

  const ROWS = 6;
  const COLS = 15;

  const CMD = {
    PROTOCOL: 0x01,
    KEYMAP_SET: 0x05,
    KEYMAP_RESET: 0x06,
    CUSTOM_SET: 0x07,
    CUSTOM_GET: 0x08,
    CUSTOM_SAVE: 0x09,
    MACRO_COUNT: 0x0c,
    MACRO_SIZE: 0x0d,
    MACRO_GET: 0x0e,
    MACRO_SET: 0x0f,
    MACRO_RESET: 0x10,
    LAYER_COUNT: 0x11,
    KEYMAP_BUF_GET: 0x12,
    ENC_GET: 0x14,
    ENC_SET: 0x15,
  };

  // VIA lighting channel 3 = qmk_rgb_matrix
  const RGB = { CHANNEL: 3, BRIGHTNESS: 1, EFFECT: 2, SPEED: 3, COLOR: 4 };

  const hex4 = (n) => '0x' + n.toString(16).toUpperCase().padStart(4, '0');

  // ------------------------------------------------------------------ keycodes

  // Every human-readable string lives in STR (English defaults). localize() swaps in a
  // translation from src/i18n.js and refreshes the key tables in place.
  const EN = {
    groups: {
      BASIC: 'Letters & numbers', NAV: 'Function & navigation', SYM: 'Symbols & modifiers', NUM: 'Numpad',
      MEDIA: 'Media & system', LAYER: 'Layers (Fn)', LIGHT: 'Lighting', MACRO: 'Macros', RK: 'Wireless & keyboard', SPECIAL: 'Special',
    },
    layers: ['Windows', 'Windows Fn', 'Mac', 'Mac Fn', 'System'],
    effects: [
      'Off', 'Solid colour', 'Alphas / mods', 'Gradient up-down', 'Gradient left-right', 'Breathing',
      'Saturation band', 'Brightness band', 'Saturation pinwheel', 'Brightness pinwheel', 'Saturation spiral', 'Brightness spiral',
      'Rainbow cycle', 'Rainbow left-right', 'Rainbow up-down', 'Rainbow chevron', 'Rainbow out-in', 'Rainbow out-in dual',
      'Rainbow pinwheel', 'Rainbow spiral', 'Dual beacon', 'Rainbow beacon', 'Rainbow pinwheels', 'Raindrops',
      'Jellybean raindrops', 'Hue breathing', 'Hue pendulum', 'Hue wave', 'Pixel rain', 'Pixel flow', 'Pixel fractal',
      'Typing heatmap', 'Digital rain', 'Reactive simple', 'Reactive', 'Reactive wide', 'Reactive multi-wide',
      'Reactive cross', 'Reactive multi-cross', 'Reactive nexus', 'Reactive multi-nexus', 'Splash', 'Multi-splash',
      'Solid splash', 'Solid multi-splash', 'Off (RK)',
    ],
    keys: {}, // id -> 'label' or ['label', 'title'], overrides the English definitions below
    mods: { ctrl: 'Ctrl', shift: 'Shift', alt: 'Alt', altgr: 'AltGr', gui: 'Win', right: 'R' },
    mo: 'Hold: layer {0} ({1})',
    tg: 'Toggle layer {0} ({1})',
    to: 'Switch to layer {0} ({1})',
    macro: 'Macro {0}',
    modTap: 'Hold: {0}, tap: {1}',
    layerTap: 'Hold: layer {0}, tap: {1}',
    rk: 'Proprietary RK function',
    qmk: 'QMK code',
    errKey: 'Unknown key in macro: "{0}"',
    errBrace: 'Stray brace "{0}" in macro',
    errCharAz: 'Character not supported in AZERTY: "{0}"',
    errCharUs: 'Character not supported in US QWERTY: "{0}"',
    errCmd: 'Command 0x{0} refused by the keyboard',
    errLong: 'Macros too long: {0} / {1} bytes',
  };
  let STR = EN;
  const fmt = (s, ...a) => s.replace(/\{(\d)\}/g, (_, i) => a[i]);

  const G = { ...EN.groups };
  const LAYER_NAMES = [...EN.layers];
  const EFFECTS = [...EN.effects];

  const KEYS = [];
  const BY_CODE = new Map();
  const BY_ID = new Map();

  function def(group, code, id, label, title) {
    const k = { code, id, group, en: [label || id, title || label || id] };
    [k.label, k.title] = k.en;
    KEYS.push(k);
    BY_CODE.set(code, k);
    if (id) BY_ID.set(id, k);
  }
  const defs = (group, list) => list.forEach(([code, id, label, title]) => def(group, code, id, label, title));

  defs('SPECIAL', [
    [0x0000, 'KC_NO', '∅', 'No action'],
    [0x0001, 'KC_TRNS', '▽', 'Transparent (uses the layer below)'],
  ]);

  for (let i = 0; i < 26; i++) {
    const ch = String.fromCharCode(65 + i);
    def('BASIC', 0x04 + i, 'KC_' + ch, ch);
  }
  for (let i = 1; i <= 10; i++) def('BASIC', 0x1d + i, 'KC_' + (i % 10), String(i % 10));

  defs('NAV', [
    [0x29, 'KC_ESC', 'Esc', 'Escape'],
    [0x28, 'KC_ENT', 'Enter'],
    [0x2a, 'KC_BSPC', '⌫', 'Backspace'],
    [0x2b, 'KC_TAB', 'Tab'],
    [0x2c, 'KC_SPC', 'Space'],
    [0x39, 'KC_CAPS', 'Caps', 'Caps Lock'],
  ]);
  for (let i = 0; i < 12; i++) def('NAV', 0x3a + i, 'KC_F' + (i + 1), 'F' + (i + 1));
  defs('NAV', [
    [0x46, 'KC_PSCR', 'PrtSc', 'Print Screen'],
    [0x47, 'KC_SCRL', 'ScrLk', 'Scroll Lock'],
    [0x48, 'KC_PAUS', 'Pause'],
    [0x49, 'KC_INS', 'Ins', 'Insert'],
    [0x4a, 'KC_HOME', 'Home'],
    [0x4b, 'KC_PGUP', 'PgUp', 'Page Up'],
    [0x4c, 'KC_DEL', 'Del', 'Delete'],
    [0x4d, 'KC_END', 'End'],
    [0x4e, 'KC_PGDN', 'PgDn', 'Page Down'],
    [0x52, 'KC_UP', '↑'],
    [0x51, 'KC_DOWN', '↓'],
    [0x50, 'KC_LEFT', '←'],
    [0x4f, 'KC_RGHT', '→'],
    [0x65, 'KC_APP', 'Menu', 'Context menu'],
  ]);
  for (let i = 0; i < 12; i++) def('NAV', 0x68 + i, 'KC_F' + (i + 13), 'F' + (i + 13));

  defs('SYM', [
    [0xe0, 'KC_LCTL', 'Ctrl', 'Left Ctrl'],
    [0xe1, 'KC_LSFT', 'Shift', 'Left Shift'],
    [0xe2, 'KC_LALT', 'Alt', 'Left Alt'],
    [0xe3, 'KC_LGUI', 'Win', 'Windows key'],
    [0xe4, 'KC_RCTL', 'RCtrl', 'Right Ctrl'],
    [0xe5, 'KC_RSFT', 'RShift', 'Right Shift'],
    [0xe6, 'KC_RALT', 'AltGr'],
    [0xe7, 'KC_RGUI', 'RWin', 'Right Windows key'],
    [0x2d, 'KC_MINS', '-'],
    [0x2e, 'KC_EQL', '='],
    [0x2f, 'KC_LBRC', '['],
    [0x30, 'KC_RBRC', ']'],
    [0x31, 'KC_BSLS', '\\'],
    [0x32, 'KC_NUHS', '#', 'ISO # key (next to Enter)'],
    [0x33, 'KC_SCLN', ';'],
    [0x34, 'KC_QUOT', "'"],
    [0x35, 'KC_GRV', '`'],
    [0x36, 'KC_COMM', ','],
    [0x37, 'KC_DOT', '.'],
    [0x38, 'KC_SLSH', '/'],
    [0x64, 'KC_NUBS', '< >', 'ISO < > key'],
  ]);

  defs('NUM', [
    [0x53, 'KC_NUM', 'NumLk', 'Num Lock'],
    [0x54, 'KC_PSLS', 'N /'],
    [0x55, 'KC_PAST', 'N *'],
    [0x56, 'KC_PMNS', 'N -'],
    [0x57, 'KC_PPLS', 'N +'],
    [0x58, 'KC_PENT', 'N Enter', 'Numpad Enter'],
  ]);
  for (let i = 1; i <= 9; i++) def('NUM', 0x58 + i, 'KC_P' + i, 'N ' + i);
  defs('NUM', [
    [0x62, 'KC_P0', 'N 0'],
    [0x63, 'KC_PDOT', 'N .'],
  ]);

  defs('MEDIA', [
    [0xa8, 'KC_MUTE', 'Mute'],
    [0xa9, 'KC_VOLU', 'Vol+', 'Volume up'],
    [0xaa, 'KC_VOLD', 'Vol−', 'Volume down'],
    [0xae, 'KC_MPLY', '⏯', 'Play / pause'],
    [0xab, 'KC_MNXT', '⏭', 'Next track'],
    [0xac, 'KC_MPRV', '⏮', 'Previous track'],
    [0xad, 'KC_MSTP', '⏹', 'Stop'],
    [0xbb, 'KC_MFFD', '⏩', 'Fast forward'],
    [0xbc, 'KC_MRWD', '⏪', 'Rewind'],
    [0xaf, 'KC_MSEL', 'Player', 'Open media player'],
    [0xb0, 'KC_EJCT', 'Eject'],
    [0xb3, 'KC_MYCM', 'PC', 'Open File Explorer'],
    [0xb2, 'KC_CALC', 'Calc', 'Calculator'],
    [0xb1, 'KC_MAIL', 'Mail'],
    [0xb4, 'KC_WSCH', 'Search'],
    [0xb5, 'KC_WHOM', 'Web', 'Browser: home'],
    [0xb6, 'KC_WBAK', 'Web ←', 'Browser: back'],
    [0xb7, 'KC_WFWD', 'Web →', 'Browser: forward'],
    [0xb9, 'KC_WREF', 'Web ⟳', 'Browser: refresh'],
    [0xba, 'KC_WFAV', 'Favs', 'Favorites'],
    [0xbd, 'KC_BRIU', 'Scr+', 'Screen brightness +'],
    [0xbe, 'KC_BRID', 'Scr−', 'Screen brightness −'],
    [0xa6, 'KC_SLEP', 'Sleep'],
    [0xa5, 'KC_PWR', 'Power'],
  ]);

  for (let n = 0; n < 5; n++) def('LAYER', 0x5220 | n, `MO(${n})`, `Fn${n}`);
  for (let n = 0; n < 5; n++) def('LAYER', 0x5260 | n, `TG(${n})`, `TG${n}`);
  for (let n = 0; n < 5; n++) def('LAYER', 0x5200 | n, `TO(${n})`, `TO${n}`);

  defs('LIGHT', [
    [0x7820, 'RGB_TOG', 'RGB ⏻', 'Lighting on/off'],
    [0x7821, 'RGB_MOD', 'Fx+', 'Next effect'],
    [0x7822, 'RGB_RMOD', 'Fx−', 'Previous effect'],
    [0x7827, 'RGB_VAI', 'Bri+', 'RGB brightness +'],
    [0x7828, 'RGB_VAD', 'Bri−', 'RGB brightness −'],
    [0x7829, 'RGB_SPI', 'Spd+', 'Effect speed +'],
    [0x782a, 'RGB_SPD', 'Spd−', 'Effect speed −'],
    [0x7823, 'RGB_HUI', 'Hue+'],
    [0x7824, 'RGB_HUD', 'Hue−'],
    [0x7825, 'RGB_SAI', 'Sat+', 'Saturation +'],
    [0x7826, 'RGB_SAD', 'Sat−', 'Saturation −'],
  ]);

  for (let n = 0; n < 16; n++) def('MACRO', 0x7700 + n, 'M' + n, 'M' + n);

  defs('RK', [
    [0x7e00, 'BT1', 'BT1', 'Bluetooth device 1'],
    [0x7e01, 'BT2', 'BT2', 'Bluetooth device 2'],
    [0x7e02, 'BT3', 'BT3', 'Bluetooth device 3'],
    [0x7e03, 'BT4', 'BT4', 'Bluetooth device 4'],
    [0x7e04, 'BT5', 'BT5', 'Bluetooth device 5'],
    [0x7e05, 'RF24', '2.4G', '2.4 GHz mode (dongle)'],
    [0x7e06, 'USB', 'USB', 'Wired mode'],
    [0x700b, 'GUI_TOG', 'Win Lock', 'Lock / unlock the Windows key'],
    [0x7013, 'NK_TOGG', 'NKRO', 'Toggle NKRO'],
    [0x7c00, 'QK_BOOT', 'Boot', 'Bootloader mode (firmware update)'],
    [0x7c03, 'EE_CLR', 'Reset', 'Keyboard factory reset'],
  ]);

  /** Apply a translation ({groups, layers, effects, keys, mods, ...}); missing entries fall back to English. */
  function localize(tr = {}) {
    STR = { ...EN, ...tr, groups: { ...EN.groups, ...tr.groups }, mods: { ...EN.mods, ...tr.mods } };
    Object.assign(G, STR.groups);
    LAYER_NAMES.splice(0, Infinity, ...EN.layers.map((n, i) => (tr.layers && tr.layers[i]) || n));
    EFFECTS.splice(0, Infinity, ...EN.effects.map((n, i) => (tr.effects && tr.effects[i]) || n));
    const keys = tr.keys || {};
    for (const k of KEYS) {
      const o = keys[k.id];
      [k.label, k.title] = o === undefined ? k.en : Array.isArray(o) ? o : [o, o];
      const n = k.code & 0x0f;
      if ((k.code & 0xffe0) === 0x5220) k.title = fmt(STR.mo, n, LAYER_NAMES[n]);
      if ((k.code & 0xffe0) === 0x5260) k.title = fmt(STR.tg, n, LAYER_NAMES[n]);
      if ((k.code & 0xffe0) === 0x5200) k.title = fmt(STR.to, n, LAYER_NAMES[n]);
      if (k.group === 'MACRO') k.title = fmt(STR.macro, k.code - 0x7700);
    }
  }
  localize();

  const MOD = { CTRL: 1, SHIFT: 2, ALT: 4, GUI: 8, RIGHT: 16 };

  function modNames(m) {
    const M = STR.mods;
    const r = m & MOD.RIGHT ? ' ' + M.right : '';
    const out = [];
    if (m & MOD.CTRL) out.push(M.ctrl + r);
    if (m & MOD.SHIFT) out.push(M.shift + r);
    if (m & MOD.ALT) out.push(r ? M.altgr : M.alt);
    if (m & MOD.GUI) out.push(M.gui + r);
    return out.join('+');
  }

  const baseLabel = (kc) => (BY_CODE.get(kc) || { label: hex4(kc) }).label;

  /** Short human label for any 16-bit QMK keycode. */
  function label(code) {
    const k = BY_CODE.get(code);
    if (k) return k.label;
    if (code < 0x2000) return modNames(code >> 8) + '+' + baseLabel(code & 0xff);
    if (code < 0x4000) return `${modNames((code >> 8) & 0x1f)} / ${baseLabel(code & 0xff)}`;
    if (code < 0x5000) return `Fn${(code >> 8) & 0x0f} / ${baseLabel(code & 0xff)}`;
    return hex4(code);
  }

  /** Long description (tooltip). */
  function describe(code) {
    const k = BY_CODE.get(code);
    const h = ` (${hex4(code)})`;
    if (k) return k.title + h;
    if (code < 0x2000) return label(code) + h;
    if (code < 0x4000) return fmt(STR.modTap, modNames((code >> 8) & 0x1f), baseLabel(code & 0xff)) + h;
    if (code < 0x5000) return fmt(STR.layerTap, (code >> 8) & 0x0f, baseLabel(code & 0xff)) + h;
    if (code >= 0x7e00 && code < 0x7f00) return STR.rk + h;
    return `${STR.qmk} ${hex4(code)}`;
  }

  // ------------------------------------------------------------------ layout
  // Real R75 matrix positions (the RK VIA JSON swaps backslash/knob and shifts the bottom row).
  // Row entries: [row, col, width = 1, gapBefore = 0]
  const ROW_DEFS = [
    [[0, 0], [0, 1, 1, 0.25], [0, 2], [0, 3], [0, 4], [0, 5, 1, 0.25], [0, 6], [0, 7], [0, 8], [0, 9, 1, 0.25], [0, 10], [0, 11], [0, 12], [0, 13, 1, 0.25], [2, 13, 1, 0, 'knob']],
    [[1, 0], [1, 1], [1, 2], [1, 3], [1, 4], [1, 5], [1, 6], [1, 7], [1, 8], [1, 9], [1, 10], [1, 11], [1, 12], [1, 13, 2], [1, 14]],
    [[2, 0, 1.5], [2, 1], [2, 2], [2, 3], [2, 4], [2, 5], [2, 6], [2, 7], [2, 8], [2, 9], [2, 10], [2, 11], [2, 12], [3, 12, 1.5], [2, 14]],
    [[3, 0, 1.75], [3, 1], [3, 2], [3, 3], [3, 4], [3, 5], [3, 6], [3, 7], [3, 8], [3, 9], [3, 10], [3, 11], [3, 13, 2.25], [3, 14]],
    [[4, 0, 2.25], [4, 2], [4, 3], [4, 4], [4, 5], [4, 6], [4, 7], [4, 8], [4, 9], [4, 10], [4, 11], [4, 12, 1.75], [4, 13]],
    [[5, 0, 1.25], [5, 1, 1.25], [5, 2, 1.25], [5, 5, 6.25], [5, 9, 1.25], [5, 10, 1.25], [5, 12, 1, 0.5], [5, 13], [5, 14]],
  ];
  const LAYOUT = [];
  ROW_DEFS.forEach((row, i) => {
    let x = 0;
    const y = i === 0 ? 0 : i + 0.25;
    for (const [r, c, w = 1, gap = 0, kind] of row) {
      x += gap;
      LAYOUT.push({ r, c, x, y, w, knob: kind === 'knob' });
      x += w;
    }
  });
  const LAYOUT_WIDTH = 16;
  const LAYOUT_HEIGHT = 6.25;

  // Effects that ignore the user colour (per the RK VIA definition).
  const EFFECTS_NO_COLOR = new Set([0, 24, 28, 29, 32]);

  // ------------------------------------------------------------------ macros
  // VIA macro buffer: macros separated by 0x00. Plain ASCII is typed as-is (US layout);
  // 0x01 <1 tap | 2 down | 3 up> <keycode> and 0x01 0x04 <ms ascii> '|' for delays.
  const SS = 0x01;
  const A_TAP = 1;
  const A_DOWN = 2;
  const A_UP = 3;
  const A_DELAY = 4;

  const KC_LSFT = 0xe1;
  const KC_RALT = 0xe6;

  // French AZERTY (Windows): char -> list of steps [modKeycodes[], keycode]
  const AZ = new Map();
  (function buildAzerty() {
    const S = [KC_LSFT];
    const AG = [KC_RALT];
    const add = (ch, ...steps) => { if (!AZ.has(ch)) AZ.set(ch, steps); };
    const letterKc = (l) => ({ a: 0x14, q: 0x04, z: 0x1a, w: 0x1d, m: 0x33 }[l] ?? 0x04 + l.charCodeAt(0) - 97);
    for (let i = 0; i < 26; i++) {
      const l = String.fromCharCode(97 + i);
      add(l, [[], letterKc(l)]);
      add(l.toUpperCase(), [S, letterKc(l)]);
    }
    const row = [0x1e, 0x1f, 0x20, 0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x2d, 0x2e];
    const plain = '&é"\'(-è_çà)=';
    const shift = '1234567890°+';
    const altgr = [null, null, '#', '{', '[', '|', null, '\\', '^', '@', ']', '}'];
    row.forEach((kc, i) => {
      add(plain[i], [[], kc]);
      add(shift[i], [S, kc]);
      if (altgr[i]) add(altgr[i], [AG, kc]);
    });
    add('~', [AG, 0x1f], [[], 0x2c]); // dead key + space
    add('`', [AG, 0x24], [[], 0x2c]);
    add('$', [[], 0x30]);
    add('£', [S, 0x30]);
    add('¤', [AG, 0x30]);
    add('ù', [[], 0x34]);
    add('%', [S, 0x34]);
    add('*', [[], 0x31]);
    add('µ', [S, 0x31]);
    add('<', [[], 0x64]);
    add('>', [S, 0x64]);
    add(',', [[], 0x10]);
    add('?', [S, 0x10]);
    add(';', [[], 0x36]);
    add('.', [S, 0x36]);
    add(':', [[], 0x37]);
    add('/', [S, 0x37]);
    add('!', [[], 0x38]);
    add('§', [S, 0x38]);
    add('²', [[], 0x35]);
    add('€', [AG, 0x08]);
    add(' ', [[], 0x2c]);
    add('\n', [[], 0x28]);
    add('\t', [[], 0x2b]);
    for (const [ch, base] of [['â', 'a'], ['ê', 'e'], ['î', 'i'], ['ô', 'o'], ['û', 'u']]) add(ch, [[], 0x2f], [[], letterKc(base)]);
    for (const [ch, base] of [['ä', 'a'], ['ë', 'e'], ['ï', 'i'], ['ö', 'o'], ['ü', 'u'], ['ÿ', 'y']]) add(ch, [S, 0x2f], [[], letterKc(base)]);
  })();

  const stepBytes = ([mods, kc]) => [
    ...mods.flatMap((m) => [SS, A_DOWN, m]),
    SS, A_TAP, kc,
    ...mods.slice().reverse().flatMap((m) => [SS, A_UP, m]),
  ];
  // Pre-encoded AZERTY chars, longest first, for decoding back to text.
  const AZ_ENC = [...AZ].map(([ch, steps]) => [ch, steps.flatMap(stepBytes)]).sort((a, b) => b[1].length - a[1].length);

  function kcByte(name) {
    const n = name.trim().toUpperCase();
    let code;
    if (/^0X[0-9A-F]{1,2}$/.test(n)) code = parseInt(n, 16);
    else {
      const k = BY_ID.get(n) || BY_ID.get('KC_' + n);
      code = k ? k.code : undefined;
    }
    if (code === undefined || code > 0xff) throw new Error(fmt(STR.errKey, name));
    return code;
  }
  const kcName = (code) => {
    const k = BY_CODE.get(code);
    return k && k.id && k.id.startsWith('KC_') ? k.id : '0x' + code.toString(16).toUpperCase().padStart(2, '0');
  };

  /**
   * Text syntax (VIA compatible): plain text, {KC_ENT} tap, {KC_LCTL,KC_C} chord,
   * {+KC_LSFT} press, {-KC_LSFT} release, {250} delay in ms.
   * layout 'azerty' converts text to key presses for a French AZERTY Windows layout.
   */
  function encodeMacro(src, layout) {
    const out = [];
    const re = /\{([^}]*)\}|([^{}]+)|([{}])/g;
    let m;
    while ((m = re.exec(src))) {
      if (m[3]) throw new Error(fmt(STR.errBrace, m[3]));
      if (m[2] !== undefined) {
        for (const ch of m[2].replace(/\r/g, '')) {
          if (layout === 'azerty') {
            const steps = AZ.get(ch);
            if (!steps) throw new Error(fmt(STR.errCharAz, ch));
            steps.forEach((s) => out.push(...stepBytes(s)));
          } else {
            const c = ch.charCodeAt(0);
            if (!(c === 10 || c === 9 || (c >= 0x20 && c <= 0x7e))) throw new Error(fmt(STR.errCharUs, ch));
            out.push(c);
          }
        }
        continue;
      }
      const inner = m[1].trim();
      if (/^\d+$/.test(inner)) {
        out.push(SS, A_DELAY, ...[...inner].map((c) => c.charCodeAt(0)), 0x7c);
      } else if (/^[+-]/.test(inner)) {
        out.push(SS, inner[0] === '+' ? A_DOWN : A_UP, kcByte(inner.slice(1)));
      } else {
        const codes = inner.split(',').map(kcByte);
        if (codes.length === 1) out.push(SS, A_TAP, codes[0]);
        else {
          codes.forEach((c) => out.push(SS, A_DOWN, c));
          codes.slice().reverse().forEach((c) => out.push(SS, A_UP, c));
        }
      }
    }
    return out;
  }

  function decodeMacro(b, layout) {
    const items = [];
    let i = 0;
    outer: while (i < b.length) {
      if (b[i] !== SS) {
        items.push({ t: String.fromCharCode(b[i++]) });
        continue;
      }
      if (layout === 'azerty') {
        for (const [ch, enc] of AZ_ENC) {
          if (enc.every((v, j) => b[i + j] === v)) {
            items.push({ t: ch });
            i += enc.length;
            continue outer;
          }
        }
      }
      const a = b[i + 1];
      if (a === A_DELAY) {
        let j = i + 2;
        let ms = '';
        while (j < b.length && b[j] !== 0x7c) ms += String.fromCharCode(b[j++]);
        items.push({ d: ms });
        i = j + 1;
      } else if (a >= A_TAP && a <= A_UP) {
        items.push({ a, k: b[i + 2] });
        i += 3;
      } else {
        i += 2; // unsupported action (16-bit keycode), skipped
      }
    }

    let s = '';
    for (let n = 0; n < items.length; n++) {
      const it = items[n];
      if (it.t !== undefined) s += it.t;
      else if (it.d !== undefined) s += `{${it.d}}`;
      else if (it.a === A_TAP) s += `{${kcName(it.k)}}`;
      else if (it.a === A_DOWN) {
        // Collapse "down a, down b, up b, up a" into {a,b}
        let e = n;
        while (items[e + 1] && items[e + 1].a === A_DOWN) e++;
        const downs = items.slice(n, e + 1);
        const ups = items.slice(e + 1, e + 1 + downs.length);
        if (ups.length === downs.length && ups.every((u, j) => u.a === A_UP && u.k === downs[downs.length - 1 - j].k)) {
          s += `{${downs.map((d) => kcName(d.k)).join(',')}}`;
          n = e + downs.length;
        } else s += `{+${kcName(it.k)}}`;
      } else s += `{-${kcName(it.k)}}`;
    }
    return s;
  }

  // ------------------------------------------------------------------ protocol

  class Via {
    /** @param transfer (Uint8Array(32)) => Promise<Uint8Array> : one raw HID request/response */
    constructor(transfer) {
      this.transfer = transfer;
      this.queue = Promise.resolve();
    }

    cmd(...bytes) {
      const buf = new Uint8Array(32);
      buf.set(bytes);
      const p = this.queue.then(() => this.transfer(buf)).then((r) => {
        if (r[0] !== bytes[0]) throw new Error(fmt(STR.errCmd, bytes[0].toString(16)));
        return r;
      });
      this.queue = p.catch(() => {});
      return p;
    }

    async protocol() {
      const r = await this.cmd(CMD.PROTOCOL);
      return (r[1] << 8) | r[2];
    }
    async layerCount() {
      return (await this.cmd(CMD.LAYER_COUNT))[1];
    }

    async readKeymap(layers) {
      const size = layers * ROWS * COLS * 2;
      const bytes = new Uint8Array(size);
      for (let off = 0; off < size; off += 28) {
        const n = Math.min(28, size - off);
        const r = await this.cmd(CMD.KEYMAP_BUF_GET, off >> 8, off & 0xff, n);
        bytes.set(r.subarray(4, 4 + n), off);
      }
      return Array.from({ length: layers }, (_, l) =>
        Array.from({ length: ROWS }, (_, r) =>
          Array.from({ length: COLS }, (_, c) => {
            const i = ((l * ROWS + r) * COLS + c) * 2;
            return (bytes[i] << 8) | bytes[i + 1];
          })));
    }
    setKey(layer, row, col, code) {
      return this.cmd(CMD.KEYMAP_SET, layer, row, col, code >> 8, code & 0xff);
    }
    resetKeymap() {
      return this.cmd(CMD.KEYMAP_RESET);
    }

    async getEncoder(layer, dir) {
      const r = await this.cmd(CMD.ENC_GET, layer, 0, dir);
      return (r[4] << 8) | r[5];
    }
    setEncoder(layer, dir, code) {
      return this.cmd(CMD.ENC_SET, layer, 0, dir, code >> 8, code & 0xff);
    }

    async getLighting() {
      const get = async (id) => (await this.cmd(CMD.CUSTOM_GET, RGB.CHANNEL, id)).subarray(3);
      const b = await get(RGB.BRIGHTNESS);
      const e = await get(RGB.EFFECT);
      const s = await get(RGB.SPEED);
      const c = await get(RGB.COLOR);
      return { brightness: b[0], effect: e[0], speed: s[0], hue: c[0], sat: c[1] };
    }
    setLighting(id, ...values) {
      return this.cmd(CMD.CUSTOM_SET, RGB.CHANNEL, id, ...values);
    }
    saveLighting() {
      return this.cmd(CMD.CUSTOM_SAVE, RGB.CHANNEL);
    }

    async macroInfo() {
      const count = (await this.cmd(CMD.MACRO_COUNT))[1];
      const r = await this.cmd(CMD.MACRO_SIZE);
      return { count, size: (r[1] << 8) | r[2] };
    }
    /** @returns array of byte arrays, one per macro slot */
    async readMacros() {
      const { count, size } = await this.macroInfo();
      const macros = [[]];
      for (let off = 0; off < size && macros.length <= count; off += 28) {
        const n = Math.min(28, size - off);
        const r = await this.cmd(CMD.MACRO_GET, off >> 8, off & 0xff, n);
        for (const v of r.subarray(4, 4 + n)) {
          if (v === 0) macros.push([]);
          else macros[macros.length - 1].push(v);
        }
      }
      return macros.slice(0, count);
    }
    async writeMacros(list) {
      const { size } = await this.macroInfo();
      const data = list.flatMap((m) => [...m, 0]);
      if (data.length > size) throw new Error(fmt(STR.errLong, data.length, size));
      await this.cmd(CMD.MACRO_RESET);
      for (let off = 0; off < data.length; off += 28) {
        const chunk = data.slice(off, off + 28);
        await this.cmd(CMD.MACRO_SET, off >> 8, off & 0xff, chunk.length, ...chunk);
      }
    }
  }

  const api = {
    Via, KEYS, G, MOD, LAYOUT, LAYOUT_WIDTH, LAYOUT_HEIGHT, LAYER_NAMES, EFFECTS, EFFECTS_NO_COLOR, RGB,
    ROWS, COLS, label, describe, hex4, encodeMacro, decodeMacro, localize,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.R75 = api;
})(this);
