// Loads the C++ brain (WebAssembly). If WebAssembly is unavailable, falls back
// to a JavaScript port of the exact same math so the world still runs.
import { N_IN, H_MAX, N_OUT, N_MEM, W_LEN, O_IH, O_HH, O_HO, O_BH, O_BO } from './genome.js';

const MAX_SLOTS = 1600;
const TR_LEN = N_IN * H_MAX + H_MAX * N_OUT;
const MEM_IN = N_IN - N_MEM;

export async function createBrain(wasmBytes) {
  try {
    let bytes = wasmBytes;
    if (!bytes) {
      const res = await fetch(new URL('../wasm/brain.wasm', import.meta.url));
      if (!res.ok) throw new Error('no wasm');
      bytes = await res.arrayBuffer();
    }
    const { instance } = await WebAssembly.instantiate(bytes, {});
    const e = instance.exports;
    if (e.w_len() !== W_LEN || e.max_slots() !== MAX_SLOTS) throw new Error('brain layout mismatch');
    const buf = e.memory.buffer;
    const f = (p, n) => new Float32Array(buf, p, n);
    const i = (p, n) => new Int32Array(buf, p, n);
    return new Brain({
      kind: 'C++ / WebAssembly',
      W: f(e.ptr_w(), MAX_SLOTS * W_LEN), TR: f(e.ptr_tr(), MAX_SLOTS * TR_LEN), HS: f(e.ptr_h(), MAX_SLOTS * H_MAX),
      MEM: f(e.ptr_mem(), MAX_SLOTS * N_MEM), IN: f(e.ptr_in(), MAX_SLOTS * N_IN), OUT: f(e.ptr_out(), MAX_SLOTS * N_OUT),
      NH: i(e.ptr_nh(), MAX_SLOTS), ETA: f(e.ptr_eta(), MAX_SLOTS), REWARD: f(e.ptr_reward(), MAX_SLOTS), ACTIVE: i(e.ptr_active(), MAX_SLOTS),
      think: (n) => e.think(n), reset: (s) => e.reset_slot(s),
    });
  } catch (err) {
    return jsBrain();
  }
}

class Brain {
  constructor(o) {
    Object.assign(this, o);
    this.free = [];
    for (let s = MAX_SLOTS - 1; s >= 0; s--) this.free.push(s);
    this.count = 0;
  }
  alloc(g, weights) {
    const s = this.free.pop();
    if (s === undefined) return -1;
    this.W.set(weights || g.w, s * W_LEN);
    this.NH[s] = g.hidden;
    this.ETA[s] = g.plastic * 0.1;
    this.reset(s);
    return s;
  }
  release(s) { if (s >= 0) this.free.push(s); }
  weights(s) { return this.W.subarray(s * W_LEN, (s + 1) * W_LEN); }
  inputs(s) { return this.IN.subarray(s * N_IN, (s + 1) * N_IN); }
  outputs(s) { return this.OUT.subarray(s * N_OUT, (s + 1) * N_OUT); }
  hidden(s) { return this.HS.subarray(s * H_MAX, (s + 1) * H_MAX); }
  memory(s) { return this.MEM.subarray(s * N_MEM, (s + 1) * N_MEM); }
  // how far lifetime learning has moved this brain away from its inborn wiring
  drift(s, g) {
    const w = this.W, o = s * W_LEN; let d = 0, n = 0;
    for (let i = 0; i < W_LEN; i++) { const a = g.w[i]; d += Math.abs(w[o + i] - a); n += Math.abs(a); }
    return n ? d / n : 0;
  }
}

function jsBrain() {
  const W = new Float32Array(MAX_SLOTS * W_LEN), TR = new Float32Array(MAX_SLOTS * TR_LEN), HS = new Float32Array(MAX_SLOTS * H_MAX);
  const MEM = new Float32Array(MAX_SLOTS * N_MEM), IN = new Float32Array(MAX_SLOTS * N_IN), OUT = new Float32Array(MAX_SLOTS * N_OUT);
  const NH = new Int32Array(MAX_SLOTS), ETA = new Float32Array(MAX_SLOTS), REWARD = new Float32Array(MAX_SLOTS), ACTIVE = new Int32Array(MAX_SLOTS);
  const TMP = new Float32Array(H_MAX);
  const ftanh = (x) => (x > 3 ? 1 : x < -3 ? -1 : (x * (27 + x * x)) / (27 + 9 * x * x));
  const cw = (v) => (v > 4 ? 4 : v < -4 ? -4 : v);
  function one(s) {
    const w = s * W_LEN, ii = s * N_IN, hh = s * H_MAX, mm = s * N_MEM, oo = s * N_OUT, nh = NH[s];
    for (let k = 0; k < N_MEM; k++) IN[ii + MEM_IN + k] = MEM[mm + k];
    for (let j = 0; j < nh; j++) {
      let a = W[w + O_BH + j];
      for (let i = 0; i < N_IN; i++) { const v = IN[ii + i]; if (v !== 0) a += v * W[w + O_IH + i * H_MAX + j]; }
      for (let k = 0; k < nh; k++) a += HS[hh + k] * W[w + O_HH + k * H_MAX + j];
      TMP[j] = ftanh(a);
    }
    for (let j = 0; j < nh; j++) HS[hh + j] = TMP[j];
    for (let m = 0; m < N_OUT; m++) {
      let a = W[w + O_BO + m];
      for (let j = 0; j < nh; j++) a += HS[hh + j] * W[w + O_HO + j * N_OUT + m];
      OUT[oo + m] = ftanh(a);
    }
    let ga = (OUT[oo + 11] + 1) * 0.5, gb = (OUT[oo + 12] + 1) * 0.5; ga *= ga; gb *= gb;
    MEM[mm] += ga * (OUT[oo + 7] - MEM[mm]); MEM[mm + 1] += ga * (OUT[oo + 8] - MEM[mm + 1]);
    MEM[mm + 2] += gb * (OUT[oo + 9] - MEM[mm + 2]); MEM[mm + 3] += gb * (OUT[oo + 10] - MEM[mm + 3]);
    const eta = ETA[s]; if (eta <= 0) return;
    const lr = eta * REWARD[s], t = s * TR_LEN;
    for (let i = 0; i < N_IN; i++) {
      const pre = IN[ii + i];
      for (let j = 0; j < nh; j++) {
        const ti = t + i * H_MAX + j, e = TR[ti] * 0.92 + pre * HS[hh + j]; TR[ti] = e;
        if (lr !== 0) { const wi = w + O_IH + i * H_MAX + j; W[wi] = cw(W[wi] + lr * e); }
      }
    }
    const to = t + N_IN * H_MAX;
    for (let j = 0; j < nh; j++) for (let m = 0; m < N_OUT; m++) {
      const idx = j * N_OUT + m, e = TR[to + idx] * 0.92 + HS[hh + j] * OUT[oo + m]; TR[to + idx] = e;
      if (lr !== 0) W[w + O_HO + idx] = cw(W[w + O_HO + idx] + lr * e);
    }
  }
  return new Brain({
    kind: 'JavaScript (fallback)', W, TR, HS, MEM, IN, OUT, NH, ETA, REWARD, ACTIVE,
    think: (n) => { for (let k = 0; k < n; k++) one(ACTIVE[k]); },
    reset: (s) => {
      HS.fill(0, s * H_MAX, (s + 1) * H_MAX); MEM.fill(0, s * N_MEM, (s + 1) * N_MEM); OUT.fill(0, s * N_OUT, (s + 1) * N_OUT);
      TR.fill(0, s * TR_LEN, (s + 1) * TR_LEN); REWARD[s] = 0;
    },
  });
}
