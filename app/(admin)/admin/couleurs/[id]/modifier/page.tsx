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
        <div className="flex items-center gap-2 text-sm font-[family-name:var(--font-roboto)] text-[#B8A48A] mb-1">
          <Link href="/admin/couleurs" className="hover:text-[#8B7355] transition-colors">Couleurs</Link>
          <span>/</span>
          <span className="text-[#6B5B45]">{color.name}</span>
        </div>
        <h1 className="font-[family-name:var(--font-poppins)] text-2xl font-semibold text-[#2C2418]">
          Modifier la couleur
        </h1>
      </div>

      <form action={formAction} className="bg-white border border-[#D4CCBE] p-6 space-y-5">
        <div>
          <label className="block text-xs font-[family-name:var(--font-roboto)] font-semibold text-[#6B5B45] uppercase tracking-wider mb-1.5">
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
          <label className="block text-xs font-[family-name:var(--font-roboto)] font-semibold text-[#6B5B45] uppercase tracking-wider mb-1.5">
            Couleur hex
          </label>
          <div className="flex items-center gap-3">
            <input
              type="color"
              name="hex"
              defaultValue={color.hex ?? "#B8A48A"}
              className="h-10 w-20 border border-[#D4CCBE] p-0.5 cursor-pointer"
            />
            <span className="text-sm text-[#B8A48A] font-[family-name:var(--font-roboto)]">
              {color.hex ?? "Aucune valeur hex"}
            </span>
          </div>
        </div>

        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            className="px-6 py-2.5 bg-[#8B7355] text-white text-sm font-[family-name:var(--font-poppins)] font-semibold hover:bg-[#6B5640] transition-colors"
          >
            Enregistrer
          </button>
          <Link
            href="/admin/couleurs"
            className="px-6 py-2.5 border border-[#D4CCBE] text-sm font-[family-name:var(--font-roboto)] text-[#6B5B45] hover:border-[#8B7355] transition-colors"
          >
            Annuler
          </Link>
        </div>
      </form>
    </div>
  );
}
