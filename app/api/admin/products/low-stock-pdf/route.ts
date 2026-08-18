import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth-helpers";
import { generateLowStockPDF } from "@/lib/pdf-low-stock";
import { selectLowStockProducts, LOW_STOCK_THRESHOLD } from "@/lib/low-stock-report";
import { logger } from "@/lib/logger";

/**
 * GET /api/admin/products/low-stock-pdf
 *
 * Génère à la volée un PDF listant tous les produits dont au moins une
 * variante (ProductColor active) a un stock nul ou < 10.
 * Une page par produit — chaque ligne = 1 couleur (palette + nom + stock +
 * image de la couleur).
 */
export async function GET(_req: NextRequest) {
  try {
    await requireAdmin();
  } catch {
    return new NextResponse("Non autorisé", { status: 401 });
  }

  try {
    // Charge uniquement les produits qui ont AU MOINS une variante en alerte
    // (stock < 10 et non désactivée). L'extension prisma-tenant-scope injecte
    // automatiquement tenantId dans le where.
    const productsRaw = await prisma.product.findMany({
      where: {
        status: { not: "ARCHIVED" },
        colors: {
          some: {
            disabled: false,
            stock:    { lt: LOW_STOCK_THRESHOLD },
          },
        },
      },
      orderBy: { reference: "asc" },
      select: {
        id:        true,
        reference: true,
        name:      true,
        category:  { select: { name: true } },
        colors: {
          orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
          select: {
            id:        true,
            colorId:   true,
            stock:     true,
            disabled:  true,
            color:     { select: { name: true, hex: true, patternImage: true } },
          },
        },
      },
    });

    // Récupère la première image de chaque ProductColor concernée
    // (jointure via ProductColorImage sur productId + colorId).
    const productIds = productsRaw.map((p) => p.id);
    const allImages = productIds.length > 0
      ? await prisma.productColorImage.findMany({
          where:   { productId: { in: productIds } },
          orderBy: { order: "asc" },
          select:  { productId: true, colorId: true, path: true },
        })
      : [];
    const firstImageByPair = new Map<string, string>();
    for (const img of allImages) {
      const key = `${img.productId}::${img.colorId}`;
      if (!firstImageByPair.has(key)) firstImageByPair.set(key, img.path);
    }

    const products = productsRaw.map((p) => ({
      id:        p.id,
      reference: p.reference,
      name:      p.name,
      category:  p.category,
      colors: p.colors.map((c) => ({
        id:             c.id,
        colorId:        c.colorId,
        stock:          c.stock,
        disabled:       c.disabled,
        color:          c.color,
        firstImagePath: c.colorId ? firstImageByPair.get(`${p.id}::${c.colorId}`) ?? null : null,
      })),
    }));

    const report = selectLowStockProducts(products);
    const pdfBuffer = await generateLowStockPDF(report);

    const stamp = new Date().toISOString().slice(0, 10);
    return new NextResponse(pdfBuffer as unknown as BodyInit, {
      headers: {
        "Content-Type":        "application/pdf",
        "Content-Disposition": `attachment; filename="stock-faible-${stamp}.pdf"`,
        "Content-Length":      String(pdfBuffer.length),
      },
    });
  } catch (err) {
    logger.error("[low-stock-pdf] Erreur génération PDF", { error: err });
    return new NextResponse("Erreur génération PDF", { status: 500 });
  }
}
