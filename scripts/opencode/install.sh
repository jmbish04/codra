#!/usr/bin/env bash
# Run by the operator, not by CI/agents.
#
# Wires up the LOCAL (Mac-side) half of Codra's OpenCodeEngine setup:
#   - copies the codra-review OpenCode config into ~/.codra/opencode/
#   - copies + loads the com.codra.opencode launchd service
#   - prints the remaining manual steps (cloudflared Tunnel, Cloudflare
#     Access service token, Workers VPC, wrangler.jsonc + deploy)
#
# Does NOT touch your Cloudflare account, does NOT run cloudflared or
# wrangler deploy, and contains NO secrets. See docs/opencode-setup.md for
# the full runbook this script is a shortcut for.
#
# Idempotent: safe to re-run. Existing files are left alone unless you pass
# --force; the launchd service is unloaded/reloaded on re-run so config
# changes take effect.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_DIR="${HOME}/.codra/opencode"
CONFIG_DEST="${CONFIG_DIR}/codra-review.opencode.jsonc"
PLIST_DEST="${HOME}/Library/LaunchAgents/com.codra.opencode.plist"
FORCE=0

for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
    -h|--help)
      echo "Usage: $(basename "$0") [--force]"
      echo "  --force   overwrite an existing config/plist instead of skipping it"
      exit 0
      ;;
  esac
done

echo "== Codra OpenCode local setup =="

mkdir -p "$CONFIG_DIR"

if [[ -f "$CONFIG_DEST" && "$FORCE" -ne 1 ]]; then
  echo "-- $CONFIG_DEST already exists, skipping (use --force to overwrite)"
else
  cp "${SCRIPT_DIR}/codra-review.opencode.jsonc" "$CONFIG_DEST"
  echo "-- wrote $CONFIG_DEST"
fi

if [[ -f "$PLIST_DEST" && "$FORCE" -ne 1 ]]; then
  echo "-- $PLIST_DEST already exists, skipping (use --force to overwrite)"
else
  cp "${SCRIPT_DIR}/com.codra.opencode.plist" "$PLIST_DEST"
  echo "-- wrote $PLIST_DEST"
fi

if grep -q "FILL_ME" "$PLIST_DEST" 2>/dev/null; then
  cat <<EOF

!! $PLIST_DEST still has <FILL_ME_*> placeholders (opencode binary path,
   home directory). Edit it before loading, or launchd will fail to start
   the service.
EOF
else
  echo "-- (re)loading launchd service"
  launchctl unload "$PLIST_DEST" 2>/dev/null || true
  launchctl load "$PLIST_DEST"
  echo "-- loaded. Check: curl -s http://localhost:4096/health"
fi

cat <<'EOF'

== Next steps (manual — need your Cloudflare account) ==

This script only wired up the Mac side. Everything below is a Cloudflare
account change and is NOT run by this script or any agent — follow
docs/opencode-setup.md for the full detail on each step.

  B. cloudflared named Tunnel + Access service token
     cloudflared tunnel login
     cloudflared tunnel create codra-opencode
     cp scripts/opencode/cloudflared-config.template.yml ~/.cloudflared/config.yml
     # fill in the tunnel UUID / credentials path / public hostname
     cloudflared tunnel route dns codra-opencode <your-hostname>
     cloudflared tunnel run codra-opencode
     # then create a Cloudflare Access application (Service Auth) for that
     # hostname and generate a service token (Client ID + Secret)

  C. Workers VPC (primary transport, account-gated)
     # provision a private-network origin per Cloudflare's Workers VPC docs,
     # pointing at this Mac's OpenCode server

  D. Wire the Worker
     # in wrangler.jsonc: set OPENCODE_TUNNEL_URL, add secrets_store_secrets
     # entries for OPENCODE_ACCESS_CLIENT_ID / OPENCODE_ACCESS_CLIENT_SECRET
     # (store the service token values in Cloudflare Secrets Store first —
     # never in wrangler.jsonc or git), and the OPENCODE_VPC binding if C
     # is provisioned
     npm run types
     npm run deploy

Full detail, exact commands, and verification steps: docs/opencode-setup.md
EOF
