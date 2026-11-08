const { app, BrowserWindow, session, ipcMain, globalShortcut, Tray, Menu, nativeImage, screen, shell, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const { spawn } = require('child_process');

const VENDOR_ID = 0x342d; // Royal Kludge (Hangsheng)
const isRk = (d) => d.vendorId === VENDOR_ID;
const SRC = path.join(__dirname, 'src');
const ICON = path.join(SRC, 'icon.png');
const KEY_UP = 'F24'; // the knob sends these on the Windows layer when "knob -> app volume" is on
const KEY_DOWN = 'F23';
const KEY_PRESS = 'F22'; // knob press in Spotify mode: 1 click play/pause, 2 next, 3 previous
const TRAY_TEXT = {
  en: ['Open', 'Quit'], fr: ['Ouvrir', 'Quitter'], es: ['Abrir', 'Salir'], de: ['Öffnen', 'Beenden'], ar: ['فتح', 'إنهاء'],
};

let win = null;
let tray = null;
let quitting = false;

// ------------------------------------------------------------------ settings
const cfg = { enabled: false, target: 'app', app: 'Spotify', step: 5, lang: 'en', clientId: '' }; // target: 'app' (mixer) | 'spotify' (Web API)
const cfgFile = () => path.join(app.getPath('userData'), 'knob.json');
function loadCfg() {
  try {
    Object.assign(cfg, JSON.parse(fs.readFileSync(cfgFile(), 'utf8')));
  } catch { /* first run */ }
}
function saveCfg() {
  fs.mkdirSync(path.dirname(cfgFile()), { recursive: true });
  fs.writeFileSync(cfgFile(), JSON.stringify(cfg));
}

// Portable build: register the real .exe, not the temporary extraction folder.
const login = () => ({ path: process.env.PORTABLE_EXECUTABLE_FILE || process.execPath, args: ['--hidden'] });
const getAutostart = () => app.isPackaged && app.getLoginItemSettings(login()).openAtLogin;
const setAutostart = (on) => app.isPackaged && app.setLoginItemSettings({ ...login(), openAtLogin: on });

// ------------------------------------------------------------------ audio helper
// One long-running PowerShell process (src/audio.ps1) talking line by line over stdio.
let ps = null;
let waiters = [];
let chain = Promise.resolve();

function startHelper() {
  const script = path.join(app.getPath('userData'), 'audio.ps1');
  fs.mkdirSync(path.dirname(script), { recursive: true });
  fs.writeFileSync(script, fs.readFileSync(path.join(SRC, 'audio.ps1'))); // can't run from inside app.asar
  ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], { windowsHide: true });
  let buf = '';
  ps.stdout.setEncoding('utf8');
  ps.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      const w = waiters.shift();
      if (w) w(line);
    }
  });
  ps.on('exit', () => {
    ps = null;
    waiters.splice(0).forEach((w) => w('ERR audio helper stopped'));
  });
}

function audio(cmd) {
  const run = () => new Promise((resolve, reject) => {
    if (!ps) startHelper();
    const timer = setTimeout(() => {
      if (ps) ps.kill(); // answers would come out of order, restart on next call
      reject(new Error('audio helper timeout'));
    }, 10000);
    waiters.push((line) => {
      clearTimeout(timer);
      if (line.startsWith('ERR')) reject(new Error(line.slice(4)));
      else resolve(line);
    });
    ps.stdin.write(cmd + '\n');
  });
  chain = chain.then(run, run);
  return chain;
}

// ------------------------------------------------------------------ Spotify Web API
// Each user registers their own Spotify app (Development Mode) and pastes its Client ID.
// Authorization Code + PKCE on a fixed loopback port, no client secret.
const SP_PORT = 43875;
const SP_REDIRECT = `http://127.0.0.1:${SP_PORT}/callback`;
const SP_SCOPES = 'user-read-playback-state user-modify-playback-state';
const SP_DONE = {
  en: 'Spotify is connected to R75 Customiser. You can close this tab.',
  fr: 'Spotify est connecté à R75 Customiser. Tu peux fermer cet onglet.',
  es: 'Spotify está conectado a R75 Customiser. Puedes cerrar esta pestaña.',
  de: 'Spotify ist mit R75 Customiser verbunden. Du kannst diesen Tab schließen.',
  ar: 'تم ربط Spotify بـ R75 Customiser. يمكنك إغلاق هذه الصفحة.',
};
const SP_FAIL = 'Spotify login failed. Go back to R75 Customiser and try again.';
const b64url = (b) => b.toString('base64url');
const spFile = () => path.join(app.getPath('userData'), 'spotify.bin');
let sp = null; // { refresh, access, exp }

function spLoad() {
  try {
    sp = JSON.parse(safeStorage.decryptString(fs.readFileSync(spFile())));
  } catch { sp = null; }
}
function spSave() {
  if (!sp) return fs.rmSync(spFile(), { force: true });
  if (!safeStorage.isEncryptionAvailable()) return; // keep the token in memory only
  fs.mkdirSync(path.dirname(spFile()), { recursive: true });
  fs.writeFileSync(spFile(), safeStorage.encryptString(JSON.stringify(sp)));
}

async function spToken(params) {
  const r = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: cfg.clientId, ...params }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (j.error === 'invalid_grant') { sp = null; spSave(); } // revoked: user must reconnect
    throw new Error(j.error_description || j.error || `HTTP ${r.status}`);
  }
  sp = { refresh: j.refresh_token || (sp && sp.refresh), access: j.access_token, exp: Date.now() + (j.expires_in - 60) * 1000 };
  spSave();
}

function spLogin() {
  return new Promise((resolve, reject) => {
    const verifier = b64url(crypto.randomBytes(48));
    const state = b64url(crypto.randomBytes(16));
    let finished = false;
    let timer = null;
    const server = http.createServer((req, res) => {
      const u = new URL(req.url, SP_REDIRECT);
      if (u.pathname !== '/callback') return res.writeHead(404).end();
      const code = u.searchParams.get('code');
      const ok = !!code && u.searchParams.get('state') === state;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', Connection: 'close' })
        .end(`<!doctype html><meta charset="utf-8"><title>R75 Customiser</title><body style="font:16px system-ui;background:#121210;color:#eee;display:grid;place-items:center;height:90vh"><p>${ok ? SP_DONE[cfg.lang] || SP_DONE.en : SP_FAIL}</p>`);
      done(ok ? null : new Error(u.searchParams.get('error') || 'state mismatch'), code);
    });
    async function done(err, code) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      server.close();
      if (err) return reject(err);
      try {
        await spToken({ grant_type: 'authorization_code', code, redirect_uri: SP_REDIRECT, code_verifier: verifier });
        showWin();
        resolve();
      } catch (e) { reject(e); }
    }
    timer = setTimeout(() => done(new Error('timeout')), 180000);
    server.on('error', (e) => done(e));
    server.listen(SP_PORT, '127.0.0.1', () => {
      const q = new URLSearchParams({
        client_id: cfg.clientId, response_type: 'code', redirect_uri: SP_REDIRECT, scope: SP_SCOPES, state,
        code_challenge_method: 'S256', code_challenge: b64url(crypto.createHash('sha256').update(verifier).digest()),
      });
      shell.openExternal(`https://accounts.spotify.com/authorize?${q}`);
    });
  });
}

async function spApi(method, url, retry = true) {
  if (!sp) throw new Error('Spotify not connected');
  if (Date.now() > sp.exp) await spToken({ grant_type: 'refresh_token', refresh_token: sp.refresh });
  const r = await fetch(`https://api.spotify.com/v1${url}`, { method, headers: { Authorization: `Bearer ${sp.access}` } });
  if (r.status === 401 && retry) {
    sp.exp = 0;
    return spApi(method, url, false);
  }
  return r;
}

// Volume is cached between notches; re-read after a pause in case it changed in Spotify.
let spVol = null;
let spVolAt = 0;
async function spotifyVolume(delta) {
  if (spVol === null || Date.now() - spVolAt > 5000) {
    const r = await spApi('GET', '/me/player');
    const j = r.status === 200 ? await r.json() : null;
    if (!j || !j.device || j.device.volume_percent == null) return -1; // nothing playing / no active device
    spVol = j.device.volume_percent;
  }
  const v = Math.max(0, Math.min(100, spVol + delta));
  const r = await spApi('PUT', `/me/player/volume?volume_percent=${v}`);
  if (!r.ok) { spVol = null; return -1; }
  spVol = v;
  spVolAt = Date.now();
  return v;
}

// ------------------------------------------------------------------ on-screen volume
let osdWin = null;
let osdTimer = null;
function osd(name, pct, text = '') {
  const W = 300;
  const H = 58;
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  if (!osdWin || osdWin.isDestroyed()) {
    osdWin = new BrowserWindow({
      width: W, height: H, frame: false, transparent: true, resizable: false, movable: false, focusable: false,
      skipTaskbar: true, alwaysOnTop: true, show: false, webPreferences: { sandbox: true, contextIsolation: true },
    });
    osdWin.setAlwaysOnTop(true, 'screen-saver');
    osdWin.setIgnoreMouseEvents(true);
    osdWin.loadFile(path.join(SRC, 'osd.html'));
  }
  const show = () => {
    osdWin.setBounds({ x: Math.round(area.x + (area.width - W) / 2), y: area.y + area.height - H - 64, width: W, height: H });
    osdWin.webContents.executeJavaScript(`show(${JSON.stringify(name)}, ${pct}, ${JSON.stringify(text)})`).catch(() => {});
    osdWin.showInactive();
    clearTimeout(osdTimer);
    osdTimer = setTimeout(() => osdWin && !osdWin.isDestroyed() && osdWin.hide(), 1400);
  };
  if (osdWin.webContents.isLoading()) osdWin.webContents.once('did-finish-load', show);
  else show();
}

// Fast spins: notches arriving while a change is running are summed into the next one.
let pendingDelta = 0;
let turning = false;
const knobName = () => (cfg.target === 'spotify' ? 'Spotify' : cfg.app);
async function turn(delta) {
  pendingDelta += delta;
  if (turning) return;
  turning = true;
  while (pendingDelta) {
    const d = pendingDelta;
    pendingDelta = 0;
    let pct = -1;
    try {
      pct = cfg.target === 'spotify' ? await spotifyVolume(d) : Number(await audio(`vol\t${cfg.app}\t${d}`));
    } catch (e) {
      console.error(e);
    }
    osd(knobName(), pct);
  }
  turning = false;
}

// Knob press in Spotify mode. Clicks closer than CLICK_GAP ms are counted together.
const CLICK_GAP = 350;
let clicks = 0;
let clickTimer = null;
function knobClick() {
  clicks++;
  clearTimeout(clickTimer);
  const run = () => {
    const n = clicks;
    clicks = 0;
    spotifyAction(n).catch((e) => { console.error(e); osd('Spotify', -1, '?'); });
  };
  if (clicks >= 3) run();
  else clickTimer = setTimeout(run, CLICK_GAP);
}

async function spotifyAction(n) {
  const r = await spApi('GET', '/me/player');
  const j = r.status === 200 ? await r.json() : null;
  if (!j || !j.device) return osd('Spotify', -1, '?'); // nothing playing / no active device
  let res;
  let sym;
  if (n === 1) {
    res = await spApi('PUT', j.is_playing ? '/me/player/pause' : '/me/player/play');
    sym = j.is_playing ? '❚❚' : '▶';
  } else if (n === 2) {
    res = await spApi('POST', '/me/player/next');
    sym = '▶▶|';
  } else if (j.progress_ms > 3000) {
    res = await spApi('PUT', '/me/player/seek?position_ms=0'); // like a CD player: restart the song first
    sym = '|◀';
  } else {
    res = await spApi('POST', '/me/player/previous');
    sym = '|◀◀';
  }
  osd('Spotify', res.ok ? 0 : -1, sym);
}

// ------------------------------------------------------------------ tray + shortcuts
function showWin() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function updateTray() {
  if (!cfg.enabled) {
    if (tray) tray.destroy();
    tray = null;
    return;
  }
  if (!tray) {
    tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 }));
    tray.on('click', showWin);
  }
  const [open, quit] = TRAY_TEXT[cfg.lang] || TRAY_TEXT.en;
  tray.setToolTip(`R75 Customiser · ${knobName()}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: open, click: showWin },
    { type: 'separator' },
    { label: quit, click: () => { quitting = true; app.quit(); } },
  ]));
}

function applyKnob() {
  globalShortcut.unregister(KEY_UP);
  globalShortcut.unregister(KEY_DOWN);
  globalShortcut.unregister(KEY_PRESS);
  if (cfg.enabled && cfg.target === 'spotify') globalShortcut.register(KEY_PRESS, knobClick);
  if (cfg.enabled) {
    globalShortcut.register(KEY_UP, () => turn(cfg.step));
    globalShortcut.register(KEY_DOWN, () => turn(-cfg.step));
    if (cfg.target === 'app') audio('list').catch(() => {}); // warm up PowerShell so the first notch is instant
  }
  updateTray();
}

const knobState = () => ({ ...cfg, autostart: getAutostart(), spotify: !!sp, redirect: SP_REDIRECT });

ipcMain.handle('knob:get', knobState);
ipcMain.handle('knob:set', (_e, patch) => {
  if (typeof patch.app === 'string' && patch.app.trim()) cfg.app = patch.app.replace(/[\t\r\n]/g, '').trim().slice(0, 80);
  if ([1, 2, 5, 10].includes(patch.step)) cfg.step = patch.step;
  if (typeof patch.enabled === 'boolean') cfg.enabled = patch.enabled;
  if (typeof patch.lang === 'string' && TRAY_TEXT[patch.lang]) cfg.lang = patch.lang;
  if (['app', 'spotify'].includes(patch.target)) cfg.target = patch.target;
  if (typeof patch.autostart === 'boolean') setAutostart(patch.autostart);
  saveCfg();
  applyKnob();
  return knobState();
});
ipcMain.handle('audio:list', async () => JSON.parse(await audio('list')));
ipcMain.handle('spotify:login', async (_e, clientId) => {
  if (typeof clientId !== 'string' || !/^[0-9a-f]{32}$/i.test(clientId)) throw new Error('bad client id');
  if (clientId !== cfg.clientId) { sp = null; spSave(); }
  cfg.clientId = clientId;
  saveCfg();
  await spLogin();
  spVol = null;
  return knobState();
});
ipcMain.handle('spotify:logout', () => {
  sp = null;
  spSave();
  return knobState();
});

// ------------------------------------------------------------------ main window
function createWindow() {
  const ses = session.defaultSession;
  ses.on('select-hid-device', (event, details, callback) => {
    event.preventDefault();
    const dev = details.deviceList.find(isRk);
    callback(dev ? dev.deviceId : '');
  });
  ses.setPermissionCheckHandler((_wc, permission) => permission === 'hid');
  ses.setDevicePermissionHandler((d) => d.deviceType === 'hid' && isRk(d.device));

  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: '#121210',
    title: 'R75 Customiser',
    icon: ICON,
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(SRC, 'preload.js') },
  });
  win.loadFile(path.join(SRC, 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://developer.spotify.com/')) shell.openExternal(url);
    return { action: 'deny' };
  });
  // Started by Windows with --hidden: stay in the tray while the knob feature is on.
  if (!(process.argv.includes('--hidden') && cfg.enabled)) win.once('ready-to-show', () => win.show());
  win.on('close', (e) => {
    if (cfg.enabled && !quitting) {
      e.preventDefault();
      win.hide();
    }
  });
  win.on('closed', () => {
    win = null;
    app.quit();
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWin);
  app.whenReady().then(() => {
    loadCfg();
    spLoad();
    createWindow();
    applyKnob();
  });
  app.on('before-quit', () => { quitting = true; });
  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    if (ps) ps.kill();
  });
  app.on('window-all-closed', () => app.quit());
}
