"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";

/**
 * Sub-navigation rendered inside /urls, /stats and /dashboards pages.
 * Single source of truth for the URLs / Stats / Mes tableaux tab styling
 * and active state.
 */
export function SubNavStats() {
  const pathname = usePathname();
  const tabs: { href: string; label: string; match: (p: string) => boolean }[] = [
    {
      href: "/urls",
      label: "URLs",
      match: (p) => p.startsWith("/urls"),
    },
    { href: "/stats", label: "Stats", match: (p) => p.startsWith("/stats") },
    {
      href: "/dashboards",
      label: "Mes tableaux",
      match: (p) => p.startsWith("/dashboards"),
    },
    {
      href: "/campaigns",
      label: "Campagnes",
      match: (p) => p.startsWith("/campaigns"),
    },
  ];

  return (
    <nav className="flex gap-2">
      {tabs.map((t) => {
        const active = t.match(pathname);
        return (
          <Link
            key={t.href}
            href={t.href}
            prefetch={false}
            className={
              active
                ? "px-3 py-1.5 rounded bg-zinc-900 text-white text-sm"
                : "px-3 py-1.5 rounded hover:bg-zinc-100 text-sm text-zinc-700"
            }
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
