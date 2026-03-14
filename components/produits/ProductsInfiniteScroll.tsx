"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import ProductCard from "./ProductCard";

type SaleOptionItem = {
  id:           string;
  saleType:     "UNIT" | "PACK";
  packQuantity: number | null;
  size:         string | null;
};

type ProductItem = {
  id:            string;
  name:          string;
  reference:     string;
  category:      { name: string };
  subCategories: { name: string }[];
  colors: {
    id:        string;
    unitPrice: number;
    isPrimary: boolean;
    color:     { name: string; hex: string | null };
    images:    { path: string }[];
    saleOptions: SaleOptionItem[];
  }[];
};

interface Props {
  initialProducts: ProductItem[];
  initialHasMore:  boolean;
}

export default function ProductsInfiniteScroll({ initialProducts, initialHasMore }: Props) {
  const searchParams = useSearchParams();
  const { data: session } = useSession();
  const q          = searchParams.get("q")          ?? "";
  const cat        = searchParams.get("cat")        ?? "";
  const subcat     = searchParams.get("subcat")     ?? "";
  const collection = searchParams.get("collection") ?? "";
  const colorId    = searchParams.get("color")      ?? "";
  const tagId      = searchParams.get("tag")        ?? "";
  const bestseller = searchParams.get("bestseller") ?? "";
  const isNew      = searchParams.get("new")        ?? "";
  const minPrice   = searchParams.get("minPrice")   ?? "";
  const maxPrice   = searchParams.get("maxPrice")   ?? "";

  const [products,    setProducts]    = useState<ProductItem[]>(initialProducts);
  const [page,        setPage]        = useState(1);
  const [hasMore,     setHasMore]     = useState(initialHasMore);
  const [loading,     setLoading]     = useState(false);
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set());

  // Fetch favorites client-side once (CLIENT role only)
  useEffect(() => {
    if (session?.user?.role !== "CLIENT") return;
    fetch("/api/favorites")
      .then((r) => r.json())
      .then((data: { ids: string[] }) => setFavoriteIds(new Set(data.ids)))
      .catch(() => {});
  }, [session]);

  const sentinelRef = useRef<HTMLDivElement>(null);
  const loadMoreRef = useRef<() => void>(() => {});
  const filtersKey  = `${q}||${cat}||${subcat}||${collection}||${colorId}||${tagId}||${bestseller}||${isNew}||${minPrice}||${maxPrice}`;
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
    if (colorId)    params.set("color",      colorId);
    if (tagId)      params.set("tag",        tagId);
    if (bestseller) params.set("bestseller", bestseller);
    if (isNew)      params.set("new",        isNew);
    if (minPrice)   params.set("minPrice",   minPrice);
    if (maxPrice)   params.set("maxPrice",   maxPrice);
    params.set("page", String(nextPage));

    try {
      const res  = await fetch(`/api/products?${params.toString()}`);
      const data = await res.json();
      setProducts((prev) => [...prev, ...data.products]);
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
      <div className="text-center py-20 bg-white border border-[#E5E5E5] rounded-lg">
        <div className="w-14 h-14 bg-[#F5F5F5] rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-7 h-7 text-[#CCCCCC]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
        </div>
        <p className="font-[family-name:var(--font-poppins)] text-base font-semibold text-[#1A1A1A] mb-1">
          Aucun produit trouvé
        </p>
        <p className="text-sm text-[#999999] font-[family-name:var(--font-roboto)]">
          Essayez de modifier vos critères de recherche.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
        {products.map((product) => (
          <ProductCard
            key={product.id}
            id={product.id}
            name={product.name}
            reference={product.reference}
            category={product.category.name}
            subCategory={product.subCategories[0]?.name ?? null}
            isFavorite={favoriteIds.has(product.id)}
            colors={product.colors.map((c) => ({
              id:         c.id,
              hex:        c.color.hex,
              name:       c.color.name,
              firstImage: c.images[0]?.path ?? null,
              unitPrice:  c.unitPrice,
              isPrimary:  c.isPrimary,
              saleOptions: c.saleOptions.map((o) => ({
                id:           o.id,
                saleType:     o.saleType,
                packQuantity: o.packQuantity,
                size:         o.size,
              })),
            }))}
          />
        ))}
      </div>

      {/* Sentinel pour l'infinite scroll */}
      <div ref={sentinelRef} className="h-8" />

      {loading && (
        <div className="flex justify-center py-6">
          <div className="w-6 h-6 border-2 border-[#E5E5E5] border-t-[#C2516A] rounded-full animate-spin" />
        </div>
      )}

      {!hasMore && products.length > 0 && (
        <p className="text-center text-sm text-[#999999] font-[family-name:var(--font-roboto)] py-4">
          Tous les produits sont affichés ({products.length})
        </p>
      )}
    </>
  );
}
