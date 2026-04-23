import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import ProductForm from "@/components/admin/products/ProductForm";
import type { VariantState, ColorImageState } from "@/components/admin/products/ColorVariantManager";
import { ProductEditWrapper } from "@/components/admin/products/ProductEditWrapper";
import type { ProductFormHeaderState, StockState } from "@/components/admin/products/ProductFormHeaderContext";
import { DraftPageWrapper, DraftPageToggle } from "./DraftPageWrapper";
import { ProductEditRefreshButton } from "@/components/admin/products/ProductEditRefreshButton";

export const metadata: Metadata = { title: "Modifier le produit" };
export const dynamic = "force-dynamic";

function uid() {
  return Math.random().toString(36).slice(2, 9);
}

export default async function ModifierProduitPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [product, existingTranslations, colorImagesDb] = await Promise.all([
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
            subColors: {
              orderBy: { position: "asc" },
              include: { color: true },
            },
            variantSizes: {
              orderBy: { size: { position: "asc" } },
              include: { size: true },
            },
          },
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
        tags:            { include: { tag: true } },
      },
    }),
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

  const isDraft = product.isIncomplete && product.status === "OFFLINE";

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

  const initialVariants: VariantState[] = product.colors.map((pc) => ({
    tempId:        uid(),
    dbId:          pc.id,
    colorId:       pc.colorId ?? "",
    colorName:     pc.color?.name ?? "",
    colorHex:      pc.color?.hex ?? "#9CA3AF",
    subColors:     pc.subColors.map((sc) => ({
      colorId:   sc.colorId,
      colorName: sc.color.name,
      colorHex:  sc.color.hex ?? "#9CA3AF",
    })),
    sizeEntries:   pc.variantSizes.map((vs) => ({
      tempId:       uid(),
      sizeId:       vs.sizeId,
      sizeName:     vs.size.name,
      quantity:     String(vs.quantity),
      pricePerUnit: vs.pricePerUnit != null ? String(vs.pricePerUnit) : undefined,
    })),
    unitPrice:     (() => {
      if (pc.saleType === "PACK") {
        const totalQty = pc.variantSizes.reduce((sum, vs) => sum + vs.quantity, 0);
        if (totalQty > 0) return String(Math.round(Number(pc.unitPrice) / totalQty * 100) / 100);
      }
      return String(pc.unitPrice);
    })(),
    weight:        String(pc.weight),
    stock:         String(pc.stock ?? 0),
    isPrimary:     pc.isPrimary,
    saleType:      pc.saleType,
    packQuantity:  pc.packQuantity != null ? String(pc.packQuantity) : "",
    sku:           pc.sku ?? "",
    disabled:      pc.disabled ?? false,
    pfsColorRef:   pc.pfsColorRef ?? "",
  }));

  function editGroupKey(pc: {
    id: string; colorId: string | null;
    subColors: { colorId: string; color: { name: string } }[];
  }): string {
    if (!pc.colorId) return "";
    if (pc.subColors.length === 0) return pc.colorId;
    return `${pc.colorId}::${pc.subColors.map(sc => sc.colorId).join(",")}`;
  }

  const dbIdToGroupKey = new Map<string, string>();
  for (const pc of product.colors) {
    dbIdToGroupKey.set(pc.id, editGroupKey(pc));
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
      const allNames = colorMeta
        ? [colorMeta.color?.name ?? img.colorId, ...colorMeta.subColors.map((sc) => sc.color.name)]
        : [img.colorId];
      const displayHex = colorMeta?.color?.hex ?? "#9CA3AF";
      colorImageMap.set(gk, {
        groupKey:      gk,
        colorId:       img.colorId,
        colorName:     allNames.join(" / "),
        colorHex:      displayHex,
        imagePreviews: [],
        uploadedPaths: [],
        orders:        [],
        uploading:     false,
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

  const initialProductStatus = (product.status === "SYNCING" ? "OFFLINE" : product.status) as "OFFLINE" | "ONLINE" | "ARCHIVED";
  const variantsWithStock = product.colors.filter(c => c.stock !== null && c.stock !== undefined);
  const outOfStockCount = variantsWithStock.filter(c => c.stock === 0).length;
  const initialStockState: StockState =
    variantsWithStock.length > 0 && outOfStockCount === variantsWithStock.length ? "all_out" :
    outOfStockCount > 0 ? "partial_out" : "ok";
  const initialIsIncomplete =
    !product.reference?.trim() || !product.name?.trim() ||
    !product.description?.trim() || !product.categoryId ||
    product.compositions.length === 0 || product.colors.length === 0;
  const initialHeaderState: ProductFormHeaderState = {
    productStatus: initialProductStatus,
    isIncomplete: initialIsIncomplete,
    stockState: initialStockState,
  };

  if (isDraft) {
    return (
      <DraftPageWrapper>
      <div className="max-w-[1600px] mx-auto space-y-8">
        <div>
          <nav className="flex items-center gap-1.5 text-[13px] font-body text-text-muted mb-3">
            <Link href="/admin/produits" className="hover:text-text-primary transition-colors">Produits</Link>
            <svg className="w-3.5 h-3.5 text-text-muted/50" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
            <span className="text-text-secondary font-medium truncate max-w-xs">{product.name || "Brouillon"}</span>
            <svg className="w-3.5 h-3.5 text-text-muted/50" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
            <span className="text-text-secondary">Continuer</span>
          </nav>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="page-title">Continuer le brouillon</h1>
              {product.reference && (
                <p className="text-base text-text-muted font-body mt-1">
                  Réf. <span className="font-mono font-semibold text-text-secondary">{product.reference}</span>
                </p>
              )}
            </div>
            <DraftPageToggle />
          </div>
        </div>

        <ProductForm
          mode="create"
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
            tagNames:          product.tags.map((t) => t.tag.name),
            isBestSeller:      product.isBestSeller,
            status:            product.status,
            translations:      existingTranslations,
            dimLength:        product.dimensionLength != null ? String(product.dimensionLength) : "",
            dimWidth:         product.dimensionWidth != null ? String(product.dimensionWidth) : "",
            dimHeight:        product.dimensionHeight != null ? String(product.dimensionHeight) : "",
            dimDiameter:      product.dimensionDiameter != null ? String(product.dimensionDiameter) : "",
            dimCircumference: product.dimensionCircumference != null ? String(product.dimensionCircumference) : "",
            manufacturingCountryId: product.manufacturingCountryId ?? "",
            seasonId: product.seasonId ?? "",
            discountPercent: product.discountPercent != null ? String(product.discountPercent) : "",
          }}
        />
      </div>
      </DraftPageWrapper>
    );
  }

  return (
    <ProductEditWrapper
      initial={initialHeaderState}
      staticHeader={
        <>
          <nav className="flex items-center gap-1.5 text-[13px] font-body text-text-muted mb-3">
            <Link href="/admin/produits" className="hover:text-text-primary transition-colors">Produits</Link>
            <svg className="w-3.5 h-3.5 text-text-muted/50" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
            <span className="text-text-secondary font-medium truncate max-w-xs">{product.name}</span>
            <svg className="w-3.5 h-3.5 text-text-muted/50" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
            <span className="text-text-secondary">Modifier</span>
          </nav>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="page-title">Modifier le produit</h1>
              <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                <span className="inline-flex items-center gap-1.5 font-mono text-[11px] bg-bg-tertiary px-2.5 py-1 rounded-md text-text-secondary border border-border-light font-semibold">
                  {product.reference}
                </span>
                <span className="hidden sm:block h-4 w-px bg-border" />
                <p className="text-[11px] text-text-muted font-body">
                  Créé le{" "}
                  <span className="text-text-secondary font-medium">
                    {product.createdAt.toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" })}
                  </span>
                </p>
                <span className="hidden sm:block h-4 w-px bg-border" />
                <p className="text-[11px] text-text-muted font-body">
                  Modifié le{" "}
                  <span className="text-text-secondary font-medium">
                    {product.updatedAt.toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </span>
                </p>
                {product.lastRefreshedAt && (
                  <>
                    <span className="hidden sm:block h-4 w-px bg-border" />
                    <p className="inline-flex items-center gap-1 text-[11px] text-[#4F46E5] font-body">
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M20.015 4.356v4.992" />
                      </svg>
                      Rafraîchi le{" "}
                      <span className="font-medium">
                        {product.lastRefreshedAt.toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </p>
                  </>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <ProductEditRefreshButton
                productId={product.id}
                reference={product.reference}
                productName={product.name}
                firstImage={colorImagesDb[0]?.path ?? null}
              />
              <Link
                href={`/produits/${product.id}`}
                target="_blank"
                className="inline-flex items-center gap-2 px-3.5 py-2 text-[13px] font-medium text-text-secondary bg-bg-primary border border-border rounded-xl hover:border-border-dark hover:text-text-primary transition-all font-body shadow-sm"
                title="Voir côté client"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                Voir
              </Link>
            </div>
          </div>
        </>
      }
    >
      <ProductForm
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
          tagNames:          product.tags.map((t) => t.tag.name),
          isBestSeller:      product.isBestSeller,
          status:            product.status,
          translations:      existingTranslations,
          dimLength:        product.dimensionLength != null ? String(product.dimensionLength) : "",
          dimWidth:         product.dimensionWidth != null ? String(product.dimensionWidth) : "",
          dimHeight:        product.dimensionHeight != null ? String(product.dimensionHeight) : "",
          dimDiameter:      product.dimensionDiameter != null ? String(product.dimensionDiameter) : "",
          dimCircumference: product.dimensionCircumference != null ? String(product.dimensionCircumference) : "",
          manufacturingCountryId: product.manufacturingCountryId ?? "",
          seasonId: product.seasonId ?? "",
          discountPercent: product.discountPercent != null ? String(product.discountPercent) : "",
        }}
      />
    </ProductEditWrapper>
  );
}
