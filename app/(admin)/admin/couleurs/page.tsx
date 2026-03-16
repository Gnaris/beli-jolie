import { prisma } from "@/lib/prisma";
import Link from "next/link";
import type { Metadata } from "next";
import { createColor, deleteColor } from "@/app/actions/admin/colors";
import DeleteButton from "@/components/admin/categories/DeleteButton";

export const metadata: Metadata = { title: "Bibliothèque de couleurs" };

export default async function CouleursPage() {
  const colors = await prisma.color.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { productColors: true } } },
  });

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="page-title">Bibliothèque de couleurs</h1>
        <p className="page-subtitle">
          Créez les couleurs ici, puis assignez-les à vos produits.
        </p>
      </div>

      {/* Formulaire création */}
      <section className="card p-6 space-y-4">
        <h2 className="font-[family-name:var(--font-poppins)] text-sm font-semibold text-text-secondary uppercase tracking-wider">
          Nouvelle couleur
        </h2>
        <form action={createColor} className="flex items-end gap-3">
          <div className="flex-1">
            <label className="field-label uppercase tracking-wider text-xs font-semibold">
              Nom *
            </label>
            <input
              type="text"
              name="name"
              placeholder="Doré, Argenté, Rose gold…"
              required
              className="field-input"
            />
          </div>
          <div>
            <label className="field-label uppercase tracking-wider text-xs font-semibold">
              Couleur hex
            </label>
            <input
              type="color"
              name="hex"
              defaultValue="#9CA3AF"
              className="h-[38px] w-16 border border-border rounded-lg p-0.5 cursor-pointer"
            />
          </div>
          <button type="submit" className="btn-primary whitespace-nowrap">
            Ajouter
          </button>
        </form>
      </section>

      {/* Liste */}
      <section className="space-y-2">
        <h2 className="font-[family-name:var(--font-poppins)] text-sm font-semibold text-text-secondary uppercase tracking-wider border-b border-border pb-2">
          Couleurs ({colors.length})
        </h2>

        {colors.length === 0 ? (
          <p className="text-sm text-text-muted font-[family-name:var(--font-roboto)] py-6 text-center border border-dashed border-border rounded-xl">
            Aucune couleur créée
          </p>
        ) : (
          <ul className="space-y-1.5">
            {colors.map((color) => (
              <li
                key={color.id}
                className="flex items-center justify-between card px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  <span
                    className="w-8 h-8 rounded-lg border border-border shrink-0"
                    style={{ backgroundColor: color.hex ?? "#9CA3AF" }}
                  />
                  <div>
                    <p className="text-sm font-medium text-text-primary font-[family-name:var(--font-roboto)]">
                      {color.name}
                    </p>
                    <p className="text-xs text-text-muted">
                      {color.hex ?? "Pas de couleur hex"} · utilisée dans{" "}
                      {color._count.productColors} produit{color._count.productColors > 1 ? "s" : ""}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Link
                    href={`/admin/couleurs/${color.id}/modifier`}
                    className="p-1.5 text-text-muted hover:text-text-primary transition-colors"
                    title="Modifier"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
                    </svg>
                  </Link>
                  <DeleteButton
                    action={deleteColor.bind(null, color.id)}
                    confirmMessage={`Supprimer la couleur "${color.name}" ?`}
                    disabled={color._count.productColors > 0}
                    disabledTitle="Impossible : utilisée par des produits"
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
