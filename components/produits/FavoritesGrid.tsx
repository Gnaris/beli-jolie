"use client";

import { useState } from "react";
import ProductCard from "./ProductCard";

// On reprend la même forme de produit que dans la page favoris (ProductCard).
type VariantItem = {
  id:           string;
  saleType:     "UNIT" | "PACK";
  packQuantity: number | null;
  sizes:        { name: string; quantity: number }[];
  unitPrice:    number;
  stock:        number;
};

type ColorEntry = {
  groupKey:      string;
  colorId:       string;
  name:          string;
  hex:           string | null;
  patternImage?: string | null;
  firstImage:    string | null;
  unitPrice:     number;
  isPrimary:     boolean;
  totalStock:    number;
  variants:      VariantItem[];
};

export interface FavoritesGridItem {
  id:           string;
  name:         string;
  reference:    string;
  category:     string;
  subCategory:  string | null;
  colors:       ColorEntry[];
  tags:         { id: string; name: string }[];
  isBestSeller: boolean;
  isNew:        boolean;
  /** Meilleur % de remise applicable (manuel + promos AUTO ciblantes). */
  discountPercent: number | null;
}

interface Props {
  items: FavoritesGridItem[];
}

export default function FavoritesGrid({ items }: Props) {
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set());

  function handleFavoriteChange(productId: string, isFavorite: boolean) {
    if (!isFavorite) {
      setRemovedIds((prev) => {
        if (prev.has(productId)) return prev;
        const next = new Set(prev);
        next.add(productId);
        return next;
      });
    }
  }

  const visible = items.filter((it) => !removedIds.has(it.id));

  return (
    <div className="grid grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 auto-rows-fr gap-3 sm:gap-4">
      {visible.map((p) => (
        <ProductCard
          key={p.id}
          id={p.id}
          name={p.name}
          reference={p.reference}
          category={p.category}
          subCategory={p.subCategory}
          colors={p.colors}
          tags={p.tags}
          isFavorite={true}
          isBestSeller={p.isBestSeller}
          isNew={p.isNew}
          discountPercent={p.discountPercent}
          onFavoriteChange={(isFav) => handleFavoriteChange(p.id, isFav)}
        />
      ))}
    </div>
  );
}
