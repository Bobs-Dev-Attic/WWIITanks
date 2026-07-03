#!/usr/bin/env bash
#
# Build the Defold project into an HTML5 bundle in ./dist, ready for Vercel.
#
# Requirements on the build machine: Java 11+ and network access to
# d.defold.com (Defold's CDN). This script downloads the matching `bob`
# build tool and produces a self-contained static site.
#
# Usage:
#   ./tools/build_html5.sh              # build with the latest stable Defold
#   DEFOLD_SHA=<sha1> ./tools/build_html5.sh   # pin a specific engine build
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

TITLE="WWII Tanks"          # must match [project].title in game.project
BOB_DIR=".bob"
DIST_DIR="dist"

mkdir -p "$BOB_DIR"

# Resolve the Defold engine version to build against.
if [[ -z "${DEFOLD_SHA:-}" ]]; then
  echo "Resolving latest stable Defold version..."
  DEFOLD_SHA="$(curl -fsSL https://d.defold.com/stable/info.json \
    | sed -n 's/.*"sha1"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
fi
echo "Using Defold engine sha: ${DEFOLD_SHA}"

BOB_JAR="${BOB_DIR}/bob-${DEFOLD_SHA}.jar"
if [[ ! -f "$BOB_JAR" ]]; then
  echo "Downloading bob.jar..."
  curl -fSL "https://d.defold.com/archive/${DEFOLD_SHA}/bob/bob.jar" -o "$BOB_JAR"
fi

echo "Resolving library dependencies..."
java -jar "$BOB_JAR" resolve

echo "Building + bundling for js-web (HTML5)..."
rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR"
java -jar "$BOB_JAR" \
  --platform js-web \
  --architectures wasm-web \
  --archive \
  --bundle-output "$DIST_DIR" \
  --variant release \
  distclean build bundle

# Defold nests the bundle in a folder named after the project title. Flatten
# it so Vercel can serve ./dist directly.
if [[ -d "${DIST_DIR}/${TITLE}" ]]; then
  shopt -s dotglob
  mv "${DIST_DIR}/${TITLE}"/* "${DIST_DIR}/"
  rmdir "${DIST_DIR}/${TITLE}"
fi

echo ""
echo "Done. Static HTML5 bundle is in ./${DIST_DIR}"
echo "Preview locally:  npx serve ${DIST_DIR}"
echo "Deploy to Vercel: vercel deploy ./${DIST_DIR} --prod"
