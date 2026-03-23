"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { deleteManufacturingCountry, updateManufacturingCountryDirect } from "@/app/actions/admin/manufacturing-countries";
import { batchUpdateTranslations } from "@/app/actions/admin/batch-translations";
import EntityEditModal from "@/components/admin/EntityEditModal";
import TranslateAllButton from "@/components/admin/TranslateAllButton";
import { useConfirm } from "@/components/ui/ConfirmDialog";

interface CountryItem {
  id: string;
  name: string;
  isoCode: string | null;
  productCount: number;
  translations: Record<string, string>;
}

export default function ManufacturingCountriesManager({
  initialCountries,
}: {
  initialCountries: CountryItem[];
}) {
  const router = useRouter();
  const { confirm } = useConfirm();
  const [editTarget, setEditTarget] = useState<CountryItem | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  const filtered = search.trim()
    ? initialCountries.filter((c) => c.name.toLowerCase().includes(search.trim().toLowerCase()) || c.isoCode?.toLowerCase().includes(search.trim().toLowerCase()))
    : initialCountries;

  async function handleDelete(item: CountryItem) {
    if (item.productCount > 0) {
      setError(`"${item.name}" est utilisé par ${item.productCount} produit${item.productCount > 1 ? "s" : ""}. Impossible de le supprimer.`);
      return;
    }
    const ok = await confirm({
      type: "danger",
      title: "Supprimer ce pays ?",
      message: `Le pays "${item.name}" sera définitivement supprimé.`,
      confirmLabel: "Supprimer",
    });
    if (!ok) return;
    setError("");
    setDeletingId(item.id);
    deleteManufacturingCountry(item.id)
      .then(() => router.refresh())
      .catch(() => setError("Erreur lors de la suppression."))
      .finally(() => setDeletingId(null));
  }

  async function handleSave(name: string, translations: Record<string, string>) {
    if (!editTarget) return;
    await updateManufacturingCountryDirect(editTarget.id, name, translations);
    router.refresh();
  }

  async function handleTranslateAll(translations: Record<string, Record<string, string>>) {
    const items = Object.entries(translations).map(([id, t]) => ({ id, translations: t }));
    await batchUpdateTranslations("manufacturing-country", items);
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
            placeholder="Rechercher un pays…"
            className="field-input w-full sm:w-72"
            style={{ paddingLeft: "2.25rem" }}
          />
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
        </div>
        <TranslateAllButton
          items={initialCountries.map((c) => ({
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
        <p className="text-xs text-[#EF4444] font-[family-name:var(--font-roboto)] px-1 mb-2">{error}</p>
      )}

      {filtered.length === 0 ? (
        <p className="text-sm text-text-muted font-[family-name:var(--font-roboto)] py-6 text-center border border-dashed border-border rounded-xl">
          {search.trim() ? "Aucun pays trouvé" : "Aucun pays. Commencez par en créer un ci-dessus."}
        </p>
      ) : (
        <div className="flex flex-wrap gap-2.5">
          {filtered.map((item) => (
            <div
              key={item.id}
              className="group card px-4 py-3 flex items-center gap-3 hover:shadow-md transition-shadow"
            >
              {/* Icône globe */}
              <span className="w-8 h-8 rounded-lg bg-[#F0F0F0] border border-border flex items-center justify-center shrink-0">
                <svg className="w-4 h-4 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418" />
                </svg>
              </span>

              {/* Nom + badges */}
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-sm font-medium text-text-primary font-[family-name:var(--font-roboto)] truncate">
                  {item.name}
                </span>
                {item.isoCode && (
                  <span className="badge badge-info text-[10px] shrink-0">
                    {item.isoCode}
                  </span>
                )}
                <span className="badge badge-neutral text-[10px] shrink-0">
                  {item.productCount}
                </span>
                {Object.keys(item.translations).length === 0 && (
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

              {/* Actions */}
              <div className="flex items-center gap-0.5 max-md:opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity ml-auto">
                <button
                  type="button"
                  onClick={() => { setError(""); setEditTarget(item); }}
                  className="p-2.5 text-text-muted hover:text-text-primary transition-colors"
                  title="Modifier"
                  aria-label={`Modifier le pays ${item.name}`}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(item)}
                  disabled={deletingId === item.id || item.productCount > 0}
                  title={item.productCount > 0 ? "Impossible — utilisé par des produits" : "Supprimer"}
                  aria-label={`Supprimer le pays ${item.name}`}
                  className="p-2.5 text-text-muted hover:text-[#EF4444] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <EntityEditModal
        open={!!editTarget}
        onClose={() => setEditTarget(null)}
        title="Modifier le pays"
        initialName={editTarget?.name ?? ""}
        initialTranslations={editTarget?.translations ?? {}}
        onSave={handleSave}
      />
    </>
  );
}
