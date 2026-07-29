"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useFilterPending } from "./FilterPendingContext";

interface SectionCounts {
  all: number;
  online: number;
  offline: number;
  draft: number;
  archived: number;
  important: number;
  createdRecent: number;
  updatedRecent: number;
}

const SECTIONS = [
  { key: "",         label: "Tous",       countKey: "all"      as const, dotColor: "" },
  { key: "ONLINE",   label: "En ligne",   countKey: "online"   as const, dotColor: "bg-[#22C55E]" },
  { key: "OFFLINE",  label: "Hors ligne", countKey: "offline"  as const, dotColor: "bg-[#9CA3AF]" },
  { key: "DRAFT",    label: "Brouillons", countKey: "draft"    as const, dotColor: "bg-[#8B5CF6]" },
  { key: "ARCHIVED", label: "Archivés",   countKey: "archived" as const, dotColor: "bg-[#F59E0B]" },
] as const;

type ShortcutKey = "important" | "createdRecent" | "updatedRecent";

interface ShortcutDef {
  urlKey: ShortcutKey;
  label: string;
  countKey: keyof SectionCounts;
  icon: (active: boolean) => React.ReactNode;
  activeTitle: string;
  inactiveTitle: string;
}

const SHORTCUTS: ShortcutDef[] = [
  {
    urlKey: "important",
    label: "Important",
    countKey: "important",
    icon: (active) => <ImportantStar filled={active} className="w-3.5 h-3.5 text-amber-400" />,
    activeTitle: "Retirer le filtre Important",
    inactiveTitle: "Afficher uniquement les Importants",
  },
  {
    urlKey: "updatedRecent",
    label: "Modifié récemment",
    countKey: "updatedRecent",
    icon: () => <PencilIcon className="w-3.5 h-3.5 text-sky-500" />,
    activeTitle: "Retirer le filtre Modifié récemment",
    inactiveTitle: "Afficher les produits modifiés dans les 30 derniers jours",
  },
  {
    urlKey: "createdRecent",
    label: "Créé récemment",
    countKey: "createdRecent",
    icon: () => <SparklesIcon className="w-3.5 h-3.5 text-violet-500" />,
    activeTitle: "Retirer le filtre Créé récemment",
    inactiveTitle: "Afficher les produits créés dans les 30 derniers jours",
  },
];

export default function ProductStatusTabs({ counts }: { counts: SectionCounts }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { startFiltering: startTransition } = useFilterPending();

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

  function toggleShortcut(urlKey: ShortcutKey) {
    const params = new URLSearchParams(searchParams.toString());
    const wasActive = params.get(urlKey) === "1";
    if (wasActive) {
      params.delete(urlKey);
    } else {
      params.set(urlKey, "1");
      // "Créé récemment" et "Modifié récemment" sont mutuellement exclusifs :
      // activer l'un désactive l'autre. "Important" reste indépendant.
      if (urlKey === "createdRecent") params.delete("updatedRecent");
      if (urlKey === "updatedRecent") params.delete("createdRecent");
    }
    params.delete("page");
    startTransition(() => {
      router.push(`/admin/produits?${params.toString()}`);
    });
  }

  return (
    <div
      className="flex items-center gap-1.5 overflow-x-auto sm:flex-wrap sm:overflow-visible pb-1 sm:pb-0 -mx-2 px-2 sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
    >
      {SECTIONS.map((s) => {
        const isActive = current === s.key;
        const count = counts[s.countKey];
        return (
          <button
            key={s.key}
            type="button"
            onClick={() => handleClick(s.key)}
            className={`group shrink-0 flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-4 py-1.5 sm:py-2.5 text-[12px] sm:text-[13px] font-body font-medium rounded-xl whitespace-nowrap transition-all duration-200 ${
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
              className={`text-[10px] sm:text-[11px] px-1 sm:px-1.5 py-0.5 rounded-md font-semibold min-w-[20px] sm:min-w-[22px] text-center tabular-nums transition-colors ${
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

      <span className="shrink-0 w-px h-6 bg-border mx-1 sm:mx-1.5" aria-hidden="true" />

      {SHORTCUTS.map((s) => {
        const isActive = searchParams.get(s.urlKey) === "1";
        const count = counts[s.countKey];
        return (
          <button
            key={s.urlKey}
            type="button"
            onClick={() => toggleShortcut(s.urlKey)}
            aria-pressed={isActive}
            title={isActive ? s.activeTitle : s.inactiveTitle}
            className={`group shrink-0 flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-4 py-1.5 sm:py-2.5 text-[12px] sm:text-[13px] font-body font-medium rounded-xl whitespace-nowrap transition-all duration-200 ${
              isActive
                ? "bg-bg-dark text-text-inverse shadow-md"
                : "bg-bg-primary text-text-secondary border border-border hover:border-border-dark hover:text-text-primary hover:shadow-sm"
            }`}
          >
            {s.icon(isActive)}
            {s.label}
            <span
              className={`text-[10px] sm:text-[11px] px-1 sm:px-1.5 py-0.5 rounded-md font-semibold min-w-[20px] sm:min-w-[22px] text-center tabular-nums transition-colors ${
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

function ImportantStar({ filled, className }: { filled: boolean; className?: string }) {
  if (filled) {
    return (
      <svg className={className} fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
        <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.286 3.956a1 1 0 00.95.69h4.161c.969 0 1.371 1.24.588 1.81l-3.366 2.446a1 1 0 00-.363 1.118l1.286 3.956c.3.922-.755 1.688-1.54 1.118l-3.366-2.446a1 1 0 00-1.176 0l-3.366 2.446c-.784.57-1.838-.196-1.539-1.118l1.286-3.956a1 1 0 00-.363-1.118L2.98 9.383c-.783-.57-.38-1.81.588-1.81h4.161a1 1 0 00.951-.69l1.286-3.956z" />
      </svg>
    );
  }
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.7}
        d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.562.562 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z"
      />
    </svg>
  );
}

function PencilIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.862 4.487zm0 0L19.5 7.125" />
    </svg>
  );
}

function SparklesIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456zM16.898 20.624L16.5 21.75l-.398-1.126a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.179-.398a2.25 2.25 0 001.423-1.423l.398-1.126.398 1.126a2.25 2.25 0 001.423 1.423l1.179.398-1.179.398a2.25 2.25 0 00-1.423 1.423z" />
    </svg>
  );
}
