#!/usr/bin/env bash
# Starts dockerd, prepares the isolated networks and runs the worker.
set -euo pipefail

mkdir -p /data/vulndb /data/work /data/docker
dockerd --data-root /data/docker --iptables=true >/var/log/dockerd.log 2>&1 &

for _ in $(seq 1 60); do
  docker info >/dev/null 2>&1 && break
  sleep 1
done
docker info >/dev/null

# Tool containers for live-target scans join an *internal* network: it has no
# route to the internet. Their only exit is the egress guard proxy, which the
# worker binds to this network's gateway address.
if ! docker network inspect "${EGRESS_NETWORK:-patchai-egress}" >/dev/null 2>&1; then
  docker network create --internal --subnet 172.30.0.0/24 --gateway 172.30.0.1 "${EGRESS_NETWORK:-patchai-egress}"
fi
/usr/local/bin/egress-firewall.sh

SCANNER_IMAGE="${SCANNER_IMAGE:-patchai/scanner-tools:latest}"
if ! docker image inspect "$SCANNER_IMAGE" >/dev/null 2>&1; then
  docker pull "$SCANNER_IMAGE" 2>/dev/null \
    || docker build -t "$SCANNER_IMAGE" -f /app/scanner-tools/infra/Dockerfile.scanner-tools /app/scanner-tools
fi
export SCANNER_IMAGE
if [[ "${WORKER_KINDS:-code,web}" == *web* ]]; then
  docker image inspect "${ZAP_IMAGE:-ghcr.io/zaproxy/zaproxy:stable}" >/dev/null 2>&1 \
    || docker pull "${ZAP_IMAGE:-ghcr.io/zaproxy/zaproxy:stable}"
fi

export EGRESS_PROXY_BIND="${EGRESS_PROXY_BIND:-172.30.0.1}"
exec patchai-worker
