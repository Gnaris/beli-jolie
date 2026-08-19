"use server";

import { getServerSession } from "next-auth";
import { revalidatePath, revalidateTag } from "next/cache";
import { Prisma } from "@prisma/client";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { orderchampPublishProduct } from "@/lib/orderchamp-publish";
import { orderchampUpdateProduct } from "@/lib/orderchamp-update";
import { orderchampRefreshProduct } from "@/lib/orderchamp-refresh";
import {
  orderchampHardDeleteProduct,
  orderchampUnpublishProduct,
} from "@/lib/orderchamp-delete";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    throw new Error("Accès non autorisé.");
  }
}

// ─── Publish / Update / Refresh / Delete ───────────────────────────────────

export async function publishProductToOrderchamp(productId: string) {
  await requireAdmin();
  const res = await orderchampPublishProduct(productId);
  revalidatePath("/admin/produits");
  revalidatePath(`/admin/produits/${productId}/modifier`);
  revalidateTag("products", "default");
  return res;
}

export async function updateProductInOrderchamp(
  productId: string,
  options?: { forceFullSync?: boolean },
) {
  await requireAdmin();
  const res = await orderchampUpdateProduct(productId, options);
  revalidatePath("/admin/produits");
  revalidatePath(`/admin/produits/${productId}/modifier`);
  revalidateTag("products", "default");
  return res;
}

export async function refreshProductOnOrderchamp(productId: string) {
  await requireAdmin();
  const res = await orderchampRefreshProduct(productId);
  revalidatePath("/admin/produits");
  revalidatePath(`/admin/produits/${productId}/modifier`);
  revalidateTag("products", "default");
  return res;
}

export async function deleteProductFromOrderchamp(productId: string) {
  await requireAdmin();
  const p = await prisma.product.findUnique({
    where: { id: productId },
    select: { orderchampProductId: true },
  });
  if (!p?.orderchampProductId) {
    return { success: false, error: "Produit non lié à Orderchamp." };
  }
  const res = await orderchampHardDeleteProduct(p.orderchampProductId);
  if (res.success) {
    await prisma.product.update({
      where: { id: productId },
      data: {
        orderchampProductId: null,
        orderchampLastSyncSnapshot: Prisma.DbNull,
        orderchampSyncRequired: false,
      },
    });
  }
  revalidatePath("/admin/produits");
  revalidatePath(`/admin/produits/${productId}/modifier`);
  revalidateTag("products", "default");
  return res;
}

export async function unpublishProductOnOrderchamp(productId: string) {
  await requireAdmin();
  const p = await prisma.product.findUnique({
    where: { id: productId },
    select: { orderchampProductId: true },
  });
  if (!p?.orderchampProductId) {
    return { success: false, error: "Produit non lié à Orderchamp." };
  }
  const res = await orderchampUnpublishProduct(p.orderchampProductId);
  revalidatePath("/admin/produits");
  revalidatePath(`/admin/produits/${productId}/modifier`);
  revalidateTag("products", "default");
  return res;
}

// ─── Unlink (pour setProductMarketplaceEnabled + UI badges) ────────────────

/**
 * Efface le lien local `Product.orderchampProductId` + `ProductColor.orderchampVariantId`
 * SANS toucher la fiche côté Orderchamp. Utilisé quand l'admin décoche
 * « Orderchamp activée » sur un produit avec l'option unlink.
 */
export async function removeOrderchampMatch(
  productId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAdmin();
    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: {
        id: true,
        orderchampProductId: true,
        colors: { select: { id: true, orderchampVariantId: true } },
      },
    });
    if (!product) return { success: false, error: "Produit introuvable." };
    if (!product.orderchampProductId) return { success: true }; // idempotent

    await prisma.$transaction(async (tx) => {
      await tx.product.update({
        where: { id: productId },
        data: {
          orderchampProductId: null,
          orderchampLastSyncSnapshot: Prisma.DbNull,
          orderchampLastRefreshedAt: null,
          orderchampSyncRequired: false,
        },
      });
      for (const c of product.colors) {
        if (c.orderchampVariantId) {
          await tx.productColor.update({
            where: { id: c.id },
            data: { orderchampVariantId: null },
          });
        }
      }
    });

    logger.info("[Orderchamp] Lien local effacé", { productId });
    revalidatePath("/admin/produits");
    revalidatePath(`/admin/produits/${productId}/modifier`);
    revalidateTag("products", "default");
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Erreur inconnue" };
  }
}
