#!/usr/bin/env bash
set -euo pipefail

STYLES="site/styles"
SCRIPTS="site/scripts"
OUT="_site"

SASS_ARGS=""
for f in "$STYLES"/*.scss; do
  name="$(basename "$f" .scss)"
  SASS_ARGS="$SASS_ARGS $f:$OUT/styles/$name.css"
done

sass $SASS_ARGS --style=compressed --no-source-map

esbuild "$SCRIPTS/index.ts" "$SCRIPTS/gallery.ts" \
  --bundle --outdir="$OUT/scripts" --minify --target=es2020 \
  --splitting --format=esm

NODE_ENV=production eleventy
