#!/usr/bin/env bash
set -euo pipefail

TARGET="${TARGET:-darwin-x64}"
ELECTRON_VERSION="${ELECTRON_VERSION:-30.0.9}"
VARIANT="${VARIANT:-exp}"
INSTALL_PIXI="${INSTALL_PIXI:-1}"
SKIP_NPM_CI="${SKIP_NPM_CI:-0}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

usage() {
  cat <<'USAGE'
Usage:
  ./scripts/macos-vm-build.sh [options]

Options:
  --target <target>             VS Code target. Default: darwin-x64
  --electron-version <version>  Electron headers version. Default: 30.0.9
  --variant <std|exp|both>      Package variant. Default: exp
  --skip-npm-ci                 Reuse existing node_modules
  --no-install-pixi             Do not bootstrap pixi when it is missing
  -h, --help                    Show this help

Environment variables mirror the options:
  TARGET, ELECTRON_VERSION, VARIANT, SKIP_NPM_CI, INSTALL_PIXI

Fresh Intel macOS VM flow:
  git clone <repo-url>
  cd andrea-novel-helper
  bash scripts/macos-vm-build.sh

Default output:
  dist/anh-exp-darwin-x64.vsix

Build both variants when needed:
  bash scripts/macos-vm-build.sh --variant both
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target)
      TARGET="${2:?missing value for --target}"
      shift 2
      ;;
    --electron-version)
      ELECTRON_VERSION="${2:?missing value for --electron-version}"
      shift 2
      ;;
    --variant)
      VARIANT="${2:?missing value for --variant}"
      shift 2
      ;;
    --skip-npm-ci)
      SKIP_NPM_CI=1
      shift
      ;;
    --no-install-pixi)
      INSTALL_PIXI=0
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

case "$VARIANT" in
  std|exp|both) ;;
  *)
    echo "Invalid --variant: $VARIANT. Expected std, exp, or both." >&2
    exit 2
    ;;
esac

case "$TARGET" in
  darwin-x64)
    NPM_ARCH="x64"
    ;;
  darwin-arm64)
    NPM_ARCH="arm64"
    ;;
  *)
    echo "This VM helper is intended for macOS targets only. Got: $TARGET" >&2
    exit 2
    ;;
esac

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This script must run inside macOS. Current system: $(uname -s)" >&2
  exit 1
fi

if [[ "$TARGET" == "darwin-x64" && "$(uname -m)" != "x86_64" ]]; then
  cat >&2 <<'WARN'
This script is building darwin-x64, but the VM is not x86_64.
Use an Intel macOS VM for native darwin-x64 builds.
WARN
  exit 1
fi

if ! xcode-select -p >/dev/null 2>&1; then
  cat >&2 <<'XCODE'
Xcode Command Line Tools are missing.
Run this once in the VM, then rerun this script:
  xcode-select --install
XCODE
  exit 1
fi

if ! command -v git >/dev/null 2>&1; then
  echo "git is required. Install Xcode Command Line Tools or Git first." >&2
  exit 1
fi

if ! command -v pixi >/dev/null 2>&1; then
  if [[ "$INSTALL_PIXI" != "1" ]]; then
    echo "pixi is missing and INSTALL_PIXI=0 was set." >&2
    exit 1
  fi

  echo "pixi not found; installing pixi for this user..."
  curl -fsSL https://pixi.sh/install.sh | bash
  export PATH="$HOME/.pixi/bin:$PATH"
fi

if ! command -v pixi >/dev/null 2>&1; then
  echo "pixi installation finished, but pixi is still not on PATH." >&2
  echo "Try: export PATH=\"\$HOME/.pixi/bin:\$PATH\"" >&2
  exit 1
fi

cd "$REPO_ROOT"

echo "Build configuration:"
echo "  repo: $REPO_ROOT"
echo "  target: $TARGET"
echo "  electron: $ELECTRON_VERSION"
echo "  variant: $VARIANT"
echo "  host: $(sw_vers -productVersion) $(uname -m)"

echo "Preparing pixi environment..."
pixi install

export npm_config_platform=darwin
export npm_config_arch="$NPM_ARCH"
export npm_config_target_arch="$NPM_ARCH"
export ELECTRON_VERSION

if [[ "$SKIP_NPM_CI" != "1" ]]; then
  echo "Installing npm dependencies for darwin/$NPM_ARCH..."
  pixi run npm ci
else
  echo "Skipping npm ci; reusing existing node_modules."
fi

echo "Building webview..."
pixi run npm --workspace=packages/webview run build

echo "Building native enigo-keyboard..."
pixi run npm --workspace=packages/enigo-keyboard run build:ci

echo "Applying macOS ad-hoc signature to native binary..."
pixi run npm --workspace=packages/enigo-keyboard run sign:macos

echo "Packaging VSIX artifacts..."
SKIP_WEBVIEW=1 pixi run node scripts/pixi-local-build.js "$VARIANT" "$TARGET"

echo
echo "Build complete. Artifacts:"
if [[ "$VARIANT" == "both" ]]; then
  ls -lh "dist/anh-std-$TARGET.vsix" "dist/anh-exp-$TARGET.vsix"
else
  ls -lh "dist/anh-$VARIANT-$TARGET.vsix"
fi
