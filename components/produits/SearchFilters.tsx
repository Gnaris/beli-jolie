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
      params.delete("page");
      startTransition(() => {
        router.push(`/produits?${params.toString()}`);
      });
    },
    [router, searchParams]
  );

  return (
    <div className="flex flex-col sm:flex-row gap-2.5 items-start sm:items-center">
      {/* Barre de recherche */}
      <div className="relative flex-1 max-w-sm">
        <svg
          className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#999999]"
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
        </svg>
        <input
          type="search"
          defaultValue={q}
          onChange={(e) => update("q", e.target.value)}
          placeholder="Rechercher un produit, une référence…"
          className="w-full pl-9 pr-3 py-2 border border-[#E5E5E5] bg-white rounded-md text-sm font-[family-name:var(--font-roboto)] text-[#1A1A1A] placeholder:text-[#999999] focus:outline-none focus:border-[#1A1A1A] focus:shadow-[0_0_0_2px_rgba(26,26,26,0.06)] transition-all"
        />
      </div>

      {/* Filtre catégorie */}
      <select
        value={cat}
        onChange={(e) => update("cat", e.target.value)}
        className="border border-[#E5E5E5] bg-white rounded-md px-3 py-2 text-sm font-[family-name:var(--font-roboto)] text-[#1A1A1A] focus:outline-none focus:border-[#1A1A1A] focus:shadow-[0_0_0_2px_rgba(26,26,26,0.06)] transition-all"
      >
        <option value="">Toutes les catégories</option>
        {categories.map((c) => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>

      {/* Compteur */}
      <span className="text-sm text-[#999999] font-[family-name:var(--font-roboto)] shrink-0">
        {totalCount} produit{totalCount > 1 ? "s" : ""}
      </span>

      {/* Reset */}
      {(q || cat) && (
        <button
          type="button"
          onClick={() => router.push("/produits")}
          className="text-xs text-[#555555] hover:text-[#1A1A1A] font-[family-name:var(--font-roboto)] underline shrink-0 transition-colors"
        >
          Réinitialiser
        </button>
      )}
    </div>
  );
}
