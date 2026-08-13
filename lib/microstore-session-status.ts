/**
 * Microstore — statut des deux sessions à afficher dans l'alerte flottante.
 *
 * Il existe deux « sessions » distinctes côté Microstore, chacune renouvelée
 * manuellement par l'admin :
 *  - `boss`            : session BOSS/QR (~1 an) — permet de modifier la fiche
 *                        produit (SKU, prix, description) et de tirer les
 *                        commandes.
 *  - `pictureStation`  : lien de partage « Station de transfert » (~7 j) —
 *                        permet d'envoyer les photos produit.
 *
 * `null` signifie « jamais connecté sur cette session » → l'UI ne doit pas
 * afficher de bandeau (comportement demandé par la cliente).
 */

import { getCachedSiteConfig } from "@/lib/cached-data";
import { getStoredPictureStation } from "@/lib/microstore-picture-station";

export interface MicrostoreSessionExpirations {
  /** Timestamp ISO d'expiration de la session BOSS/QR, ou null si non connecté. */
  bossExpiresAtIso: string | null;
  /** Timestamp ISO d'expiration du lien Station de transfert, ou null si non connecté. */
  pictureStationExpiresAtIso: string | null;
}

/**
 * Lit les deux dates d'expiration Microstore pour le tenant courant.
 * Utilisé par le layout admin pour brancher `<MicrostoreSessionAlerts>`.
 */
export async function getMicrostoreSessionExpirations(): Promise<MicrostoreSessionExpirations> {
  const [bossRow, pictureStation] = await Promise.all([
    getCachedSiteConfig("microstore_expires_at"),
    getStoredPictureStation(),
  ]);

  const bossSec = bossRow?.value ? Number(bossRow.value) : null;
  const bossExpiresAtIso =
    bossSec && Number.isFinite(bossSec) && bossSec > 0
      ? new Date(bossSec * 1000).toISOString()
      : null;

  const pictureStationExpiresAtIso = pictureStation
    ? pictureStation.expiresAt.toISOString()
    : null;

  return { bossExpiresAtIso, pictureStationExpiresAtIso };
}
