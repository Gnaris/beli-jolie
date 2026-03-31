import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ensureEfashionAuth } from "@/lib/efashion-auth";
import {
  efashionGetProduct,
  efashionGetProductColors,
  efashionGetProductDescription,
  efashionGetProductStocks,
} from "@/lib/efashion-api";
import { logger } from "@/lib/logger";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ productId: string }> }
) {
  try {
    await requireAdmin();
    const { productId } = await params;

    // Load BJ product
    const product = await prisma.product.findUnique({
      where: { id: productId },
      include: {
        category: true,
        colors: { include: { color: true, sizes: true } },
        translations: true,
      },
    });

    if (!product)
      return NextResponse.json(
        { error: "Produit non trouvé" },
        { status: 404 }
      );

    if (!product.efashionProductId)
      return NextResponse.json({
        exists: false,
        product: {
          id: product.id,
          name: product.name,
          reference: product.reference,
        },
      });

    // Fetch eFashion state
    await ensureEfashionAuth();
    const efashionId = product.efashionProductId;

    const [efProduct, efColors, efDesc, efStocks] = await Promise.all([
      efashionGetProduct(efashionId).catch(() => null),
      efashionGetProductColors(efashionId).catch(() => []),
      efashionGetProductDescription(efashionId).catch(() => null),
      efashionGetProductStocks(efashionId).catch(() => []),
    ]);

    if (!efProduct)
      return NextResponse.json({
        exists: false,
        error: "Produit non trouvé sur eFashion",
      });

    // Build differences
    const differences: Record<string, { bj: unknown; efashion: unknown }> = {};

    const bjPrice = product.colors[0]?.unitPrice || 0;
    const efPrice = parseFloat(efProduct.prix);
    if (Math.abs(bjPrice - efPrice) > 0.01) {
      differences.price = { bj: bjPrice, efashion: efPrice };
    }

    const bjName = product.name;
    const efName = efDesc?.texte_fr || "";
    if (bjName !== efName && efName) {
      differences.name = { bj: bjName, efashion: efName };
    }

    const bjVisible = product.status === "ONLINE";
    const efVisible = efProduct.visible;
    if (bjVisible !== efVisible) {
      differences.visible = { bj: bjVisible, efashion: efVisible };
    }

    // Compare color count
    const bjColorCount = product.colors.length;
    const efColorCount = Array.isArray(efColors) ? efColors.length : 0;
    if (bjColorCount !== efColorCount) {
      differences.colors = { bj: bjColorCount, efashion: efColorCount };
    }

    // Compare total stock
    const bjStock = product.colors.reduce(
      (sum, c) => sum + c.sizes.reduce((s, sz) => s + (sz.stock || 0), 0),
      0
    );
    const efStock = Array.isArray(efStocks)
      ? efStocks.reduce((sum, s) => sum + (s.value || 0), 0)
      : 0;
    if (bjStock !== efStock) {
      differences.stock = { bj: bjStock, efashion: efStock };
    }

    return NextResponse.json({
      exists: true,
      efashionProductId: efashionId,
      differences,
      hasDifferences: Object.keys(differences).length > 0,
      bjProduct: {
        id: product.id,
        name: product.name,
        reference: product.reference,
        status: product.status,
      },
      efashionProduct: {
        id_produit: efProduct.id_produit,
        reference: efProduct.reference,
        visible: efProduct.visible,
        prix: efProduct.prix,
      },
    });
  } catch (error) {
    logger.error("[eFashion Live Check] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erreur" },
      { status: 500 }
    );
  }
}
