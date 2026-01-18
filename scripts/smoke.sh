#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
TARBALL=""
TMP_DIR=""
CURRENT_BRANCH="$(git -C "$ROOT_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || echo main)"

cleanup() {
  if [[ -n "$TARBALL" && -f "$ROOT_DIR/$TARBALL" ]]; then
    rm -f "$ROOT_DIR/$TARBALL"
  fi
  if [[ -n "$TMP_DIR" && -d "$TMP_DIR" ]]; then
    rm -rf "$TMP_DIR"
  fi
}
trap cleanup EXIT

export GITHUB_REF="refs/heads/$CURRENT_BRANCH"
export GITHUB_REF_NAME="$CURRENT_BRANCH"

node "$ROOT_DIR/bin/cli.cjs" --help
node "$ROOT_DIR/bin/cli.cjs" --version --main-branch "$CURRENT_BRANCH"
node "$ROOT_DIR/bin/cli.cjs" --main-branch "$CURRENT_BRANCH"
node "$ROOT_DIR/bin/cli.cjs" --release --main-branch "$CURRENT_BRANCH"

TARBALL="$(cd "$ROOT_DIR" && npm pack --silent)"
TMP_DIR="$(mktemp -d)"
cp "$ROOT_DIR/$TARBALL" "$TMP_DIR/"

(
  cd "$TMP_DIR"
  npx --yes --package="./$TARBALL" next-version-helper --version --cwd "$ROOT_DIR" --main-branch "$CURRENT_BRANCH"
  npx --yes --package="./$TARBALL" next-version-helper --release --cwd "$ROOT_DIR" --main-branch "$CURRENT_BRANCH"
)
