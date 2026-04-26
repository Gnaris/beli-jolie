"use client";

import { useState, useEffect, useCallback, useRef, useTransition } from "react";
import Image from "next/image";
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

export type { PickerProduct };

interface Props {
  open: boolean;
  onClose: () => void;
  catalogProductIds: Set<string>;
  onAdd: (product: PickerProduct) => void;
  onRemove: (productId: string) => void;
  categories: CategoryOption[];
}

type SortOption = "recent" | "name" | "price";
type ViewMode = "grid" | "list";

// ─── Composant ───────────────────────────────────────────────────────────────

export default function ProductPickerModal({
  open,
  onClose,
  catalogProductIds,
  onAdd,
  onRemove,
  categories,
}: Props) {
  const [products, setProducts] = useState<PickerProduct[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [isPending, startTransition] = useTransition();

  // Filters
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [sort, setSort] = useState<SortOption>("recent");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");

  // Refs
  const sentinelRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Track which products are being toggled (for optimistic UI)
  const [togglingIds, setTogglingIds] = useState<Set<string>>(new Set());

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
    [search, categoryId, sort]
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
  }, [open, search, categoryId, sort, fetchProducts]);

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
      setSort("recent");
      setProducts([]);
      setPage(1);
    }
  }, [open]);

  // ─── Toggle product ───────────────────────────────────────────────────────

  const handleToggle = (product: PickerProduct) => {
    if (togglingIds.has(product.id)) return;
    setTogglingIds((prev) => new Set(prev).add(product.id));

    startTransition(async () => {
      try {
        if (catalogProductIds.has(product.id)) {
          onRemove(product.id);
        } else {
          onAdd(product);
        }
      } finally {
        setTogglingIds((prev) => {
          const next = new Set(prev);
          next.delete(product.id);
          return next;
        });
      }
    });
  };

  // ─── Helpers ───────────────────────────────────────────────────────────────

  const getPrice = (colors: PickerColorVariant[]) => {
    const primary = colors.find((c) => c.isPrimary) ?? colors[0];
    return primary ? primary.unitPrice.toFixed(2) : null;
  };

  if (!open) return null;

  // ─── Build select options ──────────────────────────────────────────────────

  const categoryOptions: SelectOption[] = [
    { value: "", label: "Toutes les catégories", icon: "M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" },
    ...categories.map((c) => ({ value: c.id, label: c.name })),
  ];

  const sortOptions: SelectOption[] = [
    { value: "recent", label: "Plus récents", icon: "M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" },
    { value: "name", label: "Nom A-Z", icon: "M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25H12" },
    { value: "price", label: "Prix", icon: "M14.25 7.756a4.5 4.5 0 100 8.488M7.5 10.5h5.25m-5.25 3h5.25M21 12a9 9 0 11-18 0 9 9 0 0118 0z" },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-8">
      {/* ── Backdrop ───────────────────────────────────────────────────── */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      {/* ── Modal panel ────────────────────────────────────────────────── */}
      <div className="relative z-10 flex flex-col bg-bg-primary rounded-2xl shadow-lg w-full max-w-5xl max-h-[90vh] overflow-hidden border border-border">

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="shrink-0 border-b border-border bg-bg-primary px-5 sm:px-6 py-4 rounded-t-2xl">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <h2 className="font-heading font-semibold text-text-primary text-lg">
              Ajouter des produits
            </h2>
            <span className="text-xs px-2.5 py-1 rounded-full bg-bg-secondary text-text-muted font-body">
              {total} produit{total !== 1 ? "s" : ""}
            </span>
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
        ) : products.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <svg className="w-12 h-12 text-text-muted mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
            <p className="text-sm text-text-muted font-body">Aucun produit trouve.</p>
          </div>
        ) : viewMode === "grid" ? (
          /* ── Grid view ────────────────────────────────────────────── */
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
            {products.map((product) => {
              const isAdded = catalogProductIds.has(product.id);
              const isToggling = togglingIds.has(product.id);
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
                        isToggling
                          ? "bg-white text-text-muted"
                          : isAdded
                            ? "bg-[#22C55E] text-white"
                            : "bg-white text-text-muted opacity-0 group-hover:opacity-100"
                      }`}
                    >
                      {isToggling ? (
                        <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                      ) : isAdded ? (
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

            {products.map((product) => {
              const isAdded = catalogProductIds.has(product.id);
              const isToggling = togglingIds.has(product.id);
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
                    {isToggling ? (
                      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                    ) : isAdded ? (
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
