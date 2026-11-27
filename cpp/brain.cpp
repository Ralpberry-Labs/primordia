// Primordia brain core: compiled to WebAssembly (see cpp/build.sh).
//
// Every creature owns a "slot" holding its own copy of its neural network.
// The network is a recurrent net with:
//   * 51 inputs (eyes, body senses, and 4 memory cells fed back in)
//   * up to 24 hidden neurons with recurrent (hidden->hidden) wiring = short-term memory
//   * 13 outputs: actions plus gated writes into 4 long-term memory cells
// It also learns during its lifetime: reward-modulated Hebbian learning with
// eligibility traces. Rewards (food, safety, shelter) strengthen the recent
// synapse activity that led to them; pain weakens it.
//
// Freestanding C++: no libc, no exceptions, just math on static arrays.

#define MAX_SLOTS 1600
#define N_IN 51
#define H_MAX 24
#define N_OUT 13
#define N_MEM 4
#define MEM_IN (N_IN - N_MEM)     // first memory input index
#define OUT_MEMV 7                // outputs 7..10 = memory values
#define OUT_GATE_A 11             // gate for memories 0,1
#define OUT_GATE_B 12             // gate for memories 2,3

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
static float MEM[MAX_SLOTS * N_MEM];   // gated long-term memory cells
static float IN[MAX_SLOTS * N_IN];     // inputs, filled by JS (memory part filled here)
static float OUT[MAX_SLOTS * N_OUT];   // outputs, read by JS
static int   NH[MAX_SLOTS];            // active hidden neurons
static float ETA[MAX_SLOTS];           // learning rate (gene "plasticity")
static float REWARD[MAX_SLOTS];        // reward since last think, set by JS
static int   ACTIVE[MAX_SLOTS];        // slots to evaluate this call
static float TMP[H_MAX];

static inline float ftanh(float x) {
  if (x > 3.f) return 1.f;
  if (x < -3.f) return -1.f;
  float x2 = x * x;
  return x * (27.f + x2) / (27.f + 9.f * x2);
}
static inline float clampw(float v) { return v > 4.f ? 4.f : (v < -4.f ? -4.f : v); }

extern "C" {

float* ptr_w() { return W; }
float* ptr_tr() { return TR; }
float* ptr_h() { return HS; }
float* ptr_mem() { return MEM; }
float* ptr_in() { return IN; }
float* ptr_out() { return OUT; }
int*   ptr_nh() { return NH; }
float* ptr_eta() { return ETA; }
float* ptr_reward() { return REWARD; }
int*   ptr_active() { return ACTIVE; }
int    w_len() { return W_LEN; }
int    max_slots() { return MAX_SLOTS; }

void reset_slot(int s) {
  for (int i = 0; i < H_MAX; i++) HS[s * H_MAX + i] = 0.f;
  for (int i = 0; i < N_MEM; i++) MEM[s * N_MEM + i] = 0.f;
  for (int i = 0; i < N_OUT; i++) OUT[s * N_OUT + i] = 0.f;
  float* tr = TR + s * TR_LEN;
  for (int i = 0; i < TR_LEN; i++) tr[i] = 0.f;
  REWARD[s] = 0.f;
}

static void think_one(int s) {
  float* w = W + s * W_LEN;
  float* in = IN + s * N_IN;
  float* h = HS + s * H_MAX;
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
  for (int j = 0; j < nh; j++) h[j] = TMP[j];

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

  // learning from experience
  const float eta = ETA[s];
  if (eta <= 0.f) return;
  const float r = REWARD[s];
  const float lr = eta * r;
  const float decay = 0.92f;
  float* tr = TR + s * TR_LEN;
  // input -> hidden
  for (int i = 0; i < N_IN; i++) {
    const float pre = in[i];
    float* trow = tr + i * H_MAX;
    float* wrow = w + O_IH + i * H_MAX;
    for (int j = 0; j < nh; j++) {
      float e = trow[j] * decay + pre * h[j];
      trow[j] = e;
      if (lr != 0.f) wrow[j] = clampw(wrow[j] + lr * e);
    }
  }
  // hidden -> output
  float* tro = tr + N_IN * H_MAX;
  for (int j = 0; j < nh; j++) {
    const float pre = h[j];
    for (int m = 0; m < N_OUT; m++) {
      const int idx = j * N_OUT + m;
      float e = tro[idx] * decay + pre * out[m];
      tro[idx] = e;
      if (lr != 0.f) w[O_HO + idx] = clampw(w[O_HO + idx] + lr * e);
    }
  }
}

// Evaluate `count` slots listed in ACTIVE.
void think(int count) {
  for (int n = 0; n < count; n++) think_one(ACTIVE[n]);
}

}  // extern "C"
