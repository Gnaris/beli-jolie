/**
 * STUB — server action Ankorstore legacy.
 *
 * Le vieux flow OAuth2 callback-only a été supprimé (2026-08-13). Les nouvelles
 * fonctions publiques vivent dans `app/actions/admin/ankorstore-bo.ts`.
 *
 * Ce fichier expose uniquement les entrées encore importées par du code hérité
 * (MarketplaceStatusButtons, linkMarketplaceAdapters, ankorstore-search) :
 *  - removeAnkorstoreMatch     → délégation vers `unlinkBjProductFromAnkorstoreBo`
 *  - AnkorstoreLinkPreview     → type minimal conservé
 *  - previewAnkorstoreProductForLinking / linkAnkorstoreProductWithMapping → désactivés
 */

"use server";

import { unlinkBjProductFromAnkorstoreBo } from "@/app/actions/admin/ankorstore-bo";

export interface AnkorstoreLinkPreviewLocalColor {
  productColorId: string;
  colorId: string;
  name: string;
  hex: string | null;
  patternImage: string | null;
  productImage: string | null;
  saleType: "UNIT" | "PACK";
  sizes: string[];
  unitPrice: number;
  packQuantity: number | null;
  stock: number;
  weightKg: number | null;
}

export interface AnkorstoreLinkPreview {
  productId: string;
  productName: string;
  reference: string;
  searchQuery: string;
  marketplaceProductId: string | null;
  marketplaceProductName: string | null;
  marketplaceProductImage: string | null;
  localColors: AnkorstoreLinkPreviewLocalColor[];
  candidates: unknown[];
  existingLinks: Record<string, string>;
  alreadyLinked: boolean;
  missingAttributes: string[];
  extras: Record<string, unknown>;
  weightIsProductLevel: boolean;
}

export async function removeAnkorstoreMatch(
  productId: string
): Promise<{ success: boolean; error?: string }> {
  const r = await unlinkBjProductFromAnkorstoreBo(productId);
  return { success: r.success };
}

const DISABLED_ERROR =
  "Flux de liaison Ankorstore V1 désactivé — utiliser la nouvelle modale (v2 back-office).";

export async function previewAnkorstoreProductForLinking(): Promise<{ success: false; error: string }> {
  return { success: false, error: DISABLED_ERROR };
}

export async function linkAnkorstoreProductWithMapping(): Promise<{ success: false; error: string }> {
  return { success: false, error: DISABLED_ERROR };
}

export async function runAutoMatch(): Promise<{ success: false; error: string }> {
  return { success: false, error: DISABLED_ERROR };
}

export async function autoLinkAnkorstoreVariants(): Promise<{ success: false; error: string }> {
  return { success: false, error: DISABLED_ERROR };
}
