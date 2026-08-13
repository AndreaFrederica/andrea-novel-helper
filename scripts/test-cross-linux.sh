#!/usr/bin/env bash
# Quick local cross-build test for linux-arm64 / linux-armhf
# Usage:
#   TARGET=linux-arm64 ./scripts/test-cross-linux.sh
#   TARGET=linux-armhf ./scripts/test-cross-linux.sh
set -euo pipefail

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "This script is intended to run on Linux (e.g., WSL/Ubuntu)." >&2
  exit 1
fi

TARGET="${TARGET:-linux-arm64}"   # linux-arm64 | linux-armhf

case "$TARGET" in
  linux-arm64)
    ARCH=arm64
    RUST_TARGET=aarch64-unknown-linux-gnu
    LINKER=aarch64-linux-gnu-gcc
    ;;
  linux-armhf)
    ARCH=arm
    RUST_TARGET=arm-unknown-linux-gnueabihf
    LINKER=arm-linux-gnueabihf-gcc
    ;;
  *)
    echo "Unsupported TARGET: $TARGET (use linux-arm64 or linux-armhf)" >&2
    exit 1
    ;;
esac

echo "== Cross build test =="
echo "TARGET: $TARGET"
echo "ARCH:   $ARCH"
echo "RUST:   $RUST_TARGET"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
pushd "$ROOT_DIR" >/dev/null

# Ensure toolchains
echo ">> rustup target add $RUST_TARGET"
rustup target add "$RUST_TARGET"

echo ">> npm ci for target ($TARGET) to fetch correct prebuilt deps (jieba, etc.)"
export npm_config_arch="$ARCH"
export npm_config_target_arch="$ARCH"
export npm_config_platform="linux"
npm ci

echo ">> Build enigo keyboard native module (cross)"
pushd packages/enigo-keyboard >/dev/null
BUILD_TARGET="$RUST_TARGET" \
CARGO_TARGET_${RUST_TARGET^^}_LINKER="$LINKER" \
npm run build:ci
popd >/dev/null

echo ">> TypeScript compile"
npm run compile

echo "== Done. Verify enigo_keyboard.node corresponds to $TARGET =="

popd >/dev/null
