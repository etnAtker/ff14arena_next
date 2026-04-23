#!/usr/bin/env bash
set -euo pipefail

IFACE="${1:-lo}"
DELAY_MS="${2:-100}"
JITTER_MS="${3:-20}"
LOSS_PCT="${4:-0}"

sudo tc qdisc replace dev "$IFACE" root netem \
  delay "${DELAY_MS}ms" "${JITTER_MS}ms" distribution normal \
  loss "${LOSS_PCT}%"

echo "已启用 netem: iface=$IFACE delay=${DELAY_MS}ms jitter=${JITTER_MS}ms loss=${LOSS_PCT}%"
sudo tc qdisc show dev "$IFACE"
