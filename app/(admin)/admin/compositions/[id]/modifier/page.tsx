import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import Link from "next/link";
import { updateComposition } from "@/app/actions/admin/compositions";

export default async function ModifierCompositionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const composition = await prisma.composition.findUnique({ where: { id } });
  if (!composition) notFound();

  const action = updateComposition.bind(null, id);

  return (
    <div className="max-w-md space-y-6">
      <div>
        <div className="flex items-center gap-2 text-sm font-[family-name:var(--font-roboto)] text-[#94A3B8] mb-1">
          <Link href="/admin/compositions" className="hover:text-[#0F3460] transition-colors">Compositions</Link>
          <span>/</span>
          <span className="text-[#475569] truncate">{composition.name}</span>
        </div>
        <h1 className="font-[family-name:var(--font-poppins)] text-2xl font-semibold text-[#0F172A]">
          Modifier la composition
        </h1>
      </div>

      <div className="bg-white border border-[#E2E8F0] p-6">
        <form action={action} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-[#475569] uppercase tracking-wider mb-1.5 font-[family-name:var(--font-roboto)]">
              Nom de la composition
            </label>
            <input
              name="name"
              type="text"
              defaultValue={composition.name}
              required
              className="field-input"
              placeholder="Ex: Acier inoxydable 316L"
            />
          </div>
          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              className="px-6 py-2.5 bg-[#0F3460] text-white text-sm font-medium hover:bg-[#0A2540] transition-colors font-[family-name:var(--font-roboto)]"
            >
              Enregistrer
            </button>
            <Link
              href="/admin/compositions"
              className="px-6 py-2.5 border border-[#E2E8F0] text-[#475569] text-sm hover:border-[#0F3460] hover:text-[#0F172A] transition-colors font-[family-name:var(--font-roboto)]"
            >
              Annuler
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
