#!/usr/bin/env bash
# Build the C++ brain into wasm/brain.wasm.
# Needs a clang with the wasm32 target plus wasm-ld (macOS: brew install llvm lld).
set -euo pipefail
cd "$(dirname "$0")/.."
CLANG="${CLANG:-$(command -v /opt/homebrew/opt/llvm/bin/clang || command -v clang)}"
export PATH="/opt/homebrew/opt/lld/bin:$PATH"
"$CLANG" --target=wasm32 -O3 -ffast-math -nostdlib -fno-exceptions -fno-rtti \
  -Wl,--no-entry -Wl,--export-dynamic -Wl,--strip-all \
  -Wl,--export=ptr_w,--export=ptr_tr,--export=ptr_h,--export=ptr_mem,--export=ptr_in,--export=ptr_out \
  -Wl,--export=ptr_nh,--export=ptr_eta,--export=ptr_cur,--export=ptr_reward,--export=ptr_delta,--export=ptr_active \
  -Wl,--export=w_len,--export=max_slots,--export=reset_slot,--export=think,--export=imitate \
  -Wl,--export=sense_all,--export=v_cx,--export=v_cy,--export=v_ca,--export=v_csz,--export=v_csig,--export=v_cv1,--export=v_cv2 \
  -Wl,--export=v_crange,--export=v_cfov,--export=v_cdiet,--export=v_csp,--export=v_cslot,--export=v_ceyes,--export=v_cthink \
  -Wl,--export=v_fx,--export=v_fy,--export=v_fe,--export=v_ft,--export=v_heard,--export=v_ov1,--export=v_ov2,--export=v_crowd \
  -o wasm/brain.wasm cpp/brain.cpp
ls -la wasm/brain.wasm
