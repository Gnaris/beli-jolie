"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { deleteTag, updateTagDirect } from "@/app/actions/admin/products";
import { batchUpdateTranslations } from "@/app/actions/admin/batch-translations";
import QuickCreateModal from "@/components/admin/products/QuickCreateModal";
import EntityEditModal from "@/components/admin/EntityEditModal";
import TranslateAllButton from "@/components/admin/TranslateAllButton";

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
  const [search, setSearch] = useState("");

  const filtered = search.trim()
    ? initialTags.filter((t) => t.name.toLowerCase().includes(search.trim().toLowerCase()))
    : initialTags;

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

  async function handleTranslateAll(translations: Record<string, Record<string, string>>) {
    const items = Object.entries(translations).map(([id, t]) => ({ id, translations: t }));
    await batchUpdateTranslations("tag", items);
    router.refresh();
  }

  return (
    <div className="space-y-6">
      {/* Barre d'actions */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="relative">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher un mot clé…"
            className="field-input w-full sm:w-72"
            style={{ paddingLeft: "2.25rem" }}
          />
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
        </div>
        <div className="flex items-center gap-3">
          <TranslateAllButton
            items={initialTags.map((t) => ({
              id: t.id,
              text: t.name,
              hasTranslations: Object.keys(t.translations).length > 0,
            }))}
            onTranslated={handleTranslateAll}
            label="Tout traduire"
            onlyMissing
          />
          <span className="text-xs text-text-muted font-[family-name:var(--font-roboto)]">
            {filtered.length} mot{filtered.length !== 1 ? "s" : ""} clé{filtered.length !== 1 ? "s" : ""}
          </span>
          <button
            type="button"
            onClick={() => { setError(""); setCreateModalOpen(true); }}
            className="btn-primary shrink-0"
          >
            + Créer un mot clé
          </button>
        </div>
      </div>

      {error && (
        <p className="text-xs text-[#EF4444] font-[family-name:var(--font-roboto)] px-1">{error}</p>
      )}

      {/* Liste en tags/pills */}
      {filtered.length === 0 ? (
        <p className="text-sm text-text-muted font-[family-name:var(--font-roboto)] py-6 text-center border border-dashed border-border rounded-xl">
          {search.trim() ? "Aucun mot clé trouvé" : "Aucun mot clé pour l\u2019instant."}
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {filtered.map((tag) => (
            <div
              key={tag.id}
              className="group inline-flex items-center gap-2 bg-white border border-border rounded-full pl-4 pr-2 py-2 hover:shadow-md transition-shadow"
            >
              {/* Tag icon */}
              <svg className="w-3.5 h-3.5 text-text-muted shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 6h.008v.008H6V6z" />
              </svg>

              <span className="text-sm font-medium text-text-primary font-[family-name:var(--font-roboto)]">
                {tag.name}
              </span>

              <span className="text-[10px] text-text-muted font-[family-name:var(--font-roboto)] tabular-nums">
                {tag.productCount}
              </span>

              {Object.keys(tag.translations).length === 0 && (
                <span className="relative group/tw shrink-0">
                  <span className="flex items-center justify-center w-4 h-4 rounded-full bg-amber-100 border border-amber-300 text-amber-700 text-[9px] font-bold cursor-default select-none">⚠</span>
                  <span className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 hidden group-hover/tw:block z-50 pointer-events-none">
                    <span className="block w-40 bg-[#1A1A1A] text-white text-[11px] rounded-xl px-2.5 py-1.5 shadow-xl">
                      Aucune traduction
                      <span className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-[#1A1A1A]" />
                    </span>
                  </span>
                </span>
              )}

              {/* Actions au hover */}
              <span className="inline-flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  type="button"
                  onClick={() => { setError(""); setEditTarget(tag); }}
                  className="p-1 text-text-muted hover:text-text-primary transition-colors"
                  title="Modifier"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(tag)}
                  disabled={deletingId === tag.id || tag.productCount > 0}
                  title={tag.productCount > 0 ? "Impossible — utilisé par des produits" : "Supprimer"}
                  className="p-1 text-text-muted hover:text-[#EF4444] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                  </svg>
                </button>
              </span>
            </div>
          ))}
        </div>
      )}

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
