"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createCatalog } from "@/app/actions/admin/catalogs";
import { useLoadingOverlay } from "@/components/ui/LoadingOverlay";

export default function CreateCatalogButton() {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const { showLoading, hideLoading } = useLoadingOverlay();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    showLoading();
    startTransition(async () => {
      try {
        const catalog = await createCatalog(title.trim());
        setOpen(false);
        setTitle("");
        router.push(`/admin/catalogues/${catalog.id}`);
      } finally {
        hideLoading();
      }
    });
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-4 h-9 sm:h-10 rounded-xl bg-bg-dark text-text-inverse text-xs sm:text-sm font-medium font-body hover:opacity-90 transition-all shrink-0"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4.5v15m7.5-7.5h-15" />
        </svg>
        <span className="sm:hidden">Nouveau</span>
        <span className="hidden sm:inline">Nouveau catalogue</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-bg-primary rounded-2xl shadow-xl w-full max-w-md p-6">
            <h2 className="font-heading font-semibold text-text-primary text-lg mb-4">
              Nouveau catalogue
            </h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="field-label">Titre du catalogue</label>
                <input
                  type="text"
                  className="field-input"
                  placeholder="ex: Nouveautés Été 2026"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  autoFocus
                  required
                />
              </div>
              <div className="flex gap-3 justify-end pt-2">
                <button
                  type="button"
                  onClick={() => { setOpen(false); setTitle(""); }}
                  className="btn-secondary"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={isPending || !title.trim()}
                  className="btn-primary disabled:opacity-50"
                >
                  {isPending ? "Création…" : "Créer"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
