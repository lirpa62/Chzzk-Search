#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DIST_DIR="$ROOT_DIR/dist"
mkdir -p "$DIST_DIR"

VERSION="$(
  ruby -rjson -e 'puts JSON.parse(File.read(ARGV[0]))["version"]' \
    "$ROOT_DIR/manifest.json"
)"
BUILD_DIR="$(mktemp -d "${TMPDIR:-/tmp}/chzzk-platter-chrome-build.XXXXXX")"
TEMP_ZIP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/chzzk-platter-chrome-package.XXXXXX")"
TEMP_ZIP="$TEMP_ZIP_DIR/package.zip"
FINAL_ZIP="$DIST_DIR/chzzk-platter-chrome-v${VERSION}.zip"

cleanup() {
  rm -rf "$BUILD_DIR" "$TEMP_ZIP_DIR"
}

trap cleanup EXIT

copy_path() {
  local source="$1"
  local target="$BUILD_DIR/$1"
  mkdir -p "$(dirname "$target")"
  cp -R "$ROOT_DIR/$source" "$target"
}

copy_path "src"
copy_path "icons"
copy_path "popup.html"
copy_path "settings.html"
copy_path "manifest.json"
copy_path "no-search-results-found-animation.svg"
copy_path "searching-animation.svg"
copy_path "loading.svg"

(
  cd "$BUILD_DIR"
  zip -qr -X "$TEMP_ZIP" .
)

cp "$TEMP_ZIP" "$FINAL_ZIP"

echo "Chrome package created:"
echo "  $FINAL_ZIP"
