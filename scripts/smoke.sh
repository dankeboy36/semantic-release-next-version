#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
TARBALL=""
TMP_DIR=""
TMP_REMOTE=""
TMP_REPO=""
TMP_NO_RELEASE_REPO=""
TMP_NO_RELEASE_REMOTE=""
FALLBACK_TAG=""
NO_RELEASE_HASH=""

DEFAULT_BRANCH="${GITHUB_BASE_REF:-main}"
CURRENT_BRANCH="${GITHUB_HEAD_REF:-${GITHUB_REF_NAME:-$(git -C "$ROOT_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || echo main)}}"
if [[ "$CURRENT_BRANCH" == "HEAD" || -z "$CURRENT_BRANCH" ]]; then
  CURRENT_BRANCH="$DEFAULT_BRANCH"
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
  if [[ -n "$TMP_NO_RELEASE_REPO" && -d "$TMP_NO_RELEASE_REPO" ]]; then
    rm -rf "$TMP_NO_RELEASE_REPO"
  fi
  if [[ -n "$TMP_NO_RELEASE_REMOTE" && -d "$TMP_NO_RELEASE_REMOTE" ]]; then
    rm -rf "$TMP_NO_RELEASE_REMOTE"
  fi
}
trap cleanup EXIT

export GITHUB_REF="refs/heads/$CURRENT_BRANCH"
export GITHUB_REF_NAME="$CURRENT_BRANCH"
export GITHUB_HEAD_REF="$CURRENT_BRANCH"
export GITHUB_BASE_REF="$DEFAULT_BRANCH"
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
git --git-dir "$TMP_REMOTE" symbolic-ref HEAD "refs/heads/$DEFAULT_BRANCH" >/dev/null 2>&1 || true
git -C "$TMP_REPO" remote set-url origin "$TMP_REMOTE"
git -C "$TMP_REPO" push origin "HEAD:refs/heads/$DEFAULT_BRANCH" >/dev/null 2>&1
if [[ "$CURRENT_BRANCH" != "$DEFAULT_BRANCH" ]]; then
  git -C "$TMP_REPO" push origin "HEAD:refs/heads/$CURRENT_BRANCH" >/dev/null 2>&1 || true
fi
git -C "$TMP_REPO" push origin --tags >/dev/null 2>&1 || true

node "$ROOT_DIR/bin/cli.cjs" --help
node "$ROOT_DIR/bin/cli.cjs" --version --default-branch "$DEFAULT_BRANCH"
node "$ROOT_DIR/bin/cli.cjs" --cwd "$TMP_REPO" --default-branch "$DEFAULT_BRANCH"
node "$ROOT_DIR/bin/cli.cjs" --release --cwd "$TMP_REPO" --default-branch "$DEFAULT_BRANCH"

# Validate no-release behavior:
# - preview mode returns <currentVersion>-preview-<shortSha>
# - release mode exits non-zero
TMP_NO_RELEASE_REPO="$(mktemp -d)/repo-no-release"
git clone --quiet "$ROOT_DIR" "$TMP_NO_RELEASE_REPO"
git -C "$TMP_NO_RELEASE_REPO" config user.name "smoke-test"
git -C "$TMP_NO_RELEASE_REPO" config user.email "smoke-test@example.invalid"
git -C "$TMP_NO_RELEASE_REPO" checkout -B "$CURRENT_BRANCH" >/dev/null 2>&1 || true
FALLBACK_TAG="999999.0.$(date +%s)"
git -C "$TMP_NO_RELEASE_REPO" -c tag.gpgSign=false tag -a "$FALLBACK_TAG" -m "smoke fallback tag" >/dev/null
echo "smoke-no-release-$(date +%s)" >"$TMP_NO_RELEASE_REPO/.smoke-no-release"
git -C "$TMP_NO_RELEASE_REPO" add .smoke-no-release
git -C "$TMP_NO_RELEASE_REPO" commit -m "chore: smoke no release fallback" >/dev/null
TMP_NO_RELEASE_REMOTE="$(mktemp -d)/remote-no-release.git"
git init --bare "$TMP_NO_RELEASE_REMOTE" >/dev/null
git --git-dir "$TMP_NO_RELEASE_REMOTE" symbolic-ref HEAD "refs/heads/$DEFAULT_BRANCH" >/dev/null 2>&1 || true
git -C "$TMP_NO_RELEASE_REPO" remote set-url origin "$TMP_NO_RELEASE_REMOTE"
git -C "$TMP_NO_RELEASE_REPO" push --force origin "HEAD:refs/heads/$DEFAULT_BRANCH" >/dev/null 2>&1
if [[ "$CURRENT_BRANCH" != "$DEFAULT_BRANCH" ]]; then
  git -C "$TMP_NO_RELEASE_REPO" push --force origin "HEAD:refs/heads/$CURRENT_BRANCH" >/dev/null 2>&1 || true
fi
git -C "$TMP_NO_RELEASE_REPO" push origin --tags >/dev/null 2>&1 || true
NO_RELEASE_HASH="$(git -C "$TMP_NO_RELEASE_REPO" rev-parse --short HEAD)"
NO_RELEASE_PREVIEW="$(
  node "$ROOT_DIR/bin/cli.cjs" \
    --cwd "$TMP_NO_RELEASE_REPO" \
    --default-branch "$DEFAULT_BRANCH"
)"
if [[ "$NO_RELEASE_PREVIEW" != "${FALLBACK_TAG}-preview-${NO_RELEASE_HASH}" ]]; then
  echo "Unexpected no-release preview version: $NO_RELEASE_PREVIEW" >&2
  echo "Expected: ${FALLBACK_TAG}-preview-${NO_RELEASE_HASH}" >&2
  exit 1
fi
if node "$ROOT_DIR/bin/cli.cjs" \
  --release \
  --cwd "$TMP_NO_RELEASE_REPO" \
  --default-branch "$DEFAULT_BRANCH" >/dev/null 2>&1; then
  echo "Expected --release to fail when no release commits exist." >&2
  exit 1
fi

TARBALL="$(cd "$ROOT_DIR" && npm pack --silent)"
TMP_DIR="$(mktemp -d)"
cp "$ROOT_DIR/$TARBALL" "$TMP_DIR/"

(
  cd "$TMP_DIR"
  GITHUB_REF="refs/heads/$CURRENT_BRANCH" \
  GITHUB_REF_NAME="$CURRENT_BRANCH" \
  GITHUB_HEAD_REF="$CURRENT_BRANCH" \
  GITHUB_BASE_REF="$DEFAULT_BRANCH" \
  npx --yes --package="./$TARBALL" next-version-helper --version --cwd "$TMP_REPO" --default-branch "$DEFAULT_BRANCH"

  GITHUB_REF="refs/heads/$CURRENT_BRANCH" \
  GITHUB_REF_NAME="$CURRENT_BRANCH" \
  GITHUB_HEAD_REF="$CURRENT_BRANCH" \
  GITHUB_BASE_REF="$DEFAULT_BRANCH" \
  npx --yes --package="./$TARBALL" next-version-helper --cwd "$TMP_REPO" --default-branch "$DEFAULT_BRANCH"

  GITHUB_REF="refs/heads/$CURRENT_BRANCH" \
  GITHUB_REF_NAME="$CURRENT_BRANCH" \
  GITHUB_HEAD_REF="$CURRENT_BRANCH" \
  GITHUB_BASE_REF="$DEFAULT_BRANCH" \
  npx --yes --package="./$TARBALL" next-version-helper --release --cwd "$TMP_REPO" --default-branch "$DEFAULT_BRANCH"

  NO_RELEASE_PREVIEW_PACKAGED="$(
    GITHUB_REF="refs/heads/$CURRENT_BRANCH" \
    GITHUB_REF_NAME="$CURRENT_BRANCH" \
    GITHUB_HEAD_REF="$CURRENT_BRANCH" \
    GITHUB_BASE_REF="$DEFAULT_BRANCH" \
    npx --yes --package="./$TARBALL" next-version-helper \
      --cwd "$TMP_NO_RELEASE_REPO" \
      --default-branch "$DEFAULT_BRANCH"
  )"
  if [[ "$NO_RELEASE_PREVIEW_PACKAGED" != "${FALLBACK_TAG}-preview-${NO_RELEASE_HASH}" ]]; then
    echo "Unexpected packaged no-release preview version: $NO_RELEASE_PREVIEW_PACKAGED" >&2
    echo "Expected: ${FALLBACK_TAG}-preview-${NO_RELEASE_HASH}" >&2
    exit 1
  fi
  if GITHUB_REF="refs/heads/$CURRENT_BRANCH" \
    GITHUB_REF_NAME="$CURRENT_BRANCH" \
    GITHUB_HEAD_REF="$CURRENT_BRANCH" \
    GITHUB_BASE_REF="$DEFAULT_BRANCH" \
    npx --yes --package="./$TARBALL" next-version-helper \
      --release \
      --cwd "$TMP_NO_RELEASE_REPO" \
      --default-branch "$DEFAULT_BRANCH" >/dev/null 2>&1; then
    echo "Expected packaged --release to fail when no release commits exist." >&2
    exit 1
  fi
)
