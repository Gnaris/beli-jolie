/**
 * Lecture BDD des préférences push — SERVER-ONLY.
 *
 * Isolé de `lib/push-preferences.ts` qui est importé par le composant client
 * `PushPreferencesEditor` : Prisma + next/headers ne doivent JAMAIS atterrir
 * dans le bundle browser.
 */
import "server-only";

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import {
  DEFAULT_PUSH_PREFERENCES,
  PUSH_PREFS_SITE_CONFIG_KEY,
  parsePushPreferences,
  type PushPreferences,
} from "@/lib/push-preferences";

/**
 * Résout les préférences pour un tenant donné. En cas d'absence (clé jamais
 * posée) ou de JSON invalide, retombe sur les valeurs par défaut — jamais
 * d'erreur à ce niveau, les notifications continuent même si la config est
 * corrompue.
 *
 * `tenantId` passé explicitement : cette fonction est appelée depuis les
 * hooks push (contexte sans ALS garantie), on NE lit JAMAIS le tenant courant
 * via headers() ici.
 */
export async function getPushPreferences(tenantId: string): Promise<PushPreferences> {
  try {
    const row = await prisma.siteConfig.findFirst({
      where: { tenantId, key: PUSH_PREFS_SITE_CONFIG_KEY },
      select: { value: true },
    });
    if (!row?.value) return DEFAULT_PUSH_PREFERENCES;
    return parsePushPreferences(row.value);
  } catch (err) {
    logger.error("[push-prefs] Lecture BDD échouée, fallback défauts", { error: err, tenantId });
    return DEFAULT_PUSH_PREFERENCES;
  }
}
