import { getEffectiveTenantSlug } from "@/lib/tenant-preview";
import PublicSidebarBeliandjolie from "@/components/layout/PublicSidebarBeliandjolie";
import PublicSidebarIssyma from "@/components/layout/PublicSidebarIssyma";

interface PublicSidebarProps {
  shopName: string;
  /** @deprecated Consulté auparavant pour éviter un lookup ; la résolution
   *  passe désormais toujours par `getEffectiveTenantSlug()` (single source
   *  of truth, gère aussi le cookie preview en dev). Conservé dans le type
   *  pour que les 17 pages qui le passent encore compilent sans changement. */
  tenantSlug?: string;
}

/**
 * Aiguilleur serveur : choisit la version d'en-tête à rendre selon la boutique
 * (« beliandjolie » vs « issyma »). Les deux versions sont aujourd'hui
 * identiques ; chaque boutique pourra diverger indépendamment ensuite.
 *
 * En dev, le cookie `bj_home_preview` (posé par TenantDevSwitcher) prime sur
 * le slug résolu par le middleware, permettant à la cliente de basculer d'une
 * boutique à l'autre en local sans changer de domaine. En prod, l'override
 * cookie est ignoré : la boutique dépend exclusivement du domaine visité.
 *
 * Les 17 pages qui importent `@/components/layout/PublicSidebar` continuent de
 * fonctionner sans changement.
 */
export default async function PublicSidebar({ shopName }: PublicSidebarProps) {
  const slug = await getEffectiveTenantSlug();
  if (slug === "issyma") {
    return <PublicSidebarIssyma shopName={shopName} tenantSlug={slug} />;
  }
  return <PublicSidebarBeliandjolie shopName={shopName} tenantSlug={slug} />;
}
