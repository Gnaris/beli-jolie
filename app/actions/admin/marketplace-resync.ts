"use server";

import { getServerSession } from "next-auth";
import { revalidatePath, revalidateTag } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { pfsUpdateProductInPlace } from "@/lib/pfs-update";
import { emitProductEvent } from "@/lib/product-events";
import { logger } from "@/lib/logger";
import type { MarketplacePublishOutcome } from "./marketplace-publish";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    throw new Error("Accès non autorisé.");
  }
}

export async function resyncProductOnPfs(
  productId: string,
): Promise<MarketplacePublishOutcome> {
  await requireAdmin();

  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: {
      id: true,
      reference: true,
      name: true,
      status: true,
      pfsProductId: true,
    },
  });

  if (!product) {
    throw new Error("Produit introuvable.");
  }

  const outcome: MarketplacePublishOutcome = {
    productId,
    reference: product.reference,
    productName: product.name,
  };

  if (!product.pfsProductId) {
    outcome.pfs = {
      status: "error",
      message: "Produit non publié sur Paris Fashion Shop.",
    };
    return outcome;
  }

  try {
    const res = await pfsUpdateProductInPlace(productId, undefined, {
      skipRevalidation: true,
      forceFullSync: true,
    });
    if (res.success) {
      outcome.pfs = { status: "ok", mode: "update", archived: res.archived };
    } else {
      outcome.pfs = { status: "error", message: res.error };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("[PFS Resync] unexpected error", { productId, error: message });
    outcome.pfs = { status: "error", message };
  }

  revalidatePath("/admin/produits");
  revalidatePath(`/admin/produits/${productId}/modifier`);
  revalidatePath(`/produits/${productId}`);
  revalidatePath("/produits");
  revalidateTag("products", "default");

  if (product.status === "ONLINE") {
    emitProductEvent({ type: "PRODUCT_UPDATED", productId });
  }

  return outcome;
}
