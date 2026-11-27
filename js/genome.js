// Genome: every heritable trait of a creature, plus its neural network weights.
import { rand, rr, ri, randn, chance, clamp } from './util.js';

export const MAX_EYES = 6;
export const CH = 4;                    // per-eye channels: plant, prey/meat, threat, kin
export const N_SENSE = 9;               // energy, health, age, clock, bias, heard, pain, speed, crowd
export const N_IN = MAX_EYES * CH + N_SENSE;
export const H_MAX = 20;
export const N_OUT = 6;                 // thrust, turn, bite, signal, share, breed
export const OUT_NAMES = ['move', 'turn', 'bite', 'signal', 'share', 'breed'];
export const SENSE_NAMES = ['energy', 'health', 'age', 'clock', 'bias', 'heard', 'pain', 'speed', 'crowd'];

// weight layout inside one Float32Array
export const O_IH = 0;
export const O_HH = O_IH + N_IN * H_MAX;
export const O_HO = O_HH + H_MAX * H_MAX;
export const O_BH = O_HO + H_MAX * N_OUT;
export const O_BO = O_BH + H_MAX;
export const W_LEN = O_BO + N_OUT;

// Continuous genes: range + mutation step.
export const GENES = {
  size:     { min: 1.1, max: 3.8, sd: 0.12, label: 'Body size' },
  speed:    { min: 0.4, max: 2.4, sd: 0.10, label: 'Muscle / speed' },
  hue:      { min: 0, max: 360, sd: 10, wrap: true, label: 'Hue' },
  hue2:     { min: 0, max: 360, sd: 14, wrap: true, label: 'Pattern hue' },
  sat:      { min: 0.35, max: 0.95, sd: 0.04, label: 'Saturation' },
  light:    { min: 0.38, max: 0.72, sd: 0.03, label: 'Lightness' },
  fov:      { min: 0.5, max: 5.0, sd: 0.2, label: 'Field of view' },
  vision:   { min: 30, max: 260, sd: 12, label: 'Vision range' },
  diet:     { min: 0, max: 1, sd: 0.05, label: 'Diet (plant→meat)' },
  armor:    { min: 0, max: 1, sd: 0.05, label: 'Armor' },
  repro:    { min: 0.45, max: 0.95, sd: 0.04, label: 'Breeding threshold' },
  litter:   { min: 1, max: 4.4, sd: 0.3, label: 'Litter size' },
  lifespan: { min: 2000, max: 12000, sd: 350, label: 'Lifespan' },
  mutRate:  { min: 0.02, max: 0.45, sd: 0.02, label: 'Mutation rate' },
  plastic:  { min: 0, max: 0.06, sd: 0.004, label: 'Learning (plasticity)' },
};
export const INT_GENES = {
  eyes:   { min: 1, max: MAX_EYES, label: 'Eyes' },
  mouth:  { min: 1, max: 3, label: 'Mouth' },
  hidden: { min: 2, max: H_MAX, label: 'Neurons' },
};
const BODY_BITS = 21; // 7 cols x 3 rows (upper half, mirrored)

let _gid = 1;

export function randomGenome(opts = {}) {
  const g = { id: _gid++ };
  for (const k in GENES) { const d = GENES[k]; g[k] = rr(d.min, d.max); }
  g.size = rr(1.5, 2.6);
  g.speed = rr(0.8, 1.5);
  g.vision = rr(60, 150);
  g.fov = rr(1.2, 3.0);
  g.diet = opts.diet ?? (chance(0.75) ? rr(0, 0.25) : rr(0.6, 0.95));
  g.armor = rr(0, 0.35);
  g.repro = rr(0.55, 0.8);
  g.litter = rr(1, 2.5);
  g.lifespan = rr(4000, 8000);
  g.mutRate = rr(0.06, 0.16);
  g.plastic = rr(0, 0.02);
  g.sat = rr(0.5, 0.9);
  g.light = rr(0.45, 0.65);
  g.eyes = ri(1, 3);
  g.mouth = ri(1, 2);
  g.hidden = ri(3, 7);
  if (g.hidden < 3) g.hidden = 3;
  g.body = new Uint8Array(BODY_BITS);
  for (let i = 0; i < BODY_BITS; i++) g.body[i] = chance(0.45) ? 1 : 0;
  g.pattern = new Uint8Array(BODY_BITS);
  for (let i = 0; i < BODY_BITS; i++) g.pattern[i] = chance(0.3) ? 1 : 0;
  g.w = new Float32Array(W_LEN);
  for (let i = 0; i < W_LEN; i++) g.w[i] = chance(0.3) ? randn() * 0.45 : 0;
  // Founders get faint inborn instincts (steer to food, flee threats) layered over
  // random wiring. Evolution is free to rewire, strengthen or discard them.
  const food = g.diet > 0.5 ? 1 : 0;           // channel: 0 plants, 1 prey/meat
  const H = (i, j) => O_IH + i * H_MAX + j, HO = (j, m) => O_HO + j * N_OUT + m;
  const k = rr(0.6, 1.6);
  for (let e = 0; e < MAX_EYES; e++) {
    const p = g.eyes === 1 ? 0 : (e / (g.eyes - 1)) * 2 - 1;  // -1 left eye … +1 right eye
    g.w[H(e * CH + food, 0)] = p * 2 * k;
    g.w[H(e * CH + food, 1)] = 1.2 * k;
    g.w[H(e * CH + 2, 2)] = 1.5 * k;
    g.w[H(e * CH + 2, 0)] = -p * 1.5 * k;
  }
  g.w[HO(0, 1)] = 1.6; g.w[HO(1, 0)] = 1.0; g.w[HO(2, 0)] = 1.2;
  if (food) g.w[HO(1, 2)] = 1.8;
  g.w[O_BH + 1] = 0; g.w[O_BH + 0] = 0;
  g.w[O_BO + 0] = 0.3 + rand() * 0.4;
  g.w[O_BO + 1] = randn() * 0.15;
  g.w[O_BO + 5] = 0.5;
  return g;
}

function cloneGenome(p) {
  const g = { ...p, id: _gid++ };
  g.body = new Uint8Array(p.body);
  g.pattern = new Uint8Array(p.pattern);
  g.w = new Float32Array(p.w);
  return g;
}

export function crossover(a, b) {
  const g = cloneGenome(a);
  for (const k in GENES) g[k] = chance(0.5) ? a[k] : b[k];
  for (const k in INT_GENES) g[k] = chance(0.5) ? a[k] : b[k];
  for (let i = 0; i < BODY_BITS; i++) { if (chance(0.5)) g.body[i] = b.body[i]; if (chance(0.5)) g.pattern[i] = b.pattern[i]; }
  // swap whole neurons (keeps each neuron's wiring coherent)
  for (let j = 0; j < H_MAX; j++) {
    if (chance(0.5)) continue;
    for (let i = 0; i < N_IN; i++) g.w[O_IH + i * H_MAX + j] = b.w[O_IH + i * H_MAX + j];
    for (let k = 0; k < H_MAX; k++) g.w[O_HH + k * H_MAX + j] = b.w[O_HH + k * H_MAX + j];
    for (let m = 0; m < N_OUT; m++) g.w[O_HO + j * N_OUT + m] = b.w[O_HO + j * N_OUT + m];
    g.w[O_BH + j] = b.w[O_BH + j];
  }
  return g;
}

// Returns a mutated copy. rateMul / amtMul come from world rules.
export function mutate(p, rateMul = 1, amtMul = 1, growBias = 0.5) {
  const g = cloneGenome(p);
  const rate = clamp(p.mutRate * rateMul, 0, 1);
  for (const k in GENES) {
    if (!chance(rate)) continue;
    const d = GENES[k];
    let v = g[k] + randn() * d.sd * amtMul;
    if (d.wrap) v = ((v % 360) + 360) % 360; else v = clamp(v, d.min, d.max);
    g[k] = v;
  }
  for (const k in INT_GENES) {
    if (!chance(rate * (k === 'hidden' ? 0.5 : 0.35))) continue;
    const d = INT_GENES[k];
    const up = k === 'hidden' ? chance(growBias) : chance(0.5);
    const nv = clamp(g[k] + (up ? 1 : -1), d.min, d.max);
    if (k === 'hidden' && nv > g[k]) {
      // a fresh neuron is born with faint connections so it doesn't wreck behaviour
      const j = nv - 1;
      for (let i = 0; i < N_IN; i++) g.w[O_IH + i * H_MAX + j] = chance(0.4) ? randn() * 0.3 : 0;
      for (let m = 0; m < N_OUT; m++) g.w[O_HO + j * N_OUT + m] = chance(0.3) ? randn() * 0.2 : 0;
      for (let k2 = 0; k2 < H_MAX; k2++) { g.w[O_HH + k2 * H_MAX + j] = 0; g.w[O_HH + j * H_MAX + k2] = 0; }
      g.w[O_BH + j] = 0;
    }
    g[k] = nv;
  }
  for (let i = 0; i < BODY_BITS; i++) {
    if (chance(rate * 0.12 * amtMul)) g.body[i] ^= 1;
    if (chance(rate * 0.1 * amtMul)) g.pattern[i] ^= 1;
  }
  // synapses: nudge, prune, or wire new ones
  const wr = rate * 0.25;
  for (let i = 0; i < W_LEN; i++) {
    if (!chance(wr)) continue;
    const r = rand();
    if (r < 0.75) g.w[i] += randn() * 0.35 * amtMul;
    else if (r < 0.88) g.w[i] = 0;
    else g.w[i] = randn() * 0.8;
    g.w[i] = clamp(g.w[i], -4, 4);
  }
  return g;
}

// Genetic distance used to decide when a lineage becomes a new species.
export function distance(a, b) {
  let d = 0;
  for (const k in GENES) {
    if (k === 'lifespan' || k === 'mutRate' || k === 'plastic' || k === 'repro' || k === 'sat' || k === 'light') continue;
    const r = GENES[k];
    let x = Math.abs(a[k] - b[k]);
    if (r.wrap) x = Math.min(x, 360 - x);
    d += (x / (r.max - r.min)) * (k === 'diet' ? 3 : k === 'hue' ? 2 : 1);
  }
  d += Math.abs(a.eyes - b.eyes) * 0.25 + Math.abs(a.mouth - b.mouth) * 0.25 + Math.abs(a.hidden - b.hidden) * 0.06;
  let h = 0;
  for (let i = 0; i < BODY_BITS; i++) h += a.body[i] !== b.body[i] ? 1 : 0;
  d += h * 0.12;
  return d;
}

// Body plan: 7x7 pixel mask facing right (+x), symmetric top/bottom.
export function bodyMask(g) {
  const m = [];
  for (let y = 0; y < 7; y++) m.push(new Uint8Array(7));
  for (let r = 0; r < 3; r++) for (let c = 0; c < 7; c++) {
    const on = g.body[r * 7 + c];
    m[r][c] = on; m[6 - r][c] = on;
  }
  for (let c = 1; c < 6; c++) m[3][c] = 1;           // spine
  m[2][3] = m[4][3] = 1; m[2][4] = m[4][4] = 1;      // torso core
  // remove pixels not connected to the core
  const seen = m.map((row) => new Uint8Array(7));
  const st = [[3, 3]];
  while (st.length) {
    const [y, x] = st.pop();
    if (y < 0 || y > 6 || x < 0 || x > 6 || seen[y][x] || !m[y][x]) continue;
    seen[y][x] = 1; st.push([y + 1, x], [y - 1, x], [y, x + 1], [y, x - 1]);
  }
  for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) m[y][x] = seen[y][x];
  return m;
}

export function brainStats(g) {
  const nh = g.hidden;
  let syn = 0;
  for (let i = 0; i < N_IN; i++) for (let j = 0; j < nh; j++) if (g.w[O_IH + i * H_MAX + j] !== 0) syn++;
  for (let k = 0; k < nh; k++) for (let j = 0; j < nh; j++) if (g.w[O_HH + k * H_MAX + j] !== 0) syn++;
  for (let j = 0; j < nh; j++) for (let m = 0; m < N_OUT; m++) if (g.w[O_HO + j * N_OUT + m] !== 0) syn++;
  // "IQ": a playful complexity score — neurons, wiring, senses and learning.
  const iq = Math.round(nh * 4 + syn * 0.35 + g.eyes * 3 + g.plastic * 400);
  return { neurons: nh, synapses: syn, iq };
}

export function serializeGenome(g) {
  return { ...g, body: Array.from(g.body), pattern: Array.from(g.pattern), w: Array.from(g.w, (x) => Math.round(x * 1000) / 1000) };
}
export function deserializeGenome(o) {
  const g = { ...o, id: _gid++ };
  g.body = Uint8Array.from(o.body); g.pattern = Uint8Array.from(o.pattern); g.w = Float32Array.from(o.w);
  return g;
}
