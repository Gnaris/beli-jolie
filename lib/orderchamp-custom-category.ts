/**
 * Orderchamp Custom Category — auto-création + publication d'une catégorie
 * perso à partir d'une catégorie BJ (nom + slug).
 *
 * Séquence :
 *   1. Liste toutes les customCategories OC (query légère). Sert à 2 choses :
 *      - valider que l'ID stocké en BDD existe toujours (si la cliente a
 *        supprimé la cat manuellement dans le back-office OC, on tombait sur
 *        « CustomFieldsValue not found » en publish).
 *      - éviter les doublons quand plusieurs workers publient en parallèle
 *        pour la même catégorie BJ (race condition sans lock BDD).
 *   2. Si un match par slug existe côté OC → on relie (auto-publie si besoin).
 *   3. Sinon → `customCategoryCreate` puis `customCategoryUpdate({isPublished:true})`
 *      (indispensable, sinon l'attribution silencieuse au productUpdate est ignorée).
 *   4. Stocke l'ID dans `Category.orderchampCustomCategoryId`.
 */

import {
  orderchampGraphQL,
  extractUserErrors,
  formatUserErrors,
} from "@/lib/orderchamp-client";
import {
  CUSTOM_CATEGORIES_QUERY,
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

  const slug = slugifyForOrderchamp(cat.name);

  try {
    // 1) Liste des customCategories OC — source de vérité. Sert à valider
    // l'ID stocké ET à retrouver une customCategory existante par slug.
    const existing = await orderchampGraphQL<{
      customCategories: {
        edges: Array<{ node: { id: string; value: string; label: string; isPublished: boolean } }>;
      };
    }>(CUSTOM_CATEGORIES_QUERY, { first: 250 }, "customCategoriesLookup");

    // Cas A : ID stocké encore valide → on le retourne.
    if (cat.orderchampCustomCategoryId) {
      const stored = existing.customCategories.edges.find(
        (e) => e.node.id === cat.orderchampCustomCategoryId,
      );
      if (stored) {
        // Vérifie qu'elle est bien publiée (peut avoir été dépublée manuellement).
        if (!stored.node.isPublished) {
          await orderchampGraphQL<{
            customCategoryUpdate: { userErrors: Array<Record<string, unknown>> };
          }>(
            CUSTOM_CATEGORY_UPDATE_MUTATION,
            { input: { id: stored.node.id, isPublished: true } },
            "customCategoryUpdate",
          );
        }
        return { success: true, orderchampCustomCategoryId: stored.node.id };
      }
      // ID stocké mais introuvable côté OC → cliente a supprimé la cat.
      // On oublie le lien BDD et on tombe dans le lookup par slug ci-dessous.
      logger.warn("[Orderchamp CustomCategory] ID stocké obsolète — reset", {
        bjCategoryId,
        staleId: cat.orderchampCustomCategoryId,
      });
      await prisma.category.update({
        where: { id: bjCategoryId },
        data: { orderchampCustomCategoryId: null },
      });
    }

    // Cas B : match par slug (existante mais pas encore reliée en BDD, ou
    // rescapée du reset ci-dessus).
    const match = existing.customCategories.edges.find((e) => e.node.value === slug);
    if (match) {
      if (!match.node.isPublished) {
        await orderchampGraphQL<{
          customCategoryUpdate: { userErrors: Array<Record<string, unknown>> };
        }>(
          CUSTOM_CATEGORY_UPDATE_MUTATION,
          { input: { id: match.node.id, isPublished: true } },
          "customCategoryUpdate",
        );
      }
      await prisma.category.update({
        where: { id: bjCategoryId },
        data: { orderchampCustomCategoryId: match.node.id },
      });
      logger.info("[Orderchamp CustomCategory] existante réutilisée", {
        bjCategoryId,
        customCategoryId: match.node.id,
        slug,
      });
      return { success: true, orderchampCustomCategoryId: match.node.id };
    }

    // Cas C : rien côté OC → création.
    const createRes = await orderchampGraphQL<{
      customCategoryCreate: {
        customCategory: { id: string; label: string; isPublished: boolean } | null;
        userErrors: Array<Record<string, unknown>>;
      };
    }>(
      CUSTOM_CATEGORY_CREATE_MUTATION,
      {
        input: {
          value: slug,
          label: cat.name,
        },
      },
      "customCategoryCreate",
      { disableRetry: true }, // non-idempotent, retry sur 5xx = doublon
    );
    const errs = extractUserErrors(createRes.customCategoryCreate);
    if (errs.length > 0 || !createRes.customCategoryCreate.customCategory) {
      return { success: false, error: formatUserErrors(errs) ?? "Échec création custom category" };
    }
    const created = createRes.customCategoryCreate.customCategory;

    // Publication (obligatoire pour être attribuable à un produit).
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
