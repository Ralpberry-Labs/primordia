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
  -Wl,--export=ptr_nh,--export=ptr_eta,--export=ptr_reward,--export=ptr_active \
  -Wl,--export=w_len,--export=max_slots,--export=reset_slot,--export=think \
  -o wasm/brain.wasm cpp/brain.cpp
ls -la wasm/brain.wasm
