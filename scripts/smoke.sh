#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
TARBALL=""
TMP_DIR=""
TMP_REMOTE=""
TMP_REPO=""

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
  if [[ -n "$TMP_REMOTE" && -d "$TMP_REMOTE" ]]; then
    rm -rf "$TMP_REMOTE"
  fi
  if [[ -n "$TMP_REPO" && -d "$TMP_REPO" ]]; then
    rm -rf "$TMP_REPO"
  fi
}
trap cleanup EXIT

export GITHUB_REF="refs/heads/$CURRENT_BRANCH"
export GITHUB_REF_NAME="$CURRENT_BRANCH"
export GITHUB_HEAD_REF="$CURRENT_BRANCH"
export GITHUB_BASE_REF="$MAIN_BRANCH"
if [[ -z "${DEBUG:-}" ]]; then
  export DEBUG="semantic-release-next-version,semantic-release:*"
else
  [[ "$DEBUG" == *semantic-release-next-version* ]] || DEBUG+=" ,semantic-release-next-version"
  [[ "$DEBUG" == *semantic-release:* ]] || DEBUG+=" ,semantic-release:*"
  export DEBUG="${DEBUG// ,/,}"
fi

# Build an isolated temporary clone so smoke behavior is deterministic across
# commit types (for example, Dependabot chore commits that do not trigger
# semantic-release by default).
TMP_REPO="$(mktemp -d)/repo"
git clone --quiet "$ROOT_DIR" "$TMP_REPO"
git -C "$TMP_REPO" config user.name "smoke-test"
git -C "$TMP_REPO" config user.email "smoke-test@example.invalid"
git -C "$TMP_REPO" checkout -B "$CURRENT_BRANCH" >/dev/null 2>&1 || true
echo "smoke-$(date +%s)" >"$TMP_REPO/.smoke-next-version"
git -C "$TMP_REPO" add .smoke-next-version
git -C "$TMP_REPO" commit -m "fix: smoke test trigger" >/dev/null

# Create a local bare remote so semantic-release can verify pushes without
# GitHub auth.
TMP_REMOTE="$(mktemp -d)/remote.git"
git init --bare "$TMP_REMOTE" >/dev/null
git --git-dir "$TMP_REMOTE" symbolic-ref HEAD "refs/heads/$MAIN_BRANCH" >/dev/null 2>&1 || true
git -C "$TMP_REPO" remote set-url origin "$TMP_REMOTE"
git -C "$TMP_REPO" push origin "HEAD:refs/heads/$MAIN_BRANCH" >/dev/null 2>&1
if [[ "$CURRENT_BRANCH" != "$MAIN_BRANCH" ]]; then
  git -C "$TMP_REPO" push origin "HEAD:refs/heads/$CURRENT_BRANCH" >/dev/null 2>&1 || true
fi
git -C "$TMP_REPO" push origin --tags >/dev/null 2>&1 || true

node "$ROOT_DIR/bin/cli.cjs" --help
node "$ROOT_DIR/bin/cli.cjs" --version --main-branch "$MAIN_BRANCH"
node "$ROOT_DIR/bin/cli.cjs" --cwd "$TMP_REPO" --main-branch "$MAIN_BRANCH"
node "$ROOT_DIR/bin/cli.cjs" --release --cwd "$TMP_REPO" --main-branch "$MAIN_BRANCH"

TARBALL="$(cd "$ROOT_DIR" && npm pack --silent)"
TMP_DIR="$(mktemp -d)"
cp "$ROOT_DIR/$TARBALL" "$TMP_DIR/"

(
  cd "$TMP_DIR"
  GITHUB_REF="refs/heads/$CURRENT_BRANCH" \
  GITHUB_REF_NAME="$CURRENT_BRANCH" \
  GITHUB_HEAD_REF="$CURRENT_BRANCH" \
  GITHUB_BASE_REF="$MAIN_BRANCH" \
  npx --yes --package="./$TARBALL" next-version-helper --version --cwd "$TMP_REPO" --main-branch "$MAIN_BRANCH"

  GITHUB_REF="refs/heads/$CURRENT_BRANCH" \
  GITHUB_REF_NAME="$CURRENT_BRANCH" \
  GITHUB_HEAD_REF="$CURRENT_BRANCH" \
  GITHUB_BASE_REF="$MAIN_BRANCH" \
  npx --yes --package="./$TARBALL" next-version-helper --cwd "$TMP_REPO" --main-branch "$MAIN_BRANCH"

  GITHUB_REF="refs/heads/$CURRENT_BRANCH" \
  GITHUB_REF_NAME="$CURRENT_BRANCH" \
  GITHUB_HEAD_REF="$CURRENT_BRANCH" \
  GITHUB_BASE_REF="$MAIN_BRANCH" \
  npx --yes --package="./$TARBALL" next-version-helper --release --cwd "$TMP_REPO" --main-branch "$MAIN_BRANCH"
)
