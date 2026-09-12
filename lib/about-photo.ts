/**
 * Helpers purs pour les 6 photos de la page publique « À propos ».
 *
 * Vit dans `lib/` (pas dans un fichier `"use server"`) car la conversion
 * slot → clé SiteConfig est une fonction synchrone utilisée à la fois côté
 * server actions et côté tests.
 */

export type AboutPhotoSlot = 1 | 2 | 3 | 4 | 5 | 6;
export type AboutPhotoKey = `about_photo_${AboutPhotoSlot}_url`;

/**
 * Numéro d'emplacement photo (1 à 6) → clé SiteConfig correspondante.
 * Lève une erreur si le slot est hors bornes ou non-entier.
 */
export function aboutPhotoKey(slot: number): AboutPhotoKey {
  if (!Number.isInteger(slot) || slot < 1 || slot > 6) {
    throw new Error(`Emplacement invalide : ${slot}`);
  }
  return `about_photo_${slot as AboutPhotoSlot}_url`;
}
