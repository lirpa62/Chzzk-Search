#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DIST_DIR="$ROOT_DIR/dist"
FIREFOX_DIR="$ROOT_DIR/Chzzk-Platter-Firefox"
mkdir -p "$DIST_DIR"

VERSION="$(
  ruby -rjson -e 'puts JSON.parse(File.read(ARGV[0]))["version"]' \
    "$ROOT_DIR/manifest.json"
)"
TEMP_XPI_DIR="$(mktemp -d "${TMPDIR:-/tmp}/chzzk-platter-firefox-package.XXXXXX")"
TEMP_XPI="$TEMP_XPI_DIR/package.xpi"
FINAL_XPI="$DIST_DIR/chzzk-platter-firefox-v${VERSION}.xpi"

cleanup() {
  rm -rf "$TEMP_XPI_DIR"
}

trap cleanup EXIT

copy_path() {
  local source="$1"
  local target="$FIREFOX_DIR/$1"
  mkdir -p "$(dirname "$target")"
  cp -R "$ROOT_DIR/$source" "$target"
}

rm -rf "$FIREFOX_DIR"
mkdir -p "$FIREFOX_DIR"

copy_path "src"
copy_path "icons"
copy_path "popup.html"
copy_path "settings.html"
copy_path "README.md"
copy_path "THIRD_PARTY_NOTICES.md"
copy_path "LICENSES"
copy_path "no-search-results-found-animation.svg"
copy_path "searching-animation.svg"
copy_path "loading.svg"

ruby -rjson -e '
  manifest = JSON.parse(File.read(ARGV[0]))
  manifest["background"] = { "scripts" => ["src/background.js"] }
  manifest["browser_specific_settings"] = {
    "gecko" => {
      "id" => "@chzzk-platter.dev-lirpa",
      "strict_min_version" => "128.0",
      "data_collection_permissions" => {
        "required" => ["none"]
      }
    }
  }
  File.write(ARGV[1], JSON.pretty_generate(manifest) + "\n")
' "$ROOT_DIR/manifest.json" "$FIREFOX_DIR/manifest.json"

(
  cd "$FIREFOX_DIR"
  zip -qr -X "$TEMP_XPI" .
)

cp "$TEMP_XPI" "$FINAL_XPI"

echo "Firefox package created:"
echo "  $FINAL_XPI"
echo "Firefox build directory updated:"
echo "  $FIREFOX_DIR"
