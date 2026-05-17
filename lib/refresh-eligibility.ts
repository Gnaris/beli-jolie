/**
 * Eligibility check shared between client (UI pre-filter) and server
 * (defense-in-depth in marketplace-refresh.ts). Pure function — safe to
 * import from both sides.
 *
 * A product is refreshable only when it is fully live on the shop:
 * - status = ONLINE
 * - not a draft (an OFFLINE incomplete product that was never imported from PFS)
 *
 * Imported products may have `isIncomplete=true` from an old save bug; the
 * `wasImported` flag (presence of pfsProductId) disambiguates so we don't
 * mislabel them as "Brouillon".
 */

export type IneligibilityReason = "archived" | "offline" | "draft" | "syncing";

export interface RefreshEligibilityInput {
  status: "ONLINE" | "OFFLINE" | "ARCHIVED" | "SYNCING";
  isIncomplete: boolean;
  wasImported: boolean;
}

export function getRefreshIneligibilityReason(
  p: RefreshEligibilityInput,
): IneligibilityReason | null {
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
