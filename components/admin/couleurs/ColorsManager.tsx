"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { deleteColor, updateColorDirect } from "@/app/actions/admin/colors";
import { batchUpdateTranslations } from "@/app/actions/admin/batch-translations";
import EntityEditModal from "@/components/admin/EntityEditModal";
import TranslateAllButton from "@/components/admin/TranslateAllButton";
import { useConfirm } from "@/components/ui/ConfirmDialog";

interface ColorItem {
  id: string;
  name: string;
  hex: string | null;
  patternImage: string | null;
  productCount: number;
  translations: Record<string, string>;
}

export default function ColorsManager({ initialColors }: { initialColors: ColorItem[] }) {
  const router = useRouter();
  const { confirm } = useConfirm();
  const [editTarget, setEditTarget] = useState<ColorItem | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  const filtered = search.trim()
    ? initialColors.filter((c) => c.name.toLowerCase().includes(search.trim().toLowerCase()))
    : initialColors;

  async function handleDelete(color: ColorItem) {
    if (color.productCount > 0) {
      setError(`"${color.name}" est utilisée par ${color.productCount} produit${color.productCount > 1 ? "s" : ""}. Retirez-la des produits d'abord.`);
      return;
    }
    const ok = await confirm({
      type: "danger",
      title: "Supprimer cette couleur ?",
      message: `La couleur "${color.name}" sera définitivement supprimée.`,
      confirmLabel: "Supprimer",
    });
    if (!ok) return;
    setError("");
    setDeletingId(color.id);
    deleteColor(color.id)
      .then(() => router.refresh())
      .catch(() => setError("Erreur lors de la suppression."))
      .finally(() => setDeletingId(null));
  }

  async function handleSave(name: string, translations: Record<string, string>, hex?: string, patternImage?: string | null) {
    if (!editTarget) return;
    await updateColorDirect(editTarget.id, name, hex ?? null, translations, patternImage ?? null);
    router.refresh();
  }

  async function handleTranslateAll(translations: Record<string, Record<string, string>>) {
    const items = Object.entries(translations).map(([id, t]) => ({ id, translations: t }));
    await batchUpdateTranslations("color", items);
    router.refresh();
  }

  return (
    <>
      {/* Recherche + Tout traduire */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="relative">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher une couleur…"
            className="field-input w-full sm:w-72"
            style={{ paddingLeft: "2.25rem" }}
          />
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
        </div>
        <TranslateAllButton
          items={initialColors.map((c) => ({
            id: c.id,
            text: c.name,
            hasTranslations: Object.keys(c.translations).length > 0,
          }))}
          onTranslated={handleTranslateAll}
          label="Tout traduire"
          onlyMissing
        />
      </div>

      {error && (
        <p className="text-xs text-[#EF4444] font-[family-name:var(--font-roboto)] px-1">{error}</p>
      )}

      {filtered.length === 0 ? (
        <p className="text-sm text-text-muted font-[family-name:var(--font-roboto)] py-6 text-center border border-dashed border-border rounded-xl">
          {search.trim() ? "Aucune couleur trouvée" : "Aucune couleur créée"}
        </p>
      ) : (
        <ul className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
          {filtered.map((color) => (
            <li
              key={color.id}
              className="card overflow-hidden flex flex-col"
            >
              {/* Swatch */}
              <span
                className="w-full h-24 block"
                style={color.patternImage
                  ? { backgroundImage: `url(${color.patternImage})`, backgroundSize: "cover", backgroundPosition: "center" }
                  : { backgroundColor: color.hex ?? "#9CA3AF" }
                }
              />
              {/* Info */}
              <div className="px-3 py-2.5 flex flex-col gap-1 flex-1">
                <div className="flex items-center gap-1.5">
                  <p className="text-sm font-medium text-text-primary font-[family-name:var(--font-roboto)] truncate">
                    {color.name}
                  </p>
                  {Object.keys(color.translations).length === 0 && (
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
                </div>
                <p className="text-[11px] text-text-muted leading-tight">
                  {color.patternImage ? "Motif" : color.hex ?? "—"} · {color.productCount} produit{color.productCount > 1 ? "s" : ""}
                </p>
              </div>
              {/* Actions */}
              <div className="flex items-center justify-end gap-0.5 px-2 pb-2">
                <button
                  type="button"
                  onClick={() => { setError(""); setEditTarget(color); }}
                  className="p-2.5 text-text-muted hover:text-text-primary transition-colors"
                  title="Modifier"
                  aria-label={`Modifier la couleur ${color.name}`}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(color)}
                  disabled={deletingId === color.id || color.productCount > 0}
                  title={color.productCount > 0 ? "Impossible : utilisée par des produits" : "Supprimer"}
                  aria-label={`Supprimer la couleur ${color.name}`}
                  className="p-2.5 text-text-muted hover:text-[#EF4444] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                  </svg>
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <EntityEditModal
        open={!!editTarget}
        onClose={() => setEditTarget(null)}
        title="Modifier la couleur"
        initialName={editTarget?.name ?? ""}
        initialTranslations={editTarget?.translations ?? {}}
        withHex
        initialHex={editTarget?.hex ?? "#9CA3AF"}
        initialPatternImage={editTarget?.patternImage}
        onSave={handleSave}
      />
    </>
  );
}
