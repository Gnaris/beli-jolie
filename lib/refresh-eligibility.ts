/**
 * Eligibility check shared between client (UI pre-filter) and server
 * (defense-in-depth in marketplace-refresh.ts). Pure function — safe to
 * import from both sides.
 *
 * A product is refreshable only when it is fully live on the shop:
 * - status = ONLINE
 * - not a draft (an OFFLINE incomplete product that was never imported from PFS)
 * - not manually locked (the lock flag is an admin-only kill switch independent
 *   of status, used to freeze a fragile product from any refresh)
 *
 * Imported products may have `isIncomplete=true` from an old save bug; the
 * `wasImported` flag (presence of pfsProductId) disambiguates so we don't
 * mislabel them as "Brouillon".
 */

export type IneligibilityReason =
  | "locked"
  | "archived"
  | "offline"
  | "draft"
  | "syncing";

export interface RefreshEligibilityInput {
  status: "ONLINE" | "OFFLINE" | "ARCHIVED" | "SYNCING";
  isIncomplete: boolean;
  wasImported: boolean;
  locked?: boolean;
}

export function getRefreshIneligibilityReason(
  p: RefreshEligibilityInput,
): IneligibilityReason | null {
  // Le verrou manuel a priorité sur le statut : un produit verrouillé n'est
  // jamais rafraîchissable, même s'il est en ligne et complet.
  if (p.locked) return "locked";
  if (p.status === "ARCHIVED") return "archived";
  if (p.status === "SYNCING") return "syncing";
  if (p.status === "OFFLINE") {
    if (p.isIncomplete && !p.wasImported) return "draft";
    return "offline";
  }
  return null;
}

export function labelForIneligibility(reason: IneligibilityReason): string {
  switch (reason) {
    case "locked":
      return "Verrouillé";
    case "archived":
      return "Archivé";
    case "offline":
      return "Hors ligne";
    case "draft":
      return "Brouillon";
    case "syncing":
      return "Importation en cours";
  }
}
