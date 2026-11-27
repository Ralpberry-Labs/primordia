// Primordia brain core: compiled to WebAssembly (see cpp/build.sh).
//
// Every creature owns a "slot" holding its own copy of its neural network:
//   * 58 inputs (eyes, body senses, voices heard, and 4 memory cells fed back in)
//   * up to 32 hidden neurons with recurrent (hidden->hidden) wiring = short-term memory
//   * 16 outputs: actions, two voice channels, gated writes into 4 long-term memory
//     cells, and a "value" neuron: the brain's own guess of how well things are going.
//
// Learning during life follows the three-factor rule of neuroscience:
//   Δw = η · δ · e
//   e  = eligibility trace (decaying memory of recent pre·post activity at each synapse)
//   δ  = dopamine-like reward prediction error = r + γ·V(now) − V(before)
// So creatures learn from *surprise*: better than expected strengthens what they
// were just doing, worse than expected weakens it. The value neuron itself learns
// by TD(0) so its predictions improve. A curiosity gene adds a bonus for surprise.
//
// Also: imitate() lets a child copy part of a parent's learned wiring (culture).
//
// Freestanding C++: no libc, no exceptions, just math on static arrays.

#define MAX_SLOTS 1600
#define N_IN 58
#define H_MAX 32
#define N_OUT 16
#define N_MEM 4
#define MEM_IN (N_IN - N_MEM)     // first memory input index
#define OUT_MEMV 9                // outputs 9..12 = memory values
#define OUT_GATE_A 13             // gate for memories 0,1
#define OUT_GATE_B 14             // gate for memories 2,3
#define OUT_VALUE 15              // critic: predicted future reward

#define O_IH 0
#define O_HH (O_IH + N_IN * H_MAX)
#define O_HO (O_HH + H_MAX * H_MAX)
#define O_BH (O_HO + H_MAX * N_OUT)
#define O_BO (O_BH + H_MAX)
#define W_LEN (O_BO + N_OUT)
#define TR_LEN (N_IN * H_MAX + H_MAX * N_OUT)

static float W[MAX_SLOTS * W_LEN];     // live (learnable) weights
static float TR[MAX_SLOTS * TR_LEN];   // eligibility traces
static float HS[MAX_SLOTS * H_MAX];    // hidden state (recurrent)
static float HP[MAX_SLOTS * H_MAX];    // hidden state one step ago (for the critic)
static float MEM[MAX_SLOTS * N_MEM];   // gated long-term memory cells
static float IN[MAX_SLOTS * N_IN];     // inputs, filled by JS (memory part filled here)
static float OUT[MAX_SLOTS * N_OUT];   // outputs, read by JS
static int   NH[MAX_SLOTS];            // active hidden neurons
static float ETA[MAX_SLOTS];           // learning rate (gene "plasticity")
static float CUR[MAX_SLOTS];           // curiosity (gene)
static float REWARD[MAX_SLOTS];        // reward since last think, set by JS
static float VPREV[MAX_SLOTS];         // value predicted last think
static float DELTA[MAX_SLOTS];         // last prediction error (read by JS as "surprise")
static int   ACTIVE[MAX_SLOTS];        // slots to evaluate this call
static float TMP[H_MAX];

static inline float ftanh(float x) {
  if (x > 3.f) return 1.f;
  if (x < -3.f) return -1.f;
  float x2 = x * x;
  return x * (27.f + x2) / (27.f + 9.f * x2);
}
static inline float clampw(float v) { return v > 4.f ? 4.f : (v < -4.f ? -4.f : v); }
static inline float fabsf_(float v) { return v < 0.f ? -v : v; }

extern "C" {

float* ptr_w() { return W; }
float* ptr_tr() { return TR; }
float* ptr_h() { return HS; }
float* ptr_mem() { return MEM; }
float* ptr_in() { return IN; }
float* ptr_out() { return OUT; }
int*   ptr_nh() { return NH; }
float* ptr_eta() { return ETA; }
float* ptr_cur() { return CUR; }
float* ptr_reward() { return REWARD; }
float* ptr_delta() { return DELTA; }
int*   ptr_active() { return ACTIVE; }
int    w_len() { return W_LEN; }
int    max_slots() { return MAX_SLOTS; }

void reset_slot(int s) {
  for (int i = 0; i < H_MAX; i++) { HS[s * H_MAX + i] = 0.f; HP[s * H_MAX + i] = 0.f; }
  for (int i = 0; i < N_MEM; i++) MEM[s * N_MEM + i] = 0.f;
  for (int i = 0; i < N_OUT; i++) OUT[s * N_OUT + i] = 0.f;
  float* tr = TR + s * TR_LEN;
  for (int i = 0; i < TR_LEN; i++) tr[i] = 0.f;
  REWARD[s] = 0.f; VPREV[s] = 0.f; DELTA[s] = 0.f;
}

static void think_one(int s) {
  float* w = W + s * W_LEN;
  float* in = IN + s * N_IN;
  float* h = HS + s * H_MAX;
  float* hp = HP + s * H_MAX;
  float* mem = MEM + s * N_MEM;
  float* out = OUT + s * N_OUT;
  const int nh = NH[s];

  for (int k = 0; k < N_MEM; k++) in[MEM_IN + k] = mem[k];

  // hidden layer (recurrent)
  for (int j = 0; j < nh; j++) {
    float a = w[O_BH + j];
    for (int i = 0; i < N_IN; i++) {
      float v = in[i];
      if (v != 0.f) a += v * w[O_IH + i * H_MAX + j];
    }
    for (int k = 0; k < nh; k++) a += h[k] * w[O_HH + k * H_MAX + j];
    TMP[j] = ftanh(a);
  }
  for (int j = 0; j < nh; j++) { hp[j] = h[j]; h[j] = TMP[j]; }

  // outputs
  for (int m = 0; m < N_OUT; m++) {
    float a = w[O_BO + m];
    for (int j = 0; j < nh; j++) a += h[j] * w[O_HO + j * N_OUT + m];
    out[m] = ftanh(a);
  }

  // gated memory writes: m = m*(1-g) + g*v
  float ga = (out[OUT_GATE_A] + 1.f) * 0.5f, gb = (out[OUT_GATE_B] + 1.f) * 0.5f;
  ga = ga * ga; gb = gb * gb;  // sharpen: writes need a confident gate
  mem[0] += ga * (out[OUT_MEMV + 0] - mem[0]);
  mem[1] += ga * (out[OUT_MEMV + 1] - mem[1]);
  mem[2] += gb * (out[OUT_MEMV + 2] - mem[2]);
  mem[3] += gb * (out[OUT_MEMV + 3] - mem[3]);

  // ---- dopamine: reward prediction error ----
  const float V = out[OUT_VALUE];
  float delta = REWARD[s] + 0.9f * V - VPREV[s];
  if (delta > 1.f) delta = 1.f; else if (delta < -1.f) delta = -1.f;
  VPREV[s] = V;
  DELTA[s] = delta;
  const float eta = ETA[s];
  if (eta <= 0.f) return;
  // critic learns to predict (TD(0) on the value neuron, using last step's hidden state)
  const float ac = eta * 2.f * delta;
  for (int j = 0; j < nh; j++) w[O_HO + j * N_OUT + OUT_VALUE] = clampw(w[O_HO + j * N_OUT + OUT_VALUE] + ac * hp[j]);
  w[O_BO + OUT_VALUE] = clampw(w[O_BO + OUT_VALUE] + ac * 0.5f);
  // actor: three-factor Hebbian update modulated by surprise (+ curiosity bonus)
  const float mod = delta + CUR[s] * fabsf_(delta);
  const float lr = eta * mod;
  const float decay = 0.92f;
  float* tr = TR + s * TR_LEN;
  for (int i = 0; i < N_IN; i++) {
    const float pre = in[i];
    float* trow = tr + i * H_MAX;
    float* wrow = w + O_IH + i * H_MAX;
    for (int j = 0; j < nh; j++) {
      float e = trow[j] * decay + pre * h[j];
      trow[j] = e;
      wrow[j] = clampw(wrow[j] + lr * e);
    }
  }
  float* tro = tr + N_IN * H_MAX;
  for (int j = 0; j < nh; j++) {
    const float pre = h[j];
    for (int m = 0; m < OUT_VALUE; m++) {
      const int idx = j * N_OUT + m;
      float e = tro[idx] * decay + pre * out[m];
      tro[idx] = e;
      w[O_HO + idx] = clampw(w[O_HO + idx] + lr * e);
    }
  }
}

// Evaluate `count` slots listed in ACTIVE.
void think(int count) {
  for (int n = 0; n < count; n++) think_one(ACTIVE[n]);
}

// Cultural transmission: the child moves a fraction of the way toward the parent's
// *learned* behaviour (hidden->output wiring and its senses), without copying genes.
void imitate(int child, int parent, float rate) {
  float* wc = W + child * W_LEN;
  const float* wp = W + parent * W_LEN;
  const int nh = NH[child] < NH[parent] ? NH[child] : NH[parent];
  for (int j = 0; j < nh; j++)
    for (int m = 0; m < N_OUT; m++) {
      const int i = O_HO + j * N_OUT + m;
      wc[i] += rate * (wp[i] - wc[i]);
    }
  for (int i = 0; i < N_IN; i++)
    for (int j = 0; j < nh; j++) {
      const int k = O_IH + i * H_MAX + j;
      wc[k] += rate * 0.5f * (wp[k] - wc[k]);
    }
}


// ---------------------------------------------------------------------------
// Vision kernel: the hottest loop of the simulation, moved from JS to C++.
// JS packs creature and food positions into these arrays; we bucket them into a
// spatial grid and, for every creature that thinks this tick, fill its eye inputs
// (plants, prey/meat, threats, kin per eye) and what it hears (glow, two voices).
// ---------------------------------------------------------------------------
#define MAXC 1600
#define MAXF 12000
#define GMAX 8192
#define MAX_EYES 6
#define CH 5
#define CELLSZ 64.f

static float CX[MAXC], CY[MAXC], CA[MAXC], CSZ[MAXC], CSIG[MAXC], CV1[MAXC], CV2[MAXC];
static float CRANGE[MAXC], CFOV[MAXC], CDIET[MAXC];
static int   CSP[MAXC], CSLOT[MAXC], CEYES[MAXC], CTHINK[MAXC];
static float FX[MAXF], FY[MAXF], FE[MAXF];
static int   FT[MAXF];
static float OHEARD[MAXC], OV1[MAXC], OV2[MAXC];
static int   OCROWD[MAXC];
static int   cHead[GMAX], cNext[MAXC], fHead[GMAX], fNext[MAXF];

static inline float fatan2(float y, float x) {
  float ax = fabsf_(x), ay = fabsf_(y);
  float mx = ax > ay ? ax : ay, mn = ax > ay ? ay : ax;
  if (mx == 0.f) return 0.f;
  float a = mn / mx, s = a * a;
  float r = ((-0.0464964749f * s + 0.15931422f) * s - 0.327622764f) * s * a + a;
  if (ay > ax) r = 1.57079637f - r;
  if (x < 0.f) r = 3.14159274f - r;
  if (y < 0.f) r = -r;
  return r;
}
static inline float wrapPi(float a) {
  while (a > 3.14159274f) a -= 6.28318548f;
  while (a < -3.14159274f) a += 6.28318548f;
  return a;
}

float* v_cx() { return CX; } float* v_cy() { return CY; } float* v_ca() { return CA; } float* v_csz() { return CSZ; }
float* v_csig() { return CSIG; } float* v_cv1() { return CV1; } float* v_cv2() { return CV2; }
float* v_crange() { return CRANGE; } float* v_cfov() { return CFOV; } float* v_cdiet() { return CDIET; }
int* v_csp() { return CSP; } int* v_cslot() { return CSLOT; } int* v_ceyes() { return CEYES; } int* v_cthink() { return CTHINK; }
float* v_fx() { return FX; } float* v_fy() { return FY; } float* v_fe() { return FE; } int* v_ft() { return FT; }
float* v_heard() { return OHEARD; } float* v_ov1() { return OV1; } float* v_ov2() { return OV2; } int* v_crowd() { return OCROWD; }

void sense_all(int nc, int nf, float W, float H) {
  int cols = (int)(W / CELLSZ) + 1, rows = (int)(H / CELLSZ) + 1;
  if (cols * rows > GMAX) { rows = GMAX / cols; }
  for (int g = 0; g < cols * rows; g++) { cHead[g] = -1; fHead[g] = -1; }
  for (int i = 0; i < nc; i++) {
    int gx = (int)(CX[i] / CELLSZ), gy = (int)(CY[i] / CELLSZ);
    if (gx < 0) gx = 0; if (gx >= cols) gx = cols - 1; if (gy < 0) gy = 0; if (gy >= rows) gy = rows - 1;
    int g = gy * cols + gx; cNext[i] = cHead[g]; cHead[g] = i;
  }
  for (int i = 0; i < nf; i++) {
    int gx = (int)(FX[i] / CELLSZ), gy = (int)(FY[i] / CELLSZ);
    if (gx < 0) gx = 0; if (gx >= cols) gx = cols - 1; if (gy < 0) gy = 0; if (gy >= rows) gy = rows - 1;
    int g = gy * cols + gx; fNext[i] = fHead[g]; fHead[g] = i;
  }
  for (int i = 0; i < nc; i++) {
    if (!CTHINK[i]) continue;
    const float x = CX[i], y = CY[i], a = CA[i], range = CRANGE[i], r2 = range * range;
    const float fov = CFOV[i], half = fov * 0.5f, diet = CDIET[i], sz = CSZ[i];
    const int ne = CEYES[i], sp = CSP[i];
    float* eyes = IN + CSLOT[i] * N_IN;
    for (int k = 0; k < MAX_EYES * CH; k++) eyes[k] = 0.f;
    float heard = 0.f, v1 = 0.f, v2 = 0.f, vw = 0.f; int crowd = 0;
    int x0 = (int)((x - range) / CELLSZ), x1 = (int)((x + range) / CELLSZ);
    int y0 = (int)((y - range) / CELLSZ), y1 = (int)((y + range) / CELLSZ);
    if (x0 < 0) x0 = 0; if (y0 < 0) y0 = 0; if (x1 >= cols) x1 = cols - 1; if (y1 >= rows) y1 = rows - 1;
    for (int gy = y0; gy <= y1; gy++) for (int gx = x0; gx <= x1; gx++) {
      const int g = gy * cols + gx;
      int seenC = 0;
      for (int j = cHead[g]; j >= 0 && seenC < 12; j = cNext[j]) {
        if (j == i) continue;
        seenC++;
        const float dx = CX[j] - x, dy = CY[j] - y, d2 = dx * dx + dy * dy;
        if (d2 > r2) continue;
        const float d = __builtin_sqrtf(d2);
        const int kin = CSP[j] == sp;
        if (d < 110.f) heard += CSIG[j] * (kin ? 1.f : 0.4f) * (1.f - d / 110.f);
        if (d < 140.f) { const float wv = 1.f - d / 140.f; v1 += CV1[j] * wv; v2 += CV2[j] * wv; vw += wv; }
        if (d < 40.f) crowd++;
        const float rel = wrapPi(fatan2(dy, dx) - a);
        if (rel > half || rel < -half) continue;
        int e = (int)((rel + half) / fov * ne); if (e >= ne) e = ne - 1;
        const float v = 1.f - d / range;
        const int ch = kin ? 3 : (CSZ[j] < sz * 1.05f ? 1 : 2);
        float* p = eyes + e * CH + ch; if (v > *p) *p = v;
      }
      int seenF = 0;
      for (int j = fHead[g]; j >= 0 && seenF < 16; j = fNext[j], seenF++) {
        const float dx = FX[j] - x, dy = FY[j] - y, d2 = dx * dx + dy * dy;
        if (d2 > r2) continue;
        const int meat = FT[j] == 2;
        const float edible = meat ? diet : 1.f - diet;
        if (edible < 0.08f) continue;
        const float rel = wrapPi(fatan2(dy, dx) - a);
        if (rel > half || rel < -half) continue;
        const float d = __builtin_sqrtf(d2);
        int e = (int)((rel + half) / fov * ne); if (e >= ne) e = ne - 1;
        float fe = 0.3f + FE[j] / 30.f; if (fe > 1.f) fe = 1.f;
        const float v = (1.f - d / range) * fe;
        float* p = eyes + e * CH + (meat ? 1 : 0); if (v > *p) *p = v;
      }
    }
    OHEARD[i] = heard > 1.f ? 1.f : heard;
    OV1[i] = v1 / (vw + 0.5f); OV2[i] = v2 / (vw + 0.5f);
    OCROWD[i] = crowd;
  }
}

}  // extern "C"
