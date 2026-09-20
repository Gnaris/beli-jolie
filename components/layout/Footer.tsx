import { getEffectiveTenantSlug } from "@/lib/tenant-preview";
import FooterBeliandjolie from "@/components/layout/FooterBeliandjolie";
import FooterIssyma from "@/components/layout/FooterIssyma";

interface FooterProps {
  shopName: string;
  /** @deprecated Consulté auparavant pour éviter un lookup ; la résolution
   *  passe désormais toujours par `getEffectiveTenantSlug()` (single source
   *  of truth, gère aussi le cookie preview en dev). Conservé dans le type
   *  pour que les 13 pages qui le passent encore compilent sans changement. */
  tenantSlug?: string;
}

/**
 * Aiguilleur serveur : choisit la version de pied de page à rendre selon la
 * boutique (« beliandjolie » vs « issyma »). Les deux versions sont
 * aujourd'hui identiques ; chaque boutique pourra diverger indépendamment
 * ensuite.
 *
 * En dev, le cookie `bj_home_preview` (posé par TenantDevSwitcher) prime sur
 * le slug résolu par le middleware, permettant à la cliente de basculer d'une
 * boutique à l'autre en local sans changer de domaine. En prod, l'override
 * cookie est ignoré : la boutique dépend exclusivement du domaine visité.
 *
 * Les 13 pages qui importent `@/components/layout/Footer` continuent de
 * fonctionner sans changement.
 */
export default async function Footer({ shopName }: FooterProps) {
  const slug = await getEffectiveTenantSlug();
  if (slug === "issyma") {
    return <FooterIssyma shopName={shopName} />;
  }
  return <FooterBeliandjolie shopName={shopName} />;
}
