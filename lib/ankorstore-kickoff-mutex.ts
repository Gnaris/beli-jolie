/**
 * Sérialise les kickoffs Ankorstore (create → add → start operation).
 *
 * Pourquoi : Ankorstore déduplique les `POST /catalog/integrations/operations`
 * envoyés simultanément et renvoie le MÊME operationId — même quand notre body
 * inclut un nonce unique dans callbackUrl. Résultat : deux kickoffs en parallèle
 * partagent la même op, le second `PATCH … status=started` échoue en 403
 * « cannot be updated from [started] to [started] ». Constaté en prod 2026-07-31
 * après passage à ANKORSTORE_CONCURRENCY > 1.
 *
 * Le mutex est process-global (partagé entre tenants) : la dédup Ankor porte
 * sur le body HTTP, pas sur l'auth — un kickoff BJ + un kickoff Issyma
 * simultanés se collisionneraient aussi.
 *
 * Impact : la phase kickoff (~2-3 s par produit, 3 appels HTTP synchrones)
 * devient sérielle, mais la longue phase AWAITING_CALLBACK (30-60 s) reste
 * parallèle → gain de temps massif préservé quand ANKORSTORE_CONCURRENCY > 1.
 */

let chain: Promise<unknown> = Promise.resolve();

export function ankorstoreKickoffMutex<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn);
  chain = next.catch(() => undefined);
  return next;
}

/**
 * Test-only : remet le mutex à zéro pour éviter les fuites entre tests.
 */
export function __resetAnkorstoreKickoffMutex(): void {
  chain = Promise.resolve();
}
