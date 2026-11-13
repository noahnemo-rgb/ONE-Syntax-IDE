import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { Field, inputClass } from "@/components/ui";
import { submitAbuseReport } from "./actions";

export const metadata: Metadata = { title: "Report abuse · Patch AI" };

export default function AbusePage() {
  const email = process.env.ABUSE_CONTACT_EMAIL;
  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-3xl font-semibold">Report unwanted scanning</h1>
      <p className="mt-3 text-muted">
        If Patch AI scanners contacted a system you are responsible for and you did not authorize it, tell us here. We
        can stop all scanning of a host immediately while we investigate. Our scanner addresses and user agent are
        listed on the <Link href="/security" className="text-accent underline">security page</Link>.
        {email && (
          <>
            {" "}
            You can also email <a href={`mailto:${email}`} className="text-accent underline">{email}</a>.
          </>
        )}
      </p>
      <div className="mt-8 rounded-lg border border-border bg-surface p-6">
        <ActionForm action={submitAbuseReport} submitLabel="Send report">
          <Field label="Your email">
            <input name="reporterEmail" type="email" required className={inputClass} />
          </Field>
          <Field label="Affected hostname" hint="For example shop.example.com">
            <input name="affectedHost" required className={inputClass} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Source IP seen (optional)">
              <input name="sourceIp" className={inputClass} />
            </Field>
            <Field label="When (optional, with time zone)">
              <input name="observedAt" placeholder="2026-11-13 14:05 UTC" className={inputClass} />
            </Field>
          </div>
          <Field label="What happened">
            <textarea name="description" required minLength={10} rows={5} className={inputClass} />
          </Field>
          <input name="website" tabIndex={-1} autoComplete="off" aria-hidden className="hidden" />
        </ActionForm>
      </div>
    </div>
  );
}
