/**
 * Mapping du statut local d'un produit vers le statut a envoyer a PFS.
 *
 * Regles (alignees publish/update/refresh) :
 *   - ARCHIVED localement                  → ARCHIVED PFS
 *   - toutes variantes en rupture de stock → ARCHIVED PFS (peu importe le statut local)
 *   - ONLINE localement (avec stock)       → READY_FOR_SALE PFS
 *   - OFFLINE localement (avec stock)      → DRAFT PFS
 *
 * Le passage par ARCHIVED quand tout est en rupture est REVERSIBLE : a la
 * prochaine sync apres rechargement de stock + statut ONLINE, le produit
 * repartira en READY_FOR_SALE automatiquement.
 */

export type PfsTargetStatus = "READY_FOR_SALE" | "DRAFT" | "ARCHIVED";

/**
 * Accepte un statut local quelconque (string) pour rester compatible avec
 * `product.status` typé par Prisma. Tout statut autre que "ONLINE"/"ARCHIVED"
 * (donc OFFLINE/SYNCING ou un futur statut) tombe sur DRAFT par défaut quand
 * il reste du stock.
 */
export function mapLocalToPfsStatus(
  localStatus: string,
  allVariantsOutOfStock: boolean,
): PfsTargetStatus {
  if (localStatus === "ARCHIVED" || allVariantsOutOfStock) return "ARCHIVED";
  if (localStatus === "ONLINE") return "READY_FOR_SALE";
  return "DRAFT";
}
