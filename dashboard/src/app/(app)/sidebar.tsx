"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Image from "next/image";

interface SchoolItem {
  slug: string;
  name: string;
  logo: string;
}

export function Sidebar({
  schools,
  currentSlug,
}: {
  schools: SchoolItem[];
  currentSlug: string;
}) {
  const router = useRouter();
  const [pendingSlug, setPendingSlug] = useState<string | null>(null);

  async function selectScope(slug: string) {
    if (slug === currentSlug) return;
    setPendingSlug(slug);
    const r = await fetch("/api/school", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug }),
    });
    setPendingSlug(null);
    if (r.ok) router.refresh();
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  function ScopeButton({ item }: { item: SchoolItem }) {
    const active = item.slug === currentSlug;
    const pending = item.slug === pendingSlug;
    const disabled = pendingSlug !== null;
    return (
      <button
        onClick={() => selectScope(item.slug)}
        className={`flex items-center gap-2 text-left px-2 py-1.5 rounded text-sm transition-colors ${
          active
            ? "bg-zinc-900 text-white"
            : "hover:bg-zinc-100 text-zinc-700"
        } ${pending ? "opacity-60" : ""} ${disabled && !pending ? "opacity-40" : ""}`}
        disabled={disabled}
      >
        <span
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded bg-white p-0.5 ${
            active ? "ring-1 ring-white/40" : "ring-1 ring-zinc-200"
          }`}
        >
          <Image
            src={item.logo}
            alt=""
            width={28}
            height={28}
            className="max-h-full max-w-full object-contain"
            unoptimized
          />
        </span>
        <span className="truncate">{item.name}</span>
      </button>
    );
  }

  return (
    <aside className="w-56 bg-white border-r flex flex-col p-4 space-y-1">
      {schools.length === 0 && (
        <p className="text-xs text-zinc-500 px-2 py-2">
          Aucune école assignée. Contactez un administrateur.
        </p>
      )}
      {schools.map((s) => (
        <ScopeButton key={s.slug} item={s} />
      ))}
      <div className="flex-1" />
      <button
        onClick={logout}
        className="text-sm text-zinc-500 hover:text-zinc-900 text-left px-3 py-2"
      >
        Se déconnecter
      </button>
    </aside>
  );
}
