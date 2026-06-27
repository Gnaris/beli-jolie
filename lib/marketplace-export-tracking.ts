/**
 * Enregistre la date du dernier export Excel/ZIP réussi pour chaque produit
 * d'une marketplace donnée. Appelé par l'endpoint `/api/admin/marketplace-export`
 * juste après la génération du fichier (succès HTTP 200) — la cliente n'a pas
 * encore téléchargé le ZIP, mais le fichier est prêt côté serveur, ce qui est
 * suffisant pour considérer le produit comme "récemment exporté" : si elle
 * abandonne le download, elle peut juste recliquer (le tag horodate redevient
 * frais).
 *
 * Le map `MARKETPLACE_FIELD` est volontairement explicite plutôt qu'un suffixe
 * dynamique, pour que TypeScript valide chaque branche et que tout renommage
 * futur dans le schéma soit détecté au build.
 */
import type { MarketplaceKey } from "@/lib/marketplace-excel/types";
import { prisma } from "@/lib/prisma";

const MARKETPLACE_FIELD = {
  pfs:        "pfsLastExportedAt",
  efashion:   "efashionLastExportedAt",
  microstore: "microstoreLastExportedAt",
  ankorstore: "ankorstoreLastExportedAt",
  faire:      "faireLastExportedAt",
} as const satisfies Record<MarketplaceKey, string>;

export async function recordMarketplaceExport(
  marketplace: MarketplaceKey,
  productIds: string[],
  now: Date = new Date(),
): Promise<void> {
  if (productIds.length === 0) return;
  const field = MARKETPLACE_FIELD[marketplace];
  await prisma.product.updateMany({
    where: { id: { in: productIds } },
    data: { [field]: now },
  });
}
