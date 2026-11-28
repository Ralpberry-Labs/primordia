// Pixel-art renderer: terrain, plants, trees, creatures, light.
import { TAU, clamp, hslToRgb, rgb, hsl, makeNoise } from './util.js?v=6f9903a0547';
import { bodyMask } from './genome.js?v=6f9903a0547';
import { TERRAIN_RES, BS } from './world.js?v=6f9903a0547';
import { WC } from './climate.js?v=6f9903a0547';

const SP = 2; // sprite sub-pixels per body pixel

// ---------- creature sprites ----------
export function makeCreatureSprite(g) {
  const m = bodyMask(g);
  const N = 7, pad = 1, S = (N + pad * 2) * SP;
  const frames = [];
  const base = hslToRgb(g.hue, g.sat, g.light);
  const dark = hslToRgb(g.hue, g.sat * 0.9, g.light * 0.55);
  const lite = hslToRgb(g.hue, g.sat * 0.7, Math.min(0.92, g.light * 1.35));
  const pat = hslToRgb(g.hue2, Math.min(1, g.sat + 0.1), clamp(g.light * 0.85, 0.25, 0.7));
  const outline = g.fur > 0.62 ? hslToRgb(g.hue, 0.2, 0.78) : hslToRgb(g.hue, 0.5, 0.12 + g.armor * 0.1);
  const armorC = hslToRgb(g.hue, 0.15, 0.55 + g.armor * 0.15);
  // eye slots: front-most filled pixels, symmetric
  const slots = [];
  for (let c = 6; c >= 2; c--) {
    if (m[3][c] && c <= 4) slots.push([3, c]);
    for (let r = 2; r >= 0; r--) if (m[r][c] && m[6 - r][c]) { slots.push([r, c, true]); break; }
  }
  const eyes = [];
  let need = g.eyes;
  for (const s of slots) {
    if (need <= 0) break;
    if (s[2]) { if (need >= 2) { eyes.push([s[0], s[1]], [6 - s[0], s[1]]); need -= 2; } }
    else if (need % 2 === 1) { eyes.push([s[0], s[1]]); need -= 1; }
  }
  // leftover odd eye goes on the spine
  if (need > 0) eyes.push([3, 4]);
  const eyeSet = new Set(eyes.map(([r, c]) => r * 7 + c));
  // mouth: front of spine
  let front = 6; while (front > 0 && !m[3][front]) front--;

  for (let f = 0; f < 2; f++) {
    const cv = document.createElement('canvas');
    cv.width = S; cv.height = S;
    const x = cv.getContext('2d');
    const id = x.createImageData(S, S);
    const put = (px, py, c, a = 255) => {
      if (px < 0 || py < 0 || px >= S || py >= S) return;
      const o = (py * S + px) * 4; id.data[o] = c[0]; id.data[o + 1] = c[1]; id.data[o + 2] = c[2]; id.data[o + 3] = a;
    };
    const cell = (r, c, col) => {
      for (let yy = 0; yy < SP; yy++) for (let xx = 0; xx < SP; xx++) put((c + pad) * SP + xx, (r + pad) * SP + yy, col);
    };
    // tail wiggle: shift back column pixels on frame 1
    const mm = m.map((row) => Uint8Array.from(row));
    if (f === 1) {
      for (let c = 0; c < 2; c++) { const top = mm.map((row) => row[c]); for (let r = 0; r < 7; r++) mm[r][c] = top[(r + 6) % 7] && (r !== 0); }
    }
    // outline
    for (let r = -1; r <= 7; r++) for (let c = -1; c <= 7; c++) {
      const on = r >= 0 && r < 7 && c >= 0 && c < 7 && mm[r][c];
      if (on) continue;
      let nb = false;
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const rr2 = r + dr, cc = c + dc; if (rr2 >= 0 && rr2 < 7 && cc >= 0 && cc < 7 && mm[rr2][cc]) nb = true; }
      if (nb) {
        // half-pixel outline for a softer look
        for (let yy = 0; yy < SP; yy++) for (let xx = 0; xx < SP; xx++) {
          const px = (c + pad) * SP + xx, py = (r + pad) * SP + yy;
          let touch = false;
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const qc = Math.floor((px + dx) / SP) - pad, qr = Math.floor((py + dy) / SP) - pad;
            if (qr >= 0 && qr < 7 && qc >= 0 && qc < 7 && mm[qr][qc]) touch = true;
          }
          if (touch) put(px, py, outline, 235);
        }
      }
    }
    for (let r = 0; r < 7; r++) for (let c = 0; c < 7; c++) {
      if (!mm[r][c]) continue;
      let col = base;
      const pi = (r <= 3 ? r : 6 - r) * 7 + c;
      if (g.pattern[pi]) col = pat;
      if (r <= 1 && !g.pattern[pi]) col = lite;      // top light
      if (r >= 5 && !g.pattern[pi]) col = dark;      // belly shade
      if (g.armor > 0.55 && (r === 0 || r === 6 || (r + c) % 3 === 0) && c > 0) col = armorC;
      cell(r, c, col);
    }
    // eyes: white with a pupil looking forward
    for (const [r, c] of eyes) {
      const px = (c + pad) * SP, py = (r + pad) * SP;
      put(px, py, [250, 250, 240]); put(px, py + 1, [250, 250, 240]);
      put(px + 1, py, [20, 20, 30]); put(px + 1, py + 1, [20, 20, 30]);
    }
    // mouth
    const mouthCol = g.diet > 0.55 ? [140, 20, 35] : [120, 60, 70];
    const mx = (front + pad) * SP + 1;
    put(mx, (3 + pad) * SP, mouthCol); put(mx, (3 + pad) * SP + 1, mouthCol);
    if (g.mouth >= 2) { put(mx + 1, (3 + pad) * SP, mouthCol); put(mx + 1, (3 + pad) * SP + 1, mouthCol); }
    if (g.diet > 0.55) { put(mx + 1, (3 + pad) * SP - 1, [255, 255, 245]); put(mx + 1, (3 + pad) * SP + 2, [255, 255, 245]); if (g.mouth === 3) { put(mx + 2, (3 + pad) * SP - 1, [255, 255, 245]); put(mx + 2, (3 + pad) * SP + 2, [255, 255, 245]); } }
    x.putImageData(id, 0, 0);
    frames.push(cv);
  }
  return { frames, size: S };
}

// ---------- static sprites ----------
function px(ctx, x, y, c) { ctx.fillStyle = c; ctx.fillRect(x, y, 1, 1); }
function makePlantSprites() {
  const out = [];
  const pals = [
    ['#2f6b2c', '#4d9a3b', '#86c45a'],
    ['#2c5f3a', '#3f8a4f', '#7cc27a'],
    ['#3b6b25', '#6aa632', '#b5d96a'],
    ['#29604a', '#3e8e6a', '#8fd3a8'],
  ];
  const shapes = [
    ['..2..', '.212.', '21012', '.212.', '..0..'],
    ['.2.2.', '21212', '.101.', '..0..', '.....'],
    ['..2..', '.2.2.', '21212', '.101.', '..0..'],
    ['2...2', '.2.2.', '..1..', '.101.', '..0..'],
  ];
  for (let v = 0; v < 4; v++) {
    const cv = document.createElement('canvas'); cv.width = cv.height = 5;
    const c = cv.getContext('2d');
    const sh = shapes[v], pal = pals[v];
    for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) { const ch = sh[y][x]; if (ch !== '.') px(c, x, y, pal[+ch]); }
    // flowers on some
    if (v === 0) px(c, 2, 0, '#f4d35e');
    if (v === 2) { px(c, 1, 1, '#f497b6'); px(c, 3, 1, '#f497b6'); }
    out.push(cv);
  }
  return out;
}
function makeFruitSprite(hue) {
  const cv = document.createElement('canvas'); cv.width = cv.height = 5;
  const c = cv.getContext('2d');
  const base = hsl(hue, 0.75, 0.52), dk = hsl(hue, 0.7, 0.35), hi = hsl(hue, 0.6, 0.8);
  ['.111.', '11211', '11111', '01110', '.000.'].forEach((row, y) => [...row].forEach((ch, x) => {
    if (ch === '.') return; px(c, x, y, ch === '0' ? dk : ch === '2' ? hi : base);
  }));
  px(c, 2, 0, '#3f7a2a');
  return cv;
}
function makeMeatSprite() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 5;
  const c = cv.getContext('2d');
  ['.11..', '12211', '11110', '.1100', '..0..'].forEach((row, y) => [...row].forEach((ch, x) => {
    if (ch === '.') return; px(c, x, y, ch === '0' ? '#5a1620' : ch === '2' ? '#e8a0a0' : '#a8323e');
  }));
  return cv;
}
function makeTreeSprite(t) {
  const R = Math.round(t.r / 2) + 2, S = R * 2 + 6;
  const cv = document.createElement('canvas'); cv.width = S; cv.height = S;
  const c = cv.getContext('2d');
  const n = makeNoise(t.seed);
  const cx = S / 2, cy = S / 2;
  const cols = [hsl(t.hue, 0.45, 0.16), hsl(t.hue, 0.45, 0.24), hsl(t.hue, 0.5, 0.32), hsl(t.hue, 0.5, 0.42), hsl(t.hue + 10, 0.55, 0.55)];
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = x - cx + 0.5, dy = y - cy + 0.5;
    const d = Math.hypot(dx, dy) / R + (n(x * 0.25, y * 0.25, 3) - 0.5) * 0.55;
    if (d > 1) continue;
    // lighting from top-left
    const l = clamp(0.62 - (dx + dy) / (R * 3.2) + (n(x * 0.5 + 9, y * 0.5, 2) - 0.5) * 0.5 - d * 0.25, 0, 0.999);
    let col = cols[Math.floor(l * cols.length)];
    if (d > 0.88) col = cols[0];
    px(c, x, y, col);
  }
  // blossoms
  for (let i = 0; i < R; i++) {
    const a = n(i, 3) * TAU * 3, rr = n(i, 7) * R * 0.8;
    px(c, Math.round(cx + Math.cos(a) * rr), Math.round(cy + Math.sin(a) * rr), hsl(t.fruitHue, 0.6, 0.72));
  }
  return cv;
}

// ---------- terrain bake (with hill-shading for 3D relief) ----------
function bakeTerrain(world) {
  const { tw, th, ttype, fert, elev } = world;
  const cv = document.createElement('canvas'); cv.width = tw; cv.height = th;
  const c = cv.getContext('2d');
  const id = c.createImageData(tw, th);
  const n = makeNoise(world.seed + 99);
  for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
    const i = y * tw + x, t = ttype[i], e = elev[i], f = fert[i];
    const dn = (n(x * 0.9, y * 0.9, 2) - 0.5) * 0.06 + ((x * 7 + y * 13) % 5 === 0 ? 0.015 : 0);
    let h, s, l;
    if (t === 0) { h = 205; s = 0.48; l = 0.2 + (e / 0.36) * 0.12; }
    else if (t === 1) { h = 190; s = 0.42; l = 0.38 + (e - 0.36) * 2; }
    else if (t === 2) { h = 42; s = 0.42; l = 0.7; }
    else if (t === 3) { h = 95 - f * 10; s = 0.36 + f * 0.1; l = 0.48 - f * 0.08; }
    else if (t === 4) { h = 118; s = 0.36; l = 0.3 - (f - 0.8) * 0.1; }
    else { h = 32; s = 0.14; l = 0.5 + (e - 0.79) * 0.8 + (n(x * 0.3, y * 0.3, 3) - 0.5) * 0.12; }
    // hill-shade: light from the north-west on the land surface
    if (t > 1) {
      const ex = elev[y * tw + Math.min(tw - 1, x + 1)] - elev[y * tw + Math.max(0, x - 1)];
      const ey = elev[Math.min(th - 1, y + 1) * tw + x] - elev[Math.max(0, y - 1) * tw + x];
      l = l - (ex + ey) * 9 + Math.max(0, e - 0.44) * 0.12;
    }
    let col = hslToRgb(h, s, clamp(l + dn, 0.05, 0.95));
    const r = (Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1;
    const rv = r < 0 ? r + 1 : r;
    if (t === 3 && rv < 0.0018 && f > 0.5) col = rv < 0.0012 ? [244, 211, 94] : [244, 151, 182];
    if ((t === 3 || t === 4) && rv > 0.9) col = hslToRgb(h, s, l - 0.05);
    if (t === 1 && rv > 0.985) col = [200, 235, 240];
    const o = i * 4; id.data[o] = col[0]; id.data[o + 1] = col[1]; id.data[o + 2] = col[2]; id.data[o + 3] = 255;
  }
  c.putImageData(id, 0, 0);
  return cv;
}

export const LZ = 6;
// pre-rendered soft glow (gradients per creature per frame are expensive)
const glowCache = new Map();
function glowSprite(hue) {
  const key = Math.round(hue / 20) * 20;
  let cv = glowCache.get(key);
  if (!cv) {
    cv = document.createElement('canvas'); cv.width = cv.height = 64;
    const g = cv.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, hsl(key, 0.9, 0.65, 1)); gr.addColorStop(1, hsl(key, 0.9, 0.5, 0));
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64); glowCache.set(key, cv);
  }
  return cv;
}   // screen units per stacked level (oblique 2.5D projection)

export class Renderer {
  constructor(canvas, world) {
    this.cv = canvas; this.ctx = canvas.getContext('2d');
    this.cam = { x: 0, y: 0, zoom: 1 };
    this.plantSprites = makePlantSprites();
    this.algaeSprite = makeAlgaeSprite();
    this.meatSprite = makeMeatSprite();
    this.fruitSprites = {};
    this.showGroups = true; this.showVision = true; this.showClouds = true;
    this.layer = 'none';
    this.climCv = document.createElement('canvas');
    this.setWorld(world);
  }
  setWorld(w) {
    this.world = w;
    this.terrain = bakeTerrain(w);
    this.tv = w.terrainVersion;
    for (const t of w.trees) t.sprite = null;
    this.climCv.width = w.climate.cw; this.climCv.height = w.climate.ch;
    this.cloudCv = document.createElement('canvas'); this.cloudCv.width = w.climate.cw; this.cloudCv.height = w.climate.ch;
    this.cv2 = -1;
    this._wallPal = new Map();
    this.fit();
  }
  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = this.cv.getBoundingClientRect();
    this.cv.width = Math.round(r.width * dpr); this.cv.height = Math.round(r.height * dpr);
    this.dpr = dpr; this.vw = r.width; this.vh = r.height;
  }
  fit() {
    this.resize();
    const w = this.world;
    const z = Math.max(this.vw / w.W, this.vh / w.H) * 1.15;
    this.cam.zoom = Math.max(z, this.minZoom());
    this.cam.x = w.W / 2; this.cam.y = w.H / 2;
    this.clampCam();
  }
  minZoom() { return Math.min(this.vw / this.world.W, this.vh / this.world.H) * 0.9; }
  clampCam() {
    const w = this.world, c = this.cam;
    c.zoom = clamp(c.zoom, this.minZoom(), 8);
    const hw = this.vw / 2 / c.zoom, hh = this.vh / 2 / c.zoom;
    c.x = hw * 2 > w.W ? w.W / 2 : clamp(c.x, hw, w.W - hw);
    c.y = hh * 2 > w.H ? w.H / 2 : clamp(c.y, hh, w.H - hh);
  }
  toWorld(sx, sy) {
    const c = this.cam;
    return [(sx - this.vw / 2) / c.zoom + c.x, (sy - this.vh / 2) / c.zoom + c.y];
  }
  zoomAt(sx, sy, f) {
    const [wx, wy] = this.toWorld(sx, sy);
    this.cam.zoom = clamp(this.cam.zoom * f, this.minZoom(), 8);
    this.cam.x = wx - (sx - this.vw / 2) / this.cam.zoom;
    this.cam.y = wy - (sy - this.vh / 2) / this.cam.zoom;
    this.clampCam();
  }

  // low-res climate images: clouds, and the optional map layer (moisture/temperature/fire)
  bakeClimate() {
    const w = this.world, cl = w.climate;
    if (this.cv2 === cl.version) return;
    this.cv2 = cl.version;
    const n = cl.cw * cl.ch;
    const cc = this.cloudCv.getContext('2d'), ci = cc.createImageData(cl.cw, cl.ch);
    for (let i = 0; i < n; i++) {
      const v = cl.cloud[i], rain = cl.rain[i];
      const g = 255 - rain * 110;
      ci.data[i * 4] = g; ci.data[i * 4 + 1] = g; ci.data[i * 4 + 2] = g + rain * 20; ci.data[i * 4 + 3] = v * 200;
    }
    cc.putImageData(ci, 0, 0);
    const lc = this.climCv.getContext('2d'), li = lc.createImageData(cl.cw, cl.ch);
    for (let i = 0; i < n; i++) {
      let r = 0, g = 0, b = 0, a = 0;
      if (this.layer === 'moisture') { const m = cl.moist[i]; r = 200 - m * 180; g = 150 + m * 40; b = 60 + m * 190; a = cl.water[i] > 0.6 ? 0 : 150; }
      else if (this.layer === 'temperature') {
        const x = (i % cl.cw) * WC + WC / 2, y = ((i / cl.cw) | 0) * WC + WC / 2;
        const T = cl.temp(x, y), u = clamp((T + 5) / 40, 0, 1);
        r = 40 + u * 215; g = 90 + (1 - Math.abs(u - 0.5) * 2) * 120; b = 255 - u * 215; a = 140;
      } else {
        // default: drought browns the land, ash blackens it
        const m = cl.moist[i];
        if (cl.water[i] < 0.5 && m < 0.35) { r = 190; g = 160; b = 80; a = (0.35 - m) * 300; }
        if (cl.ash[i] > 0.05) { r = 40; g = 32; b = 28; a = Math.max(a, cl.ash[i] * 150); }
      }
      li.data[i * 4] = r; li.data[i * 4 + 1] = g; li.data[i * 4 + 2] = b; li.data[i * 4 + 3] = a;
    }
    lc.putImageData(li, 0, 0);
  }

  draw(frame, selected) {
    const w = this.world, ctx = this.ctx, c = this.cam, dpr = this.dpr, cl = w.climate;
    if (w.terrainVersion !== this.tv) { this.terrain = bakeTerrain(w); this.tv = w.terrainVersion; }
    this.bakeClimate();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0d1d2b';
    ctx.fillRect(0, 0, this.cv.width, this.cv.height);
    const z = c.zoom * dpr;
    this._m = { a: z, b: 0, c: 0, d: z, e: (this.vw / 2 - c.x * c.zoom) * dpr, f: (this.vh / 2 - c.y * c.zoom) * dpr };
    const worldT = () => ctx.setTransform(z, 0, 0, z, (this.vw / 2 - c.x * c.zoom) * dpr, (this.vh / 2 - c.y * c.zoom) * dpr);
    worldT();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.terrain, 0, 0, w.tw * TERRAIN_RES, w.th * TERRAIN_RES);
    // drought / ash / map layer
    ctx.imageSmoothingEnabled = true;
    ctx.globalAlpha = this.layer === 'none' ? 0.55 : 0.85;
    ctx.drawImage(this.climCv, 0, 0, cl.cw * WC, cl.ch * WC);
    ctx.globalAlpha = 1;
    ctx.imageSmoothingEnabled = false;
    const vx0 = c.x - this.vw / 2 / c.zoom - 40, vx1 = c.x + this.vw / 2 / c.zoom + 40;
    const vy0 = c.y - this.vh / 2 / c.zoom - 40, vy1 = c.y + this.vh / 2 / c.zoom + 60;
    const inView = (x, y) => x > vx0 && x < vx1 && y > vy0 && y < vy1;

    if (c.zoom > 0.6) {
      ctx.fillStyle = 'rgba(220,245,255,0.35)';
      for (let i = 0; i < 80; i++) {
        const x = ((i * 977 + frame * 0.3) % w.W), y = (i * 613 + Math.sin(frame * 0.01 + i) * 20) % w.H;
        if (w.isWater(x, y) && inView(x, y)) ctx.fillRect(x, y, 6, 1.2);
      }
    }
    // ground-level food (zoomed out: a cached layer refreshed every few frames)
    const overview = c.zoom < 1.4;
    const ps = this.plantSprites;
    if (overview) {
      if (!this.foodCv || this.foodCv.width !== w.W) { this.foodCv = document.createElement('canvas'); this.foodCv.width = w.W; this.foodCv.height = w.H; this.foodStrip = 0; }
      {
        // refresh one horizontal strip per frame (whole layer every 6 frames) — no big spikes
        const NS = 6, sh = Math.ceil(w.H / NS), k = this.foodStrip = (this.foodStrip + 1) % NS, y0 = k * sh, y1 = y0 + sh;
        const fc = this.foodCv.getContext('2d'); fc.clearRect(0, y0, w.W, sh); fc.imageSmoothingEnabled = false;
        fc.save(); fc.beginPath(); fc.rect(0, y0, w.W, sh); fc.clip();
        for (const f of w.food) {
          if (f.z > 0 || f.y < y0 - 8 || f.y > y1 + 8) continue;
          if (f.type === 0) { const s2 = 3.5 + Math.sqrt(f.e) * 1.3; fc.drawImage(f.aqua ? this.algaeSprite : ps[f.v & 3], f.x - s2 / 2, f.y - s2 / 2, s2, s2); }
          else if (f.type === 1) fc.drawImage(this.fruit(f.hue), f.x - 4, f.y - 4, 8, 8);
          else { const s2 = 3 + Math.sqrt(f.e) * 0.5; fc.drawImage(this.meatSprite, f.x - s2 / 2, f.y - s2 / 2, s2, s2); }
        }
        fc.restore();
      }
      ctx.drawImage(this.foodCv, 0, 0);
    }
    if (!overview) for (const f of w.food) {
      if (f.z > 0 || !inView(f.x, f.y)) continue;
      if (f.type === 0) {
        const s = 3.5 + Math.sqrt(f.e) * 1.3;
        ctx.drawImage(f.aqua ? this.algaeSprite : ps[f.v & 3], f.x - s / 2, f.y - s / 2, s, s);
      } else if (f.type === 1) {
        ctx.drawImage(this.fruit(f.hue), f.x - 4, f.y - 4, 8, 8);
      } else {
        const s = 3 + Math.sqrt(f.e) * 0.5;
        ctx.globalAlpha = clamp(f.e / 20, 0.35, 1);
        ctx.drawImage(this.meatSprite, f.x - s / 2, f.y - s / 2, s, s);
        ctx.globalAlpha = 1;
      }
    }
    // cloud shadows drift across the ground
    if (this.showClouds && w.rules.rainfall > 0) {
      ctx.imageSmoothingEnabled = true;
      ctx.globalAlpha = 0.22 * (0.4 + w.light * 0.6);
      ctx.globalCompositeOperation = 'multiply';
      ctx.drawImage(this.cloudCv, 30, 30, cl.cw * WC, cl.ch * WC);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.imageSmoothingEnabled = false;
    }
    if (this.showGroups) {
      ctx.lineWidth = 1.2 / c.zoom;
      ctx.setLineDash([4 / c.zoom, 4 / c.zoom]);
      for (const g of w.groups) {
        if (!inView(g.cx, g.cy)) continue;
        const sp = w.species.get(g.sp);
        ctx.strokeStyle = hsl(sp.hue, 0.7, 0.75, 0.45);
        ctx.fillStyle = hsl(sp.hue, 0.7, 0.6, 0.05);
        ctx.beginPath(); ctx.arc(g.cx, g.cy, g.r, 0, TAU); ctx.fill(); ctx.stroke();
      }
      ctx.setLineDash([]);
    }
    if (selected && !selected.dead && this.showVision) {
      const s = selected, R = s.g.vision * (0.45 + 0.55 * w.light) * (1 + 0.3 * s.z), sy = s.y - s.z * LZ;
      ctx.fillStyle = 'rgba(255,255,230,0.07)';
      ctx.strokeStyle = 'rgba(255,255,230,0.35)';
      ctx.lineWidth = 1 / c.zoom;
      ctx.beginPath(); ctx.moveTo(s.x, sy); ctx.arc(s.x, sy, R, s.a - s.g.fov / 2, s.a + s.g.fov / 2); ctx.closePath(); ctx.fill(); ctx.stroke();
    }

    // ---- depth-sorted pass: walls, trees and creatures drawn back-to-front by row ----
    const by0 = Math.max(0, (vy0 / BS) | 0), by1 = Math.min(w.bh - 1, (vy1 / BS) | 0);
    const rows = by1 - by0 + 1;
    const buckets = this._buckets || (this._buckets = []);
    for (let r = 0; r < rows; r++) (buckets[r] || (buckets[r] = [])).length = 0;
    const put = (y, o) => { const r = clamp(((y / BS) | 0) - by0, 0, rows - 1); buckets[r].push(o); };
    for (const t of w.trees) if (inView(t.x, t.y)) put(t.y, t);
    for (const cr of w.creatures) if (inView(cr.x, cr.y)) put(cr.y, cr);
    for (const f of w.food) if (f.z > 0 && inView(f.x, f.y)) put(f.y + 1, f);
    const bx0 = Math.max(0, (vx0 / BS) | 0), bx1 = Math.min(w.bw - 1, (vx1 / BS) | 0);
    if (overview && w.blockCount) {
      // zoomed out: walls come from a cached layer, rebuilt when structures change (at most every 30 frames)
      // zoomed out: flat wall tiles (brighter = taller) in a cache, updated cell by cell as walls change
      if (!this.wallCv || this.wallCv.width !== w.W || this.wallWorld !== w) { this.wallCv = document.createElement('canvas'); this.wallCv.width = w.W; this.wallCv.height = w.H; this.wallWorld = w; w.wallsAllDirty = true; }
      const wc = this.wallCv.getContext('2d');
      if (w.wallsAllDirty) {
        w.wallsAllDirty = false; w.dirtyCells.length = 0;
        wc.clearRect(0, 0, w.W, w.H);
        for (let b = 0; b < w.bOwner.length; b++) if (w.bOwner[b]) this.flatTile(wc, b);
      } else if (w.dirtyCells.length) {
        for (const b of w.dirtyCells) { wc.clearRect((b % w.bw) * BS, ((b / w.bw) | 0) * BS, BS, BS); if (w.bOwner[b]) this.flatTile(wc, b); }
        w.dirtyCells.length = 0;
      }
      ctx.drawImage(this.wallCv, 0, 0);
    }
    for (let r = 0; r < rows; r++) {
      const by = by0 + r;
      if (w.blockCount && !overview) this.drawWallRow(ctx, by, bx0, bx1);
      for (const o of buckets[r]) {
        if (o.maxR !== undefined) this.drawTree(ctx, o);
        else if (o.g) this.drawCreature(ctx, o, frame, c.zoom);
        else this.drawCanopyFruit(ctx, o);
      }
    }

    if (selected && !selected.dead) {
      const sy = selected.y - selected.z * LZ;
      ctx.lineWidth = 1 / c.zoom; ctx.setLineDash([3 / c.zoom, 3 / c.zoom]);
      const par = w.byId.get(selected.parent);
      if (par) { ctx.strokeStyle = 'rgba(255,220,150,0.7)'; ctx.beginPath(); ctx.moveTo(selected.x, sy); ctx.lineTo(par.x, par.y - par.z * LZ); ctx.stroke(); }
      ctx.strokeStyle = 'rgba(160,230,200,0.7)';
      for (const k of w.creatures) if (k.parent === selected.id) { ctx.beginPath(); ctx.moveTo(selected.x, sy); ctx.lineTo(k.x, k.y - k.z * LZ); ctx.stroke(); }
      ctx.setLineDash([]);
      if (selected.homeX >= 0) { ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.strokeRect(selected.homeX - BS / 2, selected.homeY - BS / 2, BS, BS); }
      ctx.strokeStyle = '#fff6c8'; ctx.lineWidth = 1.5 / c.zoom;
      ctx.beginPath(); ctx.arc(selected.x, sy, selected.radius + 6 + Math.sin(frame * 0.1) * 1.5, 0, TAU); ctx.stroke();
    }
    for (const p of w.particles) {
      ctx.fillStyle = hsl(p.hue, 0.8, 0.65, clamp(p.life / 25, 0, 1));
      ctx.fillRect(p.x, p.y, p.s, p.s);
    }
    // fire
    if (cl.burning) this.drawFire(ctx, frame, inView);
    // rain
    if (this.showClouds && cl.rainFrac > 0 && c.zoom > 0.35) {
      const wx = Math.cos(cl.windA) * cl.windS * 3;
      ctx.strokeStyle = 'rgba(200,220,255,0.45)'; ctx.lineWidth = 0.8 / Math.max(1, c.zoom * 0.6);
      ctx.beginPath();
      const step = WC;
      for (let y = Math.floor(vy0 / step) * step; y < vy1; y += step) for (let x = Math.floor(vx0 / step) * step; x < vx1; x += step) {
        const rn = cl.rain[cl.cellAt(x, y)]; if (rn <= 0) continue;
        const k = Math.ceil(rn * 5);
        for (let i = 0; i < k; i++) {
          const h1 = (x * 13 + y * 7 + i * 101) % 97, ph = (frame * 7 + h1 * 11) % step;
          const px2 = x + ((h1 * 37) % step), py = y + ph;
          ctx.moveTo(px2, py); ctx.lineTo(px2 + wx, py + 7);
        }
      }
      ctx.stroke();
    }
    // night + lights
    const dark = 1 - w.light;
    if (dark > 0.02) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = `rgba(14,18,52,${dark * 0.62})`;
      ctx.fillRect(0, 0, this.cv.width, this.cv.height);
      worldT();
    }
    ctx.globalCompositeOperation = 'lighter';
    for (const cr of w.creatures) {
      if (cr.signal < 0.08 || !inView(cr.x, cr.y)) continue;
      const a = cr.signal * (0.12 + dark * 0.5);
      const R = cr.radius * (2 + cr.signal * 2), sy = cr.y - cr.z * LZ;
      ctx.globalAlpha = Math.min(1, a);
      ctx.drawImage(glowSprite(cr.g.hue2), cr.x - R, sy - R, R * 2, R * 2);
    }
    if (cl.burning) {
      for (let y = Math.max(0, (vy0 / WC) | 0); y <= Math.min(cl.ch - 1, (vy1 / WC) | 0); y++) for (let x = Math.max(0, (vx0 / WC) | 0); x <= Math.min(cl.cw - 1, (vx1 / WC) | 0); x++) {
        const f = cl.fire[y * cl.cw + x]; if (f <= 0) continue;
        const X = (x + 0.5) * WC, Y = (y + 0.5) * WC, R = WC * (1 + f);
        ctx.globalAlpha = Math.min(1, 0.25 * f + dark * 0.3);
        ctx.drawImage(glowSprite(25), X - R, Y - R, R * 2, R * 2);
      }
    }
    ctx.globalAlpha = 1;
    if (dark > 0.3) {
      for (const t of w.trees) {
        if (!inView(t.x, t.y)) continue;
        for (let k = 0; k < 3; k++) {
          const ph = frame * 0.02 + t.seed + k * 2.1;
          const fx = t.x + Math.cos(ph) * (t.r + 10), fy = t.y - LZ * 2 + Math.sin(ph * 1.3) * (t.r + 6);
          ctx.fillStyle = `rgba(255,240,150,${(dark - 0.3) * (0.5 + 0.5 * Math.sin(ph * 5))})`;
          ctx.fillRect(fx, fy, 1.6, 1.6);
        }
      }
    }
    ctx.globalCompositeOperation = 'source-over';
    // clouds (high above, slight parallax)
    if (this.showClouds && w.rules.rainfall > 0 && c.zoom < 3.5) {
      ctx.imageSmoothingEnabled = true;
      ctx.globalAlpha = 0.5 * (1 - Math.min(1, c.zoom / 3.5)) + 0.05;
      ctx.drawImage(this.cloudCv, 0, -20, cl.cw * WC, cl.ch * WC);
      ctx.globalAlpha = 1;
      ctx.imageSmoothingEnabled = false;
    }
    // lightning
    for (const b of cl.bolts) {
      if (!inView(b.x, b.y)) continue;
      ctx.strokeStyle = `rgba(235,240,255,${b.life / 6})`; ctx.lineWidth = 2 / Math.max(1, c.zoom * 0.5);
      ctx.beginPath(); let x = b.x, y = b.y - 220; ctx.moveTo(x, y);
      let s = b.seed;
      while (y < b.y) { s = (s * 16807) % 2147483647; x += ((s % 100) / 100 - 0.5) * 24; y += 22; ctx.lineTo(x, Math.min(y, b.y)); }
      ctx.stroke();
    }
    if (w.flash > 0) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = `rgba(235,235,255,${w.flash * 0.45})`;
      ctx.fillRect(0, 0, this.cv.width, this.cv.height);
      w.flash = Math.max(0, w.flash - 0.04);
    }
  }

  fruit(hue) {
    const h = hue ?? 10;
    return this.fruitSprites[h] || (this.fruitSprites[h] = makeFruitSprite(h));
  }

  drawTree(ctx, t) {
    if (!t.sprite) t.sprite = makeTreeSprite(t);
    const lift = LZ * 2 * (t.r / t.maxR);
    ctx.fillStyle = 'rgba(10,25,15,0.28)';
    ctx.beginPath(); ctx.ellipse(t.x + 8, t.y + 4, t.r * 1.05, t.r * 0.7, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#5a3d27'; ctx.fillRect(t.x - 2, t.y - lift, 4, lift + 3);
    ctx.fillStyle = '#3e2a1a'; ctx.fillRect(t.x + 1, t.y - lift, 1, lift + 3);
    const S = t.sprite.width * 2;
    ctx.drawImage(t.sprite, t.x - S / 2, t.y - S / 2 - lift - 2, S, S);
  }
  drawCanopyFruit(ctx, f) {
    const spr = this.fruit(f.hue);
    ctx.drawImage(spr, f.x - 4, f.y - f.z * LZ - 4, 8, 8);
    ctx.fillStyle = 'rgba(255,255,220,0.5)'; ctx.fillRect(f.x - 1, f.y - f.z * LZ - 4, 1, 1);
  }
  drawCreature(ctx, cr, frame, zoom) {
    if (!cr.sprite) cr.sprite = makeCreatureSprite(cr.g);
    const sp = cr.sprite, S = sp.size * cr.g.size / SP;
    const moving = Math.abs(cr.vx) + Math.abs(cr.vy) > 0.15;
    const fr = moving ? ((frame / 8 + cr.id) | 0) % 2 : 0;
    const sy = cr.y - cr.z * LZ;
    const fish = cr.g.habitat > 0.6, swim = cr.inWater;
    if (zoom > 1.2) {
      ctx.fillStyle = swim ? 'rgba(10,30,60,0.25)' : 'rgba(0,0,0,0.2)';
      ctx.beginPath(); ctx.ellipse(cr.x + 1.5, sy + 2.5, cr.radius * 0.9, cr.radius * 0.6, 0, 0, TAU); ctx.fill();
    }
    if (swim && zoom > 1) {
      ctx.strokeStyle = 'rgba(220,245,255,0.35)'; ctx.lineWidth = 0.6;
      const rr2 = cr.radius * (1.1 + ((frame + cr.id * 7) % 40) / 40);
      ctx.beginPath(); ctx.ellipse(cr.x, cr.y, rr2, rr2 * 0.6, 0, 0, TAU); ctx.stroke();
    }
    const grow = Math.min(1, 0.55 + cr.age / 500);
    const ca = Math.cos(cr.a) * grow, sa = Math.sin(cr.a) * grow, M = this._m;
    ctx.setTransform(M.a * ca + M.c * sa, M.b * ca + M.d * sa, M.a * -sa + M.c * ca, M.b * -sa + M.d * ca, M.a * cr.x + M.c * sy + M.e, M.b * cr.x + M.d * sy + M.f);
    if (swim) ctx.globalAlpha = fish ? 0.85 : 0.75;
    if (cr.pain > 0.5) ctx.globalAlpha = 0.6 + 0.4 * Math.sin(frame);
    ctx.drawImage(sp.frames[fr], -S / 2, -S / 2, S, S);
    if (cr.carry >= 1 && zoom > 1.2) { ctx.fillStyle = '#b08a5a'; ctx.fillRect(-S * 0.32, -1.2, 2.4, 2.4); ctx.fillStyle = '#e0c49a'; ctx.fillRect(-S * 0.32, -1.2, 2.4, 0.8); }
    ctx.setTransform(M.a, M.b, M.c, M.d, M.e, M.f);
    ctx.globalAlpha = 1;
    if (cr.sick > 0 && zoom > 0.8) { ctx.fillStyle = 'rgba(170,220,60,0.28)'; ctx.beginPath(); ctx.arc(cr.x, sy, cr.radius * 1.1, 0, TAU); ctx.fill(); }
    // voices: little sound arcs (warm = voice 1, cool = voice 2)
    if (zoom > 1.6) {
      const v = Math.abs(cr.v1) > Math.abs(cr.v2) ? cr.v1 : cr.v2;
      if (Math.abs(v) > 0.55) {
        ctx.strokeStyle = Math.abs(cr.v1) > Math.abs(cr.v2) ? 'rgba(255,200,120,0.7)' : 'rgba(150,200,255,0.7)';
        ctx.lineWidth = 0.6;
        const ph = (frame * 0.15 + cr.id) % 1;
        for (let k = 0; k < 2; k++) { const r = cr.radius + 3 + (k + ph) * 4; ctx.beginPath(); ctx.arc(cr.x, sy, r, cr.a - 0.5, cr.a + 0.5); ctx.stroke(); }
      }
    }
  }
  drawFire(ctx, frame, inView) {
    const cl = this.world.climate;
    for (let y = 0; y < cl.ch; y++) for (let x = 0; x < cl.cw; x++) {
      const f = cl.fire[y * cl.cw + x]; if (f <= 0) continue;
      const X = x * WC, Y = y * WC; if (!inView(X + 16, Y + 16)) continue;
      const n = 6 + f * 14;
      for (let i = 0; i < n; i++) {
        const h = (x * 73 + y * 151 + i * 37 + ((frame / 3) | 0) * 13) % 997;
        const px2 = X + (h * 7) % WC, py = Y + (h * 13) % WC;
        const fl = 2 + (h % 5) * f;
        ctx.fillStyle = h % 3 === 0 ? '#ffe08a' : h % 3 === 1 ? '#ff9a3c' : '#e8452c';
        ctx.fillRect(px2, py - fl, 1.6, fl);
      }
      ctx.fillStyle = `rgba(60,55,55,${0.15 * f})`;
      const sx = X + 16 + Math.sin(frame * 0.05 + x) * 6, sy2 = Y - 10 - ((frame * 0.4 + y * 10) % 30);
      ctx.beginPath(); ctx.arc(sx, sy2, 8 + f * 6, 0, TAU); ctx.fill();
    }
  }
  flatTile(wc, b) {
    const w = this.world, o = w.bOwner[b], h = w.bH[b], sp = w.species.get(o);
    const X = (b % w.bw) * BS, Y = ((b / w.bw) | 0) * BS;
    wc.fillStyle = o < 0 ? 'rgba(120,112,100,0.7)' : hsl(sp ? sp.hue : 0, 0.28, 0.34 + h * 0.07);
    wc.fillRect(X, Y, BS, BS);
    wc.fillStyle = 'rgba(0,0,0,0.25)'; wc.fillRect(X, Y + BS - 1, BS, 1);
  }
  // One row of stacked wall columns in oblique projection: front faces, then tops.
  drawWallRow(ctx, by, bx0, bx1) {
    const w = this.world, bw = w.bw, O = w.bOwner, H = w.bH, HP = w.bHp;
    const pal = this._wallPal;
    const colors = (o) => {
      let p = pal.get(o);
      const sp = w.species.get(o), hue = sp ? sp.hue : 0;
      if (!p || p.hue !== hue) {
        p = o < 0 ? { hue, top: '#8f877b', front: '#5f584f', side: '#4a443d', mort: '#6d665c' }
          : { hue, top: hsl(hue, 0.3, 0.6), front: hsl(hue, 0.28, 0.38), side: hsl(hue, 0.3, 0.26), mort: hsl(hue, 0.25, 0.3) };
        pal.set(o, p);
      }
      return p;
    };
    for (let x = bx0; x <= bx1; x++) {
      const b = by * bw + x, o = O[b], h = H[b];
      if (!o || !h) continue;
      const p = colors(o), X = x * BS, Y = by * BS, top = Y - h * LZ;
      ctx.globalAlpha = o < 0 ? 0.6 : 0.65 + Math.min(1, HP[b] / 120) * 0.35;
      // ground shadow cast to the south-east
      ctx.fillStyle = 'rgba(10,20,15,0.25)'; ctx.fillRect(X + 2, Y + BS, BS, Math.min(6, h * 2));
      // front face with a brick course per level
      const below = by + 1 < w.bh ? H[b + bw] : 0;
      if (below < h) {
        ctx.fillStyle = p.front; ctx.fillRect(X, top + BS, BS, h * LZ);
        ctx.fillStyle = p.mort;
        for (let k = 1; k <= h; k++) ctx.fillRect(X, top + BS + k * LZ - 0.8, BS, 0.8);
        ctx.fillRect(X + ((x + by) % 2 ? BS * 0.5 : 0), top + BS, 0.8, LZ);
      }
      // side edges where the neighbour is lower
      ctx.fillStyle = p.side;
      if (x > 0 && H[b - 1] < h) ctx.fillRect(X, top, 1, BS + h * LZ);
      if (x < bw - 1 && H[b + 1] < h) ctx.fillRect(X + BS - 1, top, 1, BS + h * LZ);
      // top face
      ctx.fillStyle = p.top; ctx.fillRect(X, top, BS, BS);
      if (by > 0 && H[b - bw] < h) { ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillRect(X, top, BS, 1.2); }
      if (o > 0 && HP[b] < 50) { ctx.fillStyle = 'rgba(20,15,10,0.6)'; ctx.fillRect(X + 2, top + 3, 3, 0.8); ctx.fillRect(X + 4, top + 3.8, 0.8, 2); }
    }
    ctx.globalAlpha = 1;
  }
}

function makeAlgaeSprite() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 5;
  const c = cv.getContext('2d');
  ['.1.1.', '12121', '.212.', '12121', '.1.1.'].forEach((row, y) => [...row].forEach((ch, x) => {
    if (ch !== '.') px(c, x, y, ch === '1' ? '#3f8f6a' : '#7fd1a0');
  }));
  return cv;
}

// Large portrait of a creature for the inspector / species list.
export function drawPortrait(canvas, g, frame = 0) {
  const spr = makeCreatureSprite(g);
  const c = canvas.getContext('2d');
  c.clearRect(0, 0, canvas.width, canvas.height);
  c.imageSmoothingEnabled = false;
  const s = Math.min(canvas.width, canvas.height);
  c.drawImage(spr.frames[frame % 2], (canvas.width - s) / 2, (canvas.height - s) / 2, s, s);
}
