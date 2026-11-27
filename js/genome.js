// Genome: every heritable trait of a creature, plus its neural network weights.
import { rand, rr, ri, randn, chance, clamp } from './util.js';

export const MAX_EYES = 6;
export const CH = 5;                    // per-eye channels: plant, prey/meat, threat, kin, structure
export const CH_NAMES = ['🌿', 'prey', 'thr', 'kin', 'wall'];
export const N_MEM = 4;                 // gated long-term memory cells (handled in C++)
export const SENSE_NAMES = ['energy', 'health', 'age', 'clock', 'bias', 'glow', 'pain', 'speed', 'crowd',
  'carry', 'shelter', 'home↺', 'home↑', 'home', 'builders', 'family', 'reward',
  'voice1', 'voice2', 'temp', 'water', 'fire', 'surprise', 'height', 'mem1', 'mem2', 'mem3', 'mem4'];
export const N_SENSE = SENSE_NAMES.length;           // 28 (last 4 are memory, filled by the brain)
export const S = Object.fromEntries(SENSE_NAMES.map((n, i) => [n, i]));
export const N_IN = MAX_EYES * CH + N_SENSE;         // 58
export const H_MAX = 32;
export const OUT_NAMES = ['move', 'turn', 'bite', 'glow', 'share', 'breed', 'build', 'voice1', 'voice2',
  'mem1←', 'mem2←', 'mem3←', 'mem4←', 'gate A', 'gate B', 'value'];
export const N_OUT = OUT_NAMES.length;               // 16
export const OUT = { move: 0, turn: 1, bite: 2, signal: 3, share: 4, breed: 5, build: 6, voice1: 7, voice2: 8, mem: 9, gateA: 13, gateB: 14, value: 15 };

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
  curiosity:{ min: 0, max: 1, sd: 0.05, label: 'Curiosity' },
  fur:      { min: 0, max: 1, sd: 0.05, label: 'Fur (cold tolerance)' },
  habitat:  { min: 0, max: 1, sd: 0.04, label: 'Habitat (land→water)' },
  pref:     { min: 0, max: 360, sd: 12, wrap: true, label: 'Mate colour preference' },
  choosy:   { min: 0, max: 0.9, sd: 0.04, label: 'Choosiness' },
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
  g.plastic = rr(0.004, 0.03);
  g.curiosity = rr(0, 0.3);
  g.fur = opts.fur ?? rr(0.1, 0.5);
  g.habitat = opts.habitat ?? rr(0, 0.12);
  g.choosy = rr(0, 0.25);
  if (opts.hue !== undefined) g.hue = opts.hue;
  g.pref = (g.hue + randn() * 10 + 360) % 360;
  if (g.habitat > 0.6) { g.speed = rr(1, 1.6); g.size = rr(1.3, 2.2); }
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
  // faint, random building / homing urges — whether they pay off is up to evolution
  const B = MAX_EYES * CH;
  if (chance(0.6)) {
    g.w[H(B + S.carry, 3)] = rr(0.5, 2);
    g.w[H(B + S.shelter, 3)] = -rr(0, 1.5);
    g.w[H(B + S.builders, 3)] = rr(0, 1.5);
    g.w[HO(3, OUT.build)] = rr(0.6, 1.8);
  }
  g.w[O_BO + OUT.build] = rr(-0.8, 0.2);
  if (chance(0.5)) { g.w[H(B + S['home↺'], 4)] = rr(0.5, 1.5); g.w[HO(4, OUT.turn)] = rr(0.3, 1.2); }
  if (g.hidden < 5) g.hidden = 5;
  return encode(g);
}

// ---------------------------------------------------------------------------
// DNA. Every creature is diploid: two chromosomes (A from one parent, B from the
// other). Each continuous trait is polygenic: LOCI genes per chromosome, each
// carrying an allele value. The trait you see is the average of all its alleles
// (additive quantitative genetics), so offspring vary smoothly, like height in
// humans. Body-shape genes are Mendelian: a body pixel shows if either copy has it
// (dominant); a pattern pixel shows only if both copies carry it (recessive), so
// hidden patterns can skip generations and reappear.
// Reproduction is meiosis: crossing-over shuffles each parent's two chromosomes
// into one gamete, copying errors (point mutations, rarely a big jump) creep in,
// and the child gets one gamete from each parent.
// ---------------------------------------------------------------------------
export const LOCI = 3;
export const TRAITS = [...Object.keys(GENES), 'eyes', 'mouth'];
const TRANGE = TRAITS.map((k) => GENES[k] || INT_GENES[k]);
const NLOCI = TRAITS.length * LOCI;

function traitNorm(k, v) {
  const d = GENES[k] || INT_GENES[k];
  if (INT_GENES[k]) return clamp((v - d.min + 0.5) / (d.max - d.min + 1), 0, 0.999);
  const n = (v - d.min) / (d.max - d.min);
  return d.wrap ? ((n % 1) + 1) % 1 : clamp(n, 0, 1);
}
// Write alleles that express (roughly) the phenotype already set on g.
export function encode(g, spread = 0.04) {
  const A = new Float32Array(NLOCI), B = new Float32Array(NLOCI);
  TRAITS.forEach((k, t) => {
    const v = traitNorm(k, g[k]), wrap = TRANGE[t].wrap;
    for (let l = 0; l < LOCI; l++) {
      let a = v + randn() * spread, b = v + randn() * spread;
      if (wrap) { a = ((a % 1) + 1) % 1; b = ((b % 1) + 1) % 1; } else { a = clamp(a, 0, 1); b = clamp(b, 0, 1); }
      A[t * LOCI + l] = a; B[t * LOCI + l] = b;
    }
  });
  const patB = Uint8Array.from(g.pattern, (x) => (chance(0.2) ? x ^ 1 : x));
  g.dna = { A, B, bodyA: Uint8Array.from(g.body), bodyB: Uint8Array.from(g.body, (x) => (x && chance(0.15) ? 0 : x)), patA: Uint8Array.from(g.pattern), patB };
  express(g);
  return g;
}
// Genotype -> phenotype.
export function express(g) {
  const { A, B } = g.dna;
  TRAITS.forEach((k, t) => {
    const d = TRANGE[t];
    let v;
    if (d.wrap) { // circular mean of angles
      let sx = 0, sy = 0;
      for (let l = 0; l < LOCI; l++) for (const al of [A[t * LOCI + l], B[t * LOCI + l]]) { sx += Math.cos(al * 6.2832); sy += Math.sin(al * 6.2832); }
      v = ((Math.atan2(sy, sx) / 6.2832) + 1) % 1;
      g[k] = d.min + v * (d.max - d.min);
    } else {
      v = 0; for (let l = 0; l < LOCI; l++) v += A[t * LOCI + l] + B[t * LOCI + l];
      v /= LOCI * 2;
      if (INT_GENES[k]) g[k] = clamp(d.min + Math.floor(v * (d.max - d.min + 1)), d.min, d.max);
      else g[k] = d.min + v * (d.max - d.min);
    }
  });
  const { bodyA, bodyB, patA, patB } = g.dna;
  g.body = new Uint8Array(BODY_BITS); g.pattern = new Uint8Array(BODY_BITS);
  for (let i = 0; i < BODY_BITS; i++) { g.body[i] = bodyA[i] | bodyB[i]; g.pattern[i] = patA[i] & patB[i]; }
}
// Meiosis: one gamete from a diploid parent, with crossing-over and copy errors.
function gamete(dna, rate, amt) {
  const out = new Float32Array(NLOCI);
  let src = chance(0.5) ? dna.A : dna.B;
  const xo = 1.6 / NLOCI;                       // ~1-2 crossovers per chromosome
  for (let i = 0; i < NLOCI; i++) { if (chance(xo)) src = src === dna.A ? dna.B : dna.A; out[i] = src[i]; }
  mutateLoci(out, rate, amt);
  const bits = (a, b, flip) => { const o = new Uint8Array(BODY_BITS); let s2 = chance(0.5); for (let i = 0; i < BODY_BITS; i++) { if (chance(0.15)) s2 = !s2; o[i] = (s2 ? a : b)[i]; if (chance(flip)) o[i] ^= 1; } return o; };
  return { chrom: out, body: bits(dna.bodyA, dna.bodyB, rate * 0.06 * amt), pat: bits(dna.patA, dna.patB, rate * 0.06 * amt) };
}
function mutateLoci(arr, rate, amt) {
  const p = rate * 0.35;
  for (let i = 0; i < NLOCI; i++) {
    if (!chance(p)) continue;
    const t = (i / LOCI) | 0, d = TRANGE[t];
    const sd = (d.sd ? d.sd / (d.max - d.min) : 0.12) * amt * 1.6;
    let v = chance(0.02) ? rand() : arr[i] + randn() * sd;   // rare large-effect mutation
    arr[i] = d.wrap ? ((v % 1) + 1) % 1 : clamp(v, 0, 1);
  }
}

export function reproduce(p1, p2, rateMul = 1, amtMul = 1, growBias = 0.5) {
  const rate = clamp(p1.mutRate * rateMul, 0, 1), amt = amtMul;
  const g = { id: _gid++ };
  if (p2) {
    const a = gamete(p1.dna, rate, amt), b = gamete(p2.dna, rate, amt);
    g.dna = { A: a.chrom, B: b.chrom, bodyA: a.body, bodyB: b.body, patA: a.pat, patB: b.pat };
  } else {
    // asexual: clone both chromosomes, with copy errors
    const A = Float32Array.from(p1.dna.A), B = Float32Array.from(p1.dna.B);
    mutateLoci(A, rate, amt); mutateLoci(B, rate, amt);
    const flip = (x) => Uint8Array.from(x, (v) => (chance(rate * 0.06 * amt) ? v ^ 1 : v));
    g.dna = { A, B, bodyA: flip(p1.dna.bodyA), bodyB: flip(p1.dna.bodyB), patA: flip(p1.dna.patA), patB: flip(p1.dna.patB) };
  }
  express(g);
  // neural genes: neuron-wise crossover keeps each neuron's wiring coherent
  g.w = new Float32Array(p1.w);
  g.hidden = p1.hidden;
  if (p2) {
    g.hidden = chance(0.5) ? p1.hidden : p2.hidden;
    for (let j = 0; j < H_MAX; j++) {
      if (chance(0.5)) continue;
      for (let i = 0; i < N_IN; i++) g.w[O_IH + i * H_MAX + j] = p2.w[O_IH + i * H_MAX + j];
      for (let k = 0; k < H_MAX; k++) g.w[O_HH + k * H_MAX + j] = p2.w[O_HH + k * H_MAX + j];
      for (let m = 0; m < N_OUT; m++) g.w[O_HO + j * N_OUT + m] = p2.w[O_HO + j * N_OUT + m];
      g.w[O_BH + j] = p2.w[O_BH + j];
    }
  }
  // neuron number: gene duplication adds a copy of an existing neuron (splitting its
  // output so behaviour is unchanged at first); deletion drops the last one
  if (chance(rate * 0.5)) {
    if (chance(growBias) && g.hidden < H_MAX) {
      const j = g.hidden, s = (rand() * g.hidden) | 0;
      for (let i = 0; i < N_IN; i++) g.w[O_IH + i * H_MAX + j] = g.w[O_IH + i * H_MAX + s] + randn() * 0.05;
      for (let k = 0; k < H_MAX; k++) { g.w[O_HH + k * H_MAX + j] = g.w[O_HH + k * H_MAX + s]; g.w[O_HH + j * H_MAX + k] = 0; }
      for (let m = 0; m < N_OUT; m++) { const o = g.w[O_HO + s * N_OUT + m] * 0.5; g.w[O_HO + s * N_OUT + m] = o; g.w[O_HO + j * N_OUT + m] = o; }
      g.w[O_BH + j] = g.w[O_BH + s];
      g.hidden++;
    } else if (g.hidden > INT_GENES.hidden.min) g.hidden--;
  }
  // synapses: nudge, prune, or wire new ones
  const wr = rate * 0.25;
  for (let i = 0; i < W_LEN; i++) {
    if (!chance(wr)) continue;
    const r = rand();
    if (r < 0.75) g.w[i] += randn() * 0.35 * amt;
    else if (r < 0.88) g.w[i] = 0;
    else g.w[i] = randn() * 0.8;
    g.w[i] = clamp(g.w[i], -4, 4);
  }
  return g;
}
// compatibility helpers
export function mutate(p, rateMul = 1, amtMul = 1, growBias = 0.5) { return reproduce(p, null, rateMul, amtMul, growBias); }
// heterozygosity: how mixed the two chromosomes are (0 = inbred, 1 = very mixed)
export function heterozygosity(g) {
  const { A, B } = g.dna; let d = 0;
  for (let i = 0; i < NLOCI; i++) d += Math.abs(A[i] - B[i]);
  return Math.min(1, (d / NLOCI) * 8);
}

// Genetic distance used to decide when a lineage becomes a new species.
export function distance(a, b) {
  let d = 0;
  for (const k in GENES) {
    if (k === 'lifespan' || k === 'mutRate' || k === 'plastic' || k === 'repro' || k === 'sat' || k === 'light' || k === 'curiosity' || k === 'choosy') continue;
    const r = GENES[k];
    let x = Math.abs(a[k] - b[k]);
    if (r.wrap) x = Math.min(x, 360 - x);
    d += (x / (r.max - r.min)) * (k === 'diet' || k === 'habitat' ? 3 : k === 'hue' ? 2 : 1);
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
  if (g.habitat > 0.6) { for (let r = 1; r <= 5; r++) m[r][0] = 1; m[2][1] = m[4][1] = 1; m[1][3] = m[5][3] = 1; } // fish: tail fan + dorsal fin
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
  const iq = Math.round(nh * 4 + syn * 0.3 + g.eyes * 3 + g.plastic * 400);
  return { neurons: nh, synapses: syn, iq };
}

export function serializeGenome(g) {
  const d = g.dna;
  return { ...g, body: Array.from(g.body), pattern: Array.from(g.pattern), w: Array.from(g.w, (x) => Math.round(x * 1000) / 1000),
    dna: { A: Array.from(d.A), B: Array.from(d.B), bodyA: Array.from(d.bodyA), bodyB: Array.from(d.bodyB), patA: Array.from(d.patA), patB: Array.from(d.patB) } };
}
export function deserializeGenome(o) {
  const g = { ...o, id: _gid++ };
  g.w = Float32Array.from(o.w);
  if (o.dna) {
    g.dna = { A: Float32Array.from(o.dna.A), B: Float32Array.from(o.dna.B), bodyA: Uint8Array.from(o.dna.bodyA), bodyB: Uint8Array.from(o.dna.bodyB), patA: Uint8Array.from(o.dna.patA), patB: Uint8Array.from(o.dna.patB) };
    express(g);
  } else { g.body = Uint8Array.from(o.body); g.pattern = Uint8Array.from(o.pattern); encode(g); }
  return g;
}
