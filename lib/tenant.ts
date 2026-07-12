import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { bindTenantId } from "@/lib/tenant-als";

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
