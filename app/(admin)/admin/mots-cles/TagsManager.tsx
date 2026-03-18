"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { deleteTag, updateTagDirect } from "@/app/actions/admin/products";
import QuickCreateModal from "@/components/admin/products/QuickCreateModal";
import EntityEditModal from "@/components/admin/EntityEditModal";

interface TagItem {
  id: string;
  name: string;
  productCount: number;
  translations: Record<string, string>;
}

export default function TagsManager({ initialTags }: { initialTags: TagItem[] }) {
  const router = useRouter();
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<TagItem | null>(null);
  const [error, setError] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  function handleDelete(tag: TagItem) {
    if (tag.productCount > 0) {
      setError(`Ce mot clé est utilisé par ${tag.productCount} produit${tag.productCount > 1 ? "s" : ""}. Retirez-le des produits d'abord.`);
      return;
    }
    setError("");
    setDeletingId(tag.id);
    deleteTag(tag.id)
      .then(() => router.refresh())
      .catch(() => setError("Erreur lors de la suppression."))
      .finally(() => setDeletingId(null));
  }

  async function handleSave(name: string, translations: Record<string, string>) {
    if (!editTarget) return;
    await updateTagDirect(editTarget.id, name, translations);
    router.refresh();
  }

  return (
    <div className="space-y-6">
      {/* Créer */}
      <div className="card p-5 flex items-center justify-between">
        <div>
          <h2 className="font-[family-name:var(--font-poppins)] text-sm font-semibold text-text-primary">
            Nouveau mot clé
          </h2>
          <p className="text-xs text-text-muted font-[family-name:var(--font-roboto)] mt-0.5">
            Saisissez le nom dans toutes les langues souhaitées.
          </p>
        </div>
        <button
          type="button"
          onClick={() => { setError(""); setCreateModalOpen(true); }}
          className="btn-primary shrink-0"
        >
          + Créer un mot clé
        </button>
      </div>

      {error && (
        <p className="text-xs text-[#EF4444] font-[family-name:var(--font-roboto)] px-1">{error}</p>
      )}

      {/* Liste */}
      <div className="card overflow-hidden">
        <div className="table-header px-5 py-3">
          <p className="text-xs font-semibold uppercase tracking-wider font-[family-name:var(--font-roboto)]">
            {initialTags.length} mot{initialTags.length !== 1 ? "s" : ""} clé{initialTags.length !== 1 ? "s" : ""}
          </p>
        </div>

        {initialTags.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-sm text-text-muted font-[family-name:var(--font-roboto)]">
              Aucun mot clé pour l&apos;instant.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border-light">
            {initialTags.map((tag) => (
              <li key={tag.id} className="flex items-center justify-between px-5 py-3 hover:bg-bg-secondary transition-colors">
                <div className="flex items-center gap-3">
                  <span className="badge badge-neutral">
                    {tag.name}
                  </span>
                  <span className="text-xs text-text-muted font-[family-name:var(--font-roboto)]">
                    {tag.productCount} produit{tag.productCount !== 1 ? "s" : ""}
                  </span>
                  {Object.keys(tag.translations).length === 0 && (
                    <span className="relative group/tw shrink-0">
                      <span className="flex items-center justify-center w-5 h-5 rounded-full bg-amber-100 border border-amber-300 text-amber-700 text-[10px] font-bold cursor-default select-none">⚠</span>
                      <span className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 hidden group-hover/tw:block z-50 pointer-events-none">
                        <span className="block w-44 bg-[#1A1A1A] text-white text-xs rounded-xl px-3 py-2 shadow-xl">
                          Aucune traduction configurée
                          <span className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-[#1A1A1A]" />
                        </span>
                      </span>
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => { setError(""); setEditTarget(tag); }}
                    className="text-xs text-text-muted hover:text-text-primary transition-colors flex items-center gap-1"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125" />
                    </svg>
                    Modifier
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(tag)}
                    disabled={deletingId === tag.id}
                    className="text-xs text-text-muted hover:text-[#EF4444] transition-colors disabled:opacity-40 flex items-center gap-1"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                        d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                    </svg>
                    Supprimer
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Modales */}
      <QuickCreateModal
        type="tag"
        open={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        onCreated={() => { setCreateModalOpen(false); router.refresh(); }}
      />

      <EntityEditModal
        open={!!editTarget}
        onClose={() => setEditTarget(null)}
        title="Modifier le mot clé"
        initialName={editTarget?.name ?? ""}
        initialTranslations={editTarget?.translations ?? {}}
        onSave={handleSave}
      />
    </div>
  );
}
