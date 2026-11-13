import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP } from "node:net";
import { VERIFIER_USER_AGENT } from "./scanner-identity";

const blocked = new BlockList();
// IPv4 ranges that must never be scanned or fetched: private, loopback,
// link-local (incl. cloud metadata 169.254.169.254), CGNAT, multicast, reserved.
for (const [net, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blocked.addSubnet(net, prefix, "ipv4");
}
for (const [net, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["::ffff:0:0", 96],
  ["64:ff9b::", 96],
  ["100::", 64],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  blocked.addSubnet(net, prefix, "ipv6");
}

export function isPublicIp(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return !blocked.check(ip, "ipv4");
  if (family === 6) {
    const mapped = ip.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return !blocked.check(mapped[1], "ipv4");
    return !blocked.check(ip, "ipv6");
  }
  return false;
}

const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;
const RESERVED_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".intranet",
  ".lan",
  ".home",
  ".corp",
  ".test",
  ".example",
  ".invalid",
  ".onion",
  ".arpa",
];

/**
 * Normalizes user input (a hostname or URL) to a bare lowercase hostname, or
 * returns null if it is not a public DNS name. IP literals are rejected because
 * ownership of an IP address cannot be verified by DNS or a well-known file.
 */
export function normalizeHostname(input: string): string | null {
  let value = input.trim().toLowerCase();
  if (!value) return null;
  if (value.includes("://")) {
    try {
      value = new URL(value).hostname;
    } catch {
      return null;
    }
  }
  value = value.replace(/\.$/, "");
  if (value.length > 253 || isIP(value) || value.startsWith("[")) return null;
  if (value === "localhost" || RESERVED_SUFFIXES.some((s) => value.endsWith(s))) return null;
  const labels = value.split(".");
  if (labels.length < 2 || !labels.every((l) => LABEL.test(l))) return null;
  if (/^\d+$/.test(labels[labels.length - 1])) return null;
  return value;
}

export async function resolvePublicAddresses(hostname: string): Promise<string[]> {
  const records = await lookup(hostname, { all: true, verbatim: true });
  const addresses = records.map((r) => r.address);
  if (addresses.length === 0) throw new Error(`${hostname} does not resolve`);
  const nonPublic = addresses.filter((a) => !isPublicIp(a));
  if (nonPublic.length > 0) {
    throw new Error(`${hostname} resolves to a non-public address (${nonPublic.join(", ")})`);
  }
  return addresses;
}

/**
 * Fetches a small text document over HTTPS from a public host. The connection
 * is pinned to an address that was checked to be public (no DNS rebinding),
 * redirects are not followed, and the body is capped.
 */
export async function safeFetchText(
  hostname: string,
  path: string,
  { timeoutMs = 5000, maxBytes = 4096 } = {},
): Promise<{ status: number; body: string }> {
  const [address] = await resolvePublicAddresses(hostname);
  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      {
        host: hostname,
        servername: hostname,
        path,
        method: "GET",
        timeout: timeoutMs,
        headers: { "user-agent": VERIFIER_USER_AGENT },
        lookup: (_host, _opts, cb) => cb(null, address, isIP(address)),
      },
      (res) => {
        let size = 0;
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxBytes) {
            req.destroy(new Error("response too large"));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }),
        );
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new Error("request timed out")));
    req.on("error", reject);
    req.end();
  });
}
