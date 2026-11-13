#!/usr/bin/env bash
# Installs the pinned scanner binaries into $DEST (default /usr/local/bin).
# Used by infra/Dockerfile.scanner and for local development.
set -euo pipefail

DEST="${DEST:-/usr/local/bin}"
OPENGREP_VERSION="${OPENGREP_VERSION:-v2.0.0}"
OSV_VERSION="${OSV_VERSION:-v2.7.1}"
TRIVY_VERSION="${TRIVY_VERSION:-0.76.2}"
GITLEAKS_VERSION="${GITLEAKS_VERSION:-8.30.1}"
NUCLEI_VERSION="${NUCLEI_VERSION:-3.11.1}"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$DEST"

fetch() { curl -fsSL --retry 3 -o "$2" "$1"; }

if ! command -v opengrep >/dev/null 2>&1; then
  fetch "https://github.com/opengrep/opengrep/releases/download/${OPENGREP_VERSION}/opengrep_linux_x86" "$tmp/opengrep"
  install -m 0755 "$tmp/opengrep" "$DEST/opengrep"
fi

if ! command -v osv-scanner >/dev/null 2>&1; then
  fetch "https://github.com/google/osv-scanner/releases/download/${OSV_VERSION}/osv-scanner_linux_amd64" "$tmp/osv-scanner"
  install -m 0755 "$tmp/osv-scanner" "$DEST/osv-scanner"
fi

if ! command -v trivy >/dev/null 2>&1; then
  fetch "https://github.com/aquasecurity/trivy/releases/download/v${TRIVY_VERSION}/trivy_${TRIVY_VERSION}_Linux-64bit.tar.gz" "$tmp/trivy.tgz"
  tar -xzf "$tmp/trivy.tgz" -C "$tmp" trivy
  install -m 0755 "$tmp/trivy" "$DEST/trivy"
fi

if ! command -v gitleaks >/dev/null 2>&1; then
  fetch "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz" "$tmp/gitleaks.tgz"
  tar -xzf "$tmp/gitleaks.tgz" -C "$tmp" gitleaks
  install -m 0755 "$tmp/gitleaks" "$DEST/gitleaks"
fi

if ! command -v nuclei >/dev/null 2>&1; then
  fetch "https://github.com/projectdiscovery/nuclei/releases/download/v${NUCLEI_VERSION}/nuclei_${NUCLEI_VERSION}_linux_amd64.zip" "$tmp/nuclei.zip"
  (cd "$tmp" && python3 -c "import zipfile; zipfile.ZipFile('nuclei.zip').extract('nuclei')")
  install -m 0755 "$tmp/nuclei" "$DEST/nuclei"
fi

echo "scanners installed in $DEST"
