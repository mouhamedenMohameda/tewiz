#!/usr/bin/env bash
# Helper for the auto-managed SSH tunnel.
# Usage:
#   ./scripts/tunnel.sh status   # is it up?
#   ./scripts/tunnel.sh start    # force start
#   ./scripts/tunnel.sh stop     # force stop
#   ./scripts/tunnel.sh restart
#   ./scripts/tunnel.sh logs     # tail the autossh log

set -euo pipefail
PLIST="$HOME/Library/LaunchAgents/com.tewiz.tunnel.plist"
LABEL="com.tewiz.tunnel"

case "${1:-status}" in
  status)
    if launchctl list | grep -q "$LABEL"; then
      echo "✅ Tunnel chargé dans launchd"
    else
      echo "❌ Tunnel pas chargé"
    fi
    echo "--- Ports ---"
    nc -zv localhost 5432 2>&1 || true
    nc -zv localhost 6379 2>&1 || true
    ;;
  start)
    launchctl load "$PLIST" 2>/dev/null || true
    echo "Tunnel démarré"
    ;;
  stop)
    launchctl unload "$PLIST" 2>/dev/null || true
    echo "Tunnel arrêté"
    ;;
  restart)
    launchctl unload "$PLIST" 2>/dev/null || true
    sleep 1
    launchctl load "$PLIST"
    echo "Tunnel redémarré"
    ;;
  logs)
    tail -f /tmp/tewiz-tunnel.log /tmp/tewiz-tunnel.err
    ;;
  *)
    echo "Usage: $0 {status|start|stop|restart|logs}"
    exit 1
    ;;
esac
