"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createTag, deleteTag } from "@/app/actions/admin/products";

interface TagItem {
  id: string;
  name: string;
  productCount: number;
}

export default function TagsManager({ initialTags }: { initialTags: TagItem[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  function handleCreate() {
    const trimmed = input.trim();
    if (!trimmed) return;
    setError("");
    startTransition(async () => {
      try {
        await createTag(trimmed);
        setInput("");
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Erreur");
      }
    });
  }

  function handleDelete(id: string, productCount: number) {
    if (productCount > 0) {
      setError(`Ce mot clé est utilisé par ${productCount} produit${productCount > 1 ? "s" : ""}. Retirez-le des produits d'abord.`);
      return;
    }
    setDeletingId(id);
    startTransition(async () => {
      try {
        await deleteTag(id);
        router.refresh();
      } catch {
        setError("Erreur lors de la suppression.");
      } finally {
        setDeletingId(null);
      }
    });
  }

  return (
    <div className="space-y-6">
      {/* Créer */}
      <div className="card p-5">
        <h2 className="font-[family-name:var(--font-poppins)] text-sm font-semibold text-text-primary mb-4">
          Ajouter un mot clé
        </h2>
        <div className="flex gap-3">
          <input
            type="text"
            value={input}
            onChange={(e) => { setInput(e.target.value); setError(""); }}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleCreate(); } }}
            placeholder="Ex : tendance, printemps, acier…"
            className="field-input flex-1"
          />
          <button
            type="button"
            onClick={handleCreate}
            disabled={!input.trim() || isPending}
            className="btn-primary shrink-0 disabled:opacity-40"
          >
            Créer
          </button>
        </div>
        {error && (
          <p className="text-xs text-error font-[family-name:var(--font-roboto)] mt-2">{error}</p>
        )}
      </div>

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
                </div>
                <button
                  type="button"
                  onClick={() => handleDelete(tag.id, tag.productCount)}
                  disabled={isPending && deletingId === tag.id}
                  className="text-xs text-text-muted hover:text-error transition-colors disabled:opacity-40 flex items-center gap-1"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                      d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                  </svg>
                  Supprimer
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
