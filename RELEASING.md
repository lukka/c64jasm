# Releasing

This document describes how to publish a new version of the c64jasm VS Code extension (with the bundled core assembler).

## Prerequisites

- Push access to `lukka/c64jasm` on GitHub
- `VSCE_PAT` secret configured in repo settings (for Marketplace publish)
- `gh` CLI installed and authenticated (for `release-publish.sh`)

## Quick Release

```bash
# 1. Bump versions, vendor, commit, tag, push
./scripts/release.sh 0.10.0 0.11.0
#              core-ver ^     ^ ext-ver

# 2. Create GitHub Release (triggers publish pipeline)
./scripts/release-publish.sh v0.11.0
```

That's it. The pipeline builds the VSIX and publishes to the Marketplace.

## What `release.sh` Does

| Step | Action |
|------|--------|
| 1 | Validates you're on `main` with clean working tree |
| 2 | Bumps `package.json` (core) to specified version |
| 3 | Bumps `vscode/package.json` (extension) to specified version |
| 4 | Runs `vendor-core.js` to rebuild and pack core as `<ver>-lukka` |
| 5 | Runs `npm install` in `vscode/` to refresh lockfile |
| 6 | Commits `package.json` files + all `package-lock.json` files (lockfiles record the new vendored tarball's integrity hash and are used by CI's `npm ci`; only the tarball itself is gitignored and rebuilt by CI) |
| 7 | Creates annotated git tag `v<ext-version>` |
| 8 | Pushes `main` and tags to `lukka` remote |

> **Note:** `npm install` may print audit warnings (vulnerabilities, funding). These are informational and do not affect the release.

## What `release-publish.sh` Does

Creates a GitHub Release with auto-generated notes. This triggers the `release.yml` workflow, which:

1. Checks out the tag
2. Builds and vendors the core
3. Packages the VSIX
4. Uploads VSIX to the release
5. Publishes to VS Code Marketplace

## Manual Pipeline Trigger

You can also trigger the release pipeline manually from the GitHub Actions tab:

1. Go to **Actions** → **Release**
2. Click **Run workflow**
3. Enter the tag (e.g., `v0.11.0`)
4. Click **Run workflow**

This is useful if you already pushed the tag but need to re-run the publish.

## Version Numbering

- **Core** (`package.json`): Semantic versioning for the assembler. Bump when core features change.
- **Extension** (`vscode/package.json`): Independent versioning. Bump for any extension change (bugfix, feature, or core update).

The vendored core is packed as `<core-version>-lukka` to avoid collision with the public npm package.

## Rollback

If a release is broken:

1. Delete the GitHub Release (does not affect Marketplace)
2. Unpublish from Marketplace: `npx @vscode/vsce unpublish lukka.c64jasm-devtools <version>`
3. Delete the tag: `git push lukka :refs/tags/v<version>`
