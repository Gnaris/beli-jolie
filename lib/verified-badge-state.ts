import type { Session } from "next-auth";

/**
 * État du badge de statut compte affiché dans le header public.
 *
 * Règle métier : seuls les comptes CLIENT ont un badge (l'ADMIN gère la
 * boutique, pas de statut de validation à afficher).
 *  - APPROVED    → « Vérifié »
 *  - PENDING     → « Non vérifié » (dossier en cours d'examen)
 *  - REJECTED    → « Révoqué » (inscription refusée par l'admin ; connexion
 *                   toujours autorisée mais pas d'accès aux prix / commande)
 *  - DEACTIVATED → « Désactivé » (compte précédemment APPROVED mis en pause
 *                   automatiquement pour inactivité, ou manuellement par
 *                   l'admin. Même effet client : plus d'accès aux prix.)
 */
export type VerifiedBadgeVariant =
  | "verified"
  | "pending"
  | "revoked"
  | "deactivated";
export type VerifiedBadgeState =
  | { show: false }
  | { show: true; variant: VerifiedBadgeVariant };

export function getVerifiedBadgeState(
  session: Session | null | undefined,
): VerifiedBadgeState {
  const user = session?.user;
  if (!user || user.role !== "CLIENT") return { show: false };
  if (user.status === "APPROVED") return { show: true, variant: "verified" };
  if (user.status === "REJECTED") return { show: true, variant: "revoked" };
  if (user.status === "DEACTIVATED") return { show: true, variant: "deactivated" };
  return { show: true, variant: "pending" };
}
