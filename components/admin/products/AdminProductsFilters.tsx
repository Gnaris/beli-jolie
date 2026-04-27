"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import CustomSelect from "@/components/ui/CustomSelect";

const PRESET_PER_PAGE = [20, 30, 50, 100];

interface SubCategoryOption { id: string; name: string }
interface CategoryOption { id: string; name: string; subCategories?: SubCategoryOption[] }
interface TagOption { id: string; name: string }

interface Props {
  totalCount: number;
  categories: CategoryOption[];
  tags?: TagOption[];
}

export default function AdminProductsFilters({ totalCount, categories, tags = [] }: Props) {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  // Read current URL params
  const urlQ         = searchParams.get("q")          ?? "";
  const urlExactRef  = searchParams.get("exactRef") === "1";
  const urlCat       = searchParams.get("cat")        ?? "";
  const urlSubCat    = searchParams.get("subCat")     ?? "";
  const urlTag       = searchParams.get("tag")        ?? "";
  const urlBestSeller = searchParams.get("bestSeller") ?? "";
  const urlRefresh   = searchParams.get("refresh")    ?? "";
  const urlStatus    = searchParams.get("status")     ?? "";
  const urlMinPrice  = searchParams.get("minPrice")   ?? "";
  const urlMaxPrice  = searchParams.get("maxPrice")   ?? "";
  const urlDateFrom  = searchParams.get("dateFrom")   ?? "";
  const urlDateTo    = searchParams.get("dateTo")     ?? "";
  const urlStockBelow = searchParams.get("stockBelow") ?? "";
  const perPage      = searchParams.get("perPage")    ?? "20";

  // Local state for all text/number/date inputs (not applied until button click)
  const [localQ, setLocalQ]               = useState(urlQ);
  const [localExactRef, setLocalExactRef] = useState(urlExactRef);
  const [localMinPrice, setLocalMinPrice] = useState(urlMinPrice);
  const [localMaxPrice, setLocalMaxPrice] = useState(urlMaxPrice);
  const [localDateFrom, setLocalDateFrom] = useState(urlDateFrom);
  const [localDateTo, setLocalDateTo]     = useState(urlDateTo);
  const [localStockBelow, setLocalStockBelow] = useState(urlStockBelow);

  // Sync local state when URL params change (e.g. after reset or back navigation)
  useEffect(() => { setLocalQ(urlQ); }, [urlQ]);
  useEffect(() => { setLocalExactRef(urlExactRef); }, [urlExactRef]);
  useEffect(() => { setLocalMinPrice(urlMinPrice); }, [urlMinPrice]);
  useEffect(() => { setLocalMaxPrice(urlMaxPrice); }, [urlMaxPrice]);
  useEffect(() => { setLocalDateFrom(urlDateFrom); }, [urlDateFrom]);
  useEffect(() => { setLocalDateTo(urlDateTo); }, [urlDateTo]);
  useEffect(() => { setLocalStockBelow(urlStockBelow); }, [urlStockBelow]);

  const hasFilters = !!(urlQ || urlExactRef || urlCat || urlSubCat || urlTag || urlBestSeller || urlRefresh || urlStatus || urlMinPrice || urlMaxPrice || urlDateFrom || urlDateTo || urlStockBelow);
  const hasLocalChanges = localQ !== urlQ || localExactRef !== urlExactRef || localMinPrice !== urlMinPrice || localMaxPrice !== urlMaxPrice || localDateFrom !== urlDateFrom || localDateTo !== urlDateTo || localStockBelow !== urlStockBelow;

  const [customValue, setCustomValue] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(hasFilters);
  const inputRef = useRef<HTMLInputElement>(null);

  // Keep filters panel open if there are active filters
  useEffect(() => {
    if (hasFilters) setFiltersOpen(true);
  }, [hasFilters]);

  // Navigate with specific param updates (used for selects that apply immediately)
  const navigate = useCallback(
    (updates: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value) params.set(key, value);
        else params.delete(key);
      }
      params.delete("page");
      startTransition(() => {
        router.push(`/admin/produits?${params.toString()}`);
      });
    },
    [router, searchParams, startTransition]
  );

  // Apply all local filter values at once
  const applyFilters = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());

    // Set or delete each filter param based on local state
    const updates: Record<string, string> = {
      q: localQ,
      exactRef: localExactRef ? "1" : "",
      minPrice: localMinPrice,
      maxPrice: localMaxPrice,
      dateFrom: localDateFrom,
      dateTo: localDateTo,
      stockBelow: localStockBelow,
    };

    for (const [key, value] of Object.entries(updates)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }

    params.delete("page");
    startTransition(() => {
      router.push(`/admin/produits?${params.toString()}`);
    });
  }, [searchParams, localQ, localExactRef, localMinPrice, localMaxPrice, localDateFrom, localDateTo, localStockBelow, router, startTransition]);

  // Handle Enter key on any input to trigger search
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      applyFilters();
    }
  }, [applyFilters]);

  const resetAll = () => {
    setLocalQ("");
    setLocalExactRef(false);
    setLocalMinPrice("");
    setLocalMaxPrice("");
    setLocalDateFrom("");
    setLocalDateTo("");
    setLocalStockBelow("");
    startTransition(() => {
      router.push("/admin/produits");
    });
  };

  const isPreset = PRESET_PER_PAGE.map(String).includes(perPage);

  const applyCustom = () => {
    const val = parseInt(customValue);
    if (!isNaN(val) && val > 0) {
      navigate({ perPage: String(val) });
      setCustomValue("");
    }
  };

  return (
    <div className="space-y-3">
      {/* Ligne principale : recherche + filtres toggle + perPage */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
        {/* Recherche */}
        <div className="flex-1 max-w-md">
          <div className="relative">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted"
              fill="none" stroke="currentColor" viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
            <input
              ref={inputRef}
              type="search"
              value={localQ}
              onChange={(e) => setLocalQ(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Rechercher un produit, une référence..."
              className="w-full pl-9 pr-3 py-2 border border-border bg-bg-primary text-sm font-body text-text-primary placeholder:text-text-muted focus:outline-none focus:border-bg-dark transition-colors rounded-lg"
            />
          </div>
        </div>

        {/* Référence exacte */}
        <label
          className={`flex items-center gap-2 px-3 py-2 cursor-pointer select-none shrink-0 text-xs font-body font-medium border rounded-lg transition-colors ${
            localExactRef
              ? "border-bg-dark bg-bg-dark text-text-inverse"
              : "border-border bg-bg-primary text-text-secondary hover:border-bg-dark hover:text-text-primary"
          }`}
        >
          <input
            type="checkbox"
            checked={localExactRef}
            onChange={() => setLocalExactRef((v) => !v)}
            className="sr-only"
          />
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            {localExactRef ? (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4.5 12.75l6 6 9-13.5" />
            ) : (
              <rect x="3" y="3" width="18" height="18" rx="3" strokeWidth={1.5} />
            )}
          </svg>
          Réf. exacte
        </label>

        <div className="hidden sm:block h-5 w-px bg-border" />

        {/* Quantité par page */}
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-text-muted font-body whitespace-nowrap">
            Afficher
          </span>
          <div className="flex items-center gap-1">
            {PRESET_PER_PAGE.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => navigate({ perPage: String(n) })}
                className={`px-2.5 py-1 text-xs font-body border rounded-lg transition-colors ${
                  String(n) === perPage
                    ? "bg-bg-dark text-text-inverse border-bg-dark"
                    : "bg-bg-primary text-text-secondary border-border hover:border-bg-dark hover:text-text-primary"
                }`}
              >
                {n}
              </button>
            ))}
            <div className="flex items-center gap-1">
              <input
                type="number"
                min={1}
                value={customValue}
                onChange={(e) => setCustomValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") applyCustom(); }}
                placeholder={!isPreset ? perPage : "..."}
                className={`w-14 px-2 py-1 text-xs border rounded-lg font-body text-text-primary placeholder:text-text-muted focus:outline-none focus:border-bg-dark transition-colors ${
                  !isPreset ? "border-bg-dark bg-bg-secondary" : "border-border bg-bg-primary"
                }`}
              />
              {customValue && (
                <button type="button" onClick={applyCustom} className="px-2 py-1 text-xs bg-bg-dark text-text-inverse font-body rounded-lg hover:bg-neutral-800 transition-colors">
                  OK
                </button>
              )}
            </div>
          </div>
          <span className="text-xs text-text-muted font-body whitespace-nowrap">
            / {totalCount}
          </span>
        </div>

        {/* Reset */}
        {hasFilters && (
          <button
            type="button"
            onClick={resetAll}
            className="text-xs text-text-muted hover:text-text-primary font-body underline shrink-0 transition-colors"
          >
            Réinitialiser
          </button>
        )}

        {/* Toggle filtres */}
        <button
          type="button"
          onClick={() => setFiltersOpen((v) => !v)}
          className={`flex items-center gap-2 px-3 py-2 text-xs font-body font-medium border rounded-lg transition-colors shrink-0 ml-auto ${
            hasFilters
              ? "border-bg-dark bg-bg-dark text-text-inverse"
              : "border-border bg-bg-primary text-text-secondary hover:border-bg-dark hover:text-text-primary"
          }`}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75" />
          </svg>
          Filtres{hasFilters ? " actifs" : ""}
        </button>
      </div>

      {/* Panneau de filtres déroulant */}
      {filtersOpen && (
        <div className="space-y-4 pt-3 border-t border-border">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
            {/* Catégorie — applies immediately */}
            <div>
              <label className="block text-[10px] font-semibold text-text-secondary uppercase tracking-wider font-body mb-1">
                Catégorie
              </label>
              <CustomSelect
                value={urlCat}
                onChange={(v) => navigate({ cat: v || null, subCat: null })}
                options={[
                  { value: "", label: "Toutes" },
                  ...categories.map((c) => ({ value: c.id, label: c.name })),
                ]}
                size="sm"
              />
            </div>

            {/* Sous-catégorie — applies immediately, filtered by selected category if any */}
            <div>
              <label className="block text-[10px] font-semibold text-text-secondary uppercase tracking-wider font-body mb-1">
                Sous-catégorie
              </label>
              <CustomSelect
                value={urlSubCat}
                onChange={(v) => navigate({ subCat: v || null })}
                options={[
                  { value: "", label: "Toutes" },
                  ...categories.flatMap((c) =>
                    (urlCat && c.id !== urlCat ? [] : (c.subCategories ?? [])).map((s) => ({
                      value: s.id,
                      label: urlCat ? s.name : `${c.name} › ${s.name}`,
                    }))
                  ),
                ]}
                size="sm"
              />
            </div>

            {/* Statut — applies immediately */}
            <div>
              <label className="block text-[10px] font-semibold text-text-secondary uppercase tracking-wider font-body mb-1">
                Statut
              </label>
              <CustomSelect
                value={urlStatus}
                onChange={(v) => navigate({ status: v || null })}
                options={[
                  { value: "", label: "Tous" },
                  { value: "ONLINE", label: "En ligne" },
                  { value: "OFFLINE", label: "Hors ligne" },
                  { value: "DRAFT", label: "Brouillons" },
                  { value: "ARCHIVED", label: "Archivé" },
                  { value: "SYNCING", label: "Sync en cours" },
                ]}
                size="sm"
              />
            </div>

            {/* Mot-clé — applies immediately */}
            <div>
              <label className="block text-[10px] font-semibold text-text-secondary uppercase tracking-wider font-body mb-1">
                Mot-clé
              </label>
              <CustomSelect
                value={urlTag}
                onChange={(v) => navigate({ tag: v || null })}
                options={[
                  { value: "", label: "Tous" },
                  ...tags.map((t) => ({ value: t.id, label: t.name })),
                ]}
                size="sm"
              />
            </div>

            {/* Best-sellers — applies immediately */}
            <div>
              <label className="block text-[10px] font-semibold text-text-secondary uppercase tracking-wider font-body mb-1">
                Best-sellers
              </label>
              <CustomSelect
                value={urlBestSeller}
                onChange={(v) => navigate({ bestSeller: v || null })}
                options={[
                  { value: "", label: "Tous" },
                  { value: "1", label: "Best-sellers uniquement" },
                ]}
                size="sm"
              />
            </div>

            {/* Rafraîchissement — applies immediately */}
            <div>
              <label className="block text-[10px] font-semibold text-text-secondary uppercase tracking-wider font-body mb-1">
                Rafraîchissement
              </label>
              <CustomSelect
                value={urlRefresh}
                onChange={(v) => navigate({ refresh: v || null })}
                options={[
                  { value: "", label: "Tous" },
                  { value: "recent", label: "Rafraîchi récemment (30j)" },
                  { value: "refreshed", label: "Déjà rafraîchi" },
                  { value: "never", label: "Jamais rafraîchi" },
                ]}
                size="sm"
              />
            </div>

            {/* Prix min — local state */}
            <div>
              <label className="block text-[10px] font-semibold text-text-secondary uppercase tracking-wider font-body mb-1">
                Prix min (&euro;)
              </label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={localMinPrice}
                onChange={(e) => setLocalMinPrice(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="0"
                className="w-full px-2.5 py-2 border border-border bg-bg-primary rounded-lg text-xs font-body text-text-primary placeholder:text-text-muted focus:outline-none focus:border-bg-dark transition-colors"
              />
            </div>

            {/* Prix max — local state */}
            <div>
              <label className="block text-[10px] font-semibold text-text-secondary uppercase tracking-wider font-body mb-1">
                Prix max (&euro;)
              </label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={localMaxPrice}
                onChange={(e) => setLocalMaxPrice(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="&infin;"
                className="w-full px-2.5 py-2 border border-border bg-bg-primary rounded-lg text-xs font-body text-text-primary placeholder:text-text-muted focus:outline-none focus:border-bg-dark transition-colors"
              />
            </div>

            {/* Date du — local state */}
            <div>
              <label className="block text-[10px] font-semibold text-text-secondary uppercase tracking-wider font-body mb-1">
                Créé depuis
              </label>
              <input
                type="date"
                value={localDateFrom}
                onChange={(e) => setLocalDateFrom(e.target.value)}
                onKeyDown={handleKeyDown}
                className="w-full px-2.5 py-2 border border-border bg-bg-primary rounded-lg text-xs font-body text-text-primary focus:outline-none focus:border-bg-dark transition-colors"
              />
            </div>

            {/* Date au — local state */}
            <div>
              <label className="block text-[10px] font-semibold text-text-secondary uppercase tracking-wider font-body mb-1">
                Créé avant
              </label>
              <input
                type="date"
                value={localDateTo}
                onChange={(e) => setLocalDateTo(e.target.value)}
                onKeyDown={handleKeyDown}
                className="w-full px-2.5 py-2 border border-border bg-bg-primary rounded-lg text-xs font-body text-text-primary focus:outline-none focus:border-bg-dark transition-colors"
              />
            </div>

            {/* Stock ≤ X — local state */}
            <div>
              <label className="block text-[10px] font-semibold text-text-secondary uppercase tracking-wider font-body mb-1">
                Stock &le;
              </label>
              <input
                type="number"
                min={0}
                value={localStockBelow}
                onChange={(e) => setLocalStockBelow(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="ex: 5"
                className="w-full px-2.5 py-2 border border-border bg-bg-primary rounded-lg text-xs font-body text-text-primary placeholder:text-text-muted focus:outline-none focus:border-bg-dark transition-colors"
              />
            </div>
          </div>

          {/* Rechercher button */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={applyFilters}
              className="btn-primary inline-flex items-center gap-2 px-5 py-2.5 text-sm font-body font-medium rounded-lg transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
              </svg>
              Rechercher
            </button>
            {hasLocalChanges && (
              <span className="text-[11px] text-text-muted font-body italic">
                Filtres modifiés — cliquez Rechercher ou appuyez Entrée
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
