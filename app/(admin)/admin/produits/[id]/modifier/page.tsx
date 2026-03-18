import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import ProductForm from "@/components/admin/products/ProductForm";
import type { VariantState, ColorImageState } from "@/components/admin/products/ColorVariantManager";

export const metadata: Metadata = { title: "Modifier le produit" };

function uid() {
  return Math.random().toString(36).slice(2, 9);
}

export default async function ModifierProduitPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [product, categories, colors, compositions, allProducts, tags, existingTranslations, colorImagesDb] = await Promise.all([
    prisma.product.findUnique({
      where: { id },
      include: {
        colors: {
          orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
          include: { color: true },
        },
        compositions: {
          include: { composition: true },
          orderBy:  { percentage: "desc" },
        },
        subCategories:   { select: { id: true } },
        similarProducts: {
          include: {
            similar: {
              select: {
                id: true,
                name: true,
                reference: true,
                category: { select: { name: true } },
                colors: {
                  orderBy: { isPrimary: "desc" },
                  take: 1,
                },
              },
            },
          },
        },
        tags:            { include: { tag: true } },
      },
    }),
    prisma.category.findMany({
      orderBy: { name: "asc" },
      include: { subCategories: { orderBy: { name: "asc" } } },
    }),
    prisma.color.findMany({ orderBy: { name: "asc" } }),
    prisma.composition.findMany({ orderBy: { name: "asc" } }),
    prisma.product.findMany({
      orderBy: { name: "asc" },
      select:  { id: true, name: true, reference: true },
    }),
    prisma.tag.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.productTranslation.findMany({
      where:  { productId: id },
      select: { locale: true, name: true, description: true },
    }),
    prisma.productColorImage.findMany({
      where:   { productId: id },
      orderBy: { order: "asc" },
    }),
  ]);

  if (!product) notFound();

  // Map ProductColor rows → flat VariantState[]
  const initialVariants: VariantState[] = product.colors.map((pc) => ({
    tempId:        uid(),
    dbId:          pc.id,
    colorId:       pc.colorId,
    colorName:     pc.color.name,
    colorHex:      pc.color.hex ?? "#9CA3AF",
    unitPrice:     String(pc.unitPrice),
    weight:        String(pc.weight),
    stock:         String(pc.stock ?? 0),
    isPrimary:     pc.isPrimary,
    saleType:      pc.saleType,
    packQuantity:  pc.packQuantity != null ? String(pc.packQuantity) : "",
    size:          pc.size ?? "",
    discountType:  (pc.discountType ?? "") as "" | "PERCENT" | "AMOUNT",
    discountValue: pc.discountValue != null ? String(pc.discountValue) : "",
  }));

  // Group ProductColorImage by unique colorId → ColorImageState[]
  const colorImageMap = new Map<string, ColorImageState>();
  for (const img of colorImagesDb) {
    if (!colorImageMap.has(img.colorId)) {
      const colorMeta = product.colors.find((pc) => pc.colorId === img.colorId);
      colorImageMap.set(img.colorId, {
        colorId:       img.colorId,
        colorName:     colorMeta?.color.name ?? img.colorId,
        colorHex:      colorMeta?.color.hex ?? "#9CA3AF",
        imagePreviews: [],
        uploadedPaths: [],
        uploading:     false,
      });
    }
    const entry = colorImageMap.get(img.colorId)!;
    entry.imagePreviews.push(img.path);
    entry.uploadedPaths.push(img.path);
  }
  const initialColorImages: ColorImageState[] = [...colorImageMap.values()];

  return (
    <div className="max-w-[1600px] mx-auto space-y-8">
      <div>
        <div className="flex items-center gap-2 text-sm font-[family-name:var(--font-roboto)] text-text-muted mb-2">
          <Link href="/admin/produits" className="hover:text-text-primary transition-colors">Produits</Link>
          <span>/</span>
          <span className="text-text-secondary truncate max-w-xs">{product.name}</span>
          <span>/</span>
          <span className="text-text-secondary">Modifier</span>
        </div>
        <h1 className="page-title">
          Modifier le produit
        </h1>
        <p className="text-base text-text-muted font-[family-name:var(--font-roboto)] mt-1">
          Réf. <span className="font-mono font-semibold text-text-secondary">{product.reference}</span>
        </p>
      </div>

      <ProductForm
        categories={categories}
        availableColors={colors.map((c) => ({ id: c.id, name: c.name, hex: c.hex }))}
        availableCompositions={compositions.map((c) => ({ id: c.id, name: c.name }))}
        allProducts={allProducts.filter((p) => p.id !== id)}
        availableTags={tags}
        mode="edit"
        productId={product.id}
        initialData={{
          reference:         product.reference,
          name:              product.name,
          description:       product.description,
          categoryId:        product.categoryId,
          subCategoryIds:    product.subCategories.map((sc) => sc.id),
          variants:          initialVariants,
          colorImages:       initialColorImages,
          compositions:      product.compositions.map((c) => ({
            compositionId: c.compositionId,
            percentage:    String(c.percentage),
          })),
          similarProductIds: product.similarProducts.map((sp) => sp.similar.id),
          similarProducts: product.similarProducts.map((sp) => ({
            id: sp.similar.id,
            name: sp.similar.name,
            reference: sp.similar.reference,
            category: sp.similar.category.name,
            image: null,
          })),
          tagNames:          product.tags.map((t) => t.tag.name),
          isBestSeller:      product.isBestSeller,
          status:            product.status,
          translations:      existingTranslations,
          dimLength:        product.dimensionLength != null ? String(product.dimensionLength) : "",
          dimWidth:         product.dimensionWidth != null ? String(product.dimensionWidth) : "",
          dimHeight:        product.dimensionHeight != null ? String(product.dimensionHeight) : "",
          dimDiameter:      product.dimensionDiameter != null ? String(product.dimensionDiameter) : "",
          dimCircumference: product.dimensionCircumference != null ? String(product.dimensionCircumference) : "",
        }}
      />
    </div>
  );
}
