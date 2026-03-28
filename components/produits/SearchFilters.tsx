"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useRef, useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useSession } from "next-auth/react";

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
  basePath?:   string;
  showOosToggle?: boolean;
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
        className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 min-h-[44px] rounded-lg border text-sm font-body transition-all ${
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
        <div className="absolute top-full left-0 right-0 mt-1 bg-bg-primary border border-border rounded-lg shadow-lg z-50 max-h-52 overflow-y-auto animate-[customSelectDown_0.15s_ease-out]">
          <button
            type="button"
            onClick={() => { onChange(""); setOpen(false); }}
            className={`w-full px-3 py-2 min-h-[44px] text-left text-sm font-body transition-colors hover:bg-bg-secondary ${!value ? "text-text-primary font-medium" : "text-text-muted"}`}
          >
            {placeholder}
          </button>
          {options.map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => { onChange(opt.id); setOpen(false); }}
              className={`w-full px-3 py-2 min-h-[44px] text-left text-sm font-body transition-colors hover:bg-bg-secondary ${
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
    <p className="text-[10px] font-semibold text-text-secondary uppercase tracking-widest font-body mb-2">
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
      className={`flex items-center gap-1.5 px-3 py-2.5 min-h-[44px] rounded-full text-xs font-body font-medium transition-all ${
        active
          ? "bg-bg-dark text-text-inverse shadow-sm"
          : "bg-bg-primary border border-border text-text-secondary hover:border-border-dark hover:text-text-primary"
      }`}
    >
      {children}
    </button>
  );
}

// -- Color multi-select with search ------------------------------------------
function ColorMultiSelect({
  colors, selectedIds, onToggle, onRemove, onClear, label,
}: {
  colors: ColorItem[];
  selectedIds: string[];
  onToggle: (id: string) => void;
  onRemove: (id: string) => void;
  onClear: () => void;
  label: string;
}) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const filtered = search
    ? colors.filter((c) => c.name.toLowerCase().includes(search.toLowerCase()))
    : colors;

  return (
    <div ref={ref}>
      <SectionLabel>{label}</SectionLabel>

      {/* Selected color chips */}
      {selectedIds.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {selectedIds.map((id) => {
            const c = colors.find((x) => x.id === id);
            if (!c) return null;
            return (
              <span
                key={id}
                className="inline-flex items-center gap-1 pl-1 pr-2 py-0.5 rounded-full bg-bg-tertiary border border-border text-xs font-body text-text-primary"
              >
                <span
                  className="w-3.5 h-3.5 rounded-full border border-border shrink-0"
                  style={{ backgroundColor: c.hex ?? "#9CA3AF" }}
                />
                <span className="truncate max-w-[80px]">{c.name}</span>
                <button
                  type="button"
                  onClick={() => onRemove(id)}
                  className="ml-0.5 text-text-muted hover:text-text-primary transition-colors"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </span>
            );
          })}
          <button
            type="button"
            onClick={onClear}
            className="text-[10px] text-text-muted hover:text-text-primary underline font-body transition-colors"
          >
            Tout effacer
          </button>
        </div>
      )}

      {/* Search input */}
      <div className="relative">
        <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
        </svg>
        <input
          type="text"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder="Rechercher une couleur..."
          className="w-full pl-8 pr-8 py-2 min-h-[44px] border border-border bg-bg-primary rounded-lg text-xs font-body text-text-primary placeholder:text-text-muted focus:outline-none focus:border-border-dark transition-all"
        />
        {search && (
          <button
            type="button"
            onClick={() => { setSearch(""); setOpen(false); }}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center text-text-muted hover:text-text-primary transition-colors"
            aria-label="Effacer la recherche"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* Dropdown list */}
      {open && (
        <div className="mt-1 bg-bg-primary border border-border rounded-lg shadow-lg z-50 max-h-48 overflow-y-auto animate-[customSelectDown_0.15s_ease-out]">
          {filtered.length === 0 ? (
            <p className="px-3 py-2 text-xs text-text-muted font-body">
              Aucune couleur trouvée
            </p>
          ) : (
            filtered.map((c) => {
              const isSelected = selectedIds.includes(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => onToggle(c.id)}
                  className={`w-full flex items-center gap-2 px-3 py-2 min-h-[44px] text-left text-xs font-body transition-colors hover:bg-bg-secondary ${
                    isSelected ? "bg-bg-tertiary text-text-primary font-medium" : "text-text-primary"
                  }`}
                >
                  {/* Checkbox */}
                  <span className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${
                    isSelected ? "bg-bg-dark border-bg-dark" : "border-border"
                  }`}>
                    {isSelected && (
                      <svg className="w-3 h-3 text-text-inverse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </span>
                  {/* Color dot */}
                  <span
                    className="w-5 h-5 rounded-full border border-border shrink-0"
                    style={{ backgroundColor: c.hex ?? "#9CA3AF" }}
                  />
                  <span className="truncate">{c.name}</span>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

// -- Main component ----------------------------------------------------------
export default function SearchFilters({
  categories, collections, colors, tags, totalCount, mobileMode = false, basePath = "/produits", showOosToggle = false,
}: SearchFiltersProps) {
  const t            = useTranslations("products");
  const router       = useRouter();
  const searchParams = useSearchParams();
  const { data: session } = useSession();
  const [, startTransition] = useTransition();
  const [mobileOpen, setMobileOpen] = useState(false);

  const isLoggedIn = !!session?.user;

  const q          = searchParams.get("q")          ?? "";
  const cat        = searchParams.get("cat")        ?? "";
  const subcat     = searchParams.get("subcat")     ?? "";
  const collection = searchParams.get("collection") ?? "";
  const colorParam = searchParams.get("color")       ?? "";
  const selectedColorIds = colorParam ? colorParam.split(",").filter(Boolean) : [];
  const tagId      = searchParams.get("tag")        ?? "";
  const bestseller = searchParams.get("bestseller") === "1";
  const isNew      = searchParams.get("new")        === "1";
  const promo      = searchParams.get("promo")      === "1";
  const ordered    = searchParams.get("ordered")    === "1";
  const notOrdered = searchParams.get("notOrdered") === "1";
  const hideOos    = searchParams.get("hideOos")    === "1";
  const minPrice   = searchParams.get("minPrice")   ?? "";
  const maxPrice   = searchParams.get("maxPrice")   ?? "";
  const exactRef   = searchParams.get("exactRef")   === "1";

  const hasAny = q || cat || subcat || collection || selectedColorIds.length > 0 || tagId || bestseller || isNew || promo || ordered || notOrdered || hideOos || minPrice || maxPrice || exactRef;

  const update = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) params.set(key, value);
      else params.delete(key);
      params.delete("page");
      startTransition(() => router.push(`${basePath}?${params.toString()}`));
    },
    [router, searchParams, basePath]
  );

  const toggleBool = useCallback(
    (key: string, current: boolean) => {
      const params = new URLSearchParams(searchParams.toString());
      if (!current) params.set(key, "1");
      else params.delete(key);
      params.delete("page");
      startTransition(() => router.push(`${basePath}?${params.toString()}`));
    },
    [router, searchParams, basePath]
  );

  const resetAll = () => router.push(basePath);

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
        <SectionLabel>{t("filterSearch")}</SectionLabel>
        <div className="relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
          <input
            type="search"
            defaultValue={q}
            onChange={(e) => update("q", e.target.value)}
            placeholder={t("filterSearchPlaceholder")}
            className="w-full pl-9 pr-3 py-2.5 border border-border bg-bg-primary rounded-lg text-sm font-body text-text-primary placeholder:text-text-muted focus:outline-none focus:border-border-dark focus:shadow-[0_0_0_3px_rgba(26,26,26,0.06)] transition-all"
          />
        </div>
        <label className="flex items-center gap-2 mt-2 cursor-pointer">
          <input
            type="checkbox"
            checked={exactRef}
            onChange={() => toggleBool("exactRef", exactRef)}
            className="w-4 h-4 rounded border-border text-text-primary accent-[#1A1A1A]"
          />
          <span className="text-xs text-text-secondary font-body">
            Référence exacte
          </span>
        </label>
      </div>

      {/* Categorie */}
      <div>
        <SectionLabel>{t("filterCategory")}</SectionLabel>
        <CustomSelect
          value={cat}
          placeholder={t("allCategories")}
          options={categories.map((c) => ({ id: c.id, label: c.name }))}
          onChange={(v) => {
            const params = new URLSearchParams(searchParams.toString());
            if (v) params.set("cat", v); else params.delete("cat");
            params.delete("subcat");
            params.delete("page");
            startTransition(() => router.push(`${basePath}?${params.toString()}`));
          }}
        />
      </div>

      {/* Sous-categorie */}
      {subcatOptions.length > 0 && (
        <div>
          <SectionLabel>{t("filterSubcategory")}</SectionLabel>
          <CustomSelect
            value={subcat}
            placeholder={t("filterAllSubcategories")}
            options={subcatOptions}
            onChange={(v) => update("subcat", v)}
          />
        </div>
      )}

      {/* Collection */}
      {collectionOptions.length > 0 && (
        <div>
          <SectionLabel>{t("filterCollection")}</SectionLabel>
          <CustomSelect
            value={collection}
            placeholder={t("allCollections")}
            options={collectionOptions}
            onChange={(v) => update("collection", v)}
          />
        </div>
      )}

      {/* Couleurs — searchable multi-select */}
      {colors.length > 0 && (
        <ColorMultiSelect
          colors={colors}
          selectedIds={selectedColorIds}
          onToggle={(id) => {
            const next = selectedColorIds.includes(id)
              ? selectedColorIds.filter((x) => x !== id)
              : [...selectedColorIds, id];
            update("color", next.join(","));
          }}
          onRemove={(id) => {
            const next = selectedColorIds.filter((x) => x !== id);
            update("color", next.join(","));
          }}
          onClear={() => update("color", "")}
          label={t("filterColor")}
        />
      )}

      {/* Mots cles */}
      {tagOptions.length > 0 && (
        <div>
          <SectionLabel>{t("filterTag")}</SectionLabel>
          <CustomSelect
            value={tagId}
            placeholder={t("filterAllTags")}
            options={tagOptions}
            onChange={(v) => update("tag", v)}
          />
        </div>
      )}

      {/* Prix */}
      <div>
        <SectionLabel>{t("filterPrice")}</SectionLabel>
        <div className="flex items-center gap-2">
          <input
            type="number" min="0" step="0.01" placeholder={t("filterMin")}
            value={minPrice}
            onChange={(e) => update("minPrice", e.target.value)}
            className="w-full border border-border bg-bg-primary rounded-lg px-3 py-2 text-sm font-body text-text-primary focus:outline-none focus:border-border-dark transition-all"
          />
          <span className="text-text-muted text-sm shrink-0">—</span>
          <input
            type="number" min="0" step="0.01" placeholder={t("filterMax")}
            value={maxPrice}
            onChange={(e) => update("maxPrice", e.target.value)}
            className="w-full border border-border bg-bg-primary rounded-lg px-3 py-2 text-sm font-body text-text-primary focus:outline-none focus:border-border-dark transition-all"
          />
        </div>
      </div>

      {/* Mise en avant */}
      <div>
        <SectionLabel>{t("filterFeatured")}</SectionLabel>
        <div className="flex flex-wrap gap-2">
          <ToggleChip active={bestseller} onClick={() => toggleBool("bestseller", bestseller)}>
            {t("filterBestseller")}
          </ToggleChip>
          <ToggleChip active={isNew} onClick={() => toggleBool("new", isNew)}>
            {t("filterNew")}
          </ToggleChip>
          <ToggleChip active={promo} onClick={() => toggleBool("promo", promo)}>
            {t("filterPromo")}
          </ToggleChip>
          {isLoggedIn && (
            <>
              <ToggleChip active={ordered} onClick={() => toggleBool("ordered", ordered)}>
                {t("filterOrdered")}
              </ToggleChip>
              <ToggleChip active={notOrdered} onClick={() => toggleBool("notOrdered", notOrdered)}>
                {t("filterNotOrdered")}
              </ToggleChip>
            </>
          )}
        </div>
      </div>

      {/* Masquer rupture de stock */}
      {showOosToggle && (
        <div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={hideOos}
              onChange={() => toggleBool("hideOos", hideOos)}
              className="w-4 h-4 rounded border-border text-text-primary accent-[#1A1A1A]"
            />
            <span className="text-xs text-text-secondary font-body">
              {t("hideOutOfStock")}
            </span>
          </label>
        </div>
      )}

      {/* Reset */}
      {hasAny && (
        <button
          type="button"
          onClick={resetAll}
          className="w-full flex items-center justify-center gap-2 py-2.5 min-h-[44px] border border-border-dark rounded-lg text-sm text-text-secondary hover:bg-bg-secondary font-body transition-all"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
          </svg>
          {t("resetFilters")}
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
            className={`flex items-center gap-2 px-4 py-2 min-h-[44px] rounded-lg border text-sm font-body font-medium transition-all ${
              hasAny
                ? "border-text-primary text-text-primary bg-bg-tertiary"
                : "border-border text-text-secondary bg-bg-primary hover:border-border-dark"
            }`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75" />
            </svg>
            {t("filtersLabel")}{hasAny ? " •" : ""}
          </button>
          <span className="text-sm text-text-muted font-body">
            {totalCount !== 1 ? t("productCount_plural", { count: totalCount }) : t("productCount", { count: totalCount })}
          </span>
        </div>
        {mobileOpen && (
          <div className="card p-4 animate-[customSelectDown_0.2s_ease-out]">
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
        <h2 className="font-heading text-sm font-semibold text-text-primary">
          {t("filtersLabel")}
        </h2>
        <span className="text-xs text-text-muted font-body bg-bg-tertiary px-2.5 py-1 rounded-full">
          {totalCount}
        </span>
      </div>
      <div className="card p-4">
        {filterContent}
      </div>
    </div>
  );
}
