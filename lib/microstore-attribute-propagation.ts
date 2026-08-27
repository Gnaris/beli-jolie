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
  microstoreListColors,
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
 * Résultat de la tentative d'auto-création côté Microstore. La forme est
 * exploitée côté UI pour afficher un toast informatif (créée / reliée à
 * l'existante / silencieusement skippée / erreur).
 */
export type MicrostoreColorLinkResult =
  /** Nouvelle couleur créée sur Microstore + lien BJ posé. */
  | { status: "created"; microstoreColorId: number }
  /**
   * La couleur existait déjà côté Microstore (match par nom insensible à la
   * casse) : on s'est contenté de poser le lien vers l'existante.
   */
  | { status: "linked_existing"; microstoreColorId: number; existingName: string }
  /** Microstore hors-ligne, kill switch OFF, ou session expirée. */
  | { status: "skipped_not_configured" }
  /** Autre erreur : logs côté serveur, rien de bloquant côté BJ. */
  | { status: "error"; error: string };

/**
 * Compare deux noms de couleur pour la déduplication Microstore : trim,
 * casse-insensible, espaces internes normalisés. Volontairement souple pour
 * matcher « Bleu marine » ↔ « bleu  marine ».
 */
function normalizeColorName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Crée la couleur côté Microstore et pose `Color.microstoreColorId` sur la
 * Color BJ. Si la couleur existe déjà dans la bibliothèque Microstore (match
 * par nom), lie simplement à l'existante au lieu d'échouer.
 *
 * Silencieux si Microstore n'est pas prêt — l'admin pourra mapper manuellement
 * plus tard depuis la fiche couleur. Ne throw jamais : la sauvegarde locale
 * de la Color BJ ne doit JAMAIS être bloquée par un souci Microstore.
 */
export async function autoCreateColorOnMicrostore(opts: {
  colorId: string;
  name: string;
}): Promise<MicrostoreColorLinkResult> {
  try {
    if (!(await isMicrostoreReadyForAttributeSync())) {
      return { status: "skipped_not_configured" };
    }

    // 1. Cherche d'abord un match par nom dans la bibliothèque existante —
    //    évite « Microstore /user/set_color a refusé : color already exists »
    //    en la reliant directement.
    const existingList = await microstoreListColors();
    const target = normalizeColorName(opts.name);
    const match = existingList.find(
      (c) => normalizeColorName(c.name) === target,
    );
    if (match) {
      const numericId = Number(match.id);
      if (Number.isFinite(numericId)) {
        await prisma.color.update({
          where: { id: opts.colorId },
          data: { microstoreColorId: numericId },
        });
        return {
          status: "linked_existing",
          microstoreColorId: numericId,
          existingName: match.name,
        };
      }
    }

    // 2. Pas d'existante → création normale.
    const created = await microstoreCreateColor({ name: opts.name });
    const numericId = Number(created.id);
    if (!Number.isFinite(numericId)) {
      logger.warn("[microstore] auto-create color returned non-numeric id", {
        colorId: opts.colorId,
        microstoreId: created.id,
      });
      return { status: "error", error: "Réponse Microstore invalide." };
    }
    await prisma.color.update({
      where: { id: opts.colorId },
      data: { microstoreColorId: numericId },
    });
    return { status: "created", microstoreColorId: numericId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn("[microstore] auto-create color failed", {
      colorId: opts.colorId,
      name: opts.name,
      error: message,
    });
    return { status: "error", error: message };
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
