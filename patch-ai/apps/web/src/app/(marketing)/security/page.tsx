import type { Metadata } from "next";
import Link from "next/link";
import { scannerEgressIps, SCANNER_USER_AGENT, VERIFIER_USER_AGENT } from "@/lib/scanner-identity";

export const metadata: Metadata = { title: "Security · Patch AI" };

export default function SecurityPage() {
  const ips = scannerEgressIps();
  const securityEmail = process.env.SECURITY_CONTACT_EMAIL ?? process.env.ABUSE_CONTACT_EMAIL;
  return (
    <div className="prose-legal mx-auto max-w-3xl px-6 py-16">
      <h1>Security</h1>

      <h2>Identifying Patch AI scanners</h2>
      <p>
        Live-target scans only run against hosts whose owner proved control through a DNS record or a file on the
        site, and signed an authorization. Our scanner traffic always comes from these addresses:
      </p>
      {ips.length ? (
        <ul>
          {ips.map((ip) => (
            <li key={ip}>
              <code>{ip}</code>
            </li>
          ))}
        </ul>
      ) : (
        <p>
          <em>Scanner addresses are published here before live scanning is enabled.</em>
        </p>
      )}
      <p>
        Scanner requests send the user agent <code>{SCANNER_USER_AGENT}</code>. Ownership checks send{" "}
        <code>{VERIFIER_USER_AGENT}</code> and only fetch <code>/.well-known/patchai-verify.txt</code>.
      </p>
      <p>
        To block Patch AI, deny those addresses at your firewall, or remove the <code>_patchai-verify</code> DNS record
        or verification file: we re-check ownership before every scan and stop if it is gone.
      </p>
      <p>
        Did we scan you without permission? <Link href="/abuse">Report it</Link> and we will stop scanning the host
        immediately while we investigate.
      </p>

      <h2>How we protect customer code</h2>
      <ul>
        <li>Each code scan runs in single-use containers with no network access, a read-only filesystem, no Linux capabilities and strict CPU, memory and time limits.</li>
        <li>Uploaded archives are deleted as soon as they are extracted. Working copies are deleted after each scan.</li>
        <li>Detected secrets are redacted before they are stored and are never sent to AI models.</li>
        <li>AI triage uses zero-data-retention routing; providers do not store or train on your code.</li>
        <li>Live-target scanners can only reach the verified host at the address resolved when the scan starts.</li>
        <li>Security-relevant actions are written to an append-only audit log.</li>
      </ul>

      <h2>Reporting a vulnerability in Patch AI</h2>
      <p>
        Please report security issues in Patch AI itself
        {securityEmail ? (
          <>
            {" "}to <a href={`mailto:${securityEmail}`}>{securityEmail}</a>
          </>
        ) : (
          " to our security contact"
        )}
        . We will acknowledge within two business days. Do not run automated scanners against Patch AI, access other
        customers&apos; data, or degrade the service; good-faith research that follows these rules will not be pursued
        legally.
      </p>
    </div>
  );
}
