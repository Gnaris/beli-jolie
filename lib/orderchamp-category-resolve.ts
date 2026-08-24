/**
 * Orderchamp Category Resolve — applique la règle de priorité décidée avec
 * la cliente (2026-08-24) pour choisir la feuille standard OC envoyée dans
 * `productCreate/Update.category` :
 *
 *   1. Si le produit a des sous-catégories BJ, prendre la première (ordre
 *      alphabétique) qui a un mapping OC posé (`orderchampCategoryPath`).
 *   2. Sinon (aucune sous-cat, ou aucune parmi elles n'est mappée) → utiliser
 *      le mapping de la catégorie principale (`Category.orderchampCategoryPath`).
 *   3. Si RIEN n'est mappé (catégorie et toutes sous-cats vides) → renvoie
 *      `null` avec un message d'erreur prêt à afficher. Le publish/update
 *      doit refuser ce produit et remonter le message à l'UI.
 *
 * La catégorie principale devient donc « obligatoire » par produit (au moment
 * du push), les sous-cats restent facultatives.
 */

import { prisma } from "@/lib/prisma";

export type OrderchampCategorySource =
  | { kind: "subcategory"; subCategoryId: string; subCategoryName: string }
  | { kind: "category"; categoryId: string; categoryName: string };

export type OrderchampCategoryResolution =
  | { ok: true; path: string; source: OrderchampCategorySource }
  | { ok: false; error: string };

interface ResolveInput {
  category: { id: string; name: string; orderchampCategoryPath: string | null } | null;
  /** Trié par ordre alphabétique côté caller (règle métier). */
  subCategories: Array<{
    id: string;
    name: string;
    orderchampCategoryPath: string | null;
  }>;
}

/**
 * Version pure (testable) : reçoit les données déjà chargées et applique la
 * règle. Utilisée par la version DB ci-dessous + par les tests Vitest.
 */
export function resolveOrderchampCategory(
  input: ResolveInput,
): OrderchampCategoryResolution {
  if (!input.category) {
    return {
      ok: false,
      error:
        "Le produit n'a pas de catégorie BJ — impossible de publier sur Orderchamp.",
    };
  }

  const firstMappedSub = input.subCategories.find(
    (s) => s.orderchampCategoryPath && s.orderchampCategoryPath.trim().length > 0,
  );
  if (firstMappedSub && firstMappedSub.orderchampCategoryPath) {
    return {
      ok: true,
      path: firstMappedSub.orderchampCategoryPath,
      source: {
        kind: "subcategory",
        subCategoryId: firstMappedSub.id,
        subCategoryName: firstMappedSub.name,
      },
    };
  }

  const catPath = input.category.orderchampCategoryPath;
  if (catPath && catPath.trim().length > 0) {
    return {
      ok: true,
      path: catPath,
      source: {
        kind: "category",
        categoryId: input.category.id,
        categoryName: input.category.name,
      },
    };
  }

  return {
    ok: false,
    error: `La catégorie « ${input.category.name} » n'est pas encore reliée à Orderchamp. Allez dans Catégories → « ${input.category.name} » → carte Orderchamp pour choisir la catégorie du marché.`,
  };
}

/**
 * Version DB : recharge le produit + sous-catégories triées, puis délègue à
 * `resolveOrderchampCategory`. Appelée depuis publish/update/refresh.
 */
export async function resolveOrderchampCategoryForProduct(
  productId: string,
): Promise<OrderchampCategoryResolution> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: {
      category: {
        select: { id: true, name: true, orderchampCategoryPath: true },
      },
      subCategories: {
        select: { id: true, name: true, orderchampCategoryPath: true },
        orderBy: { name: "asc" },
      },
    },
  });
  if (!product) {
    return { ok: false, error: "Produit BJ introuvable." };
  }
  return resolveOrderchampCategory({
    category: product.category,
    subCategories: product.subCategories,
  });
}
