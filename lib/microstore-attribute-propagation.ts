/**
 * Microstore — propagation « soft » des attributs bibliothèque BJ vers Microstore.
 *
 * Règles métier figées (cf. décision cliente 2026-08-27) :
 *   1. Renommage d'un attribut BJ (couleur / catégorie / sous-catégorie / saison)
 *      DÉJÀ mappé Microstore → renommer aussi côté Microstore.
 *   2. Création d'une COULEUR BJ → créer + lier automatiquement côté Microstore.
 *      (Catégorie / sous-catégorie / saison restent MANUELS : la cliente choisit
 *      l'ID Microstore depuis les fiches attribut BJ.)
 *   3. Suppression d'un attribut BJ → NE RIEN faire côté Microstore.
 *      L'attribut orphelin reste dans MC Gérant, à supprimer manuellement si voulu.
 *
 * Toutes les fonctions sont « best-effort » : Microstore hors-ligne / kill switch
 * off / session expirée = warning loggué + retour silencieux. Jamais de throw
 * qui bloquerait la sauvegarde locale — le site BJ doit toujours pouvoir tourner
 * même si Microstore est en carafe.
 */

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { getMicrostoreSessionKey } from "@/lib/microstore-auth";
import { getCurrentTenantIdSync } from "@/lib/tenant-als";
import {
  microstoreCreateColor,
  microstoreEditAttribute,
  microstoreEditColor,
} from "@/lib/microstore-attributes";

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
 * Vrai si l'admin peut envoyer des modifs d'attributs vers Microstore :
 *   - Kill switch « Gestion Produits » activé (défaut ON).
 *   - Token QR compagnon présent.
 *
 * NB : on ne vérifie PAS la Picture Station (utile seulement pour les fiches
 * produit avec images). Le CRUD attributs passe sans.
 */
async function isMicrostoreReadyForAttributeSync(): Promise<boolean> {
  const tid = await resolveTenantId();
  const row = await prisma.siteConfig.findFirst({
    where:
      tid === "global"
        ? { key: "microstore_products_management_enabled" }
        : { tenantId: tid, key: "microstore_products_management_enabled" },
    select: { value: true },
  });
  // Défaut ON : ligne absente = activé.
  if (row?.value === "false") return false;

  const sessionKey = await getMicrostoreSessionKey();
  return !!sessionKey;
}

// ─── COULEUR ─────────────────────────────────────────────────────────────

/**
 * Crée la couleur côté Microstore et pose `Color.microstoreColorId` sur la
 * Color BJ. Silencieux si Microstore n'est pas prêt (la Color BJ existe déjà,
 * on ne fait que rater le lien — l'admin pourra mapper manuellement plus tard).
 *
 * @returns L'ID Microstore posé, ou null si skip / erreur.
 */
export async function autoCreateColorOnMicrostore(opts: {
  colorId: string;
  name: string;
}): Promise<number | null> {
  try {
    if (!(await isMicrostoreReadyForAttributeSync())) return null;

    const created = await microstoreCreateColor({ name: opts.name });
    const numericId = Number(created.id);
    if (!Number.isFinite(numericId)) {
      logger.warn("[microstore] auto-create color returned non-numeric id", {
        colorId: opts.colorId,
        microstoreId: created.id,
      });
      return null;
    }
    await prisma.color.update({
      where: { id: opts.colorId },
      data: { microstoreColorId: numericId },
    });
    return numericId;
  } catch (err) {
    logger.warn("[microstore] auto-create color failed", {
      colorId: opts.colorId,
      name: opts.name,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Renomme une couleur côté Microstore si elle est déjà liée (`microstoreColorId`
 * posé). No-op sinon.
 */
export async function propagateColorRenameToMicrostore(opts: {
  colorId: string;
  newName: string;
}): Promise<void> {
  try {
    const row = await prisma.color.findUnique({
      where: { id: opts.colorId },
      select: { microstoreColorId: true },
    });
    if (!row?.microstoreColorId) return;
    if (!(await isMicrostoreReadyForAttributeSync())) return;

    await microstoreEditColor({
      id: String(row.microstoreColorId),
      name: opts.newName,
    });
  } catch (err) {
    logger.warn("[microstore] color rename propagation failed", {
      colorId: opts.colorId,
      newName: opts.newName,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ─── CATÉGORIE ───────────────────────────────────────────────────────────

/**
 * Renomme une catégorie côté Microstore si elle est déjà mappée
 * (`microstoreCategoryId` posé). No-op sinon.
 */
export async function propagateCategoryRenameToMicrostore(opts: {
  categoryId: string;
  newName: string;
}): Promise<void> {
  try {
    const row = await prisma.category.findUnique({
      where: { id: opts.categoryId },
      select: { microstoreCategoryId: true },
    });
    if (!row?.microstoreCategoryId) return;
    if (!(await isMicrostoreReadyForAttributeSync())) return;

    await microstoreEditAttribute({
      type: "category",
      id: String(row.microstoreCategoryId),
      name: opts.newName,
    });
  } catch (err) {
    logger.warn("[microstore] category rename propagation failed", {
      categoryId: opts.categoryId,
      newName: opts.newName,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Renomme une sous-catégorie côté Microstore si elle est déjà mappée sur une
 * catégorie Microstore (`SubCategory.microstoreCategoryId` posé). No-op sinon.
 *
 * Note : Microstore n'a pas de vraie hiérarchie catégorie/sous-catégorie côté
 * mobile — les 2 niveaux BJ tapent sur le MÊME endpoint `set_attr type=category`.
 */
export async function propagateSubCategoryRenameToMicrostore(opts: {
  subCategoryId: string;
  newName: string;
}): Promise<void> {
  try {
    const row = await prisma.subCategory.findUnique({
      where: { id: opts.subCategoryId },
      select: { microstoreCategoryId: true },
    });
    if (!row?.microstoreCategoryId) return;
    if (!(await isMicrostoreReadyForAttributeSync())) return;

    await microstoreEditAttribute({
      type: "category",
      id: String(row.microstoreCategoryId),
      name: opts.newName,
    });
  } catch (err) {
    logger.warn("[microstore] sub-category rename propagation failed", {
      subCategoryId: opts.subCategoryId,
      newName: opts.newName,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ─── SAISON ──────────────────────────────────────────────────────────────

/**
 * Renomme une saison côté Microstore si elle est déjà mappée
 * (`microstoreSeasonId` posé). No-op sinon.
 */
export async function propagateSeasonRenameToMicrostore(opts: {
  seasonId: string;
  newName: string;
}): Promise<void> {
  try {
    const row = await prisma.season.findUnique({
      where: { id: opts.seasonId },
      select: { microstoreSeasonId: true },
    });
    if (!row?.microstoreSeasonId) return;
    if (!(await isMicrostoreReadyForAttributeSync())) return;

    await microstoreEditAttribute({
      type: "season",
      id: String(row.microstoreSeasonId),
      name: opts.newName,
    });
  } catch (err) {
    logger.warn("[microstore] season rename propagation failed", {
      seasonId: opts.seasonId,
      newName: opts.newName,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
