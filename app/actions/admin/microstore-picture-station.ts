"use server";

/**
 * Server actions — Station de transfert d'images Microstore.
 *
 * L'admin colle ici le lien de partage `https://microstore.app/s/xxxxx`
 * généré depuis son back Microstore. On valide auprès de Microstore, on
 * persiste le key chiffré + l'expiration, puis on l'utilise pour uploader
 * les photos produits (étapes suivantes).
 *
 * Les 2 actions d'envoi photos délèguent au cœur métier
 * `lib/microstore-photos-sync.ts` — extrait le 2026-08-25 pour permettre
 * l'appel depuis des contextes fire-and-forget (post-push produit) où la
 * session HTTP n'est plus disponible et `requireAdmin()` échouerait
 * silencieusement.
 */

import { revalidatePath, revalidateTag } from "next/cache";
import { requireAdmin } from "@/lib/auth-helpers";
import { logger } from "@/lib/logger";
import { setSiteConfig, unsetSiteConfig } from "@/lib/site-config-write";
import {
  extractPictureStationKey,
  validatePictureStationKey,
  getStoredPictureStation,
} from "@/lib/microstore-picture-station";
import {
  sendProductPhotosToMicrostoreCore,
  bulkSendPhotosToMicrostoreCore,
  type SendProductPhotosResult,
  type BulkSendPhotosResult,
} from "@/lib/microstore-photos-sync";

export interface SavePictureStationResult {
  success: boolean;
  error?: string;
  expiresAtIso?: string;
}

/**
 * Enregistre un lien de station de transfert Microstore. Accepte :
 *  - `https://microstore.app/s/xxxxx` (URL courte)
 *  - `https://<tenant>.microstore.app/imageTransferStation#/…?key=XXX`
 *  - le key nu (`NBqdsz`)
 */
export async function saveMicrostorePictureStation(
  input: string,
): Promise<SavePictureStationResult> {
  await requireAdmin();

  const trimmed = (input || "").trim();
  if (!trimmed) {
    return { success: false, error: "Collez le lien de la station de transfert." };
  }

  let key: string | null = null;
  try {
    key = await extractPictureStationKey(trimmed);
  } catch (err) {
    logger.error("[Microstore/PS] extractKey failed", { error: err });
    return { success: false, error: "Impossible de lire le lien." };
  }
  if (!key) {
    return { success: false, error: "Ce lien ne contient pas de clé de station reconnaissable." };
  }

  let validation;
  try {
    validation = await validatePictureStationKey(key);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Validation impossible.";
    return { success: false, error: message };
  }

  await setSiteConfig("microstore_picture_station_key", validation.key);
  await setSiteConfig(
    "microstore_picture_station_expires_at",
    String(validation.expiresAt.getTime()),
  );
  await setSiteConfig("microstore_picture_station_short_url", trimmed);

  revalidateTag("site-config", "default");
  revalidatePath("/admin/parametres");

  return { success: true, expiresAtIso: validation.expiresAt.toISOString() };
}

/** Retire le lien de station de transfert. */
export async function clearMicrostorePictureStation(): Promise<{ success: true }> {
  await requireAdmin();
  await unsetSiteConfig("microstore_picture_station_key");
  await unsetSiteConfig("microstore_picture_station_expires_at");
  await unsetSiteConfig("microstore_picture_station_short_url");
  revalidateTag("site-config", "default");
  revalidatePath("/admin/parametres");
  return { success: true };
}

/**
 * Retourne l'état du lien pour l'UI (utilisé par le composant client au chargement).
 */
export async function getMicrostorePictureStationState(): Promise<{
  configured: boolean;
  expiresAtIso: string | null;
  shortUrl: string | null;
}> {
  await requireAdmin();
  const stored = await getStoredPictureStation();
  if (!stored) return { configured: false, expiresAtIso: null, shortUrl: null };
  return {
    configured: true,
    expiresAtIso: stored.expiresAt.toISOString(),
    shortUrl: stored.shortUrl,
  };
}

/**
 * Envoie les photos d'un produit BJ (recherché par sa référence) vers son
 * homologue Microstore. Cœur métier dans `lib/microstore-photos-sync.ts` —
 * cette action publique fait uniquement le contrôle admin.
 *
 * `force: true` outrepasse le garde-fou « photos inchangées » — utilisé
 * quand la cliente clique explicitement sur « Renvoyer les photos ».
 */
export async function sendProductPhotosToMicrostore(
  reference: string,
): Promise<SendProductPhotosResult> {
  await requireAdmin();
  return sendProductPhotosToMicrostoreCore(reference, { force: true });
}

/**
 * Envoi de photos en **mode masse** vers Microstore. Cœur métier dans
 * `lib/microstore-photos-sync.ts`. Force = true car la cliente qui déclenche
 * un bulk photos explicite veut TOUT renvoyer, pas juste les dirty.
 */
export async function bulkSendPhotosToMicrostore(
  productIds: string[],
): Promise<BulkSendPhotosResult> {
  await requireAdmin();
  return bulkSendPhotosToMicrostoreCore(productIds, { force: true });
}
