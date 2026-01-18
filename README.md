# semantic-release-next-version

This library calculates the next `semantic-release` version in **dry-run mode**.
It does not push tags and does not need GitHub or npm tokens.

You can use it in CI and on your local machine to set a version before packaging
(for example before building binaries, VSIX files, ZIPs, etc.).

---

## Why this exists

`semantic-release` is very good at deciding when to bump `major.minor.patch`,
based on conventional commits. But normally it needs credentials and it will try
to push tags.

This library does **only the version calculation**:

- no push
- no publish
- no tokens

Some repositories produce artifacts (binaries, VSIX, ZIPs, etc.) that need a
correct version **before** the real release job runs. On preview builds (PRs or
feature branches) the artifacts should get a preview version like:

```
x.y.z-preview-<commit>
```

GitHub Actions runs these PR builds, but we want to **limit token access** so
that builds cannot push tags or publish anything. With this library we can
compute the version safely, without loading any secrets until the actual release
job on the `main` branch.

Useful when:

- PRs need preview artifacts
- CI should not have push/publish permissions
- You want strict token separation between build and release steps
- You only want to load secrets in the final release job

---

## Requirements

- The repo must have full git history and tags (`fetch-depth: 0` in CI).
- Conventional commits (`feat:`, `fix:`, etc.).
- Node.js 20 or newer.
- Peer deps installed in your project:
  - `semantic-release` (>=25 <26)
  - `@semantic-release/commit-analyzer`

---

## Install

```sh
npm install semantic-release-next-version
```

---

## Usage (CI example)

Here is how it works today in GitHub Actions:

```yaml
jobs:
  determine-version:
    runs-on: ubuntu-latest
    outputs:
      version: ${{ steps.get_version.outputs.version }}
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: actions/setup-node@v4
        with:
          node-version: 22.x
          cache: npm

      - run: npm ci

      - name: Get Next Version
        id: get_version
        run: |
          set -euo pipefail
          MODE=""
          if [ "${{ github.ref }}" = "refs/heads/main" ]; then MODE="--release"; fi
          VERSION=$(npx next-version-helper $MODE)
          if [ -z "$VERSION" ]; then
            echo "semantic-release did not return a next version." >&2
            exit 1
          fi
          echo "version=$VERSION" >> "$GITHUB_OUTPUT"
```

Now other jobs can use the version:

```yaml
- name: Set Version in Package
  run: |
    VERSION="${{ needs.determine-version.outputs.version }}"
    npm version "$VERSION" --no-git-tag-version
```

---

## Usage (Local)

```sh
npx next-version-helper
# → 0.4.0-preview-abc1234 (default preview mode)

npx next-version-helper --release
# → 0.4.0

# When you run from outside the repo (e.g. a packed tarball):
npx next-version-helper --cwd /path/to/your/checkout --release
```

You can also call it from JS:

```js
import { getNextVersion } from 'semantic-release-next-version'

const version = await getNextVersion({
  cwd: process.cwd(),
  release: false,
  mainBranch: 'main', // override if your primary branch differs
})
console.log(version)
```

---

## CLI options

- `--release` / `-r`: return plain `x.y.z` (no preview suffix).
- `--cwd <path>`: run against a different working directory (useful when you call from a temp folder).
- `--main-branch <name>`: set the primary release branch (default: `main`).
- `--help` / `--version`

---

## Behavior

- On `main` branch with `--release` → returns `x.y.z`.
- On any branch without `--release` → returns `x.y.z-preview-<hash>`.
- If there is no new release → exits with an error
- Uses `@semantic-release/commit-analyzer` by default (must be installed).
- Main branch defaults to `main`; override with `--main-branch` or `mainBranch` in code.
- `--cwd` lets you run the CLI outside the repo root (for example after `npm pack`).

---

## Notes

- This library is **opinionated**.
- It needs conventional commits.
- It respects `GITHUB_HEAD_REF`/`GITHUB_REF_NAME` for branch detection.
- No pushing, no publishing, no credentials.

---

## License

MIT

---

## Debugging

- Enable verbose logs by setting `DEBUG=semantic-release-next-version` (optionally add `,semantic-release:*` for semantic-release internals).
- In GitHub Actions, you can set `DEBUG` in a step that runs the CLI (the CI smoke test does this).
- When running from a packed tarball or temp dir, pass `--cwd /path/to/repo` and `--main-branch <branch>` so branch detection stays correct.
