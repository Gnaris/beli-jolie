/**
 * AsyncLocalStorage pour propager le tenant courant à travers TOUS les
 * microtasks du même request, y compris les callbacks des extensions Prisma.
 *
 * Pourquoi ce fichier existe :
 * `next/headers::headers()` marche dans les server components / route handlers
 * mais throw dans les callbacks async imbriqués (extension Prisma). C'est un
 * comportement connu Next 16 : le request scope Next.js ne survit pas aux
 * microtasks internes. Node's AsyncLocalStorage, elle, propage correctement.
 *
 * Convention : le tenant est posé via `enterWith(id)` dans les helpers
 * `getCurrentTenantId/getCurrentTenant/requireCurrentTenant` (lib/tenant.ts).
 * L'extension Prisma lit d'abord ici, puis fait un fallback sur `next/headers`
 * pour les cas où l'ALS n'aurait pas été populée.
 */
import { AsyncLocalStorage } from "node:async_hooks";

export const tenantALS = new AsyncLocalStorage<string>();

/** Pose le tenant courant dans l'ALS pour le reste du contexte async. */
export function bindTenantId(id: string): void {
  tenantALS.enterWith(id);
}

/** Récupère le tenant courant (sync) — utilisé par l'extension Prisma. */
export function getCurrentTenantIdSync(): string | null {
  return tenantALS.getStore() ?? null;
}
