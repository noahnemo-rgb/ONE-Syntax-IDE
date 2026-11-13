import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { isPublicIp, normalizeHostname } from "@/lib/net";
import { signInstallState, verifyGithubSignature, verifyInstallState } from "@/lib/signatures";
import { checkZipArchive, MAX_UPLOAD_BYTES, sanitizeProjectName } from "@/lib/uploads";
import {
  dnsRecordName,
  expectedRecordValue,
  isVerificationCurrent,
  newVerificationToken,
  txtRecordsContain,
  wellKnownBodyMatches,
} from "@/lib/verification";

describe("GitHub webhook signatures", () => {
  const body = JSON.stringify({ action: "deleted" });
  const sign = (secret: string) => "sha256=" + createHmac("sha256", secret).update(body).digest("hex");

  it("accepts a valid signature", () => {
    expect(verifyGithubSignature(body, sign("s3cret"), "s3cret")).toBe(true);
  });
  it("rejects a wrong secret, a missing header and a bare hex digest", () => {
    expect(verifyGithubSignature(body, sign("other"), "s3cret")).toBe(false);
    expect(verifyGithubSignature(body, null, "s3cret")).toBe(false);
    expect(verifyGithubSignature(body, sign("s3cret").slice(7), "s3cret")).toBe(false);
  });
});

describe("GitHub App install state", () => {
  it("round-trips and expires after 30 minutes", () => {
    const now = Date.now();
    const state = signInstallState("org-1", "user-1", now);
    expect(verifyInstallState(state, now)).toEqual({ orgId: "org-1", userId: "user-1" });
    expect(verifyInstallState(state, now + 31 * 60 * 1000)).toBeNull();
  });
  it("rejects tampering", () => {
    const state = signInstallState("org-1", "user-1");
    const [, sig] = state.split(".");
    const forged = Buffer.from(JSON.stringify({ o: "org-2", u: "user-1", e: Date.now() + 1e6 })).toString("base64url");
    expect(verifyInstallState(`${forged}.${sig}`)).toBeNull();
    expect(verifyInstallState("garbage")).toBeNull();
  });
});

describe("target hostnames", () => {
  it.each([
    ["https://App.Example.com/path?q=1", "app.example.com"],
    ["shop.example.co.uk.", "shop.example.co.uk"],
  ])("normalizes %s", (input, expected) => {
    expect(normalizeHostname(input)).toBe(expected);
  });
  it.each(["localhost", "10.0.0.1", "[::1]", "printer.local", "db.internal", "example", "a..b.com", "-bad.com", "x.123"])(
    "rejects %s",
    (input) => {
      expect(normalizeHostname(input)).toBeNull();
    },
  );
  it.each([
    ["8.8.8.8", true],
    ["10.1.2.3", false],
    ["172.16.0.1", false],
    ["192.168.1.1", false],
    ["127.0.0.1", false],
    ["169.254.169.254", false],
    ["100.64.0.1", false],
    ["::1", false],
    ["fd00::1", false],
    ["::ffff:127.0.0.1", false],
    ["2606:4700:4700::1111", true],
  ])("isPublicIp(%s) = %s", (ip, expected) => {
    expect(isPublicIp(ip)).toBe(expected);
  });
});

describe("ownership verification", () => {
  const token = newVerificationToken();
  it("generates unguessable tokens", () => {
    expect(token).toMatch(/^[\w-]{32}$/);
    expect(newVerificationToken()).not.toBe(token);
  });
  it("matches TXT records split into chunks", () => {
    const value = expectedRecordValue(token);
    expect(txtRecordsContain([["v=spf1 -all"], [value.slice(0, 10), value.slice(10)]], token)).toBe(true);
    expect(txtRecordsContain([[`${value}x`]], token)).toBe(false);
    expect(dnsRecordName("app.example.com")).toBe("_patchai-verify.app.example.com");
  });
  it("matches the well-known file line by line only", () => {
    expect(wellKnownBodyMatches(`# comment\r\n${expectedRecordValue(token)}\n`, token)).toBe(true);
    expect(wellKnownBodyMatches(`<p>${expectedRecordValue(token)}</p>`, token)).toBe(false);
  });
  it("expires", () => {
    const past = new Date(Date.now() - 1000);
    const future = new Date(Date.now() + 1000);
    expect(isVerificationCurrent({ verifiedAt: past, verificationExpiresAt: future })).toBe(true);
    expect(isVerificationCurrent({ verifiedAt: past, verificationExpiresAt: past })).toBe(false);
    expect(isVerificationCurrent({ verifiedAt: null, verificationExpiresAt: future })).toBe(false);
  });
});

describe("uploads", () => {
  const zip = (body: number[]) =>
    new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...body, 0x50, 0x4b, 0x05, 0x06, ...new Array(18).fill(0)]);
  it("accepts a well-formed zip", () => {
    expect(checkZipArchive(zip([1, 2, 3]))).toEqual({ ok: true });
  });
  it("rejects empty, non-zip, truncated and oversized archives", () => {
    expect(checkZipArchive(new Uint8Array())).toMatchObject({ ok: false });
    expect(checkZipArchive(new TextEncoder().encode("not a zip at all"))).toMatchObject({ ok: false });
    expect(checkZipArchive(zip([1]).slice(0, 10))).toMatchObject({ ok: false, error: expect.stringContaining("truncated") });
    expect(checkZipArchive(new Uint8Array(MAX_UPLOAD_BYTES + 1))).toMatchObject({ ok: false });
  });
  it("sanitizes project names", () => {
    expect(sanitizeProjectName("<script>my-app</script>", "x")).toBe("scriptmy-appscript");
    expect(sanitizeProjectName("../../", "fallback")).toBe("....");
    expect(sanitizeProjectName("   ", "fallback")).toBe("fallback");
  });
});
