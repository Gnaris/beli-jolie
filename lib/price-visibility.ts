import type { Session } from "next-auth";
import type { Role, UserStatus } from "@prisma/client";

/**
 * Détermine si une session peut voir les prix sur le site public.
 *
 * Règle métier : seuls les comptes ADMIN ou les CLIENT au statut APPROVED
 * voient les prix. Les visiteurs anonymes et les comptes PENDING/REJECTED
 * voient les fiches produit mais ne voient ni les prix, ni les boutons d'achat.
 */
export function canSeePrices(
  session: Session | null | undefined,
): boolean {
  return canSeePricesFromUser(session?.user);
}

export function canSeePricesFromUser(
  user: { role?: Role; status?: UserStatus } | null | undefined,
): boolean {
  if (!user) return false;
  if (user.role === "ADMIN") return true;
  return user.status === "APPROVED";
}
