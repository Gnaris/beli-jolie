"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import Image from "@/components/ui/SmartImage";
import CustomSelect, { type SelectOption } from "@/components/ui/CustomSelect";

// ─── Types ───────────────────────────────────────────────────────────────────

interface PickerColorVariant {
  colorId: string;
  isPrimary: boolean;
  unitPrice: number;
  color: { id: string; name: string; hex: string | null };
}

interface PickerImage {
  path: string;
  colorId: string;
}

interface PickerProduct {
  id: string;
  name: string;
  reference: string;
  createdAt: string;
  category: { id: string; name: string };
  colorImages: PickerImage[];
  colors: PickerColorVariant[];
}

interface CategoryOption {
  id: string;
  name: string;
}

interface SubCategoryOption {
  id: string;
  name: string;
  categoryId: string;
}

interface ColorOption {
  id: string;
  name: string;
  hex: string | null;
}

interface CompositionOption {
  id: string;
  name: string;
}

interface PickerFilterOptions {
  subCategories: SubCategoryOption[];
  colors: ColorOption[];
  compositions: CompositionOption[];
}

export type { PickerProduct, PickerFilterOptions };

interface Props {
  open: boolean;
  onClose: () => void;
  catalogProductIds: Set<string>;
  onAdd: (product: PickerProduct) => void;
  onRemove: (productId: string) => void;
  categories: CategoryOption[];
  filterOptions?: PickerFilterOptions;
}

type SortOption =
  | "recent"
  | "oldest"
  | "recentUpdated"
  | "oldestUpdated"
  | "name"
  | "price";
type ViewMode = "grid" | "list";
type MembershipFilter = "all" | "notAdded" | "added";

// ─── Composant ───────────────────────────────────────────────────────────────

export default function ProductPickerModal({
  open,
  onClose,
  catalogProductIds,
  onAdd,
  onRemove,
  categories,
  filterOptions,
}: Props) {
  const [products, setProducts] = useState<PickerProduct[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  // Filters
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [sort, setSort] = useState<SortOption>("recent");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [membership, setMembership] = useState<MembershipFilter>("all");

  // Filtres avancés
  const [subCategoryId, setSubCategoryId] = useState("");
  const [colorIds, setColorIds] = useState<string[]>([]);
  const [compositionIds, setCompositionIds] = useState<string[]>([]);

  // Refs
  const sentinelRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const scrollRef = useRef<HTMLDivElement>(null);


  // ─── Fetch ─────────────────────────────────────────────────────────────────

  const fetchProducts = useCallback(
    async (pageNum: number, append: boolean) => {
      if (append) setLoadingMore(true);
      else setLoading(true);

      try {
        const params = new URLSearchParams({
          page: String(pageNum),
          sort,
        });
        if (search.trim()) params.set("q", search.trim());
        if (categoryId) params.set("categoryId", categoryId);
        if (subCategoryId) params.set("subCategoryId", subCategoryId);
        if (colorIds.length > 0) params.set("colorIds", colorIds.join(","));
        if (compositionIds.length > 0) params.set("compositionIds", compositionIds.join(","));

        const res = await fetch(`/api/admin/products/catalog-picker?${params}`);
        const data = await res.json();

        if (append) {
          setProducts((prev) => {
            const existingIds = new Set(prev.map((p) => p.id));
            const newProducts = (data.products as PickerProduct[]).filter(
              (p) => !existingIds.has(p.id)
            );
            return [...prev, ...newProducts];
          });
        } else {
          setProducts(data.products);
        }
        setTotal(data.total);
        setPage(data.page);
        setHasMore(data.hasMore);
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [search, categoryId, subCategoryId, colorIds, compositionIds, sort]
  );

  // Initial load + filter changes
  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetchProducts(1, false);
      scrollRef.current?.scrollTo(0, 0);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [
    open,
    search,
    categoryId,
    subCategoryId,
    colorIds,
    compositionIds,
    sort,
    fetchProducts,
  ]);

  // Infinite scroll observer
  useEffect(() => {
    if (!open || !sentinelRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loading && !loadingMore) {
          fetchProducts(page + 1, true);
        }
      },
      { root: scrollRef.current, threshold: 0.1 }
    );
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [open, hasMore, loading, loadingMore, page, fetchProducts]);

  // Reset on close
  useEffect(() => {
    if (!open) {
      setSearch("");
      setCategoryId("");
      setSubCategoryId("");
      setColorIds([]);
      setCompositionIds([]);
      setSort("recent");
      setMembership("all");
      setProducts([]);
      setPage(1);
    }
  }, [open]);

  // ─── Toggle product ───────────────────────────────────────────────────────
  // Le parent gère l'optimistic UI et le rollback ; ici on appelle directement
  // pour éviter toute frame supplémentaire (pas de useTransition, pas de
  // spinner intermédiaire).

  const handleToggle = (product: PickerProduct) => {
    if (catalogProductIds.has(product.id)) {
      onRemove(product.id);
    } else {
      onAdd(product);
    }
  };

  // ─── Helpers ───────────────────────────────────────────────────────────────

  const getPrice = (colors: PickerColorVariant[]) => {
    const primary = colors.find((c) => c.isPrimary) ?? colors[0];
    return primary ? primary.unitPrice.toFixed(2) : null;
  };

  if (!open) return null;

  // ─── Filtre client-side « Affichage » ─────────────────────────────────────
  // Sépare la liste API en ajoutés / non ajoutés selon `catalogProductIds`.
  const visibleProducts =
    membership === "all"
      ? products
      : membership === "added"
        ? products.filter((p) => catalogProductIds.has(p.id))
        : products.filter((p) => !catalogProductIds.has(p.id));

  // ─── Build select options ──────────────────────────────────────────────────

  const categoryOptions: SelectOption[] = [
    { value: "", label: "Toutes les catégories", icon: "M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" },
    ...categories.map((c) => ({ value: c.id, label: c.name })),
  ];

  const sortOptions: SelectOption[] = [
    { value: "recent", label: "Créés récemment", icon: "M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" },
    { value: "oldest", label: "Créés les plus anciens", icon: "M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" },
    { value: "recentUpdated", label: "Modifiés récemment", icon: "M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487z" },
    { value: "oldestUpdated", label: "Modifiés les plus anciens", icon: "M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487z" },
    { value: "name", label: "Nom A-Z", icon: "M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25H12" },
    { value: "price", label: "Prix", icon: "M14.25 7.756a4.5 4.5 0 100 8.488M7.5 10.5h5.25m-5.25 3h5.25M21 12a9 9 0 11-18 0 9 9 0 0118 0z" },
  ];

  // ── Options des filtres ───────────────────────────────────────────────────
  const subCategoriesForCategory = filterOptions?.subCategories.filter(
    (sc) => !categoryId || sc.categoryId === categoryId,
  ) ?? [];
  const subCategoryOptions: SelectOption[] = [
    { value: "", label: "Toutes les sous-catégories" },
    ...subCategoriesForCategory.map((sc) => ({ value: sc.id, label: sc.name })),
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-8">
      {/* ── Backdrop ───────────────────────────────────────────────────── */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      {/* ── Modal panel ────────────────────────────────────────────────── */}
      <div className="relative z-10 flex flex-col bg-bg-primary rounded-2xl shadow-lg w-full max-w-5xl max-h-[90vh] overflow-hidden border border-border">

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="shrink-0 border-b border-border bg-bg-primary px-5 sm:px-6 py-4 rounded-t-2xl">
        <div className="flex items-center justify-between mb-4 gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <h2 className="font-heading font-semibold text-text-primary text-lg shrink-0">
              Ajouter des produits
            </h2>
            <span className="text-xs px-2.5 py-1 rounded-full bg-bg-secondary text-text-muted font-body shrink-0">
              {total} produit{total !== 1 ? "s" : ""}
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* Segmented « Affichage » */}
            <div className="flex gap-1 p-1 bg-bg-secondary rounded-xl text-xs font-body">
              {(
                [
                  { key: "all", label: "Tous" },
                  { key: "notAdded", label: "Non ajoutés" },
                  { key: "added", label: "Ajoutés" },
                ] as { key: MembershipFilter; label: string }[]
              ).map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setMembership(opt.key)}
                  className={`px-2.5 h-7 rounded-lg transition-all whitespace-nowrap ${
                    membership === opt.key
                      ? "bg-bg-primary shadow-sm text-text-primary font-medium"
                      : "text-text-muted hover:text-text-primary"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <button
              onClick={onClose}
              className="w-9 h-9 flex items-center justify-center rounded-xl border border-border hover:bg-bg-secondary transition-colors text-text-muted hover:text-text-primary"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* ── Filters row ─────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Search */}
          <div className="relative flex-1 min-w-[200px]">
            <svg
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted"
              fill="none" stroke="currentColor" viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
            <input
              type="text"
              className="field-input text-sm"
              style={{ paddingLeft: "2.25rem" }}
              placeholder="Rechercher un produit..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {/* Category filter */}
          <CustomSelect
            value={categoryId}
            onChange={setCategoryId}
            options={categoryOptions}
            placeholder="Catégorie"
            className="w-auto min-w-[180px]"
            searchable
          />

          {/* Sort */}
          <CustomSelect
            value={sort}
            onChange={(v) => setSort(v as SortOption)}
            options={sortOptions}
            placeholder="Trier par"
            className="w-auto min-w-[160px]"
          />

          {/* Sous-catégorie */}
          {filterOptions && filterOptions.subCategories.length > 0 && (
            <CustomSelect
              value={subCategoryId}
              onChange={setSubCategoryId}
              options={subCategoryOptions}
              placeholder="Sous-catégorie"
              className="w-auto min-w-[180px]"
              searchable
            />
          )}

          {/* Couleurs (multi) */}
          {filterOptions && filterOptions.colors.length > 0 && (
            <MultiSelectDropdown
              label="Couleurs"
              placeholder="Couleurs"
              options={filterOptions.colors.map((c) => ({
                value: c.id,
                label: c.name,
                hex: c.hex,
              }))}
              selectedValues={colorIds}
              onChange={setColorIds}
              searchable
            />
          )}

          {/* Compositions (multi) */}
          {filterOptions && filterOptions.compositions.length > 0 && (
            <MultiSelectDropdown
              label="Compositions"
              placeholder="Compositions"
              options={filterOptions.compositions.map((c) => ({
                value: c.id,
                label: c.name,
              }))}
              selectedValues={compositionIds}
              onChange={setCompositionIds}
              searchable
            />
          )}

          {/* View mode toggle */}
          <div className="flex gap-1 p-1 bg-bg-secondary rounded-xl">
            <button
              type="button"
              onClick={() => setViewMode("grid")}
              className={`w-8 h-8 flex items-center justify-center rounded-lg transition-all ${
                viewMode === "grid"
                  ? "bg-bg-primary shadow-sm text-text-primary"
                  : "text-text-muted hover:text-text-primary"
              }`}
              title="Vue grille"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => setViewMode("list")}
              className={`w-8 h-8 flex items-center justify-center rounded-lg transition-all ${
                viewMode === "list"
                  ? "bg-bg-primary shadow-sm text-text-primary"
                  : "text-text-muted hover:text-text-primary"
              }`}
              title="Vue liste"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 010 3.75H5.625a1.875 1.875 0 010-3.75z" />
              </svg>
            </button>
          </div>
        </div>

      </div>

      {/* ── Product list ──────────────────────────────────────────────── */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 sm:px-6 py-4">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <svg className="w-8 h-8 animate-spin text-text-muted" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </div>
        ) : visibleProducts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <svg className="w-12 h-12 text-text-muted mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
            <p className="text-sm text-text-muted font-body">
              {membership === "added"
                ? "Aucun produit ajouté dans cette page."
                : membership === "notAdded"
                  ? "Tous les produits de cette page sont déjà ajoutés."
                  : "Aucun produit trouvé."}
            </p>
          </div>
        ) : viewMode === "grid" ? (
          /* ── Grid view ────────────────────────────────────────────── */
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
            {visibleProducts.map((product) => {
              const isAdded = catalogProductIds.has(product.id);
              const image = product.colorImages[0]?.path;
              const price = getPrice(product.colors);

              return (
                <div
                  key={product.id}
                  onClick={() => handleToggle(product)}
                  className={`group relative rounded-xl border overflow-hidden transition-all cursor-pointer ${
                    isAdded
                      ? "border-[#22C55E]/30 bg-[#F0FDF4]/50"
                      : "border-border hover:border-[#D1D5DB] hover:shadow-sm"
                  }`}
                >
                  {/* Image */}
                  <div className="aspect-square bg-bg-secondary relative">
                    {image ? (
                      <Image
                        src={image}
                        alt={product.name}
                        className="w-full h-full object-cover"
                        width={200}
                        height={200}
                        unoptimized
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <svg className="w-8 h-8 text-[#D1D5DB]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                            d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909" />
                        </svg>
                      </div>
                    )}

                    {/* Status indicator */}
                    <div
                      className={`absolute top-2 right-2 w-7 h-7 flex items-center justify-center rounded-full shadow-md transition-all ${
                        isAdded
                          ? "bg-[#22C55E] text-white"
                          : "bg-white text-text-muted opacity-0 group-hover:opacity-100"
                      }`}
                    >
                      {isAdded ? (
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4.5 12.75l6 6 9-13.5" />
                        </svg>
                      ) : (
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.5v15m7.5-7.5h-15" />
                        </svg>
                      )}
                    </div>

                    {/* "Ajouté" badge */}
                    {isAdded && (
                      <div className="absolute top-2 left-2 px-2 py-0.5 rounded-full bg-[#22C55E] text-white text-[10px] font-medium font-body">
                        Ajouté
                      </div>
                    )}
                  </div>

                  {/* Info */}
                  <div className="p-2.5">
                    <p className="text-xs font-heading font-medium text-text-primary truncate">
                      {product.name}
                    </p>
                    <div className="flex items-center justify-between mt-1">
                      <p className="text-[11px] text-text-muted font-body">{product.reference}</p>
                      {price && (
                        <p className="text-[11px] font-medium text-text-primary font-body">{price} &euro;</p>
                      )}
                    </div>
                    <p className="text-[10px] text-text-muted font-body mt-0.5 truncate">
                      {product.category.name}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          /* ── List view ────────────────────────────────────────────── */
          <div className="space-y-1">
            {/* Header row */}
            <div className="hidden sm:grid grid-cols-[auto_1fr_120px_100px_100px_48px] gap-3 px-3 py-2 text-[11px] text-text-muted font-body font-medium uppercase tracking-wide">
              <div className="w-10" />
              <div>Produit</div>
              <div>Categorie</div>
              <div>Reference</div>
              <div className="text-right">Prix</div>
              <div />
            </div>

            {visibleProducts.map((product) => {
              const isAdded = catalogProductIds.has(product.id);
              const image = product.colorImages[0]?.path;
              const price = getPrice(product.colors);

              return (
                <div
                  key={product.id}
                  onClick={() => handleToggle(product)}
                  className={`grid grid-cols-[auto_1fr_auto] sm:grid-cols-[auto_1fr_120px_100px_100px_48px] gap-3 items-center px-3 py-2.5 rounded-xl transition-all cursor-pointer ${
                    isAdded
                      ? "bg-[#F0FDF4]/70 border border-[#22C55E]/20"
                      : "hover:bg-bg-secondary border border-transparent"
                  }`}
                >
                  {/* Image */}
                  <div className="w-10 h-10 rounded-lg bg-bg-secondary overflow-hidden shrink-0">
                    {image ? (
                      <Image src={image} alt={product.name} className="w-full h-full object-cover" width={40} height={40} unoptimized />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <svg className="w-4 h-4 text-[#D1D5DB]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                            d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159" />
                        </svg>
                      </div>
                    )}
                  </div>

                  {/* Name */}
                  <div className="min-w-0">
                    <p className="text-sm font-heading font-medium text-text-primary truncate">
                      {product.name}
                    </p>
                    <p className="text-xs text-text-muted font-body sm:hidden">
                      {product.reference} · {product.category.name}
                    </p>
                  </div>

                  {/* Category (desktop) */}
                  <p className="hidden sm:block text-xs text-text-muted font-body truncate">
                    {product.category.name}
                  </p>

                  {/* Reference (desktop) */}
                  <p className="hidden sm:block text-xs text-text-muted font-body">
                    {product.reference}
                  </p>

                  {/* Price (desktop) */}
                  <p className="hidden sm:block text-xs font-medium text-text-primary font-body text-right">
                    {price ? `${price} \u20AC` : "-"}
                  </p>

                  {/* Status indicator */}
                  <div
                    className={`w-8 h-8 flex items-center justify-center rounded-lg transition-all justify-self-end ${
                      isAdded
                        ? "bg-[#22C55E] text-white"
                        : "border border-border text-text-muted"
                    }`}
                  >
                    {isAdded ? (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4.5 12.75l6 6 9-13.5" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.5v15m7.5-7.5h-15" />
                      </svg>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Load more sentinel */}
        {hasMore && (
          <div ref={sentinelRef} className="flex items-center justify-center py-6">
            {loadingMore && (
              <svg className="w-6 h-6 animate-spin text-text-muted" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            )}
          </div>
        )}
      </div>

      {/* ── Footer ────────────────────────────────────────────────────── */}
      <div className="shrink-0 border-t border-border bg-bg-primary px-5 sm:px-6 py-3 flex items-center justify-between rounded-b-2xl">
        <p className="text-sm text-text-muted font-body">
          <span className="font-medium text-text-primary">{catalogProductIds.size}</span> produit{catalogProductIds.size !== 1 ? "s" : ""} dans ce catalogue
        </p>
        <button
          onClick={onClose}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-bg-dark text-text-inverse text-sm font-medium font-body hover:opacity-90 transition-all"
        >
          Fermer
        </button>
      </div>

      </div>{/* end modal panel */}
    </div>
  );
}

// ─── MultiSelectDropdown ──────────────────────────────────────────────────
// Sélecteur multi-valeur avec cases à cocher. Ouvre un modal centré (comme
// CustomSelect avec `title`) : plein écran mobile, modal centré + voile noir
// sur desktop. Portalé pour passer au-dessus du picker parent.

interface MultiSelectOption {
  value: string;
  label: string;
  hex?: string | null;
}

interface MultiSelectDropdownProps {
  label: string;
  placeholder: string;
  options: MultiSelectOption[];
  selectedValues: string[];
  onChange: (values: string[]) => void;
  searchable?: boolean;
}

function MultiSelectDropdown({
  label,
  placeholder,
  options,
  selectedValues,
  onChange,
  searchable = false,
}: MultiSelectDropdownProps) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [search, setSearch] = useState("");

  useEffect(() => { setMounted(true); }, []);

  // Verrouille le scroll de la page derrière le modal
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  // ESC ferme
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  // Reset search quand on ferme
  useEffect(() => {
    if (!open) setSearch("");
  }, [open]);

  const filtered = searchable && search.trim()
    ? options.filter((o) => o.label.toLowerCase().includes(search.trim().toLowerCase()))
    : options;

  const count = selectedValues.length;

  function toggle(value: string) {
    onChange(
      selectedValues.includes(value)
        ? selectedValues.filter((v) => v !== value)
        : [...selectedValues, value],
    );
  }

  const modal = open && mounted && createPortal(
    <div
      className="fixed inset-0 z-[10500] flex md:items-center md:justify-center md:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={label}
    >
      {/* Voile noir — desktop uniquement */}
      <button
        type="button"
        aria-label="Fermer"
        tabIndex={-1}
        onClick={() => setOpen(false)}
        className="hidden md:block absolute inset-0 bg-black/55 backdrop-blur-[2px] cursor-default"
      />
      {/* Modal card */}
      <div className="relative w-full h-full flex flex-col bg-bg-primary md:w-[min(92vw,460px)] md:h-auto md:max-h-[85vh] md:rounded-2xl md:shadow-[0_24px_60px_rgba(0,0,0,0.25)] md:overflow-hidden">
        {/* Header */}
        <div className="shrink-0 border-b border-border bg-bg-primary px-4 pb-3 md:px-5 md:pt-5 pt-[max(env(safe-area-inset-top),16px)]">
          <div className="flex items-center gap-3">
            {/* Mobile back arrow */}
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Retour"
              className="md:hidden w-11 h-11 rounded-full bg-bg-secondary hover:bg-bg-tertiary text-text-primary flex items-center justify-center shrink-0"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <div className="flex-1 min-w-0">
              <h3 className="font-heading font-semibold text-text-primary text-base md:text-lg truncate">
                {label}
              </h3>
              <p className="text-xs text-text-muted font-body">
                {count === 0
                  ? "Cochez une ou plusieurs valeurs"
                  : `${count} sélectionné${count > 1 ? "s" : ""}`}
              </p>
            </div>
            {/* Desktop close */}
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Fermer"
              className="hidden md:flex w-9 h-9 rounded-xl border border-border hover:bg-bg-secondary text-text-muted hover:text-text-primary items-center justify-center"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {searchable && (
            <div className="mt-3">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Rechercher…"
                className="field-input text-sm"
                autoFocus
              />
            </div>
          )}
        </div>

        {/* List */}
        <ul className="flex-1 overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <li className="px-4 py-6 text-sm text-text-muted font-body text-center">
              Aucun résultat
            </li>
          ) : (
            filtered.map((opt) => {
              const active = selectedValues.includes(opt.value);
              return (
                <li key={opt.value}>
                  <button
                    type="button"
                    onClick={() => toggle(opt.value)}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-bg-secondary transition-colors"
                  >
                    <span
                      className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 ${
                        active ? "bg-bg-dark border-bg-dark" : "border-border"
                      }`}
                    >
                      {active && (
                        <svg className="w-3.5 h-3.5 text-text-inverse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M4.5 12.75l6 6 9-13.5" />
                        </svg>
                      )}
                    </span>
                    {opt.hex !== undefined && (
                      <span
                        className="w-4 h-4 rounded-full border border-border/50 shrink-0"
                        style={{
                          backgroundColor: opt.hex ?? "#9CA3AF",
                          boxShadow: opt.hex?.toLowerCase() === "#ffffff" ? "inset 0 0 0 1px #E5E5E5" : undefined,
                        }}
                      />
                    )}
                    <span className="flex-1 truncate text-sm text-text-primary font-body">{opt.label}</span>
                  </button>
                </li>
              );
            })
          )}
        </ul>

        {/* Footer */}
        <div className="shrink-0 border-t border-border bg-bg-primary px-4 py-3 md:px-5 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => onChange([])}
            disabled={count === 0}
            className="text-sm font-body text-text-muted hover:text-text-primary underline disabled:opacity-40 disabled:no-underline disabled:cursor-not-allowed"
          >
            Vider
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-bg-dark text-text-inverse text-sm font-medium font-body hover:opacity-90 transition-all"
          >
            Valider
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`inline-flex items-center gap-2 h-9 px-3 rounded-xl border text-sm font-body transition-all whitespace-nowrap ${
          count > 0
            ? "border-bg-dark bg-bg-dark text-text-inverse"
            : "border-border bg-bg-primary text-text-primary hover:bg-bg-secondary"
        }`}
      >
        <span>{count === 0 ? placeholder : label}</span>
        {count > 0 && (
          <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-medium bg-text-inverse text-bg-dark">
            {count}
          </span>
        )}
        <svg className="w-3.5 h-3.5 opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
        </svg>
      </button>
      {modal}
    </>
  );
}
