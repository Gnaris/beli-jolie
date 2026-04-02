"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

interface SectionCounts {
  all: number;
  online: number;
  offline: number;
  draft: number;
  archived: number;
}

const SECTIONS = [
  { key: "",         label: "Tous",       countKey: "all"      as const },
  { key: "ONLINE",   label: "En ligne",   countKey: "online"   as const },
  { key: "OFFLINE",  label: "Hors ligne", countKey: "offline"  as const },
  { key: "DRAFT",    label: "Brouillons", countKey: "draft"    as const },
  { key: "ARCHIVED", label: "Archivés",   countKey: "archived" as const },
] as const;

export default function ProductStatusTabs({ counts }: { counts: SectionCounts }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  const current = searchParams.get("status") ?? "";

  function handleClick(key: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (key) {
      params.set("status", key);
    } else {
      params.delete("status");
    }
    params.delete("page");
    startTransition(() => {
      router.push(`/admin/produits?${params.toString()}`);
    });
  }

  return (
    <div className="flex items-center gap-1 overflow-x-auto scrollbar-hide" style={{ scrollbarWidth: "none" }}>
      {SECTIONS.map((s) => {
        const isActive = current === s.key;
        const count = counts[s.countKey];
        return (
          <button
            key={s.key}
            type="button"
            onClick={() => handleClick(s.key)}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-body font-medium rounded-xl whitespace-nowrap transition-colors ${
              isActive
                ? "bg-bg-dark text-text-inverse shadow-sm"
                : "bg-bg-primary text-text-secondary border border-border hover:border-bg-dark hover:text-text-primary"
            }`}
          >
            {s.label}
            <span
              className={`text-[11px] px-1.5 py-0.5 rounded-full font-semibold min-w-[20px] text-center ${
                isActive
                  ? "bg-white/20 text-text-inverse"
                  : "bg-bg-secondary text-text-muted"
              }`}
            >
              {count}
            </span>
          </button>
        );
      })}
    </div>
  );
}
