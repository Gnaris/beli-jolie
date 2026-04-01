"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import ProductCard from "./ProductCard";
import { useProductStream, type ProductEvent } from "@/hooks/useProductStream";

type VariantItem = {
  id:           string;
  saleType:     "UNIT" | "PACK";
  packQuantity: number | null;
  sizes:        { name: string; quantity: number }[];
  unitPrice:    number;
  stock:        number;
  discountType?: "PERCENT" | "AMOUNT" | null;
  discountValue?: number | null;
};

type ProductItem = {
  id:            string;
  name:          string;
  reference:     string;
  isBestSeller?: boolean;
  createdAt?:    string | Date;
  category:      { name: string };
  subCategories: { name: string }[];
  tags:          { tag: { id: string; name: string } }[];
  colors: {
    groupKey:      string;
    colorId:       string;
    name:          string;
    hex:           string | null;
    patternImage?: string | null;
    subColors?:    { name: string; hex: string; patternImage?: string | null }[];
    firstImage:    string | null;
    unitPrice:     number;
    isPrimary:     boolean;
    totalStock:    number;
    variants:      VariantItem[];
  }[];
};

interface ClientDiscountInfo {
  discountType: "PERCENT" | "AMOUNT";
  discountValue: number;
}

interface Props {
  initialProducts: ProductItem[];
  initialHasMore:  boolean;
  clientDiscount?: ClientDiscountInfo | null;
}

export default function ProductsInfiniteScroll({ initialProducts, initialHasMore, clientDiscount }: Props) {
  const t = useTranslations("products");
  const searchParams = useSearchParams();
  const { data: session } = useSession();
  const q          = searchParams.get("q")          ?? "";
  const cat        = searchParams.get("cat")        ?? "";
  const subcat     = searchParams.get("subcat")     ?? "";
  const collection = searchParams.get("collection") ?? "";
  const colorParam = searchParams.get("color")       ?? "";
  const filteredColorIds = colorParam ? colorParam.split(",").filter(Boolean) : [];
  const tagId      = searchParams.get("tag")        ?? "";
  const bestseller = searchParams.get("bestseller") ?? "";
  const isNew      = searchParams.get("new")        ?? "";
  const promo      = searchParams.get("promo")      ?? "";
  const ordered    = searchParams.get("ordered")    ?? "";
  const notOrdered = searchParams.get("notOrdered") ?? "";
  const hideOos    = searchParams.get("hideOos")    ?? "";
  const minPrice   = searchParams.get("minPrice")   ?? "";
  const maxPrice   = searchParams.get("maxPrice")   ?? "";

  const [products,    setProducts]    = useState<ProductItem[]>(initialProducts);
  const [page,        setPage]        = useState(1);
  const [hasMore,     setHasMore]     = useState(initialHasMore);
  const [loading,     setLoading]     = useState(false);
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set());
  // Track product IDs that were just updated via SSE (for animation)
  const [animatingIds, setAnimatingIds] = useState<Set<string>>(new Set());
  // Track newly appeared product IDs (for entrance animation)
  const [newlyAddedIds, setNewlyAddedIds] = useState<Set<string>>(new Set());

  // SSE: listen for real-time product events
  const handleProductEvent = useCallback(async (event: ProductEvent) => {
    try {
      const res = await fetch(`/api/products/${event.productId}/live`);
      const data = await res.json();
      if (!data.product) return;
      const p = data.product;

      if (event.type === "PRODUCT_ONLINE" && p.status === "ONLINE") {
        // New product appeared — add to top with entrance animation
        setProducts((prev) => {
          if (prev.some((x) => x.id === p.id)) return prev;
          return [p, ...prev];
        });
        setNewlyAddedIds((prev) => new Set(prev).add(p.id));
        setTimeout(() => setNewlyAddedIds((prev) => { const s = new Set(prev); s.delete(p.id); return s; }), 1500);
      } else if (event.type === "PRODUCT_OFFLINE" && p.status !== "ONLINE") {
        // Product removed — fade out then remove
        setAnimatingIds((prev) => new Set(prev).add(p.id));
        setTimeout(() => {
          setProducts((prev) => prev.filter((x) => x.id !== p.id));
          setAnimatingIds((prev) => { const s = new Set(prev); s.delete(p.id); return s; });
        }, 500);
      } else {
        // Update existing card (stock, bestseller, price changes)
        // If createdAt was refreshed, move to top
        const isRefreshed = p.createdAt && new Date(p.createdAt).getTime() > Date.now() - 5000;
        setProducts((prev) => {
          const without = prev.filter((x) => x.id !== p.id);
          if (isRefreshed && prev.length > 0 && prev[0].id !== p.id) {
            return [p, ...without];
          }
          return prev.map((x) => x.id === p.id ? p : x);
        });
        if (isRefreshed) {
          setNewlyAddedIds((prev) => new Set(prev).add(p.id));
          setTimeout(() => setNewlyAddedIds((prev) => { const s = new Set(prev); s.delete(p.id); return s; }), 1500);
        } else {
          setAnimatingIds((prev) => new Set(prev).add(p.id));
          setTimeout(() => setAnimatingIds((prev) => { const s = new Set(prev); s.delete(p.id); return s; }), 1200);
        }
      }
    } catch { /* ignore fetch errors */ }
  }, []);

  useProductStream(handleProductEvent);

  // Fetch favorites client-side once (CLIENT role only)
  useEffect(() => {
    if (session?.user?.role !== "CLIENT") return;
    const controller = new AbortController();
    fetch("/api/favorites", { signal: controller.signal })
      .then((r) => r.json())
      .then((data: { ids: string[] }) => setFavoriteIds(new Set(data.ids)))
      .catch(() => {});
    return () => controller.abort();
  }, [session]);

  const sentinelRef = useRef<HTMLDivElement>(null);
  const loadMoreRef = useRef<() => void>(() => {});
  const filtersKey  = `${q}||${cat}||${subcat}||${collection}||${colorParam}||${tagId}||${bestseller}||${isNew}||${promo}||${ordered}||${notOrdered}||${hideOos}||${minPrice}||${maxPrice}`;
  const prevFilters = useRef(filtersKey);

  // Reset when filters change
  useEffect(() => {
    if (prevFilters.current === filtersKey) return;
    prevFilters.current = filtersKey;
    setProducts(initialProducts);
    setPage(1);
    setHasMore(initialHasMore);
  }, [filtersKey, initialProducts, initialHasMore]);

  // Sync when initialProducts change
  useEffect(() => {
    setProducts(initialProducts);
    setPage(1);
    setHasMore(initialHasMore);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialProducts]);

  // Keep loadMore ref up-to-date
  loadMoreRef.current = async () => {
    if (loading || !hasMore) return;
    setLoading(true);

    const nextPage = page + 1;
    const params   = new URLSearchParams();
    if (q)          params.set("q",          q);
    if (cat)        params.set("cat",        cat);
    if (subcat)     params.set("subcat",     subcat);
    if (collection) params.set("collection", collection);
    if (colorParam) params.set("color",      colorParam);
    if (tagId)      params.set("tag",        tagId);
    if (bestseller) params.set("bestseller", bestseller);
    if (isNew)      params.set("new",        isNew);
    if (promo)      params.set("promo",      promo);
    if (ordered)    params.set("ordered",    ordered);
    if (notOrdered) params.set("notOrdered", notOrdered);
    if (hideOos)    params.set("hideOos",    hideOos);
    if (minPrice)   params.set("minPrice",   minPrice);
    if (maxPrice)   params.set("maxPrice",   maxPrice);
    params.set("page", String(nextPage));

    try {
      const res  = await fetch(`/api/products?${params.toString()}`);
      const data = await res.json();
      setProducts((prev) => {
            const existingIds = new Set(prev.map((p) => p.id));
            const newItems = (data.products as ProductItem[]).filter((p) => !existingIds.has(p.id));
            return [...prev, ...newItems];
          });
      setPage(nextPage);
      setHasMore(data.hasMore);
    } catch {
      // silently ignore
    } finally {
      setLoading(false);
    }
  };

  // IntersectionObserver — mount once
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) loadMoreRef.current();
      },
      { threshold: 0.1 }
    );
    if (sentinelRef.current) observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, []);

  if (products.length === 0) {
    return (
      <div className="text-center py-20 card">
        <div className="w-14 h-14 bg-bg-tertiary rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-7 h-7 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
        </div>
        <p className="font-heading text-base font-semibold text-text-primary mb-1">
          {t("noResults")}
        </p>
        <p className="text-sm text-text-muted font-body">
          {t("noResultsHint")}
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5 lg:gap-6">
        {products.map((product) => {
          const isNewlyAdded = newlyAddedIds.has(product.id);
          const isAnimating = animatingIds.has(product.id);
          return (
          <div
            key={product.id}
            className={`stagger-card transition-all duration-500 ${
              isNewlyAdded ? "animate-live-pop" : ""
            } ${isAnimating && !isNewlyAdded ? "animate-live-pulse" : ""}`}
          >
          <ProductCard
            id={product.id}
            name={product.name}
            reference={product.reference}
            category={product.category.name}
            subCategory={product.subCategories[0]?.name ?? null}
            isFavorite={favoriteIds.has(product.id)}
            isBestSeller={product.isBestSeller}
            isNew={product.createdAt ? new Date(product.createdAt) > new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) : false}
            tags={product.tags.map((t) => ({ id: t.tag.id, name: t.tag.name }))}
            colors={product.colors}
            clientDiscount={clientDiscount}
            filteredColorIds={filteredColorIds}
          />
          </div>
          );
        })}
      </div>

      {/* Sentinel pour l'infinite scroll */}
      <div ref={sentinelRef} className="h-8" />

      {loading && (
        <div className="flex justify-center py-6">
          <div className="w-6 h-6 border-2 border-border border-t-text-primary rounded-full animate-spin" />
        </div>
      )}

      {!hasMore && products.length > 0 && (
        <p className="text-center text-sm text-text-muted font-body py-4">
          {t("allProductsShown", { count: products.length })}
        </p>
      )}
    </>
  );
}
