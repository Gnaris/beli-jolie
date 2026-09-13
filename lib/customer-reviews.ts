import { prisma } from "@/lib/prisma";
import {
  MIN_ORDERS_TO_REVIEW,
  REVIEW_RATING_MAX,
  REVIEW_RATING_MIN,
  REVIEW_TEXT_MAX,
  REVIEW_TEXT_MIN,
} from "@/lib/customer-reviews-constants";

export {
  MIN_ORDERS_TO_REVIEW,
  REVIEW_RATING_MAX,
  REVIEW_RATING_MIN,
  REVIEW_TEXT_MAX,
  REVIEW_TEXT_MIN,
};

/**
 * Contrat de rendu partagé avec le composant `ReviewsSection`. Correspond à
 * une carte affichée sur la homepage (nom public, texte, note). L'entreprise
 * du client n'est pas exposée : demande cliente 2026 pour rester sobre et
 * protéger la vie privée B2B (les revendeurs ne veulent pas afficher leur
 * raison sociale publiquement).
 */
export interface HomeReview {
  id: string;
  name: string;
  text: string;
  rating: number;
  /** Date de publication (moderatedAt fallback createdAt), format ISO. */
  publishedAt: string;
}

/**
 * Avis clients — helpers partagés serveur.
 *
 * Règles métier :
 *  - 1 seul avis par client (contrainte `userId @unique` sur CustomerReview).
 *  - Un client peut poster son 1ᵉʳ avis à condition d'avoir au moins 1 Order
 *    avec status SHIPPED (dans son tenant courant — le scope Prisma s'en
 *    charge automatiquement).
 *  - Tant que son avis est PENDING, il peut le modifier / le supprimer.
 *  - Une fois APPROVED ou REJECTED, il est figé (à contacter le SAV pour
 *    changer). Cette règle simplifie la modération : pas d'aller-retour infini.
 *
 * Voir aussi l'enum ReviewStatus dans schema.prisma.
 */

/**
 * L'utilisateur a-t-il assez de commandes pour poster un avis ?
 * Compte les Orders SHIPPED du user courant (scoping tenant via extension Prisma).
 */
export async function userHasEligibleOrder(userId: string): Promise<boolean> {
  const count = await prisma.order.count({
    where: { userId, status: "SHIPPED" },
  });
  return count >= MIN_ORDERS_TO_REVIEW;
}

/** Récupère l'avis (unique) du user courant, ou null. */
export async function findMyReview(userId: string) {
  return prisma.customerReview.findUnique({ where: { userId } });
}

/** Valide et normalise l'entrée client (rating + text). Retourne l'erreur si KO. */
export function normalizeReviewInput(input: { rating: unknown; text: unknown }):
  | { ok: true; rating: number; text: string }
  | { ok: false; error: string } {
  const ratingNum = Number(input.rating);
  if (!Number.isFinite(ratingNum)) {
    return { ok: false, error: "La note est invalide." };
  }
  const rating = Math.round(ratingNum);
  if (rating < REVIEW_RATING_MIN || rating > REVIEW_RATING_MAX) {
    return {
      ok: false,
      error: `La note doit être comprise entre ${REVIEW_RATING_MIN} et ${REVIEW_RATING_MAX}.`,
    };
  }

  const rawText = typeof input.text === "string" ? input.text : "";
  const text = rawText.trim().replace(/\s+/g, " ");
  if (text.length < REVIEW_TEXT_MIN) {
    return { ok: false, error: `Le témoignage doit contenir au moins ${REVIEW_TEXT_MIN} caractères.` };
  }
  if (text.length > REVIEW_TEXT_MAX) {
    return { ok: false, error: `Le témoignage ne doit pas dépasser ${REVIEW_TEXT_MAX} caractères.` };
  }

  return { ok: true, rating, text };
}

/**
 * Construit le libellé public affiché sous chaque témoignage sur la homepage.
 * Nom public = prénom + initiale du nom (ex. « Sophie L. ») — pas d'entreprise.
 * Fallback « Anonyme » quand les 2 champs sont vides : c'est le cas des comptes
 * importés via marketplace PFS où `firstName` reste `""` (schéma DB non-nullable
 * mais chaîne vide autorisée).
 */
export function formatReviewerName(user: { firstName: string | null; lastName: string | null }): string {
  const first = user.firstName?.trim() ?? "";
  const lastInitial = user.lastName?.trim().charAt(0) ?? "";
  if (first && lastInitial) return `${first} ${lastInitial}.`;
  if (first) return first;
  if (lastInitial) return `${lastInitial}.`;
  return "Anonyme";
}

/**
 * Récupère les avis APPROVED à afficher sur la homepage.
 * Trie du plus récent au plus ancien, `limit` par défaut à 6 (on n'affiche
 * jamais plus que ça sur la home pour ne pas alourdir le rendu).
 * Le format retourné = `HomeReview[]` — même contrat que l'ancienne section,
 * ce qui permet de brancher `ReviewsSection` sans modification.
 */
export async function getPublishedCustomerReviews(limit: number = 6): Promise<HomeReview[]> {
  const rows = await prisma.customerReview.findMany({
    where: { status: "APPROVED" },
    orderBy: [{ moderatedAt: "desc" }, { createdAt: "desc" }],
    take: limit,
    include: {
      user: {
        select: { firstName: true, lastName: true },
      },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    name: formatReviewerName(r.user),
    text: r.text,
    rating: r.rating,
    // Date de publication effective = date de modération admin (moment où
    // l'avis est devenu visible). Fallback createdAt pour rétro-compat.
    publishedAt: (r.moderatedAt ?? r.createdAt).toISOString(),
  }));
}
