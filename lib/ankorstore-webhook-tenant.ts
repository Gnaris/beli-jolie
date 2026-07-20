/**
 * Résolution tenant pour le webhook Ankorstore.
 *
 * Ankorstore appelle notre callback via l'URL configurée (`NEXTAUTH_URL`), donc
 * TOUS les callbacks — quelle que soit la boutique concernée — arrivent sur le
 * même host (par ex. `beliandjolie.com`). Le middleware pose alors
 * `x-tenant-id = beliandjolie` sur la requête, et l'extension Prisma scope
 * automatiquement les reads/updates sur ce tenant. Résultat : quand l'op
 * appartient à Issyma (ou toute autre boutique), le `findUnique` retourne
 * `null` et la row reste éternellement en `PENDING` → UI loading à l'infini.
 *
 * La parade : lire d'abord le vrai `tenantId` de l'op via `$queryRaw` (qui
 * ne passe pas par l'extension), puis wrap tout le reste dans `tenantALS.run`
 * pour que les queries en aval soient scopées sur la bonne boutique.
 */
import { prisma } from "@/lib/prisma";
import { tenantALS } from "@/lib/tenant-als";

export async function findAnkorstoreOperationTenantId(
  operationId: string,
): Promise<string | null> {
  const rows = await prisma.$queryRaw<Array<{ tenantId: string | null }>>`
    SELECT tenantId FROM AnkorstoreOperation WHERE id = ${operationId} LIMIT 1
  `;
  if (rows.length === 0) return null;
  return rows[0].tenantId ?? null;
}

/**
 * Résout le tenantId de l'op (avec 2 retries pour la race « callback reçu
 * avant que le persist local ait terminé »). Renvoie `null` si l'op reste
 * introuvable — le webhook doit alors ACK sans traiter.
 */
export async function resolveAnkorstoreOperationTenantId(
  operationId: string,
  sleep: (ms: number) => Promise<void> = defaultSleep,
): Promise<string | null> {
  let tenantId = await findAnkorstoreOperationTenantId(operationId);
  for (let attempt = 1; attempt <= 2 && !tenantId; attempt++) {
    await sleep(1500 * attempt);
    tenantId = await findAnkorstoreOperationTenantId(operationId);
  }
  return tenantId;
}

/**
 * Exécute `callback` dans un scope `tenantALS.run(tenantId)` — toutes les
 * queries Prisma en aval sont scopées sur la boutique passée. Utilisée par le
 * webhook Ankorstore pour surcharger le tenant du Host (posé par le middleware)
 * par celui de l'opération elle-même.
 */
export function runInAnkorstoreOperationTenant<T>(
  tenantId: string,
  callback: () => Promise<T>,
): Promise<T> {
  return tenantALS.run(tenantId, callback);
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
