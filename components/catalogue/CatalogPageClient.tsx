"use client";

import { useState, useEffect } from "react";
import CatalogProductCard from "./CatalogProductCard";

// ─── Types ──────────────────────────────────────────────────────────────────

interface VariantSize {
  size: { name: string };
  quantity: number;
}
interface ColorVariant {
  id: string;
  colorId: string | null;
  unitPrice: number;
  stock: number;
  isPrimary: boolean;
  saleType: "UNIT" | "PACK";
  packQuantity: number | null;
  color: { id: string; name: string; hex: string | null; patternImage?: string | null } | null;
  variantSizes: VariantSize[];
}
interface ColorImage {
  path: string;
  colorId: string;
  order: number;
}
interface CatalogProduct {
  product: {
    id: string;
    name: string;
    reference: string;
    category: { name: string };
    colors: ColorVariant[];
    colorImages: ColorImage[];
  };
  selectedColorId: string | null;
  selectedImagePath: string | null;
}

interface Props {
  title: string;
  shopName: string;
  products: CatalogProduct[];
  isAuthenticated: boolean;
  catalogToken: string;
  favoriteProductIds?: string[];
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function CatalogPageClient({
  title,
  shopName,
  products,
  isAuthenticated,
  catalogToken,
  favoriteProductIds = [],
}: Props) {
  const productCount = products.length;

  // Staggered reveal
  const [visibleCount, setVisibleCount] = useState(0);

  useEffect(() => {
    if (visibleCount >= productCount) return;
    const delay = visibleCount === 0 ? 250 : 100;
    const timer = setTimeout(() => setVisibleCount((c) => c + 1), delay);
    return () => clearTimeout(timer);
  }, [visibleCount, productCount]);

  return (
    <div className="min-h-screen bg-[#FAFAFA]">

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className="bg-white border-b border-[#EEECE9]">
        <div className="max-w-[1400px] mx-auto px-5 sm:px-8 py-8 md:py-10">
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-5">
            <div>
              <p
                className="text-[#B0ADA6] text-[11px] uppercase tracking-[0.25em] mb-2"
                style={{ fontFamily: "var(--font-roboto)" }}
              >
                {shopName}
              </p>
              <h1
                className="text-[#1A1A1A] text-2xl md:text-3xl font-bold tracking-tight"
                style={{ fontFamily: "var(--font-poppins)" }}
              >
                {title}
              </h1>
              <p className="text-[#B0ADA6] text-sm mt-2" style={{ fontFamily: "var(--font-roboto)" }}>
                {productCount} produit{productCount !== 1 ? "s" : ""}
              </p>
            </div>

            {isAuthenticated && (
              <a
                href="/panier"
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#1A1A1A] text-white text-sm font-medium hover:bg-[#333] transition-colors shrink-0"
                style={{ fontFamily: "var(--font-roboto)" }}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.75 10.5V6a3.75 3.75 0 10-7.5 0v4.5m11.356-1.993l1.263 12c.07.665-.45 1.243-1.119 1.243H4.25a1.125 1.125 0 01-1.12-1.243l1.264-12A1.125 1.125 0 015.513 7.5h12.974c.576 0 1.059.435 1.119 1.007zM8.625 10.5a.375.375 0 11-.75 0 .375.375 0 01.75 0zm7.5 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
                </svg>
                Mon panier
              </a>
            )}
          </div>
        </div>
      </header>

      {/* ── Products grid — fluid wrap ────────────────────────────────── */}
      <main className="max-w-[1400px] mx-auto px-4 sm:px-6 py-8 md:py-10">
        {productCount === 0 ? (
          <div className="text-center py-24">
            <div className="w-16 h-16 mx-auto mb-5 rounded-2xl bg-[#F0EFED] flex items-center justify-center">
              <svg className="w-7 h-7 text-[#C5C2BC]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5m8.25 3v6.75m0 0l-3-3m3 3l3-3M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
              </svg>
            </div>
            <p className="text-[#B0ADA6] text-sm" style={{ fontFamily: "var(--font-roboto)" }}>
              Ce catalogue est vide pour le moment.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 md:gap-5">
            {products.map(({ product, selectedColorId, selectedImagePath }, index) => (
              <div
                key={product.id}
                className="transition-all duration-600 ease-out"
                style={{
                  opacity: index < visibleCount ? 1 : 0,
                  transform: index < visibleCount
                    ? "translateY(0) scale(1)"
                    : "translateY(30px) scale(0.97)",
                }}
              >
                <CatalogProductCard
                  product={product}
                  selectedColorId={selectedColorId}
                  selectedImagePath={selectedImagePath}
                  isAuthenticated={isAuthenticated}
                  catalogToken={catalogToken}
                  isFavorite={favoriteProductIds.includes(product.id)}
                />
              </div>
            ))}
          </div>
        )}
      </main>

      {/* ── Footer ──────────────────────────────────────────────────────── */}
      <footer className="border-t border-[#EEECE9] bg-white">
        <div className="max-w-[1400px] mx-auto px-6 py-6 flex items-center justify-between">
          <p className="text-[#C5C2BC] text-xs" style={{ fontFamily: "var(--font-roboto)" }}>
            {shopName}
          </p>
          <p className="text-[#D8D6D2] text-[11px]" style={{ fontFamily: "var(--font-roboto)" }}>
            {title}
          </p>
        </div>
      </footer>
    </div>
  );
}
