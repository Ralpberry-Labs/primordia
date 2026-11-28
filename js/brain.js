// Loads the C++ brain (WebAssembly). If WebAssembly is unavailable, falls back
// to a JavaScript port of the exact same math so the world still runs.
import { N_IN, H_MAX, N_OUT, N_MEM, W_LEN, O_IH, O_HH, O_HO, O_BH, O_BO, OUT, CX_LEN, CX_NOBS, CX_OFF, CXD, CXT, CXH, CXFF, CXTH } from './genome.js?v=6f9903a0547';

const MAX_SLOTS = 1600;
export const MAXC = 1600, MAXF = 12000;
const TR_LEN = N_IN * H_MAX + H_MAX * N_OUT;
const MEM_IN = N_IN - N_MEM;
export const MAX_CX = 512;
const TH_IN = MEM_IN - CXTH;
const MEMV = OUT.mem, GA = OUT.gateA, GB = OUT.gateB, VAL = OUT.value;

export async function createBrain(wasmBytes) {
  // try the SIMD build first, then the plain build, then pure JavaScript
  const sources = wasmBytes ? [wasmBytes] : ['../wasm/brain.wasm?v=6f9903a0547', '../wasm/brain-nosimd.wasm?v=6f9903a0547'];
  for (const src of sources) {
    try {
      let bytes = src;
      if (typeof src === 'string') {
        const res = await fetch(new URL(src, import.meta.url));
        if (!res.ok) throw new Error('no wasm');
        bytes = await res.arrayBuffer();
      }
      const b = await instantiate(bytes);
      b.kind = 'C++ / WebAssembly' + (typeof src === 'string' && src.includes('nosimd') ? '' : ' SIMD');
      return b;
    } catch (err) { /* try the next one */ }
  }
  return jsBrain();
}
async function instantiate(bytes) {
    const { instance } = await WebAssembly.instantiate(bytes, {});
    const e = instance.exports;
    if (e.w_len() !== W_LEN || e.max_slots() !== MAX_SLOTS || e.cx_len() !== CX_LEN || e.max_cx() !== MAX_CX) throw new Error('brain layout mismatch');
    const buf = e.memory.buffer;
    const f = (p, n) => new Float32Array(buf, p, n);
    const i = (p, n) => new Int32Array(buf, p, n);
    return new Brain({
      kind: 'C++ / WebAssembly',
      W: f(e.ptr_w(), MAX_SLOTS * W_LEN), TR: f(e.ptr_tr(), MAX_SLOTS * TR_LEN), HS: f(e.ptr_h(), MAX_SLOTS * H_MAX),
      MEM: f(e.ptr_mem(), MAX_SLOTS * N_MEM), IN: f(e.ptr_in(), MAX_SLOTS * N_IN), OUT: f(e.ptr_out(), MAX_SLOTS * N_OUT),
      NH: i(e.ptr_nh(), MAX_SLOTS), ETA: f(e.ptr_eta(), MAX_SLOTS), CUR: f(e.ptr_cur(), MAX_SLOTS),
      REWARD: f(e.ptr_reward(), MAX_SLOTS), DELTA: f(e.ptr_delta(), MAX_SLOTS), ACTIVE: i(e.ptr_active(), MAX_SLOTS),
      think: (n) => e.think(n), reset: (s) => e.reset_slot(s), imitate: (c, p, r) => e.imitate(c, p, r),
      CXW: f(e.ptr_cxw(), MAX_CX * CX_LEN), CXID: i(e.ptr_cxid(), MAX_SLOTS), ATT: f(e.ptr_att(), MAX_SLOTS * CXH * CXT),
      V: {
        cx: f(e.v_cx(), MAXC), cy: f(e.v_cy(), MAXC), ca: f(e.v_ca(), MAXC), csz: f(e.v_csz(), MAXC), csig: f(e.v_csig(), MAXC),
        cv1: f(e.v_cv1(), MAXC), cv2: f(e.v_cv2(), MAXC), crange: f(e.v_crange(), MAXC), cfov: f(e.v_cfov(), MAXC), cdiet: f(e.v_cdiet(), MAXC),
        csp: i(e.v_csp(), MAXC), cslot: i(e.v_cslot(), MAXC), ceyes: i(e.v_ceyes(), MAXC), cthink: i(e.v_cthink(), MAXC),
        fx: f(e.v_fx(), MAXF), fy: f(e.v_fy(), MAXF), fe: f(e.v_fe(), MAXF), ft: i(e.v_ft(), MAXF),
        heard: f(e.v_heard(), MAXC), ov1: f(e.v_ov1(), MAXC), ov2: f(e.v_ov2(), MAXC), crowd: i(e.v_crowd(), MAXC),
      },
      senseAll: (nc, nf, W, H) => e.sense_all(nc, nf, W, H),
    });
}

class Brain {
  constructor(o) {
    Object.assign(this, o);
    this.free = [];
    for (let s = MAX_SLOTS - 1; s >= 0; s--) this.free.push(s);
    this.cxFree = [];
    for (let b = MAX_CX - 1; b >= 0; b--) this.cxFree.push(b);
    this.cortexOn = true;
    this.designs = new Set();
  }
  // shared transformer blocks: one per design, reference-counted
  attachCortex(cx) {
    while (cx && cx.block < 0) {
      const b = this.cxFree.pop();
      if (b !== undefined) { cx.block = b; this.CXW.set(cx.w, b * CX_LEN); this.designs.add(cx); break; }
      cx = cx.parent;               // pool full: fall back to the parent design
    }
    if (!cx) return null;
    cx.refs++;
    return cx;
  }
  detachCortex(cx) {
    if (!cx || cx.block < 0) return;
    if (--cx.refs <= 0) { this.cxFree.push(cx.block); cx.block = -1; cx.refs = 0; this.designs.delete(cx); }
  }
  alloc(g, weights) {
    const s = this.free.pop();
    if (s === undefined) return -1;
    this.W.set(weights || g.w, s * W_LEN);
    this.NH[s] = g.hidden;
    this.ETA[s] = g.plastic * 0.1;
    this.CUR[s] = g.curiosity || 0;
    const cx = this.cortexOn && g.cortex ? this.attachCortex(g.cortex) : null;
    this.slotCx = this.slotCx || new Array(MAX_SLOTS);
    this.slotCx[s] = cx;
    this.CXID[s] = cx ? cx.block : -1;
    this.reset(s);
    return s;
  }
  release(s) {
    if (s < 0) return;
    if (this.slotCx && this.slotCx[s]) { this.detachCortex(this.slotCx[s]); this.slotCx[s] = null; }
    this.CXID[s] = -1;
    this.free.push(s);
  }
  cortexOf(s) { return this.slotCx ? this.slotCx[s] : null; }
  attention(s) { return this.ATT.subarray(s * CXH * CXT, (s + 1) * CXH * CXT); }
  weights(s) { return this.W.subarray(s * W_LEN, (s + 1) * W_LEN); }
  inputs(s) { return this.IN.subarray(s * N_IN, (s + 1) * N_IN); }
  outputs(s) { return this.OUT.subarray(s * N_OUT, (s + 1) * N_OUT); }
  hidden(s) { return this.HS.subarray(s * H_MAX, (s + 1) * H_MAX); }
  memory(s) { return this.MEM.subarray(s * N_MEM, (s + 1) * N_MEM); }
  drift(s, g) {
    const w = this.W, o = s * W_LEN; let d = 0, n = 0;
    for (let i = 0; i < W_LEN; i++) { const a = g.w[i]; d += Math.abs(w[o + i] - a); n += Math.abs(a); }
    return n ? d / n : 0;
  }
}

function jsBrain() {
  const W = new Float32Array(MAX_SLOTS * W_LEN), TR = new Float32Array(MAX_SLOTS * TR_LEN), HS = new Float32Array(MAX_SLOTS * H_MAX);
  const HP = new Float32Array(MAX_SLOTS * H_MAX);
  const MEM = new Float32Array(MAX_SLOTS * N_MEM), IN = new Float32Array(MAX_SLOTS * N_IN), OUTv = new Float32Array(MAX_SLOTS * N_OUT);
  const NH = new Int32Array(MAX_SLOTS), ETA = new Float32Array(MAX_SLOTS), CUR = new Float32Array(MAX_SLOTS), REWARD = new Float32Array(MAX_SLOTS);
  const VPREV = new Float32Array(MAX_SLOTS), DELTA = new Float32Array(MAX_SLOTS), ACTIVE = new Int32Array(MAX_SLOTS);
  const TMP = new Float32Array(H_MAX);
  const CXW = new Float32Array(MAX_CX * CX_LEN), CXID = new Int32Array(MAX_SLOTS).fill(-1), ATT = new Float32Array(MAX_SLOTS * CXH * CXT);
  const KR = new Float32Array(MAX_SLOTS * CXT * CXD), VR = new Float32Array(MAX_SLOTS * CXT * CXD);
  const CTXN = new Int32Array(MAX_SLOTS), CTXH = new Int32Array(MAX_SLOTS), CXPH = new Int32Array(MAX_SLOTS);
  const NSP = TH_IN - 30, O = CX_OFF, HD = CXD / CXH;
  const rms = (x) => { let ss = 1e-5; for (const v of x) ss += v * v; const r = 1 / Math.sqrt(ss / x.length); return x.map((v) => v * r); };
  function cortex(s) {
    const W = CXID[s] * CX_LEN, ii = s * N_IN;
    const obs = new Float32Array(CX_NOBS);
    for (let c = 0; c < 5; c++) { let mx = 0; for (let e = 0; e < 6; e++) mx = Math.max(mx, Math.abs(IN[ii + e * 5 + c])); obs[c] = mx; }
    for (let i = 0; i < NSP; i++) obs[5 + i] = IN[ii + 30 + i];
    const x = new Float32Array(CXD);
    for (let i = 0; i < CX_NOBS; i++) { const a = obs[i]; if (!a) continue; for (let d = 0; d < CXD; d++) x[d] += a * CXW[W + O.C_WIN + i * CXD + d]; }
    const xn = rms(x), q = new Float32Array(CXD), k = new Float32Array(CXD), v = new Float32Array(CXD);
    for (let d = 0; d < CXD; d++) for (let j = 0; j < CXD; j++) { q[d] += xn[j] * CXW[W + O.C_WQ + j * CXD + d]; k[d] += xn[j] * CXW[W + O.C_WK + j * CXD + d]; v[d] += xn[j] * CXW[W + O.C_WV + j * CXD + d]; }
    const head = CTXH[s], kb = s * CXT * CXD;
    for (let d = 0; d < CXD; d++) { KR[kb + head * CXD + d] = k[d]; VR[kb + head * CXD + d] = v[d]; }
    CTXH[s] = (head + 1) % CXT; if (CTXN[s] < CXT) CTXN[s]++;
    const n = CTXN[s], o = new Float32Array(CXD);
    for (let h = 0; h < CXH; h++) {
      const sc = []; let mx = -1e9;
      for (let a = 0; a < n; a++) { const idx = (head - a + CXT) % CXT; let d0 = 0; for (let j = 0; j < HD; j++) d0 += q[h * HD + j] * KR[kb + idx * CXD + h * HD + j]; sc[a] = d0 / Math.sqrt(HD) + CXW[W + O.C_AGE + h * CXT + a]; mx = Math.max(mx, sc[a]); }
      let sum = 0; for (let a = 0; a < n; a++) { sc[a] = Math.exp(sc[a] - mx); sum += sc[a]; }
      ATT.fill(0, (s * CXH + h) * CXT, (s * CXH + h + 1) * CXT);
      for (let a = 0; a < n; a++) { const p = sc[a] / sum, idx = (head - a + CXT) % CXT; ATT[(s * CXH + h) * CXT + a] = p; for (let j = 0; j < HD; j++) o[h * HD + j] += p * VR[kb + idx * CXD + h * HD + j]; }
    }
    const h1 = new Float32Array(CXD);
    for (let d = 0; d < CXD; d++) { let a = 0; for (let j = 0; j < CXD; j++) a += o[j] * CXW[W + O.C_WO + j * CXD + d]; h1[d] = x[d] + a; }
    let hn = rms(h1); const m = new Float32Array(CXFF), h2 = new Float32Array(CXD);
    for (let f = 0; f < CXFF; f++) { let a = CXW[W + O.C_B1 + f]; for (let j = 0; j < CXD; j++) a += hn[j] * CXW[W + O.C_W1 + j * CXFF + f]; m[f] = Math.max(0, a); }
    for (let d = 0; d < CXD; d++) { let a = 0; for (let f = 0; f < CXFF; f++) a += m[f] * CXW[W + O.C_W2 + f * CXD + d]; h2[d] = h1[d] + a; }
    hn = rms(h2);
    for (let t = 0; t < CXTH; t++) { let a = 0; for (let j = 0; j < CXD; j++) a += hn[j] * CXW[W + O.C_WOUT + j * CXTH + t]; IN[ii + TH_IN + t] = ftanh(a); }
  }
  const ftanh = (x) => (x > 3 ? 1 : x < -3 ? -1 : (x * (27 + x * x)) / (27 + 9 * x * x));
  const cw = (v) => (v > 4 ? 4 : v < -4 ? -4 : v);
  function one(s) {
    const w = s * W_LEN, ii = s * N_IN, hh = s * H_MAX, mm = s * N_MEM, oo = s * N_OUT, nh = NH[s];
    for (let k = 0; k < N_MEM; k++) IN[ii + MEM_IN + k] = MEM[mm + k];
    if (CXID[s] >= 0) { if ((CXPH[s]++ & 1) === 0) cortex(s); } else IN.fill(0, ii + TH_IN, ii + TH_IN + CXTH);
    for (let j = 0; j < nh; j++) {
      let a = W[w + O_BH + j];
      for (let i = 0; i < N_IN; i++) { const v = IN[ii + i]; if (v !== 0) a += v * W[w + O_IH + i * H_MAX + j]; }
      for (let k = 0; k < nh; k++) a += HS[hh + k] * W[w + O_HH + k * H_MAX + j];
      TMP[j] = ftanh(a);
    }
    for (let j = 0; j < nh; j++) { HP[hh + j] = HS[hh + j]; HS[hh + j] = TMP[j]; }
    for (let m = 0; m < N_OUT; m++) {
      let a = W[w + O_BO + m];
      for (let j = 0; j < nh; j++) a += HS[hh + j] * W[w + O_HO + j * N_OUT + m];
      OUTv[oo + m] = ftanh(a);
    }
    let ga = (OUTv[oo + GA] + 1) * 0.5, gb = (OUTv[oo + GB] + 1) * 0.5; ga *= ga; gb *= gb;
    MEM[mm] += ga * (OUTv[oo + MEMV] - MEM[mm]); MEM[mm + 1] += ga * (OUTv[oo + MEMV + 1] - MEM[mm + 1]);
    MEM[mm + 2] += gb * (OUTv[oo + MEMV + 2] - MEM[mm + 2]); MEM[mm + 3] += gb * (OUTv[oo + MEMV + 3] - MEM[mm + 3]);
    const V = OUTv[oo + VAL];
    let delta = REWARD[s] + 0.9 * V - VPREV[s];
    delta = delta > 1 ? 1 : delta < -1 ? -1 : delta;
    VPREV[s] = V; DELTA[s] = delta;
    const eta = ETA[s]; if (eta <= 0) return;
    const ac = eta * 2 * delta;
    for (let j = 0; j < nh; j++) { const k = w + O_HO + j * N_OUT + VAL; W[k] = cw(W[k] + ac * HP[hh + j]); }
    W[w + O_BO + VAL] = cw(W[w + O_BO + VAL] + ac * 0.5);
    const lr = eta * (delta + CUR[s] * Math.abs(delta)), t = s * TR_LEN;
    for (let i = 0; i < N_IN; i++) {
      const pre = IN[ii + i];
      for (let j = 0; j < nh; j++) {
        const ti = t + i * H_MAX + j, e = TR[ti] * 0.92 + pre * HS[hh + j]; TR[ti] = e;
        const wi = w + O_IH + i * H_MAX + j; W[wi] = cw(W[wi] + lr * e);
      }
    }
    const to = t + N_IN * H_MAX;
    for (let j = 0; j < nh; j++) for (let m = 0; m < VAL; m++) {
      const idx = j * N_OUT + m, e = TR[to + idx] * 0.92 + HS[hh + j] * OUTv[oo + m]; TR[to + idx] = e;
      W[w + O_HO + idx] = cw(W[w + O_HO + idx] + lr * e);
    }
  }
  const F = (n) => new Float32Array(n), I = (n) => new Int32Array(n);
  const V = {
    cx: F(MAXC), cy: F(MAXC), ca: F(MAXC), csz: F(MAXC), csig: F(MAXC), cv1: F(MAXC), cv2: F(MAXC), crange: F(MAXC), cfov: F(MAXC), cdiet: F(MAXC),
    csp: I(MAXC), cslot: I(MAXC), ceyes: I(MAXC), cthink: I(MAXC), fx: F(MAXF), fy: F(MAXF), fe: F(MAXF), ft: I(MAXF),
    heard: F(MAXC), ov1: F(MAXC), ov2: F(MAXC), crowd: I(MAXC),
  };
  const CS = 64;
  function senseAll(nc, nf, Wd, Hd) {
    const cols = ((Wd / CS) | 0) + 1, rows = ((Hd / CS) | 0) + 1;
    const cHead = new Int32Array(cols * rows).fill(-1), fHead = new Int32Array(cols * rows).fill(-1), cNext = new Int32Array(nc), fNext = new Int32Array(nf);
    const cell = (x, y) => Math.min(rows - 1, Math.max(0, (y / CS) | 0)) * cols + Math.min(cols - 1, Math.max(0, (x / CS) | 0));
    for (let i = 0; i < nc; i++) { const g = cell(V.cx[i], V.cy[i]); cNext[i] = cHead[g]; cHead[g] = i; }
    for (let i = 0; i < nf; i++) { const g = cell(V.fx[i], V.fy[i]); fNext[i] = fHead[g]; fHead[g] = i; }
    for (let i = 0; i < nc; i++) {
      if (!V.cthink[i]) continue;
      const x = V.cx[i], y = V.cy[i], a = V.ca[i], range = V.crange[i], r2 = range * range, fov = V.cfov[i], half = fov / 2, diet = V.cdiet[i], sz = V.csz[i], ne = V.ceyes[i], sp = V.csp[i];
      const base = V.cslot[i] * N_IN;
      IN.fill(0, base, base + 30);
      let heard = 0, v1 = 0, v2 = 0, vw = 0, crowd = 0;
      const x0 = Math.max(0, ((x - range) / CS) | 0), x1 = Math.min(cols - 1, ((x + range) / CS) | 0), y0 = Math.max(0, ((y - range) / CS) | 0), y1 = Math.min(rows - 1, ((y + range) / CS) | 0);
      const wrap = (r) => { while (r > Math.PI) r -= 2 * Math.PI; while (r < -Math.PI) r += 2 * Math.PI; return r; };
      for (let gy = y0; gy <= y1; gy++) for (let gx = x0; gx <= x1; gx++) {
        const g = gy * cols + gx;
        let seenC = 0;
        for (let j = cHead[g]; j >= 0 && seenC < 12; j = cNext[j]) {
          if (j === i) continue;
          seenC++;
          const dx = V.cx[j] - x, dy = V.cy[j] - y, d2 = dx * dx + dy * dy; if (d2 > r2) continue;
          const d = Math.sqrt(d2), kin = V.csp[j] === sp;
          if (d < 110) heard += V.csig[j] * (kin ? 1 : 0.4) * (1 - d / 110);
          if (d < 140) { const wv = 1 - d / 140; v1 += V.cv1[j] * wv; v2 += V.cv2[j] * wv; vw += wv; }
          if (d < 40) crowd++;
          const rel = wrap(Math.atan2(dy, dx) - a); if (rel > half || rel < -half) continue;
          const e = Math.min(ne - 1, ((rel + half) / fov * ne) | 0), v = 1 - d / range, ch = kin ? 3 : V.csz[j] < sz * 1.05 ? 1 : 2;
          const k = base + e * 5 + ch; if (v > IN[k]) IN[k] = v;
        }
        let seenF = 0;
        for (let j = fHead[g]; j >= 0 && seenF < 16; j = fNext[j], seenF++) {
          const dx = V.fx[j] - x, dy = V.fy[j] - y, d2 = dx * dx + dy * dy; if (d2 > r2) continue;
          const meat = V.ft[j] === 2, edible = meat ? diet : 1 - diet; if (edible < 0.08) continue;
          const rel = wrap(Math.atan2(dy, dx) - a); if (rel > half || rel < -half) continue;
          const d = Math.sqrt(d2), e = Math.min(ne - 1, ((rel + half) / fov * ne) | 0), v = (1 - d / range) * Math.min(1, 0.3 + V.fe[j] / 30);
          const k = base + e * 5 + (meat ? 1 : 0); if (v > IN[k]) IN[k] = v;
        }
      }
      V.heard[i] = Math.min(1, heard); V.ov1[i] = v1 / (vw + 0.5); V.ov2[i] = v2 / (vw + 0.5); V.crowd[i] = crowd;
    }
  }
  return new Brain({
    kind: 'JavaScript (fallback)', V, senseAll, CXW, CXID, ATT, W, TR, HS, MEM, IN, OUT: OUTv, NH, ETA, CUR, REWARD, DELTA, ACTIVE,
    think: (n) => { for (let k = 0; k < n; k++) one(ACTIVE[k]); },
    reset: (s) => {
      HS.fill(0, s * H_MAX, (s + 1) * H_MAX); HP.fill(0, s * H_MAX, (s + 1) * H_MAX); MEM.fill(0, s * N_MEM, (s + 1) * N_MEM);
      OUTv.fill(0, s * N_OUT, (s + 1) * N_OUT); TR.fill(0, s * TR_LEN, (s + 1) * TR_LEN); REWARD[s] = 0; VPREV[s] = 0; DELTA[s] = 0;
      CTXN[s] = 0; CTXH[s] = 0; CXPH[s] = 0; IN.fill(0, s * N_IN + TH_IN, s * N_IN + TH_IN + CXTH); ATT.fill(0, s * CXH * CXT, (s + 1) * CXH * CXT);
    },
    imitate: (c, p, r) => {
      const wc = c * W_LEN, wp = p * W_LEN, nh = Math.min(NH[c], NH[p]);
      for (let j = 0; j < nh; j++) for (let m = 0; m < N_OUT; m++) { const i = O_HO + j * N_OUT + m; W[wc + i] += r * (W[wp + i] - W[wc + i]); }
      for (let i = 0; i < N_IN; i++) for (let j = 0; j < nh; j++) { const k = O_IH + i * H_MAX + j; W[wc + k] += r * 0.5 * (W[wp + k] - W[wc + k]); }
    },
  });
}
