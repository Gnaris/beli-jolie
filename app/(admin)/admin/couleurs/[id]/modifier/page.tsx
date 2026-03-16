import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { updateColor } from "@/app/actions/admin/colors";

export const metadata: Metadata = { title: "Modifier la couleur" };

export default async function ModifierCouleurPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const color = await prisma.color.findUnique({ where: { id } });
  if (!color) notFound();

  const formAction = async (formData: FormData) => {
    "use server";
    await updateColor(id, formData);
  };

  return (
    <div className="max-w-md mx-auto space-y-6">
      <div>
        <div className="flex items-center gap-2 text-sm font-[family-name:var(--font-roboto)] text-text-muted mb-1">
          <Link href="/admin/couleurs" className="hover:text-text-primary transition-colors">Couleurs</Link>
          <span>/</span>
          <span className="text-text-secondary">{color.name}</span>
        </div>
        <h1 className="page-title">Modifier la couleur</h1>
      </div>

      <form action={formAction} className="card p-6 space-y-5">
        <div>
          <label className="field-label uppercase tracking-wider text-xs font-semibold">
            Nom *
          </label>
          <input
            type="text"
            name="name"
            defaultValue={color.name}
            required
            className="field-input"
          />
        </div>

        <div>
          <label className="field-label uppercase tracking-wider text-xs font-semibold">
            Couleur hex
          </label>
          <div className="flex items-center gap-3">
            <input
              type="color"
              name="hex"
              defaultValue={color.hex ?? "#9CA3AF"}
              className="h-10 w-20 border border-border rounded-lg p-0.5 cursor-pointer"
            />
            <span className="text-sm text-text-muted font-[family-name:var(--font-roboto)]">
              {color.hex ?? "Aucune valeur hex"}
            </span>
          </div>
        </div>

        <div className="flex gap-3 pt-2">
          <button type="submit" className="btn-primary">
            Enregistrer
          </button>
          <Link href="/admin/couleurs" className="btn-secondary">
            Annuler
          </Link>
        </div>
      </form>
    </div>
  );
}
