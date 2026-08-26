"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import CompactFiltersHeader from "./CompactFiltersHeader";
import CustomSelect from "@/components/ui/CustomSelect";
import { useFilterPending } from "./FilterPendingContext";
import { clampPerPage, MAX_PER_PAGE, MIN_PER_PAGE } from "@/lib/pagination";

interface CategoryOption { id: string; name: string; subCategories?: { id: string; name: string }[] }
interface TagOption { id: string; name: string }
interface CompositionOption { id: string; name: string }
interface HsCodeOption { id: string; code: string; label: string }

interface Props {
  totalCount: number;
  activeCount: number;
  categories: CategoryOption[];
  tags: TagOption[];
  compositions: CompositionOption[];
  hsCodes: HsCodeOption[];
  hasPfsConfig: boolean;
  hasAnkorstoreConfig: boolean;
  hasEfashionConfig: boolean;
  hasFaireConfig: boolean;
  hasOrderchampConfig: boolean;
  hasMicrostoreConfig: boolean;
}

type ThemeKey = "catalogue" | "price" | "status" | "marketplaces" | "sort" | "more";

/**
 * Options exposées dans le popover « Trier ». La valeur "" équivaut au tri
 * par défaut (créé le plus récent d'abord) et efface le param URL `sort`.
 * Les 4 autres valeurs sont interprétées par `buildAdminProductsOrderBy`.
 */
const SORT_OPTS = [
  { v: "",               label: "Créé — Plus récent d'abord (défaut)" },
  { v: "createdAsc",     label: "Créé — Plus ancien d'abord" },
  { v: "modifiedDesc",   label: "Modifié — Plus récent d'abord" },
  { v: "modifiedAsc",    label: "Modifié — Plus ancien d'abord" },
  { v: "importantFirst", label: "Importants d'abord" },
  // « Personnalisé » n'apparaît que quand ≥ 2 références sont saisies dans la
  // recherche — le tri suit alors l'ordre de saisie des références.
  { v: "custom",         label: "Personnalisé (ordre de saisie)" },
];

const SORT_VALUES = new Set(SORT_OPTS.map((o) => o.v).filter((v) => v !== ""));

const EXPORT_OPTS = [
  { v: "", label: "Tous" },
  { v: "never", label: "Jamais exporté" },
  { v: "lt7d", label: "< 7 jours" },
  { v: "lt30d", label: "< 30 jours" },
  { v: "gt30d", label: "> 30 jours" },
  { v: "gt90d", label: "> 90 jours" },
];

// Filtres « Rafraîchissement produit » — enum côté backend
// (buildAdminProductsWhere) : "never" = lastRefreshedAt IS NULL,
// "recent" = rafraîchi dans les 30 derniers jours, "refreshed" = déjà
// rafraîchi au moins une fois.
const REFRESH_OPTS = [
  { v: "", label: "Tous" },
  { v: "never", label: "Jamais rafraîchi" },
  { v: "recent", label: "Rafraîchi récemment (30 j)" },
  { v: "refreshed", label: "Déjà rafraîchi" },
];

// Filtre « Traduction » — vérifie la présence d'une traduction pour chaque
// locale non-FR (aujourd'hui : anglais). Miroir du compteur des avertissements
// admin.
const TRANSLATION_OPTS = [
  { v: "", label: "Tous" },
  { v: "untranslated", label: "Sans traduction" },
  { v: "translated", label: "Traduit" },
];

// Extrait au niveau module pour garder un type de composant stable :
// à l'intérieur de ThemedProductFilters, PopoverContent est recréée à
// chaque re-render → React remonte l'input date → focus perdu à chaque
// frappe. Rendu depuis le parent avec un type stable, React réconcilie
// et l'input conserve le focus.
// Vide ou YYYY-MM-DD avec une année 1900-2100 (évite "0026" quand la
// cliente tape 2 chiffres dans l'année).
function isDatePartValid(s: string): boolean {
  if (!s) return true;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const y = Number(m[1]);
  return y >= 1900 && y <= 2100;
}

function DatesFilterContent({
  dateFromDraft, setDateFromDraft,
  dateToDraft, setDateToDraft,
  updatedFromDraft, setUpdatedFromDraft,
  updatedToDraft, setUpdatedToDraft,
  datesChanged, applyDates,
}: {
  dateFromDraft: string;
  setDateFromDraft: (v: string) => void;
  dateToDraft: string;
  setDateToDraft: (v: string) => void;
  updatedFromDraft: string;
  setUpdatedFromDraft: (v: string) => void;
  updatedToDraft: string;
  setUpdatedToDraft: (v: string) => void;
  datesChanged: boolean;
  applyDates: () => void;
}) {
  const allDatesValid =
    isDatePartValid(dateFromDraft) &&
    isDatePartValid(dateToDraft) &&
    isDatePartValid(updatedFromDraft) &&
    isDatePartValid(updatedToDraft);
  const canApply = datesChanged && allDatesValid;
  const onEnter = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && canApply) applyDates();
  };
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <div className="text-[13px] font-bold uppercase tracking-[0.1em] text-text-muted">Date de création</div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[12px] text-text-secondary mb-1.5">Créé après le</label>
            <input
              type="date"
              value={dateFromDraft}
              onChange={(e) => setDateFromDraft(e.target.value)}
              onKeyDown={onEnter}
              className="w-full h-12 text-[14px] px-3 rounded-lg border border-border bg-bg-primary"
            />
          </div>
          <div>
            <label className="block text-[12px] text-text-secondary mb-1.5">Créé avant le</label>
            <input
              type="date"
              value={dateToDraft}
              onChange={(e) => setDateToDraft(e.target.value)}
              onKeyDown={onEnter}
              className="w-full h-12 text-[14px] px-3 rounded-lg border border-border bg-bg-primary"
            />
          </div>
        </div>
      </div>
      <div className="flex flex-col gap-3 border-t border-border pt-5">
        <div className="text-[13px] font-bold uppercase tracking-[0.1em] text-text-muted">Date de dernière modification</div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[12px] text-text-secondary mb-1.5">Modifié après le</label>
            <input
              type="date"
              value={updatedFromDraft}
              onChange={(e) => setUpdatedFromDraft(e.target.value)}
              onKeyDown={onEnter}
              className="w-full h-12 text-[14px] px-3 rounded-lg border border-border bg-bg-primary"
            />
          </div>
          <div>
            <label className="block text-[12px] text-text-secondary mb-1.5">Modifié avant le</label>
            <input
              type="date"
              value={updatedToDraft}
              onChange={(e) => setUpdatedToDraft(e.target.value)}
              onKeyDown={onEnter}
              className="w-full h-12 text-[14px] px-3 rounded-lg border border-border bg-bg-primary"
            />
          </div>
        </div>
      </div>
      <button
        type="button"
        onClick={applyDates}
        disabled={!canApply}
        title={
          !datesChanged
            ? "Aucun changement à appliquer"
            : !allDatesValid
            ? "Date incomplète ou année invalide"
            : "Appliquer les dates"
        }
        className={`w-full h-11 rounded-lg font-semibold text-[14px] transition-colors ${
          canApply
            ? "bg-ink text-white hover:bg-primary-hover cursor-pointer"
            : "bg-bg-secondary text-text-muted border border-border cursor-not-allowed"
        }`}
      >
        Appliquer
      </button>
    </div>
  );
}

export default function ThemedProductFilters({
  totalCount, activeCount, categories, tags, compositions, hsCodes,
  hasPfsConfig, hasAnkorstoreConfig, hasEfashionConfig, hasFaireConfig, hasOrderchampConfig, hasMicrostoreConfig,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { startFiltering: startTransition } = useFilterPending();
  const [openTheme, setOpenTheme] = useState<ThemeKey | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  // Ferme au clic extérieur (desktop : n'importe où hors du bouton/popover ;
  // mobile : le backdrop plein écran gère lui-même la fermeture via onMouseDown).
  useEffect(() => {
    if (!openTheme) return;
    const handler = (e: MouseEvent) => {
      if (!barRef.current?.contains(e.target as Node)) setOpenTheme(null);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [openTheme]);

  // Ferme via touche Échap.
  useEffect(() => {
    if (!openTheme) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpenTheme(null); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [openTheme]);

  // Verrouille le scroll de la page derrière le modal (plein écran mobile /
  // centré avec voile noir sur ≥ md — dans les deux cas la page ne défile plus).
  useEffect(() => {
    if (!openTheme) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [openTheme]);

  const setParam = useCallback((updates: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(updates)) {
      if (v && v !== "") params.set(k, v);
      else params.delete(k);
    }
    params.delete("page");
    startTransition(() => {
      router.push(`/admin/produits${params.toString() ? `?${params.toString()}` : ""}`);
    });
  }, [searchParams, router, startTransition]);

  // Helper pour les selects radio (lié/non lié). Sur mobile : boutons hauts
  // (48 px) et texte lisible ; sur desktop on garde le compact d'origine.
  function LinkRadio({ urlKey, label }: { urlKey: string; label: string }) {
    const v = searchParams.get(urlKey) ?? "";
    return (
      <div>
        <div className="text-[13px] mb-2.5 font-bold uppercase tracking-[0.1em] text-text-muted">{label}</div>
        <div className="flex gap-1.5">
          {[
            { val: "", txt: "Tous" },
            { val: "linked", txt: "Lié" },
            { val: "unlinked", txt: "Non lié" },
          ].map((opt) => (
            <button
              key={opt.val}
              type="button"
              onClick={() => setParam({ [urlKey]: opt.val })}
              className={`flex-1 text-[14px] h-12 rounded-lg border transition-colors ${
                v === opt.val
                  ? "bg-ink text-white border-ink font-semibold"
                  : "bg-bg-primary text-text-secondary border-border hover:border-ink hover:text-text-primary"
              }`}
            >
              {opt.txt}
            </button>
          ))}
        </div>
      </div>
    );
  }

  function ExportSelect({ urlKey, label }: { urlKey: string; label: string }) {
    const v = searchParams.get(urlKey) ?? "";
    return (
      <div>
        <div className="text-[13px] mb-2.5 font-bold uppercase tracking-[0.1em] text-text-muted">{label}</div>
        <CustomSelect
          value={v}
          onChange={(val) => setParam({ [urlKey]: val })}
          options={EXPORT_OPTS.map((o) => ({ value: o.v, label: o.label }))}
          size="md"
          title={label}
        />
      </div>
    );
  }

  function BoolBtn({ urlKey, label }: { urlKey: string; label: string }) {
    const v = searchParams.get(urlKey) === "1";
    return (
      <button
        type="button"
        onClick={() => setParam({ [urlKey]: v ? null : "1" })}
        className={`w-full flex items-center gap-3 px-3 min-h-[48px] rounded-lg text-[14px] border transition-colors text-left ${
          v
            ? "bg-bg-tertiary text-text-primary border-ink font-medium"
            : "bg-bg-primary text-text-secondary border-border hover:border-ink hover:text-text-primary"
        }`}
      >
        <span className={`w-5 h-5 rounded border flex items-center justify-center shrink-0 ${
          v ? "bg-ink border-ink text-white" : "bg-white border-border-dark"
        }`}>
          {v && <span className="text-[12px] font-bold">✓</span>}
        </span>
        {label}
      </button>
    );
  }

  // ─── Popover content per theme ────────────────────────────────────────────
  function PopoverContent({ theme }: { theme: ThemeKey }) {
    const cat = searchParams.get("cat") ?? "";
    const subCat = searchParams.get("subCat") ?? "";
    const tag = searchParams.get("tag") ?? "";
    const composition = searchParams.get("composition") ?? "";
    const hsCodeId = searchParams.get("hsCodeId") ?? "";
    const subCats = categories.find((c) => c.id === cat)?.subCategories ?? [];

    if (theme === "catalogue") {
      return (
        <div className="flex flex-col gap-5">
          <div>
            <div className="text-[13px] mb-2.5 font-bold uppercase tracking-[0.1em] text-text-muted">Catégorie</div>
            <CustomSelect
              value={cat}
              onChange={(val) => setParam({ cat: val, subCat: null })}
              options={[{ value: "", label: "Toutes les catégories" }, ...categories.map((c) => ({ value: c.id, label: c.name }))]}
              size="md"
              searchable
              title="Catégorie"
            />
          </div>
          {cat && subCats.length > 0 && (
            <div>
              <div className="text-[13px] mb-2.5 font-bold uppercase tracking-[0.1em] text-text-muted">Sous-catégorie</div>
              <CustomSelect
                value={subCat}
                onChange={(val) => setParam({ subCat: val })}
                options={[{ value: "", label: "Toutes les sous-catégories" }, ...subCats.map((s) => ({ value: s.id, label: s.name }))]}
                size="md"
                searchable
                title="Sous-catégorie"
              />
            </div>
          )}
          <div>
            <div className="text-[13px] mb-2.5 font-bold uppercase tracking-[0.1em] text-text-muted">Composition</div>
            <CustomSelect
              value={composition}
              onChange={(val) => setParam({ composition: val })}
              options={[{ value: "", label: "Toutes les compositions" }, ...compositions.map((c) => ({ value: c.id, label: c.name }))]}
              size="md"
              searchable
              title="Composition"
            />
          </div>
          <div>
            <div className="text-[13px] mb-2.5 font-bold uppercase tracking-[0.1em] text-text-muted">Mot-clé</div>
            <CustomSelect
              value={tag}
              onChange={(val) => setParam({ tag: val })}
              options={[{ value: "", label: "Tous les mots-clés" }, ...tags.map((t) => ({ value: t.id, label: t.name }))]}
              size="md"
              searchable
              title="Mot-clé"
            />
          </div>
          <div>
            <div className="text-[13px] mb-2.5 font-bold uppercase tracking-[0.1em] text-text-muted">Code SH</div>
            <CustomSelect
              value={hsCodeId}
              onChange={(val) => setParam({ hsCodeId: val })}
              options={[{ value: "", label: "Tous les codes SH" }, ...hsCodes.map((h) => ({ value: h.id, label: `${h.code} · ${h.label}` }))]}
              size="md"
              searchable
              title="Code SH"
            />
          </div>
        </div>
      );
    }

    if (theme === "price") {
      const minPrice = searchParams.get("minPrice") ?? "";
      const maxPrice = searchParams.get("maxPrice") ?? "";
      const stockBelow = searchParams.get("stockBelow") ?? "";
      return (
        <div className="flex flex-col gap-5">
          <div>
            <div className="text-[13px] mb-2.5 font-bold uppercase tracking-[0.1em] text-text-muted">Fourchette de prix (€)</div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                placeholder="Min"
                defaultValue={minPrice}
                onBlur={(e) => setParam({ minPrice: e.target.value })}
                onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                className="flex-1 min-w-0 w-full h-12 text-[14px] px-3 rounded-lg border border-border bg-bg-primary"
              />
              <span className="text-text-muted shrink-0">–</span>
              <input
                type="number"
                placeholder="Max"
                defaultValue={maxPrice}
                onBlur={(e) => setParam({ maxPrice: e.target.value })}
                onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                className="flex-1 min-w-0 w-full h-12 text-[14px] px-3 rounded-lg border border-border bg-bg-primary"
              />
            </div>
            <div className="text-[11px] text-text-muted mt-1.5">Entrée ou clic ailleurs pour appliquer</div>
          </div>
          <div>
            <div className="text-[13px] mb-2.5 font-bold uppercase tracking-[0.1em] text-text-muted">Stock inférieur à</div>
            <input
              type="number"
              placeholder="ex. 5"
              defaultValue={stockBelow}
              onBlur={(e) => setParam({ stockBelow: e.target.value })}
              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
              className="w-full h-12 text-[14px] px-3 rounded-lg border border-border bg-bg-primary"
            />
          </div>
        </div>
      );
    }

    if (theme === "status") {
      const refresh = searchParams.get("refresh") ?? "";
      const translationStatus = searchParams.get("translationStatus") ?? "";
      return (
        <div className="flex flex-col gap-5">
          <div>
            <div className="text-[13px] mb-2.5 font-bold uppercase tracking-[0.1em] text-text-muted">Rafraîchissement</div>
            <CustomSelect
              value={refresh}
              onChange={(val) => setParam({ refresh: val })}
              options={REFRESH_OPTS.map((o) => ({ value: o.v, label: o.label }))}
              size="md"
              title="Rafraîchissement"
            />
          </div>
          <div>
            <div className="text-[13px] mb-2.5 font-bold uppercase tracking-[0.1em] text-text-muted">Traduction</div>
            <CustomSelect
              value={translationStatus}
              onChange={(val) => setParam({ translationStatus: val })}
              options={TRANSLATION_OPTS.map((o) => ({ value: o.v, label: o.label }))}
              size="md"
              title="Traduction"
            />
          </div>
          <div className="flex flex-col gap-2.5">
            <BoolBtn urlKey="important" label="⭐ Importants seulement" />
            <BoolBtn urlKey="bestSeller" label="Best-sellers uniquement" />
            <BoolBtn urlKey="syncRequired" label="Synchro nécessaire" />
            <BoolBtn urlKey="missingImages" label="Variantes sans image" />
            <BoolBtn urlKey="locked" label="Verrouillés" />
          </div>
        </div>
      );
    }

    if (theme === "marketplaces") {
      return (
        <div className="flex flex-col gap-5">
          {hasPfsConfig && <LinkRadio urlKey="pfsLink" label="Lien PFS" />}
          {hasEfashionConfig && <LinkRadio urlKey="efashionLink" label="Lien EF" />}
          {hasAnkorstoreConfig && <LinkRadio urlKey="ankorsLink" label="Lien ANKOR" />}
          {hasFaireConfig && <LinkRadio urlKey="faireLink" label="Lien Faire" />}
          {hasOrderchampConfig && <LinkRadio urlKey="orderchampLink" label="Lien Orderchamp" />}
          {hasMicrostoreConfig && <LinkRadio urlKey="microstoreLink" label="Lien Microstore" />}
          {/* Vérification PFS — alimenté par la pastille dans la colonne
              Produit (lib/pfs-verify.ts). Ne concerne que les produits liés. */}
          {hasPfsConfig && (
            <div>
              <div className="text-[13px] mb-2.5 font-bold uppercase tracking-[0.1em] text-text-muted">
                Vérification PFS
              </div>
              <CustomSelect
                value={searchParams.get("pfsVerify") ?? ""}
                onChange={(val) => setParam({ pfsVerify: val })}
                options={[
                  { value: "", label: "Tous" },
                  { value: "diff", label: "Vérif avec écarts" },
                  { value: "ok", label: "Vérif conforme" },
                  { value: "unchecked", label: "Jamais vérifié" },
                ]}
                size="md"
                title="Vérification PFS"
              />
            </div>
          )}
          <div className="border-t border-border pt-5 flex flex-col gap-4">
            {hasPfsConfig && <ExportSelect urlKey="pfsExportedAt" label="Dernier export PFS" />}
            {hasEfashionConfig && <ExportSelect urlKey="efashionExportedAt" label="Dernier export EF" />}
            {hasAnkorstoreConfig && <ExportSelect urlKey="ankorstoreExportedAt" label="Dernier export ANKOR" />}
            {hasFaireConfig && <ExportSelect urlKey="faireExportedAt" label="Dernier export Faire" />}
            {hasOrderchampConfig && <ExportSelect urlKey="orderchampExportedAt" label="Dernier export Orderchamp" />}
            {hasMicrostoreConfig && <ExportSelect urlKey="microstoreExportedAt" label="Dernier export Microstore" />}
          </div>
        </div>
      );
    }

    if (theme === "sort") {
      const raw = searchParams.get("sort") ?? "";
      const v = SORT_VALUES.has(raw) ? raw : "";
      return (
        <div className="flex flex-col gap-5">
          <div>
            <div className="text-[13px] mb-2.5 font-bold uppercase tracking-[0.1em] text-text-muted">
              Trier les produits par
            </div>
            <CustomSelect
              value={v}
              onChange={(val) => setParam({ sort: val })}
              options={SORT_OPTS.map((o) => ({ value: o.v, label: o.label }))}
              size="md"
              title="Trier les produits par"
            />
            <div className="text-[11px] text-text-muted mt-2 leading-relaxed">
              « Créé » = date de création du produit. « Modifié » = dernière
              modification (édition de la fiche).
            </div>
          </div>
        </div>
      );
    }

    // theme === "more" (« Dates ») — rendu par DatesFilterContent au niveau
    // module (voir plus bas dans le return du parent) pour ne PAS être
    // remonté à chaque re-render. Fallback ici pour satisfaire TS.
    return null;
  }

  // ─── Helpers : compte de filtres par thème (badges sur les boutons) ──────
  function countForTheme(theme: ThemeKey): number {
    let n = 0;
    const has = (k: string) => !!(searchParams.get(k) && searchParams.get(k) !== "");
    if (theme === "catalogue") {
      ["cat", "subCat", "tag", "composition", "hsCodeId"].forEach((k) => has(k) && n++);
    } else if (theme === "price") {
      ["minPrice", "maxPrice", "stockBelow"].forEach((k) => has(k) && n++);
    } else if (theme === "status") {
      ["important", "bestSeller", "syncRequired", "missingImages", "locked"].forEach((k) => {
        if (searchParams.get(k) === "1") n++;
      });
      // `refresh` est un enum ("never" | "recent" | "refreshed") — toute
      // valeur non vide compte comme un filtre actif.
      if (has("refresh")) n++;
      if (has("translationStatus")) n++;
    } else if (theme === "marketplaces") {
      ["pfsLink", "ankorsLink", "efashionLink", "faireLink", "orderchampLink", "microstoreLink", "pfsVerify",
       "pfsExportedAt", "ankorstoreExportedAt", "efashionExportedAt", "faireExportedAt", "orderchampExportedAt", "microstoreExportedAt"].forEach((k) => has(k) && n++);
    } else if (theme === "sort") {
      // Actif seulement si `sort` porte une valeur reconnue.
      const raw = searchParams.get("sort") ?? "";
      if (SORT_VALUES.has(raw)) n++;
    } else if (theme === "more") {
      ["dateFrom", "dateTo", "updatedFrom", "updatedTo"].forEach((k) => has(k) && n++);
    }
    return n;
  }

  const THEMES: { key: ThemeKey; emoji: string; label: string }[] = [
    { key: "catalogue", emoji: "📦", label: "Catalogue" },
    { key: "price", emoji: "💶", label: "Prix & stock" },
    { key: "status", emoji: "⚡", label: "État" },
    { key: "marketplaces", emoji: "🛒", label: "Marketplaces" },
    { key: "sort", emoji: "⇅", label: "Trier" },
    { key: "more", emoji: "📅", label: "Dates" },
  ];

  // Clés URL à effacer quand la cliente tape « Effacer » dans le sheet mobile
  // — miroir de countForTheme() pour garder les deux en phase.
  const CLEAR_KEYS: Record<ThemeKey, string[]> = {
    catalogue:    ["cat", "subCat", "tag", "composition", "hsCodeId"],
    price:        ["minPrice", "maxPrice", "stockBelow"],
    status:       ["important", "bestSeller", "syncRequired", "missingImages", "locked", "refresh", "translationStatus"],
    marketplaces: ["pfsLink", "ankorsLink", "efashionLink", "faireLink", "orderchampLink", "microstoreLink", "pfsVerify",
                   "pfsExportedAt", "ankorstoreExportedAt", "efashionExportedAt", "faireExportedAt", "orderchampExportedAt", "microstoreExportedAt"],
    sort:         ["sort"],
    more:         ["dateFrom", "dateTo", "updatedFrom", "updatedTo"],
  };

  function clearTheme(theme: ThemeKey) {
    const updates: Record<string, string | null> = {};
    CLEAR_KEYS[theme].forEach((k) => { updates[k] = null; });
    setParam(updates);
    if (theme === "more") {
      setDateFromDraft("");
      setDateToDraft("");
      setUpdatedFromDraft("");
      setUpdatedToDraft("");
    }
  }

  // ─── Recherche multi-références : Entrée ajoute un badge ─────────────────
  const q = searchParams.get("q") ?? "";
  const initialTerms = q ? q.split(",").map((t) => t.trim()).filter(Boolean) : [];
  const [localTerms, setLocalTerms] = useState<string[]>(initialTerms);
  const [draft, setDraft] = useState("");
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  // Édition inline d'un badge : `editingIdx` = index du badge en cours d'édition
  // (clic sur la ref). `editingDraft` = valeur en cours dans son input. Enter
  // valide, Échap annule.
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editingDraft, setEditingDraft] = useState("");
  const editInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const exactRef = searchParams.get("exactRef") === "1";
  const perPage = searchParams.get("perPage") ?? "20";
  const [perPageDraft, setPerPageDraft] = useState(perPage);

  // Drafts locaux pour les 4 filtres date : on ne commit que sur clic
  // « Appliquer ». `defaultValue` + `onBlur` étaient perdus quand le
  // sélecteur natif fermait le popover avant le blur.
  const dateFromUrl = searchParams.get("dateFrom") ?? "";
  const dateToUrl = searchParams.get("dateTo") ?? "";
  const updatedFromUrl = searchParams.get("updatedFrom") ?? "";
  const updatedToUrl = searchParams.get("updatedTo") ?? "";
  const [dateFromDraft, setDateFromDraft] = useState(dateFromUrl);
  const [dateToDraft, setDateToDraft] = useState(dateToUrl);
  const [updatedFromDraft, setUpdatedFromDraft] = useState(updatedFromUrl);
  const [updatedToDraft, setUpdatedToDraft] = useState(updatedToUrl);
  useEffect(() => { setDateFromDraft(dateFromUrl); }, [dateFromUrl]);
  useEffect(() => { setDateToDraft(dateToUrl); }, [dateToUrl]);
  useEffect(() => { setUpdatedFromDraft(updatedFromUrl); }, [updatedFromUrl]);
  useEffect(() => { setUpdatedToDraft(updatedToUrl); }, [updatedToUrl]);
  const datesChanged =
    dateFromDraft !== dateFromUrl ||
    dateToDraft !== dateToUrl ||
    updatedFromDraft !== updatedFromUrl ||
    updatedToDraft !== updatedToUrl;
  function applyDates() {
    setParam({
      dateFrom: dateFromDraft || null,
      dateTo: dateToDraft || null,
      updatedFrom: updatedFromDraft || null,
      updatedTo: updatedToDraft || null,
    });
  }

  // Auto-bascule du tri sur « Personnalisé » quand la cliente a ≥ 2 références
  // saisies et qu'aucun tri explicite n'est posé. Retrait auto quand on
  // redescend à < 2 refs (pour retomber sur le défaut). Toute autre valeur de
  // `sort` (choix explicite) est respectée sans être écrasée.
  useEffect(() => {
    const urlTerms = q ? q.split(",").map((t) => t.trim()).filter(Boolean) : [];
    const urlSort = searchParams.get("sort") ?? "";
    if (urlTerms.length >= 2 && urlSort === "") {
      setParam({ sort: "custom" });
    } else if (urlTerms.length < 2 && urlSort === "custom") {
      setParam({ sort: null });
    }
  }, [q, searchParams, setParam]);

  // Autofocus + sélection totale à l'ouverture d'un input d'édition inline.
  useEffect(() => {
    if (editingIdx !== null && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingIdx]);

  // Sync depuis URL si l'utilisateur navigue (ex. effacer tout)
  useEffect(() => {
    const urlTerms = q ? q.split(",").map((t) => t.trim()).filter(Boolean) : [];
    setLocalTerms(urlTerms);
  }, [q]);

  useEffect(() => {
    setPerPageDraft(perPage);
  }, [perPage]);

  function applyPerPage() {
    const next = clampPerPage(perPageDraft, parseInt(perPage, 10) || 20);
    if (next === null) {
      setPerPageDraft(perPage);
      return;
    }
    setPerPageDraft(String(next));
    if (String(next) === perPage) return;
    setParam({ perPage: String(next) });
  }

  function commitDraft(): string | null {
    const v = draft.trim();
    if (!v) return null;
    if (!localTerms.includes(v)) {
      setLocalTerms([...localTerms, v]);
    }
    setDraft("");
    return v;
  }

  function applyTerms(terms: string[]) {
    setParam({ q: terms.join(",") });
  }

  function removeTerm(idx: number) {
    const next = localTerms.filter((_, i) => i !== idx);
    setLocalTerms(next);
    if (q) applyTerms(next);
  }

  function startEditTerm(idx: number) {
    setEditingIdx(idx);
    setEditingDraft(localTerms[idx] ?? "");
  }

  function cancelEditTerm() {
    setEditingIdx(null);
    setEditingDraft("");
  }

  function commitEditTerm() {
    if (editingIdx === null) return;
    const v = editingDraft.trim();
    if (!v) {
      // Vide → on considère que la cliente veut supprimer le badge.
      removeTerm(editingIdx);
      cancelEditTerm();
      return;
    }
    const next = [...localTerms];
    next[editingIdx] = v;
    setLocalTerms(next);
    applyTerms(next);
    cancelEditTerm();
  }

  async function copyTerm(term: string, idx: number) {
    try {
      await navigator.clipboard.writeText(term);
      setCopiedIdx(idx);
      window.setTimeout(() => setCopiedIdx((c) => (c === idx ? null : c)), 1200);
    } catch {
      // silencieux
    }
  }

  function submitSearch() {
    const v = draft.trim();
    if (v) {
      const next = localTerms.includes(v) ? localTerms : [...localTerms, v];
      setLocalTerms(next);
      setDraft("");
      applyTerms(next);
    } else {
      applyTerms(localTerms);
    }
  }

  function handleSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      submitSearch();
    } else if (e.key === "," || e.key === "Tab") {
      if (draft.trim().length > 0) {
        e.preventDefault();
        commitDraft();
      }
    } else if (e.key === "Backspace" && draft.length === 0 && localTerms.length > 0) {
      e.preventDefault();
      removeTerm(localTerms.length - 1);
    }
  }

  function clearAll() {
    setLocalTerms([]);
    setDraft("");
    setDateFromDraft("");
    setDateToDraft("");
    setUpdatedFromDraft("");
    setUpdatedToDraft("");
    startTransition(() => { router.push("/admin/produits"); });
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Recherche + Réf. exacte + perPage + Effacer */}
      <div className="flex items-center gap-2 flex-wrap">
        <div
          className="relative w-full sm:w-auto sm:flex-1 sm:min-w-[240px] flex flex-wrap items-center gap-1.5 pl-9 pr-2 py-1.5 bg-bg-primary border border-border-strong rounded-lg shadow-[var(--shadow-card)] focus-within:border-ink focus-within:ring-2 focus-within:ring-ink/10 cursor-text"
          onClick={() => inputRef.current?.focus()}
        >
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); submitSearch(); inputRef.current?.focus(); }}
            aria-label="Lancer la recherche"
            title="Lancer la recherche"
            className="absolute left-2 top-1/2 -translate-y-1/2 p-1 rounded-md text-text-muted opacity-60 hover:opacity-100 hover:bg-bg-secondary cursor-pointer transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-ink/30"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M21 21l-4.35-4.35M17 10a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </button>
          {localTerms.map((term, idx) => {
            const isCopied = copiedIdx === idx;
            const isEditing = editingIdx === idx;
            if (isEditing) {
              return (
                <span
                  key={`edit-${idx}`}
                  className="inline-flex items-center gap-1 bg-ink text-text-inverse text-[12.5px] font-body pl-2 pr-1 py-0.5 rounded-md ring-2 ring-ink/30"
                  onClick={(e) => e.stopPropagation()}
                >
                  <input
                    ref={editInputRef}
                    type="text"
                    value={editingDraft}
                    onChange={(e) => setEditingDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        e.stopPropagation();
                        commitEditTerm();
                      } else if (e.key === "Escape") {
                        e.preventDefault();
                        e.stopPropagation();
                        cancelEditTerm();
                      }
                    }}
                    onBlur={commitEditTerm}
                    aria-label={`Modifier la référence ${term}`}
                    className="bg-transparent border-none focus:outline-none font-mono text-[12.5px] py-1 min-w-[60px]"
                    size={Math.max(6, editingDraft.length + 1)}
                  />
                </span>
              );
            }
            return (
              <span
                key={`${term}-${idx}`}
                className="inline-flex items-center gap-1.5 bg-ink text-text-inverse text-[12.5px] font-body px-2.5 py-1 rounded-md"
              >
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); startEditTerm(idx); }}
                  className="font-mono leading-none hover:underline decoration-dotted underline-offset-2"
                  title="Cliquer pour modifier la référence"
                  aria-label={`Modifier ${term}`}
                >
                  {term}
                </button>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); copyTerm(term, idx); }}
                  className={`leading-none transition-colors ${
                    isCopied ? "text-[#4ADE80]" : "text-text-inverse/70 hover:text-text-inverse"
                  }`}
                  title={isCopied ? "Référence copiée !" : "Copier la référence"}
                  aria-label={isCopied ? `${term} copié` : `Copier ${term}`}
                >
                  {isCopied ? (
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                    </svg>
                  )}
                </button>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); removeTerm(idx); }}
                  className="text-text-inverse/70 hover:text-text-inverse leading-none text-base"
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
            placeholder={localTerms.length === 0 ? "Rechercher une ou plusieurs références…" : "Ajouter…"}
            className="flex-1 min-w-[110px] py-1 bg-bg-primary border-none focus:outline-none text-[13px] font-body text-text-primary placeholder:text-text-muted"
          />
        </div>
        {/* Réf. exacte toggle */}
        <button
          type="button"
          onClick={() => setParam({ exactRef: exactRef ? null : "1" })}
          title="Recherche exacte de la référence"
          className={`inline-flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-[12.5px] font-medium border transition-colors flex-1 sm:flex-none sm:shrink-0 ${
            exactRef
              ? "bg-ink text-white border-ink"
              : "bg-white text-text-secondary border-border-strong hover:border-ink hover:text-text-primary"
          }`}
        >
          <span className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
            exactRef ? "bg-white text-ink border-white" : "bg-white border-border-dark"
          }`}>
            {exactRef && <span className="text-[10px] font-bold">✓</span>}
          </span>
          Réf. exacte
        </button>
        {/* Per page — saisie libre (min 1, max 500) */}
        <div className="inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border-strong bg-white flex-1 sm:flex-none sm:shrink-0">
          <span className="text-[11px] text-text-muted font-body whitespace-nowrap">Afficher</span>
          <input
            type="number"
            min={MIN_PER_PAGE}
            max={MAX_PER_PAGE}
            value={perPageDraft}
            onChange={(e) => setPerPageDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                applyPerPage();
              }
            }}
            onBlur={applyPerPage}
            aria-label="Nombre de produits par page"
            title={`Entre ${MIN_PER_PAGE} et ${MAX_PER_PAGE}`}
            className="w-14 h-7 px-1.5 text-[12px] text-center font-medium border border-border rounded-md bg-bg-secondary focus:outline-none focus:border-ink transition-colors tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          />
          <span className="text-[11px] text-text-muted whitespace-nowrap tabular-nums">
            / {totalCount.toLocaleString("fr-FR")}
          </span>
        </div>
        {/* Effacer tous les filtres */}
        {activeCount > 0 && (
          <button
            type="button"
            onClick={clearAll}
            title="Effacer tous les filtres"
            className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg text-[12.5px] font-medium border border-[#FECACA] bg-[#FEF2F2] text-[#DC2626] hover:bg-[#FEE2E2] hover:border-[#FCA5A5] transition-colors shrink-0 w-full sm:w-auto"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
            Effacer ({activeCount})
          </button>
        )}
      </div>

      {/* 5 boutons-thèmes */}
      <div ref={barRef} className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-start">
        {THEMES.map((t) => {
          const count = countForTheme(t.key);
          const active = count > 0;
          const isOpen = openTheme === t.key;
          return (
            <div key={t.key} className="relative">
              <button
                type="button"
                onClick={() => setOpenTheme(isOpen ? null : t.key)}
                className={`w-full sm:w-auto inline-flex items-center justify-center sm:justify-start gap-2 px-3 py-2 rounded-lg text-[12.5px] font-medium border transition-colors shadow-[var(--shadow-card)] ${
                  isOpen
                    ? "bg-ink text-white border-ink"
                    : active
                    ? "bg-white text-text-primary border-ink"
                    : "bg-white text-text-secondary border-border-strong hover:border-ink hover:text-text-primary"
                }`}
              >
                <span aria-hidden>{t.emoji}</span>
                {t.label}
                {count > 0 && (
                  <span className={`text-[10px] font-bold px-1.5 py-px rounded-full ${
                    isOpen ? "bg-white/20 text-white" : "bg-ink text-white"
                  }`}>{count}</span>
                )}
                <svg className={`w-3 h-3 opacity-60 transition-transform ${isOpen ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {isOpen && (
                <div
                  onMouseDown={(e) => e.stopPropagation()}
                  className="fixed inset-0 z-[9500] flex md:items-center md:justify-center md:p-4"
                  role="dialog"
                  aria-modal="true"
                  aria-label={`Filtre ${t.label}`}
                >
                  {/* Voile noir — visible ≥ md (mobile prend tout l'écran) */}
                  <button
                    type="button"
                    aria-label="Fermer"
                    tabIndex={-1}
                    onClick={() => setOpenTheme(null)}
                    className="hidden md:block absolute inset-0 bg-black/55 backdrop-blur-[2px] cursor-default"
                  />
                  {/* Modal : plein écran mobile / centré desktop */}
                  <div className="relative w-full h-full flex flex-col bg-bg-primary md:w-[min(92vw,460px)] md:h-auto md:max-h-[85vh] md:rounded-2xl md:shadow-[0_24px_60px_rgba(0,0,0,0.25)] md:overflow-hidden">
                    {/* Header — flèche retour mobile, croix desktop */}
                    <div className="shrink-0 border-b border-border md:border-border-light bg-bg-primary px-4 pb-3 md:px-5 md:pt-5 pt-[max(env(safe-area-inset-top),16px)]">
                      <div className="flex items-center gap-3 md:items-start">
                        <button
                          type="button"
                          onClick={() => setOpenTheme(null)}
                          aria-label="Retour"
                          className="md:hidden shrink-0 w-11 h-11 rounded-full bg-bg-secondary hover:bg-bg-tertiary text-text-primary flex items-center justify-center"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                          </svg>
                        </button>
                        <div className="flex-1 min-w-0">
                          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-text-muted">Filtre</p>
                          <h3 className="font-heading text-lg font-bold text-text-primary truncate">
                            {t.emoji} {t.label}
                          </h3>
                        </div>
                        <button
                          type="button"
                          onClick={() => setOpenTheme(null)}
                          aria-label="Fermer"
                          className="hidden md:flex shrink-0 w-9 h-9 rounded-full bg-bg-secondary hover:bg-bg-tertiary text-text-secondary items-center justify-center text-xl leading-none"
                        >
                          ×
                        </button>
                      </div>
                    </div>

                    {/* Body */}
                    <div className="flex-1 overflow-y-auto px-4 py-4 md:px-5">
                      {t.key === "more" ? (
                        <DatesFilterContent
                          dateFromDraft={dateFromDraft}
                          setDateFromDraft={setDateFromDraft}
                          dateToDraft={dateToDraft}
                          setDateToDraft={setDateToDraft}
                          updatedFromDraft={updatedFromDraft}
                          setUpdatedFromDraft={setUpdatedFromDraft}
                          updatedToDraft={updatedToDraft}
                          setUpdatedToDraft={setUpdatedToDraft}
                          datesChanged={datesChanged}
                          applyDates={applyDates}
                        />
                      ) : (
                        <PopoverContent theme={t.key} />
                      )}
                    </div>

                    {/* Footer d'actions (mobile + desktop) — le voile noir cache
                        les résultats, donc « Voir les résultats » a du sens
                        aussi en tablette / PC pour fermer le modal. */}
                    <div className="border-t border-border p-3 md:px-5 md:py-3 flex items-center gap-2 shrink-0 pb-[max(env(safe-area-inset-bottom),12px)] md:pb-3">
                      <button
                        type="button"
                        onClick={() => clearTheme(t.key)}
                        disabled={count === 0}
                        className="flex-1 h-11 rounded-lg border border-border bg-bg-primary text-text-secondary font-medium text-[13px] hover:bg-bg-secondary disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        Effacer
                      </button>
                      <button
                        type="button"
                        onClick={() => setOpenTheme(null)}
                        className="flex-[2] h-11 rounded-lg bg-ink text-white font-semibold text-[14px] hover:bg-primary-hover"
                      >
                        Voir les résultats
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Pills + total via le composant existant */}
      <CompactFiltersHeader
        totalCount={totalCount}
        activeCount={activeCount}
        detailedOpen={false}
        onToggleDetailed={() => { /* géré via les popovers maintenant */ }}
        categories={categories}
        tags={tags}
        compositions={compositions}
        hsCodes={hsCodes}
        hideDetailedToggle
      />
    </div>
  );
}
