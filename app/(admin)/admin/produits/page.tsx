import { prisma } from "@/lib/prisma";
import Link from "next/link";
import type { Metadata } from "next";
import { deleteProduct } from "@/app/actions/admin/products";
import DeleteButton from "@/components/admin/categories/DeleteButton";

export const metadata: Metadata = {
  title: "Produits",
};

export default async function ProduitsPage() {
  const products = await prisma.product.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      category:    { select: { name: true } },
      subCategory: { select: { name: true } },
      colors: {
        select: {
          id: true,
          unitPrice: true,
          color: { select: { name: true, hex: true } },
          images: { select: { path: true }, orderBy: { order: "asc" }, take: 1 },
          saleOptions: { select: { saleType: true } },
        },
      },
    },
  });

  return (
    <div className="space-y-6">
      {/* En-tête */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-[family-name:var(--font-poppins)] text-2xl font-semibold text-[#2C2418]">
            Produits
          </h1>
          <p className="text-sm text-[#B8A48A] font-[family-name:var(--font-roboto)] mt-0.5">
            {products.length} produit{products.length > 1 ? "s" : ""} au catalogue
          </p>
        </div>
        <Link
          href="/admin/produits/nouveau"
          className="flex items-center gap-2 px-4 py-2.5 bg-[#8B7355] text-white text-sm font-[family-name:var(--font-poppins)] font-semibold hover:bg-[#6B5640] transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          Nouveau produit
        </Link>
      </div>

      {/* Tableau */}
      {products.length === 0 ? (
        <div className="bg-white border border-[#D4CCBE] p-12 text-center">
          <div className="w-12 h-12 bg-[#EDE8DF] flex items-center justify-center mx-auto mb-4">
            <svg className="w-6 h-6 text-[#B8A48A]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
            </svg>
          </div>
          <p className="font-[family-name:var(--font-poppins)] font-semibold text-[#2C2418] mb-1">
            Aucun produit
          </p>
          <p className="text-sm text-[#B8A48A] font-[family-name:var(--font-roboto)] mb-4">
            Commencez par créer votre premier produit.
          </p>
          <Link
            href="/admin/produits/nouveau"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#8B7355] text-white text-sm font-[family-name:var(--font-poppins)] font-semibold hover:bg-[#6B5640] transition-colors"
          >
            Créer un produit
          </Link>
        </div>
      ) : (
        <div className="bg-white border border-[#D4CCBE] overflow-hidden">
          <table className="w-full text-sm font-[family-name:var(--font-roboto)]">
            <thead>
              <tr className="border-b border-[#EDE8DF] bg-[#FDFAF6]">
                <th className="px-4 py-3 text-left text-xs font-semibold text-[#6B5B45] uppercase tracking-wider">Photo</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-[#6B5B45] uppercase tracking-wider">Référence</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-[#6B5B45] uppercase tracking-wider">Nom</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-[#6B5B45] uppercase tracking-wider hidden md:table-cell">Catégorie</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-[#6B5B45] uppercase tracking-wider hidden lg:table-cell">Couleurs</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-[#6B5B45] uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#EDE8DF]">
              {products.map((product) => {
                const firstImage = product.colors[0]?.images[0]?.path;
                const minPrice   = Math.min(...product.colors.map((c) => c.unitPrice));

                return (
                  <tr key={product.id} className="hover:bg-[#FDFAF6] transition-colors">
                    {/* Photo */}
                    <td className="px-4 py-3">
                      {firstImage ? (
                        <img
                          src={firstImage}
                          alt={product.name}
                          className="w-12 h-12 object-cover border border-[#EDE8DF]"
                        />
                      ) : (
                        <div className="w-12 h-12 bg-[#EDE8DF] flex items-center justify-center border border-[#D4CCBE]">
                          <svg className="w-5 h-5 text-[#B8A48A]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M13.5 12h.008v.008H13.5V12zm0 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 9V7.5a2.25 2.25 0 012.25-2.25h15A2.25 2.25 0 0121 7.5v9a2.25 2.25 0 01-2.25 2.25H4.5A2.25 2.25 0 012.25 21z" />
                          </svg>
                        </div>
                      )}
                    </td>

                    {/* Référence */}
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs bg-[#EDE8DF] px-2 py-0.5 text-[#6B5B45]">
                        {product.reference}
                      </span>
                    </td>

                    {/* Nom + prix */}
                    <td className="px-4 py-3">
                      <p className="font-medium text-[#2C2418]">{product.name}</p>
                      {!isNaN(minPrice) && (
                        <p className="text-xs text-[#B8A48A]">
                          à partir de {minPrice.toFixed(2)} €
                        </p>
                      )}
                    </td>

                    {/* Catégorie */}
                    <td className="px-4 py-3 hidden md:table-cell">
                      <span className="text-[#6B5B45]">{product.category.name}</span>
                      {product.subCategory && (
                        <span className="text-[#B8A48A]"> / {product.subCategory.name}</span>
                      )}
                    </td>

                    {/* Couleurs */}
                    <td className="px-4 py-3 hidden lg:table-cell">
                      <div className="flex items-center gap-1 flex-wrap">
                        {product.colors.map((c) => (
                          <span
                            key={c.id}
                            title={c.color.name}
                            className="inline-block w-5 h-5 rounded-full border border-[#D4CCBE]"
                            style={{ backgroundColor: c.color.hex ?? "#B8A48A" }}
                          />
                        ))}
                        <span className="text-xs text-[#B8A48A] ml-1">
                          {product.colors.length} couleur{product.colors.length > 1 ? "s" : ""}
                        </span>
                      </div>
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center gap-2 justify-end">
                        <Link
                          href={`/admin/produits/${product.id}/modifier`}
                          className="p-1.5 text-[#B8A48A] hover:text-[#8B7355] transition-colors"
                          aria-label="Modifier"
                          title="Modifier"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
                          </svg>
                        </Link>
                        <DeleteButton
                          action={deleteProduct.bind(null, product.id)}
                          confirmMessage={`Supprimer "${product.name}" ? Cette action est irréversible.`}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
