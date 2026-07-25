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

# ---- Create release ----
echo "→ Creating GitHub Release for ${TAG}..."
gh release create "$TAG" \
  --title "Release ${TAG}" \
  --generate-notes \
  --latest

echo "✓ Release created. Pipeline will build and publish automatically."
