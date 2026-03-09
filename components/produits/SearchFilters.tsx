"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useTransition } from "react";

interface Category {
  id: string;
  name: string;
}

interface SearchFiltersProps {
  categories: Category[];
  totalCount: number;
}

export default function SearchFilters({ categories, totalCount }: SearchFiltersProps) {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  const q   = searchParams.get("q")   ?? "";
  const cat = searchParams.get("cat") ?? "";

  const update = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) params.set(key, value);
      else params.delete(key);
      params.delete("page"); // reset pagination si on filtre
      startTransition(() => {
        router.push(`/produits?${params.toString()}`);
      });
    },
    [router, searchParams]
  );

  return (
    <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
      {/* Barre de recherche */}
      <div className="relative flex-1 max-w-sm">
        <svg
          className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#94A3B8]"
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
        </svg>
        <input
          type="search"
          defaultValue={q}
          onChange={(e) => update("q", e.target.value)}
          placeholder="Rechercher un produit…"
          className="w-full pl-9 pr-3 py-2 border border-[#E2E8F0] bg-white text-sm font-[family-name:var(--font-roboto)] text-[#0F172A] focus:outline-none focus:border-[#0F3460]"
        />
      </div>

      {/* Filtre catégorie */}
      <select
        value={cat}
        onChange={(e) => update("cat", e.target.value)}
        className="border border-[#E2E8F0] bg-white px-3 py-2 text-sm font-[family-name:var(--font-roboto)] text-[#0F172A] focus:outline-none focus:border-[#0F3460]"
      >
        <option value="">Toutes les catégories</option>
        {categories.map((c) => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>

      {/* Compteur */}
      <span className="text-sm text-[#94A3B8] font-[family-name:var(--font-roboto)] shrink-0">
        {totalCount} produit{totalCount > 1 ? "s" : ""}
      </span>

      {/* Reset */}
      {(q || cat) && (
        <button
          type="button"
          onClick={() => router.push("/produits")}
          className="text-xs text-[#0F3460] hover:text-[#0A2540] font-[family-name:var(--font-roboto)] underline shrink-0"
        >
          Réinitialiser
        </button>
      )}
    </div>
  );
}
