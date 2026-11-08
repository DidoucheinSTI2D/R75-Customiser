'use strict';
/* global R75, R75FX, I18N */
const {
  Via, KEYS, G, MOD, LAYOUT, LAYER_NAMES, EFFECTS, EFFECTS_NO_COLOR, RGB, label, describe, encodeMacro, decodeMacro, localize,
} = R75;

const VENDOR_ID = 0x342d;
const RAW_USAGE_PAGE = 0xff60;
const BASE_OF = { 1: 0, 3: 2, 4: 0 }; // layer whose keys show through "transparent"
const KC = { MUTE: 0xa8, VOLU: 0xa9, VOLD: 0xaa, F22: 0x71, F23: 0x72, F24: 0x73 };
const host = window.r75; // Electron preload bridge (knob feature), absent in a plain browser

const $ = (s) => document.querySelector(s);
const el = (tag, props = {}, ...children) => {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...children);
  return e;
};
const store = {
  get(k, d) { try { return localStorage.getItem(k) || d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* optional */ } },
};

const S = {
  dev: null, via: null, layers: 0, keymap: null, enc: null, light: null,
  macros: [], macroInfo: null, layer: 0, sel: null,
};

// ------------------------------------------------------------------ i18n
let lang = 'en';
function t(key, ...a) {
  const s = I18N[lang].ui[key] ?? I18N.en.ui[key] ?? key;
  return s.replace(/\{(\d)\}/g, (_, i) => a[i]);
}
/** Text with `code` spans. */
function rich(node, text) {
  node.replaceChildren(...text.split('`').map((part, i) => (i % 2 ? el('code', { textContent: part }) : part)));
}

function setLang(l) {
  lang = I18N[l] ? l : 'en';
  store.set('r75.lang', lang);
  localize(I18N[lang].via);
  document.documentElement.lang = lang;
  document.documentElement.dir = I18N[lang].rtl ? 'rtl' : 'ltr';
  document.querySelectorAll('[data-i18n]').forEach((e) => (e.textContent = t(e.dataset.i18n)));
  document.querySelectorAll('[data-i18n-ph]').forEach((e) => (e.placeholder = t(e.dataset.i18nPh)));
  document.querySelectorAll('[data-i18n-title]').forEach((e) => (e.title = t(e.dataset.i18nTitle)));
  document.querySelectorAll('[data-i18n-rich]').forEach((e) => rich(e, t(e.dataset.i18nRich)));
  $('#lang').value = lang;
  paintStatus();
  paintConnect();
  renderPicker();
  renderFxNames();
  renderProfiles();
  if (S.via) renderAll();
  if (host) host.setKnob({ lang }).catch(() => {});
}

Object.entries(I18N).forEach(([code, L]) => $('#lang').append(el('option', { value: code, textContent: L.name })));
$('#lang').addEventListener('change', (e) => setLang(e.target.value));

// ------------------------------------------------------------------ feedback
let toastTimer;
function toast(msg, err = false) {
  const tt = $('#toast');
  tt.textContent = msg;
  tt.className = 'show' + (err ? ' err' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (tt.className = ''), err ? 5000 : 2200);
}
function fail(e) {
  console.error(e);
  toast(e && e.message ? e.message : String(e), true);
}

let statusArgs = ['off', 'st.search'];
function setStatus(state, key, ...a) {
  statusArgs = [state, key, ...a];
  paintStatus();
}
function paintStatus() {
  const [state, key, ...a] = statusArgs;
  $('#status').className = 'status ' + state;
  $('#status span').textContent = t(key, ...a);
}

// ------------------------------------------------------------------ connection
const isRaw = (d) => d.vendorId === VENDOR_ID && d.collections.some((c) => c.usagePage === RAW_USAGE_PAGE);

function hidTransfer(dev) {
  return (data) => new Promise((resolve, reject) => {
    const onReport = (e) => {
      clearTimeout(timer);
      resolve(new Uint8Array(e.data.buffer, e.data.byteOffset, e.data.byteLength).slice());
    };
    const timer = setTimeout(() => {
      dev.removeEventListener('inputreport', onReport);
      reject(new Error(t('err.timeout')));
    }, 1500);
    dev.addEventListener('inputreport', onReport, { once: true });
    dev.sendReport(0, data).catch((err) => {
      clearTimeout(timer);
      dev.removeEventListener('inputreport', onReport);
      reject(err);
    });
  });
}

let connectMsg = { key: 'c.msg' }; // {key} or {text}
function paintConnect() {
  $('#connect-msg').textContent = connectMsg.key ? t(connectMsg.key) : connectMsg.text;
}
function showConnect(msg) {
  $('#connect').hidden = false;
  document.querySelectorAll('.tab').forEach((x) => (x.hidden = true));
  $('#tabs').classList.add('disabled');
  if (msg) connectMsg = msg;
  paintConnect();
}
function showApp() {
  $('#connect').hidden = true;
  $('#tabs').classList.remove('disabled');
  showTab(document.querySelector('#tabs .active').dataset.tab);
}

let connecting = false;
async function connect(dev) {
  if (connecting) return;
  connecting = true;
  try {
    setStatus('busy', 'st.connecting');
    if (!dev.opened) await dev.open();
    const via = new Via(hidTransfer(dev));
    const proto = await via.protocol();
    setStatus('busy', 'st.reading');
    const layers = await via.layerCount();
    const keymap = await via.readKeymap(layers);
    const enc = [];
    for (let l = 0; l < layers; l++) enc.push([await via.getEncoder(l, 0), await via.getEncoder(l, 1)]);
    const light = await via.getLighting();
    const macroInfo = await via.macroInfo();
    const macros = await via.readMacros();
    Object.assign(S, { dev, via, proto, layers, keymap, enc, light, macroInfo, macros, sel: null, layer: Math.min(S.layer, layers - 1) });
    setStatus('on', 'st.on', dev.productName || 'R75', proto);
    showApp();
    renderAll();
  } catch (e) {
    console.error(e);
    S.via = null;
    setStatus('off', 'st.unreach');
    showConnect({ text: e.message });
  } finally {
    connecting = false;
  }
}

async function autoConnect() {
  if (S.via) return;
  const dev = (await navigator.hid.getDevices()).find(isRaw);
  if (dev) connect(dev);
  else {
    setStatus('off', 'st.none');
    showConnect();
  }
}

$('#btn-search').onclick = async () => {
  try {
    const devs = await navigator.hid.requestDevice({ filters: [{ vendorId: VENDOR_ID, usagePage: RAW_USAGE_PAGE }] });
    const dev = devs.find(isRaw);
    if (dev) connect(dev);
    else showConnect({ key: 'c.none' });
  } catch (e) {
    fail(e);
  }
};
if ('hid' in navigator) {
  navigator.hid.addEventListener('connect', () => autoConnect());
  navigator.hid.addEventListener('disconnect', (e) => {
    if (e.device !== S.dev) return;
    Object.assign(S, { dev: null, via: null });
    setStatus('off', 'st.gone');
    showConnect({ key: 'c.gone' });
  });
}

// ------------------------------------------------------------------ tabs
function showTab(name) {
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab').forEach((x) => (x.hidden = x.id !== 'tab-' + name));
  if (name === 'knob') refreshApps();
}
document.querySelectorAll('#tabs button').forEach((b) => (b.onclick = () => showTab(b.dataset.tab)));

function renderAll() {
  renderLayers();
  renderBoard();
  renderEnc();
  renderSelInfo();
  renderLight();
  renderMacros();
  renderKnob();
  renderProfiles();
}

// ------------------------------------------------------------------ keys tab
function renderLayers() {
  const box = $('#layers');
  box.replaceChildren();
  for (let l = 0; l < S.layers; l++) {
    const b = el('button', { textContent: LAYER_NAMES[l] || t('keys.layer', l), className: l === S.layer ? 'active' : '' });
    b.onclick = () => {
      S.layer = l;
      renderLayers();
      renderBoard();
      renderEnc();
      renderSelInfo();
    };
    box.append(b);
  }
}

const isSel = (k) => S.sel && S.sel.kind === 'key' && S.sel.r === k.r && S.sel.c === k.c;

function renderBoard() {
  const board = $('#board');
  board.replaceChildren();
  const base = BASE_OF[S.layer];
  for (const k of LAYOUT) {
    const code = S.keymap[S.layer][k.r][k.c];
    const shown = code === 1 && base !== undefined ? S.keymap[base][k.r][k.c] : code;
    const b = el('button', {
      className: ['key', k.knob && 'knob', isSel(k) && 'sel', code === 1 && 'trns', code === 0 && 'none'].filter(Boolean).join(' '),
      title: (code === 1 ? t('keys.trns', describe(shown)) : describe(code)) + (k.knob ? ' · ' + t('keys.knobPress') : ''),
    }, el('span', { className: 'lbl', textContent: label(shown) }));
    if (code === 1) b.append(el('small', { textContent: '▽' }));
    Object.assign(b.style, {
      left: `calc(var(--u) * ${k.x})`,
      top: `calc(var(--u) * ${k.y})`,
      width: `calc(var(--u) * ${k.w} - 4px)`,
      height: 'calc(var(--u) - 4px)',
    });
    b.onclick = () => select({ kind: 'key', r: k.r, c: k.c });
    board.append(b);
  }
}

function renderEnc() {
  const box = $('#enc');
  box.replaceChildren(el('span', { textContent: t('keys.knob') }));
  [['keys.right', 0], ['keys.left', 1]].forEach(([key, dir]) => {
    const code = S.enc[S.layer][dir];
    const selected = S.sel && S.sel.kind === 'enc' && S.sel.dir === dir;
    const b = el('button', { className: selected ? 'sel' : '', title: describe(code) }, `${t(key)}: `, el('bdi', { textContent: label(code), dir: 'ltr' }));
    b.onclick = () => select({ kind: 'enc', dir });
    box.append(b);
  });
}

function currentCode() {
  if (!S.sel) return null;
  return S.sel.kind === 'key' ? S.keymap[S.layer][S.sel.r][S.sel.c] : S.enc[S.layer][S.sel.dir];
}

const MOD_BOXES = [['#m-ctrl', MOD.CTRL], ['#m-shift', MOD.SHIFT], ['#m-alt', MOD.ALT], ['#m-gui', MOD.GUI]];

function select(sel) {
  S.sel = sel;
  const code = currentCode();
  const mods = code < 0x2000 ? (code >> 8) & 0x0f : 0;
  MOD_BOXES.forEach(([id, bit]) => ($(id).checked = !!(mods & bit)));
  renderBoard();
  renderEnc();
  renderSelInfo();
}

function renderSelInfo() {
  const box = $('#sel-info');
  const code = currentCode();
  if (code === null) {
    box.textContent = t('keys.selNone');
    return;
  }
  const where = S.sel.kind === 'key' ? t('keys.selKey', S.sel.r, S.sel.c) : `${t('keys.knob')} ${S.sel.dir === 0 ? '↻' : '↺'}`;
  box.replaceChildren(`${LAYER_NAMES[S.layer] || t('keys.layer', S.layer)} · ${where}: `, el('b', { textContent: label(code), title: describe(code), dir: 'ltr' }));
}

const DANGEROUS = new Set([0x7c00, 0x7c03]);
const isFnKey = (code) => code >= 0x5200 && code < 0x5300;

async function assign(code) {
  const sel = S.sel;
  if (!sel) return toast(t('keys.pickFirst'), true);
  const prev = currentCode();
  if (DANGEROUS.has(code) && !confirm(t('keys.danger', describe(code)))) return;
  if (isFnKey(prev) && !isFnKey(code) && !confirm(t('keys.fnWarn'))) return;
  try {
    if (sel.kind === 'key') {
      await S.via.setKey(S.layer, sel.r, sel.c, code);
      S.keymap[S.layer][sel.r][sel.c] = code;
    } else {
      await S.via.setEncoder(S.layer, sel.dir, code);
      S.enc[S.layer][sel.dir] = code;
      renderKnob();
    }
    renderBoard();
    renderEnc();
    renderSelInfo();
    toast(t('keys.assigned', label(code)));
  } catch (e) {
    fail(e);
  }
}

function withMods(code) {
  if (code < 0x04 || code > 0xff) return code;
  const mods = MOD_BOXES.reduce((m, [id, bit]) => m | ($(id).checked ? bit : 0), 0);
  return code | (mods << 8);
}

function renderPicker() {
  const q = $('#search').value.trim().toLowerCase();
  const box = $('#groups');
  box.replaceChildren();
  for (const [gk, gname] of Object.entries(G)) {
    const keys = KEYS.filter((k) => k.group === gk && (!q || `${k.label} ${k.title} ${k.id} ${k.en.join(' ')}`.toLowerCase().includes(q)));
    if (!keys.length) continue;
    const list = el('div', { className: 'kcs' });
    for (const k of keys) {
      const b = el('button', { className: 'kc' + (DANGEROUS.has(k.code) ? ' warn' : ''), textContent: k.label, title: `${k.title} · ${k.id}` });
      b.onclick = () => assign(withMods(k.code));
      list.append(b);
    }
    box.append(el('div', { className: 'group' }, el('h4', { textContent: gname }), list));
  }
}
$('#search').addEventListener('input', renderPicker);
$('#raw-apply').onclick = () => {
  const v = $('#raw').value.trim();
  const code = /^(0x)?[0-9a-f]{1,4}$/i.test(v) ? parseInt(v.replace(/^0x/i, ''), 16) : NaN;
  if (Number.isNaN(code)) return toast(t('keys.rawErr'), true);
  assign(code);
};

// ------------------------------------------------------------------ lighting tab
function hsToHex(h, s) {
  return '#' + R75FX.hsv(h, s, 255).map((x) => Math.round(x).toString(16).padStart(2, '0')).join('');
}
function hexToHs(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d) {
    h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
    if (h < 0) h += 1;
  }
  return [Math.round(h * 255) % 256, max ? Math.round((d / max) * 255) : 0];
}

/** Send only the latest value while a request is in flight, then persist. */
function live(send) {
  let busy = false;
  let pending = null;
  return (...args) => {
    pending = args;
    if (busy) return;
    busy = true;
    (async () => {
      while (pending) {
        const a = pending;
        pending = null;
        try {
          await send(...a);
        } catch (e) {
          fail(e);
        }
      }
      busy = false;
      scheduleSave();
    })();
  };
}
let saveTimer;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => S.via && S.via.saveLighting().catch(fail), 700);
}

const sendBright = live((v) => S.via.setLighting(RGB.BRIGHTNESS, v));
const sendSpeed = live((v) => S.via.setLighting(RGB.SPEED, v));
const sendEffect = live((v) => S.via.setLighting(RGB.EFFECT, v));
const sendColor = live((h, s) => S.via.setLighting(RGB.COLOR, h, s));

// Effect previews: one big stage + one tile per effect, animated while the tab is visible.
const FX = { big: null, tiles: [] };
EFFECTS.forEach((_, i) => {
  const cv = el('canvas');
  const name = el('span');
  const btn = el('button', { className: 'fx' }, cv, el('div', {}, name, el('small', { textContent: String(i).padStart(2, '0') })));
  btn.onclick = () => setEffect(i);
  $('#fx-grid').append(btn);
  const tile = { i, cv, name, btn, sim: new R75FX.Sim(i, LAYOUT), seen: false };
  // Only the hovered tile moves: 46 animations at once is too much flashing.
  btn.addEventListener('mouseenter', () => (FX.hover = tile));
  btn.addEventListener('mouseleave', () => { FX.hover = null; tile.sim = new R75FX.Sim(i, LAYOUT); });
  FX.tiles.push(tile);
});
const STILL = 4000; // time of the frozen frame shown by idle tiles
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const seen = new IntersectionObserver((entries) => entries.forEach((en) => {
  const tile = FX.tiles.find((x) => x.btn === en.target);
  tile.seen = en.isIntersecting;
}));
FX.tiles.forEach((x) => seen.observe(x.btn));

function renderFxNames() {
  FX.tiles.forEach((x) => (x.name.textContent = EFFECTS[x.i]));
  if (S.light) $('#fx-name').textContent = EFFECTS[S.light.effect] || S.light.effect;
}

let lastFrame = 0;
function animate(now) {
  requestAnimationFrame(animate);
  if ($('#tab-light').hidden || !S.light || now - lastFrame < 33) return;
  lastFrame = now;
  const L = S.light;
  if (!FX.big || FX.big.e !== L.effect) FX.big = new R75FX.Sim(L.effect, LAYOUT);
  R75FX.draw($('#fx-big'), FX.big, reduceMotion.matches ? STILL : now, L, LAYOUT);
  const full = { ...L, brightness: Math.max(L.brightness, 200) }; // tiles stay readable at low brightness
  for (const x of FX.tiles) {
    if (x.seen) R75FX.draw(x.cv, x.sim, x === FX.hover && !reduceMotion.matches ? STILL + now : STILL, full, LAYOUT);
  }
}
requestAnimationFrame(animate);

function setEffect(i) {
  S.light.effect = i;
  sendEffect(i);
  renderLight();
}

function renderLight() {
  const L = S.light;
  $('#l-bright').value = L.brightness;
  $('#l-speed').value = L.speed;
  $('#l-color').value = hsToHex(L.hue, L.sat);
  $('#l-bright-v').textContent = Math.round((L.brightness / 255) * 100) + '%';
  $('#l-speed-v').textContent = Math.round((L.speed / 255) * 100) + '%';
  $('#l-color-v').textContent = hsToHex(L.hue, L.sat).toUpperCase();
  $('#f-speed').classList.toggle('off', L.effect === 0 || L.effect === 45);
  const noColor = EFFECTS_NO_COLOR.has(L.effect);
  $('#f-color .color-row').style.opacity = noColor ? 0.35 : '';
  $('#no-color').hidden = !noColor;
  FX.tiles.forEach((x) => x.btn.classList.toggle('active', x.i === L.effect));
  renderFxNames();
}

$('#l-bright').addEventListener('input', (e) => {
  S.light.brightness = +e.target.value;
  sendBright(S.light.brightness);
  renderLight();
});
$('#l-speed').addEventListener('input', (e) => {
  S.light.speed = +e.target.value;
  sendSpeed(S.light.speed);
  renderLight();
});
function pickColor(hex) {
  [S.light.hue, S.light.sat] = hexToHs(hex);
  sendColor(S.light.hue, S.light.sat);
  renderLight();
}
$('#l-color').addEventListener('input', (e) => pickColor(e.target.value));
['#ff2a1a', '#ff6a1a', '#ffc21a', '#3ddc5a', '#1ad8e0', '#1a5cff', '#8a2bff', '#ff1aa8', '#ffffff'].forEach((c) => {
  const b = el('button', { className: 'swatch', title: c });
  b.style.background = c;
  b.onclick = () => pickColor(c);
  $('#swatches').append(b);
});

// ------------------------------------------------------------------ knob tab
const K = { cfg: null, apps: [] };
const STEPS = [2, 5, 10];
const knobName = () => (K.cfg.target === 'spotify' ? 'Spotify' : K.cfg.app);
const knobOnKeyboard = () => S.enc && S.enc[0][0] === KC.F24 && S.enc[0][1] === KC.F23;

async function refreshApps() {
  if (!host) return;
  try {
    K.apps = await host.audioApps();
  } catch (e) {
    K.apps = [];
    console.error(e);
  }
  renderKnob();
}

function renderKnob() {
  if (!host || !K.cfg) return;
  const c = K.cfg;
  const input = $('#k-app');
  if (document.activeElement !== input) input.value = c.app || '';
  $('#k-apps').replaceChildren(...K.apps.map((a) => el('option', { value: a })));
  $('#k-chips').replaceChildren(...(K.apps.length ? K.apps : []).slice(0, 12).map((a) => {
    const b = el('button', { textContent: a, className: a.toLowerCase() === (input.value || '').toLowerCase() ? 'active' : '' });
    b.onclick = () => { input.value = a; saveKnobApp(); };
    return b;
  }));
  if (!K.apps.length) $('#k-chips').append(el('span', { className: 'hint', textContent: t('knob.none') }));
  $('#k-step').replaceChildren(...STEPS.map((n) => {
    const b = el('button', { textContent: n + '%', className: c.step === n ? 'active' : '' });
    b.onclick = async () => { K.cfg = await host.setKnob({ step: n }); renderKnob(); };
    return b;
  }));
  $('#k-auto').checked = c.enabled ? !!c.autostart : $('#k-auto').checked;
  const isSp = c.target === 'spotify';
  const name = knobName();
  [...$('#k-target').children].forEach((b) => b.classList.toggle('active', b.dataset.t === c.target));
  $('#k-app-box').hidden = isSp;
  $('#k-sp-box').hidden = !isSp;
  $('#k-sp-uri').textContent = c.redirect;
  const idInput = $('#k-sp-id');
  if (document.activeElement !== idInput) idInput.value = c.clientId || '';
  const sps = $('#k-sp-state');
  sps.className = 'k-state' + (c.spotify ? ' on' : '');
  sps.textContent = c.spotify ? t('knob.spOn') : t('knob.spOff');
  $('#k-sp-out').hidden = !c.spotify;
  $('.sp-steps').hidden = c.spotify;
  const st = $('#k-state');
  const active = c.enabled && knobOnKeyboard();
  const broken = c.enabled && S.enc && !knobOnKeyboard();
  st.className = 'k-state' + (active ? ' on' : broken ? ' warn' : '');
  st.textContent = active ? t('knob.stOn', name) : broken ? t('knob.stBroken') : t('knob.stOff');
  $('.dial').classList.toggle('on', active);
  $('.dial').style.setProperty('--rot', active ? '35deg' : '-40deg');
  $('#k-dial-app').textContent = active ? name : 'VOL';
}

// Knob press (Windows layer, matrix 2,13): F22 in Spotify mode (play/pause, next, previous), Mute otherwise.
async function setKnobPress(spotify) {
  if (!S.via) return;
  const cur = S.keymap[0][2][13];
  const want = spotify ? KC.F22 : KC.MUTE;
  if (cur === want || (!spotify && cur !== KC.F22)) return; // leave a custom press key alone
  await S.via.setKey(0, 2, 13, want);
  S.keymap[0][2][13] = want;
  renderBoard();
}

async function saveKnobApp() {
  const name = $('#k-app').value.trim();
  if (name && name !== K.cfg.app) K.cfg = await host.setKnob({ app: name });
  renderKnob();
}

if (host) {
  $('#k-app').addEventListener('change', saveKnobApp);
  $('#k-refresh').onclick = refreshApps;
  $('#k-auto').addEventListener('change', async (e) => {
    if (K.cfg.enabled) K.cfg = await host.setKnob({ autostart: e.target.checked });
  });
  $('#k-target').onclick = async (e) => {
    const target = e.target.dataset.t;
    if (!target || target === K.cfg.target) return;
    try {
      if (K.cfg.enabled) await setKnobPress(target === 'spotify');
      K.cfg = await host.setKnob({ target });
    } catch (e) {
      fail(e);
    }
    renderKnob();
  };
  $('#k-sp-copy').onclick = () => navigator.clipboard.writeText(K.cfg.redirect).then(() => toast(t('knob.spCopied')), fail);
  $('#k-sp-connect').onclick = async () => {
    const id = $('#k-sp-id').value.trim();
    if (!/^[0-9a-f]{32}$/i.test(id)) return toast(t('knob.spBadId'), true);
    const btn = $('#k-sp-connect');
    btn.disabled = true;
    toast(t('knob.spWait'));
    try {
      K.cfg = await host.spotifyLogin(id);
      toast(t('knob.spOn'));
    } catch (e) {
      console.error(e);
      toast(t('knob.spFail', String(e.message).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')), true);
    }
    btn.disabled = false;
    renderKnob();
  };
  $('#k-sp-out').onclick = async () => {
    K.cfg = await host.spotifyLogout();
    renderKnob();
  };
  $('#k-on').onclick = async () => {
    const isSp = K.cfg.target === 'spotify';
    const name = isSp ? K.cfg.app : $('#k-app').value.trim();
    if (!name) return toast(t('knob.errApp'), true);
    if (isSp && !K.cfg.spotify) return toast(t('knob.spNeed'), true);
    if (!S.via) return toast(t('err.noKb'), true);
    try {
      await S.via.setEncoder(0, 0, KC.F24);
      await S.via.setEncoder(0, 1, KC.F23);
      S.enc[0] = [KC.F24, KC.F23];
      await setKnobPress(isSp);
      K.cfg = await host.setKnob({ enabled: true, app: name, autostart: $('#k-auto').checked });
      renderKnob();
      renderEnc();
      toast(t('knob.on', knobName()));
    } catch (e) {
      fail(e);
    }
  };
  $('#k-off').onclick = async () => {
    try {
      if (S.via) {
        await S.via.setEncoder(0, 0, KC.VOLU);
        await S.via.setEncoder(0, 1, KC.VOLD);
        S.enc[0] = [KC.VOLU, KC.VOLD];
        await setKnobPress(false);
      }
      K.cfg = await host.setKnob({ enabled: false, autostart: false });
      renderKnob();
      if (S.via) renderEnc();
      toast(t('knob.off'));
    } catch (e) {
      fail(e);
    }
  };
  host.knob().then((cfg) => { K.cfg = cfg; renderKnob(); });
} else {
  $('#nav-knob').hidden = true;
}

// ------------------------------------------------------------------ macros tab
const layoutPref = () => $('#m-layout').value;
$('#m-layout').value = store.get('r75.layout', navigator.language.startsWith('fr') ? 'azerty' : 'us');
$('#m-layout').addEventListener('change', () => {
  store.set('r75.layout', layoutPref());
  renderMacros();
});

function renderMacros() {
  const list = $('#macro-list');
  list.replaceChildren();
  S.macros.forEach((bytes, i) => {
    const ta = el('textarea', { value: decodeMacro(bytes, layoutPref()), spellcheck: false, placeholder: t('mac.empty'), dir: 'ltr' });
    const card = el('div', { className: 'macro' }, el('header', {}, `M${i}`, el('span')), ta, el('div', { className: 'err-msg' }));
    ta.addEventListener('input', updateMacroUsage);
    list.append(card);
  });
  updateMacroUsage();
}

/** @returns encoded macros, or null when one of them is invalid */
function updateMacroUsage() {
  let total = 0;
  let ok = true;
  const encoded = [...document.querySelectorAll('#macro-list .macro')].map((card) => {
    const ta = card.querySelector('textarea');
    try {
      const bytes = encodeMacro(ta.value, layoutPref());
      card.classList.remove('err');
      card.querySelector('.err-msg').textContent = '';
      card.querySelector('header span').textContent = bytes.length ? t('mac.bytes', bytes.length) : '';
      total += bytes.length + 1;
      return bytes;
    } catch (e) {
      ok = false;
      card.classList.add('err');
      card.querySelector('.err-msg').textContent = e.message;
      return [];
    }
  });
  const size = S.macroInfo ? S.macroInfo.size : 1;
  $('#usage-bar i').style.width = Math.min(100, (total / size) * 100) + '%';
  $('#usage-bar').classList.toggle('over', total > size);
  $('#usage-txt').textContent = t('mac.usage', total, size);
  return ok && total <= size ? encoded : null;
}

$('#macros-save').onclick = async () => {
  const encoded = updateMacroUsage();
  if (!encoded) return toast(t('mac.fix'), true);
  try {
    await S.via.writeMacros(encoded);
    S.macros = encoded;
    toast(t('mac.saved'));
  } catch (e) {
    fail(e);
  }
};

// ------------------------------------------------------------------ profiles & backup
/** Current keyboard configuration, in the export / profile format. */
const snapshot = () => JSON.parse(JSON.stringify({
  app: 'R75 Customiser', format: 1, date: new Date().toISOString(),
  keymap: S.keymap, encoders: S.enc, lighting: S.light, macros: S.macros,
}));

function checkConfig(data) {
  const sameShape = (a, b) => Array.isArray(a) && a.length === b.length && a.every((x, i) => (Array.isArray(b[i]) ? sameShape(x, b[i]) : Number.isInteger(x) && x >= 0 && x <= 0xffff));
  if (!data || data.app !== 'R75 Customiser' || !sameShape(data.keymap, S.keymap) || !sameShape(data.encoders, S.enc)) throw new Error(t('bk.bad'));
}

/** Write a configuration to the keyboard, only what differs. */
async function applyConfig(data) {
  checkConfig(data);
  setStatus('busy', 'st.importing');
  try {
    for (let l = 0; l < S.layers; l++) {
      for (let r = 0; r < S.keymap[l].length; r++) {
        for (let c = 0; c < S.keymap[l][r].length; c++) {
          const code = data.keymap[l][r][c];
          if (code !== S.keymap[l][r][c]) {
            await S.via.setKey(l, r, c, code);
            S.keymap[l][r][c] = code;
          }
        }
      }
      for (const dir of [0, 1]) {
        if (data.encoders[l][dir] !== S.enc[l][dir]) {
          await S.via.setEncoder(l, dir, data.encoders[l][dir]);
          S.enc[l][dir] = data.encoders[l][dir];
        }
      }
    }
    const L = data.lighting;
    const keys = ['brightness', 'effect', 'speed', 'hue', 'sat'];
    if (L && keys.every((k) => Number.isInteger(L[k]) && L[k] >= 0 && L[k] <= 255) && keys.some((k) => L[k] !== S.light[k])) {
      await S.via.setLighting(RGB.EFFECT, L.effect);
      await S.via.setLighting(RGB.BRIGHTNESS, L.brightness);
      await S.via.setLighting(RGB.SPEED, L.speed);
      await S.via.setLighting(RGB.COLOR, L.hue, L.sat);
      await S.via.saveLighting();
      S.light = { ...S.light, ...Object.fromEntries(keys.map((k) => [k, L[k]])) };
    }
    const M = data.macros;
    if (Array.isArray(M) && M.every((m) => Array.isArray(m) && m.every((v) => Number.isInteger(v) && v > 0 && v < 256))
      && JSON.stringify(M.slice(0, S.macroInfo.count)) !== JSON.stringify(S.macros)) {
      await S.via.writeMacros(M.slice(0, S.macroInfo.count));
      S.macros = await S.via.readMacros();
    }
    S.sel = null;
    renderAll();
  } finally {
    if (S.via) setStatus('on', 'st.on', S.dev.productName || 'R75', S.proto);
  }
}

// Profiles live in localStorage (per Windows user, kept across updates of the portable exe).
const PROFILES_KEY = 'r75.profiles';
const loadProfiles = () => {
  try { return JSON.parse(store.get(PROFILES_KEY, '[]')); } catch { return []; }
};
const saveProfiles = (list) => store.set(PROFILES_KEY, JSON.stringify(list));

function renderProfiles() {
  const list = loadProfiles();
  const box = $('#pf-list');
  const fmtDate = (d) => new Date(d).toLocaleString(lang === 'ar' ? 'ar' : lang, { dateStyle: 'medium', timeStyle: 'short' });
  box.replaceChildren(...list.map((p, i) => {
    const name = el('b', { textContent: p.name, dir: 'auto' });
    const fx = EFFECTS[p.data.lighting && p.data.lighting.effect] || '';
    const swatch = el('i', { className: 'pf-sw' });
    if (p.data.lighting) swatch.style.background = hsToHex(p.data.lighting.hue, p.data.lighting.sat);
    const btn = (key, cls, fn) => el('button', { textContent: t(key), className: cls, onclick: fn });
    return el('div', { className: 'pf' },
      swatch,
      el('div', { className: 'pf-main' }, name, el('small', { textContent: `${fx} · ${fmtDate(p.data.date)}` })),
      btn('pf.apply', 'primary', async () => {
        if (!confirm(t('pf.confirmApply', p.name))) return;
        try {
          await applyConfig(p.data);
          store.set('r75.profile', p.name);
          renderProfiles();
          toast(t('pf.applied', p.name));
        } catch (e) { fail(e); }
      }),
      btn('pf.update', '', () => {
        if (!confirm(t('pf.confirmUpdate', p.name))) return;
        list[i] = { name: p.name, data: snapshot() };
        saveProfiles(list);
        renderProfiles();
        toast(t('pf.saved', p.name));
      }),
      btn('pf.delete', 'ghost', () => {
        if (!confirm(t('pf.confirmDelete', p.name))) return;
        list.splice(i, 1);
        saveProfiles(list);
        renderProfiles();
      }));
  }));
  if (!list.length) box.append(el('p', { className: 'hint', textContent: t('pf.empty') }));
  const cur = store.get('r75.profile', '');
  box.querySelectorAll('.pf').forEach((n, i) => n.classList.toggle('current', list[i].name === cur));
}

$('#pf-save').onclick = () => {
  const name = $('#pf-name').value.trim().slice(0, 40);
  if (!name) return toast(t('pf.nameReq'), true);
  const list = loadProfiles();
  const i = list.findIndex((p) => p.name.toLowerCase() === name.toLowerCase());
  if (i >= 0 && !confirm(t('pf.confirmUpdate', list[i].name))) return;
  const entry = { name, data: snapshot() };
  if (i >= 0) list[i] = entry;
  else list.push(entry);
  saveProfiles(list);
  store.set('r75.profile', name);
  $('#pf-name').value = '';
  renderProfiles();
  toast(t('pf.saved', name));
};
$('#pf-name').addEventListener('keydown', (e) => e.key === 'Enter' && $('#pf-save').click());

$('#b-export').onclick = () => {
  const a = el('a', {
    href: URL.createObjectURL(new Blob([JSON.stringify(snapshot())], { type: 'application/json' })),
    download: `r75-config-${new Date().toISOString().slice(0, 10)}.json`,
  });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};

$('#b-import').onclick = () => $('#b-file').click();
$('#b-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    checkConfig(data);
    if (!confirm(t('bk.confirm'))) return;
    await applyConfig(data);
    toast(t('bk.done'));
  } catch (err) {
    fail(err);
  }
});

$('#b-reset').onclick = async () => {
  if (!confirm(t('bk.confirmReset'))) return;
  try {
    await S.via.resetKeymap();
    S.keymap = await S.via.readKeymap(S.layers);
    for (let l = 0; l < S.layers; l++) S.enc[l] = [await S.via.getEncoder(l, 0), await S.via.getEncoder(l, 1)];
    S.sel = null;
    renderAll();
    toast(t('bk.resetDone'));
  } catch (e) {
    fail(e);
  }
};

// ------------------------------------------------------------------ start
const guess = (navigator.language || 'en').slice(0, 2);
setLang(store.get('r75.lang', I18N[guess] ? guess : 'en'));
if (!('hid' in navigator)) showConnect({ key: 'c.nohid' });
else autoConnect();
