import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import type { Metadata } from "next";

interface Props {
  params: Promise<{ token: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { token } = await params;
  const catalog = await prisma.catalog.findUnique({ where: { token } });
  if (!catalog) return { title: "Catalogue introuvable" };
  return { title: catalog.title, robots: { index: false, follow: false } };
}

export default async function PublicCatalogPage({ params }: Props) {
  const { token } = await params;

  const catalog = await prisma.catalog.findUnique({
    where: { token },
    include: {
      products: {
        orderBy: { position: "asc" },
        include: {
          product: {
            include: {
              colorImages: { orderBy: { order: "asc" } },
              colors: {
                where: { saleType: "UNIT" },
                include: {
                  color: { select: { id: true, name: true, hex: true } },
                  subColors: { orderBy: { position: "asc" }, select: { color: { select: { name: true, hex: true } } } },
                },
              },
              category: true,
            },
          },
        },
      },
    },
  });

  if (!catalog || catalog.status !== "PUBLISHED") notFound();

  const primary = catalog.primaryColor;

  return (
    <div className="min-h-screen bg-[#FAFAFA]" style={{ "--catalog-primary": primary } as React.CSSProperties}>

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header
        className="py-8 px-6 text-center relative overflow-hidden"
        style={
          catalog.coverImagePath
            ? { backgroundImage: `url(${catalog.coverImagePath})`, backgroundSize: "cover", backgroundPosition: "center" }
            : { backgroundColor: primary }
        }
      >
        {/* Overlay sombre si photo de fond */}
        {catalog.coverImagePath && (
          <div className="absolute inset-0 bg-black/40" />
        )}
        <div className="relative z-10">
          <p className="text-white/70 text-xs uppercase tracking-widest font-[family-name:var(--font-roboto)] mb-1">
            Beli & Jolie — Catalogue
          </p>
          <h1 className="font-[family-name:var(--font-poppins)] font-bold text-white text-2xl md:text-3xl tracking-tight">
            {catalog.title}
          </h1>
          <p className="text-white/60 text-sm mt-2 font-[family-name:var(--font-roboto)]">
            {catalog.products.length} produit{catalog.products.length !== 1 ? "s" : ""} sélectionné{catalog.products.length !== 1 ? "s" : ""}
          </p>
        </div>
      </header>

      {/* ── Grille produits ──────────────────────────────────────────────── */}
      <main className="max-w-6xl mx-auto px-4 py-10">
        {catalog.products.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-[#9CA3AF] font-[family-name:var(--font-roboto)]">Ce catalogue est vide.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {catalog.products.map(({ product, selectedColorId, selectedImagePath }) => {
              // Variante couleur : selectedColorId en priorité, sinon la primaire
              const variant = selectedColorId
                ? product.colors.find((c) => c.color.id === selectedColorId) ?? product.colors.find((c) => c.isPrimary) ?? product.colors[0]
                : product.colors.find((c) => c.isPrimary) ?? product.colors[0];

              const price = variant?.unitPrice;

              // Image : 1. image spécifique choisie, 2. première image de la couleur, 3. première image du produit
              const image =
                selectedImagePath ??
                (selectedColorId
                  ? product.colorImages.find((img) => img.colorId === selectedColorId)?.path
                  : null) ??
                product.colorImages[0]?.path;

              return (
                <div
                  key={product.id}
                  className="bg-white rounded-2xl overflow-hidden shadow-[0_1px_6px_rgba(0,0,0,0.07)] hover:shadow-[0_4px_18px_rgba(0,0,0,0.12)] hover:-translate-y-0.5 transition-all duration-200"
                >
                  {/* Image */}
                  <div className="relative aspect-[4/5] bg-[#F7F7F8] overflow-hidden">
                    {image ? (
                      <img
                        src={image}
                        alt={product.name}
                        className="w-full h-full object-contain p-2"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <svg className="w-10 h-10 text-[#D1D5DB]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                            d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5z" />
                        </svg>
                      </div>
                    )}
                    {/* Bandeau couleur en bas */}
                    <div
                      className="absolute bottom-0 left-0 right-0 h-0.5"
                      style={{ backgroundColor: primary }}
                    />
                  </div>

                  {/* Infos */}
                  <div className="p-4">
                    <p className="text-[10px] text-[#9CA3AF] uppercase tracking-wider font-[family-name:var(--font-roboto)] mb-1">
                      {product.category.name}
                    </p>
                    <h2 className="font-[family-name:var(--font-poppins)] font-semibold text-[#1A1A1A] text-sm leading-snug line-clamp-2 mb-2">
                      {product.name}
                    </h2>
                    <p className="text-xs text-[#9CA3AF] font-[family-name:var(--font-roboto)] mb-3">
                      Réf. {product.reference}
                    </p>
                    {price !== undefined && (
                      <p
                        className="font-[family-name:var(--font-poppins)] font-bold text-base"
                        style={{ color: primary }}
                      >
                        {price.toFixed(2)} €<span className="text-xs font-normal text-[#9CA3AF] ml-1">HT / unité</span>
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* ── Footer ──────────────────────────────────────────────────────── */}
      <footer className="text-center py-8 border-t border-[#E5E5E5]">
        <p className="text-xs text-[#9CA3AF] font-[family-name:var(--font-roboto)]">
          © Beli & Jolie — Catalogue généré le {new Date().toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" })}
        </p>
      </footer>
    </div>
  );
}
