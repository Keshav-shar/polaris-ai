"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AccountButton } from "./account-button";

// Real routes rather than tab state, so a lesson or a map can be linked to and reloaded. The mock has three
// links; the third ("My progress") arrives with the feedback feature and is not shown before its page exists,
// because a link that leads nowhere is worse than none.
const TABS = [
  { href: "/", label: "Learn" },
  { href: "/codex", label: "My library" },
] as const;

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

export function SiteHeader() {
  const pathname = usePathname();
  // A map lives at /tree/<id> and a lesson at /topic/<id>; both belong to the library.
  const inLibrary = pathname.startsWith("/tree") || pathname.startsWith("/topic");

  return (
    <header className="border-b border-rule/60">
      <div className="mx-auto flex w-full max-w-7xl flex-col items-center justify-between gap-4 px-4 py-6 sm:px-6 md:flex-row">
        <Link href="/" className="flex items-center gap-4">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-ink font-serif text-xl font-bold text-parchment shadow-sm">
            P
          </span>
          <span>
            <span className="block font-serif text-xl font-bold tracking-widest text-ink">POLARIS</span>
            <span className="block text-[10px] font-medium uppercase tracking-widest text-faint">
              Learn any topic, step by step
            </span>
          </span>
        </Link>

        <div className="flex flex-col items-center gap-4 sm:flex-row sm:gap-8">
        <nav aria-label="Primary" className="flex items-center gap-8 text-xs font-semibold uppercase tracking-widest">
          {TABS.map((tab) => {
            const active = isActive(pathname, tab.href) || (inLibrary && tab.href === "/codex");
            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={`border-b-2 pb-1 transition-colors ${
                  active ? "border-gold text-ink" : "border-transparent text-ink hover:text-gold-ink"
                }`}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>
        <AccountButton />
        </div>
      </div>
    </header>
  );
}
