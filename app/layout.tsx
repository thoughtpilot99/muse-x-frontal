import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import { missingKeys } from "@/lib/config";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Churn Radar",
  description: "See which agency clients are about to churn, weeks before the cancellation email. Slack, calls and campaign results, read by Muse Wonder.",
};

const NAV = [
  { href: "/", label: "Clients" },
  { href: "/clients/new", label: "Add client" },
  { href: "/digest", label: "Weekly digest" },
  { href: "/events", label: "Events" },
  { href: "/settings", label: "Settings" },
  { href: "/setup", label: "Setup" },
];

export default function RootLayout({ children }: LayoutProps<"/">) {
  const missing = missingKeys();
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full">
        <header className="border-b border-line bg-panel">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
            <Link href="/" className="font-semibold">
              Churn <span className="text-accent">Radar</span>
            </Link>
            <nav className="flex flex-wrap gap-4 text-sm text-muted">
              {NAV.map((n) => (
                <Link key={n.href} href={n.href} className="hover:text-foreground">
                  {n.label}
                </Link>
              ))}
            </nav>
          </div>
        </header>
        {missing.length > 0 && (
          <div className="border-b border-amber-500/40 bg-amber-500/10">
            <div className="mx-auto max-w-6xl px-4 py-2 text-sm">
              <strong>Not connected yet:</strong> {missing.map((m) => m.label).join(", ")}. Add keys on the{" "}
              <Link href="/setup" className="underline">Setup</Link> page.
            </div>
          </div>
        )}
        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
