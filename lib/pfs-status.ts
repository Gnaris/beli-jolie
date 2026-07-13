/**
 * Mapping du statut local d'un produit vers le statut a envoyer a PFS.
 *
 * Regles (alignees publish/update/refresh) :
 *   - toutes variantes en rupture de stock → action configurée dans les
 *       paramètres marketplace PFS (par défaut ARCHIVED, possible DELETED
 *       ou DRAFT). PRIORITAIRE sur le statut local — sinon l'auto-archive
 *       local (déclenché par tous stocks=0) forcerait toujours ARCHIVED
 *       et masquerait le choix de la cliente.
 *   - ARCHIVED localement (avec stock)     → ARCHIVED PFS
 *   - ONLINE localement (avec stock)       → READY_FOR_SALE PFS
 *   - OFFLINE localement (avec stock)      → DRAFT PFS
 *
 * Le passage par ARCHIVED/DELETED/DRAFT quand tout est en rupture est
 * REVERSIBLE tant que la config le permet : a la prochaine sync apres
 * rechargement de stock + statut ONLINE, le produit repartira en
 * READY_FOR_SALE automatiquement.
 */

import type { PfsOutOfStockProductAction } from "@/lib/pfs-out-of-stock-config";

export type PfsTargetStatus = "READY_FOR_SALE" | "DRAFT" | "ARCHIVED" | "DELETED";

const OUT_OF_STOCK_ACTION_TO_STATUS: Record<PfsOutOfStockProductAction, PfsTargetStatus> = {
  archived: "ARCHIVED",
  deleted: "DELETED",
  draft: "DRAFT",
};

/**
 * Accepte un statut local quelconque (string) pour rester compatible avec
 * `product.status` typé par Prisma. Tout statut autre que "ONLINE"/"ARCHIVED"
 * (donc OFFLINE/SYNCING ou un futur statut) tombe sur DRAFT par défaut quand
 * il reste du stock.
 *
 * @param outOfStockAction action à appliquer côté PFS quand toutes les
 *   variantes sont en rupture. Défaut = "archived" (rétro-compatible).
 */
export function mapLocalToPfsStatus(
  localStatus: string,
  allVariantsOutOfStock: boolean,
  outOfStockAction: PfsOutOfStockProductAction = "archived",
): PfsTargetStatus {
  if (allVariantsOutOfStock) return OUT_OF_STOCK_ACTION_TO_STATUS[outOfStockAction];
  if (localStatus === "ARCHIVED") return "ARCHIVED";
  if (localStatus === "ONLINE") return "READY_FOR_SALE";
  return "DRAFT";
}
