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

  const [product, categories, colors] = await Promise.all([
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
      },
    }),
    prisma.category.findMany({
      orderBy: { name: "asc" },
      include: { subCategories: { orderBy: { name: "asc" } } },
    }),
    prisma.color.findMany({ orderBy: { name: "asc" } }),
  ]);

  if (!product) notFound();

  // Transformer les données DB en ColorState pour ProductForm
  const initialColors: ColorState[] = product.colors.map((pc) => ({
    tempId:       uid(),
    colorId:      pc.colorId,
    colorName:    pc.color.name,
    colorHex:     pc.color.hex ?? "#B8A48A",
    unitPrice:    String(pc.unitPrice),
    weight:       String(pc.weight),
    isPrimary:    pc.isPrimary,
    saleOptions:  pc.saleOptions.map((opt) => ({
      tempId:        uid(),
      saleType:      opt.saleType,
      packQuantity:  opt.packQuantity != null ? String(opt.packQuantity) : "",
      stock:         String(opt.stock),
      discountType:  (opt.discountType ?? "") as "" | "PERCENT" | "AMOUNT",
      discountValue: opt.discountValue != null ? String(opt.discountValue) : "",
    })),
    imagePreviews: pc.images.map((img) => img.path),
    imageFiles:    [],
    uploadedPaths: pc.images.map((img) => img.path),
    uploading:     false,
  }));

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <div className="flex items-center gap-2 text-sm font-[family-name:var(--font-roboto)] text-[#B8A48A] mb-1">
          <Link href="/admin/produits" className="hover:text-[#8B7355] transition-colors">Produits</Link>
          <span>/</span>
          <span className="text-[#6B5B45] truncate max-w-xs">{product.name}</span>
          <span>/</span>
          <span className="text-[#6B5B45]">Modifier</span>
        </div>
        <h1 className="font-[family-name:var(--font-poppins)] text-2xl font-semibold text-[#2C2418]">
          Modifier le produit
        </h1>
        <p className="text-sm text-[#B8A48A] font-[family-name:var(--font-roboto)] mt-0.5">
          Réf. <span className="font-mono">{product.reference}</span>
        </p>
      </div>

      <ProductForm
        categories={categories}
        availableColors={colors.map((c) => ({ id: c.id, name: c.name, hex: c.hex }))}
        mode="edit"
        productId={product.id}
        initialData={{
          reference:    product.reference,
          name:         product.name,
          description:  product.description,
          composition:  product.composition,
          categoryId:   product.categoryId,
          subCategoryId: product.subCategoryId ?? "",
          colors:       initialColors,
        }}
      />
    </div>
  );
}
