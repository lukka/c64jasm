#!/usr/bin/env bash
set -euo pipefail

UPSTREAM_URL="git@github.com:nurpax/c64jasm.git"
LUKKA_REMOTE="lukka"

echo "=== Sync branches ==="

# ---- Add upstream remote if missing ----
if ! git remote get-url upstream &>/dev/null; then
  echo "→ Adding upstream remote: $UPSTREAM_URL"
  git remote add upstream "$UPSTREAM_URL"
else
  echo "✓ upstream remote already exists: $(git remote get-url upstream)"
fi

# ---- Fetch upstream ----
echo "→ Fetching upstream..."
git fetch upstream

# ---- Update nurpax-master from upstream/master ----
CURRENT_BRANCH="$(git branch --show-current)"
echo "→ Updating nurpax-master from upstream/master..."

git switch nurpax-master
if git merge --ff-only upstream/master; then
  echo "✓ nurpax-master fast-forwarded to $(git rev-parse --short HEAD)"
else
  echo "✗ Fast-forward failed — nurpax-master may have diverged. Aborting."
  git merge --abort 2>/dev/null || true
  git switch "$CURRENT_BRANCH"
  exit 1
fi
git switch "$CURRENT_BRANCH"

# ---- Push main to lukka ----
echo "→ Pushing main to $LUKKA_REMOTE..."
git push "$LUKKA_REMOTE" main

# ---- Push nurpax-contrib to lukka ----
echo "→ Pushing nurpax-contrib to $LUKKA_REMOTE..."
git push "$LUKKA_REMOTE" nurpax-contrib

echo "=== Done ==="
