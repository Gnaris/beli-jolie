/**
 * Constantes pures partagées client + serveur pour les avis clients.
 * Ce fichier ne doit JAMAIS importer Prisma ou `next/headers` — sinon les
 * composants client qui l'importent (ex. `MyReviewCard`) cassent au build.
 */

/** Nombre minimum de commandes SHIPPED pour poster un avis. */
export const MIN_ORDERS_TO_REVIEW = 1;

/** Longueur max du paragraphe. Au-delà, la carte devient illisible sur la home. */
export const REVIEW_TEXT_MAX = 1200;
export const REVIEW_TEXT_MIN = 20;

export const REVIEW_RATING_MIN = 1;
export const REVIEW_RATING_MAX = 5;
