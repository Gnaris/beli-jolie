/**
 * Orderchamp Custom Category — auto-création + publication d'une catégorie
 * perso à partir d'une catégorie / sous-catégorie BJ (nom + slug).
 *
 * Chez OC, les sous-catégories sont modélisées comme des customCategories
 * enfants (`parentId` pointant vers la customCategory parente).
 *
 * Séquence :
 *   1. Liste toutes les customCategories OC (query légère, `first: 100`).
 *      Sert à 2 choses :
 *      - valider que l'ID stocké en BDD existe toujours (si la cliente a
 *        supprimé la cat manuellement dans le back-office OC, on tombait sur
 *        « CustomFieldsValue not found » en publish).
 *      - éviter les doublons quand plusieurs workers publient en parallèle
 *        pour la même catégorie BJ (race condition sans lock BDD).
 *   2. Si un match par slug (+ parentId si sous-cat) existe côté OC →
 *      on relie (auto-publie si besoin).
 *   3. Sinon → `customCategoryCreate` puis `customCategoryUpdate({isPublished:true})`
 *      (indispensable, sinon l'attribution silencieuse au productUpdate est ignorée).
 *   4. Stocke l'ID dans `Category.orderchampCustomCategoryId` ou
 *      `SubCategory.orderchampCustomCategoryId`.
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

type OcCustomCategoryNode = {
  id: string;
  value: string;
  label: string;
  isPublished: boolean;
  parent: { id: string } | null;
};

/**
 * Slug côté Orderchamp — utilisé comme `label` (technique). On sanitize le
 * nom BJ (accents retirés, lowercase, non-alphanum → tirets).
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

async function listAllCustomCategories(): Promise<OcCustomCategoryNode[]> {
  const existing = await orderchampGraphQL<{
    customCategories: { edges: Array<{ node: OcCustomCategoryNode }> };
  }>(CUSTOM_CATEGORIES_QUERY, { first: 100 }, "customCategoriesLookup");
  return existing.customCategories.edges.map((e) => e.node);
}

async function publishIfNeeded(id: string, isPublished: boolean): Promise<void> {
  if (isPublished) return;
  await orderchampGraphQL<{
    customCategoryUpdate: { userErrors: Array<Record<string, unknown>> };
  }>(
    CUSTOM_CATEGORY_UPDATE_MUTATION,
    { input: { id, isPublished: true } },
    "customCategoryUpdate",
  );
}

/**
 * Crée puis publie une customCategory OC. Retourne son ID ou une erreur
 * structurée (pas de throw pour laisser le caller décider du fallback).
 */
async function createCustomCategoryOnOc(params: {
  name: string;
  slug: string;
  parentId?: string;
}): Promise<{ id: string; error?: undefined } | { id?: undefined; error: string }> {
  const input: Record<string, unknown> = {
    value: params.name, // nom affichable (obligatoire)
    label: params.slug, // slug technique (optionnel, on force pour lookup stable)
  };
  if (params.parentId) input.parentId = params.parentId;

  const createRes = await orderchampGraphQL<{
    customCategoryCreate: {
      customCategory: { id: string; label: string; isPublished: boolean } | null;
      userErrors: Array<Record<string, unknown>>;
    };
  }>(
    CUSTOM_CATEGORY_CREATE_MUTATION,
    { input },
    "customCategoryCreate",
    { disableRetry: true }, // non-idempotent, retry sur 5xx = doublon
  );
  const errs = extractUserErrors(createRes.customCategoryCreate);
  if (errs.length > 0 || !createRes.customCategoryCreate.customCategory) {
    return { error: formatUserErrors(errs) ?? "Échec création custom category" };
  }
  const created = createRes.customCategoryCreate.customCategory;
  await publishIfNeeded(created.id, created.isPublished);
  return { id: created.id };
}

/**
 * Garantit qu'une customCategory OC existe et est publiée pour la catégorie
 * BJ donnée (racine, pas de parent). Retourne son ID GraphQL — à passer dans
 * `productCreate/Update.customCategory`.
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
    const all = await listAllCustomCategories();

    // Cas A : ID stocké encore valide → on le retourne.
    if (cat.orderchampCustomCategoryId) {
      const stored = all.find((n) => n.id === cat.orderchampCustomCategoryId);
      if (stored) {
        await publishIfNeeded(stored.id, stored.isPublished);
        return { success: true, orderchampCustomCategoryId: stored.id };
      }
      logger.warn("[Orderchamp CustomCategory] ID stocké obsolète — reset", {
        bjCategoryId,
        staleId: cat.orderchampCustomCategoryId,
      });
      await prisma.category.update({
        where: { id: bjCategoryId },
        data: { orderchampCustomCategoryId: null },
      });
    }

    // Cas B : match par slug (uniquement racines : parent === null). Fallback
    // sur `value === slug` pour rattraper les cat créées avec l'ancienne
    // inversion value/label (bug corrigé le 2026-08-20).
    const roots = all.filter((n) => n.parent === null);
    const match =
      roots.find((n) => n.label === slug) ??
      roots.find((n) => n.value === slug);
    if (match) {
      await publishIfNeeded(match.id, match.isPublished);
      await prisma.category.update({
        where: { id: bjCategoryId },
        data: { orderchampCustomCategoryId: match.id },
      });
      logger.info("[Orderchamp CustomCategory] existante réutilisée", {
        bjCategoryId,
        customCategoryId: match.id,
        slug,
      });
      return { success: true, orderchampCustomCategoryId: match.id };
    }

    // Cas C : création (root, pas de parent).
    const res = await createCustomCategoryOnOc({ name: cat.name, slug });
    if (res.error) return { success: false, error: res.error };

    await prisma.category.update({
      where: { id: bjCategoryId },
      data: { orderchampCustomCategoryId: res.id },
    });
    logger.info("[Orderchamp CustomCategory] créée + publiée + mappée", {
      bjCategoryId,
      customCategoryId: res.id,
      label: cat.name,
    });
    return { success: true, orderchampCustomCategoryId: res.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur inconnue";
    logger.error("[Orderchamp CustomCategory] échec", { bjCategoryId, error: message });
    return { success: false, error: message };
  }
}

/**
 * Garantit qu'une customCategory OC ENFANT existe et est publiée pour la
 * sous-catégorie BJ donnée. La parente OC est auto-créée d'abord via
 * `ensureOrderchampCustomCategory(subCat.categoryId)`.
 * Retourne l'ID de la sous-catégorie OC (à envoyer en `customCategory`).
 */
export async function ensureOrderchampSubCategoryCustomCategory(
  bjSubCategoryId: string,
): Promise<EnsureCustomCategoryResult> {
  const sub = await prisma.subCategory.findUnique({
    where: { id: bjSubCategoryId },
    select: {
      id: true,
      name: true,
      orderchampCustomCategoryId: true,
      categoryId: true,
    },
  });
  if (!sub) return { success: false, error: "Sous-catégorie BJ introuvable." };

  // 1) Assure la parente OC (récursif via helper existant).
  const parentRes = await ensureOrderchampCustomCategory(sub.categoryId);
  if (!parentRes.success || !parentRes.orderchampCustomCategoryId) {
    return { success: false, error: parentRes.error ?? "Catégorie parente OC introuvable." };
  }
  const parentOcId = parentRes.orderchampCustomCategoryId;
  const slug = slugifyForOrderchamp(sub.name);

  try {
    const all = await listAllCustomCategories();

    // Cas A : ID stocké encore valide ET son parent est le bon → OK.
    if (sub.orderchampCustomCategoryId) {
      const stored = all.find((n) => n.id === sub.orderchampCustomCategoryId);
      if (stored && stored.parent?.id === parentOcId) {
        await publishIfNeeded(stored.id, stored.isPublished);
        return { success: true, orderchampCustomCategoryId: stored.id };
      }
      logger.warn("[Orderchamp SubCategory] ID stocké obsolète ou mauvais parent — reset", {
        bjSubCategoryId,
        staleId: sub.orderchampCustomCategoryId,
      });
      await prisma.subCategory.update({
        where: { id: bjSubCategoryId },
        data: { orderchampCustomCategoryId: null },
      });
    }

    // Cas B : match par (slug + parentId).
    const children = all.filter((n) => n.parent?.id === parentOcId);
    const match =
      children.find((n) => n.label === slug) ??
      children.find((n) => n.value === slug);
    if (match) {
      await publishIfNeeded(match.id, match.isPublished);
      await prisma.subCategory.update({
        where: { id: bjSubCategoryId },
        data: { orderchampCustomCategoryId: match.id },
      });
      logger.info("[Orderchamp SubCategory] existante réutilisée", {
        bjSubCategoryId,
        customCategoryId: match.id,
        parentId: parentOcId,
        slug,
      });
      return { success: true, orderchampCustomCategoryId: match.id };
    }

    // Cas C : création (avec parentId).
    const res = await createCustomCategoryOnOc({
      name: sub.name,
      slug,
      parentId: parentOcId,
    });
    if (res.error) return { success: false, error: res.error };

    await prisma.subCategory.update({
      where: { id: bjSubCategoryId },
      data: { orderchampCustomCategoryId: res.id },
    });
    logger.info("[Orderchamp SubCategory] créée + publiée + mappée", {
      bjSubCategoryId,
      customCategoryId: res.id,
      parentId: parentOcId,
      label: sub.name,
    });
    return { success: true, orderchampCustomCategoryId: res.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur inconnue";
    logger.error("[Orderchamp SubCategory] échec", { bjSubCategoryId, error: message });
    return { success: false, error: message };
  }
}
