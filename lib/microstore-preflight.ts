/**
 * Microstore — pré-check avant tout envoi produit (push, disable, delete, photos).
 *
 * La cliente veut refuser l'envoi tant qu'une des 3 conditions n'est pas OK :
 *   1. Gestion Produits (kill switch `microstore_products_management_enabled`).
 *   2. Token QR compagnon (`microstore_session_key`) présent + non expiré
 *      (`microstore_expires_at`, unix seconds).
 *   3. Station de transfert d'images (`microstore_picture_station_key` +
 *      `microstore_picture_station_expires_at`, unix ms).
 *
 * Le check est centralisé pour que push/update/disable/delete/photos partagent
 * exactement les mêmes règles — sinon on a l'un ou l'autre qui passe alors que
 * l'admin croit avoir tout coupé.
 */
import { prisma } from "@/lib/prisma";
import { getCurrentTenantIdSync } from "@/lib/tenant-als";
import { getMicrostoreSessionKey } from "@/lib/microstore-auth";
import { getStoredPictureStation } from "@/lib/microstore-picture-station";

export type MicrostorePreflightReason =
  | "MANAGEMENT_DISABLED"
  | "SESSION_MISSING"
  | "SESSION_EXPIRED"
  | "PICTURE_STATION_MISSING"
  | "PICTURE_STATION_EXPIRED";

export type MicrostorePreflightResult =
  | { ok: true }
  | { ok: false; reason: MicrostorePreflightReason; error: string };

async function resolveTenantId(): Promise<string> {
  let tid = getCurrentTenantIdSync();
  if (!tid) {
    try {
      const { headers } = await import("next/headers");
      const h = await headers();
      tid = h.get("x-tenant-id");
    } catch {
      // hors requête HTTP (worker, script CLI)
    }
  }
  return tid ?? "global";
}

/**
 * Retourne `{ ok: true }` si tout est OK pour envoyer sur Microstore.
 * Sinon `{ ok: false, reason, error }` avec un message actionnable pointant
 * l'écran de correction dans Paramètres.
 */
export async function assertMicrostorePushAllowed(): Promise<MicrostorePreflightResult> {
  const tid = await resolveTenantId();

  const rows = await prisma.siteConfig.findMany({
    where:
      tid === "global"
        ? {
            key: {
              in: ["microstore_products_management_enabled", "microstore_expires_at"],
            },
          }
        : {
            tenantId: tid,
            key: {
              in: ["microstore_products_management_enabled", "microstore_expires_at"],
            },
          },
    select: { key: true, value: true },
  });
  const byKey = new Map(rows.map((r) => [r.key, r.value]));

  // 1. Kill switch (défaut ON — absent => activé).
  if (byKey.get("microstore_products_management_enabled") === "false") {
    return {
      ok: false,
      reason: "MANAGEMENT_DISABLED",
      error:
        "La gestion des produits Microstore est désactivée. Réactivez-la dans Paramètres → Marketplaces → Microstore avant d'envoyer.",
    };
  }

  // 2. Token QR compagnon (session BOSS, valide ~1 an).
  const sessionKey = await getMicrostoreSessionKey();
  if (!sessionKey) {
    return {
      ok: false,
      reason: "SESSION_MISSING",
      error:
        "Microstore n'est pas connecté. Scannez le QR code dans Paramètres → Marketplaces → Microstore.",
    };
  }
  const expSecRaw = byKey.get("microstore_expires_at");
  if (expSecRaw) {
    const expSec = Number(expSecRaw);
    if (Number.isFinite(expSec) && expSec > 0 && expSec * 1000 < Date.now()) {
      return {
        ok: false,
        reason: "SESSION_EXPIRED",
        error:
          "La session Microstore est expirée. Reconnectez-vous via QR code dans Paramètres → Marketplaces → Microstore.",
      };
    }
  }

  // 3. Station de transfert d'images (valide ~7 j).
  const station = await getStoredPictureStation();
  if (!station) {
    return {
      ok: false,
      reason: "PICTURE_STATION_MISSING",
      error:
        "La Station de transfert d'images Microstore n'est pas configurée. Collez le lien de partage dans Paramètres → Marketplaces → Microstore → Station de transfert.",
    };
  }
  if (station.expiresAt.getTime() < Date.now()) {
    return {
      ok: false,
      reason: "PICTURE_STATION_EXPIRED",
      error:
        "La Station de transfert d'images Microstore est expirée. Regénérez le lien de partage dans votre back Microstore puis recollez-le dans Paramètres → Marketplaces → Microstore.",
    };
  }

  return { ok: true };
}
