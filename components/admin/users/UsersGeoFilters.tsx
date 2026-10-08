"use client";

/**
 * Filtres géographiques pour la liste des clients inscrits.
 *
 *  1. Chips de zone (France métropole / DOM-TOM / UE hors France / International)
 *     — single-select, un clic sur une zone active bascule entre « ON » et « OFF ».
 *
 *  2. Bouton multi-sélection « Pays » qui ouvre un popover listant uniquement
 *     les pays où au moins un client est enregistré (counts côté serveur).
 *     Supporte recherche + checkbox + « Tout effacer ».
 *
 * Les deux filtres poussent `?zone=…` et `?countries=FR,BE,…` dans l'URL et
 * se combinent côté serveur (AND).
 */

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { countryFlagUrl, countryName } from "@/lib/countries";
import {
  CLIENT_GEO_ZONES,
  type ClientGeoZone,
} from "@/lib/admin-client-geo-filter";

export type CountryStat = { code: string; count: number };

type Props = {
  currentZone: ClientGeoZone | null;
  selectedCountries: string[];
  availableCountries: CountryStat[];
};

export default function UsersGeoFilters({
  currentZone,
  selectedCountries,
  availableCountries,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function pushParams(mutate: (p: URLSearchParams) => void) {
    const params = new URLSearchParams(searchParams.toString());
    mutate(params);
    params.delete("page");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  function toggleZone(zone: ClientGeoZone) {
    pushParams((p) => {
      if (currentZone === zone) p.delete("zone");
      else p.set("zone", zone);
    });
  }

  function toggleCountry(code: string) {
    pushParams((p) => {
      const set = new Set(selectedCountries);
      if (set.has(code)) set.delete(code);
      else set.add(code);
      if (set.size === 0) p.delete("countries");
      else p.set("countries", Array.from(set).join(","));
    });
  }

  function clearCountries() {
    pushParams((p) => p.delete("countries"));
  }

  const selectedSet = new Set(selectedCountries);
  const hasSelection = selectedCountries.length > 0 || currentZone !== null;

  function clearAll() {
    pushParams((p) => {
      p.delete("zone");
      p.delete("countries");
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {CLIENT_GEO_ZONES.map((zone) => {
        const isActive = currentZone === zone.value;
        return (
          <button
            key={zone.value}
            type="button"
            onClick={() => toggleZone(zone.value)}
            className={`inline-flex items-center gap-2 px-3.5 py-2 text-[13px] font-body font-medium rounded-xl border transition-all ${
              isActive
                ? "bg-gradient-to-br from-sky-600 to-sky-700 border-sky-600 text-white shadow-sm"
                : "bg-bg-primary border-border text-text-secondary hover:border-border-strong hover:text-text-primary"
            }`}
          >
            {zone.label}
          </button>
        );
      })}

      <CountryMultiSelect
        selectedCountries={selectedCountries}
        selectedSet={selectedSet}
        availableCountries={availableCountries}
        onToggle={toggleCountry}
        onClear={clearCountries}
      />

      {hasSelection && (
        <button
          type="button"
          onClick={clearAll}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-[12px] font-body font-medium text-text-muted hover:text-text-primary transition-colors"
          title="Retirer les filtres géographiques"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round">
            <path d="M6 6l12 12M6 18L18 6" />
          </svg>
          Effacer
        </button>
      )}
    </div>
  );
}

function CountryMultiSelect({
  selectedCountries,
  selectedSet,
  availableCountries,
  onToggle,
  onClear,
}: {
  selectedCountries: string[];
  selectedSet: Set<string>;
  availableCountries: CountryStat[];
  onToggle: (code: string) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  // Ferme au clic extérieur ou ESC.
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      const target = e.target as Node;
      if (
        popoverRef.current &&
        !popoverRef.current.contains(target) &&
        triggerRef.current &&
        !triggerRef.current.contains(target)
      ) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Pays disponibles triés : d'abord ceux déjà sélectionnés (toujours visibles
  // même si le pays n'a plus de match côté serveur), puis par nombre de clients
  // décroissant, puis alphabétique.
  const normalizedSearch = search.trim().toLowerCase();
  const availableByCode = new Map(availableCountries.map((c) => [c.code, c.count]));
  // Ajoute les pays sélectionnés absents de la liste (count = 0) pour permettre
  // de les décocher même quand les autres filtres les excluent.
  const allCodes = new Set<string>(availableByCode.keys());
  for (const code of selectedCountries) allCodes.add(code);

  type Row = { code: string; count: number; name: string };
  const rows: Row[] = Array.from(allCodes).map((code) => ({
    code,
    count: availableByCode.get(code) ?? 0,
    name: countryName(code) || code,
  }));

  const filteredRows = normalizedSearch
    ? rows.filter(
        (r) =>
          r.name.toLowerCase().includes(normalizedSearch) ||
          r.code.toLowerCase().includes(normalizedSearch),
      )
    : rows;

  filteredRows.sort((a, b) => {
    const aSel = selectedSet.has(a.code) ? 1 : 0;
    const bSel = selectedSet.has(b.code) ? 1 : 0;
    if (aSel !== bSel) return bSel - aSel;
    if (b.count !== a.count) return b.count - a.count;
    return a.name.localeCompare(b.name, "fr");
  });

  const selCount = selectedCountries.length;

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center gap-2 px-3.5 py-2 text-[13px] font-body font-medium rounded-xl border transition-all ${
          selCount > 0
            ? "bg-gradient-to-br from-text-primary to-text-secondary border-text-primary text-white shadow-sm"
            : "bg-bg-primary border-border text-text-secondary hover:border-border-strong hover:text-text-primary"
        }`}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2z" />
          <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
        </svg>
        Pays
        {selCount > 0 && (
          <span className="inline-flex items-center justify-center min-w-[22px] h-5 px-1.5 rounded-full text-[11px] font-semibold bg-white/20">
            {selCount}
          </span>
        )}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" className={open ? "rotate-180 transition-transform" : "transition-transform"}>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div
          ref={popoverRef}
          className="absolute left-0 top-full mt-2 w-80 rounded-2xl bg-bg-primary border border-border shadow-xl z-30 overflow-hidden"
        >
          <div className="p-3 border-b border-border">
            <div className="relative">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round">
                  <circle cx="11" cy="11" r="7" />
                  <path d="M21 21l-4-4" />
                </svg>
              </span>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Rechercher un pays…"
                aria-label="Rechercher un pays"
                className="pl-8 pr-2 py-1.5 h-9 w-full rounded-lg bg-bg-secondary border border-border text-[13px] font-body text-text-primary placeholder:text-text-muted focus:outline-none focus:border-border-strong"
                autoFocus
              />
            </div>
          </div>

          <div className="max-h-80 overflow-y-auto py-1">
            {filteredRows.length === 0 ? (
              <p className="px-4 py-6 text-center text-[12px] font-body text-text-muted">
                Aucun pays trouvé.
              </p>
            ) : (
              filteredRows.map((row) => {
                const checked = selectedSet.has(row.code);
                const label = row.name;
                return (
                  <button
                    key={row.code}
                    type="button"
                    onClick={() => onToggle(row.code)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 text-[13px] font-body text-left transition-colors ${
                      checked ? "bg-sky-50 hover:bg-sky-100" : "hover:bg-bg-secondary"
                    }`}
                  >
                    <span
                      className={`inline-flex items-center justify-center w-4 h-4 rounded-[4px] border transition-colors shrink-0 ${
                        checked
                          ? "bg-sky-600 border-sky-600 text-white"
                          : "bg-bg-primary border-border"
                      }`}
                    >
                      {checked && (
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round">
                          <path d="M5 12l5 5L20 7" />
                        </svg>
                      )}
                    </span>
                    <img
                      src={countryFlagUrl(row.code)}
                      alt=""
                      width={18}
                      height={13}
                      className="rounded-[2px] shadow-[0_0_0_1px_rgba(15,23,42,0.08)] object-cover shrink-0"
                    />
                    <span className="flex-1 truncate text-text-primary">{label}</span>
                    <span className="shrink-0 text-[11px] font-body font-semibold text-text-muted tabular-nums">
                      {row.count}
                    </span>
                  </button>
                );
              })
            )}
          </div>

          {selectedCountries.length > 0 && (
            <div className="p-2 border-t border-border bg-bg-secondary/60">
              <button
                type="button"
                onClick={() => {
                  onClear();
                  setSearch("");
                }}
                className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-body font-medium text-text-secondary hover:text-text-primary hover:bg-bg-primary transition-colors"
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round">
                  <path d="M6 6l12 12M6 18L18 6" />
                </svg>
                Tout effacer ({selectedCountries.length})
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
