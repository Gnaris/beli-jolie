import { prisma } from "@/lib/prisma";
import Link from "next/link";
import type { Metadata } from "next";
import ProductForm from "@/components/admin/products/ProductForm";

export const metadata: Metadata = { title: "Nouveau produit" };

export default async function NouveauProduitPage() {
  const [categories, colors] = await Promise.all([
    prisma.category.findMany({
      orderBy: { name: "asc" },
      include: { subCategories: { orderBy: { name: "asc" } } },
    }),
    prisma.color.findMany({ orderBy: { name: "asc" } }),
  ]);

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <div className="flex items-center gap-2 text-sm font-[family-name:var(--font-roboto)] text-[#B8A48A] mb-1">
          <Link href="/admin/produits" className="hover:text-[#8B7355] transition-colors">Produits</Link>
          <span>/</span>
          <span className="text-[#6B5B45]">Nouveau</span>
        </div>
        <h1 className="font-[family-name:var(--font-poppins)] text-2xl font-semibold text-[#2C2418]">
          Créer un produit
        </h1>
      </div>

      {categories.length === 0 && (
        <div className="bg-amber-50 border border-amber-200 text-amber-700 px-4 py-3 text-sm font-[family-name:var(--font-roboto)]">
          Aucune catégorie.{" "}
          <Link href="/admin/categories" className="underline font-medium">Créez-en une d'abord.</Link>
        </div>
      )}

      {colors.length === 0 && (
        <div className="bg-amber-50 border border-amber-200 text-amber-700 px-4 py-3 text-sm font-[family-name:var(--font-roboto)]">
          Aucune couleur dans la bibliothèque.{" "}
          <Link href="/admin/couleurs" className="underline font-medium">Créez des couleurs d'abord.</Link>
        </div>
      )}

      <ProductForm
        categories={categories}
        availableColors={colors.map((c) => ({ id: c.id, name: c.name, hex: c.hex }))}
      />
    </div>
  );
}
