import { notFound } from "next/navigation";
import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";
import { authOptions } from "@/lib/auth";
import { getCachedShopName } from "@/lib/cached-data";
import { getCurrentTenantId, getCurrentTenantSlug } from "@/lib/tenant";
import { shapeProducts, fetchImages } from "@/lib/product-shape";
import { enrichProductsWithBestPromoPercent } from "@/lib/enrich-products-promos";
import PublicSidebar from "@/components/layout/PublicSidebar";
import Footer from "@/components/layout/Footer";
import ProductCard from "@/components/produits/ProductCard";
import type { Metadata } from "next";

interface Props {
  params: Promise<{ token: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  await getCurrentTenantId();
  const { token } = await params;
  const catalog = await prisma.catalog.findUnique({ where: { token } });
  if (!catalog) return { title: "Catalogue introuvable" };
  return { title: catalog.title, robots: { index: false, follow: false } };
}

export default async function PublicCatalogPage({ params }: Props) {
  await getCurrentTenantId();
  const { token } = await params;

  const catalog = await prisma.catalog.findUnique({
    where: { token },
    include: {
      products: {
        orderBy: { position: "asc" },
        include: {
          product: {
            include: {
              category:      { select: { name: true } },
              subCategories: { select: { name: true }, take: 1 },
              tags:          { include: { tag: { select: { id: true, name: true } } } },
              colors: {
                where: { disabled: false },
                select: {
                  id:            true,
                  colorId:       true,
                  unitPrice:     true,
                  stock:         true,
                  isPrimary:     true,
                  saleType:      true,
                  packQuantity:  true,
                  color:         { select: { name: true, hex: true, patternImage: true } },
                  variantSizes:  { orderBy: { size: { position: "asc" } }, include: { size: true } },
                },
              },
            },
          },
        },
      },
    },
  });

  if (!catalog || catalog.status !== "ACTIVE") notFound();

  const [shopName, session, tenantSlug] = await Promise.all([
    getCachedShopName(),
    getServerSession(authOptions),
    getCurrentTenantSlug(),
  ]);

  // Charge favoris + remise commerciale client si connecté
  const [favoriteIds, clientDiscount] = await Promise.all([
    session?.user?.id
      ? prisma.favorite.findMany({
          where: { userId: session.user.id },
          select: { productId: true },
        }).then((rows) => rows.map((r) => r.productId))
      : Promise.resolve<string[]>([]),
    session?.user?.id
      ? prisma.user.findUnique({
          where: { id: session.user.id },
          select: { discountType: true, discountValue: true },
        }).then((u) =>
          u?.discountType && u.discountValue
            ? { discountType: u.discountType as "PERCENT" | "AMOUNT", discountValue: Number(u.discountValue) }
            : null,
        )
      : Promise.resolve(null),
  ]);

  // Prépare les produits (ordre du catalogue préservé). On surcharge
  // `primaryColorId` par `selectedColorId` du catalogue pour que la carte
  // s'ouvre sur la couleur épinglée par la vendeuse à la création du catalogue.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawProducts = catalog.products.map(({ product, selectedColorId }) => ({
    ...product,
    primaryColorId: selectedColorId ?? product.primaryColorId,
  })) as any[];

  const imageMap = await fetchImages(rawProducts.map((p) => p.id));
  let products = shapeProducts(rawProducts, imageMap);

  // Applique l'image épinglée par le catalogue (si posée) : elle prime sur
  // la 1ʳᵉ image DB pour la couleur sélectionnée.
  const selectedImageByProduct = new Map(
    catalog.products
      .filter((cp) => cp.selectedImagePath && cp.selectedColorId)
      .map((cp) => [cp.productId, { colorId: cp.selectedColorId!, path: cp.selectedImagePath! }]),
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  products = products.map((p: any) => {
    const pin = selectedImageByProduct.get(p.id);
    if (!pin) return p;
    return {
      ...p,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      colors: p.colors.map((c: any) =>
        c.colorId === pin.colorId ? { ...c, firstImage: pin.path } : c,
      ),
    };
  });

  products = await enrichProductsWithBestPromoPercent(products);

  const productCount = products.length;

  return (
    <div className="min-h-screen bg-white relative">
      <PublicSidebar shopName={shopName} tenantSlug={tenantSlug ?? undefined} />
      <main className="relative z-10">

        {/* Hero éditorial — même mise en page que /produits */}
        <section className="bg-gradient-to-b from-[#fafaf7] to-white">
          <div className="max-w-[1500px] mx-auto px-6 lg:px-10 pt-14 pb-12 lg:pt-24 lg:pb-20">
            <div className="animate-fadeIn">
              <div className="flex items-center gap-4 mb-6 lg:mb-8">
                <span className="inline-block w-10 h-px bg-black" />
                <span className="text-[11px] font-medium uppercase tracking-[0.32em] text-neutral-500 font-body">
                  Catalogue
                </span>
              </div>
              <h1 className="font-heading font-light text-4xl md:text-6xl lg:text-[84px] leading-[0.95] tracking-tight text-black max-w-4xl">
                {catalog.title}
              </h1>
              <p className="mt-6 lg:mt-8 text-neutral-600 max-w-lg leading-relaxed text-[15px] font-body">
                {productCount} produit{productCount > 1 ? "s" : ""} sélectionné{productCount > 1 ? "s" : ""} pour vous
              </p>
            </div>
          </div>
        </section>

        {/* Grille produits — 4 colonnes desktop (pas de sidebar filtres sur un catalogue) */}
        <section className="max-w-[1500px] mx-auto px-6 lg:px-10 pt-6 lg:pt-10 pb-24">
          {productCount === 0 ? (
            <div className="text-center py-24">
              <p className="text-neutral-500 text-sm font-body">
                Ce catalogue est vide pour le moment.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 auto-rows-fr gap-x-6 gap-y-14 lg:gap-y-16">
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              {products.map((p: any) => (
                <ProductCard
                  key={p.id}
                  id={p.id}
                  name={p.name}
                  reference={p.reference}
                  category={p.category?.name ?? ""}
                  subCategory={p.subCategories?.[0]?.name ?? null}
                  colors={p.colors}
                  tags={(p.tags ?? []).map((tt: { tag: { id: string; name: string } }) => ({ id: tt.tag.id, name: tt.tag.name }))}
                  isFavorite={favoriteIds.includes(p.id)}
                  isBestSeller={!!p.isBestSeller}
                  discountPercent={p.discountPercent}
                  hasAutoPromotion={p.hasAutoPromotion}
                  clientDiscount={clientDiscount}
                />
              ))}
            </div>
          )}
        </section>
      </main>
      <Footer shopName={shopName} />
    </div>
  );
}
