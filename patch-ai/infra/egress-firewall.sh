#!/usr/bin/env bash
# Defense in depth for the live-target network. Docker's --internal flag
# already removes the route to the internet; these rules additionally ensure
# containers on 172.30.0.0/24 can reach nothing on the host except the egress
# guard proxy port, and never the cloud metadata service.
set -euo pipefail

SUBNET="172.30.0.0/24"
GATEWAY="172.30.0.1"
PROXY_PORT="${EGRESS_PROXY_PORT:-3128}"

iptables -N PATCHAI_EGRESS 2>/dev/null || iptables -F PATCHAI_EGRESS
iptables -A PATCHAI_EGRESS -d "$GATEWAY" -p tcp --dport "$PROXY_PORT" -j ACCEPT
iptables -A PATCHAI_EGRESS -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
iptables -A PATCHAI_EGRESS -j REJECT
iptables -C INPUT -s "$SUBNET" -j PATCHAI_EGRESS 2>/dev/null || iptables -I INPUT -s "$SUBNET" -j PATCHAI_EGRESS
iptables -C FORWARD -s "$SUBNET" -j REJECT 2>/dev/null || iptables -I FORWARD -s "$SUBNET" -j REJECT
iptables -C OUTPUT -d 169.254.169.254 -m owner ! --uid-owner 0 -j REJECT 2>/dev/null \
  || iptables -I OUTPUT -d 169.254.169.254 -m owner ! --uid-owner 0 -j REJECT
echo "egress firewall installed for $SUBNET (proxy $GATEWAY:$PROXY_PORT)"
