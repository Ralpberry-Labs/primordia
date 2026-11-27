// Pixel-art renderer: terrain, plants, trees, creatures, light.
import { TAU, clamp, hslToRgb, rgb, hsl, makeNoise } from './util.js';
import { bodyMask } from './genome.js';
import { TERRAIN_RES } from './world.js';

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
  const outline = hslToRgb(g.hue, 0.5, 0.12 + g.armor * 0.1);
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

// ---------- terrain bake ----------
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
    let col = hslToRgb(h, s, clamp(l + dn, 0.05, 0.95));
    // decorations: flowers & tufts
    const r = (Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1;
    const rv = r < 0 ? r + 1 : r;
    if (t === 3 && rv < 0.0018 && f > 0.5) col = rv < 0.0012 ? [244, 211, 94] : rv < 0.0024 ? [244, 151, 182] : [235, 240, 250];
    if ((t === 3 || t === 4) && rv > 0.9) col = hslToRgb(h, s, l - 0.05);
    if (t === 1 && rv > 0.985) col = [200, 235, 240];
    const o = i * 4; id.data[o] = col[0]; id.data[o + 1] = col[1]; id.data[o + 2] = col[2]; id.data[o + 3] = 255;
  }
  c.putImageData(id, 0, 0);
  return cv;
}

export class Renderer {
  constructor(canvas, world) {
    this.cv = canvas; this.ctx = canvas.getContext('2d');
    this.cam = { x: 0, y: 0, zoom: 1 };
    this.plantSprites = makePlantSprites();
    this.meatSprite = makeMeatSprite();
    this.fruitSprites = {};
    this.showGroups = true; this.showVision = true;
    this.setWorld(world);
  }
  setWorld(w) {
    this.world = w;
    this.terrain = bakeTerrain(w);
    this.tv = w.terrainVersion;
    for (const t of w.trees) t.sprite = null;
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

  draw(frame, selected) {
    const w = this.world, ctx = this.ctx, c = this.cam, dpr = this.dpr;
    if (w.terrainVersion !== this.tv) { this.terrain = bakeTerrain(w); this.tv = w.terrainVersion; }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0d1d2b';
    ctx.fillRect(0, 0, this.cv.width, this.cv.height);
    const z = c.zoom * dpr;
    ctx.setTransform(z, 0, 0, z, (this.vw / 2 - c.x * c.zoom) * dpr, (this.vh / 2 - c.y * c.zoom) * dpr);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.terrain, 0, 0, w.tw * TERRAIN_RES, w.th * TERRAIN_RES);
    const vx0 = c.x - this.vw / 2 / c.zoom - 40, vx1 = c.x + this.vw / 2 / c.zoom + 40;
    const vy0 = c.y - this.vh / 2 / c.zoom - 40, vy1 = c.y + this.vh / 2 / c.zoom + 40;
    const inView = (x, y) => x > vx0 && x < vx1 && y > vy0 && y < vy1;

    // water shimmer
    if (c.zoom > 0.6) {
      ctx.fillStyle = 'rgba(220,245,255,0.35)';
      for (let i = 0; i < 60; i++) {
        const x = ((i * 977 + frame * 0.3) % w.W), y = (i * 613 + Math.sin(frame * 0.01 + i) * 20) % w.H;
        if (w.isWater(x, y) && inView(x, y)) ctx.fillRect(x, y, 6, 1.2);
      }
    }
    // food
    const ps = this.plantSprites;
    for (const f of w.food) {
      if (!inView(f.x, f.y)) continue;
      if (f.type === 0) {
        const s = 3.5 + Math.sqrt(f.e) * 1.3;
        ctx.drawImage(ps[f.v], f.x - s / 2, f.y - s / 2, s, s);
      } else if (f.type === 1) {
        let spr = this.fruitSprites[f.hue || 0];
        if (!spr) { const h = f.hue ?? 10; spr = this.fruitSprites[h] = makeFruitSprite(h); }
        ctx.drawImage(spr, f.x - 4, f.y - 4, 8, 8);
      } else {
        const s = 3 + Math.sqrt(f.e) * 0.5;
        ctx.globalAlpha = clamp(f.e / 20, 0.35, 1);
        ctx.drawImage(this.meatSprite, f.x - s / 2, f.y - s / 2, s, s);
        ctx.globalAlpha = 1;
      }
    }
    // trees: shadow + trunk + canopy
    for (const t of w.trees) {
      if (!inView(t.x, t.y)) continue;
      if (!t.sprite) t.sprite = makeTreeSprite(t);
      ctx.fillStyle = 'rgba(10,25,15,0.28)';
      ctx.beginPath(); ctx.ellipse(t.x + 6, t.y + 8, t.r * 1.05, t.r * 0.8, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#5a3d27'; ctx.fillRect(t.x - 2, t.y, 4, t.r * 0.6);
      const S = t.sprite.width * 2;
      ctx.drawImage(t.sprite, t.x - S / 2, t.y - S / 2 - 4, S, S);
    }
    // groups
    if (this.showGroups) {
      ctx.lineWidth = 1.2 / c.zoom;
      ctx.setLineDash([4 / c.zoom, 4 / c.zoom]);
      for (const g of w.groups) {
        if (!inView(g.cx, g.cy)) continue;
        const sp = w.species.get(g.sp);
        ctx.strokeStyle = hsl(sp.hue, 0.7, 0.75, 0.55);
        ctx.fillStyle = hsl(sp.hue, 0.7, 0.6, 0.06);
        ctx.beginPath(); ctx.arc(g.cx, g.cy, g.r, 0, TAU); ctx.fill(); ctx.stroke();
      }
      ctx.setLineDash([]);
    }
    // vision cone of selected
    if (selected && !selected.dead && this.showVision) {
      const s = selected, R = s.g.vision * (0.45 + 0.55 * w.light);
      ctx.fillStyle = 'rgba(255,255,230,0.07)';
      ctx.strokeStyle = 'rgba(255,255,230,0.35)';
      ctx.lineWidth = 1 / c.zoom;
      ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.arc(s.x, s.y, R, s.a - s.g.fov / 2, s.a + s.g.fov / 2); ctx.closePath(); ctx.fill(); ctx.stroke();
      // eye sectors
      for (let e = 1; e < s.g.eyes; e++) {
        const a = s.a - s.g.fov / 2 + (s.g.fov * e) / s.g.eyes;
        ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(s.x + Math.cos(a) * R, s.y + Math.sin(a) * R); ctx.stroke();
      }
    }
    // creatures
    for (const cr of w.creatures) {
      if (!inView(cr.x, cr.y)) continue;
      if (!cr.sprite) cr.sprite = makeCreatureSprite(cr.g);
      const sp = cr.sprite, S = sp.size * cr.g.size / SP;
      const moving = Math.abs(cr.vx) + Math.abs(cr.vy) > 0.15;
      const fr = moving ? ((frame / 8 + cr.id) | 0) % 2 : 0;
      // shadow
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.beginPath(); ctx.ellipse(cr.x + 1.5, cr.y + 2.5, cr.radius * 0.9, cr.radius * 0.6, 0, 0, TAU); ctx.fill();
      ctx.save();
      ctx.translate(cr.x, cr.y); ctx.rotate(cr.a);
      const grow = Math.min(1, 0.55 + cr.age / 500);
      ctx.scale(grow, grow);
      if (cr.pain > 0.5) ctx.globalAlpha = 0.6 + 0.4 * Math.sin(frame);
      ctx.drawImage(sp.frames[fr], -S / 2, -S / 2, S, S);
      ctx.restore();
      ctx.globalAlpha = 1;
    }
    if (selected && !selected.dead) {
      ctx.strokeStyle = '#fff6c8'; ctx.lineWidth = 1.5 / c.zoom;
      ctx.beginPath(); ctx.arc(selected.x, selected.y, selected.radius + 6 + Math.sin(frame * 0.1) * 1.5, 0, TAU); ctx.stroke();
    }
    // particles
    for (const p of w.particles) {
      ctx.fillStyle = hsl(p.hue, 0.8, 0.65, clamp(p.life / 25, 0, 1));
      ctx.fillRect(p.x, p.y, p.s, p.s);
    }
    // night tint + bioluminescent signals
    const dark = 1 - w.light;
    if (dark > 0.02) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = `rgba(14,18,52,${dark * 0.62})`;
      ctx.fillRect(0, 0, this.cv.width, this.cv.height);
      ctx.setTransform(z, 0, 0, z, (this.vw / 2 - c.x * c.zoom) * dpr, (this.vh / 2 - c.y * c.zoom) * dpr);
    }
    ctx.globalCompositeOperation = 'lighter';
    for (const cr of w.creatures) {
      if (cr.signal < 0.08 || !inView(cr.x, cr.y)) continue;
      const a = cr.signal * (0.12 + dark * 0.5);
      const R = cr.radius * (2 + cr.signal * 2);
      const gr = ctx.createRadialGradient(cr.x, cr.y, 0, cr.x, cr.y, R);
      gr.addColorStop(0, hsl(cr.g.hue2, 0.9, 0.65, a));
      gr.addColorStop(1, hsl(cr.g.hue2, 0.9, 0.5, 0));
      ctx.fillStyle = gr;
      ctx.fillRect(cr.x - R, cr.y - R, R * 2, R * 2);
    }
    if (dark > 0.3) {
      // fireflies over fruit trees
      for (const t of w.trees) {
        if (!inView(t.x, t.y)) continue;
        for (let k = 0; k < 3; k++) {
          const ph = frame * 0.02 + t.seed + k * 2.1;
          const fx = t.x + Math.cos(ph) * (t.r + 10), fy = t.y + Math.sin(ph * 1.3) * (t.r + 6);
          ctx.fillStyle = `rgba(255,240,150,${(dark - 0.3) * (0.5 + 0.5 * Math.sin(ph * 5))})`;
          ctx.fillRect(fx, fy, 1.6, 1.6);
        }
      }
    }
    ctx.globalCompositeOperation = 'source-over';
    if (w.flash > 0) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = `rgba(255,220,180,${w.flash * 0.5})`;
      ctx.fillRect(0, 0, this.cv.width, this.cv.height);
      w.flash = Math.max(0, w.flash - 0.04);
    }
  }
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
