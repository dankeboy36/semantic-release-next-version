#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
TARBALL=""
TMP_DIR=""

MAIN_BRANCH="${GITHUB_BASE_REF:-main}"
CURRENT_BRANCH="${GITHUB_HEAD_REF:-${GITHUB_REF_NAME:-$(git -C "$ROOT_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || echo main)}}"
if [[ "$CURRENT_BRANCH" == "HEAD" || -z "$CURRENT_BRANCH" ]]; then
  CURRENT_BRANCH="$MAIN_BRANCH"
fi

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
export GITHUB_HEAD_REF="$CURRENT_BRANCH"
export GITHUB_BASE_REF="$MAIN_BRANCH"

node "$ROOT_DIR/bin/cli.cjs" --help
node "$ROOT_DIR/bin/cli.cjs" --version --main-branch "$MAIN_BRANCH"
node "$ROOT_DIR/bin/cli.cjs" --main-branch "$MAIN_BRANCH"
node "$ROOT_DIR/bin/cli.cjs" --release --main-branch "$MAIN_BRANCH"

TARBALL="$(cd "$ROOT_DIR" && npm pack --silent)"
TMP_DIR="$(mktemp -d)"
cp "$ROOT_DIR/$TARBALL" "$TMP_DIR/"

(
  cd "$TMP_DIR"
  GITHUB_REF="refs/heads/$CURRENT_BRANCH" \
  GITHUB_REF_NAME="$CURRENT_BRANCH" \
  GITHUB_HEAD_REF="$CURRENT_BRANCH" \
  GITHUB_BASE_REF="$MAIN_BRANCH" \
  npx --yes --package="./$TARBALL" next-version-helper --version --cwd "$ROOT_DIR" --main-branch "$MAIN_BRANCH"

  GITHUB_REF="refs/heads/$CURRENT_BRANCH" \
  GITHUB_REF_NAME="$CURRENT_BRANCH" \
  GITHUB_HEAD_REF="$CURRENT_BRANCH" \
  GITHUB_BASE_REF="$MAIN_BRANCH" \
  npx --yes --package="./$TARBALL" next-version-helper --release --cwd "$ROOT_DIR" --main-branch "$MAIN_BRANCH"
)
