/*
 * R75 Customiser: preview of the QMK RGB matrix effects on a canvas.
 * Math follows quantum/rgb_matrix/animations (LED space x 0..224, y 0..64, 8-bit hue/sat/val),
 * reactive effects are fed with simulated key presses.
 */
(function (root) {
  'use strict';

  const TAU = Math.PI * 2;
  const u8 = (v) => ((Math.floor(v) % 256) + 256) % 256; // uint8 wrap-around
  const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);
  const sin8 = (a) => 128 + 127 * Math.sin((u8(a) / 256) * TAU);
  const cos8 = (a) => sin8(a + 64);
  const atan8 = (dy, dx) => u8((Math.atan2(dy, dx) / TAU) * 256);
  const sc8 = (v, s) => (v * s) / 256;
  const rnd = (n) => Math.floor(Math.random() * n);
  const CX = 112;
  const CY = 32;
  // Photosensitivity: previews run slower than the firmware and random flashes are rarer.
  const SLOW = 2.5;

  function hsv(h, s, v) {
    h = u8(h); s = clamp(s) / 255; v = clamp(v);
    const f = (h / 256) * 6;
    const i = Math.floor(f);
    const r = f - i;
    const p = v * (1 - s);
    const q = v * (1 - s * r);
    const t = v * (1 - s * (1 - r));
    return [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i % 6];
  }

  const cache = new WeakMap();
  /** LED points for a layout from via.js: [{x,y,w,px,py,mod,row}] */
  function points(layout) {
    if (!cache.has(layout)) {
      cache.set(layout, layout.map((k) => ({
        k,
        px: ((k.x + k.w / 2) / 16) * 224,
        py: ((k.y + 0.5) / 6.25) * 64,
        mod: k.w > 1 || k.c === 0 || k.r === 0 || k.r === 5 || k.c === 14 || k.knob,
      })));
    }
    return cache.get(layout);
  }

  // Effect index (VIA id_qmk_rgb_matrix_effect) -> kind of simulation
  const REACTIVE_KEY = { 33: 1, 34: 1 };
  const SPLASH = { 35: 0, 36: 1, 37: 0, 38: 1, 39: 0, 40: 1, 41: 0, 42: 1, 43: 0, 44: 1 }; // value = multi

  class Sim {
    constructor(effect, layout) {
      this.e = effect;
      this.p = points(layout);
      this.n = this.p.length;
      this.hits = [];
      this.nextHit = 0;
      this.nextStep = 0;
      this.st = null;
    }

    /** @returns array of [r,g,b] per layout key */
    frame(now, L) {
      const { e, p, n } = this;
      const H = L.hue;
      const S = L.sat;
      const V = L.brightness;
      const spd = L.speed;
      const t4 = u8((now * spd) / 1024 / SLOW); // scale16by8(timer, speed / 4)
      const t8 = u8((now * spd) / 2048 / SLOW); // scale16by8(timer, speed / 8)
      const out = new Array(n);

      if (REACTIVE_KEY[e] || e in SPLASH || e === 31) this.simulateTyping(now, SLOW * (e === 31 ? 160 : SPLASH[e] || REACTIVE_KEY[e] ? 260 : 620));
      const tick = (hit) => ((now - hit.t) * (spd + 1)) / 256 / SLOW;

      if (e === 23 || e === 24 || e === 28 || e === 29 || e === 30 || e === 32) return this.stateful(now, L);

      if (e === 31) {
        // typing heatmap: heat spreads around hits and cools down
        const st = this.st || (this.st = { heat: new Float32Array(n), last: now });
        const cool = (now - st.last) / 25;
        st.last = now;
        for (let i = 0; i < n; i++) st.heat[i] = Math.max(0, st.heat[i] - cool);
        for (const hit of this.hits.filter((x) => !x.used)) {
          hit.used = true;
          for (let i = 0; i < n; i++) {
            const d = Math.hypot(p[i].px - p[hit.i].px, p[i].py - p[hit.i].py);
            if (i === hit.i) st.heat[i] = clamp(st.heat[i] + 48);
            else if (d < 40) st.heat[i] = clamp(st.heat[i] + (40 - d) / 2);
          }
        }
        for (let i = 0; i < n; i++) {
          const v = st.heat[i];
          out[i] = hsv(clamp(170 - v), S, sc8(clamp((clamp(170 + v) - 170) * 3), V));
        }
        return out;
      }

      for (let i = 0; i < n; i++) {
        const { px: x, py: y } = p[i];
        const dx = x - CX;
        const dy = y - CY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        let h = H;
        let s = S;
        let v = V;
        switch (e) {
          case 0: case 45: v = 0; break;
          case 1: break;
          case 2: if (p[i].mod) h = H + spd; break;
          case 3: h = H + sc8(64, spd) * Math.floor(y / 16); break;
          case 4: h = H + Math.floor((sc8(64, spd) * x) / 32); break;
          case 5: v = sc8(Math.abs(sin8(t8) - 128) * 2, V); break;
          case 6: s = sc8(clamp(S - Math.abs(sc8(x, 228) + 28 - t4) * 8), S); break;
          case 7: v = sc8(clamp(V - Math.abs(sc8(x, 228) + 28 - t4) * 8), V); break;
          case 8: s = sc8(u8(S - t4 - atan8(dy, dx) * 3), S); break;
          case 9: v = sc8(u8(V - t4 - atan8(dy, dx) * 3), V); break;
          case 10: s = sc8(u8(S + dist - t4 - atan8(dy, dx)), S); break;
          case 11: v = sc8(u8(V + dist - t4 - atan8(dy, dx)), V); break;
          case 12: h = t4; break;
          case 13: h = x - t4; break;
          case 14: h = y - t4; break;
          case 15: h = H + Math.abs(y - CY) + (x - t4); break;
          case 16: h = (3 * dist) / 2 + t4; break;
          case 17: { const ddx = CX / 2 - Math.abs(dx); h = 3 * Math.sqrt(ddx * ddx + dy * dy) + t4; break; }
          case 18: h = atan8(dy, dx) + t4; break;
          case 19: h = dist - t4 - atan8(dy, dx); break;
          case 20: case 21: case 22: {
            const c = cos8(t4) - 128;
            const sn = sin8(t4) - 128;
            if (e === 20) h = H + (dy * c + dx * sn) / 128;
            else if (e === 21) h = H + (dy * 2 * c + dx * 2 * sn) / 128;
            else h = H + (dy * 3 * c + (56 - Math.abs(dx)) * 3 * sn) / 128;
            break;
          }
          case 25: h = H + sc8(Math.abs(sin8(t8) - 128), 12); break;
          case 26: h = H + sc8(Math.abs(u8(sin8(t4) + x) - 128), 12); break;
          case 27: h = H + sc8(Math.abs(u8(x - t4)), 24); break;
          case 33: case 34: {
            const last = this.lastHitOn(i);
            const off = last ? clamp(tick(last)) : 255;
            if (e === 33) v = sc8(255 - off, V);
            else h = H + clamp(130 - off);
            break;
          }
          default:
            if (e in SPLASH) [h, v] = this.splash(e, i, x, y, H, V, tick);
        }
        out[i] = hsv(h, s, v);
      }
      return out;
    }

    splash(e, i, x, y, H, V, tick) {
      const hits = SPLASH[e] ? this.hits : this.hits.slice(-1);
      let h = H;
      let v = 0;
      for (const hit of hits) {
        const dx = x - this.p[hit.i].px;
        const dy = y - this.p[hit.i].py;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const tk = tick(hit);
        let fx;
        if (e === 35 || e === 36) fx = clamp(tk + dist * 5);
        else if (e === 37 || e === 38) {
          const ax = Math.min(255, Math.abs(dx) * 16);
          const ay = Math.min(255, Math.abs(dy) * 16);
          fx = clamp(tk + dist + Math.min(ax, ay));
        } else {
          fx = tk - dist < 0 ? 255 : clamp(tk - dist);
          if (e === 39 || e === 40) {
            if (dist > 72 || (Math.abs(dx) > 8 && Math.abs(dy) > 8)) fx = 255;
            h = H + dy / 4;
          } else if (e === 41 || e === 42) h += fx;
        }
        v = clamp(v + 255 - fx);
      }
      return [h, sc8(v, V)];
    }

    lastHitOn(i) {
      for (let j = this.hits.length - 1; j >= 0; j--) if (this.hits[j].i === i) return this.hits[j];
      return null;
    }

    simulateTyping(now, every) {
      if (now < this.nextHit) return;
      this.nextHit = now + every * (0.5 + Math.random());
      this.hits.push({ i: rnd(this.n), t: now });
      if (this.hits.length > 12) this.hits.shift();
    }

    /** Effects driven by random per-key state, updated at a speed-dependent rate. */
    stateful(now, L) {
      const { e, p, n } = this;
      const V = L.brightness;
      const H = L.hue;
      if (!this.st) {
        this.st = { c: Array.from({ length: n }, () => [0, 0, 0]), drop: new Float32Array(n), head: new Uint8Array(n) };
        if (e === 23 || e === 24) for (let i = 0; i < n; i++) this.st.c[i] = this.drop(H, L);
        if (e === 32 || e === 30) {
          // columns (digital rain) and rows (fractal) in LED space
          this.st.col = p.map((q) => Math.round(q.px / 14));
          this.st.rows = [0, 1, 2, 3, 4, 5].map((r) => p.map((q, i) => i).filter((i) => p[i].k.y === (r === 0 ? 0 : r + 0.25)).sort((a, b) => p[a].px - p[b].px));
          this.st.on = new Uint8Array(n);
        }
      }
      const st = this.st;
      const interval = Math.max(120, SLOW * ({ 23: 18, 24: 18, 28: 6, 29: 10, 30: 8, 32: 4 }[e] * (256 - L.speed) / 16 + 20));
      while (now >= this.nextStep) {
        this.nextStep = (this.nextStep || now) + interval;
        if (this.nextStep < now - 1000) this.nextStep = now + interval;
        if (e === 23 || e === 24) st.c[rnd(n)] = this.drop(H, L);
        else if (e === 28) st.c[rnd(n)] = Math.random() < 0.5 ? [0, 0, 0] : hsv(rnd(256), 127 + rnd(129), V);
        else if (e === 29) {
          st.c.pop();
          st.c.unshift(Math.random() < 0.5 ? [0, 0, 0] : hsv(rnd(256), 127 + (rnd(256) >> 1), V));
        } else if (e === 30) {
          for (const row of st.rows) {
            const m = row.length >> 1;
            for (let j = 0; j < m; j++) st.on[row[j]] = st.on[row[j + 1]];
            for (let j = row.length - 1; j > m; j--) st.on[row[j]] = st.on[row[j - 1]];
            st.on[row[m]] = Math.random() < 0.5 ? 1 : 0;
          }
        } else if (e === 32) this.rainStep();
      }
      if (e === 30) return st.on.reduce((a, on, i) => { a[i] = on ? hsv(H, L.sat, V) : [0, 0, 0]; return a; }, new Array(n));
      if (e === 32) return Array.from(st.drop, (d, i) => (st.head[i] ? hsv(85, 90, V) : hsv(85, 255, sc8(d, V))));
      return st.c.map((c) => c.slice());
    }

    drop(H, L) {
      if (this.e === 24) return hsv(rnd(256), 127 + rnd(129), L.brightness);
      const delta = ((H + 180) % 360 - H) / 4;
      return hsv(H + delta * rnd(4), L.sat, L.brightness);
    }

    rainStep() {
      const { st, p, n } = this;
      const heads = [];
      for (let i = 0; i < n; i++) {
        st.drop[i] *= 0.78;
        if (st.head[i]) heads.push(i);
        st.head[i] = 0;
      }
      for (const i of heads) {
        st.drop[i] = 255;
        const below = this.p.findIndex((q, j) => st.col[j] === st.col[i] && Math.round(q.py) > Math.round(p[i].py) && Math.round(q.py - p[i].py) < 15);
        if (below >= 0) st.head[below] = 1;
      }
      if (Math.random() < 0.35) {
        const top = p.map((q, i) => i).filter((i) => p[i].k.y === 0);
        st.head[top[rnd(top.length)]] = 1;
      }
    }
  }

  /** Draw one frame of `sim` on `canvas` (sized from its CSS box). */
  function draw(canvas, sim, now, L, layout) {
    const dpr = root.devicePixelRatio || 1;
    const w = Math.round(canvas.clientWidth * dpr);
    const h = Math.round(w * (6.25 / 16));
    if (!w) return;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = canvas.getContext('2d');
    const u = w / 16;
    const gap = Math.max(1, u * 0.08);
    const colors = sim.frame(now, L);
    ctx.clearRect(0, 0, w, h);
    layout.forEach((k, i) => {
      const [r, g, b] = colors[i];
      // dark keycap with the LED colour shining through
      const mix = (c, base) => Math.round(base + c * (1 - base / 255));
      ctx.fillStyle = `rgb(${mix(r, 30)},${mix(g, 29)},${mix(b, 27)})`;
      const x = k.x * u + gap / 2;
      const y = k.y * u + gap / 2;
      const kw = k.w * u - gap;
      const kh = u - gap;
      ctx.beginPath();
      if (k.knob) ctx.arc(x + kw / 2, y + kh / 2, kh / 2, 0, TAU);
      else ctx.roundRect(x, y, kw, kh, u * 0.12);
      ctx.fill();
    });
  }

  const api = { Sim, draw, hsv };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.R75FX = api;
})(this);
