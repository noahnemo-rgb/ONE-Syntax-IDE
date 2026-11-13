import { resolveTxt } from "node:dns/promises";
import { safeFetchText } from "./net";

export const VERIFICATION_TTL_DAYS = 30;
export const DNS_RECORD_PREFIX = "_patchai-verify";
export const WELL_KNOWN_PATH = "/.well-known/patchai-verify.txt";

export function newVerificationToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Buffer.from(bytes).toString("base64url");
}

export function expectedRecordValue(token: string): string {
  return `patchai-verify=${token}`;
}

export function dnsRecordName(hostname: string): string {
  return `${DNS_RECORD_PREFIX}.${hostname}`;
}

/** TXT records may be split into multiple strings; join each record first. */
export function txtRecordsContain(records: string[][], token: string): boolean {
  const expected = expectedRecordValue(token);
  return records.some((chunks) => chunks.join("").trim() === expected);
}

export function wellKnownBodyMatches(body: string, token: string): boolean {
  return body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .includes(expectedRecordValue(token));
}

export type VerificationResult =
  | { ok: true; method: "dns" | "http" }
  | { ok: false; reason: string };

export async function verifyOwnership(hostname: string, token: string): Promise<VerificationResult> {
  const reasons: string[] = [];
  try {
    const records = await resolveTxt(dnsRecordName(hostname));
    if (txtRecordsContain(records, token)) return { ok: true, method: "dns" };
    reasons.push(`TXT record ${dnsRecordName(hostname)} does not contain the token`);
  } catch (err) {
    reasons.push(`DNS lookup of ${dnsRecordName(hostname)} failed (${(err as Error).message})`);
  }
  try {
    const res = await safeFetchText(hostname, WELL_KNOWN_PATH);
    if (res.status === 200 && wellKnownBodyMatches(res.body, token)) {
      return { ok: true, method: "http" };
    }
    reasons.push(`https://${hostname}${WELL_KNOWN_PATH} returned ${res.status} without the token`);
  } catch (err) {
    reasons.push(`Fetching https://${hostname}${WELL_KNOWN_PATH} failed (${(err as Error).message})`);
  }
  return { ok: false, reason: reasons.join("; ") };
}

export function isVerificationCurrent(target: {
  verifiedAt: Date | null;
  verificationExpiresAt: Date | null;
}): boolean {
  return Boolean(
    target.verifiedAt && target.verificationExpiresAt && target.verificationExpiresAt > new Date(),
  );
}
