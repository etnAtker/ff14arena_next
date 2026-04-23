#!/usr/bin/env bash
set -euo pipefail

IFACE="${1:-eth0}"
IFB_DEV="${2:-ifb0}"

sudo tc qdisc del dev "$IFACE" root 2>/dev/null || true
sudo tc qdisc del dev "$IFACE" ingress 2>/dev/null || true
sudo tc qdisc del dev "$IFB_DEV" root 2>/dev/null || true
sudo ip link set dev "$IFB_DEV" down 2>/dev/null || true

echo "已恢复双向 netem: iface=$IFACE ifb=$IFB_DEV"
sudo tc qdisc show dev "$IFACE"
sudo tc qdisc show dev "$IFB_DEV" 2>/dev/null || true
