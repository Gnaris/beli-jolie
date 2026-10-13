"use client";

/**
 * Deux cases à cocher partagées entre la fiche produit et la fiche commande :
 *   - « Afficher le prix » (coin bas-droite)
 *   - « Tampon Rupture de stock » (diagonale centrale)
 *
 * L'état est mémorisé en localStorage (une clé par bascule) pour que le choix
 * de la cliente persiste entre les ouvertures de modale et les rechargements
 * de page. Les composants qui l'utilisent récupèrent `[price, setPrice]` et
 * `[stock, setStock]` via le hook `usePersistedOverlayToggles()`.
 */

import { useCallback, useEffect, useState } from "react";
import { formatPriceEuros } from "@/lib/download-image-overlays";

const STORAGE_KEY_PRICE = "bj:download-overlay:price";
const STORAGE_KEY_STOCK = "bj:download-overlay:stock";

function readBooleanFromStorage(key: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function writeBooleanToStorage(key: string, value: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value ? "1" : "0");
  } catch {
    /* storage plein ou désactivé — on continue silencieusement */
  }
}

export interface PersistedToggles {
  showPrice: boolean;
  showOutOfStock: boolean;
  setShowPrice: (next: boolean) => void;
  setShowOutOfStock: (next: boolean) => void;
}

export function usePersistedOverlayToggles(): PersistedToggles {
  // SSR-safe : on démarre à false et on relit depuis localStorage une fois monté
  // pour éviter l'hydratation mismatch côté Next.
  const [showPrice, setShowPriceState] = useState<boolean>(false);
  const [showOutOfStock, setShowOutOfStockState] = useState<boolean>(false);

  useEffect(() => {
    setShowPriceState(readBooleanFromStorage(STORAGE_KEY_PRICE));
    setShowOutOfStockState(readBooleanFromStorage(STORAGE_KEY_STOCK));
  }, []);

  const setShowPrice = useCallback((next: boolean) => {
    setShowPriceState(next);
    writeBooleanToStorage(STORAGE_KEY_PRICE, next);
  }, []);
  const setShowOutOfStock = useCallback((next: boolean) => {
    setShowOutOfStockState(next);
    writeBooleanToStorage(STORAGE_KEY_STOCK, next);
  }, []);

  return { showPrice, showOutOfStock, setShowPrice, setShowOutOfStock };
}

interface Props {
  showPrice: boolean;
  showOutOfStock: boolean;
  onChangePrice: (next: boolean) => void;
  onChangeOutOfStock: (next: boolean) => void;
  /** Prix mini en euros pour la couleur / l'article courant. Null = pas de prix dispo. */
  priceEuros: number | null;
  /** Variante compacte sombre pour fond noir (zoom plein écran). */
  variant?: "light" | "dark";
}

/**
 * Pavé de 2 cases à cocher avec libellés. Sur fond clair (modale), variante
 * "light" ; sur fond noir (zoom plein écran), variante "dark".
 */
export function OverlayToggles({
  showPrice,
  showOutOfStock,
  onChangePrice,
  onChangeOutOfStock,
  priceEuros,
  variant = "light",
}: Props) {
  const isDark = variant === "dark";
  const container = isDark
    ? "flex flex-col gap-2 rounded-xl bg-black/55 px-3 py-2.5 backdrop-blur-sm border border-white/10"
    : "flex flex-col gap-2 rounded-xl bg-bg-secondary/70 px-3 py-2.5 border border-border";
  const labelClass = isDark
    ? "flex items-center gap-2 text-xs font-semibold text-white font-body cursor-pointer select-none"
    : "flex items-center gap-2 text-xs font-semibold text-text-primary font-body cursor-pointer select-none";
  const subClass = isDark
    ? "text-[10px] font-medium text-white/70 font-body"
    : "text-[10px] font-medium text-text-muted font-body";
  const checkboxClass = isDark
    ? "w-4 h-4 accent-white cursor-pointer"
    : "w-4 h-4 accent-bg-dark cursor-pointer";

  const priceDisabled = priceEuros === null || !Number.isFinite(priceEuros);
  const priceHint = priceDisabled
    ? "Aucun prix saisi"
    : formatPriceEuros(priceEuros as number);

  return (
    <div className={container} role="group" aria-label="Options d'overlay à l'export">
      <label className={labelClass}>
        <input
          type="checkbox"
          className={checkboxClass}
          checked={showPrice && !priceDisabled}
          disabled={priceDisabled}
          onChange={(e) => onChangePrice(e.target.checked)}
        />
        <span className="flex items-center gap-1.5">
          Prix
          <span className={subClass}>· {priceHint}</span>
        </span>
      </label>
      <label className={labelClass}>
        <input
          type="checkbox"
          className={checkboxClass}
          checked={showOutOfStock}
          onChange={(e) => onChangeOutOfStock(e.target.checked)}
        />
        <span className="flex items-center gap-1.5">
          Tampon « Rupture de stock »
        </span>
      </label>
    </div>
  );
}
