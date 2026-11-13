export const ATTESTATION_VERSION = "2026-11-v1";

const PASSIVE = `I confirm that I am authorized by the owner of {host} to request security testing of it, that I have authority to bind {org} to this statement, and that {org} accepts the Patch AI Terms of Service and Acceptable Use Policy for this target. I understand that a passive scan sends a small number of ordinary HTTPS requests (at most a few per second) to read response headers, cookies, TLS configuration and publicly reachable pages, and does not submit attack payloads.`;

const ACTIVE = `I confirm that I am authorized in writing by the owner of {host} to perform active security testing of it, that I have authority to bind {org} to this statement, and that {org} accepts the Patch AI Terms of Service and Acceptable Use Policy for this target. I understand that an active scan sends attack payloads (for example SQL injection and cross-site scripting probes) that may create records, trigger alerts, send email, or degrade performance, and that I should run it against a staging environment or during a maintenance window. I have notified any hosting provider, CDN or third party whose terms require notice of security testing. {org} accepts responsibility for any effect of the scan on {host} and on any third-party service it calls.`;

export function attestationStatement(profile: "passive" | "active", host: string, orgName: string): string {
  return (profile === "active" ? ACTIVE : PASSIVE).replaceAll("{host}", host).replaceAll("{org}", orgName);
}
