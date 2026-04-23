#!/usr/bin/env bash
set -euo pipefail

IFACE="${1:-eth0}"
IFB_DEV="${2:-ifb0}"
DELAY_MS="${3:-100}"
JITTER_MS="${4:-20}"
LOSS_PCT="${5:-0}"

sudo modprobe ifb numifbs=1 2>/dev/null || sudo modprobe ifb

if ! ip link show "$IFB_DEV" >/dev/null 2>&1; then
  sudo ip link add "$IFB_DEV" type ifb
fi

sudo ip link set dev "$IFB_DEV" up

sudo tc qdisc replace dev "$IFACE" root netem \
  delay "${DELAY_MS}ms" "${JITTER_MS}ms" distribution normal \
  loss "${LOSS_PCT}%"

sudo tc qdisc del dev "$IFACE" ingress 2>/dev/null || true
sudo tc qdisc add dev "$IFACE" handle ffff: ingress
sudo tc filter replace dev "$IFACE" parent ffff: protocol all u32 \
  match u32 0 0 action mirred egress redirect dev "$IFB_DEV"

sudo tc qdisc replace dev "$IFB_DEV" root netem \
  delay "${DELAY_MS}ms" "${JITTER_MS}ms" distribution normal \
  loss "${LOSS_PCT}%"

echo "已启用双向 netem: iface=$IFACE ifb=$IFB_DEV delay=${DELAY_MS}ms jitter=${JITTER_MS}ms loss=${LOSS_PCT}%"
sudo tc qdisc show dev "$IFACE"
sudo tc qdisc show dev "$IFB_DEV"
