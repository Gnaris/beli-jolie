"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { deleteSeason, updateSeasonDirect, updateSeasonPfsRefs } from "@/app/actions/admin/seasons";
import { batchUpdateTranslations } from "@/app/actions/admin/batch-translations";
import QuickCreateModal from "@/components/admin/products/QuickCreateModal";
import TranslateAllButton from "@/components/admin/TranslateAllButton";
import { useConfirm } from "@/components/ui/ConfirmDialog";

interface SeasonItem {
  id: string;
  name: string;
  pfsRefs: string[];
  productCount: number;
  translations: Record<string, string>;
}

export default function SeasonsManager({
  initialSeasons,
  allUsedPfsRefs,
}: {
  initialSeasons: SeasonItem[];
  allUsedPfsRefs: string[];
}) {
  const router = useRouter();
  const { confirm } = useConfirm();
  const [editTarget, setEditTarget] = useState<SeasonItem | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  const filtered = search.trim()
    ? initialSeasons.filter((s) =>
        s.name.toLowerCase().includes(search.trim().toLowerCase()) ||
        s.pfsRefs.some((r) => r.toLowerCase().includes(search.trim().toLowerCase()))
      )
    : initialSeasons;

  function openEdit(item: SeasonItem) {
    setError("");
    setEditTarget(item);
  }

  async function handleDelete(item: SeasonItem) {
    if (item.productCount > 0) {
      setError(`"${item.name}" est utilisée par ${item.productCount} produit${item.productCount > 1 ? "s" : ""}. Impossible de la supprimer.`);
      return;
    }
    const ok = await confirm({
      type: "danger",
      title: "Supprimer cette saison ?",
      message: `La saison "${item.name}" sera définitivement supprimée.`,
      confirmLabel: "Supprimer",
    });
    if (!ok) return;
    setError("");
    setDeletingId(item.id);
    deleteSeason(item.id)
      .then(() => router.refresh())
      .catch(() => setError("Erreur lors de la suppression."))
      .finally(() => setDeletingId(null));
  }

  async function handleSave(
    name: string,
    translations: Record<string, string>,
    _hex?: string,
    _patternImage?: string | null,
    pfs?: { refs?: string[] },
  ) {
    if (!editTarget) return;
    await updateSeasonDirect(editTarget.id, name, translations);
    const newRefs = pfs?.refs ?? [];
    const oldRefs = editTarget.pfsRefs;
    // Compare sorted arrays
    const changed = JSON.stringify([...newRefs].sort()) !== JSON.stringify([...oldRefs].sort());
    if (changed) {
      await updateSeasonPfsRefs(editTarget.id, newRefs);
    }
    router.refresh();
  }

  async function handleTranslateAll(translations: Record<string, Record<string, string>>) {
    const items = Object.entries(translations).map(([id, t]) => ({ id, translations: t }));
    await batchUpdateTranslations("season", items);
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
            placeholder="Rechercher une saison…"
            className="field-input w-full sm:w-72"
            style={{ paddingLeft: "2.25rem" }}
          />
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
        </div>
        <TranslateAllButton
          items={initialSeasons.map((s) => ({
            id: s.id,
            text: s.name,
            hasTranslations: Object.keys(s.translations).length > 0,
          }))}
          onTranslated={handleTranslateAll}
          label="Tout traduire"
          onlyMissing
        />
      </div>

      {error && (
        <p className="text-xs text-[#EF4444] font-[family-name:var(--font-roboto)] px-1 mb-2">{error}</p>
      )}

      {filtered.length === 0 ? (
        <p className="text-sm text-text-muted font-[family-name:var(--font-roboto)] py-6 text-center border border-dashed border-border rounded-xl">
          {search.trim() ? "Aucune saison trouvée" : "Aucune saison. Commencez par en créer une ci-dessus."}
        </p>
      ) : (
        <div className="border border-border rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm font-[family-name:var(--font-roboto)]">
              <thead>
                <tr className="bg-bg-secondary border-b border-border">
                  <th className="text-left text-[11px] font-semibold text-text-secondary uppercase tracking-wider px-4 py-3">Nom</th>
                  <th className="text-center text-[11px] font-semibold text-text-secondary uppercase tracking-wider px-4 py-3">Produits</th>
                  <th className="text-left text-[11px] font-semibold text-text-secondary uppercase tracking-wider px-4 py-3 hidden md:table-cell">Réfs PFS</th>
                  <th className="text-center text-[11px] font-semibold text-text-secondary uppercase tracking-wider px-4 py-3 hidden sm:table-cell">Traduction</th>
                  <th className="text-right text-[11px] font-semibold text-text-secondary uppercase tracking-wider px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((item) => (
                  <tr key={item.id} className="hover:bg-bg-secondary/50 transition-colors">
                    <td className="px-4 py-3">
                      <span className="font-medium text-text-primary">{item.name}</span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="badge badge-neutral text-[10px]">{item.productCount}</span>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      {item.pfsRefs.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {item.pfsRefs.map((ref) => (
                            <span key={ref} className="badge badge-purple text-[10px]">PFS: {ref}</span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-text-muted text-xs">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center hidden sm:table-cell">
                      {Object.keys(item.translations).length === 0 ? (
                        <span className="relative group/tw inline-flex">
                          <span className="flex items-center justify-center w-5 h-5 rounded-full bg-amber-100 border border-amber-300 text-amber-700 text-[9px] font-bold cursor-default select-none">⚠</span>
                          <span className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 hidden group-hover/tw:block z-50 pointer-events-none">
                            <span className="block w-40 bg-[#1A1A1A] text-white text-[11px] rounded-xl px-2.5 py-1.5 shadow-xl">
                              Aucune traduction
                              <span className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-[#1A1A1A]" />
                            </span>
                          </span>
                        </span>
                      ) : (
                        <span className="flex items-center justify-center w-5 h-5 rounded-full bg-emerald-100 border border-emerald-300 text-emerald-700 text-[9px] mx-auto">✓</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-0.5">
                        <button
                          type="button"
                          onClick={() => openEdit(item)}
                          className="p-2 text-text-muted hover:text-text-primary transition-colors rounded-lg hover:bg-bg-secondary"
                          title="Modifier"
                          aria-label={`Modifier la saison ${item.name}`}
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(item)}
                          disabled={deletingId === item.id || item.productCount > 0}
                          title={item.productCount > 0 ? "Impossible — utilisée par des produits" : "Supprimer"}
                          aria-label={`Supprimer la saison ${item.name}`}
                          className="p-2 text-text-muted hover:text-[#EF4444] transition-colors disabled:opacity-30 disabled:cursor-not-allowed rounded-lg hover:bg-bg-secondary"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                          </svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {editTarget && (
        <QuickCreateModal
          type="season"
          open={!!editTarget}
          onClose={() => setEditTarget(null)}
          onCreated={() => { setEditTarget(null); router.refresh(); }}
          usedPfsRefs={allUsedPfsRefs.filter((r) => !editTarget.pfsRefs.includes(r))}
          editMode={{
            id: editTarget.id,
            name: editTarget.name,
            translations: editTarget.translations,
            pfsRefs: editTarget.pfsRefs,
            onSave: handleSave,
          }}
        />
      )}
    </>
  );
}
