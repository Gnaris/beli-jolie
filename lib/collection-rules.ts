/**
 * Moteur d'évaluation des règles de collection.
 *
 * Une collection peut porter 0 ou 1 CollectionRule. Chaque règle définit un
 * ensemble de conditions combinées en ET :
 *   - saison exacte (0 ou 1)
 *   - catégories (OU implicite entre les IDs)
 *   - sous-catégories (OU implicite)
 *   - tags (OU implicite)
 *   - compositions : chaque ligne `{ compositionId, minPercent? }` doit être
 *     présente sur le produit, avec un pourcentage ≥ minPercent si précisé.
 *     Toutes les lignes de compo sont ET'ées entre elles.
 *
 * Sémantique du contenu d'une collection à un instant T :
 *   - CollectionProduct.source = MANUAL → toujours affiché
 *   - CollectionProduct.source = AUTO   → affiché si le produit matche encore
 *     ET n'est pas dans CollectionExclusion. Sinon la ligne est supprimée.
 *   - Un produit qui matche la règle et n'est PAS dans CollectionExclusion
 *     est ajouté avec source = AUTO s'il n'y est pas déjà.
 *
 * Un produit non-ONLINE n'est jamais candidat (choix cliente).
 */
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import type { Prisma } from "@prisma/client";

// ─────────────────────────────────────────────────────────────
// Types partagés
// ─────────────────────────────────────────────────────────────

export interface CollectionRuleCompositionLine {
  compositionId: string;
  /** Pourcentage minimum requis sur le produit. Absent = simple présence. */
  minPercent?: number;
}

export interface CollectionRuleInput {
  seasonId?: string | null;
  categoryIds?: string[];
  subCategoryIds?: string[];
  tagIds?: string[];
  compositions?: CollectionRuleCompositionLine[];
}

export interface CollectionRuleShape {
  seasonId: string | null;
  categoryIds: string[];
  subCategoryIds: string[];
  tagIds: string[];
  compositions: CollectionRuleCompositionLine[];
}

const EMPTY_RULE: CollectionRuleShape = {
  seasonId: null,
  categoryIds: [],
  subCategoryIds: [],
  tagIds: [],
  compositions: [],
};

/**
 * Une règle est « vide » si elle ne contient aucun critère. On refuse
 * volontairement d'appliquer une règle vide : sinon TOUS les produits ONLINE
 * du tenant seraient auto-ajoutés. Le caller doit soit ne pas créer de règle,
 * soit remplir au moins un champ.
 */
export function isRuleEmpty(rule: CollectionRuleShape): boolean {
  return (
    !rule.seasonId &&
    rule.categoryIds.length === 0 &&
    rule.subCategoryIds.length === 0 &&
    rule.tagIds.length === 0 &&
    rule.compositions.length === 0
  );
}

/**
 * Normalise l'input reçu du client en shape strict. Ignore les IDs vides et
 * dédoublonne les listes.
 */
export function normalizeRuleInput(input: CollectionRuleInput): CollectionRuleShape {
  const dedupe = (arr: string[] | undefined) =>
    Array.from(new Set((arr ?? []).filter((s) => typeof s === "string" && s.length > 0)));
  return {
    seasonId: input.seasonId ?? null,
    categoryIds: dedupe(input.categoryIds),
    subCategoryIds: dedupe(input.subCategoryIds),
    tagIds: dedupe(input.tagIds),
    compositions: (input.compositions ?? []).filter(
      (c) => typeof c?.compositionId === "string" && c.compositionId.length > 0,
    ),
  };
}

/**
 * Reconstruit la shape depuis les colonnes JSON stockées en base.
 */
export function parseStoredRule(stored: {
  seasonId: string | null;
  categoryIds: Prisma.JsonValue | null;
  subCategoryIds: Prisma.JsonValue | null;
  tagIds: Prisma.JsonValue | null;
  compositions: Prisma.JsonValue | null;
}): CollectionRuleShape {
  const asStringArray = (v: Prisma.JsonValue | null): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  const asCompositions = (v: Prisma.JsonValue | null): CollectionRuleCompositionLine[] => {
    if (!Array.isArray(v)) return [];
    return v.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const obj = item as Record<string, unknown>;
      const compositionId = obj.compositionId;
      if (typeof compositionId !== "string" || compositionId.length === 0) return [];
      const minPercent = typeof obj.minPercent === "number" ? obj.minPercent : undefined;
      return [{ compositionId, minPercent }];
    });
  };
  return {
    seasonId: stored.seasonId,
    categoryIds: asStringArray(stored.categoryIds),
    subCategoryIds: asStringArray(stored.subCategoryIds),
    tagIds: asStringArray(stored.tagIds),
    compositions: asCompositions(stored.compositions),
  };
}

// ─────────────────────────────────────────────────────────────
// Évaluation d'un produit contre une règle
// ─────────────────────────────────────────────────────────────

export interface ProductForRuleEvaluation {
  status: string;
  seasonId: string | null;
  categoryId: string;
  subCategories: { id: string }[];
  tags: { tagId: string }[];
  compositions: { compositionId: string; percentage: number }[];
}

/**
 * Renvoie true si le produit matche la règle. Ne teste PAS l'exclusion — c'est
 * la responsabilité du caller de croiser avec CollectionExclusion.
 * Renvoie false pour tout produit non-ONLINE.
 */
export function evaluateProductAgainstRule(
  product: ProductForRuleEvaluation,
  rule: CollectionRuleShape,
): boolean {
  if (product.status !== "ONLINE") return false;
  if (isRuleEmpty(rule)) return false;

  if (rule.seasonId && product.seasonId !== rule.seasonId) return false;

  if (rule.categoryIds.length > 0 && !rule.categoryIds.includes(product.categoryId)) {
    return false;
  }

  if (rule.subCategoryIds.length > 0) {
    const productSubIds = new Set(product.subCategories.map((s) => s.id));
    const hit = rule.subCategoryIds.some((id) => productSubIds.has(id));
    if (!hit) return false;
  }

  if (rule.tagIds.length > 0) {
    const productTagIds = new Set(product.tags.map((t) => t.tagId));
    const hit = rule.tagIds.some((id) => productTagIds.has(id));
    if (!hit) return false;
  }

  if (rule.compositions.length > 0) {
    const productCompoMap = new Map<string, number>();
    for (const c of product.compositions) {
      productCompoMap.set(c.compositionId, c.percentage);
    }
    for (const line of rule.compositions) {
      const pct = productCompoMap.get(line.compositionId);
      if (pct === undefined) return false;
      if (typeof line.minPercent === "number" && pct < line.minPercent) return false;
    }
  }

  return true;
}

// ─────────────────────────────────────────────────────────────
// Construction du where Prisma correspondant à une règle
// ─────────────────────────────────────────────────────────────

/**
 * Traduit une règle en `where` Prisma pour lister les produits qui matchent.
 * Toujours restreint à `status = ONLINE` — quand la cliente publiera un
 * brouillon, le hook `recalculateAllRulesForProduct` s'en occupera.
 */
export function buildProductWhereForRule(rule: CollectionRuleShape): Prisma.ProductWhereInput {
  const AND: Prisma.ProductWhereInput[] = [{ status: "ONLINE" }];

  if (rule.seasonId) AND.push({ seasonId: rule.seasonId });

  if (rule.categoryIds.length > 0) AND.push({ categoryId: { in: rule.categoryIds } });

  if (rule.subCategoryIds.length > 0) {
    AND.push({ subCategories: { some: { id: { in: rule.subCategoryIds } } } });
  }

  if (rule.tagIds.length > 0) {
    AND.push({ tags: { some: { tagId: { in: rule.tagIds } } } });
  }

  for (const line of rule.compositions) {
    const compoFilter: Prisma.ProductCompositionWhereInput = {
      compositionId: line.compositionId,
    };
    if (typeof line.minPercent === "number") {
      compoFilter.percentage = { gte: line.minPercent };
    }
    AND.push({ compositions: { some: compoFilter } });
  }

  return { AND };
}

// ─────────────────────────────────────────────────────────────
// Recalcul d'une collection entière
// ─────────────────────────────────────────────────────────────

export interface RecalculationResult {
  added: string[]; // productIds ajoutés (source AUTO)
  removed: string[]; // productIds retirés (étaient AUTO, ne matchent plus)
  keptAuto: number; // produits AUTO qui restent
  keptManual: number; // produits MANUAL (jamais touchés)
  excludedCount: number;
}

/**
 * Recalcule le contenu automatique d'une collection.
 *
 * - Charge la règle et les exclusions.
 * - Liste les produits ONLINE qui matchent (via SQL).
 * - Compare à l'existant :
 *     • matchants absents → INSERT source=AUTO en fin de position.
 *     • lignes AUTO qui ne matchent plus ou sont exclues → DELETE.
 *     • lignes MANUAL → laissées telles quelles.
 * - Met à jour `lastRecalculatedAt`.
 *
 * Idempotent : appeler plusieurs fois de suite ne change rien.
 */
export async function recalculateCollection(collectionId: string): Promise<RecalculationResult> {
  const [collection, rule, existing, exclusions] = await Promise.all([
    prisma.collection.findUnique({
      where: { id: collectionId },
      select: { id: true },
    }),
    prisma.collectionRule.findUnique({
      where: { collectionId },
      select: {
        seasonId: true,
        categoryIds: true,
        subCategoryIds: true,
        tagIds: true,
        compositions: true,
      },
    }),
    prisma.collectionProduct.findMany({
      where: { collectionId },
      select: { productId: true, source: true, position: true },
    }),
    prisma.collectionExclusion.findMany({
      where: { collectionId },
      select: { productId: true },
    }),
  ]);

  if (!collection) {
    throw new Error(`Collection ${collectionId} introuvable.`);
  }

  const excludedSet = new Set(exclusions.map((e) => e.productId));
  const existingByProductId = new Map(existing.map((cp) => [cp.productId, cp]));

  // Pas de règle ou règle vide → aucune addition/suppression AUTO. On laisse
  // tout tel quel (les AUTO existants deviennent orphelins mais restent
  // affichés — c'est le comportement attendu quand on retire une règle).
  if (!rule) {
    return {
      added: [],
      removed: [],
      keptAuto: existing.filter((cp) => cp.source === "AUTO").length,
      keptManual: existing.filter((cp) => cp.source === "MANUAL").length,
      excludedCount: excludedSet.size,
    };
  }

  const shape = parseStoredRule(rule);
  if (isRuleEmpty(shape)) {
    // Filet de sécurité : une règle vide ne fait rien. Le UI empêche déjà de la
    // créer, mais on est safe si un dev bidouille en direct.
    return {
      added: [],
      removed: [],
      keptAuto: existing.filter((cp) => cp.source === "AUTO").length,
      keptManual: existing.filter((cp) => cp.source === "MANUAL").length,
      excludedCount: excludedSet.size,
    };
  }

  const matchingProducts = await prisma.product.findMany({
    where: buildProductWhereForRule(shape),
    select: { id: true },
  });
  const matchingIds = new Set(matchingProducts.map((p) => p.id));

  // Ce qu'on doit ajouter : matche + pas déjà dans la collection + pas exclu.
  const toAdd: string[] = [];
  for (const id of matchingIds) {
    if (existingByProductId.has(id)) continue;
    if (excludedSet.has(id)) continue;
    toAdd.push(id);
  }

  // Ce qu'on doit retirer : ligne AUTO qui ne matche plus OU qui est exclue.
  const toRemove: string[] = [];
  for (const cp of existing) {
    if (cp.source !== "AUTO") continue;
    if (!matchingIds.has(cp.productId) || excludedSet.has(cp.productId)) {
      toRemove.push(cp.productId);
    }
  }

  const maxPos = existing.reduce((acc, cp) => Math.max(acc, cp.position), -1);

  await prisma.$transaction(async (tx) => {
    if (toRemove.length > 0) {
      await tx.collectionProduct.deleteMany({
        where: {
          collectionId,
          productId: { in: toRemove },
          source: "AUTO", // paranoia : ne jamais toucher un MANUAL
        },
      });
    }

    if (toAdd.length > 0) {
      // On insère un par un pour incrémenter la position proprement.
      let pos = maxPos + 1;
      const now = new Date();
      await tx.collectionProduct.createMany({
        data: toAdd.map((productId) => ({
          collectionId,
          productId,
          colorId: null,
          position: pos++,
          source: "AUTO" as const,
          addedByRuleAt: now,
        })),
        skipDuplicates: true,
      });
    }

    await tx.collectionRule.update({
      where: { collectionId },
      data: { lastRecalculatedAt: new Date() },
    });
  });

  const keptAuto = existing.filter(
    (cp) => cp.source === "AUTO" && !toRemove.includes(cp.productId),
  ).length;
  const keptManual = existing.filter((cp) => cp.source === "MANUAL").length;

  return {
    added: toAdd,
    removed: toRemove,
    keptAuto,
    keptManual,
    excludedCount: excludedSet.size,
  };
}

// ─────────────────────────────────────────────────────────────
// Recalcul pour un produit unique (hook create/update produit)
// ─────────────────────────────────────────────────────────────

/**
 * Évalue un produit contre TOUTES les règles du tenant courant et met à jour
 * les collections en conséquence. Appelé après createProduct/updateProduct.
 *
 * - Charge le produit avec ses attributs de matching.
 * - Charge toutes les règles du tenant.
 * - Pour chaque règle :
 *     • si le produit matche et n'est pas exclu → INSERT source=AUTO si absent
 *     • si le produit est AUTO dans la collection et ne matche plus → DELETE
 *     • si le produit est AUTO dans la collection et est exclu → DELETE
 *
 * Les rules avec `isRuleEmpty` sont ignorées.
 * Les produits non-ONLINE sortent automatiquement des lignes AUTO.
 */
export async function recalculateAllRulesForProduct(productId: string): Promise<void> {
  try {
    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: {
        id: true,
        status: true,
        seasonId: true,
        categoryId: true,
        subCategories: { select: { id: true } },
        tags: { select: { tagId: true } },
        compositions: { select: { compositionId: true, percentage: true } },
      },
    });
    if (!product) return;

    const rules = await prisma.collectionRule.findMany({
      select: {
        collectionId: true,
        seasonId: true,
        categoryIds: true,
        subCategoryIds: true,
        tagIds: true,
        compositions: true,
      },
    });
    if (rules.length === 0) return;

    // Collections où ce produit apparaît déjà (source utile pour décider DELETE).
    const existingLinks = await prisma.collectionProduct.findMany({
      where: { productId },
      select: { collectionId: true, source: true },
    });
    const existingByCollection = new Map(
      existingLinks.map((cp) => [cp.collectionId, cp.source]),
    );

    // Exclusions actives sur ce produit.
    const exclusions = await prisma.collectionExclusion.findMany({
      where: { productId },
      select: { collectionId: true },
    });
    const excludedFrom = new Set(exclusions.map((e) => e.collectionId));

    // Pour chaque règle, décide add / remove / no-op.
    const toAdd: { collectionId: string; position: number }[] = [];
    const toRemoveFrom: string[] = [];

    // Précalcule les positions max des collections concernées en un shot.
    const collectionIdsToCheck = rules.map((r) => r.collectionId);
    const maxPositions = await prisma.collectionProduct.groupBy({
      by: ["collectionId"],
      where: { collectionId: { in: collectionIdsToCheck } },
      _max: { position: true },
    });
    const maxPosByCollection = new Map(
      maxPositions.map((mp) => [mp.collectionId, mp._max.position ?? -1]),
    );

    for (const rule of rules) {
      const shape = parseStoredRule(rule);
      if (isRuleEmpty(shape)) continue;

      const matches = evaluateProductAgainstRule(product, shape);
      const existingSource = existingByCollection.get(rule.collectionId);
      const isExcluded = excludedFrom.has(rule.collectionId);

      if (matches && !isExcluded && !existingSource) {
        const nextPos = (maxPosByCollection.get(rule.collectionId) ?? -1) + 1;
        toAdd.push({ collectionId: rule.collectionId, position: nextPos });
      } else if (existingSource === "AUTO" && (!matches || isExcluded)) {
        toRemoveFrom.push(rule.collectionId);
      }
    }

    if (toAdd.length === 0 && toRemoveFrom.length === 0) return;

    await prisma.$transaction(async (tx) => {
      if (toRemoveFrom.length > 0) {
        await tx.collectionProduct.deleteMany({
          where: {
            productId,
            collectionId: { in: toRemoveFrom },
            source: "AUTO",
          },
        });
      }
      if (toAdd.length > 0) {
        const now = new Date();
        await tx.collectionProduct.createMany({
          data: toAdd.map((a) => ({
            collectionId: a.collectionId,
            productId,
            colorId: null,
            position: a.position,
            source: "AUTO" as const,
            addedByRuleAt: now,
          })),
          skipDuplicates: true,
        });
      }
    });
  } catch (err) {
    // Un échec du recalcul ne doit pas faire échouer l'écriture du produit.
    logger.error("[collection-rules] recalculateAllRulesForProduct failed", {
      productId,
      error: err,
    });
  }
}

// ─────────────────────────────────────────────────────────────
// Preview count (UI)
// ─────────────────────────────────────────────────────────────

/**
 * Renvoie le nombre de produits ONLINE qui matcheraient une règle. Utilisé
 * par l'éditeur de règle pour afficher « cette règle matche N produits ».
 * Retourne 0 si la règle est vide.
 */
export async function countProductsMatchingRule(rule: CollectionRuleShape): Promise<number> {
  if (isRuleEmpty(rule)) return 0;
  return prisma.product.count({ where: buildProductWhereForRule(rule) });
}

export { EMPTY_RULE };
