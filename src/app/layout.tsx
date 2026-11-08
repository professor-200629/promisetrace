import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { currentUser } from "@/lib/session";
import { aiSetup, paypalSetup } from "@/lib/env";
import { signOutAction } from "@/app/actions";

export const metadata: Metadata = {
  title: "PromiseTrace — agree, pay, deliver, with the receipts",
  description: "Source-linked purchase briefs, PayPal sandbox checkout and requirement-by-requirement delivery checks for independent digital-service sellers.",
  referrer: "no-referrer",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  const pp = paypalSetup();
  const ai = aiSetup();
  return (
    <html lang="en">
      <body className="min-h-screen">
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:rounded focus:bg-white focus:px-3 focus:py-2">Skip to content</a>
        {(pp.state !== "ready" || ai.state !== "ready") && (
          <div role="status" className="border-b border-review/30 bg-review-bg px-4 py-2 text-center text-xs text-review">
            {pp.state === "fixture" && <strong>PAYPAL FIXTURE MODE — no PayPal calls are made; fixture payments are not transactions. </strong>}
            {pp.state === "missing_credentials" && <strong>PayPal sandbox not configured. </strong>}
            {ai.state === "fixture" && <strong>AI FIXTURE MODE — briefs are extracted by a rule-based fixture, not an AI model. </strong>}
            {ai.state === "missing_credentials" && <strong>AI not configured — briefs are entered manually. </strong>}
            <Link href="/setup" className="underline">Setup status</Link>
          </div>
        )}
        <header className="border-b border-line bg-white">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
            <Link href={user ? "/deals" : "/"} className="flex items-center gap-2 font-semibold tracking-tight">
              <span aria-hidden className="grid h-7 w-7 place-items-center rounded-md bg-ink text-[13px] text-white">PT</span>
              PromiseTrace
            </Link>
            <nav className="flex items-center gap-3 text-sm">
              {user ? (
                <>
                  <Link href="/deals" className="text-muted hover:text-ink">Agreements</Link>
                  <span className="hidden text-muted sm:inline">{user.name}</span>
                  <form action={signOutAction}>
                    <button className="rounded-md border border-line px-3 py-1.5 hover:bg-slate-50">Sign out</button>
                  </form>
                </>
              ) : (
                <>
                  <Link href="/sign-in" className="text-muted hover:text-ink">Sign in</Link>
                  <Link href="/sign-up" className="rounded-md bg-ink px-3 py-1.5 text-white">Create account</Link>
                </>
              )}
            </nav>
          </div>
        </header>
        <main id="main" className="mx-auto max-w-6xl px-4 py-8">{children}</main>
        <footer className="mx-auto max-w-6xl px-4 pb-10 text-xs leading-relaxed text-muted">
          PromiseTrace records what was agreed, paid, delivered and said. It does not hold funds, release PayPal holds, decide PayPal claims or
          guarantee PayPal Seller Protection. Sandbox demo with fictional data. <Link href="/about" className="underline">How it works and its limits</Link>
        </footer>
      </body>
    </html>
  );
}
