"use server";

import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { revalidatePath, revalidateTag } from "next/cache";
import { z } from "zod";
import { autoTranslateCollection } from "@/lib/auto-translate";
import { renameCollectionFolder, deleteDirectory, collectionImageDir, deleteFile, keyFromDbPath } from "@/lib/storage";
import { requireCurrentTenant } from "@/lib/tenant";
import { logger } from "@/lib/logger";
import { NON_DEFAULT_LOCALES } from "@/i18n/locales";

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
  name:  z.string().min(1, "Le nom est requis.").max(100),
  image: z.string().optional(),
});

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

  const raw = {
    name:  formData.get("name")  as string,
    image: formData.get("image") as string | undefined,
  };

  const parsed = CollectionSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const collection = await prisma.collection.create({
    data: {
      name:  parsed.data.name,
      image: parsed.data.image || null,
    },
  });
  autoTranslateCollection(collection.id, parsed.data.name);

  revalidatePath("/admin/collections");
  revalidateTag("collections", "default");
  revalidatePath("/collections");
  return { success: true, id: collection.id };
}

// ─────────────────────────────────────────────
// Mettre à jour une collection
// ─────────────────────────────────────────────
export async function updateCollection(id: string, formData: FormData) {
  await requireAdmin();
  const tenant = await requireCurrentTenant();

  const raw = {
    name:  formData.get("name")  as string,
    image: formData.get("image") as string | undefined,
  };

  const parsed = CollectionSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  // Si le nom change, on renomme le dossier d'images correspondant pour
  // garder le lecteur réseau lisible. On dérive le slug du nom.
  const previous = await prisma.collection.findUnique({
    where: { id },
    select: { name: true, image: true },
  });

  let newImagePath = parsed.data.image || null;
  let folderRenamed = false;
  // Resolve the *current on-disk path* of the previous image (a folder rename
  // would have moved it). Initialised before the rename: starts as
  // `previous.image`, swapped to its new path if the rename touched it.
  let previousImageEffectivePath: string | null = previous?.image ?? null;
  if (previous && previous.name !== parsed.data.name) {
    try {
      const { renamed } = await renameCollectionFolder(previous.name, parsed.data.name, tenant.slug);
      folderRenamed = renamed.length > 0;
      // Si l'image actuelle pointe vers l'ancien dossier, swap aussi le path.
      if (newImagePath) {
        const swap = renamed.find((r) => r.oldDbPath === newImagePath);
        if (swap) newImagePath = swap.newDbPath;
      }
      if (previousImageEffectivePath) {
        const swap = renamed.find((r) => r.oldDbPath === previousImageEffectivePath);
        if (swap) previousImageEffectivePath = swap.newDbPath;
      }
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
        name:  parsed.data.name,
        image: newImagePath,
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

  // BDD update succeeded — purge the previous cover image files (large +
  // -md.webp + -thumb.webp) if the user replaced or removed it. Skip when
  // the image path is unchanged (same file, just kept) and when the rename
  // already moved it to the new path we just stored.
  if (
    previousImageEffectivePath &&
    previousImageEffectivePath !== newImagePath
  ) {
    const mdPath = previousImageEffectivePath.replace(/\.webp$/i, "-md.webp");
    const thumbPath = previousImageEffectivePath.replace(/\.webp$/i, "-thumb.webp");
    for (const dbPath of [previousImageEffectivePath, mdPath, thumbPath]) {
      try {
        await deleteFile(keyFromDbPath(dbPath));
      } catch (err) {
        logger.warn("[updateCollection] Failed to delete old cover image", {
          collectionId: id,
          path: dbPath,
          error: err,
        });
      }
    }
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

  // Position = max actuel + 1
  const maxPos = await prisma.collectionProduct.aggregate({
    where:   { collectionId },
    _max:    { position: true },
  });
  const position = (maxPos._max.position ?? -1) + 1;

  await prisma.collectionProduct.upsert({
    where:  { collectionId_productId: { collectionId, productId } },
    create: { collectionId, productId, colorId: colorId || null, position },
    update: { colorId: colorId || null },
  });

  revalidatePath(`/admin/collections/${collectionId}/modifier`);
  revalidatePath(`/collections/${collectionId}`);
  return { success: true as const };
}

// ─────────────────────────────────────────────
// Retirer un produit d'une collection
// ─────────────────────────────────────────────
export async function removeProductFromCollection(
  collectionId: string,
  productId: string
) {
  await requireAdmin();

  await prisma.collectionProduct.delete({
    where: { collectionId_productId: { collectionId, productId } },
  });

  revalidatePath(`/admin/collections/${collectionId}/modifier`);
  revalidatePath(`/collections/${collectionId}`);
  return { success: true };
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
export async function reorderCollectionProducts(
  collectionId: string,
  items: { productId: string; position: number }[]
) {
  await requireAdmin();

  // P3-13 — toutes les positions dans la même transaction. Avant : un échec
  // sur la moitié laissait la collection avec des positions incohérentes.
  await prisma.$transaction(
    items.map(({ productId, position }) =>
      prisma.collectionProduct.update({
        where: { collectionId_productId: { collectionId, productId } },
        data:  { position },
      })
    )
  );

  revalidatePath(`/admin/collections/${collectionId}/modifier`);
  revalidatePath(`/collections/${collectionId}`);
  return { success: true };
}
