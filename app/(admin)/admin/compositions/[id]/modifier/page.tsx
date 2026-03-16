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
        <div className="flex items-center gap-2 text-sm font-[family-name:var(--font-roboto)] text-text-muted mb-1">
          <Link href="/admin/compositions" className="hover:text-text-primary transition-colors">Compositions</Link>
          <span>/</span>
          <span className="text-text-secondary truncate">{composition.name}</span>
        </div>
        <h1 className="page-title">Modifier la composition</h1>
      </div>

      <div className="card p-6">
        <form action={action} className="space-y-4">
          <div>
            <label className="field-label uppercase tracking-wider text-xs font-semibold">
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
            <button type="submit" className="btn-primary">
              Enregistrer
            </button>
            <Link href="/admin/compositions" className="btn-secondary">
              Annuler
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
