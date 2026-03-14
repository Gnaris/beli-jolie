import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import DeleteCollectionButton from "@/components/admin/collections/DeleteCollectionButton";

export const metadata: Metadata = { title: "Collections — Admin" };

export default async function AdminCollectionsPage() {
  const collections = await prisma.collection.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { products: true } } },
  });

  return (
    <div className="space-y-6">
      {/* En-tête */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-[family-name:var(--font-poppins)] text-2xl font-semibold text-[#0F172A]">
            Collections
          </h1>
          <p className="mt-1 text-sm text-[#475569] font-[family-name:var(--font-roboto)]">
            Gérez les collections de bijoux de la boutique.
          </p>
        </div>
        <Link
          href="/admin/collections/nouveau"
          className="inline-flex items-center gap-2 bg-[#0F172A] text-white text-sm font-[family-name:var(--font-roboto)] font-medium px-4 py-2 rounded-md hover:bg-[#1E293B] transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          Nouvelle collection
        </Link>
      </div>

      {/* Liste */}
      {collections.length === 0 ? (
        <div className="bg-white border border-[#E2E8F0] rounded-lg p-12 text-center">
          <svg className="w-10 h-10 text-[#CBD5E1] mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M2.25 7.125C2.25 6.504 2.754 6 3.375 6h6c.621 0 1.125.504 1.125 1.125v3.75c0 .621-.504 1.125-1.125 1.125h-6a1.125 1.125 0 01-1.125-1.125v-3.75zM14.25 8.625c0-.621.504-1.125 1.125-1.125h5.25c.621 0 1.125.504 1.125 1.125v8.25c0 .621-.504 1.125-1.125 1.125h-5.25a1.125 1.125 0 01-1.125-1.125v-8.25zM3.75 16.125c0-.621.504-1.125 1.125-1.125h5.25c.621 0 1.125.504 1.125 1.125v2.25c0 .621-.504 1.125-1.125 1.125h-5.25a1.125 1.125 0 01-1.125-1.125v-2.25z" />
          </svg>
          <p className="text-[#475569] text-sm font-[family-name:var(--font-roboto)]">
            Aucune collection pour l&apos;instant.
          </p>
          <Link
            href="/admin/collections/nouveau"
            className="mt-4 inline-block text-sm text-[#0F3460] hover:underline font-[family-name:var(--font-roboto)]"
          >
            Créer la première collection →
          </Link>
        </div>
      ) : (
        <div className="bg-white border border-[#E2E8F0] rounded-lg overflow-hidden">
          {/* Header */}
          <div className="grid grid-cols-[3fr_1fr_auto] gap-4 px-5 py-3 border-b border-[#E2E8F0] bg-[#F8FAFC]">
            {["Collection", "Produits", "Actions"].map((h) => (
              <span key={h} className="text-xs font-semibold text-[#475569] uppercase tracking-wider font-[family-name:var(--font-roboto)]">
                {h}
              </span>
            ))}
          </div>

          {/* Rows */}
          {collections.map((col) => (
            <div
              key={col.id}
              className="grid grid-cols-[3fr_1fr_auto] gap-4 px-5 py-4 border-b border-[#F1F5F9] last:border-0 items-center"
            >
              {/* Nom + image */}
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-12 h-12 rounded-md bg-[#F1F5F9] shrink-0 overflow-hidden">
                  {col.image ? (
                    <img src={col.image} alt={col.name} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <svg className="w-5 h-5 text-[#CBD5E1]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                          d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5z" />
                      </svg>
                    </div>
                  )}
                </div>
                <p className="font-medium text-[#0F172A] text-sm font-[family-name:var(--font-roboto)] truncate">
                  {col.name}
                </p>
              </div>

              {/* Count */}
              <p className="text-sm text-[#475569] font-[family-name:var(--font-roboto)]">
                {col._count.products} produit{col._count.products !== 1 ? "s" : ""}
              </p>

              {/* Actions */}
              <div className="flex items-center gap-2">
                <Link
                  href={`/admin/collections/${col.id}/modifier`}
                  className="text-xs font-medium text-[#0F3460] border border-[#0F3460] px-3 py-1.5 rounded hover:bg-[#0F3460] hover:text-white transition-colors font-[family-name:var(--font-roboto)]"
                >
                  Modifier
                </Link>
                <DeleteCollectionButton id={col.id} name={col.name} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
