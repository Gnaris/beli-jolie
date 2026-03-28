import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import DeleteCatalogButton from "@/components/admin/catalogues/DeleteCatalogButton";
import CopyLinkButton from "@/components/admin/catalogues/CopyLinkButton";
import CreateCatalogButton from "@/components/admin/catalogues/CreateCatalogButton";

export const metadata: Metadata = { title: "Catalogues — Admin" };

export default async function AdminCataloguesPage() {
  const catalogs = await prisma.catalog.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { products: true } } },
  });

  return (
    <div className="space-y-6">
      {/* En-tête */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Catalogues</h1>
          <p className="page-subtitle font-body">
            Créez des catalogues partageables avec un lien unique.
          </p>
        </div>
        <CreateCatalogButton />
      </div>

      {/* État vide */}
      {catalogs.length === 0 ? (
        <div className="bg-bg-primary border border-border rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-16 flex flex-col items-center text-center">
          <div className="w-20 h-20 rounded-2xl bg-bg-secondary flex items-center justify-center mb-5">
            <svg className="w-9 h-9 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
            </svg>
          </div>
          <p className="font-heading font-semibold text-text-primary text-lg mb-2">
            Aucun catalogue
          </p>
          <p className="text-sm text-[#6B7280] font-body mb-6 max-w-xs">
            Créez votre premier catalogue pour partager une sélection de produits via un lien unique.
          </p>
          <CreateCatalogButton />
        </div>
      ) : (
        <div className="bg-bg-primary border border-border rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="table-header">
                <th className="text-left px-6 py-3 text-xs font-semibold text-[#6B7280] uppercase tracking-wider">Titre</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-[#6B7280] uppercase tracking-wider hidden sm:table-cell">Produits</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-[#6B7280] uppercase tracking-wider hidden md:table-cell">Statut</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-[#6B7280] uppercase tracking-wider hidden lg:table-cell">Couleur</th>
                <th className="text-right px-6 py-3 text-xs font-semibold text-[#6B7280] uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F3F4F6]">
              {catalogs.map((cat) => (
                <tr key={cat.id} className="table-row hover:bg-[#FAFAFA] transition-colors">
                  <td className="px-6 py-4">
                    <p className="font-heading font-medium text-text-primary text-sm">
                      {cat.title}
                    </p>
                    <p className="text-xs text-text-muted font-body mt-0.5 font-mono">
                      /catalogue/{cat.token.slice(0, 12)}…
                    </p>
                  </td>
                  <td className="px-6 py-4 hidden sm:table-cell">
                    <span className="badge badge-neutral text-xs">
                      {cat._count.products} produit{cat._count.products !== 1 ? "s" : ""}
                    </span>
                  </td>
                  <td className="px-6 py-4 hidden md:table-cell">
                    {cat.status === "PUBLISHED" ? (
                      <span className="badge badge-success text-xs">Publié</span>
                    ) : (
                      <span className="badge badge-neutral text-xs">Brouillon</span>
                    )}
                  </td>
                  <td className="px-6 py-4 hidden lg:table-cell">
                    <div className="flex items-center gap-2">
                      <div
                        className="w-5 h-5 rounded-full border border-border"
                        style={{ backgroundColor: cat.primaryColor }}
                      />
                      <span className="text-xs font-mono text-[#6B7280]">{cat.primaryColor}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center justify-end gap-2">
                      {/* Copier le lien */}
                      <CopyLinkButton token={cat.token} />
                      {/* Visualiser */}
                      <a
                        href={`/catalogue/${cat.token}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Visualiser le catalogue"
                        className="w-8 h-8 flex items-center justify-center rounded-lg border border-border hover:bg-bg-secondary transition-colors text-[#6B7280] hover:text-text-primary"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                            d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                      </a>
                      {/* Modifier */}
                      <Link
                        href={`/admin/catalogues/${cat.id}`}
                        title="Modifier le catalogue"
                        className="w-8 h-8 flex items-center justify-center rounded-lg border border-border hover:bg-bg-secondary transition-colors text-[#6B7280] hover:text-text-primary"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                            d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125" />
                        </svg>
                      </Link>
                      {/* Supprimer */}
                      <DeleteCatalogButton id={cat.id} title={cat.title} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
