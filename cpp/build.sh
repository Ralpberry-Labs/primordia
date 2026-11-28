#!/usr/bin/env bash
# Build the C++ brain into wasm/brain.wasm (SIMD) and wasm/brain-nosimd.wasm (older browsers).
# Needs a clang with the wasm32 target plus wasm-ld (macOS: brew install llvm lld).
set -euo pipefail
cd "$(dirname "$0")/.."
CLANG="${CLANG:-$(command -v /opt/homebrew/opt/llvm/bin/clang || command -v clang)}"
export PATH="/opt/homebrew/opt/lld/bin:$PATH"
EXPORTS=(ptr_w ptr_tr ptr_h ptr_mem ptr_in ptr_out ptr_nh ptr_eta ptr_cur ptr_reward ptr_delta ptr_active
  w_len max_slots reset_slot think imitate ptr_cxw ptr_cxid ptr_att cx_len max_cx
  sense_all v_cx v_cy v_ca v_csz v_csig v_cv1 v_cv2 v_crange v_cfov v_cdiet v_csp v_cslot v_ceyes v_cthink
  v_fx v_fy v_fe v_ft v_heard v_ov1 v_ov2 v_crowd)
EXP=$(printf -- '-Wl,--export=%s ' "${EXPORTS[@]}")
build() {
  "$CLANG" --target=wasm32 -O3 -ffast-math $1 -nostdlib -fno-exceptions -fno-rtti \
    -Wl,--no-entry -Wl,--strip-all $EXP -o "$2" cpp/brain.cpp
}
build "-msimd128" wasm/brain.wasm
build "" wasm/brain-nosimd.wasm
ls -la wasm/*.wasm
