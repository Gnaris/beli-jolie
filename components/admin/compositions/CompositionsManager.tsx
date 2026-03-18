"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { deleteComposition, updateCompositionDirect } from "@/app/actions/admin/compositions";
import EntityEditModal from "@/components/admin/EntityEditModal";

interface CompositionItem {
  id: string;
  name: string;
  productCount: number;
  translations: Record<string, string>;
}

export default function CompositionsManager({
  initialCompositions,
}: {
  initialCompositions: CompositionItem[];
}) {
  const router = useRouter();
  const [editTarget, setEditTarget] = useState<CompositionItem | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState("");

  function handleDelete(comp: CompositionItem) {
    if (comp.productCount > 0) {
      setError(`"${comp.name}" est utilisée par ${comp.productCount} produit${comp.productCount > 1 ? "s" : ""}. Impossible de la supprimer.`);
      return;
    }
    setError("");
    setDeletingId(comp.id);
    deleteComposition(comp.id)
      .then(() => router.refresh())
      .catch(() => setError("Erreur lors de la suppression."))
      .finally(() => setDeletingId(null));
  }

  async function handleSave(name: string, translations: Record<string, string>) {
    if (!editTarget) return;
    await updateCompositionDirect(editTarget.id, name, translations);
    router.refresh();
  }

  return (
    <>
      {error && (
        <p className="text-xs text-[#EF4444] font-[family-name:var(--font-roboto)] px-1 mb-2">{error}</p>
      )}

      <div className="card overflow-hidden">
        {initialCompositions.length === 0 ? (
          <p className="p-6 text-sm text-text-muted font-[family-name:var(--font-roboto)] text-center">
            Aucune composition. Commencez par en créer une ci-dessus.
          </p>
        ) : (
          <ul className="divide-y divide-border-light">
            {initialCompositions.map((comp) => (
              <li key={comp.id} className="flex items-center justify-between px-5 py-3.5 hover:bg-bg-secondary transition-colors">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-text-primary font-[family-name:var(--font-roboto)]">
                      {comp.name}
                    </p>
                    {Object.keys(comp.translations).length === 0 && (
                      <span className="relative group/tw shrink-0">
                        <span className="flex items-center justify-center w-5 h-5 rounded-full bg-amber-100 border border-amber-300 text-amber-700 text-[10px] font-bold cursor-default select-none">⚠</span>
                        <span className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 hidden group-hover/tw:block z-50 pointer-events-none">
                          <span className="block w-48 bg-[#1A1A1A] text-white text-xs rounded-xl px-3 py-2 shadow-xl">
                            Aucune traduction configurée
                            <span className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-[#1A1A1A]" />
                          </span>
                        </span>
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-text-muted font-[family-name:var(--font-roboto)] mt-0.5">
                    Utilisée dans {comp.productCount} produit{comp.productCount > 1 ? "s" : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => { setError(""); setEditTarget(comp); }}
                    className="text-xs text-text-secondary hover:text-text-primary transition-colors font-[family-name:var(--font-roboto)] flex items-center gap-1"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125" />
                    </svg>
                    Modifier
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(comp)}
                    disabled={deletingId === comp.id || comp.productCount > 0}
                    title={comp.productCount > 0 ? "Impossible — utilisée par des produits" : "Supprimer"}
                    className="text-xs text-text-muted hover:text-[#EF4444] transition-colors font-[family-name:var(--font-roboto)] disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-1"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                    </svg>
                    Supprimer
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <EntityEditModal
        open={!!editTarget}
        onClose={() => setEditTarget(null)}
        title="Modifier la composition"
        initialName={editTarget?.name ?? ""}
        initialTranslations={editTarget?.translations ?? {}}
        onSave={handleSave}
      />
    </>
  );
}
