import { cookies } from "next/headers";
import { getCurrentTenantSlug } from "@/lib/tenant";
import { TENANT_PREVIEW_COOKIE, type TenantSlug } from "@/lib/tenant-preview-shared";

export { TENANT_PREVIEW_COOKIE, type TenantSlug };

function isKnown(slug: string | null | undefined): slug is TenantSlug {
  return slug === "beliandjolie" || slug === "issyma";
}

/**
 * Résout le slug de boutique effectif pour le rendu :
 *   1. En dev, si le cookie `bj_home_preview` contient un slug connu, on
 *      l'utilise (permet à la cliente de basculer entre les 2 boutiques en
 *      local sans changer de domaine — cf. `TenantDevSwitcher`).
 *   2. Sinon, on retourne le slug résolu par le middleware (via `Host:`).
 *   3. En dernier recours (contexte sans headers), fallback `beliandjolie`.
 *
 * En production, l'override cookie est totalement ignoré : la boutique
 * dépend exclusivement du domaine visité.
 *
 * ⚠️ SERVER-ONLY (dépend de `next/headers`). Le composant client
 * `TenantDevSwitcher` doit importer la constante `TENANT_PREVIEW_COOKIE`
 * et le type `TenantSlug` depuis `@/lib/tenant-preview-shared`, pas d'ici.
 */
export async function getEffectiveTenantSlug(): Promise<TenantSlug> {
  const isDev = process.env.NODE_ENV !== "production";

  if (isDev) {
    try {
      const jar = await cookies();
      const override = jar.get(TENANT_PREVIEW_COOKIE)?.value;
      if (isKnown(override)) return override;
    } catch {
      // Pas de contexte requête (script CLI, etc.) : on ignore le cookie.
    }
  }

  const resolved = await getCurrentTenantSlug();
  return isKnown(resolved) ? resolved : "beliandjolie";
}
