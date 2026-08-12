/**
 * Sérialise la phase kickoff des opérations Ankorstore (create → add → start).
 *
 * Pourquoi : Ankorstore renvoie le MÊME operationId à tout POST
 * `/catalog/integrations/operations` tant qu'une op précédente reste en état
 * `created` (pas encore `started`). Vérifié en réel 2026-08-12 :
 * 5 POST successifs (même sériels) → 5× le même opId ; dès qu'on PATCH → started,
 * le POST suivant crée bien un nouvel opId.
 *
 * Sans mutex, 2 threads qui font create+add+start concurrents partagent la même
 * op : le second PATCH échoue en 403 « cannot be updated from [started] to
 * [started] » (constaté en prod 2026-07-31 après passage à ANKORSTORE_CONCURRENCY > 1).
 *
 * Le mutex est **process-global** (partagé entre tenants) : la dédup Ankor
 * pourrait ne porter que sur un compte API, mais on n'a pas de preuve — mieux
 * vaut sérialiser globalement. Impact : la phase kickoff (~2-3 s par produit,
 * 3 appels HTTP synchrones) devient sérielle, mais la longue phase
 * AWAITING_CALLBACK (30-60 s) reste parallèle → gain massif quand
 * ANKORSTORE_CONCURRENCY > 1.
 */

let chain: Promise<unknown> = Promise.resolve();

export function ankorstoreKickoffMutex<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn);
  chain = next.catch(() => undefined);
  return next;
}

/** Test-only : remet le mutex à zéro pour éviter les fuites entre tests. */
export function __resetAnkorstoreKickoffMutex(): void {
  chain = Promise.resolve();
}
