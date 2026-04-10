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
  { key: "",         label: "Tous",       countKey: "all"      as const, dotColor: "" },
  { key: "ONLINE",   label: "En ligne",   countKey: "online"   as const, dotColor: "bg-[#22C55E]" },
  { key: "OFFLINE",  label: "Hors ligne", countKey: "offline"  as const, dotColor: "bg-[#9CA3AF]" },
  { key: "DRAFT",    label: "Brouillons", countKey: "draft"    as const, dotColor: "bg-[#8B5CF6]" },
  { key: "ARCHIVED", label: "Archivés",   countKey: "archived" as const, dotColor: "bg-[#F59E0B]" },
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
    <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-hide" style={{ scrollbarWidth: "none" }}>
      {SECTIONS.map((s) => {
        const isActive = current === s.key;
        const count = counts[s.countKey];
        return (
          <button
            key={s.key}
            type="button"
            onClick={() => handleClick(s.key)}
            className={`group flex items-center gap-2 px-4 py-2.5 text-[13px] font-body font-medium rounded-xl whitespace-nowrap transition-all duration-200 ${
              isActive
                ? "bg-bg-dark text-text-inverse shadow-md"
                : "bg-bg-primary text-text-secondary border border-border hover:border-border-dark hover:text-text-primary hover:shadow-sm"
            }`}
          >
            {s.dotColor && (
              <span className={`w-2 h-2 rounded-full ${s.dotColor} ${isActive ? "opacity-100" : "opacity-60 group-hover:opacity-100"} transition-opacity`} />
            )}
            {s.label}
            <span
              className={`text-[11px] px-1.5 py-0.5 rounded-md font-semibold min-w-[22px] text-center tabular-nums transition-colors ${
                isActive
                  ? "bg-white/20 text-text-inverse"
                  : "bg-bg-tertiary text-text-muted group-hover:bg-bg-secondary"
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
