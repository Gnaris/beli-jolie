import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import DeleteCollectionButton from "@/components/admin/collections/DeleteCollectionButton";
import CollectionsTranslateAll from "@/components/admin/collections/CollectionsTranslateAll";

export const metadata: Metadata = { title: "Collections — Admin" };

export default async function AdminCollectionsPage() {
  const collections = await prisma.collection.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { products: true } },
      translations: true,
    },
  });

  return (
    <div className="space-y-6">
      {/* En-tête */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">Collections</h1>
          <p className="page-subtitle font-body">
            Gérez les collections de produits de la boutique.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <CollectionsTranslateAll
            collections={collections.map((c) => ({
              id: c.id,
              name: c.name,
              hasTranslations: c.translations.length > 0,
            }))}
          />
          <Link
            href="/admin/collections/nouveau"
            className="btn-primary inline-flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Nouvelle collection
          </Link>
        </div>
      </div>

      {/* État vide */}
      {collections.length === 0 ? (
        <div className="bg-bg-primary border border-border rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-16 flex flex-col items-center text-center">
          <div className="w-20 h-20 rounded-2xl bg-bg-secondary flex items-center justify-center mb-5">
            <svg className="w-9 h-9 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M2.25 7.125C2.25 6.504 2.754 6 3.375 6h6c.621 0 1.125.504 1.125 1.125v3.75c0 .621-.504 1.125-1.125 1.125h-6a1.125 1.125 0 01-1.125-1.125v-3.75zM14.25 8.625c0-.621.504-1.125 1.125-1.125h5.25c.621 0 1.125.504 1.125 1.125v8.25c0 .621-.504 1.125-1.125 1.125h-5.25a1.125 1.125 0 01-1.125-1.125v-8.25zM3.75 16.125c0-.621.504-1.125 1.125-1.125h5.25c.621 0 1.125.504 1.125 1.125v2.25c0 .621-.504 1.125-1.125 1.125h-5.25a1.125 1.125 0 01-1.125-1.125v-2.25z" />
            </svg>
          </div>
          <p className="font-heading font-semibold text-text-primary text-lg mb-2">
            Aucune collection
          </p>
          <p className="text-sm text-[#6B7280] font-body mb-6 max-w-xs">
            Commencez par créer votre première collection pour organiser vos produits.
          </p>
          <Link
            href="/admin/collections/nouveau"
            className="btn-primary inline-flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Créer la première collection
          </Link>
        </div>
      ) : (
        /* Grid de cartes */
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
          {collections.map((col) => (
            <div
              key={col.id}
              className="group bg-bg-primary border border-border rounded-2xl overflow-hidden shadow-[0_1px_4px_rgba(0,0,0,0.06)] hover:shadow-[0_4px_16px_rgba(0,0,0,0.10)] hover:scale-[1.02] transition-all duration-200"
            >
              {/* Image */}
              <div className="relative aspect-[4/3] overflow-hidden bg-bg-secondary">
                {col.image ? (
                  <>
                    <img
                      src={col.image}
                      alt={col.name}
                      className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                    {/* Overlay gradient */}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent" />
                    {/* Nom sur l'overlay */}
                    <div className="absolute bottom-0 left-0 right-0 px-4 pb-3">
                      <p className="font-heading font-semibold text-text-inverse text-sm leading-tight line-clamp-2">
                        {col.name}
                      </p>
                    </div>
                  </>
                ) : (
                  /* Fallback sans image */
                  <div className="w-full h-full flex flex-col items-center justify-center gap-2">
                    <svg className="w-10 h-10 text-[#C4C4C4]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                        d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5z" />
                    </svg>
                  </div>
                )}
              </div>

              {/* Corps de la carte */}
              <div className="px-4 py-3">
                {/* Nom (si pas d'image) + badge produits */}
                <div className="flex items-start justify-between gap-2 mb-3">
                  {!col.image && (
                    <p className="font-heading font-semibold text-text-primary text-sm leading-tight line-clamp-2 flex-1">
                      {col.name}
                    </p>
                  )}
                  {col.image && <div className="flex-1" />}
                  <span className="badge badge-neutral shrink-0 text-xs">
                    {col._count.products} produit{col._count.products !== 1 ? "s" : ""}
                  </span>
                </div>

                {/* Boutons */}
                <div className="flex items-center gap-2">
                  <Link
                    href={`/admin/collections/${col.id}/modifier`}
                    className="btn-secondary text-xs flex-1 text-center"
                  >
                    Modifier
                  </Link>
                  <DeleteCollectionButton id={col.id} name={col.name} />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
