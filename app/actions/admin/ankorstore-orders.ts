/**
 * STUB temporaire — Ankorstore Orders désactivé (2026-08-13).
 *
 * L'ancien module utilisait l'API partenaire OAuth2. Il est démantelé
 * dans le cadre du chantier reverse-engineering back-office. Un nouveau
 * module viendra dans une itération ultérieure via lib/ankorstore-bo/orders.ts.
 *
 * En attendant, ce fichier expose les mêmes signatures pour ne pas casser
 * les composants UI (`MarketplacesOrdersView`, etc.) — toutes les fonctions
 * retournent des listes vides ou des flags "désactivé".
 */

"use server";

export interface AnkorstoreOrderDetailFull {
  id: string;
  status: "NEW" | "VALIDATED" | "SHIPPED" | "CANCELLED";
  reference: string;
  createdAt: string;
  totalCents: number;
  currency: string;
  items: Array<{
    id: string;
    productName: string;
    variantSku: string | null;
    multipliedQuantity: number;
    unitPriceCents: number;
  }>;
  buyer: { name: string; email: string | null } | null;
  shippingAddress: unknown;
  billingAddress: unknown;
}

export interface AnkorstoreImportState {
  status: "IDLE" | "RUNNING" | "COMPLETED" | "FAILED";
  running: boolean;
  lastRunAt: string | null;
  errorMessage: string | null;
}

/** STUB — retourne une liste vide en attendant le nouveau reverse. */
export async function listAnkorstoreOrders(): Promise<AnkorstoreOrderDetailFull[]> {
  return [];
}

/** STUB — retourne toujours "non-running / jamais lancé". */
export async function getAnkorstoreImportState(): Promise<AnkorstoreImportState> {
  return {
    status: "IDLE",
    running: false,
    lastRunAt: null,
    errorMessage: "Ankorstore désactivé temporairement",
  };
}

/** STUB — no-op. */
export async function triggerAnkorstoreOrdersImport(): Promise<{ success: false; error: string }> {
  return {
    success: false,
    error:
      "Import des commandes Ankorstore désactivé pendant le chantier de reverse-engineering. Consulte les commandes directement sur fr.ankorstore.com.",
  };
}

/** STUB — no-op. */
export async function ankorstoreGetOrderDetail(): Promise<null> {
  return null;
}

/** STUB — no-op. */
export async function markAnkorstoreOrderAsShipped(): Promise<{ success: false; error: string }> {
  return { success: false, error: "Ankorstore désactivé temporairement" };
}

/** STUB — no-op. */
export async function deductAnkorstoreStock(): Promise<{ success: false; error: string }> {
  return { success: false, error: "Ankorstore désactivé temporairement" };
}

/** STUB — no-op, aligne signature avec MarketplacesOrdersView. */
export async function syncAnkorstoreOrdersNow(): Promise<
  | { success: false; error: string }
  | { success: true; created: number; updated: number }
> {
  return { success: false, error: "Ankorstore désactivé temporairement" };
}

/** STUB — no-op, aligne signature avec MarketplacesOrdersView. */
export async function startAnkorstoreHistoricalImport(): Promise<{ success: false; error: string }> {
  return { success: false, error: "Ankorstore désactivé temporairement" };
}

/** STUB — aligne signature avec MarketplacesOrdersView. */
export async function getAnkorstoreImportStateAction(): Promise<AnkorstoreImportState> {
  return getAnkorstoreImportState();
}

/** STUB — aligne signature avec MarketplacesOrdersView (accepte l'id ignoré). */
export async function getAnkorstoreOrderDetail(_id?: string): Promise<AnkorstoreOrderDetailFull | null> {
  return null;
}
