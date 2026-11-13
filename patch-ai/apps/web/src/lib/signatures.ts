import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyGithubSignature(body: string, signature: string | null, secret: string): boolean {
  if (!signature?.startsWith("sha256=")) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(body).digest("hex"));
  const given = Buffer.from(signature.slice("sha256=".length));
  return given.length === expected.length && timingSafeEqual(given, expected);
}

function stateSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set");
  return secret;
}

/** Binds a GitHub App install round-trip to the org and user that started it, for 30 minutes. */
export function signInstallState(orgId: string, userId: string, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ o: orgId, u: userId, e: now + 30 * 60 * 1000 })).toString(
    "base64url",
  );
  const sig = createHmac("sha256", stateSecret()).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifyInstallState(
  state: string,
  now = Date.now(),
): { orgId: string; userId: string } | null {
  const [payload, sig] = state.split(".");
  if (!payload || !sig) return null;
  const expected = createHmac("sha256", stateSecret()).update(payload).digest();
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (typeof data.e !== "number" || data.e < now) return null;
    return { orgId: String(data.o), userId: String(data.u) };
  } catch {
    return null;
  }
}
