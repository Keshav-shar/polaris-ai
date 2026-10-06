"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// The reference switches views with an `activeTab` state variable. Real routes instead, so a scroll or a
// constellation can be linked to and reloaded. The Sanctuary of Sages tab is deliberately absent:
// teaching agents are deferred (docs/conflicts.md C30), and a tab that leads nowhere is worse than none.
const TABS = [
  { href: "/", label: "Invoke a Tree", icon: "✦" },
  { href: "/codex", label: "Astral Codex", icon: "☾" },
] as const;

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

export function SiteHeader() {
  const pathname = usePathname();
  // A constellation lives at /tree/<id> and has no tab of its own; mark the Codex while reading one.
  const onTree = pathname.startsWith("/tree") || pathname.startsWith("/topic");

  return (
    <header className="sticky top-0 z-50 border-b border-astral-gold/30 bg-astral-950/90 px-4 py-3 shadow-lg backdrop-blur-md lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3">
        <Link href="/" className="flex items-center gap-4">
          <span className="relative flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-tr from-astral-gold via-astral-amber to-astral-blue p-[2px] shadow-gold-glow">
            <span className="flex h-full w-full items-center justify-center rounded-full bg-astral-950 font-serif text-lg font-bold tracking-tighter text-astral-gold">
              P
            </span>
          </span>
          <span>
            <span className="block bg-gradient-to-r from-astral-starlight via-astral-gold to-amber-200 bg-clip-text font-serif text-xl font-bold uppercase tracking-wider text-transparent">
              Polaris
            </span>
            <span className="block font-mono text-[10px] uppercase tracking-widest text-astral-gold/80">
              Guided Arcana &amp; Mystical Knowledge
            </span>
          </span>
        </Link>

        <nav
          aria-label="Primary"
          className="flex items-center gap-1 rounded-xl border border-astral-gold/20 bg-astral-900/80 p-1.5"
        >
          {TABS.map((tab) => {
            const active = isActive(pathname, tab.href) || (onTree && tab.href === "/codex");
            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={
                  active
                    ? "flex items-center gap-2 rounded-lg border border-astral-gold/40 bg-gradient-to-r from-astral-gold/20 to-astral-amber/20 px-4 py-1.5 font-serif text-sm text-astral-gold shadow-gold-glow"
                    : "flex items-center gap-2 rounded-lg px-4 py-1.5 font-serif text-sm text-slate-400 transition-colors hover:bg-astral-800/50 hover:text-slate-200"
                }
              >
                <span aria-hidden="true">{tab.icon}</span>
                <span>{tab.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
