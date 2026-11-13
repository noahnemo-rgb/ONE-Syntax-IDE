"use client";

import { useActionState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Button, Notice } from "./ui";

type State = { error?: string; ok?: string } | undefined;

function Submit({ children, variant }: { children: ReactNode; variant?: "primary" | "secondary" | "danger" }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} disabled={pending}>
      {pending ? "Working…" : children}
    </Button>
  );
}

/** A form bound to a server action that returns `{ error }` or `{ ok }`. */
export function ActionForm({
  action,
  submitLabel,
  variant,
  children,
  className,
}: {
  action: (state: State, formData: FormData) => Promise<State>;
  submitLabel: ReactNode;
  variant?: "primary" | "secondary" | "danger";
  children?: ReactNode;
  className?: string;
}) {
  const [state, formAction] = useActionState(action, undefined);
  return (
    <form action={formAction} className={className ?? "space-y-4"}>
      {children}
      {state?.error && <Notice tone="error">{state.error}</Notice>}
      {state?.ok && <Notice tone="success">{state.ok}</Notice>}
      <Submit variant={variant}>{submitLabel}</Submit>
    </form>
  );
}
