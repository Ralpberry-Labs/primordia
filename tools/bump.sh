#!/usr/bin/env bash
# Stamp every module import with one version so browsers never mix old and new files.
#   tools/bump.sh            -> uses the current git short hash + time
set -euo pipefail
cd "$(dirname "$0")/.."
V="${1:-$(date +%s)}"
# js imports:  from './x.js'  or  from './x.js?v=...'
sed -E -i '' "s#(from '\./[a-z]+\.js)(\?v=[0-9a-z]+)?'#\1?v=$V'#g" js/*.js
sed -E -i '' "s#(src=\"js/main\.js)(\?v=[0-9a-z]+)?\"#\1?v=$V\"#; s#(href=\"css/style\.css)(\?v=[0-9a-z]+)?\"#\1?v=$V\"#" index.html
sed -E -i '' "s#(brain(-nosimd)?\.wasm)\?v=[0-9a-z]+#\1?v=$V#g" js/brain.js
echo "version $V"
