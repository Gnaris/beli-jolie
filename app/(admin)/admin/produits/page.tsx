import { Suspense } from "react";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import type { Metadata } from "next";
import { deleteProduct } from "@/app/actions/admin/products";
import DeleteButton from "@/components/admin/categories/DeleteButton";
import AdminProductsFilters from "@/components/admin/products/AdminProductsFilters";
import AdminPagination from "@/components/admin/products/AdminPagination";

export const metadata: Metadata = {
  title: "Produits",
};

interface PageProps {
  searchParams: Promise<{ q?: string; page?: string; perPage?: string }>;
}

export default async function ProduitsPage({ searchParams }: PageProps) {
  const { q = "", page: pageParam = "1", perPage: perPageParam = "20" } = await searchParams;

  const currentPage = Math.max(1, parseInt(pageParam));
  const perPage     = Math.max(1, parseInt(perPageParam) || 20);

  const where = {
    ...(q && {
      OR: [
        { name:      { contains: q } },
        { reference: { contains: q } },
      ],
    }),
  };

  const [products, totalCount] = await Promise.all([
    prisma.product.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip:    (currentPage - 1) * perPage,
      take:    perPage,
      include: {
        category:      { select: { name: true } },
        subCategories: { select: { name: true }, take: 1 },
        colors: {
          select: {
            id:        true,
            unitPrice: true,
            stock:     true,
            color:     { select: { name: true, hex: true } },
            images:    { select: { path: true }, orderBy: { order: "asc" }, take: 1 },
            saleOptions: { select: { saleType: true } },
          },
        },
      },
    }),
    prisma.product.count({ where }),
  ]);

  const totalPages = Math.ceil(totalCount / perPage);

  return (
    <div className="space-y-6">
      {/* En-tête */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">
            Produits
          </h1>
          <p className="page-subtitle font-[family-name:var(--font-roboto)]">
            {totalCount} produit{totalCount > 1 ? "s" : ""} au catalogue
          </p>
        </div>
        <Link
          href="/admin/produits/nouveau"
          className="btn-primary flex items-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          Nouveau produit
        </Link>
      </div>

      {/* Filtres + quantité par page */}
      <div className="card px-4 py-3">
        <Suspense>
          <AdminProductsFilters totalCount={totalCount} />
        </Suspense>
      </div>

      {/* Tableau */}
      {products.length === 0 ? (
        <div className="card p-12 text-center">
          <div className="w-12 h-12 bg-bg-tertiary rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-6 h-6 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
            </svg>
          </div>
          <p className="font-[family-name:var(--font-poppins)] font-semibold text-text-primary mb-1">
            Aucun produit
          </p>
          <p className="text-sm text-text-muted font-[family-name:var(--font-roboto)] mb-4">
            {q ? "Aucun résultat pour cette recherche." : "Commencez par créer votre premier produit."}
          </p>
          {!q && (
            <Link
              href="/admin/produits/nouveau"
              className="btn-primary inline-flex items-center gap-2"
            >
              Créer un produit
            </Link>
          )}
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm font-[family-name:var(--font-roboto)]">
            <thead>
              <tr className="table-header">
                <th className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase tracking-wider">Photo</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase tracking-wider">Référence</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase tracking-wider">Nom</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase tracking-wider hidden md:table-cell">Catégorie</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-text-secondary uppercase tracking-wider hidden lg:table-cell">Couleurs</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-text-secondary uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-light">
              {products.map((product) => {
                const firstImage = product.colors[0]?.images[0]?.path;
                const minPrice   = Math.min(...product.colors.map((c) => c.unitPrice));

                return (
                  <tr key={product.id} className="table-row">
                    {/* Photo */}
                    <td className="px-4 py-3">
                      {firstImage ? (
                        <img
                          src={firstImage}
                          alt={product.name}
                          className="w-12 h-12 object-cover rounded-lg border border-border"
                        />
                      ) : (
                        <div className="w-12 h-12 bg-bg-tertiary rounded-lg flex items-center justify-center border border-border">
                          <svg className="w-5 h-5 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M13.5 12h.008v.008H13.5V12zm0 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 9V7.5a2.25 2.25 0 012.25-2.25h15A2.25 2.25 0 0121 7.5v9a2.25 2.25 0 01-2.25 2.25H4.5A2.25 2.25 0 012.25 21z" />
                          </svg>
                        </div>
                      )}
                    </td>

                    {/* Référence */}
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs bg-bg-tertiary px-2 py-0.5 rounded text-text-secondary">
                        {product.reference}
                      </span>
                    </td>

                    {/* Nom + prix */}
                    <td className="px-4 py-3">
                      <p className="font-medium text-text-primary">{product.name}</p>
                      {!isNaN(minPrice) && (
                        <p className="text-xs text-text-muted">
                          à partir de {minPrice.toFixed(2)} €
                        </p>
                      )}
                    </td>

                    {/* Catégorie */}
                    <td className="px-4 py-3 hidden md:table-cell">
                      <span className="text-text-secondary">{product.category.name}</span>
                      {product.subCategories[0] && (
                        <span className="text-text-muted"> / {product.subCategories[0].name}</span>
                      )}
                    </td>

                    {/* Couleurs */}
                    <td className="px-4 py-3 hidden lg:table-cell">
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-1 flex-wrap">
                          {product.colors.map((c) => (
                            <span
                              key={c.id}
                              title={`${c.color.name}${(c as unknown as { stock: number }).stock === 0 ? " — Rupture" : ""}`}
                              className={`inline-block w-5 h-5 rounded-full border-2 ${(c as unknown as { stock: number }).stock === 0 ? "border-error opacity-50" : "border-border"}`}
                              style={{ backgroundColor: c.color.hex ?? "#9CA3AF" }}
                            />
                          ))}
                          <span className="text-xs text-text-muted ml-1">
                            {product.colors.length} couleur{product.colors.length > 1 ? "s" : ""}
                          </span>
                        </div>
                        {product.colors.some((c) => (c as unknown as { stock: number }).stock === 0) && (
                          <span className="text-[10px] text-error font-medium font-[family-name:var(--font-roboto)]">
                            {product.colors.filter((c) => (c as unknown as { stock: number }).stock === 0).map((c) => c.color.name).join(", ")} — rupture
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center gap-2 justify-end">
                        <Link
                          href={`/admin/produits/${product.id}/modifier`}
                          className="p-1.5 text-text-muted hover:text-text-primary transition-colors"
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

          {/* Footer tableau : info + pagination */}
          <div className="flex items-center justify-between px-4 py-3 border-t border-border">
            <p className="text-xs text-text-muted font-[family-name:var(--font-roboto)]">
              {(currentPage - 1) * perPage + 1}–{Math.min(currentPage * perPage, totalCount)} sur {totalCount}
            </p>
            <Suspense>
              <AdminPagination currentPage={currentPage} totalPages={totalPages} />
            </Suspense>
          </div>
        </div>
      )}
    </div>
  );
}
