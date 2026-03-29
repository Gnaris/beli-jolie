import { notFound } from "next/navigation";
import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";
import { authOptions } from "@/lib/auth";
import { getCachedShopName } from "@/lib/cached-data";
import CatalogProductCard from "@/components/catalogue/CatalogProductCard";
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
                include: {
                  color: { select: { id: true, name: true, hex: true, patternImage: true } },
                  subColors: {
                    orderBy: { position: "asc" },
                    select: { color: { select: { name: true, hex: true, patternImage: true } } },
                  },
                  variantSizes: {
                    orderBy: { size: { position: "asc" } },
                    select: { size: { select: { name: true } }, quantity: true },
                  },
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

  const [shopName, session] = await Promise.all([
    getCachedShopName(),
    getServerSession(authOptions),
  ]);

  const isAuthenticated = !!session?.user;
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
        {catalog.coverImagePath && (
          <div className="absolute inset-0 bg-black/40" />
        )}
        <div className="relative z-10">
          <p className="text-white/70 text-xs uppercase tracking-widest font-body mb-1">
            {shopName} — Catalogue
          </p>
          <h1 className="font-heading font-bold text-white text-2xl md:text-3xl tracking-tight">
            {catalog.title}
          </h1>
          <div className="flex items-center justify-center gap-3 mt-2">
            <p className="text-white/60 text-sm font-body">
              {catalog.products.length} produit{catalog.products.length !== 1 ? "s" : ""} sélectionné{catalog.products.length !== 1 ? "s" : ""}
            </p>
            {isAuthenticated && (
              <a
                href="/panier"
                className="inline-flex items-center gap-1.5 px-3 py-1 bg-white/20 hover:bg-white/30 text-white text-xs font-medium rounded-full transition-colors backdrop-blur-sm"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 100 4 2 2 0 000-4z" />
                </svg>
                Mon panier
              </a>
            )}
          </div>
        </div>
      </header>

      {/* ── Grille produits ──────────────────────────────────────────────── */}
      <main className="max-w-6xl mx-auto px-4 py-10">
        {catalog.products.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-text-muted font-body">Ce catalogue est vide.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {catalog.products.map(({ product, selectedColorId, selectedImagePath }) => (
              <CatalogProductCard
                key={product.id}
                product={product}
                selectedColorId={selectedColorId}
                selectedImagePath={selectedImagePath}
                primaryColor={primary}
                isAuthenticated={isAuthenticated}
                catalogToken={token}
              />
            ))}
          </div>
        )}
      </main>

      {/* ── Footer ──────────────────────────────────────────────────────── */}
      <footer className="text-center py-8 border-t border-border">
        <p className="text-xs text-text-muted font-body">
          © {shopName} — Catalogue généré le {new Date().toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" })}
        </p>
      </footer>
    </div>
  );
}
