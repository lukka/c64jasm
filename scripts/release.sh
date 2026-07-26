#!/usr/bin/env bash
set -euo pipefail

# Release script for c64jasm fork
# Bumps versions, vendors core, commits, tags, and pushes.
#
# Usage: ./scripts/release.sh <core-version> <ext-version>
# Example: ./scripts/release.sh 0.10.0 0.11.0

if [ $# -ne 2 ]; then
  echo "Usage: $0 <core-version> <ext-version>"
  echo "Example: $0 0.10.0 0.11.0"
  exit 1
fi

CORE_VERSION="$1"
EXT_VERSION="$2"
TAG="v${EXT_VERSION}"
LUKKA_REMOTE="lukka"

echo "=== Release: core ${CORE_VERSION} / ext ${EXT_VERSION} ==="

# ---- Pre-flight checks ----
CURRENT_BRANCH="$(git branch --show-current)"
if [ "$CURRENT_BRANCH" != "main" ]; then
  echo "✗ Must be on 'main' branch (currently on '$CURRENT_BRANCH')"
  exit 1
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "✗ Working tree has uncommitted changes"
  exit 1
fi

# ---- Bump core version ----
# Idempotent: skip when already at the target version, so an unchanged core
# (common for extension-only releases) doesn't fail with "Version not changed".
CURRENT_CORE_VERSION="$(node -p "require('./package.json').version")"
if [ "$CURRENT_CORE_VERSION" = "$CORE_VERSION" ]; then
  echo "✓ Core already at ${CORE_VERSION}, skipping bump"
else
  echo "→ Bumping core version ${CURRENT_CORE_VERSION} → ${CORE_VERSION}..."
  npm version "$CORE_VERSION" --no-git-tag-version
fi

# ---- Bump extension version ----
CURRENT_EXT_VERSION="$(node -p "require('./vscode/package.json').version")"
if [ "$CURRENT_EXT_VERSION" = "$EXT_VERSION" ]; then
  echo "✓ Extension already at ${EXT_VERSION}, skipping bump"
else
  echo "→ Bumping extension version ${CURRENT_EXT_VERSION} → ${EXT_VERSION}..."
  cd vscode
  npm version "$EXT_VERSION" --no-git-tag-version
  cd ..
fi

# ---- Guard: tag must not exist yet ----
if git rev-parse "$TAG" &>/dev/null; then
  echo "✗ Tag ${TAG} already exists — pick a higher extension version"
  exit 1
fi

# ---- Re-vendor core ----
# NOTE: the vendored tarball is gitignored (rebuilt by CI from package.json).
# We still build it locally so the lockfile refresh below sees the new bytes.
echo "→ Re-vendoring core..."
node scripts/vendor-core.js

echo "→ Refreshing extension lockfile..."
cd vscode && npm install && cd ..

# ---- Commit ----
# Only commit when a version actually changed; an extension-only re-release
# at existing versions still gets tagged at the current HEAD.
if git diff --quiet && git diff --cached --quiet; then
  echo "✓ No version changes to commit"
else
  echo "→ Committing version bump..."
  # Manifests AND lockfiles are committed: the vscode lockfile records the new
  # vendored tarball's integrity hash, and the root lockfile is used by CI's
  # `npm ci`. Only the tarball itself stays uncommitted (gitignored, rebuilt
  # by CI from package.json).
  git add package.json package-lock.json \
          vscode/package.json vscode/package-lock.json \
          vscode/server/package-lock.json
  git commit -m "chore(release): core ${CORE_VERSION}, ext ${EXT_VERSION}"
fi

# ---- Tag ----
echo "→ Creating tag ${TAG}..."
git tag -a "$TAG" -m "Release ${TAG}"

# ---- Push ----
echo "→ Pushing main and tags to ${LUKKA_REMOTE}..."
git push "$LUKKA_REMOTE" main --tags

echo ""
echo "=== Done ==="
echo "Next: create a GitHub Release for tag ${TAG} to trigger publish."
echo "  gh release create ${TAG} --title \"Release ${TAG}\" --notes \"...\""
echo "Or run: ./scripts/release-publish.sh ${TAG}"
