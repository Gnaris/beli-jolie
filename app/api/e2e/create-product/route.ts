/**
 * E2E helper: create a complete product for testing.
 * Only available in development.
 */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createProduct } from "@/app/actions/admin/products";

export async function POST(req: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not available in production" }, { status: 403 });
  }

  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { reference } = await req.json();

    // Get first available category, color, composition
    const [category, color, composition] = await Promise.all([
      prisma.category.findFirst({ select: { id: true } }),
      prisma.color.findFirst({ select: { id: true, name: true } }),
      prisma.composition.findFirst({ select: { id: true } }),
    ]);

    if (!category || !color || !composition) {
      return NextResponse.json({
        success: false,
        error: "Missing base data (category/color/composition)",
      }, { status: 400 });
    }

    const result = await createProduct({
      name: `E2E Test Product ${reference}`,
      reference: reference,
      description: "Produit de test E2E pour verification sync Ankorstore. Description suffisamment longue.",
      categoryId: category.id,
      subCategoryIds: [],
      status: "OFFLINE",
      isIncomplete: false,
      skipPfsSync: true,
      isBestSeller: false,
      colors: [{
        colorId: color.id,
        saleType: "UNIT",
        stock: 10,
        unitPrice: 15.00,
        weight: 0.1,
        isPrimary: true,
        packQuantity: null,
        subColorIds: [],
        sizeEntries: [],
        packColorLines: [],
        discountType: null,
        discountValue: null,
      }],
      imagePaths: [],
      compositions: [{ compositionId: composition.id, percentage: 100 }],
      tagNames: [],
      similarProductIds: [],
      bundleChildIds: [],
      manufacturingCountryId: null,
      seasonId: null,
      translations: [],
      dimensionLength: null,
      dimensionWidth: null,
      dimensionHeight: null,
      dimensionDiameter: null,
      dimensionCircumference: null,
    });

    return NextResponse.json({ success: true, productId: result.id });
  } catch (e) {
    return NextResponse.json({
      success: false,
      error: e instanceof Error ? e.message : String(e),
    }, { status: 500 });
  }
}
