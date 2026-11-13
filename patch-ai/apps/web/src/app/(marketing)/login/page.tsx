import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Button, Card, inputClass } from "@/components/ui";
import { auth, devLoginEnabled, signIn } from "@/lib/auth";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage() {
  const session = await auth();
  if (session?.user) redirect("/dashboard");

  async function github() {
    "use server";
    await signIn("github", { redirectTo: "/dashboard" });
  }

  async function dev(formData: FormData) {
    "use server";
    await signIn("dev", { email: formData.get("email"), redirectTo: "/dashboard" });
  }

  return (
    <section className="mx-auto max-w-md px-6 py-24">
      <Card className="p-8">
        <h1 className="text-2xl font-semibold">Sign in to Patch AI</h1>
        <p className="mt-2 text-sm text-muted">
          We use GitHub to identify you. Repository access is granted separately, repo by repo, through our GitHub
          App.
        </p>
        <form action={github} className="mt-6">
          <Button type="submit" className="w-full">
            Continue with GitHub
          </Button>
        </form>
        {devLoginEnabled() && (
          <form action={dev} className="mt-6 space-y-3 border-t border-border pt-6">
            <p className="text-xs uppercase tracking-wide text-muted">Development login</p>
            <input name="email" type="email" required placeholder="you@example.com" className={inputClass} />
            <Button type="submit" variant="secondary" className="w-full">
              Sign in with email (dev only)
            </Button>
          </form>
        )}
        <p className="mt-6 text-xs text-muted">
          By continuing you agree to the <Link href="/legal/terms" className="underline">Terms of Service</Link> and{" "}
          <Link href="/legal/acceptable-use" className="underline">Acceptable Use Policy</Link>.
        </p>
      </Card>
    </section>
  );
}
