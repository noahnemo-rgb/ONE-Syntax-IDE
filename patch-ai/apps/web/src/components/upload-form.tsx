"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Field, inputClass, Notice } from "./ui";

export function UploadForm({ repoId }: { repoId?: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    if (repoId) form.set("repoId", repoId);
    try {
      const res = await fetch("/api/uploads", { method: "POST", body: form });
      const body = await res.json().catch(() => ({ error: "Upload failed." }));
      if (!res.ok) {
        setError(body.error ?? "Upload failed.");
        if (body.repoId) router.refresh();
        return;
      }
      router.push(`/scans/${body.scanId}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {!repoId && (
        <Field label="Project name">
          <input name="name" className={inputClass} placeholder="my-service" maxLength={80} />
        </Field>
      )}
      <Field label="Source archive (.zip, up to 4 MB)" hint="Leave out node_modules, build output and large binaries.">
        <input name="archive" type="file" accept=".zip,application/zip" required className={inputClass} />
      </Field>
      {error && <Notice tone="error">{error}</Notice>}
      <Button type="submit" disabled={busy}>
        {busy ? "Uploading…" : "Upload and scan"}
      </Button>
    </form>
  );
}
