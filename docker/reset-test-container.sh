#!/bin/bash
# Disposable script for resetting the als-test OrbStack container.
# Run from the host machine. Not committed to the repo.
set -euo pipefail

echo "Deleting als-test..."
orbctl delete als-test --force 2>/dev/null || true

echo "Creating fresh Ubuntu Noble machine..."
orbctl create ubuntu:noble als-test

echo "Installing base deps..."
ssh als-test@orb "sudo apt-get update -qq && sudo apt-get install -y -qq unzip git curl jq > /dev/null 2>&1"

echo "Installing Bun..."
ssh als-test@orb "curl -fsSL https://bun.sh/install | bash 2>&1 | tail -1"

echo "Installing Claude Code..."
ssh als-test@orb "curl -fsSL https://claude.ai/install.sh | bash 2>&1 | tail -1"

echo ""
echo "Ready. SSH in with:"
echo "  ssh als-test@orb"
echo ""
echo "Then run claude, add marketplace (nfrith/als), install plugin, test /als:new"
