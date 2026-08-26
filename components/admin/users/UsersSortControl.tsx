"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import CustomSelect, { type SelectOption } from "@/components/ui/CustomSelect";
import {
  CLIENT_SORT_OPTIONS,
  defaultDirFor,
  dirLabel,
  type ClientSortKey,
  type SortDir,
} from "@/lib/admin-client-sort";

interface UsersSortControlProps {
  sort: ClientSortKey;
  dir: SortDir;
}

export default function UsersSortControl({ sort, dir }: UsersSortControlProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const options: SelectOption[] = CLIENT_SORT_OPTIONS.map((o) => ({
    value: o.value,
    label: o.label,
  }));

  function push(nextSort: ClientSortKey, nextDir: SortDir) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("sort", nextSort);
    params.set("dir", nextDir);
    params.delete("page"); // on repart de la page 1 quand l'ordre change
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  function handleSortChange(next: string) {
    const nextSort = next as ClientSortKey;
    // Changer de critère remet le sens le plus naturel (A→Z pour la société,
    // « du plus grand » pour les compteurs, « plus récent » pour les dates).
    push(nextSort, defaultDirFor(nextSort));
  }

  function toggleDir() {
    push(sort, dir === "desc" ? "asc" : "desc");
  }

  return (
    <div className="flex flex-col sm:inline-flex sm:flex-row sm:items-center gap-1.5 sm:gap-2 sm:h-10 sm:px-1 w-full sm:w-auto">
      <span className="text-[11px] font-body font-bold uppercase tracking-[0.12em] text-text-muted">
        Trier par
      </span>

      <div className="flex items-center gap-2 w-full sm:w-auto">
        <div className="flex-1 sm:flex-none sm:min-w-[200px]">
          <CustomSelect
            value={sort}
            onChange={handleSortChange}
            options={options}
            size="sm"
            aria-label="Critère de tri des clients"
          />
        </div>

        <button
          type="button"
          onClick={toggleDir}
          title={dirLabel(sort, dir)}
          aria-label={`Ordre : ${dirLabel(sort, dir)}. Cliquer pour inverser.`}
          className="shrink-0 inline-flex items-center gap-1.5 h-10 sm:h-9 px-3 rounded-lg border border-border bg-bg-primary text-[12.5px] font-body font-semibold text-text-secondary shadow-sm hover:border-border-strong hover:text-text-primary transition-colors"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.4}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            {dir === "desc" ? (
              <path d="M12 5v14M19 12l-7 7-7-7" />
            ) : (
              <path d="M12 19V5M5 12l7-7 7 7" />
            )}
          </svg>
          <span className="hidden sm:inline whitespace-nowrap">{dirLabel(sort, dir)}</span>
        </button>
      </div>
    </div>
  );
}
