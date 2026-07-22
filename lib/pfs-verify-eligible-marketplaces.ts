/**
 * Détermine quelles marketplaces (parmi Ankorstore / eFashion / Faire) sont
 * éligibles pour propager les valeurs qu'un produit vient de récupérer depuis
 * PFS via le tooltip de vérification.
 *
 * Une marketplace est éligible si les 4 conditions sont réunies :
 *  1. Le produit lui est lié (ID marketplace non nul, ou variante eFashion liée).
 *  2. La marketplace n'a pas été désactivée dans la fiche produit (`*Enabled`).
 *  3. La marketplace n'est pas coupée au niveau système (kill switch SiteConfig).
 *  4. La marketplace est configurée (credentials présents dans SiteConfig).
 *
 * PFS est volontairement exclu : c'est la source des valeurs, il n'y a rien à
 * lui propager. Le résultat est donc restreint aux 3 autres marketplaces.
 */

import { prisma } from "@/lib/prisma";
import {
  getCachedAnkorstoreEnabled,
  getCachedEfashionEnabled,
  getCachedFaireEnabled,
} from "@/lib/cached-data";

export type PfsPullEligibleMarketplace = "ankorstore" | "efashion" | "faire";

export async function computePfsPullEligibleMarketplaces(
  productId: string,
): Promise<PfsPullEligibleMarketplace[]> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: {
      ankorsProductId: true,
      ankorsEnabled: true,
      efashionEnabled: true,
      faireProductId: true,
      faireEnabled: true,
      colors: {
        select: { efashionProductId: true },
      },
    },
  });
  if (!product) return [];

  const [ankorsGlobal, efashionGlobal, faireGlobal] = await Promise.all([
    getCachedAnkorstoreEnabled(),
    getCachedEfashionEnabled(),
    getCachedFaireEnabled(),
  ]);

  const result: PfsPullEligibleMarketplace[] = [];

  if (product.ankorsProductId && product.ankorsEnabled && ankorsGlobal) {
    result.push("ankorstore");
  }
  const hasEfashionLink = product.colors.some((c) => c.efashionProductId != null);
  if (hasEfashionLink && product.efashionEnabled && efashionGlobal) {
    result.push("efashion");
  }
  if (product.faireProductId && product.faireEnabled && faireGlobal) {
    result.push("faire");
  }

  return result;
}
