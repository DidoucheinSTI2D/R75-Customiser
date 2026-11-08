// Offline self-check: node test/check.js
const assert = require('assert');
const R = require('../src/via.js');

// Layout: 80 keys + knob, unique matrix positions, fits 16u width
assert.strictEqual(R.LAYOUT.length, 81);
assert.strictEqual(new Set(R.LAYOUT.map((k) => `${k.r},${k.c}`)).size, 81);
assert(R.LAYOUT.every((k) => k.x + k.w <= R.LAYOUT_WIDTH && k.r < R.ROWS && k.c < R.COLS));
assert.strictEqual(R.EFFECTS.length, 46);

// Labels (English by default, then French)
const I18N = require('../src/i18n.js');
assert.strictEqual(R.label(0x0029), 'Esc');
assert.strictEqual(R.label(0x0306), 'Ctrl+Shift+C');
assert.strictEqual(R.label(0x7821), 'Fx+');
R.localize(I18N.fr.via);
assert.strictEqual(R.label(0x0029), 'Échap');
assert.strictEqual(R.label(0x0106), 'Ctrl+C');
assert.strictEqual(R.label(0x0306), 'Ctrl+Maj+C');
assert.strictEqual(R.label(0x5221), 'Fn1');
assert.strictEqual(R.label(0x7821), 'Effet+');
assert.strictEqual(R.label(0x7e4a), '0x7E4A');
assert.strictEqual(R.LAYER_NAMES[4], 'Système');
assert.strictEqual(R.G.MEDIA, 'Média & système');
assert(R.describe(0x5221).startsWith('Maintenir : couche 1 (Windows Fn)'));
assert.throws(() => R.encodeMacro('{KC_NOPE}', 'us'), /Touche inconnue/);

// Every language: same UI keys as English, 46 effect names, valid key ids
const ids = new Set(R.KEYS.map((k) => k.id));
for (const [code, L] of Object.entries(I18N)) {
  const missing = Object.keys(I18N.en.ui).filter((k) => !(k in L.ui));
  assert.deepStrictEqual(missing, [], `${code} missing ui keys`);
  if (code === 'en') continue;
  assert.strictEqual(L.via.effects.length, 46, `${code} effects`);
  assert.strictEqual(L.via.layers.length, 5, `${code} layers`);
  for (const id of Object.keys(L.via.keys)) assert(ids.has(id), `${code}: unknown key id ${id}`);
  R.localize(L.via);
  assert(R.KEYS.every((k) => typeof k.label === 'string' && k.label && k.title));
}
R.localize(I18N.fr.via);

// Effect previews: every effect renders 81 valid colours over time
const FX = require('../src/effects.js');
for (let e = 0; e < 46; e++) {
  const sim = new FX.Sim(e, R.LAYOUT);
  for (let tm = 0; tm < 3000; tm += 250) {
    const c = sim.frame(tm, { hue: 20, sat: 255, brightness: 255, speed: 128 });
    assert.strictEqual(c.length, 81, `effect ${e}`);
    assert(c.every((p) => p.length === 3 && p.every((v) => Number.isFinite(v) && v >= 0 && v <= 255.5)), `effect ${e} colours`);
  }
}
const lit = (e) => new FX.Sim(e, R.LAYOUT).frame(500, { hue: 0, sat: 255, brightness: 255, speed: 128 }).some((p) => Math.max(...p) > 1);
assert(!lit(0) && lit(1) && lit(13));

// Macro round trips
const round = (s, layout) => R.decodeMacro(R.encodeMacro(s, layout), layout);
for (const s of ['hello world{KC_ENT}', '{KC_LCTL,KC_C}{250}{KC_LCTL,KC_V}', '{+KC_LSFT}abc{-KC_LSFT}', 'a\nb\tc']) {
  assert.strictEqual(round(s, 'us'), s, s);
}
for (const s of ['Bonjour à tous !', 'mail@exemple.fr\n{KC_LCTL,KC_ENT}', 'ça coûte 12,50 € (ou ~10$)', 'C:\\Users\\moi #1 [ok] {x}'.replace('{x}', '{KC_F5}')]) {
  assert.strictEqual(round(s, 'azerty'), s, s);
}
// AZERTY 'a' is the HID 'Q' key; US text is stored raw
assert.deepStrictEqual(R.encodeMacro('a', 'azerty'), [1, 1, 0x14]);
assert.deepStrictEqual(R.encodeMacro('a', 'us'), [0x61]);
assert.deepStrictEqual(R.encodeMacro('{100}', 'us'), [1, 4, 0x31, 0x30, 0x30, 0x7c]);
assert.throws(() => R.encodeMacro('é', 'us'));
assert.throws(() => R.encodeMacro('{KC_NOPE}', 'us'));
assert.throws(() => R.encodeMacro('oops {', 'us'));

// Protocol against a fake keyboard
(async () => {
  const keymap = new Uint8Array(5 * 6 * 15 * 2);
  keymap[1] = 0x29; // L0 r0c0 = Esc
  const macroBuf = new Uint8Array(2398);
  const fake = async (req) => {
    const r = new Uint8Array(32);
    r.set(req);
    const off = (req[1] << 8) | req[2];
    switch (req[0]) {
      case 0x01: r[2] = 12; break;
      case 0x11: r[1] = 5; break;
      case 0x12: r.set(keymap.subarray(off, off + req[3]), 4); break;
      case 0x05: keymap[((req[1] * 6 + req[2]) * 15 + req[3]) * 2 + 1] = req[5]; break;
      case 0x0c: r[1] = 16; break;
      case 0x0d: r[1] = 0x09; r[2] = 0x5e; break;
      case 0x10: macroBuf.fill(0); break;
      case 0x0e: r.set(macroBuf.subarray(off, off + req[3]), 4); break;
      case 0x0f: macroBuf.set(req.subarray(4, 4 + req[3]), off); break;
      case 0x08: r[3] = 7; break;
    }
    return r;
  };
  const via = new R.Via(fake);
  assert.strictEqual(await via.protocol(), 12);
  let km = await via.readKeymap(await via.layerCount());
  assert.strictEqual(km[0][0][0], 0x29);
  await via.setKey(1, 2, 3, 0x04);
  km = await via.readKeymap(5);
  assert.strictEqual(km[1][2][3], 0x04);
  const long = R.encodeMacro('x'.repeat(40), 'us');
  await via.writeMacros([R.encodeMacro('hi', 'us'), [], long]);
  const macros = await via.readMacros();
  assert.strictEqual(macros.length, 16);
  assert.strictEqual(R.decodeMacro(macros[0], 'us'), 'hi');
  assert.strictEqual(macros[1].length, 0);
  assert.strictEqual(macros[2].length, 40);
  assert.strictEqual((await via.getLighting()).brightness, 7);
  console.log('OK: all checks passed');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
