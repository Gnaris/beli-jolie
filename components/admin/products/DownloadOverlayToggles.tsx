"use client";

/**
 * Trois cases à cocher partagées entre la fiche produit, la fiche commande et
 * le panier admin client :
 *   - « Afficher le prix » (coin bas-droite)
 *   - « Tampon Rupture de stock » (diagonale centrale)
 *   - « Référence » (badge haut-droite, type badge « Réf »)
 *
 * L'état est mémorisé en localStorage (une clé par bascule) pour que le choix
 * de la cliente persiste entre les ouvertures de modale et les rechargements
 * de page. Les composants qui l'utilisent récupèrent `[price, setPrice]`,
 * `[stock, setStock]` et `[reference, setReference]` via le hook
 * `usePersistedOverlayToggles()`.
 */

import { useCallback, useEffect, useState } from "react";
import { formatPriceEuros } from "@/lib/download-image-overlays";

const STORAGE_KEY_PRICE = "bj:download-overlay:price";
const STORAGE_KEY_STOCK = "bj:download-overlay:stock";
const STORAGE_KEY_REFERENCE = "bj:download-overlay:reference";

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
  showReference: boolean;
  setShowPrice: (next: boolean) => void;
  setShowOutOfStock: (next: boolean) => void;
  setShowReference: (next: boolean) => void;
}

export function usePersistedOverlayToggles(): PersistedToggles {
  // SSR-safe : on démarre à false et on relit depuis localStorage une fois monté
  // pour éviter l'hydratation mismatch côté Next.
  const [showPrice, setShowPriceState] = useState<boolean>(false);
  const [showOutOfStock, setShowOutOfStockState] = useState<boolean>(false);
  const [showReference, setShowReferenceState] = useState<boolean>(false);

  useEffect(() => {
    setShowPriceState(readBooleanFromStorage(STORAGE_KEY_PRICE));
    setShowOutOfStockState(readBooleanFromStorage(STORAGE_KEY_STOCK));
    setShowReferenceState(readBooleanFromStorage(STORAGE_KEY_REFERENCE));
  }, []);

  const setShowPrice = useCallback((next: boolean) => {
    setShowPriceState(next);
    writeBooleanToStorage(STORAGE_KEY_PRICE, next);
  }, []);
  const setShowOutOfStock = useCallback((next: boolean) => {
    setShowOutOfStockState(next);
    writeBooleanToStorage(STORAGE_KEY_STOCK, next);
  }, []);
  const setShowReference = useCallback((next: boolean) => {
    setShowReferenceState(next);
    writeBooleanToStorage(STORAGE_KEY_REFERENCE, next);
  }, []);

  return {
    showPrice,
    showOutOfStock,
    showReference,
    setShowPrice,
    setShowOutOfStock,
    setShowReference,
  };
}

interface Props {
  showPrice: boolean;
  showOutOfStock: boolean;
  showReference: boolean;
  onChangePrice: (next: boolean) => void;
  onChangeOutOfStock: (next: boolean) => void;
  onChangeReference: (next: boolean) => void;
  /** Prix mini en euros pour la couleur / l'article courant. Null = pas de prix dispo. */
  priceEuros: number | null;
  /** Référence produit à apposer. Null = pas de référence connue → case désactivée. */
  reference: string | null;
  /** Désactive la case « Référence » (ex. 1ʳᵉ image avec badge déjà cuit).
   *  Quand true, la case est bloquée avec un libellé explicatif. */
  disableReference?: boolean;
  /** Variante compacte sombre pour fond noir (zoom plein écran). */
  variant?: "light" | "dark";
}

/**
 * Pavé de 3 cases à cocher avec libellés. Sur fond clair (modale), variante
 * "light" ; sur fond noir (zoom plein écran), variante "dark".
 */
export function OverlayToggles({
  showPrice,
  showOutOfStock,
  showReference,
  onChangePrice,
  onChangeOutOfStock,
  onChangeReference,
  priceEuros,
  reference,
  disableReference = false,
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

  const trimmedRef = typeof reference === "string" ? reference.trim() : "";
  const refDisabled = disableReference || trimmedRef.length === 0;
  const refHint = disableReference
    ? "déjà imprimée"
    : trimmedRef.length === 0
      ? "Pas de référence"
      : trimmedRef;

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
      <label
        className={labelClass + (refDisabled ? " opacity-60 cursor-not-allowed" : "")}
      >
        <input
          type="checkbox"
          className={checkboxClass}
          checked={showReference && !refDisabled}
          disabled={refDisabled}
          onChange={(e) => onChangeReference(e.target.checked)}
        />
        <span className="flex items-center gap-1.5 min-w-0">
          Référence
          <span className={subClass + " truncate"}>· {refHint}</span>
        </span>
      </label>
    </div>
  );
}
