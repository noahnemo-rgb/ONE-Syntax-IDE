import Link from "next/link";
import { Logo } from "@/components/logo";
import { ButtonLink } from "@/components/ui";

export default function MarketingLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Logo />
          <nav className="flex items-center gap-6 text-sm text-muted">
            <Link href="/pricing" className="hover:text-foreground">
              Pricing
            </Link>
            <Link href="/security" className="hover:text-foreground">
              Our scanners
            </Link>
            <ButtonLink href="/dashboard" variant="secondary">
              Dashboard
            </ButtonLink>
          </nav>
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-8 text-sm text-muted">
          <span>© {new Date().getUTCFullYear()} Patch AI. Assistive security analysis; no tool finds every vulnerability.</span>
          <nav className="flex flex-wrap gap-4">
            <Link href="/legal/terms">Terms</Link>
            <Link href="/legal/acceptable-use">Acceptable use</Link>
            <Link href="/legal/privacy">Privacy</Link>
            <Link href="/legal/dpa">DPA</Link>
            <Link href="/abuse">Report abuse</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
