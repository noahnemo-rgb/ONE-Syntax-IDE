export const SCANNER_USER_AGENT = "PatchAI-Scanner/1.0 (+https://patch.ai/security)";
export const VERIFIER_USER_AGENT = "PatchAI-Verifier/1.0 (+https://patch.ai/security)";

export function scannerEgressIps(): string[] {
  return (process.env.SCANNER_EGRESS_IPS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
