"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Link } from "@/i18n/navigation";
import Image from "@/components/ui/SmartImage";
import { buildProductHandle } from "@/lib/product-url";
import { ISSYMA_PALETTE } from "@/components/issyma/theme";
import { buildLoadMoreQuery, getLoadMoreUiState } from "@/components/produits/products-load-more";
import type { CarouselProduct } from "@/components/home/ProductCarousel";

const P = ISSYMA_PALETTE;

function IconGarment() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 7l4-3h8l4 3-3 3-2-1v11H9V9l-2 1z"/>
    </svg>
  );
}
function IconHeart() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z" />
    </svg>
  );
}

export interface IssymaGridLabels {
  ctaLabel:         string;
  pricePromptLabel: string;
  badgeLabel:       string;
  refLabel:         string;
  loadMoreLabel:    string;
  loadingLabel:     string;
  loadErrorLabel:   string;
  retryLabel:       string;
  emptyLabel:       string;
}

interface Props {
  initialProducts: CarouselProduct[];
  initialHasMore:  boolean;
  totalCount:      number;
  canSeePrices:    boolean;
  locale:          string;
  labels:          IssymaGridLabels;
}

function ProductCardIssymaCatalogue({
  p, canSeePrices, labels,
}: {
  p: CarouselProduct;
  canSeePrices: boolean;
  labels: IssymaGridLabels;
}) {
  const primary = p.colors.find((c) => c.isPrimary) ?? p.colors[0];
  const href = `/produits/${buildProductHandle(p.name, p.reference)}`;
  const displayName = p.displayName ?? p.name;
  const image = primary?.firstImage ?? null;
  const price = primary?.unitPrice ?? null;

  return (
    <div className="product-card group">
      <Link href={href} className="block relative aspect-[3/4] overflow-hidden rounded-xl">
        {image ? (
          <Image src={image} alt={displayName} width={480} height={640} className="w-full h-full object-cover" />
        ) : (
          <div className="absolute inset-0 thumb-placeholder">
            <div
              className="rounded-full flex items-center justify-center"
              style={{
                width: "38%", aspectRatio: "1/1",
                background: "radial-gradient(60% 60% at 50% 40%, #f6ede8 0%, #e6d1cb 70%, #dcc4be 100%)",
                color: "#c98a8a",
                opacity: 0.6,
              }}
            >
              <div style={{ width: "36%" }}>
                <IconGarment />
              </div>
            </div>
          </div>
        )}

        <span
          aria-hidden
          className="absolute top-2 right-2 w-7 h-7 rounded-full flex items-center justify-center transition"
          style={{
            background: "rgba(255, 255, 255, 0.92)",
            color: P.wine700,
            boxShadow: "0 3px 10px -4px rgba(50, 15, 25, 0.35)",
          }}
        >
          <IconHeart />
        </span>

        {p.isBestSeller && (
          <span
            className="absolute top-2 left-2 text-[9px] tracking-[0.2em] uppercase font-semibold px-2 py-0.5 rounded-full"
            style={{ background: P.cream, color: P.wine800 }}
          >
            {labels.badgeLabel}
          </span>
        )}
      </Link>

      <div className="mt-2 px-0.5">
        <h3 className="serif text-[13px] leading-tight font-semibold line-clamp-2" style={{ color: P.ink }}>
          {displayName}
        </h3>
        <p className="mt-0.5 text-[9px] tracking-[0.2em] uppercase font-semibold" style={{ color: P.muted }}>
          {labels.refLabel}: {p.reference}
        </p>

        <div className="mt-1.5 flex items-center justify-between gap-1.5">
          {canSeePrices && price != null ? (
            <span className="text-[12px] font-semibold tabular-nums" style={{ color: P.wine700 }}>
              {price.toFixed(2).replace(".", ",")} €
            </span>
          ) : (
            <span className="text-[9px] tracking-[0.15em] uppercase font-semibold" style={{ color: P.wine700 }}>
              {labels.pricePromptLabel}
            </span>
          )}
          <Link
            href={href}
            className="inline-flex items-center gap-1 px-2 py-1 text-[9px] tracking-[0.15em] uppercase font-semibold rounded-full transition"
            style={{ background: P.wine700, color: P.cream }}
          >
            {labels.ctaLabel} <span aria-hidden>→</span>
          </Link>
        </div>
      </div>
    </div>
  );
}

// Le payload renvoyé par /api/products est plus riche que CarouselProduct
// (variants complets, sizes…). On ne garde que ce dont la carte Issyma a besoin.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function adaptApiProduct(raw: any): CarouselProduct {
  return {
    id:             raw.id,
    name:           raw.name,
    reference:      raw.reference,
    category:       raw.category?.name ?? "",
    subCategory:    raw.subCategories?.[0]?.name ?? null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    colors:         (raw.colors ?? []).map((c: any) => ({
      groupKey:     c.groupKey,
      colorId:      c.colorId,
      name:         c.name,
      hex:          c.hex ?? null,
      patternImage: c.patternImage ?? null,
      firstImage:   c.firstImage ?? null,
      unitPrice:    Number(c.unitPrice ?? 0),
      isPrimary:    !!c.isPrimary,
      totalStock:   Number(c.totalStock ?? 0),
      variants:     c.variants ?? [],
    })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tags:           (raw.tags ?? []).map((tt: any) => ({ id: tt.tag?.id ?? tt.id, name: tt.tag?.name ?? tt.name })),
    isBestSeller:   !!raw.isBestSeller,
    isNew:          false,
    discountPercent: raw.discountPercent ?? null,
  };
}

export default function ProduitsIssymaGridClient({
  initialProducts, initialHasMore, totalCount, canSeePrices, locale, labels,
}: Props) {
  const searchParams = useSearchParams();
  const q          = searchParams.get("q")          ?? "";
  const cat        = searchParams.get("cat")        ?? "";
  const subcat     = searchParams.get("subcat")     ?? "";
  const collection = searchParams.get("collection") ?? "";
  const colorParam = searchParams.get("color")      ?? "";
  const tagId      = searchParams.get("tag")        ?? "";
  const compositionId = searchParams.get("composition") ?? "";
  const bestseller = searchParams.get("bestseller") ?? "";
  const isNew      = searchParams.get("new")        ?? "";
  const promo      = searchParams.get("promo")      ?? "";
  const ordered    = searchParams.get("ordered")    ?? "";
  const notOrdered = searchParams.get("notOrdered") ?? "";
  const hideOos    = searchParams.get("hideOos")    ?? "";
  const minPrice   = searchParams.get("minPrice")   ?? "";
  const maxPrice   = searchParams.get("maxPrice")   ?? "";

  const [products,  setProducts]  = useState<CarouselProduct[]>(initialProducts);
  const [page,      setPage]      = useState(1);
  const [hasMore,   setHasMore]   = useState(initialHasMore);
  const [loading,   setLoading]   = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const filtersKey  = `${q}||${cat}||${subcat}||${collection}||${colorParam}||${tagId}||${compositionId}||${bestseller}||${isNew}||${promo}||${ordered}||${notOrdered}||${hideOos}||${minPrice}||${maxPrice}`;
  const prevFilters = useRef(filtersKey);

  useEffect(() => {
    if (prevFilters.current === filtersKey) return;
    prevFilters.current = filtersKey;
    setProducts(initialProducts);
    setPage(1);
    setHasMore(initialHasMore);
  }, [filtersKey, initialProducts, initialHasMore]);

  useEffect(() => {
    setProducts(initialProducts);
    setPage(1);
    setHasMore(initialHasMore);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialProducts]);

  const loadMore = async () => {
    if (loading || !hasMore) return;
    setLoading(true);
    const nextPage = page + 1;
    const queryString = buildLoadMoreQuery(
      {
        q, cat, subcat, collection,
        color: colorParam, tag: tagId, composition: compositionId,
        bestseller, new: isNew, promo,
        ordered, notOrdered, hideOos, minPrice, maxPrice,
      },
      nextPage,
      locale,
    );
    try {
      const res = await fetch(`/api/products?${queryString}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setProducts((prev) => {
        const existingIds = new Set(prev.map((p) => p.id));
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const newItems = (data.products as any[])
          .filter((p) => !existingIds.has(p.id))
          .map(adaptApiProduct);
        return [...prev, ...newItems];
      });
      setPage(nextPage);
      setHasMore(data.hasMore);
      setLoadError(null);
    } catch {
      setLoadError(labels.loadErrorLabel);
    } finally {
      setLoading(false);
    }
  };

  const ui = getLoadMoreUiState({ hasMore, loadError, productCount: products.length });

  if (products.length === 0) {
    return (
      <div className="text-center py-20 text-[14px]" style={{ color: P.inkSoft }}>
        {labels.emptyLabel}
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-6">
        {products.map((p) => (
          <ProductCardIssymaCatalogue
            key={p.id}
            p={p}
            canSeePrices={canSeePrices}
            labels={labels}
          />
        ))}
      </div>

      {ui.showLoadMoreButton && (
        <div className="mt-10 flex flex-col items-center gap-4">
          <span className="text-[11px] tracking-[0.22em] uppercase font-semibold" style={{ color: P.muted }}>
            <span style={{ color: P.wine700 }}>{products.length}</span> / {totalCount}
          </span>
          <button
            type="button"
            onClick={loadMore}
            disabled={loading}
            className="inline-flex items-center gap-2 px-6 py-3 rounded-full text-[11px] tracking-[0.22em] uppercase font-semibold transition disabled:opacity-60 disabled:cursor-not-allowed"
            style={{ background: P.wine700, color: P.cream }}
          >
            {loading ? (
              <>
                <span className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />
                {labels.loadingLabel}
              </>
            ) : (
              <>
                {labels.loadMoreLabel} <span aria-hidden>↓</span>
              </>
            )}
          </button>
        </div>
      )}

      {ui.showErrorBlock && (
        <div className="mt-8 flex flex-col items-center gap-3">
          <p className="text-sm text-center" style={{ color: "#b91c1c" }}>{loadError}</p>
          <button
            type="button"
            onClick={loadMore}
            disabled={loading}
            className="text-xs font-semibold uppercase tracking-[0.18em] rounded-full px-4 py-2 transition"
            style={{ border: `1px solid ${P.wine700}`, color: P.wine700 }}
          >
            {labels.retryLabel}
          </button>
        </div>
      )}

      {ui.showAllShownMessage && products.length >= totalCount && (
        <p className="mt-10 text-center text-[11px] tracking-[0.22em] uppercase font-semibold" style={{ color: P.muted }}>
          <span style={{ color: P.wine700 }}>{products.length}</span> / {totalCount}
        </p>
      )}
    </>
  );
}
