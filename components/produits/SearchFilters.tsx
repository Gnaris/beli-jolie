"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useRef, useEffect, useState, useTransition } from "react";

interface SubCategory { id: string; name: string }
interface Category    { id: string; name: string; subCategories: SubCategory[] }
interface CollectionItem { id: string; name: string }
interface ColorItem   { id: string; name: string; hex: string | null }
interface TagItem     { id: string; name: string }

interface SearchFiltersProps {
  categories:  Category[];
  collections: CollectionItem[];
  colors:      ColorItem[];
  tags:        TagItem[];
  totalCount:  number;
  mobileMode?: boolean;
}

// -- Custom select dropdown --------------------------------------------------
function CustomSelect({
  value, placeholder, options, onChange,
}: {
  value: string;
  placeholder: string;
  options: { id: string; label: string; prefix?: string }[];
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const selected = options.find((o) => o.id === value);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg border text-sm font-[family-name:var(--font-roboto)] transition-all ${
          value
            ? "border-text-primary bg-bg-tertiary text-text-primary"
            : "border-border bg-bg-primary text-text-secondary hover:border-border-dark"
        }`}
      >
        <span className="truncate">{selected ? selected.label : placeholder}</span>
        <svg className={`w-4 h-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-bg-primary border border-border rounded-lg shadow-lg z-50 max-h-52 overflow-y-auto">
          <button
            type="button"
            onClick={() => { onChange(""); setOpen(false); }}
            className={`w-full px-3 py-2 text-left text-sm font-[family-name:var(--font-roboto)] transition-colors hover:bg-bg-secondary ${!value ? "text-text-primary font-medium" : "text-text-muted"}`}
          >
            {placeholder}
          </button>
          {options.map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => { onChange(opt.id); setOpen(false); }}
              className={`w-full px-3 py-2 text-left text-sm font-[family-name:var(--font-roboto)] transition-colors hover:bg-bg-secondary ${
                opt.id === value ? "text-text-primary font-medium bg-bg-tertiary" : "text-text-primary"
              }`}
            >
              {opt.prefix && <span className="text-text-muted mr-1">{opt.prefix}</span>}
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// -- Section label -----------------------------------------------------------
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-semibold text-text-secondary uppercase tracking-widest font-[family-name:var(--font-roboto)] mb-2">
      {children}
    </p>
  );
}

// -- Toggle chip -------------------------------------------------------------
function ToggleChip({
  active, onClick, children,
}: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-[family-name:var(--font-roboto)] font-medium transition-all ${
        active
          ? "bg-bg-dark text-text-inverse shadow-sm"
          : "bg-bg-primary border border-border text-text-secondary hover:border-border-dark hover:text-text-primary"
      }`}
    >
      {children}
    </button>
  );
}

// -- Main component ----------------------------------------------------------
export default function SearchFilters({
  categories, collections, colors, tags, totalCount, mobileMode = false,
}: SearchFiltersProps) {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();
  const [mobileOpen, setMobileOpen] = useState(false);

  const q          = searchParams.get("q")          ?? "";
  const cat        = searchParams.get("cat")        ?? "";
  const subcat     = searchParams.get("subcat")     ?? "";
  const collection = searchParams.get("collection") ?? "";
  const colorId    = searchParams.get("color")      ?? "";
  const tagId      = searchParams.get("tag")        ?? "";
  const bestseller = searchParams.get("bestseller") === "1";
  const isNew      = searchParams.get("new")        === "1";
  const minPrice   = searchParams.get("minPrice")   ?? "";
  const maxPrice   = searchParams.get("maxPrice")   ?? "";

  const hasAny = q || cat || subcat || collection || colorId || tagId || bestseller || isNew || minPrice || maxPrice;

  const update = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) params.set(key, value);
      else params.delete(key);
      params.delete("page");
      startTransition(() => router.push(`/produits?${params.toString()}`));
    },
    [router, searchParams]
  );

  const toggleBool = useCallback(
    (key: string, current: boolean) => {
      const params = new URLSearchParams(searchParams.toString());
      if (!current) params.set(key, "1");
      else params.delete(key);
      params.delete("page");
      startTransition(() => router.push(`/produits?${params.toString()}`));
    },
    [router, searchParams]
  );

  const resetAll = () => router.push("/produits");

  const selectedCat = categories.find((c) => c.id === cat);

  // Flatten all subcategories for the dropdown
  const subcatOptions = cat && selectedCat
    ? selectedCat.subCategories.map((sc) => ({ id: sc.id, label: sc.name }))
    : categories.flatMap((c) => c.subCategories.map((sc) => ({ id: sc.id, label: sc.name, prefix: c.name })));

  const collectionOptions = collections.map((c) => ({ id: c.id, label: c.name }));
  const tagOptions        = tags.map((t) => ({ id: t.id, label: `#${t.name}` }));

  const filterContent = (
    <div className="space-y-5">
      {/* Recherche */}
      <div>
        <SectionLabel>Recherche</SectionLabel>
        <div className="relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
          <input
            type="search"
            defaultValue={q}
            onChange={(e) => update("q", e.target.value)}
            placeholder="Nom, reference, tag..."
            className="w-full pl-9 pr-3 py-2.5 border border-border bg-bg-primary rounded-lg text-sm font-[family-name:var(--font-roboto)] text-text-primary placeholder:text-text-muted focus:outline-none focus:border-border-dark focus:shadow-[0_0_0_3px_rgba(26,26,26,0.06)] transition-all"
          />
        </div>
      </div>

      {/* Categorie */}
      <div>
        <SectionLabel>Categorie</SectionLabel>
        <CustomSelect
          value={cat}
          placeholder="Toutes categories"
          options={categories.map((c) => ({ id: c.id, label: c.name }))}
          onChange={(v) => {
            const params = new URLSearchParams(searchParams.toString());
            if (v) params.set("cat", v); else params.delete("cat");
            params.delete("subcat");
            params.delete("page");
            startTransition(() => router.push(`/produits?${params.toString()}`));
          }}
        />
      </div>

      {/* Sous-categorie */}
      {subcatOptions.length > 0 && (
        <div>
          <SectionLabel>Sous-categorie</SectionLabel>
          <CustomSelect
            value={subcat}
            placeholder="Toutes"
            options={subcatOptions}
            onChange={(v) => update("subcat", v)}
          />
        </div>
      )}

      {/* Collection */}
      {collectionOptions.length > 0 && (
        <div>
          <SectionLabel>Collection</SectionLabel>
          <CustomSelect
            value={collection}
            placeholder="Toutes collections"
            options={collectionOptions}
            onChange={(v) => update("collection", v)}
          />
        </div>
      )}

      {/* Couleurs */}
      {colors.length > 0 && (
        <div>
          <SectionLabel>Couleur</SectionLabel>
          <div className="flex flex-wrap gap-2">
            {colors.map((c) => (
              <button
                key={c.id}
                type="button"
                title={c.name}
                onClick={() => update("color", colorId === c.id ? "" : c.id)}
                className={`w-8 h-8 rounded-full border-2 transition-all ${
                  colorId === c.id
                    ? "border-text-primary scale-110 shadow-md ring-2 ring-black/10"
                    : "border-border hover:border-border-dark hover:scale-105"
                }`}
                style={{ backgroundColor: c.hex ?? "#9CA3AF" }}
              />
            ))}
          </div>
          {colorId && (
            <p className="text-xs text-text-primary mt-1.5 font-[family-name:var(--font-roboto)]">
              {colors.find((c) => c.id === colorId)?.name}
              <button onClick={() => update("color", "")} className="ml-1.5 underline hover:no-underline">×</button>
            </p>
          )}
        </div>
      )}

      {/* Mots cles */}
      {tagOptions.length > 0 && (
        <div>
          <SectionLabel>Mot cle</SectionLabel>
          <CustomSelect
            value={tagId}
            placeholder="Tous les mots cles"
            options={tagOptions}
            onChange={(v) => update("tag", v)}
          />
        </div>
      )}

      {/* Prix */}
      <div>
        <SectionLabel>Prix (€/unite)</SectionLabel>
        <div className="flex items-center gap-2">
          <input
            type="number" min="0" step="0.01" placeholder="Min"
            value={minPrice}
            onChange={(e) => update("minPrice", e.target.value)}
            className="w-full border border-border bg-bg-primary rounded-lg px-3 py-2 text-sm font-[family-name:var(--font-roboto)] text-text-primary focus:outline-none focus:border-border-dark transition-all"
          />
          <span className="text-text-muted text-sm shrink-0">—</span>
          <input
            type="number" min="0" step="0.01" placeholder="Max"
            value={maxPrice}
            onChange={(e) => update("maxPrice", e.target.value)}
            className="w-full border border-border bg-bg-primary rounded-lg px-3 py-2 text-sm font-[family-name:var(--font-roboto)] text-text-primary focus:outline-none focus:border-border-dark transition-all"
          />
        </div>
      </div>

      {/* Mise en avant */}
      <div>
        <SectionLabel>Mise en avant</SectionLabel>
        <div className="flex flex-wrap gap-2">
          <ToggleChip active={bestseller} onClick={() => toggleBool("bestseller", bestseller)}>
            Best Sellers
          </ToggleChip>
          <ToggleChip active={isNew} onClick={() => toggleBool("new", isNew)}>
            Nouveautes
          </ToggleChip>
        </div>
      </div>

      {/* Reset */}
      {hasAny && (
        <button
          type="button"
          onClick={resetAll}
          className="w-full flex items-center justify-center gap-2 py-2.5 border border-border-dark rounded-lg text-sm text-text-secondary hover:bg-bg-secondary font-[family-name:var(--font-roboto)] transition-all"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
          </svg>
          Reinitialiser les filtres
        </button>
      )}
    </div>
  );

  // -- Mode mobile : bouton + panneau collapsible --
  if (mobileMode) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => setMobileOpen((v) => !v)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-[family-name:var(--font-roboto)] font-medium transition-all ${
              hasAny
                ? "border-text-primary text-text-primary bg-bg-tertiary"
                : "border-border text-text-secondary bg-bg-primary hover:border-border-dark"
            }`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75" />
            </svg>
            Filtres{hasAny ? " •" : ""}
          </button>
          <span className="text-sm text-text-muted font-[family-name:var(--font-roboto)]">
            {totalCount} produit{totalCount > 1 ? "s" : ""}
          </span>
        </div>
        {mobileOpen && (
          <div className="card p-4">
            {filterContent}
          </div>
        )}
      </div>
    );
  }

  // -- Mode sidebar desktop --
  return (
    <div className="sticky top-6">
      {/* Header sidebar */}
      <div className="flex items-center justify-between mb-5">
        <h2 className="font-[family-name:var(--font-poppins)] text-sm font-semibold text-text-primary">
          Filtres
        </h2>
        <span className="text-xs text-text-muted font-[family-name:var(--font-roboto)] bg-bg-tertiary px-2.5 py-1 rounded-full">
          {totalCount}
        </span>
      </div>
      <div className="card p-4">
        {filterContent}
      </div>
    </div>
  );
}
