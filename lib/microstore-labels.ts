/**
 * Helpers pour résoudre un ID Microstore en libellé lisible (« Doré » plutôt
 * que « Microstore #42 »). Utilisé par les pages admin d'attributs pour
 * afficher le vrai nom Microstore dans les cartes de mapping, au lieu de l'ID
 * brut totalement incompréhensible.
 *
 * Tolérant aux erreurs : si Microstore n'est pas configuré / hors-ligne, on
 * retourne des maps vides ; les pages affichent alors « Non mappé » ou un
 * fallback humain plutôt que rien (voir `resolveMicrostoreLabelOrOrphan`).
 *
 * Note : catégorie et sous-catégorie tapent sur le MÊME endpoint Microstore
 * `type=category` — pas de hiérarchie native côté MC Gérant. Un même map
 * suffit pour les 2 niveaux BJ.
 */

import { logger } from "@/lib/logger";
import {
  microstoreListAttribute,
  microstoreListColors,
} from "@/lib/microstore-attributes";
import { getMicrostoreSessionKey } from "@/lib/microstore-auth";
import { prisma } from "@/lib/prisma";
import { getCurrentTenantIdSync } from "@/lib/tenant-als";

export interface MicrostoreLabelMaps {
  categories: Map<number, string>;
  colors: Map<number, string>;
  seasons: Map<number, string>;
}

function emptyLabelMaps(): MicrostoreLabelMaps {
  return {
    categories: new Map(),
    colors: new Map(),
    seasons: new Map(),
  };
}

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
 * Vrai si on peut interroger Microstore pour récupérer la bibliothèque
 * (kill switch ON + session présente). Sinon on skip pour éviter des erreurs
 * bruyantes à chaque render de la page attributs.
 */
async function isMicrostoreReadable(): Promise<boolean> {
  const tid = await resolveTenantId();
  const row = await prisma.siteConfig.findFirst({
    where:
      tid === "global"
        ? { key: "microstore_products_management_enabled" }
        : { tenantId: tid, key: "microstore_products_management_enabled" },
    select: { value: true },
  });
  if (row?.value === "false") return false;
  const sessionKey = await getMicrostoreSessionKey();
  return !!sessionKey;
}

/**
 * Charge en parallèle les 3 listes Microstore (catégories, saisons, couleurs)
 * et bâtit des Maps `id → name`. Retourne des maps vides si Microstore est
 * indisponible — les pages affichent alors un fallback plutôt que crasher.
 */
export async function getMicrostoreLabelMaps(): Promise<MicrostoreLabelMaps> {
  try {
    if (!(await isMicrostoreReadable())) return emptyLabelMaps();

    const [categories, seasons, colors] = await Promise.all([
      microstoreListAttribute("category").catch((err) => {
        logger.warn("[microstore labels] category list failed", { error: err });
        return [] as Array<{ id: string; name: string }>;
      }),
      microstoreListAttribute("season").catch((err) => {
        logger.warn("[microstore labels] season list failed", { error: err });
        return [] as Array<{ id: string; name: string }>;
      }),
      microstoreListColors().catch((err) => {
        logger.warn("[microstore labels] color list failed", { error: err });
        return [] as Array<{ id: string; name: string }>;
      }),
    ]);

    const maps = emptyLabelMaps();
    for (const c of categories) {
      const num = Number(c.id);
      if (Number.isFinite(num)) maps.categories.set(num, c.name);
    }
    for (const s of seasons) {
      const num = Number(s.id);
      if (Number.isFinite(num)) maps.seasons.set(num, s.name);
    }
    for (const c of colors) {
      const num = Number(c.id);
      if (Number.isFinite(num)) maps.colors.set(num, c.name);
    }
    return maps;
  } catch (err) {
    logger.warn("[microstore labels] full load failed", { error: err });
    return emptyLabelMaps();
  }
}

/**
 * Résout un ID Microstore en nom lisible. Retourne :
 *   - Le vrai nom si l'ID est trouvé dans la map (« Doré »).
 *   - Un fallback « #ID (orphelin) » si l'ID est mappé BJ mais absent côté
 *     Microstore (attribut supprimé sur MC Gérant, ou Microstore hors-ligne).
 *     La cliente voit ainsi qu'un lien existe mais qu'il n'est plus valide.
 *   - null si aucun mapping BJ n'est posé.
 */
export function resolveMicrostoreLabelOrOrphan(
  map: Map<number, string>,
  id: number | null | undefined,
): string | null {
  if (id == null) return null;
  const found = map.get(id);
  if (found) return found;
  return `#${id} (introuvable sur Microstore)`;
}
