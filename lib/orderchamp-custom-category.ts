/**
 * Orderchamp Custom Category — auto-création + publication d'une catégorie
 * perso à partir d'une catégorie BJ (nom + slug).
 *
 * Séquence obligatoire (validée le 2026-08-19) :
 *   1. `customCategoryCreate({ value, label })` → renvoie l'ID GraphQL
 *      (isPublished: false par défaut)
 *   2. `customCategoryUpdate({ id, isPublished: true })` → indispensable, sinon
 *      l'attribution silencieuse au productUpdate est ignorée
 *   3. Stocke l'ID dans `Category.orderchampCustomCategoryId` (colonne Phase 1)
 *
 * Idempotent : si `Category.orderchampCustomCategoryId` est déjà renseigné et existe
 * toujours côté OC, on ne recrée pas.
 */

import {
  orderchampGraphQL,
  extractUserErrors,
  formatUserErrors,
} from "@/lib/orderchamp-client";
import {
  CUSTOM_CATEGORY_CREATE_MUTATION,
  CUSTOM_CATEGORY_UPDATE_MUTATION,
} from "@/lib/orderchamp-queries";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

export interface EnsureCustomCategoryResult {
  success: boolean;
  orderchampCustomCategoryId?: string;
  error?: string;
}

/**
 * Slug côté Orderchamp — utilisé comme `value` (unique). On sanitize le nom BJ
 * (accents retirés, lowercase, non-alphanum → tirets).
 */
function slugifyForOrderchamp(name: string): string {
  return name
    .trim()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    || "categorie";
}

/**
 * Garantit qu'une customCategory OC existe et est publiée pour la catégorie
 * BJ donnée. Retourne son ID GraphQL — à passer dans `productCreate/Update.customCategory`.
 */
export async function ensureOrderchampCustomCategory(
  bjCategoryId: string,
): Promise<EnsureCustomCategoryResult> {
  const cat = await prisma.category.findUnique({
    where: { id: bjCategoryId },
    select: { id: true, name: true, orderchampCustomCategoryId: true },
  });
  if (!cat) return { success: false, error: "Catégorie BJ introuvable." };

  // Idempotent : si déjà mappée, on renvoie tel quel.
  if (cat.orderchampCustomCategoryId) {
    return { success: true, orderchampCustomCategoryId: cat.orderchampCustomCategoryId };
  }

  try {
    // 1) Création côté OC
    const createRes = await orderchampGraphQL<{
      customCategoryCreate: {
        customCategory: { id: string; label: string; isPublished: boolean } | null;
        userErrors: Array<Record<string, unknown>>;
      };
    }>(
      CUSTOM_CATEGORY_CREATE_MUTATION,
      {
        input: {
          value: slugifyForOrderchamp(cat.name),
          label: cat.name,
        },
      },
      "customCategoryCreate",
    );
    const errs = extractUserErrors(createRes.customCategoryCreate);
    if (errs.length > 0 || !createRes.customCategoryCreate.customCategory) {
      return { success: false, error: formatUserErrors(errs) ?? "Échec création custom category" };
    }
    const created = createRes.customCategoryCreate.customCategory;

    // 2) Publication (obligatoire pour être attribuable à un produit)
    if (!created.isPublished) {
      const pubRes = await orderchampGraphQL<{
        customCategoryUpdate: {
          userErrors: Array<Record<string, unknown>>;
        };
      }>(
        CUSTOM_CATEGORY_UPDATE_MUTATION,
        { input: { id: created.id, isPublished: true } },
        "customCategoryUpdate",
      );
      const pubErrs = extractUserErrors(pubRes.customCategoryUpdate);
      if (pubErrs.length > 0) {
        logger.warn("[Orderchamp CustomCategory] publication a échoué", {
          bjCategoryId,
          customCategoryId: created.id,
          errors: pubErrs,
        });
      }
    }

    // 3) Persist l'ID côté BJ
    await prisma.category.update({
      where: { id: bjCategoryId },
      data: { orderchampCustomCategoryId: created.id },
    });

    logger.info("[Orderchamp CustomCategory] créée + publiée + mappée", {
      bjCategoryId,
      customCategoryId: created.id,
      label: cat.name,
    });

    return { success: true, orderchampCustomCategoryId: created.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur inconnue";
    logger.error("[Orderchamp CustomCategory] échec", { bjCategoryId, error: message });
    return { success: false, error: message };
  }
}
