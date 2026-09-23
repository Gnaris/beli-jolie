"use server";

import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { revalidatePath, revalidateTag } from "next/cache";
import { z } from "zod";
import { autoTranslateCollection } from "@/lib/auto-translate";
import { renameCollectionFolder, deleteDirectory, collectionImageDir, deleteFile, keyFromDbPath, slugify } from "@/lib/storage";
import { requireCurrentTenant } from "@/lib/tenant";
import { logger } from "@/lib/logger";
import { NON_DEFAULT_LOCALES } from "@/i18n/locales";
import {
  countProductsMatchingRule,
  isRuleEmpty,
  normalizeRuleInput,
  parseStoredRule,
  recalculateCollection as runRecalculateCollection,
  type CollectionRuleInput,
  type CollectionRuleShape,
} from "@/lib/collection-rules";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    throw new Error("Accès non autorisé.");
  }
}

// ─────────────────────────────────────────────
// Schémas de validation
// ─────────────────────────────────────────────

const CollectionSchema = z.object({
  name:        z.string().min(1, "Le nom est requis.").max(100),
  image:       z.string().optional(),
  imageBanner: z.string().optional(),
});

/**
 * Purge les 3 tailles (grand + `-md` + `-thumb`) d'une image de couverture qui
 * a été remplacée ou supprimée. Best-effort : les erreurs sont loggées mais
 * n'empêchent pas la sauvegarde en BDD (la BDD est déjà à jour, on veut juste
 * ne pas laisser de fichiers orphelins sur disque).
 */
async function purgeCollectionCoverFiles(collectionId: string, dbPath: string) {
  const mdPath = dbPath.replace(/\.webp$/i, "-md.webp");
  const thumbPath = dbPath.replace(/\.webp$/i, "-thumb.webp");
  for (const p of [dbPath, mdPath, thumbPath]) {
    try {
      await deleteFile(keyFromDbPath(p));
    } catch (err) {
      logger.warn("[collections] Failed to delete old cover file", {
        collectionId,
        path: p,
        error: err,
      });
    }
  }
}

// ─────────────────────────────────────────────
// Lister toutes les collections
// ─────────────────────────────────────────────
export async function getCollections() {
  await requireAdmin();
  return prisma.collection.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { products: true } },
    },
  });
}

// ─────────────────────────────────────────────
// Créer une collection
// ─────────────────────────────────────────────
export async function createCollection(formData: FormData) {
  await requireAdmin();

  // formData.get renvoie `null` si le champ est absent — Zod v4 refuse `null`
  // sur un champ `.optional()`, on le convertit en `undefined` d'abord.
  const rawName = formData.get("name");
  const rawImage = formData.get("image");
  const rawBanner = formData.get("imageBanner");
  const raw = {
    name: typeof rawName === "string" ? rawName : "",
    image: typeof rawImage === "string" && rawImage.length > 0 ? rawImage : undefined,
    imageBanner: typeof rawBanner === "string" && rawBanner.length > 0 ? rawBanner : undefined,
  };

  const parsed = CollectionSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const slug = await ensureUniqueCollectionSlug(parsed.data.name, null);
  const collection = await prisma.collection.create({
    data: {
      name:        parsed.data.name,
      slug,
      image:       parsed.data.image || null,
      imageBanner: parsed.data.imageBanner || null,
    },
  });
  autoTranslateCollection(collection.id, parsed.data.name);

  revalidatePath("/admin/collections");
  revalidateTag("collections", "default");
  revalidatePath("/collections");
  return { success: true, id: collection.id };
}

/**
 * Génère un slug unique par tenant à partir du nom. Si le slug de base est
 * déjà pris (par une autre collection), on suffixe `-2`, `-3`, etc.
 * `excludeCollectionId` permet à un update de conserver son propre slug sans
 * collision avec lui-même.
 */
async function ensureUniqueCollectionSlug(
  name: string,
  excludeCollectionId: string | null,
): Promise<string> {
  const base = slugify(name) || "collection";
  let candidate = base;
  let n = 2;
  // Boucle bornée à ~50 tentatives pour éviter tout emballement pathologique.
  for (let i = 0; i < 50; i++) {
    const existing = await prisma.collection.findFirst({
      where: {
        slug: candidate,
        ...(excludeCollectionId ? { NOT: { id: excludeCollectionId } } : {}),
      },
      select: { id: true },
    });
    if (!existing) return candidate;
    candidate = `${base}-${n}`;
    n++;
  }
  return `${base}-${Date.now()}`;
}

// ─────────────────────────────────────────────
// Mettre à jour une collection
// ─────────────────────────────────────────────
export async function updateCollection(id: string, formData: FormData) {
  await requireAdmin();
  const tenant = await requireCurrentTenant();

  // Idem createCollection : normaliser null → undefined pour Zod v4.
  const rawName = formData.get("name");
  const rawImage = formData.get("image");
  const rawBanner = formData.get("imageBanner");
  const raw = {
    name: typeof rawName === "string" ? rawName : "",
    image: typeof rawImage === "string" && rawImage.length > 0 ? rawImage : undefined,
    imageBanner: typeof rawBanner === "string" && rawBanner.length > 0 ? rawBanner : undefined,
  };

  const parsed = CollectionSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  // Si le nom change, on renomme le dossier d'images correspondant pour
  // garder le lecteur réseau lisible. On dérive le slug du nom.
  const previous = await prisma.collection.findUnique({
    where: { id },
    select: { name: true, image: true, imageBanner: true, slug: true },
  });

  // Le slug URL suit le nom : recalculé s'il a changé, on garde l'existant
  // sinon. Sur ancienne collection sans slug (edge case backfill), on en
  // génère un maintenant. La contrainte d'unicité par tenant est gérée par
  // `ensureUniqueCollectionSlug` qui suffixe `-2`, `-3` si collision.
  const nextSlug =
    !previous?.slug || previous.name !== parsed.data.name
      ? await ensureUniqueCollectionSlug(parsed.data.name, id)
      : previous.slug;

  let newImagePath = parsed.data.image || null;
  let newBannerPath = parsed.data.imageBanner || null;
  let folderRenamed = false;
  // Resolve the *current on-disk path* of the previous image (a folder rename
  // would have moved it). Initialised before the rename: starts as
  // `previous.image`, swapped to its new path if the rename touched it.
  let previousImageEffectivePath: string | null = previous?.image ?? null;
  let previousBannerEffectivePath: string | null = previous?.imageBanner ?? null;
  if (previous && previous.name !== parsed.data.name) {
    try {
      const { renamed } = await renameCollectionFolder(previous.name, parsed.data.name, tenant.slug);
      folderRenamed = renamed.length > 0;
      // Si les images pointent vers l'ancien dossier, swap aussi les paths.
      const swapPath = (p: string | null): string | null => {
        if (!p) return p;
        const hit = renamed.find((r) => r.oldDbPath === p);
        return hit ? hit.newDbPath : p;
      };
      newImagePath = swapPath(newImagePath);
      newBannerPath = swapPath(newBannerPath);
      previousImageEffectivePath = swapPath(previousImageEffectivePath);
      previousBannerEffectivePath = swapPath(previousBannerEffectivePath);
    } catch (err) {
      logger.error("[Storage] renameCollectionFolder failed", {
        collectionId: id,
        oldName: previous.name,
        newName: parsed.data.name,
        error: err,
      });
    }
  }

  try {
    await prisma.collection.update({
      where: { id },
      data: {
        name:        parsed.data.name,
        slug:        nextSlug,
        image:       newImagePath,
        imageBanner: newBannerPath,
      },
    });
  } catch (err) {
    if (folderRenamed && previous) {
      try {
        await renameCollectionFolder(parsed.data.name, previous.name, tenant.slug);
      } catch (rollbackErr) {
        logger.error("[Storage] Failed to rollback collection folder rename", {
          collectionId: id,
          error: rollbackErr,
        });
      }
    }
    throw err;
  }

  // BDD update succeeded — purge the previous cover files (large + -md +
  // -thumb) if the user replaced or removed them. Skip when the path is
  // unchanged and when the rename already moved it to the new path stored.
  if (previousImageEffectivePath && previousImageEffectivePath !== newImagePath) {
    await purgeCollectionCoverFiles(id, previousImageEffectivePath);
  }
  if (previousBannerEffectivePath && previousBannerEffectivePath !== newBannerPath) {
    await purgeCollectionCoverFiles(id, previousBannerEffectivePath);
  }

  // Save translations if present
  for (const locale of NON_DEFAULT_LOCALES) {
    const val = (formData.get(`translation_${locale}`) as string)?.trim();
    if (val) {
      await prisma.collectionTranslation.upsert({
        where: { collectionId_locale: { collectionId: id, locale } },
        update: { name: val },
        create: { collectionId: id, locale, name: val },
      });
    } else {
      await prisma.collectionTranslation.deleteMany({ where: { collectionId: id, locale } });
    }
  }

  revalidatePath("/admin/collections");
  revalidateTag("collections", "default");
  revalidatePath(`/admin/collections/${id}/modifier`);
  revalidatePath("/collections");
  revalidatePath(`/collections/${id}`);
  return { success: true };
}

// ─────────────────────────────────────────────
// Supprimer une collection
// ─────────────────────────────────────────────
export async function deleteCollection(id: string) {
  await requireAdmin();
  const tenant = await requireCurrentTenant();

  const previous = await prisma.collection.findUnique({
    where: { id },
    select: { name: true },
  });

  await prisma.collection.delete({ where: { id } });

  // Suppression du dossier d'images dédié, s'il existe.
  if (previous?.name) {
    try {
      await deleteDirectory(collectionImageDir(previous.name, tenant.slug));
    } catch (err) {
      logger.error(`[Storage] Failed to delete collection folder`, {
        collectionId: id,
        error: err,
      });
    }
  }

  revalidatePath("/admin/collections");
  revalidateTag("collections", "default");
  revalidatePath("/collections");
  return { success: true };
}

// ─────────────────────────────────────────────
// Ajouter un produit à une collection
// ─────────────────────────────────────────────
export async function addProductToCollection(
  collectionId: string,
  productId: string,
  colorId?: string
) {
  await requireAdmin();

  // P3-12 — refuser les produits hors-ligne ou archivés. Les ajouter à une
  // collection visible publiquement risquerait de pousser un produit invisible.
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { status: true },
  });
  if (!product) {
    return { success: false as const, error: "Produit introuvable." };
  }
  if (product.status !== "ONLINE") {
    return {
      success: false as const,
      error: "Seuls les produits en ligne peuvent être ajoutés à une collection.",
    };
  }

  // Ajout manuel → source = MANUAL. On lève aussi toute exclusion existante
  // (elle est incohérente avec un ajout explicite : la cliente veut ce produit
  // dans la collection).
  const maxPos = await prisma.collectionProduct.aggregate({
    where:   { collectionId },
    _max:    { position: true },
  });
  const position = (maxPos._max.position ?? -1) + 1;

  await prisma.$transaction([
    prisma.collectionExclusion.deleteMany({
      where: { collectionId, productId },
    }),
    prisma.collectionProduct.upsert({
      where:  { collectionId_productId: { collectionId, productId } },
      create: { collectionId, productId, colorId: colorId || null, position, source: "MANUAL" },
      update: { colorId: colorId || null, source: "MANUAL" },
    }),
  ]);

  revalidatePath(`/admin/collections/${collectionId}/modifier`);
  revalidatePath(`/collections/${collectionId}`);
  revalidateTag("collections", "default");
  return { success: true as const };
}

// ─────────────────────────────────────────────
// Ajouter en masse plusieurs produits à une collection
// (les brouillons/archivés sont ignorés — cf. addProductToCollection).
// ─────────────────────────────────────────────
export async function bulkAddProductsToCollection(
  collectionId: string,
  productIds: string[],
): Promise<{ added: number; skipped: number; skippedReferences: string[] }> {
  await requireAdmin();
  if (productIds.length === 0) throw new Error("Aucun produit sélectionné.");
  if (productIds.length > 1000) throw new Error("Maximum 1000 produits à la fois.");

  const collection = await prisma.collection.findUnique({
    where: { id: collectionId },
    select: { id: true },
  });
  if (!collection) throw new Error("Collection introuvable.");

  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, reference: true, status: true },
  });
  if (products.length === 0) throw new Error("Aucun produit trouvé.");

  // Seuls les produits ONLINE peuvent rejoindre une collection publique
  // (parité avec addProductToCollection unitaire).
  const eligible = products.filter((p) => p.status === "ONLINE");
  const skippedRefs = products.filter((p) => p.status !== "ONLINE").map((p) => p.reference);

  if (eligible.length === 0) {
    return { added: 0, skipped: skippedRefs.length, skippedReferences: skippedRefs };
  }

  const maxPos = await prisma.collectionProduct.aggregate({
    where: { collectionId },
    _max: { position: true },
  });
  let position = (maxPos._max.position ?? -1) + 1;

  const data = eligible.map((p) => ({
    collectionId,
    productId: p.id,
    colorId: null,
    position: position++,
    source: "MANUAL" as const,
  }));

  // Ajout bulk manuel → lever les exclusions existantes sur ces produits pour
  // rester cohérent (comme addProductToCollection unitaire).
  await prisma.collectionExclusion.deleteMany({
    where: { collectionId, productId: { in: eligible.map((p) => p.id) } },
  });

  // skipDuplicates : si le produit est déjà dans la collection on ne casse pas
  // (mais on ne le repromeut pas non plus en MANUAL — comportement historique).
  const result = await prisma.collectionProduct.createMany({
    data,
    skipDuplicates: true,
  });

  revalidatePath(`/admin/collections/${collectionId}/modifier`);
  revalidatePath("/admin/collections");
  revalidatePath(`/collections/${collectionId}`);
  revalidatePath("/collections");
  revalidateTag("collections", "default");

  return {
    added: result.count,
    skipped: skippedRefs.length,
    skippedReferences: skippedRefs,
  };
}

// ─────────────────────────────────────────────
// Retirer un produit d'une collection
// ─────────────────────────────────────────────
// Comportement dépend du `source` de la ligne :
//   - AUTO : ligne supprimée + création d'une CollectionExclusion pour que le
//     produit ne soit pas réintégré au prochain recalcul (il matche toujours
//     la règle mais la cliente a explicitement dit « je n'en veux pas »).
//   - MANUAL : ligne supprimée sans exclusion (le produit ne matche peut-être
//     rien et de toute façon la cliente pourra le rajouter à la main).
// Le caller peut forcer l'exclusion via `alwaysExclude: true` (utile si UI
// veut proposer « supprimer ET exclure » sur un MANUAL épinglé qui matche).
export async function removeProductFromCollection(
  collectionId: string,
  productId: string,
  opts?: { alwaysExclude?: boolean },
) {
  await requireAdmin();
  const session = await getServerSession(authOptions);
  const adminId = session?.user?.id ?? null;

  const existing = await prisma.collectionProduct.findUnique({
    where: { collectionId_productId: { collectionId, productId } },
    select: { source: true },
  });

  const shouldExclude = existing?.source === "AUTO" || opts?.alwaysExclude === true;

  await prisma.$transaction(async (tx) => {
    if (existing) {
      await tx.collectionProduct.delete({
        where: { collectionId_productId: { collectionId, productId } },
      });
    }
    if (shouldExclude) {
      await tx.collectionExclusion.upsert({
        where: { collectionId_productId: { collectionId, productId } },
        create: { collectionId, productId, excludedById: adminId },
        update: { excludedById: adminId, excludedAt: new Date() },
      });
    }
  });

  revalidatePath(`/admin/collections/${collectionId}/modifier`);
  revalidatePath(`/collections/${collectionId}`);
  revalidateTag("collections", "default");
  return { success: true, excluded: shouldExclude };
}

// ─────────────────────────────────────────────
// Mettre à jour la couleur d'un produit dans une collection
// ─────────────────────────────────────────────
export async function updateCollectionProductColor(
  collectionId: string,
  productId: string,
  colorId: string | null
) {
  await requireAdmin();

  await prisma.collectionProduct.update({
    where: { collectionId_productId: { collectionId, productId } },
    data:  { colorId },
  });

  revalidatePath(`/admin/collections/${collectionId}/modifier`);
  revalidatePath(`/collections/${collectionId}`);
  return { success: true };
}

// ─────────────────────────────────────────────
// Mettre à jour les positions des produits
// ─────────────────────────────────────────────
// Si une ligne AUTO change de position (drag & drop), on la promeut en MANUAL :
// la cliente a pris une décision explicite sur son placement, on la respecte
// même si le produit sort du critère de la règle plus tard.
export async function reorderCollectionProducts(
  collectionId: string,
  items: { productId: string; position: number }[]
) {
  await requireAdmin();

  // Récupère les positions et sources actuelles pour détecter les AUTO déplacés.
  const current = await prisma.collectionProduct.findMany({
    where: { collectionId },
    select: { productId: true, position: true, source: true },
  });
  const currentByProduct = new Map(current.map((cp) => [cp.productId, cp]));

  // P3-13 — toutes les positions dans la même transaction. Avant : un échec
  // sur la moitié laissait la collection avec des positions incohérentes.
  await prisma.$transaction(
    items.map(({ productId, position }) => {
      const before = currentByProduct.get(productId);
      const promoteToManual = before?.source === "AUTO" && before.position !== position;
      return prisma.collectionProduct.update({
        where: { collectionId_productId: { collectionId, productId } },
        data: promoteToManual
          ? { position, source: "MANUAL" as const }
          : { position },
      });
    })
  );

  revalidatePath(`/admin/collections/${collectionId}/modifier`);
  revalidatePath(`/collections/${collectionId}`);
  return { success: true };
}

// ─────────────────────────────────────────────
// Épingler une ligne AUTO (la promouvoir en MANUAL sans la déplacer).
// Utile quand la cliente veut garder un produit dans la collection même s'il
// ne matche plus la règle un jour.
// ─────────────────────────────────────────────
export async function pinCollectionProduct(collectionId: string, productId: string) {
  await requireAdmin();

  await prisma.collectionProduct.update({
    where: { collectionId_productId: { collectionId, productId } },
    data: { source: "MANUAL" },
  });

  revalidatePath(`/admin/collections/${collectionId}/modifier`);
  revalidateTag("collections", "default");
  return { success: true };
}

// ─────────────────────────────────────────────
// Désépingler : repasse en AUTO. Si le produit ne matche plus la règle
// au prochain recalcul, il sortira.
// ─────────────────────────────────────────────
export async function unpinCollectionProduct(collectionId: string, productId: string) {
  await requireAdmin();

  await prisma.collectionProduct.update({
    where: { collectionId_productId: { collectionId, productId } },
    data: { source: "AUTO" },
  });

  revalidatePath(`/admin/collections/${collectionId}/modifier`);
  revalidateTag("collections", "default");
  return { success: true };
}

// ─────────────────────────────────────────────
// Retirer une exclusion : le produit redevient candidat à l'ajout auto
// au prochain recalcul.
// ─────────────────────────────────────────────
export async function reincludeProductInCollection(collectionId: string, productId: string) {
  await requireAdmin();

  await prisma.collectionExclusion.deleteMany({
    where: { collectionId, productId },
  });

  revalidatePath(`/admin/collections/${collectionId}/modifier`);
  revalidateTag("collections", "default");
  return { success: true };
}

// ─────────────────────────────────────────────
// Règles de peuplement automatique
// ─────────────────────────────────────────────

const RuleInputSchema = z.object({
  seasonId: z.string().nullable().optional(),
  categoryIds: z.array(z.string()).optional(),
  subCategoryIds: z.array(z.string()).optional(),
  tagIds: z.array(z.string()).optional(),
  compositions: z
    .array(
      z.object({
        compositionId: z.string(),
        minPercent: z.number().min(0).max(100).optional(),
      }),
    )
    .optional(),
});

/**
 * Crée ou met à jour la règle d'une collection, puis recalcule immédiatement
 * son contenu automatique.
 */
export async function setCollectionRule(collectionId: string, input: CollectionRuleInput) {
  await requireAdmin();

  const parsed = RuleInputSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false as const, error: parsed.error.issues[0].message };
  }

  const shape = normalizeRuleInput(parsed.data);
  if (isRuleEmpty(shape)) {
    return {
      success: false as const,
      error: "La règle doit contenir au moins un critère.",
    };
  }

  const collection = await prisma.collection.findUnique({
    where: { id: collectionId },
    select: { id: true },
  });
  if (!collection) {
    return { success: false as const, error: "Collection introuvable." };
  }

  await prisma.collectionRule.upsert({
    where: { collectionId },
    create: {
      collectionId,
      seasonId: shape.seasonId,
      categoryIds: shape.categoryIds,
      subCategoryIds: shape.subCategoryIds,
      tagIds: shape.tagIds,
      compositions: shape.compositions as unknown as object,
    },
    update: {
      seasonId: shape.seasonId,
      categoryIds: shape.categoryIds,
      subCategoryIds: shape.subCategoryIds,
      tagIds: shape.tagIds,
      compositions: shape.compositions as unknown as object,
    },
  });

  let result;
  try {
    result = await runRecalculateCollection(collectionId);
  } catch (err) {
    logger.error("[collections] setCollectionRule: recalcul échoué", {
      collectionId,
      error: err,
    });
    result = null;
  }

  revalidatePath(`/admin/collections/${collectionId}/modifier`);
  revalidatePath(`/collections/${collectionId}`);
  revalidatePath("/admin/collections");
  revalidateTag("collections", "default");

  return { success: true as const, result };
}

/**
 * Supprime la règle. Les produits AUTO déjà présents restent (mais deviennent
 * orphelins — la cliente peut les épingler ou les retirer un par un).
 */
export async function removeCollectionRule(collectionId: string) {
  await requireAdmin();

  await prisma.collectionRule.deleteMany({ where: { collectionId } });

  revalidatePath(`/admin/collections/${collectionId}/modifier`);
  revalidatePath(`/collections/${collectionId}`);
  revalidateTag("collections", "default");
  return { success: true as const };
}

/**
 * Bouton « Recalculer maintenant » de l'éditeur.
 */
export async function recalculateCollectionAction(collectionId: string) {
  await requireAdmin();
  try {
    const result = await runRecalculateCollection(collectionId);
    revalidatePath(`/admin/collections/${collectionId}/modifier`);
    revalidatePath(`/collections/${collectionId}`);
    revalidateTag("collections", "default");
    return { success: true as const, result };
  } catch (err) {
    logger.error("[collections] recalcul manuel échoué", {
      collectionId,
      error: err,
    });
    return { success: false as const, error: "Recalcul échoué." };
  }
}

/**
 * Preview UI : compte les produits qui matcheraient une règle donnée (sans la
 * sauvegarder). Utilisé par l'éditeur pour afficher « N produits éligibles »
 * en direct.
 */
export async function previewRuleMatchCount(input: CollectionRuleInput) {
  await requireAdmin();
  const parsed = RuleInputSchema.safeParse(input);
  if (!parsed.success) return { count: 0 };
  const shape: CollectionRuleShape = normalizeRuleInput(parsed.data);
  const count = await countProductsMatchingRule(shape);
  return { count };
}

/**
 * Renvoie la règle courante + la liste des exclusions actives (avec noms de
 * produits). Utilisé par la page d'édition pour afficher l'état.
 */
export async function getCollectionRuleAndExclusions(collectionId: string) {
  await requireAdmin();

  const [rule, exclusions] = await Promise.all([
    prisma.collectionRule.findUnique({
      where: { collectionId },
      select: {
        seasonId: true,
        categoryIds: true,
        subCategoryIds: true,
        tagIds: true,
        compositions: true,
        lastRecalculatedAt: true,
      },
    }),
    prisma.collectionExclusion.findMany({
      where: { collectionId },
      select: {
        productId: true,
        excludedAt: true,
        product: { select: { id: true, name: true, reference: true } },
      },
      orderBy: { excludedAt: "desc" },
    }),
  ]);

  return {
    rule: rule ? { ...parseStoredRule(rule), lastRecalculatedAt: rule.lastRecalculatedAt } : null,
    exclusions: exclusions.map((e) => ({
      productId: e.productId,
      excludedAt: e.excludedAt,
      name: e.product.name,
      reference: e.product.reference,
    })),
  };
}
