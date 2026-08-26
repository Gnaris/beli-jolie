"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";
import { useFilterPending } from "./FilterPendingContext";

interface CategoryOption { id: string; name: string }
interface TagOption { id: string; name: string }
interface CompositionOption { id: string; name: string }
interface HsCodeOption { id: string; code: string; label: string }

interface Props {
  totalCount: number;
  activeCount: number;
  detailedOpen: boolean;
  onToggleDetailed: () => void;
  categories: CategoryOption[];
  tags: TagOption[];
  compositions: CompositionOption[];
  hsCodes: HsCodeOption[];
  /** Masque le bouton « Filtres détaillés » (mode popovers thématiques). */
  hideDetailedToggle?: boolean;
}

type Pill = { key: string; label: string; remove: string[] };

/**
 * Barre compacte au-dessus du panneau de filtres détaillé : pills actifs
 * (filtres en cours, retirables en 1 clic) + bouton « Filtres » qui ouvre /
 * ferme le panneau détaillé. La logique URL reste centralisée dans
 * AdminProductsFilters ; ce header se contente de lire l'URL pour générer les
 * pills, et d'écrire en supprimant les clés concernées.
 */
export default function CompactFiltersHeader({
  totalCount, activeCount, detailedOpen, onToggleDetailed,
  categories, tags, compositions, hsCodes, hideDetailedToggle = false,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { startFiltering: startTransition } = useFilterPending();

  // Mappe id → label pour rendre les pills lisibles
  const catLabels = useMemo(() => Object.fromEntries(categories.map((c) => [c.id, c.name])), [categories]);
  const tagLabels = useMemo(() => Object.fromEntries(tags.map((t) => [t.id, t.name])), [tags]);
  const compositionLabels = useMemo(() => Object.fromEntries(compositions.map((c) => [c.id, c.name])), [compositions]);
  const hsLabels = useMemo(() => Object.fromEntries(hsCodes.map((h) => [h.id, `${h.code} · ${h.label}`])), [hsCodes]);

  const removeKeys = useCallback((keys: string[]) => {
    const params = new URLSearchParams(searchParams.toString());
    keys.forEach((k) => params.delete(k));
    params.delete("page");
    startTransition(() => {
      router.push(`/admin/produits${params.toString() ? `?${params.toString()}` : ""}`);
    });
  }, [searchParams, router, startTransition]);

  const clearAll = useCallback(() => {
    startTransition(() => { router.push("/admin/produits"); });
  }, [router, startTransition]);

  // Génère la liste des pills à partir des URL params
  const pills: Pill[] = useMemo(() => {
    const out: Pill[] = [];
    const p = searchParams;

    const q = p.get("q") ?? "";
    if (q) {
      out.push({ key: "q", label: `Recherche · ${q.length > 24 ? q.slice(0, 24) + "…" : q}`, remove: ["q", "exactRef"] });
    }
    const cat = p.get("cat") ?? "";
    if (cat) {
      out.push({ key: `cat-${cat}`, label: `Catégorie · ${catLabels[cat] ?? cat}`, remove: ["cat", "subCat"] });
    }
    const subCat = p.get("subCat") ?? "";
    if (subCat) {
      out.push({ key: `subCat-${subCat}`, label: `Sous-cat. · ${catLabels[subCat] ?? subCat}`, remove: ["subCat"] });
    }
    const tag = p.get("tag") ?? "";
    if (tag) {
      out.push({ key: `tag-${tag}`, label: `Mot-clé · ${tagLabels[tag] ?? tag}`, remove: ["tag"] });
    }
    const composition = p.get("composition") ?? "";
    if (composition) {
      out.push({ key: `comp-${composition}`, label: `Composition · ${compositionLabels[composition] ?? composition}`, remove: ["composition"] });
    }
    const hsCodeId = p.get("hsCodeId") ?? "";
    if (hsCodeId) {
      out.push({ key: `hs-${hsCodeId}`, label: `Code SH · ${hsLabels[hsCodeId] ?? hsCodeId}`, remove: ["hsCodeId"] });
    }
    const minPrice = p.get("minPrice") ?? "";
    const maxPrice = p.get("maxPrice") ?? "";
    if (minPrice || maxPrice) {
      const minTxt = minPrice ? `${minPrice} €` : "min";
      const maxTxt = maxPrice ? `${maxPrice} €` : "max";
      out.push({ key: "price", label: `Prix · ${minTxt} – ${maxTxt}`, remove: ["minPrice", "maxPrice"] });
    }
    const stockBelow = p.get("stockBelow") ?? "";
    if (stockBelow) {
      out.push({ key: "stock", label: `Stock < ${stockBelow}`, remove: ["stockBelow"] });
    }
    const dateFrom = p.get("dateFrom") ?? "";
    const dateTo = p.get("dateTo") ?? "";
    if (dateFrom || dateTo) {
      out.push({
        key: "dates",
        label: `Créé · ${dateFrom || "…"} → ${dateTo || "…"}`,
        remove: ["dateFrom", "dateTo"],
      });
    }
    const updatedFrom = p.get("updatedFrom") ?? "";
    const updatedTo = p.get("updatedTo") ?? "";
    if (updatedFrom || updatedTo) {
      out.push({
        key: "updated-dates",
        label: `Modifié · ${updatedFrom || "…"} → ${updatedTo || "…"}`,
        remove: ["updatedFrom", "updatedTo"],
      });
    }
    const bestSeller = p.get("bestSeller") ?? "";
    if (bestSeller === "1") out.push({ key: "best", label: "Best-sellers", remove: ["bestSeller"] });
    const refresh = p.get("refresh") ?? "";
    const refreshLabel: Record<string, string> = {
      never: "Jamais rafraîchi",
      recent: "Rafraîchi récemment (30 j)",
      refreshed: "Déjà rafraîchi",
    };
    if (refresh && refreshLabel[refresh]) {
      out.push({ key: "refresh", label: refreshLabel[refresh], remove: ["refresh"] });
    }
    // Tri actif — retiré en un clic pour revenir au défaut (créé le + récent).
    const sortLabel: Record<string, string> = {
      createdAsc:   "Tri · Créé le + ancien d'abord",
      modifiedDesc: "Tri · Modifié le + récent d'abord",
      modifiedAsc:  "Tri · Modifié le + ancien d'abord",
    };
    const sortVal = p.get("sort") ?? "";
    if (sortLabel[sortVal]) {
      out.push({ key: "sort", label: sortLabel[sortVal], remove: ["sort"] });
    }
    const locked = p.get("locked") ?? "";
    if (locked === "1") out.push({ key: "locked", label: "Verrouillé", remove: ["locked"] });
    const syncRequired = p.get("syncRequired") ?? "";
    if (syncRequired === "1") out.push({ key: "sync", label: "Synchro nécessaire", remove: ["syncRequired"] });
    const missingImages = p.get("missingImages") ?? "";
    if (missingImages === "1") out.push({ key: "missing-img", label: "Variantes sans image", remove: ["missingImages"] });
    const translationStatus = p.get("translationStatus") ?? "";
    if (translationStatus === "untranslated") {
      out.push({ key: "no-trans", label: "Sans traduction", remove: ["translationStatus"] });
    } else if (translationStatus === "translated") {
      out.push({ key: "trans", label: "Traduit", remove: ["translationStatus"] });
    }

    const pfsLink = p.get("pfsLink") ?? "";
    if (pfsLink) out.push({ key: "pfs-link", label: `PFS · ${pfsLink === "linked" ? "lié" : "non lié"}`, remove: ["pfsLink"] });
    const ankorsLink = p.get("ankorsLink") ?? "";
    if (ankorsLink) out.push({ key: "ank-link", label: `ANKOR · ${ankorsLink === "linked" ? "lié" : "non lié"}`, remove: ["ankorsLink"] });
    const efashionLink = p.get("efashionLink") ?? "";
    if (efashionLink) out.push({ key: "ef-link", label: `EF · ${efashionLink === "linked" ? "lié" : "non lié"}`, remove: ["efashionLink"] });
    const faireLink = p.get("faireLink") ?? "";
    if (faireLink) out.push({ key: "fai-link", label: `Faire · ${faireLink === "linked" ? "lié" : "non lié"}`, remove: ["faireLink"] });
    const microstoreLink = p.get("microstoreLink") ?? "";
    if (microstoreLink) out.push({ key: "mc-link", label: `Microstore · ${microstoreLink === "linked" ? "lié" : "non lié"}`, remove: ["microstoreLink"] });

    const exportLabel: Record<string, string> = {
      never: "jamais",
      lt7d: "< 7 j",
      lt30d: "< 30 j",
      gt30d: "> 30 j",
      gt90d: "> 90 j",
    };
    const pfsExp = p.get("pfsExportedAt") ?? "";
    if (pfsExp) out.push({ key: "pfs-exp", label: `PFS exporté · ${exportLabel[pfsExp] ?? pfsExp}`, remove: ["pfsExportedAt"] });
    const efExp = p.get("efashionExportedAt") ?? "";
    if (efExp) out.push({ key: "ef-exp", label: `EF exporté · ${exportLabel[efExp] ?? efExp}`, remove: ["efashionExportedAt"] });
    const ankExp = p.get("ankorstoreExportedAt") ?? "";
    if (ankExp) out.push({ key: "ank-exp", label: `ANKOR exporté · ${exportLabel[ankExp] ?? ankExp}`, remove: ["ankorstoreExportedAt"] });
    const faiExp = p.get("faireExportedAt") ?? "";
    if (faiExp) out.push({ key: "fai-exp", label: `Faire exporté · ${exportLabel[faiExp] ?? faiExp}`, remove: ["faireExportedAt"] });
    const mcExp = p.get("microstoreExportedAt") ?? "";
    if (mcExp) out.push({ key: "mc-exp", label: `Microstore exporté · ${exportLabel[mcExp] ?? mcExp}`, remove: ["microstoreExportedAt"] });

    return out;
  }, [searchParams, catLabels, tagLabels, compositionLabels, hsLabels]);

  return (
    <div className="flex flex-col gap-3">
      {/* Barre principale : info + bouton Filtres */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-[12.5px] text-text-secondary font-body">
          <span className="font-semibold text-text-primary tabular-nums">{totalCount.toLocaleString("fr-FR")}</span>
          {" "}produit{totalCount > 1 ? "s" : ""}
          {activeCount > 0 && (
            <span className="text-text-muted"> · <span className="font-semibold text-ink">{activeCount}</span> filtre{activeCount > 1 ? "s" : ""} actif{activeCount > 1 ? "s" : ""}</span>
          )}
        </p>
        {!hideDetailedToggle && (
        <button
          type="button"
          onClick={onToggleDetailed}
          className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg text-[13px] font-body font-medium border transition-colors ${
            detailedOpen
              ? "bg-ink text-text-inverse border-ink"
              : activeCount > 0
              ? "bg-bg-primary text-text-primary border-ink hover:bg-bg-secondary"
              : "bg-bg-primary text-text-secondary border-border hover:border-ink hover:text-text-primary"
          }`}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 3c2.755 0 5.455.232 8.083.678.533.09.917.556.917 1.096v1.044a2.25 2.25 0 01-.659 1.591l-5.432 5.432a2.25 2.25 0 00-.659 1.591v2.927a2.25 2.25 0 01-1.244 2.013L9.75 21v-6.568a2.25 2.25 0 00-.659-1.591L3.659 7.409A2.25 2.25 0 013 5.818V4.774c0-.54.384-1.006.917-1.096A48.32 48.32 0 0112 3z" />
          </svg>
          {detailedOpen ? "Masquer les filtres" : "Filtres détaillés"}
          {activeCount > 0 && (
            <span className={`text-[10px] font-bold rounded-full min-w-[18px] h-[18px] inline-flex items-center justify-center px-1 ${
              detailedOpen ? "bg-white/20 text-white" : "bg-ink text-text-inverse"
            }`}>
              {activeCount}
            </span>
          )}
        </button>
        )}
      </div>

      {/* Pills de filtres actifs */}
      {pills.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap pt-2 border-t border-border-light">
          <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-text-muted mr-1">Filtres actifs</span>
          {pills.map((pill) => (
            <span
              key={pill.key}
              className="inline-flex items-center gap-1.5 pl-2.5 pr-1 py-0.5 rounded-full bg-bg-tertiary border border-border-strong text-[11.5px] font-medium text-text-primary leading-tight"
            >
              {pill.label}
              <button
                type="button"
                onClick={() => removeKeys(pill.remove)}
                aria-label={`Retirer le filtre ${pill.label}`}
                className="w-4 h-4 rounded-full inline-flex items-center justify-center text-text-muted hover:bg-error-bg hover:text-error transition-colors leading-none text-[13px]"
              >
                ×
              </button>
            </span>
          ))}
          <button
            type="button"
            onClick={clearAll}
            className="ml-auto inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-body font-medium text-text-muted hover:text-error hover:bg-error-bg transition-colors"
          >
            ✕ Effacer tout
          </button>
        </div>
      )}
    </div>
  );
}
