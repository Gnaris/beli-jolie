"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import CustomSelect from "@/components/ui/CustomSelect";
import {
  clearFilters as clearMemorizedFilters,
  extractFiltersQueryString,
  loadFiltersToRestore,
  saveFilters as saveMemorizedFilters,
} from "@/lib/admin-products-filter-memory";

const PRESET_PER_PAGE = [20, 30, 50, 100];

// Parse une query string `q=REF1,REF2,REF3` en liste de termes nettoyés.
export function parseQuery(raw: string): string[] {
  return raw.split(",").map((t) => t.trim()).filter((t) => t.length > 0);
}

// Décide s'il faut relancer la recherche après retrait d'un badge. On ne le
// fait que si le terme retiré faisait effectivement partie de l'URL courante :
// retirer un badge ajouté localement mais pas encore appliqué ne doit pas
// déclencher de navigation.
export function shouldRefetchAfterBadgeRemove(removed: string | undefined, urlQ: string): boolean {
  if (removed === undefined) return false;
  return parseQuery(urlQ).includes(removed);
}

interface SubCategoryOption { id: string; name: string }
interface CategoryOption { id: string; name: string; subCategories?: SubCategoryOption[] }
interface TagOption { id: string; name: string }
interface CompositionOption { id: string; name: string }

interface Props {
  totalCount: number;
  categories: CategoryOption[];
  tags?: TagOption[];
  compositions?: CompositionOption[];
  hsCodes?: { id: string; code: string; label: string }[];
  hasPfsConfig?: boolean;
  hasAnkorstoreConfig?: boolean;
  hasEfashionConfig?: boolean;
  hasFaireConfig?: boolean;
  /**
   * `forceOpen` : utilisé par `ProductFiltersPanel` qui gère lui-même
   * l'ouverture du panneau via la nouvelle barre compacte. Quand cette prop
   * est vraie, on force le panneau détaillé visible et on masque le bouton
   * interne « Filtres » pour éviter le double toggle.
   */
  forceOpen?: boolean;
}

export default function AdminProductsFilters({ totalCount, categories, tags = [], compositions = [], hsCodes = [], hasPfsConfig = false, hasAnkorstoreConfig = false, hasEfashionConfig = false, hasFaireConfig = false, forceOpen = false }: Props) {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  // Read current URL params
  const urlQ         = searchParams.get("q")          ?? "";
  const urlExactRef  = searchParams.get("exactRef") === "1";
  const urlCat       = searchParams.get("cat")        ?? "";
  const urlSubCat    = searchParams.get("subCat")     ?? "";
  const urlTag       = searchParams.get("tag")        ?? "";
  const urlComposition = searchParams.get("composition") ?? "";
  const urlBestSeller = searchParams.get("bestSeller") ?? "";
  const urlRefresh   = searchParams.get("refresh")    ?? "";
  const urlStatus    = searchParams.get("status")     ?? "";
  const urlMinPrice  = searchParams.get("minPrice")   ?? "";
  const urlMaxPrice  = searchParams.get("maxPrice")   ?? "";
  const urlDateFrom  = searchParams.get("dateFrom")   ?? "";
  const urlDateTo    = searchParams.get("dateTo")     ?? "";
  const urlStockBelow = searchParams.get("stockBelow") ?? "";
  const urlMissingImages = searchParams.get("missingImages") ?? "";
  const urlPfsLink = searchParams.get("pfsLink") ?? "";
  const urlAnkorsLink = searchParams.get("ankorsLink") ?? "";
  const urlEfashionLink = searchParams.get("efashionLink") ?? "";
  const urlFaireLink = searchParams.get("faireLink") ?? "";
  const urlSyncRequired = searchParams.get("syncRequired") ?? "";
  const urlHsCodeId  = searchParams.get("hsCodeId")   ?? "";
  const urlLocked    = searchParams.get("locked")     ?? "";
  const urlPfsExportedAt        = searchParams.get("pfsExportedAt")        ?? "";
  const urlEfashionExportedAt   = searchParams.get("efashionExportedAt")   ?? "";
  const urlMicrostoreExportedAt = searchParams.get("microstoreExportedAt") ?? "";
  const urlAnkorstoreExportedAt = searchParams.get("ankorstoreExportedAt") ?? "";
  const urlFaireExportedAt      = searchParams.get("faireExportedAt")      ?? "";
  const perPage      = searchParams.get("perPage")    ?? "20";

  // Options communes aux 4 dropdowns "Dernier export …". Centralisé pour rester
  // cohérent avec les libellés générés ailleurs (badges, tooltip).
  const EXPORTED_AT_OPTIONS = [
    { value: "",       label: "Tous" },
    { value: "never",  label: "Jamais exporté" },
    { value: "lt7d",   label: "Exporté il y a < 7j" },
    { value: "lt30d",  label: "Exporté il y a < 30j" },
    { value: "gt30d",  label: "Exporté il y a > 30j" },
    { value: "gt90d",  label: "Exporté il y a > 90j" },
  ];

  // Parse "REF1,REF2,REF3" → ["REF1", "REF2", "REF3"]
  const parseQ = (raw: string): string[] => parseQuery(raw);

  // Local state for all text/number/date inputs (not applied until button click)
  const [localTerms, setLocalTerms]       = useState<string[]>(parseQ(urlQ));
  const [draft, setDraft]                 = useState("");
  const [copiedIdx, setCopiedIdx]         = useState<number | null>(null);
  const [localMinPrice, setLocalMinPrice] = useState(urlMinPrice);
  const [localMaxPrice, setLocalMaxPrice] = useState(urlMaxPrice);
  const [localDateFrom, setLocalDateFrom] = useState(urlDateFrom);
  const [localDateTo, setLocalDateTo]     = useState(urlDateTo);
  const [localStockBelow, setLocalStockBelow] = useState(urlStockBelow);

  // Champ libre « nombre par page » (utilisé si la valeur n'est pas un preset)
  const isCustomPerPage = !PRESET_PER_PAGE.map(String).includes(perPage);
  const [customPerPageDraft, setCustomPerPageDraft] = useState(isCustomPerPage ? perPage : "");

  // Sync local state when URL params change (e.g. after reset or back navigation)
  useEffect(() => { setLocalTerms(parseQ(urlQ)); }, [urlQ]);
  useEffect(() => { setLocalMinPrice(urlMinPrice); }, [urlMinPrice]);
  useEffect(() => { setLocalMaxPrice(urlMaxPrice); }, [urlMaxPrice]);
  useEffect(() => { setLocalDateFrom(urlDateFrom); }, [urlDateFrom]);
  useEffect(() => { setLocalDateTo(urlDateTo); }, [urlDateTo]);
  useEffect(() => { setLocalStockBelow(urlStockBelow); }, [urlStockBelow]);
  useEffect(() => {
    setCustomPerPageDraft(PRESET_PER_PAGE.map(String).includes(perPage) ? "" : perPage);
  }, [perPage]);

  // Mémorise/restaure les filtres dans sessionStorage : retrouver la même vue
  // quand on revient sur la liste depuis une fiche produit ou un autre écran.
  // La restauration ne se fait qu'au premier montage : sinon, cliquer sur
  // "Tous" (qui vide l'URL) ferait immédiatement réapparaître l'ancien filtre.
  const hasAttemptedRestoreRef = useRef(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const qs = searchParams.toString();
    if (!hasAttemptedRestoreRef.current) {
      hasAttemptedRestoreRef.current = true;
      const toRestore = loadFiltersToRestore(qs, window.sessionStorage);
      if (toRestore) {
        router.replace(`/admin/produits?${toRestore}`);
        return;
      }
    }
    // Après le premier montage, on suit l'URL en direct : on sauvegarde si
    // l'URL contient des filtres, sinon on vide la mémoire (l'utilisatrice a
    // explicitement tout effacé).
    if (extractFiltersQueryString(qs).length > 0) {
      saveMemorizedFilters(qs, window.sessionStorage);
    } else {
      clearMemorizedFilters(window.sessionStorage);
    }
  }, [searchParams, router]);

  const localQ = localTerms.join(",");
  const hasFilters = !!(urlQ || urlExactRef || urlCat || urlSubCat || urlTag || urlComposition || urlBestSeller || urlRefresh || urlStatus || urlMinPrice || urlMaxPrice || urlDateFrom || urlDateTo || urlStockBelow || urlMissingImages || urlPfsLink || urlAnkorsLink || urlEfashionLink || urlFaireLink || urlSyncRequired || urlHsCodeId || urlLocked || urlPfsExportedAt || urlEfashionExportedAt || urlMicrostoreExportedAt || urlAnkorstoreExportedAt || urlFaireExportedAt);
  const hasLocalChanges = localQ !== urlQ || draft.trim().length > 0 || localMinPrice !== urlMinPrice || localMaxPrice !== urlMaxPrice || localDateFrom !== urlDateFrom || localDateTo !== urlDateTo || localStockBelow !== urlStockBelow;

  const [filtersOpenInternal, setFiltersOpen] = useState(hasFilters);
  const filtersOpen = forceOpen || filtersOpenInternal;
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

  // Apply all local filter values at once. Optionally accept a "pending draft"
  // so the user doesn't have to press Enter twice (one to badge, one to search),
  // or an explicit list of terms (used when removing a badge to avoid waiting
  // for the async state update).
  const applyFilters = useCallback((opts?: { pendingDraft?: string; termsOverride?: string[] }) => {
    const params = new URLSearchParams(searchParams.toString());
    const draftTrimmed = (opts?.pendingDraft ?? "").trim();
    const baseTerms = opts?.termsOverride ?? localTerms;
    const terms = draftTrimmed && !baseTerms.includes(draftTrimmed)
      ? [...baseTerms, draftTrimmed]
      : baseTerms;

    const updates: Record<string, string> = {
      q: terms.join(","),
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
  }, [searchParams, localTerms, localMinPrice, localMaxPrice, localDateFrom, localDateTo, localStockBelow, router, startTransition]);

  // Add the draft as a new search badge.
  const commitDraft = useCallback(() => {
    const v = draft.trim();
    if (!v) return false;
    if (!localTerms.includes(v)) {
      setLocalTerms([...localTerms, v]);
    }
    setDraft("");
    return true;
  }, [draft, localTerms]);

  // Retire un badge. Si ce badge faisait partie de la recherche en cours (URL),
  // relance automatiquement la recherche avec la liste mise à jour pour éviter
  // un clic supplémentaire sur "Rechercher".
  const removeTerm = useCallback((idx: number) => {
    const removed = localTerms[idx];
    const next = localTerms.filter((_, i) => i !== idx);
    setLocalTerms(next);
    if (shouldRefetchAfterBadgeRemove(removed, urlQ)) {
      applyFilters({ termsOverride: next });
    }
  }, [localTerms, urlQ, applyFilters]);

  // Copie le texte du badge dans le presse-papier et bascule l'icône en "check" 1.2s.
  const copyTerm = useCallback(async (term: string, idx: number) => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(term);
      } else {
        // Fallback ancien navigateur
        const ta = document.createElement("textarea");
        ta.value = term;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx((cur) => (cur === idx ? null : cur)), 1200);
    } catch {
      // Silencieux : pas critique
    }
  }, []);

  // Handle keys in the search input: Enter = add badge then search;
  // Backspace on empty = remove last badge.
  const handleSearchKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (draft.trim().length > 0) {
        const v = draft.trim();
        commitDraft();
        applyFilters({ pendingDraft: v });
      } else {
        applyFilters();
      }
    } else if (e.key === "," || e.key === "Tab") {
      if (draft.trim().length > 0) {
        e.preventDefault();
        commitDraft();
      }
    } else if (e.key === "Backspace" && draft.length === 0 && localTerms.length > 0) {
      e.preventDefault();
      removeTerm(localTerms.length - 1);
    }
  }, [draft, localTerms.length, commitDraft, removeTerm, applyFilters]);

  // Handle Enter key on other inputs (price, date, stock) to trigger search
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      applyFilters();
    }
  }, [applyFilters]);

  const resetAll = () => {
    setLocalTerms([]);
    setDraft("");
    setLocalMinPrice("");
    setLocalMaxPrice("");
    setLocalDateFrom("");
    setLocalDateTo("");
    setLocalStockBelow("");
    if (typeof window !== "undefined") {
      clearMemorizedFilters(window.sessionStorage);
    }
    startTransition(() => {
      router.push("/admin/produits");
    });
  };

  return (
    <div className="space-y-3">
      {/* Ligne principale : recherche + filtres toggle + perPage */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
        {/* Recherche multi-références */}
        <div className="flex-1 max-w-md">
          <div
            className="relative flex flex-wrap items-center gap-1.5 pl-9 pr-2 py-1.5 border border-border bg-bg-primary rounded-lg focus-within:border-bg-dark transition-colors cursor-text"
            onClick={() => inputRef.current?.focus()}
          >
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted pointer-events-none"
              fill="none" stroke="currentColor" viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
            {localTerms.map((term, idx) => {
              const isCopied = copiedIdx === idx;
              return (
                <span
                  key={`${term}-${idx}`}
                  className="inline-flex items-center gap-1.5 bg-bg-dark text-text-inverse text-sm font-body px-2.5 py-1 rounded-md"
                >
                  <span className="font-mono">{term}</span>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); copyTerm(term, idx); }}
                    className={`leading-none transition-colors ${
                      isCopied ? "text-[#4ADE80]" : "text-text-inverse/70 hover:text-text-inverse"
                    }`}
                    title={isCopied ? "Copié !" : "Copier"}
                    aria-label={isCopied ? `${term} copié` : `Copier ${term}`}
                  >
                    {isCopied ? (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                      </svg>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); removeTerm(idx); }}
                    className="text-text-inverse/70 hover:text-text-inverse leading-none text-lg"
                    title="Retirer"
                    aria-label={`Retirer ${term}`}
                  >
                    ×
                  </button>
                </span>
              );
            })}
            <input
              ref={inputRef}
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              onBlur={() => { if (draft.trim()) commitDraft(); }}
              placeholder={localTerms.length === 0 ? "Rechercher un produit, une référence..." : "Ajouter une référence…"}
              className="flex-1 min-w-[120px] py-1 bg-transparent border-none focus:outline-none text-sm font-body text-text-primary placeholder:text-text-muted"
            />
          </div>
          {localTerms.length > 0 && (
            <p className="text-[10px] text-text-muted font-body mt-1 ml-1">
              Entrée pour ajouter une référence · Retour arrière pour retirer la dernière
            </p>
          )}
        </div>

        {/* Référence exacte — masqué en haut pour matcher la maquette Ardoise.
            La logique reste active : un filtre dépliable « Plus de filtres »
            permettra de l'activer ultérieurement. */}
        <label
          className={`hidden flex items-center gap-2 px-3 py-2 cursor-pointer select-none shrink-0 text-xs font-body font-medium border rounded-lg transition-colors ${
            urlExactRef
              ? "border-bg-dark bg-bg-dark text-text-inverse"
              : "border-border bg-bg-primary text-text-secondary hover:border-bg-dark hover:text-text-primary"
          }`}
        >
          <input
            type="checkbox"
            checked={urlExactRef}
            onChange={() => navigate({ exactRef: urlExactRef ? null : "1" })}
            className="sr-only"
          />
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            {urlExactRef ? (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4.5 12.75l6 6 9-13.5" />
            ) : (
              <rect x="3" y="3" width="18" height="18" rx="3" strokeWidth={1.5} />
            )}
          </svg>
          Réf. exacte
        </label>

        <div className="hidden sm:block h-5 w-px bg-border" />

        {/* Quantité par page — masquée en haut pour matcher la maquette. */}
        <div className="hidden items-center gap-2 shrink-0">
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
            {/* Champ libre : nombre personnalisé (max 500) */}
            <div
              className={`flex items-center gap-1 px-2 py-1 text-xs font-body border rounded-lg transition-colors ${
                isCustomPerPage
                  ? "bg-bg-dark text-text-inverse border-bg-dark"
                  : "bg-bg-primary text-text-secondary border-border"
              }`}
            >
              <input
                type="number"
                min={1}
                max={500}
                value={customPerPageDraft}
                onChange={(e) => setCustomPerPageDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    const n = parseInt(customPerPageDraft, 10);
                    if (!isNaN(n) && n >= 1 && n <= 500) navigate({ perPage: String(n) });
                  }
                }}
                placeholder="Autre"
                title="Nombre personnalisé (1 à 500)"
                className={`w-14 bg-transparent text-center font-medium tabular-nums focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${
                  isCustomPerPage ? "placeholder:text-text-inverse/60" : "placeholder:text-text-muted"
                }`}
              />
              {customPerPageDraft && customPerPageDraft !== perPage && (
                <button
                  type="button"
                  onClick={() => {
                    const n = parseInt(customPerPageDraft, 10);
                    if (!isNaN(n) && n >= 1 && n <= 500) navigate({ perPage: String(n) });
                  }}
                  className="px-1.5 py-0.5 text-[10px] font-semibold bg-bg-primary text-text-primary border border-border rounded hover:border-bg-dark transition-colors"
                >
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
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-body font-medium border border-[#FECACA] bg-[#FEF2F2] text-[#DC2626] rounded-lg hover:bg-[#FEE2E2] hover:border-[#FCA5A5] transition-colors shrink-0"
            title="Effacer tous les filtres et revenir à la liste complète"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
            Effacer les filtres
          </button>
        )}

        {/* Toggle filtres — masqué quand le wrapper ProductFiltersPanel
            contrôle déjà l'ouverture via le bouton « Filtres détaillés ». */}
        {!forceOpen && (
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
        )}
      </div>

      {/* Panneau de filtres déroulant — sections en colonnes côte à côte pour gagner en hauteur */}
      {filtersOpen && (
        <div className="pt-3 border-t border-border">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-x-4 gap-y-4 xl:gap-x-0 xl:gap-y-0">
            {/* Colonne : Catalogue */}
            <FilterColumn title="Catalogue">
              <FilterField label="Catégorie" active={!!urlCat}>
                <CustomSelect
                  value={urlCat}
                  onChange={(v) => navigate({ cat: v || null, subCat: null })}
                  options={[
                    { value: "", label: "Toutes" },
                    ...categories.map((c) => ({ value: c.id, label: c.name })),
                  ]}
                  size="sm"
                  searchable
                />
              </FilterField>
              <FilterField label="Sous-catégorie" active={!!urlSubCat}>
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
                  searchable
                />
              </FilterField>
              <FilterField label="Mot-clé" active={!!urlTag}>
                <CustomSelect
                  value={urlTag}
                  onChange={(v) => navigate({ tag: v || null })}
                  options={[
                    { value: "", label: "Tous" },
                    ...tags.map((t) => ({ value: t.id, label: t.name })),
                  ]}
                  size="sm"
                  searchable
                />
              </FilterField>
              <FilterField label="Composition" active={!!urlComposition}>
                <CustomSelect
                  value={urlComposition}
                  onChange={(v) => navigate({ composition: v || null })}
                  options={[
                    { value: "", label: "Toutes" },
                    ...compositions.map((c) => ({ value: c.id, label: c.name })),
                  ]}
                  size="sm"
                  searchable
                />
              </FilterField>
              <FilterField label="Code SH" active={!!urlHsCodeId}>
                <CustomSelect
                  value={urlHsCodeId}
                  onChange={(v) => navigate({ hsCodeId: v || null })}
                  options={[
                    { value: "", label: "Tous" },
                    { value: "__none__", label: "Sans code SH" },
                    ...hsCodes.map((c) => ({
                      value: c.id,
                      label: `${c.code} — ${c.label}`,
                    })),
                  ]}
                  size="sm"
                  searchable
                />
              </FilterField>
            </FilterColumn>

            {/* Colonne : Statut & visibilité */}
            <FilterColumn title="Statut & visibilité">
              <FilterField label="Statut" active={!!urlStatus}>
                <CustomSelect
                  value={urlStatus}
                  onChange={(v) => navigate({ status: v || null })}
                  options={[
                    { value: "", label: "Tous" },
                    { value: "ONLINE", label: "En ligne" },
                    { value: "OFFLINE", label: "Hors ligne" },
                    { value: "DRAFT", label: "Brouillons" },
                    { value: "ARCHIVED", label: "Archivé" },
                  ]}
                  size="sm"
                  searchable
                />
              </FilterField>
              <FilterField label="Best-sellers" active={!!urlBestSeller}>
                <CustomSelect
                  value={urlBestSeller}
                  onChange={(v) => navigate({ bestSeller: v || null })}
                  options={[
                    { value: "", label: "Tous" },
                    { value: "1", label: "Best-sellers uniquement" },
                  ]}
                  size="sm"
                  searchable
                />
              </FilterField>
              <FilterField label="Verrouillage" active={!!urlLocked}>
                <CustomSelect
                  value={urlLocked}
                  onChange={(v) => navigate({ locked: v || null })}
                  options={[
                    { value: "", label: "Tous" },
                    { value: "1", label: "Verrouillés uniquement" },
                  ]}
                  size="sm"
                  searchable
                />
              </FilterField>
              <FilterField label="Images" active={!!urlMissingImages}>
                <CustomSelect
                  value={urlMissingImages}
                  onChange={(v) => navigate({ missingImages: v || null })}
                  options={[
                    { value: "", label: "Toutes" },
                    { value: "1", label: "Au moins une variante sans image" },
                    { value: "0", label: "Toutes les variantes ont au moins une image" },
                  ]}
                  size="sm"
                  searchable
                />
              </FilterField>
            </FilterColumn>

            {/* Colonne : Prix & stock */}
            <FilterColumn title="Prix & stock">
              <FilterField label="Prix min (€)" active={!!urlMinPrice}>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={localMinPrice}
                  onChange={(e) => setLocalMinPrice(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="0"
                  className="w-full px-2.5 py-1.5 border border-border bg-bg-primary rounded-lg text-xs font-body text-text-primary placeholder:text-text-muted focus:outline-none focus:border-bg-dark transition-colors"
                />
              </FilterField>
              <FilterField label="Prix max (€)" active={!!urlMaxPrice}>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={localMaxPrice}
                  onChange={(e) => setLocalMaxPrice(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="∞"
                  className="w-full px-2.5 py-1.5 border border-border bg-bg-primary rounded-lg text-xs font-body text-text-primary placeholder:text-text-muted focus:outline-none focus:border-bg-dark transition-colors"
                />
              </FilterField>
              <FilterField label="Stock ≤" active={!!urlStockBelow}>
                <input
                  type="number"
                  min={0}
                  value={localStockBelow}
                  onChange={(e) => setLocalStockBelow(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="ex: 5"
                  className="w-full px-2.5 py-1.5 border border-border bg-bg-primary rounded-lg text-xs font-body text-text-primary placeholder:text-text-muted focus:outline-none focus:border-bg-dark transition-colors"
                />
              </FilterField>
            </FilterColumn>

            {/* Colonne : Dates & fraîcheur */}
            <FilterColumn title="Dates & fraîcheur">
              <FilterField label="Créé depuis" active={!!urlDateFrom}>
                <input
                  type="date"
                  value={localDateFrom}
                  onChange={(e) => setLocalDateFrom(e.target.value)}
                  onKeyDown={handleKeyDown}
                  className="w-full px-2.5 py-1.5 border border-border bg-bg-primary rounded-lg text-xs font-body text-text-primary focus:outline-none focus:border-bg-dark transition-colors"
                />
              </FilterField>
              <FilterField label="Créé avant" active={!!urlDateTo}>
                <input
                  type="date"
                  value={localDateTo}
                  onChange={(e) => setLocalDateTo(e.target.value)}
                  onKeyDown={handleKeyDown}
                  className="w-full px-2.5 py-1.5 border border-border bg-bg-primary rounded-lg text-xs font-body text-text-primary focus:outline-none focus:border-bg-dark transition-colors"
                />
              </FilterField>
              <FilterField label="Tri / Rafraîchissement" active={!!urlRefresh}>
                <CustomSelect
                  value={urlRefresh}
                  onChange={(v) => navigate({ refresh: v || null })}
                  options={[
                    { value: "", label: "Par défaut (créé récemment d'abord)" },
                    { value: "modifiedDesc", label: "Modifié récemment d'abord" },
                    { value: "modifiedAsc", label: "Modifié anciennement d'abord" },
                    { value: "dateDesc", label: "Rafraîchi récemment d'abord" },
                    { value: "dateAsc", label: "Rafraîchi anciennement d'abord" },
                    { value: "recent", label: "Rafraîchi récemment (30j)" },
                    { value: "refreshed", label: "Déjà rafraîchi" },
                    { value: "never", label: "Jamais rafraîchi" },
                  ]}
                  size="sm"
                  searchable
                />
              </FilterField>
            </FilterColumn>

            {/* Colonne : Marketplaces — toujours visible car le filtre « Dernier
                export » concerne aussi Microstore (purement Excel, pas de config). */}
            <FilterColumn title="Marketplaces">
              {hasPfsConfig && (
                <FilterField label="Lien Paris Fashion Shop" active={!!urlPfsLink}>
                  <CustomSelect
                    value={urlPfsLink}
                    onChange={(v) => navigate({ pfsLink: v || null })}
                    options={[
                      { value: "", label: "Tous" },
                      { value: "linked", label: "Lié à PFS" },
                      { value: "unlinked", label: "Non lié à PFS" },
                    ]}
                    size="sm"
                    searchable
                  />
                </FilterField>
              )}
              {hasAnkorstoreConfig && (
                <FilterField label="Lien ANKOR" active={!!urlAnkorsLink}>
                  <CustomSelect
                    value={urlAnkorsLink}
                    onChange={(v) => navigate({ ankorsLink: v || null })}
                    options={[
                      { value: "", label: "Tous" },
                      { value: "linked", label: "Lié à ANKOR" },
                      { value: "unlinked", label: "Non lié à ANKOR" },
                    ]}
                    size="sm"
                    searchable
                  />
                </FilterField>
              )}
              {hasEfashionConfig && (
                <FilterField label="Lien EF" active={!!urlEfashionLink}>
                  <CustomSelect
                    value={urlEfashionLink}
                    onChange={(v) => navigate({ efashionLink: v || null })}
                    options={[
                      { value: "", label: "Tous" },
                      { value: "linked", label: "Lié à EF" },
                      { value: "unlinked", label: "Non lié à EF" },
                    ]}
                    size="sm"
                    searchable
                  />
                </FilterField>
              )}
              {hasFaireConfig && (
                <FilterField label="Lien Faire" active={!!urlFaireLink}>
                  <CustomSelect
                    value={urlFaireLink}
                    onChange={(v) => navigate({ faireLink: v || null })}
                    options={[
                      { value: "", label: "Tous" },
                      { value: "linked", label: "Lié à Faire" },
                      { value: "unlinked", label: "Non lié à Faire" },
                    ]}
                    size="sm"
                    searchable
                  />
                </FilterField>
              )}
              {(hasPfsConfig || hasAnkorstoreConfig || hasEfashionConfig || hasFaireConfig) && (
                <FilterField label="Synchronisation" active={!!urlSyncRequired}>
                  <CustomSelect
                    value={urlSyncRequired}
                    onChange={(v) => navigate({ syncRequired: v || null })}
                    options={[
                      { value: "", label: "Tous" },
                      { value: "1", label: "Synchro marketplace nécessaire" },
                    ]}
                    size="sm"
                    searchable
                  />
                </FilterField>
              )}

              {/* ─── Dernier export ─ 1 dropdown par marketplace ─────────────── */}
              <FilterField label="Dernier export Paris Fashion Shop" active={!!urlPfsExportedAt}>
                <CustomSelect
                  value={urlPfsExportedAt}
                  onChange={(v) => navigate({ pfsExportedAt: v || null })}
                  options={EXPORTED_AT_OPTIONS}
                  size="sm"
                  searchable
                />
              </FilterField>
              <FilterField label="Dernier export EF" active={!!urlEfashionExportedAt}>
                <CustomSelect
                  value={urlEfashionExportedAt}
                  onChange={(v) => navigate({ efashionExportedAt: v || null })}
                  options={EXPORTED_AT_OPTIONS}
                  size="sm"
                  searchable
                />
              </FilterField>
              <FilterField label="Dernier export Microstore" active={!!urlMicrostoreExportedAt}>
                <CustomSelect
                  value={urlMicrostoreExportedAt}
                  onChange={(v) => navigate({ microstoreExportedAt: v || null })}
                  options={EXPORTED_AT_OPTIONS}
                  size="sm"
                  searchable
                />
              </FilterField>
              <FilterField label="Dernier export ANKOR" active={!!urlAnkorstoreExportedAt}>
                <CustomSelect
                  value={urlAnkorstoreExportedAt}
                  onChange={(v) => navigate({ ankorstoreExportedAt: v || null })}
                  options={EXPORTED_AT_OPTIONS}
                  size="sm"
                  searchable
                />
              </FilterField>
              <FilterField label="Dernier export Faire" active={!!urlFaireExportedAt}>
                <CustomSelect
                  value={urlFaireExportedAt}
                  onChange={(v) => navigate({ faireExportedAt: v || null })}
                  options={EXPORTED_AT_OPTIONS}
                  size="sm"
                  searchable
                />
              </FilterField>
            </FilterColumn>
          </div>

          {/* Rechercher button */}
          <div className="flex items-center gap-3 pt-3 mt-3 border-t border-border">
            <button
              type="button"
              onClick={() => applyFilters()}
              className="btn-primary inline-flex items-center gap-2 px-4 py-2 text-xs font-body font-medium rounded-lg transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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

/**
 * Colonne thématique de filtres : titre discret en haut puis champs empilés verticalement.
 * Sur grand écran (xl), bordure verticale à gauche pour séparer visuellement chaque colonne ;
 * désactivée sur la première colonne et sur les breakpoints intermédiaires (gap suffit).
 */
function FilterColumn({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2 xl:px-4 xl:first:pl-0 xl:last:pr-0 xl:border-l xl:border-border xl:first:border-l-0">
      <h3 className="text-[10px] font-heading font-semibold text-text-muted uppercase tracking-[0.12em] pb-1.5 border-b border-border/60">
        {title}
      </h3>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

/**
 * Champ de filtre individuel avec son label.
 *
 * `active` = un filtre est actuellement appliqué sur ce champ (valeur ≠ « Tous »).
 * On affiche alors une pastille emerald devant le libellé et on bascule la
 * couleur du libellé en emerald-700 : repère visuel rapide pour la cliente,
 * qui voit en un coup d'œil quels filtres (parmi la quinzaine empilés) sont
 * actifs. Volontairement discret — pas de couleur sur le champ lui-même pour
 * ne pas saturer le panneau.
 */
function FilterField({
  label,
  children,
  active = false,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
  active?: boolean;
}) {
  return (
    <div>
      <label
        className={`flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider font-body mb-0.5 transition-colors ${
          active ? "text-emerald-700" : "text-text-secondary"
        }`}
      >
        {active && (
          <span
            className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0"
            aria-hidden="true"
          />
        )}
        <span>{label}</span>
        {active && <span className="sr-only"> — filtre actif</span>}
      </label>
      {children}
    </div>
  );
}
