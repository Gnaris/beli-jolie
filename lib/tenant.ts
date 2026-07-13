import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { bindTenantId, getCurrentTenantIdSync } from "@/lib/tenant-als";

/**
 * Fournit l'accès à la boutique courante côté serveur (server components,
 * server actions, API routes).
 *
 * La résolution `host → tenant` est faite par le middleware, qui pose 3 headers
 * sur la requête entrante :
 *   - `x-tenant-id`   : id de la boutique
 *   - `x-tenant-slug` : slug (`beliandjolie`, `issyma`, …), utilisé pour les uploads
 *   - `x-tenant-name` : nom affiché
 *
 * En cas d'appel depuis un contexte sans header (jobs cron, scripts…),
 * `getCurrentTenantId()` renvoie `null`. Les server actions doivent alors
 * refuser de continuer plutôt que de silently taper sur la mauvaise boutique.
 */

export type CurrentTenant = {
  id: string;
  slug: string;
  name: string;
};

const TENANT_ID_HEADER = "x-tenant-id";
const TENANT_SLUG_HEADER = "x-tenant-slug";
const TENANT_NAME_HEADER = "x-tenant-name";

export async function getCurrentTenantId(): Promise<string | null> {
  const h = await headers();
  const id = h.get(TENANT_ID_HEADER) ?? null;
  // Propage dans l'ALS pour que l'extension Prisma puisse le lire, même dans
  // les microtasks où next/headers throw ("headers was called outside a request scope").
  if (id) bindTenantId(id);
  return id;
}

export async function getCurrentTenantSlug(): Promise<string | null> {
  const h = await headers();
  const slug = h.get(TENANT_SLUG_HEADER) ?? null;
  const id = h.get(TENANT_ID_HEADER);
  if (id) bindTenantId(id);
  return slug;
}

export async function getCurrentTenant(): Promise<CurrentTenant | null> {
  const h = await headers();
  const id = h.get(TENANT_ID_HEADER);
  const slug = h.get(TENANT_SLUG_HEADER);
  const name = h.get(TENANT_NAME_HEADER);
  if (!id || !slug || !name) return null;
  bindTenantId(id);
  return { id, slug, name };
}

/**
 * Version stricte : refuse de rendre la main si le tenant n'a pas été résolu.
 * À utiliser dans les server actions et les pages qui manipulent des données
 * scopées par boutique.
 */
export async function requireCurrentTenant(): Promise<CurrentTenant> {
  const tenant = await getCurrentTenant();
  if (!tenant) {
    throw new Error(
      "[tenant] Aucun tenant résolu dans la requête. Vérifie que le middleware " +
        "a bien été traversé et que le domaine appelé est enregistré dans TenantDomain."
    );
  }
  return tenant;
}

/**
 * Lookup direct par host (utilisé par le middleware via un fetch interne,
 * ou par des scripts CLI qui ne passent pas par le middleware).
 */
export async function resolveTenantByHost(host: string): Promise<CurrentTenant | null> {
  const mapping = await prisma.tenantDomain.findUnique({
    where: { host: host.toLowerCase() },
    include: { tenant: true },
  });
  if (!mapping || !mapping.tenant || !mapping.tenant.isActive) return null;
  return {
    id: mapping.tenant.id,
    slug: mapping.tenant.slug,
    name: mapping.tenant.name,
  };
}

/**
 * Résout le tenant courant sans throw : ALS d'abord (safe hors requête), puis
 * `next/headers` en fallback via try/catch. Utile pour du code fire-and-forget
 * ou pour les tests unitaires où `headers()` n'est pas disponible.
 */
export async function getCurrentTenantIdSafe(): Promise<string | null> {
  const alsId = getCurrentTenantIdSync();
  if (alsId) return alsId;
  try {
    return await getCurrentTenantId();
  } catch {
    return null;
  }
}

/**
 * Renvoie l'URL de base publique (`https://<host>`) du tenant. Sert notamment
 * à construire les URLs d'images envoyées aux marketplaces : Faire/Ankorstore
 * doivent fetcher `https://issyma.fr/api/marketplace-image?...` pour un
 * produit Issyma, pas `https://beliandjolie.com/...` — sinon le proxy
 * refuse (isolation multi-tenant du path : cf. `/api/marketplace-image`).
 *
 * Ordre de priorité :
 *   1. Domaine `isPrimary` du tenant.
 *   2. Premier domaine (ordre `createdAt` asc) — filet quand personne n'a
 *      encore posé `isPrimary=true` sur un domaine.
 *   3. `null` — laisser l'appelant retomber sur son fallback (env vars).
 *
 * NOTE : pas de scheme http:// en local — cette fonction sert exclusivement
 * les liens exposés à des marketplaces externes, qui n'atteignent jamais
 * `localhost`. Toujours `https://`.
 */
export async function getTenantBaseUrl(tenantId: string): Promise<string | null> {
  const domain = await prisma.tenantDomain.findFirst({
    where: { tenantId },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    select: { host: true },
  });
  if (!domain) return null;
  return `https://${domain.host}`;
}
