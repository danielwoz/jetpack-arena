#!/bin/bash
# Promote a tagged version to the stable server (game.mynet.lol).
# Usage: scripts/release.sh v1.1
# The dev server (game-dev.mynet.lol) always runs the working tree.
set -euo pipefail
TAG="${1:?usage: release.sh <tag>}"
STABLE=/home/danielwoz/webfps-stable

git tag "$TAG" 2>/dev/null || true
git push origin main "$TAG"

cd "$STABLE"
git fetch origin --tags
git checkout -q "$TAG"
npm ci --silent
npm run build
sudo systemctl restart webfps
echo "stable is now $TAG"
