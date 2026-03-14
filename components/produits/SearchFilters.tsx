"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useState, useTransition } from "react";

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
}

export default function SearchFilters({
  categories, collections, colors, tags, totalCount,
}: SearchFiltersProps) {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();
  const [showMore, setShowMore] = useState(false);

  const q           = searchParams.get("q")          ?? "";
  const cat         = searchParams.get("cat")        ?? "";
  const subcat      = searchParams.get("subcat")     ?? "";
  const collection  = searchParams.get("collection") ?? "";
  const colorId     = searchParams.get("color")      ?? "";
  const tagId       = searchParams.get("tag")        ?? "";
  const bestseller  = searchParams.get("bestseller") === "1";
  const isNew       = searchParams.get("new")        === "1";
  const minPrice    = searchParams.get("minPrice")   ?? "";
  const maxPrice    = searchParams.get("maxPrice")   ?? "";

  const hasAdvanced = subcat || collection || colorId || tagId || bestseller || isNew || minPrice || maxPrice;

  const update = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) params.set(key, value);
      else params.delete(key);
      params.delete("page");
      startTransition(() => {
        router.push(`/produits?${params.toString()}`);
      });
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

  const hasAny = q || cat || subcat || collection || colorId || tagId || bestseller || isNew || minPrice || maxPrice;

  // Sous-catégories de la catégorie sélectionnée
  const selectedCat = categories.find((c) => c.id === cat);

  return (
    <div className="space-y-3">
      {/* ── Ligne principale ── */}
      <div className="flex flex-wrap gap-2.5 items-center">
        {/* Recherche */}
        <div className="relative flex-1 min-w-[180px] max-w-sm">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#999999]"
            fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
          <input
            type="search"
            defaultValue={q}
            onChange={(e) => update("q", e.target.value)}
            placeholder="Nom, référence, tag…"
            className="w-full pl-9 pr-3 py-2 border border-[#E5E5E5] bg-white rounded-md text-sm font-[family-name:var(--font-roboto)] text-[#1A1A1A] placeholder:text-[#999999] focus:outline-none focus:border-[#1A1A1A] transition-all"
          />
        </div>

        {/* Catégorie */}
        <select
          value={cat}
          onChange={(e) => { update("cat", e.target.value); update("subcat", ""); }}
          className="border border-[#E5E5E5] bg-white rounded-md px-3 py-2 text-sm font-[family-name:var(--font-roboto)] text-[#1A1A1A] focus:outline-none focus:border-[#1A1A1A] transition-all"
        >
          <option value="">Toutes catégories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>

        {/* Bouton filtres avancés */}
        <button
          type="button"
          onClick={() => setShowMore((v) => !v)}
          className={`flex items-center gap-1.5 px-3 py-2 border rounded-md text-sm font-[family-name:var(--font-roboto)] transition-all ${
            hasAdvanced
              ? "border-[#C2516A] text-[#C2516A] bg-[#FDF3F5]"
              : "border-[#E5E5E5] text-[#555555] hover:border-[#999999]"
          }`}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75" />
          </svg>
          Filtres{hasAdvanced ? " •" : ""}
        </button>

        {/* Compteur */}
        <span className="text-sm text-[#999999] font-[family-name:var(--font-roboto)] shrink-0 ml-auto">
          {totalCount} produit{totalCount > 1 ? "s" : ""}
        </span>

        {/* Reset */}
        {hasAny && (
          <button type="button" onClick={resetAll}
            className="text-xs text-[#555555] hover:text-[#1A1A1A] font-[family-name:var(--font-roboto)] underline shrink-0 transition-colors"
          >
            Réinitialiser
          </button>
        )}
      </div>

      {/* ── Filtres avancés (collapsibles) ── */}
      {showMore && (
        <div className="border-t border-[#F5F5F5] pt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">

          {/* Sous-catégorie */}
          <div>
            <p className="text-xs font-semibold text-[#555555] font-[family-name:var(--font-roboto)] uppercase tracking-wide mb-1.5">Sous-catégorie</p>
            <select
              value={subcat}
              onChange={(e) => update("subcat", e.target.value)}
              className="w-full border border-[#E5E5E5] bg-white rounded-md px-3 py-2 text-sm font-[family-name:var(--font-roboto)] text-[#1A1A1A] focus:outline-none focus:border-[#1A1A1A] transition-all"
            >
              <option value="">Toutes les sous-catégories</option>
              {cat && selectedCat ? (
                selectedCat.subCategories.map((sc) => (
                  <option key={sc.id} value={sc.id}>{sc.name}</option>
                ))
              ) : (
                categories.map((c) =>
                  c.subCategories.length > 0 ? (
                    <optgroup key={c.id} label={c.name}>
                      {c.subCategories.map((sc) => (
                        <option key={sc.id} value={sc.id}>{sc.name}</option>
                      ))}
                    </optgroup>
                  ) : null
                )
              )}
            </select>
          </div>

          {/* Collection */}
          {collections.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-[#555555] font-[family-name:var(--font-roboto)] uppercase tracking-wide mb-1.5">Collection</p>
              <select
                value={collection}
                onChange={(e) => update("collection", e.target.value)}
                className="w-full border border-[#E5E5E5] bg-white rounded-md px-3 py-2 text-sm font-[family-name:var(--font-roboto)] text-[#1A1A1A] focus:outline-none focus:border-[#1A1A1A] transition-all"
              >
                <option value="">Toutes les collections</option>
                {collections.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Couleur */}
          {colors.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-[#555555] font-[family-name:var(--font-roboto)] uppercase tracking-wide mb-1.5">Couleur</p>
              <div className="flex flex-wrap gap-2">
                {colors.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    title={c.name}
                    onClick={() => update("color", colorId === c.id ? "" : c.id)}
                    className={`w-7 h-7 rounded-full border-2 transition-all duration-100 ${
                      colorId === c.id ? "border-[#1A1A1A] scale-110 shadow-sm" : "border-[#E5E5E5] hover:border-[#999999]"
                    }`}
                    style={{ backgroundColor: c.hex ?? "#CCCCCC" }}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Tag */}
          {tags.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-[#555555] font-[family-name:var(--font-roboto)] uppercase tracking-wide mb-1.5">Tag</p>
              <select
                value={tagId}
                onChange={(e) => update("tag", e.target.value)}
                className="w-full border border-[#E5E5E5] bg-white rounded-md px-3 py-2 text-sm font-[family-name:var(--font-roboto)] text-[#1A1A1A] focus:outline-none focus:border-[#1A1A1A] transition-all"
              >
                <option value="">Tous les tags</option>
                {tags.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Prix */}
          <div>
            <p className="text-xs font-semibold text-[#555555] font-[family-name:var(--font-roboto)] uppercase tracking-wide mb-1.5">Prix (€/unité)</p>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="Min"
                value={minPrice}
                onChange={(e) => update("minPrice", e.target.value)}
                className="w-full border border-[#E5E5E5] bg-white rounded-md px-3 py-2 text-sm font-[family-name:var(--font-roboto)] text-[#1A1A1A] focus:outline-none focus:border-[#1A1A1A] transition-all"
              />
              <span className="text-[#999999] text-sm shrink-0">—</span>
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="Max"
                value={maxPrice}
                onChange={(e) => update("maxPrice", e.target.value)}
                className="w-full border border-[#E5E5E5] bg-white rounded-md px-3 py-2 text-sm font-[family-name:var(--font-roboto)] text-[#1A1A1A] focus:outline-none focus:border-[#1A1A1A] transition-all"
              />
            </div>
          </div>

          {/* Best Seller + Nouveautés */}
          <div>
            <p className="text-xs font-semibold text-[#555555] font-[family-name:var(--font-roboto)] uppercase tracking-wide mb-1.5">Mise en avant</p>
            <div className="space-y-2">
              <label className="flex items-center gap-2 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={bestseller}
                  onChange={() => toggleBool("bestseller", bestseller)}
                  className="w-4 h-4 accent-[#C2516A]"
                />
                <span className="text-sm font-[family-name:var(--font-roboto)] text-[#555555] group-hover:text-[#1A1A1A] transition-colors">
                  Best Sellers uniquement
                </span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={isNew}
                  onChange={() => toggleBool("new", isNew)}
                  className="w-4 h-4 accent-[#C2516A]"
                />
                <span className="text-sm font-[family-name:var(--font-roboto)] text-[#555555] group-hover:text-[#1A1A1A] transition-colors">
                  Nouveautés (30 derniers jours)
                </span>
              </label>
            </div>
          </div>
        </div>
      )}

      {/* ── Chips filtres actifs ── */}
      {hasAny && (
        <div className="flex flex-wrap gap-2 pt-1">
          {q && <FilterChip label={`Recherche : "${q}"`} onRemove={() => update("q", "")} />}
          {cat && <FilterChip label={categories.find((c) => c.id === cat)?.name ?? cat} onRemove={() => { update("cat", ""); update("subcat", ""); }} />}
          {subcat && <FilterChip label={categories.flatMap((c) => c.subCategories).find((sc) => sc.id === subcat)?.name ?? subcat} onRemove={() => update("subcat", "")} />}
          {collection && <FilterChip label={`Collection : ${collections.find((c) => c.id === collection)?.name ?? collection}`} onRemove={() => update("collection", "")} />}
          {colorId && <FilterChip label={`Couleur : ${colors.find((c) => c.id === colorId)?.name ?? colorId}`} onRemove={() => update("color", "")} />}
          {tagId && <FilterChip label={`#${tags.find((t) => t.id === tagId)?.name ?? tagId}`} onRemove={() => update("tag", "")} />}
          {bestseller && <FilterChip label="Best Sellers" onRemove={() => toggleBool("bestseller", true)} />}
          {isNew && <FilterChip label="Nouveautés" onRemove={() => toggleBool("new", true)} />}
          {minPrice && <FilterChip label={`Prix ≥ ${minPrice} €`} onRemove={() => update("minPrice", "")} />}
          {maxPrice && <FilterChip label={`Prix ≤ ${maxPrice} €`} onRemove={() => update("maxPrice", "")} />}
        </div>
      )}
    </div>
  );
}

function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1.5 bg-[#F5F5F5] border border-[#E5E5E5] text-xs font-[family-name:var(--font-roboto)] text-[#555555] px-2.5 py-1 rounded-full">
      {label}
      <button type="button" onClick={onRemove} className="text-[#999999] hover:text-[#1A1A1A] transition-colors leading-none text-sm">×</button>
    </span>
  );
}
