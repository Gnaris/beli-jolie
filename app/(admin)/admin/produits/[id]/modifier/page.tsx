import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import ProductForm from "@/components/admin/products/ProductForm";
import type { ColorState } from "@/components/admin/products/ColorVariantManager";

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

  const [product, categories, colors, compositions, allProducts] = await Promise.all([
    prisma.product.findUnique({
      where: { id },
      include: {
        colors: {
          include: {
            color: true,
            saleOptions: { orderBy: { saleType: "asc" } },
            images:      { orderBy: { order: "asc" } },
          },
        },
        compositions: {
          include: { composition: true },
          orderBy:  { percentage: "desc" },
        },
        subCategories:   { select: { id: true } },
        similarProducts: { select: { similarId: true } },
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
  ]);

  if (!product) notFound();

  const initialColors: ColorState[] = product.colors.map((pc) => ({
    tempId:       uid(),
    colorId:      pc.colorId,
    colorName:    pc.color.name,
    colorHex:     pc.color.hex ?? "#94A3B8",
    unitPrice:    String(pc.unitPrice),
    weight:       String(pc.weight),
    stock:        String((pc as unknown as { stock?: number }).stock ?? pc.saleOptions[0]?.stock ?? 0),
    isPrimary:    pc.isPrimary,
    saleOptions:  pc.saleOptions.map((opt) => ({
      tempId:        uid(),
      saleType:      opt.saleType,
      packQuantity:  opt.packQuantity != null ? String(opt.packQuantity) : "",
      size:          opt.size ?? "",
      discountType:  (opt.discountType ?? "") as "" | "PERCENT" | "AMOUNT",
      discountValue: opt.discountValue != null ? String(opt.discountValue) : "",
    })),
    imagePreviews: pc.images.map((img) => img.path),
    imageFiles:    [],
    uploadedPaths: pc.images.map((img) => img.path),
    uploading:     false,
  }));

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      <div>
        <div className="flex items-center gap-2 text-sm font-[family-name:var(--font-roboto)] text-[#94A3B8] mb-2">
          <Link href="/admin/produits" className="hover:text-[#0F3460] transition-colors">Produits</Link>
          <span>/</span>
          <span className="text-[#475569] truncate max-w-xs">{product.name}</span>
          <span>/</span>
          <span className="text-[#475569]">Modifier</span>
        </div>
        <h1 className="font-[family-name:var(--font-poppins)] text-3xl font-bold text-[#0F172A]">
          Modifier le produit
        </h1>
        <p className="text-base text-[#94A3B8] font-[family-name:var(--font-roboto)] mt-1">
          Réf. <span className="font-mono font-semibold text-[#475569]">{product.reference}</span>
        </p>
      </div>

      <ProductForm
        categories={categories}
        availableColors={colors.map((c) => ({ id: c.id, name: c.name, hex: c.hex }))}
        availableCompositions={compositions.map((c) => ({ id: c.id, name: c.name }))}
        allProducts={allProducts.filter((p) => p.id !== id)}
        mode="edit"
        productId={product.id}
        initialData={{
          reference:         product.reference,
          name:              product.name,
          description:       product.description,
          categoryId:        product.categoryId,
          subCategoryIds:    product.subCategories.map((sc) => sc.id),
          colors:            initialColors,
          compositions:      product.compositions.map((c) => ({
            compositionId: c.compositionId,
            percentage:    String(c.percentage),
          })),
          similarProductIds: product.similarProducts.map((sp) => sp.similarId),
          tagNames:          product.tags.map((t) => t.tag.name),
          isBestSeller:      product.isBestSeller,
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
