import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import ProductForm from "@/components/admin/products/ProductForm";
import type { VariantState, ColorImageState } from "@/components/admin/products/ColorVariantManager";
import { getCachedPfsEnabled, getCachedSiteConfig } from "@/lib/cached-data";

export const metadata: Metadata = { title: "Dupliquer le produit" };
export const dynamic = "force-dynamic";

function uid() {
  return Math.random().toString(36).slice(2, 9);
}

export default async function DupliquerProduitPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [product, existingTranslations, colorImagesDb, hasPfsConfig, ankorsEnabled] = await Promise.all([
    prisma.product.findUnique({
      where: { id },
      include: {
        category: true,
        manufacturingCountry: true,
        season: true,
        colors: {
          orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
          include: {
            color: true,
            variantSizes: {
              orderBy: { size: { position: "asc" } },
              include: { size: true },
            },
            packLines: {
              orderBy: { position: "asc" },
              include: {
                color: true,
                sizes: {
                  orderBy: { size: { position: "asc" } },
                  include: { size: true },
                },
              },
            },
          },
        },
        compositions: {
          include: { composition: true },
          orderBy: { percentage: "desc" },
        },
        subCategories: { select: { id: true } },
        similarProducts: {
          include: {
            similar: {
              select: {
                id: true,
                name: true,
                reference: true,
                category: { select: { name: true } },
                colors: { select: { unitPrice: true } },
              },
            },
          },
        },
        bundleChildren: {
          include: {
            child: {
              select: {
                id: true,
                name: true,
                reference: true,
                category: { select: { name: true } },
                colors: { select: { unitPrice: true } },
              },
            },
          },
        },
        bundleParents: {
          include: {
            parent: {
              select: {
                id: true,
                name: true,
                reference: true,
                category: { select: { name: true } },
                colors: { select: { unitPrice: true } },
              },
            },
          },
        },
        tags: { include: { tag: true } },
      },
    }),
    prisma.productTranslation.findMany({
      where: { productId: id },
      select: { locale: true, name: true, description: true },
    }),
    prisma.productColorImage.findMany({
      where: { productId: id },
      orderBy: { order: "asc" },
    }),
    getCachedPfsEnabled(),
    getCachedSiteConfig("ankors_enabled"),
  ]);

  if (!product) notFound();

  const relatedIds = [
    ...product.similarProducts.map((sp) => sp.similar.id),
    ...product.bundleChildren.map((b) => b.child.id),
    ...product.bundleParents.map((b) => b.parent.id),
  ];
  const relatedFirstImages = relatedIds.length > 0
    ? await prisma.productColorImage.findMany({
        where: { productId: { in: relatedIds } },
        orderBy: { order: "asc" },
      })
    : [];
  const relatedImageMap = new Map<string, string>();
  for (const img of relatedFirstImages) {
    if (!relatedImageMap.has(img.productId)) relatedImageMap.set(img.productId, img.path);
  }

  // Build variants WITHOUT dbId so a new product is created
  const initialVariants: VariantState[] = product.colors.map((pc) => {
    const hasPackLines = pc.saleType === "PACK" && pc.packLines.length > 0;
    const packLines = hasPackLines
      ? pc.packLines.map((line) => ({
          tempId: uid(),
          colorId: line.colorId,
          colorName: line.color?.name ?? "",
          colorHex: line.color?.hex ?? "#9CA3AF",
          sizeEntries: line.sizes.map((ls) => ({
            tempId: uid(),
            sizeId: ls.sizeId,
            sizeName: ls.size.name,
            quantity: String(ls.quantity),
          })),
        }))
      : [];
    const totalPackQty = hasPackLines
      ? packLines.reduce((s, l) => s + l.sizeEntries.reduce((a, e) => a + (parseInt(e.quantity) || 0), 0), 0)
      : pc.variantSizes.reduce((sum, vs) => sum + vs.quantity, 0);
    return {
      tempId: uid(),
      // No dbId — this is a new product
      colorId: pc.colorId ?? "",
      colorName: pc.color?.name ?? "",
      colorHex: pc.color?.hex ?? "#9CA3AF",
      sizeEntries: pc.variantSizes.map((vs) => ({
        tempId: uid(),
        sizeId: vs.sizeId,
        sizeName: vs.size.name,
        quantity: String(vs.quantity),
        pricePerUnit: vs.pricePerUnit != null ? String(vs.pricePerUnit) : undefined,
      })),
      packLines,
      unitPrice: (() => {
        if (pc.saleType === "PACK") {
          if (totalPackQty > 0) return String(Math.round(Number(pc.unitPrice) / totalPackQty * 100) / 100);
        }
        return String(pc.unitPrice);
      })(),
      weight: String(pc.weight),
      stock: String(pc.stock ?? 0),
      isPrimary: pc.isPrimary,
      saleType: pc.saleType,
      packQuantity: pc.packQuantity != null ? String(pc.packQuantity) : "",
      sku: "",
      disabled: false,
    };
  });

  // Build color images from existing product
  const dbIdToGroupKey = new Map<string, string>();
  for (const pc of product.colors) {
    dbIdToGroupKey.set(pc.id, pc.colorId ?? "");
  }

  const colorImageMap = new Map<string, ColorImageState>();
  for (const img of colorImagesDb) {
    const pcId = img.productColorId ?? img.colorId;
    const gk = dbIdToGroupKey.get(pcId) ?? img.colorId;
    if (!gk) continue;
    if (!colorImageMap.has(gk)) {
      const colorMeta = img.productColorId
        ? product.colors.find((pc) => pc.id === img.productColorId)
        : product.colors.find((pc) => pc.colorId === img.colorId);
      const displayName = colorMeta?.color?.name ?? img.colorId;
      const displayHex = colorMeta?.color?.hex ?? "#9CA3AF";
      colorImageMap.set(gk, {
        groupKey: gk,
        colorId: img.colorId,
        colorName: displayName,
        colorHex: displayHex,
        imagePreviews: [],
        uploadedPaths: [],
        orders: [],
        uploading: false,
      });
    }
    const entry = colorImageMap.get(gk)!;
    if (!entry.uploadedPaths.includes(img.path)) {
      entry.imagePreviews.push(img.path);
      entry.uploadedPaths.push(img.path);
      entry.orders.push(img.order);
    }
  }
  const initialColorImages: ColorImageState[] = [...colorImageMap.values()];

  return (
    <div className="max-w-[1600px] mx-auto space-y-8">
      <div>
        <nav className="flex items-center gap-1.5 text-[13px] font-body text-text-muted mb-3">
          <Link href="/admin/produits" className="hover:text-text-primary transition-colors">Produits</Link>
          <svg className="w-3.5 h-3.5 text-text-muted/50" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
          <span className="text-text-secondary font-medium truncate max-w-xs">{product.name}</span>
          <svg className="w-3.5 h-3.5 text-text-muted/50" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
          <span className="text-text-secondary">Dupliquer</span>
        </nav>
        <div>
          <h1 className="page-title">Dupliquer le produit</h1>
          <p className="text-sm text-text-muted font-body mt-1">
            Copie de <span className="font-semibold text-text-secondary">{product.name}</span> (réf. <span className="font-mono font-semibold text-text-secondary">{product.reference}</span>). Saisissez une nouvelle référence.
          </p>
        </div>
      </div>

      <ProductForm
        mode="create"
        hasPfsConfig={hasPfsConfig}
        hasAnkorstoreConfig={ankorsEnabled?.value === "true"}
        initialData={{
          reference: "",
          name: product.name,
          description: product.description,
          categoryId: product.categoryId,
          subCategoryIds: product.subCategories.map((sc) => sc.id),
          variants: initialVariants,
          colorImages: initialColorImages,
          compositions: product.compositions.map((c) => ({
            compositionId: c.compositionId,
            percentage: String(c.percentage),
          })),
          similarProductIds: product.similarProducts.map((sp) => sp.similar.id),
          similarProducts: product.similarProducts.map((sp) => ({
            id: sp.similar.id,
            name: sp.similar.name,
            reference: sp.similar.reference,
            category: sp.similar.category.name,
            image: relatedImageMap.get(sp.similar.id) ?? null,
            maxPrice: sp.similar.colors.length > 0 ? Math.max(...sp.similar.colors.map((c) => Number(c.unitPrice))) : 0,
          })),
          bundleChildIds: product.bundleChildren.map((b) => b.child.id),
          bundleChildren: product.bundleChildren.map((b) => ({
            id: b.child.id,
            name: b.child.name,
            reference: b.child.reference,
            category: b.child.category.name,
            image: relatedImageMap.get(b.child.id) ?? null,
            maxPrice: b.child.colors.length > 0 ? Math.max(...b.child.colors.map((c) => Number(c.unitPrice))) : 0,
          })),
          bundleParents: product.bundleParents.map((b) => ({
            id: b.parent.id,
            name: b.parent.name,
            reference: b.parent.reference,
            category: b.parent.category.name,
            image: relatedImageMap.get(b.parent.id) ?? null,
            maxPrice: b.parent.colors.length > 0 ? Math.max(...b.parent.colors.map((c) => Number(c.unitPrice))) : 0,
          })),
          tagNames: product.tags.map((t) => t.tag.name),
          isBestSeller: false,
          translations: existingTranslations,
          dimLength: product.dimensionLength != null ? String(product.dimensionLength) : "",
          dimWidth: product.dimensionWidth != null ? String(product.dimensionWidth) : "",
          dimHeight: product.dimensionHeight != null ? String(product.dimensionHeight) : "",
          dimDiameter: product.dimensionDiameter != null ? String(product.dimensionDiameter) : "",
          dimCircumference: product.dimensionCircumference != null ? String(product.dimensionCircumference) : "",
          manufacturingCountryId: product.manufacturingCountryId ?? "",
          seasonId: product.seasonId ?? "",
          discountPercent: product.discountPercent != null ? String(product.discountPercent) : "",
        }}
      />
    </div>
  );
}
