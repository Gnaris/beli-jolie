/**
 * Mapping du statut local d'un produit vers le statut à envoyer à PFS.
 *
 * Règles alignées entre publish/update/refresh/verify — **le statut local fait
 * foi** (règle métier posée par la cliente 2026-08-07). Un produit en rupture
 * totale n'est plus auto-archivé/deleté/drafté : l'admin garde le contrôle.
 *
 *   - ARCHIVED localement → ARCHIVED PFS
 *   - ONLINE localement   → READY_FOR_SALE PFS
 *   - OFFLINE localement  → DRAFT PFS
 *   - autre (SYNCING…)    → DRAFT PFS
 */

export type PfsTargetStatus = "READY_FOR_SALE" | "DRAFT" | "ARCHIVED" | "DELETED";

/**
 * Accepte un statut local quelconque (string) pour rester compatible avec
 * `product.status` typé par Prisma. Tout statut autre que "ONLINE"/"ARCHIVED"
 * (donc OFFLINE/SYNCING ou un futur statut) tombe sur DRAFT par défaut.
 */
export function mapLocalToPfsStatus(localStatus: string): PfsTargetStatus {
  if (localStatus === "ARCHIVED") return "ARCHIVED";
  if (localStatus === "ONLINE") return "READY_FOR_SALE";
  return "DRAFT";
}
