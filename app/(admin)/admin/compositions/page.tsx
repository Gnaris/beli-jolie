import { prisma } from "@/lib/prisma";
import Link from "next/link";
import type { Metadata } from "next";
import { createComposition, deleteComposition } from "@/app/actions/admin/compositions";
import DeleteButton from "@/components/admin/categories/DeleteButton";

export const metadata: Metadata = { title: "Compositions" };

export default async function CompositionsPage() {
  const compositions = await prisma.composition.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { products: true } } },
  });

  return (
    <div className="max-w-3xl space-y-8">
      {/* En-tête */}
      <div>
        <div className="flex items-center gap-2 text-sm font-[family-name:var(--font-roboto)] text-[#94A3B8] mb-1">
          <Link href="/admin" className="hover:text-[#0F3460] transition-colors">Admin</Link>
          <span>/</span>
          <span className="text-[#475569]">Compositions</span>
        </div>
        <h1 className="font-[family-name:var(--font-poppins)] text-2xl font-semibold text-[#0F172A]">
          Bibliothèque de compositions
        </h1>
        <p className="text-sm text-[#94A3B8] font-[family-name:var(--font-roboto)] mt-0.5">
          Créez les matériaux (acier 316L, or 18K…) — ils seront assignables aux produits avec un pourcentage.
        </p>
      </div>

      {/* Formulaire de création */}
      <div className="bg-white border border-[#E2E8F0] p-6">
        <h2 className="font-[family-name:var(--font-poppins)] text-sm font-semibold text-[#0F172A] mb-4">
          Ajouter une composition
        </h2>
        <form action={createComposition} className="flex gap-3">
          <input
            name="name"
            type="text"
            placeholder="Ex: Acier inoxydable 316L"
            required
            className="field-input flex-1"
          />
          <button
            type="submit"
            className="px-5 py-2 bg-[#0F3460] text-white text-sm font-[family-name:var(--font-roboto)] font-medium hover:bg-[#0A2540] transition-colors shrink-0"
          >
            Ajouter
          </button>
        </form>
      </div>

      {/* Liste des compositions */}
      <div className="bg-white border border-[#E2E8F0]">
        {compositions.length === 0 ? (
          <p className="p-6 text-sm text-[#94A3B8] font-[family-name:var(--font-roboto)] text-center">
            Aucune composition. Commencez par en créer une ci-dessus.
          </p>
        ) : (
          <ul className="divide-y divide-[#F1F5F9]">
            {compositions.map((comp) => (
              <li key={comp.id} className="flex items-center justify-between px-5 py-3.5">
                <div>
                  <p className="text-sm font-medium text-[#0F172A] font-[family-name:var(--font-roboto)]">
                    {comp.name}
                  </p>
                  <p className="text-xs text-[#94A3B8] font-[family-name:var(--font-roboto)] mt-0.5">
                    Utilisée dans {comp._count.products} produit{comp._count.products > 1 ? "s" : ""}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <Link
                    href={`/admin/compositions/${comp.id}/modifier`}
                    className="text-xs text-[#475569] hover:text-[#0F3460] transition-colors font-[family-name:var(--font-roboto)]"
                  >
                    Modifier
                  </Link>
                  <DeleteButton
                    action={deleteComposition.bind(null, comp.id)}
                    confirmMessage={`Supprimer la composition "${comp.name}" ?`}
                    disabled={comp._count.products > 0}
                    disabledTitle="Impossible — utilisée par des produits"
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
