// Small shared helpers: seeded randomness, math, color, noise.
export const TAU = Math.PI * 2;

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let _rng = mulberry32(Date.now() & 0xffffffff);
export function setSeed(s) { _rng = mulberry32(s >>> 0); }
export const rand = () => _rng();
export const rr = (a, b) => a + (b - a) * _rng();
export const ri = (a, b) => Math.floor(rr(a, b + 1)); // inclusive ints
export const chance = (p) => _rng() < p;
export const pick = (arr) => arr[Math.floor(_rng() * arr.length)];
let _spare = null;
export function randn() {
  if (_spare !== null) { const s = _spare; _spare = null; return s; }
  let u = 0, v = 0;
  while (u === 0) u = _rng();
  v = _rng();
  const m = Math.sqrt(-2 * Math.log(u));
  _spare = m * Math.sin(TAU * v);
  return m * Math.cos(TAU * v);
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= TAU;
  while (d < -Math.PI) d += TAU;
  return d;
}

export function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360 / 360;
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t) => {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}
export const hsl = (h, s, l, a = 1) =>
  `hsla(${((h % 360) + 360) % 360},${Math.round(s * 100)}%,${Math.round(l * 100)}%,${a})`;
export const rgb = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

// Value noise with fractal sum, deterministic per seed.
export function makeNoise(seed) {
  const r = mulberry32(seed);
  const N = 256, perm = new Uint16Array(N * 2), vals = new Float32Array(N);
  for (let i = 0; i < N; i++) { perm[i] = i; vals[i] = r(); }
  for (let i = N - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
  for (let i = 0; i < N; i++) perm[i + N] = perm[i];
  const sm = (t) => t * t * (3 - 2 * t);
  const v = (x, y) => vals[perm[(x & 255) + perm[y & 255]]];
  function n2(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const a = v(xi, yi), b = v(xi + 1, yi), c = v(xi, yi + 1), d = v(xi + 1, yi + 1);
    const u = sm(xf), w = sm(yf);
    return lerp(lerp(a, b, u), lerp(c, d, u), w);
  }
  return function fbm(x, y, oct = 5) {
    let s = 0, amp = 0.5, f = 1, tot = 0;
    for (let i = 0; i < oct; i++) { s += amp * n2(x * f, y * f); tot += amp; amp *= 0.5; f *= 2; }
    return s / tot;
  };
}

// Procedural Latin-ish names for species.
const SYL_A = ['vor', 'lu', 'ka', 'ze', 'thi', 'mor', 'ae', 'pyr', 'sil', 'qua', 'bry', 'nox', 'ori', 'cel', 'dra', 'fen', 'gly', 'hel', 'ix', 'jun', 'lym', 'myr', 'nym', 'ost', 'pal', 'rha', 'sto', 'tri', 'umb', 'vel', 'xan', 'zyg'];
const SYL_B = ['pa', 'ri', 'no', 'la', 'te', 'mi', 'do', 'ca', 'phi', 'lo', 'ne', 'ra', 'si', 'ta', 'go', 'be'];
const END_G = ['xis', 'pod', 'morph', 'zoon', 'cyte', 'mys', 'saur', 'phage', 'gnath', 'thrix', 'opsis', 'ella', 'onia', 'ura'];
const END_E = ['us', 'a', 'um', 'is', 'ax', 'ens', 'ii', 'ata', 'ior', 'ix'];
const cap = (s) => s[0].toUpperCase() + s.slice(1);
export function genusName() { return cap(pick(SYL_A) + (chance(0.6) ? pick(SYL_B) : '') + pick(END_G)); }
export function epithetName() { return pick(SYL_A) + pick(SYL_B) + pick(END_E); }
