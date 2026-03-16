import { prisma } from "@/lib/prisma";
import Link from "next/link";
import type { Metadata } from "next";
import ProductForm from "@/components/admin/products/ProductForm";

export const metadata: Metadata = { title: "Nouveau produit" };

export default async function NouveauProduitPage() {
  const [categories, colors, compositions, allProducts, tags] = await Promise.all([
    prisma.category.findMany({
      orderBy: { name: "asc" },
      include: { subCategories: { orderBy: { name: "asc" } } },
    }),
    prisma.color.findMany({ orderBy: { name: "asc" } }),
    prisma.composition.findMany({ orderBy: { name: "asc" } }),
    prisma.product.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, reference: true },
    }),
    prisma.tag.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      <div>
        <div className="flex items-center gap-2 text-sm font-[family-name:var(--font-roboto)] text-text-muted mb-2">
          <Link href="/admin/produits" className="hover:text-text-primary transition-colors">Produits</Link>
          <span>/</span>
          <span className="text-text-secondary">Nouveau</span>
        </div>
        <h1 className="page-title">
          Créer un produit
        </h1>
      </div>

      {categories.length === 0 && (
        <div className="badge-warning px-4 py-3 text-sm font-[family-name:var(--font-roboto)] rounded-xl border border-[#FDE68A]">
          Aucune catégorie.{" "}
          <Link href="/admin/categories" className="underline font-medium">Créez-en une d&apos;abord.</Link>
        </div>
      )}

      {colors.length === 0 && (
        <div className="badge-warning px-4 py-3 text-sm font-[family-name:var(--font-roboto)] rounded-xl border border-[#FDE68A]">
          Aucune couleur dans la bibliothèque.{" "}
          <Link href="/admin/couleurs" className="underline font-medium">Créez des couleurs d&apos;abord.</Link>
        </div>
      )}

      <ProductForm
        categories={categories}
        availableColors={colors.map((c) => ({ id: c.id, name: c.name, hex: c.hex }))}
        availableCompositions={compositions.map((c) => ({ id: c.id, name: c.name }))}
        allProducts={allProducts}
        availableTags={tags}
      />
    </div>
  );
}
