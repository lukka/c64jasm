#!/usr/bin/env bash
set -euo pipefail

# Create a GitHub Release to trigger the publish pipeline.
# Usage: ./scripts/release-publish.sh <tag>
# Example: ./scripts/release-publish.sh v0.11.0

if [ $# -ne 1 ]; then
  echo "Usage: $0 <tag>"
  echo "Example: $0 v0.11.0"
  exit 1
fi

TAG="$1"

# ---- Pre-flight ----
if ! git rev-parse "$TAG" &>/dev/null; then
  echo "✗ Tag '$TAG' does not exist"
  exit 1
fi

if ! command -v gh &>/dev/null; then
  echo "✗ GitHub CLI (gh) not installed."
  echo "  Install: brew install gh && gh auth login"
  exit 1
fi

if ! gh auth status &>/dev/null; then
  echo "✗ gh is not authenticated. Run: gh auth login"
  exit 1
fi

# ---- Create release ----
# -R pins the repo explicitly: this fork has two remotes (origin + lukka)
# pointing at the same place, so gh cannot infer a default.
echo "→ Creating GitHub Release for ${TAG}..."
gh release create "$TAG" \
  --repo lukka/c64jasm \
  --title "Release ${TAG}" \
  --generate-notes \
  --latest

echo "✓ Release created. Pipeline will build and publish automatically."
