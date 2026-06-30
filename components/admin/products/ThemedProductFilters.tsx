"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import CompactFiltersHeader from "./CompactFiltersHeader";
import CustomSelect from "@/components/ui/CustomSelect";

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
}

type ThemeKey = "catalogue" | "price" | "status" | "marketplaces" | "more";

const EXPORT_OPTS = [
  { v: "", label: "Tous" },
  { v: "never", label: "Jamais exporté" },
  { v: "lt7d", label: "< 7 jours" },
  { v: "lt30d", label: "< 30 jours" },
  { v: "gt30d", label: "> 30 jours" },
  { v: "gt90d", label: "> 90 jours" },
];

export default function ThemedProductFilters({
  totalCount, activeCount, categories, tags, compositions, hsCodes,
  hasPfsConfig, hasAnkorstoreConfig, hasEfashionConfig, hasFaireConfig,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();
  const [openTheme, setOpenTheme] = useState<ThemeKey | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  // Ferme au clic extérieur
  useEffect(() => {
    if (!openTheme) return;
    const handler = (e: MouseEvent) => {
      if (!barRef.current?.contains(e.target as Node)) setOpenTheme(null);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
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

  // Helper pour les selects radio (lié/non lié)
  function LinkRadio({ urlKey, label }: { urlKey: string; label: string }) {
    const v = searchParams.get(urlKey) ?? "";
    return (
      <div>
        <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-text-muted mb-1.5">{label}</div>
        <div className="flex gap-1">
          {[
            { val: "", txt: "Tous" },
            { val: "linked", txt: "Lié" },
            { val: "unlinked", txt: "Non lié" },
          ].map((opt) => (
            <button
              key={opt.val}
              type="button"
              onClick={() => setParam({ [urlKey]: opt.val })}
              className={`flex-1 text-[12px] py-1.5 rounded-md border transition-colors ${
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
        <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-text-muted mb-1.5">{label}</div>
        <CustomSelect
          value={v}
          onChange={(val) => setParam({ [urlKey]: val })}
          options={EXPORT_OPTS.map((o) => ({ value: o.v, label: o.label }))}
          size="sm"
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
        className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-md text-[12.5px] border transition-colors text-left ${
          v
            ? "bg-bg-tertiary text-text-primary border-ink font-medium"
            : "bg-bg-primary text-text-secondary border-border hover:border-ink hover:text-text-primary"
        }`}
      >
        <span className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
          v ? "bg-ink border-ink text-white" : "bg-white border-border-dark"
        }`}>
          {v && <span className="text-[10px] font-bold">✓</span>}
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
        <div className="flex flex-col gap-3">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-text-muted mb-1.5">Catégorie</div>
            <CustomSelect
              value={cat}
              onChange={(val) => setParam({ cat: val, subCat: null })}
              options={[{ value: "", label: "Toutes les catégories" }, ...categories.map((c) => ({ value: c.id, label: c.name }))]}
              size="sm"
              searchable
            />
          </div>
          {cat && subCats.length > 0 && (
            <div>
              <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-text-muted mb-1.5">Sous-catégorie</div>
              <CustomSelect
                value={subCat}
                onChange={(val) => setParam({ subCat: val })}
                options={[{ value: "", label: "Toutes les sous-catégories" }, ...subCats.map((s) => ({ value: s.id, label: s.name }))]}
                size="sm"
                searchable
              />
            </div>
          )}
          <div>
            <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-text-muted mb-1.5">Composition</div>
            <CustomSelect
              value={composition}
              onChange={(val) => setParam({ composition: val })}
              options={[{ value: "", label: "Toutes les compositions" }, ...compositions.map((c) => ({ value: c.id, label: c.name }))]}
              size="sm"
              searchable
            />
          </div>
          <div>
            <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-text-muted mb-1.5">Mot-clé</div>
            <CustomSelect
              value={tag}
              onChange={(val) => setParam({ tag: val })}
              options={[{ value: "", label: "Tous les mots-clés" }, ...tags.map((t) => ({ value: t.id, label: t.name }))]}
              size="sm"
              searchable
            />
          </div>
          <div>
            <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-text-muted mb-1.5">Code SH</div>
            <CustomSelect
              value={hsCodeId}
              onChange={(val) => setParam({ hsCodeId: val })}
              options={[{ value: "", label: "Tous les codes SH" }, ...hsCodes.map((h) => ({ value: h.id, label: `${h.code} · ${h.label}` }))]}
              size="sm"
              searchable
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
        <div className="flex flex-col gap-3">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-text-muted mb-1.5">Fourchette de prix (€)</div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                placeholder="Min"
                defaultValue={minPrice}
                onBlur={(e) => setParam({ minPrice: e.target.value })}
                onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                className="flex-1 text-[12.5px] px-2.5 py-1.5 rounded-md border border-border bg-bg-primary"
              />
              <span className="text-text-muted">–</span>
              <input
                type="number"
                placeholder="Max"
                defaultValue={maxPrice}
                onBlur={(e) => setParam({ maxPrice: e.target.value })}
                onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                className="flex-1 text-[12.5px] px-2.5 py-1.5 rounded-md border border-border bg-bg-primary"
              />
            </div>
            <div className="text-[10px] text-text-muted mt-1">Entrée ou clic ailleurs pour appliquer</div>
          </div>
          <div>
            <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-text-muted mb-1.5">Stock inférieur à</div>
            <input
              type="number"
              placeholder="ex. 5"
              defaultValue={stockBelow}
              onBlur={(e) => setParam({ stockBelow: e.target.value })}
              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
              className="w-full text-[12.5px] px-2.5 py-1.5 rounded-md border border-border bg-bg-primary"
            />
          </div>
        </div>
      );
    }

    if (theme === "status") {
      return (
        <div className="flex flex-col gap-2">
          <BoolBtn urlKey="bestSeller" label="Best-sellers uniquement" />
          <BoolBtn urlKey="refresh" label="Nouveautés (30 derniers j)" />
          <BoolBtn urlKey="syncRequired" label="Synchro nécessaire" />
          <BoolBtn urlKey="missingImages" label="Variantes sans image" />
          <BoolBtn urlKey="locked" label="Verrouillés" />
        </div>
      );
    }

    if (theme === "marketplaces") {
      return (
        <div className="flex flex-col gap-3">
          {hasPfsConfig && <LinkRadio urlKey="pfsLink" label="Lien PFS" />}
          {hasEfashionConfig && <LinkRadio urlKey="efashionLink" label="Lien EF" />}
          {hasAnkorstoreConfig && <LinkRadio urlKey="ankorsLink" label="Lien ANKOR" />}
          {hasFaireConfig && <LinkRadio urlKey="faireLink" label="Lien Faire" />}
          <div className="border-t border-border pt-3 flex flex-col gap-2.5">
            {hasPfsConfig && <ExportSelect urlKey="pfsExportedAt" label="Dernier export PFS" />}
            {hasEfashionConfig && <ExportSelect urlKey="efashionExportedAt" label="Dernier export EF" />}
            {hasAnkorstoreConfig && <ExportSelect urlKey="ankorstoreExportedAt" label="Dernier export ANKOR" />}
            {hasFaireConfig && <ExportSelect urlKey="faireExportedAt" label="Dernier export Faire" />}
          </div>
        </div>
      );
    }

    // theme === "more"
    const dateFrom = searchParams.get("dateFrom") ?? "";
    const dateTo = searchParams.get("dateTo") ?? "";
    return (
      <div className="flex flex-col gap-3">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-text-muted mb-1.5">Date de création</div>
          <div className="flex items-center gap-2">
            <input
              type="date"
              defaultValue={dateFrom}
              onBlur={(e) => setParam({ dateFrom: e.target.value })}
              className="flex-1 text-[12.5px] px-2.5 py-1.5 rounded-md border border-border bg-bg-primary"
            />
            <span className="text-text-muted">→</span>
            <input
              type="date"
              defaultValue={dateTo}
              onBlur={(e) => setParam({ dateTo: e.target.value })}
              className="flex-1 text-[12.5px] px-2.5 py-1.5 rounded-md border border-border bg-bg-primary"
            />
          </div>
        </div>
      </div>
    );
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
      ["bestSeller", "refresh", "syncRequired", "missingImages", "locked"].forEach((k) => {
        if (searchParams.get(k) === "1") n++;
      });
    } else if (theme === "marketplaces") {
      ["pfsLink", "ankorsLink", "efashionLink", "faireLink",
       "pfsExportedAt", "ankorstoreExportedAt", "efashionExportedAt", "faireExportedAt"].forEach((k) => has(k) && n++);
    } else if (theme === "more") {
      ["dateFrom", "dateTo"].forEach((k) => has(k) && n++);
    }
    return n;
  }

  const THEMES: { key: ThemeKey; emoji: string; label: string }[] = [
    { key: "catalogue", emoji: "📦", label: "Catalogue" },
    { key: "price", emoji: "💶", label: "Prix & stock" },
    { key: "status", emoji: "⚡", label: "État" },
    { key: "marketplaces", emoji: "🛒", label: "Marketplaces" },
    { key: "more", emoji: "⋯", label: "Plus" },
  ];

  // ─── Recherche multi-références : Entrée ajoute un badge ─────────────────
  const q = searchParams.get("q") ?? "";
  const initialTerms = q ? q.split(",").map((t) => t.trim()).filter(Boolean) : [];
  const [localTerms, setLocalTerms] = useState<string[]>(initialTerms);
  const [draft, setDraft] = useState("");
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const exactRef = searchParams.get("exactRef") === "1";
  const perPage = searchParams.get("perPage") ?? "20";

  // Sync depuis URL si l'utilisateur navigue (ex. effacer tout)
  useEffect(() => {
    const urlTerms = q ? q.split(",").map((t) => t.trim()).filter(Boolean) : [];
    setLocalTerms(urlTerms);
  }, [q]);

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

  async function copyTerm(term: string, idx: number) {
    try {
      await navigator.clipboard.writeText(term);
      setCopiedIdx(idx);
      window.setTimeout(() => setCopiedIdx((c) => (c === idx ? null : c)), 1200);
    } catch {
      // silencieux
    }
  }

  function handleSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      const v = draft.trim();
      if (v) {
        const next = localTerms.includes(v) ? localTerms : [...localTerms, v];
        setLocalTerms(next);
        setDraft("");
        applyTerms(next);
      } else {
        applyTerms(localTerms);
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
  }

  function clearAll() {
    setLocalTerms([]);
    setDraft("");
    startTransition(() => { router.push("/admin/produits"); });
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Recherche + Réf. exacte + perPage + Effacer */}
      <div className="flex items-center gap-2 flex-wrap">
        <div
          className="relative flex-1 min-w-[240px] flex flex-wrap items-center gap-1.5 pl-9 pr-2 py-1.5 bg-bg-primary border border-border-strong rounded-lg shadow-[var(--shadow-card)] focus-within:border-ink focus-within:ring-2 focus-within:ring-ink/10 cursor-text"
          onClick={() => inputRef.current?.focus()}
        >
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted opacity-50 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M21 21l-4.35-4.35M17 10a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          {localTerms.map((term, idx) => {
            const isCopied = copiedIdx === idx;
            return (
              <span
                key={`${term}-${idx}`}
                className="inline-flex items-center gap-1.5 bg-ink text-text-inverse text-[12.5px] font-body px-2.5 py-1 rounded-md"
              >
                <span className="font-mono">{term}</span>
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
            className="flex-1 min-w-[110px] py-1 bg-transparent border-none focus:outline-none text-[13px] font-body text-text-primary placeholder:text-text-muted"
          />
        </div>
        {/* Réf. exacte toggle */}
        <button
          type="button"
          onClick={() => setParam({ exactRef: exactRef ? null : "1" })}
          title="Recherche exacte de la référence"
          className={`inline-flex items-center gap-2 px-3 py-2.5 rounded-lg text-[12.5px] font-medium border transition-colors shrink-0 ${
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
        {/* Per page */}
        <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg border border-border-strong bg-white shrink-0">
          <span className="text-[11px] text-text-muted font-body whitespace-nowrap pl-1">Afficher</span>
          {["20", "30", "50", "100"].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setParam({ perPage: n })}
              className={`px-2 py-1 text-[11.5px] font-medium rounded-md transition-colors ${
                perPage === n
                  ? "bg-ink text-white"
                  : "text-text-secondary hover:bg-bg-tertiary hover:text-text-primary"
              }`}
            >
              {n}
            </button>
          ))}
          <span className="text-[11px] text-text-muted whitespace-nowrap pr-1 tabular-nums">/ {totalCount.toLocaleString("fr-FR")}</span>
        </div>
        {/* Effacer tous les filtres */}
        {activeCount > 0 && (
          <button
            type="button"
            onClick={clearAll}
            title="Effacer tous les filtres"
            className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-lg text-[12.5px] font-medium border border-[#FECACA] bg-[#FEF2F2] text-[#DC2626] hover:bg-[#FEE2E2] hover:border-[#FCA5A5] transition-colors shrink-0"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
            Effacer ({activeCount})
          </button>
        )}
      </div>

      {/* 5 boutons-thèmes */}
      <div ref={barRef} className="flex gap-2 flex-wrap items-start">
        {THEMES.map((t, idx) => {
          const count = countForTheme(t.key);
          const active = count > 0;
          const isOpen = openTheme === t.key;
          const alignRight = idx >= THEMES.length - 2; // 2 derniers : aligner à droite
          return (
            <div key={t.key} className="relative">
              <button
                type="button"
                onClick={() => setOpenTheme(isOpen ? null : t.key)}
                className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg text-[12.5px] font-medium border transition-colors shadow-[var(--shadow-card)] ${
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
                  className={`absolute ${alignRight ? "right-0" : "left-0"} top-full mt-1.5 w-[320px] max-w-[calc(100vw-24px)] bg-bg-primary border border-border rounded-xl shadow-[var(--shadow-pop)] p-4 z-30`}
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-[12px] font-bold uppercase tracking-[0.12em] text-text-muted">
                      {t.emoji} {t.label}
                    </h4>
                    <button
                      type="button"
                      onClick={() => setOpenTheme(null)}
                      className="text-text-muted hover:text-text-primary text-lg leading-none"
                      aria-label="Fermer"
                    >
                      ×
                    </button>
                  </div>
                  <PopoverContent theme={t.key} />
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
