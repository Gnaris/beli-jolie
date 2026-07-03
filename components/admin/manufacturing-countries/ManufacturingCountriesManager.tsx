"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  deleteManufacturingCountry,
  updateManufacturingCountryDirect,
  updateManufacturingCountryPfsRef,
  updateManufacturingCountryFaireCode,
} from "@/app/actions/admin/manufacturing-countries";
import { batchUpdateTranslations } from "@/app/actions/admin/batch-translations";
import CountryEditModal, { type CountryEditModalEditMode } from "./CountryEditModal";
import TranslateAllButton from "@/components/admin/TranslateAllButton";
import { useConfirm } from "@/components/ui/ConfirmDialog";

interface CountryItem {
  id: string;
  name: string;
  isoCode: string | null;
  pfsCountryRef: string | null;
  efashionProvenanceId?: number | null;
  efashionProvenanceLabel?: string | null;
  faireCountryCode?: string | null;
  productCount: number;
  translations: Record<string, string>;
}

/** Convertit un ISO 2 lettres en drapeau emoji (🇨🇳). Fallback drapeau blanc. */
function isoToFlag(iso: string | null | undefined): string {
  if (!iso || !/^[A-Za-z]{2}$/.test(iso)) return "🏳️";
  const A = 0x1f1e6;
  const up = iso.toUpperCase();
  return String.fromCodePoint(A + up.charCodeAt(0) - 65, A + up.charCodeAt(1) - 65);
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

  const q = search.trim().toLowerCase();
  const filtered = q
    ? initialCountries.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.isoCode?.toLowerCase().includes(q) ||
          Object.values(c.translations).some((v) => v.toLowerCase().includes(q)),
      )
    : initialCountries;

  async function handleDelete(item: CountryItem) {
    if (item.productCount > 0) {
      setError(
        `« ${item.name} » est utilisé par ${item.productCount} produit${item.productCount > 1 ? "s" : ""}. Impossible de le supprimer.`,
      );
      return;
    }
    const ok = await confirm({
      type: "danger",
      title: "Supprimer ce pays ?",
      message: `Le pays « ${item.name} » sera définitivement supprimé.`,
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

  async function handleTranslateAll(translations: Record<string, Record<string, string>>) {
    const items = Object.entries(translations).map(([id, t]) => ({ id, translations: t }));
    await batchUpdateTranslations("manufacturing-country", items);
    router.refresh();
  }

  const editMode: CountryEditModalEditMode | undefined = editTarget
    ? {
        id: editTarget.id,
        name: editTarget.name,
        translations: editTarget.translations,
        isoCode: editTarget.isoCode,
        pfsCountryRef: editTarget.pfsCountryRef,
        efashionCurrentId: editTarget.efashionProvenanceId ?? null,
        faireCountryCode: editTarget.faireCountryCode ?? null,
        onSave: async (name, translations, pfs, faire) => {
          const target = editTarget;
          await updateManufacturingCountryDirect(target.id, name, pfs.isoCode, translations);
          const newRef = pfs.ref || null;
          if (newRef !== (target.pfsCountryRef ?? null)) {
            await updateManufacturingCountryPfsRef(target.id, newRef);
          }
          const newFaireCode = faire.countryCode ?? null;
          if (newFaireCode !== (target.faireCountryCode ?? null)) {
            await updateManufacturingCountryFaireCode(target.id, newFaireCode);
          }
          router.refresh();
        },
      }
    : undefined;

  return (
    <>
      {/* ── Barre outils ── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="relative w-full sm:w-80">
          <svg
            className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.6}
              d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
            />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher un pays ou un code ISO…"
            className="field-input w-full"
            style={{ paddingLeft: "2.25rem" }}
          />
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
        <p className="text-xs text-[#EF4444] font-body px-1 mb-2">{error}</p>
      )}

      {filtered.length === 0 ? (
        <p className="text-sm text-text-muted font-body py-6 text-center border border-dashed border-border rounded-2xl">
          {q ? "Aucun pays trouvé" : "Aucun pays. Commencez par en créer un ci-dessus."}
        </p>
      ) : (
        <section className="relative rounded-2xl bg-white border border-border overflow-hidden">
          <span
            aria-hidden
            className="absolute inset-x-0 top-0 h-[3px]"
            style={{ background: "linear-gradient(90deg,#34D399,#059669)" }}
          />

          {/* En-tête tableau */}
          <div className="px-6 pt-6 pb-3 flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3">
              <span
                className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] font-body"
                style={{ color: "#047857" }}
              >
                <span
                  className="w-[3px] h-[14px] rounded-[3px]"
                  style={{ background: "linear-gradient(180deg,#34D399,#059669)" }}
                />
                Liste des pays
              </span>
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10.5px] font-semibold bg-[#F5F3EE] text-[#78716C] border border-[#E7E5E4] font-body">
                {filtered.length}
              </span>
            </div>
          </div>

          {/* En-têtes colonnes (md+) */}
          <div className="hidden md:grid px-6 py-3 bg-[#FBFAF6] border-y border-border text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted font-body"
               style={{ gridTemplateColumns: "minmax(220px,1.6fr) 100px 120px 1.3fr 1.3fr 110px 120px", gap: "0.75rem" }}>
            <div>Pays</div>
            <div>Code ISO</div>
            <div className="text-center">Produits</div>
            <div>Paris Fashion Shop</div>
            <div>eFashion</div>
            <div className="text-center">Traduction</div>
            <div className="text-right">Actions</div>
          </div>

          {/* Lignes */}
          <div className="divide-y divide-border">
            {filtered.map((item) => (
              <CountryRow
                key={item.id}
                item={item}
                onEdit={() => { setError(""); setEditTarget(item); }}
                onDelete={() => handleDelete(item)}
                deleting={deletingId === item.id}
              />
            ))}
          </div>

          {/* Footer table */}
          <div className="px-6 py-3 bg-[#FBFAF6] border-t border-border flex items-center justify-between text-[12px] text-text-muted font-body flex-wrap gap-2">
            <span>{filtered.length} pays affichés</span>
            <div className="flex items-center gap-2">
              <span>Légende :</span>
              <MpPill on label="Mappé" />
              <MpPill on={false} label="Non mappé" />
            </div>
          </div>
        </section>
      )}

      {editTarget && (
        <CountryEditModal
          open={!!editTarget}
          onClose={() => setEditTarget(null)}
          editMode={editMode!}
        />
      )}
    </>
  );
}

// ────────────────────────────────────────────────────────────────
// Ligne de tableau : drapeau + nom + traduction + ISO + compteurs
// ────────────────────────────────────────────────────────────────

function CountryRow({
  item,
  onEdit,
  onDelete,
  deleting,
}: {
  item: CountryItem;
  onEdit: () => void;
  onDelete: () => void;
  deleting: boolean;
}) {
  const enName = item.translations["en"];
  return (
    <div
      className="grid grid-cols-1 md:[grid-template-columns:minmax(220px,1.6fr)_100px_120px_1.3fr_1.3fr_110px_120px] gap-3 px-6 py-4 items-center hover:bg-[#FBFAF6] transition-colors"
    >
      {/* Pays */}
      <div className="flex items-center gap-3 min-w-0">
        <span
          className="inline-flex items-center justify-center w-10 h-10 rounded-xl text-[22px] leading-none shrink-0"
          style={{
            background: "linear-gradient(135deg, #F5F3EE, #FDFCFA)",
            border: "1px solid var(--border, #E5DFD3)",
            boxShadow: "0 1px 2px rgba(0,0,0,0.04), inset 0 1px 0 rgba(255,255,255,0.6)",
          }}
          aria-hidden
        >
          {isoToFlag(item.isoCode)}
        </span>
        <div className="min-w-0">
          <div className="font-semibold text-[15px] text-text-primary truncate font-body">{item.name}</div>
          {enName && (
            <div className="text-[12px] text-text-muted truncate font-body">{enName}</div>
          )}
        </div>
      </div>

      {/* Code ISO */}
      <div>
        {item.isoCode ? (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10.5px] font-semibold bg-[#EFF6FF] text-[#1D4ED8] border border-[#BFDBFE] font-mono">
            {item.isoCode}
          </span>
        ) : (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#FEF3C7] text-[#B45309] border border-[#FDE68A] font-body" title="Code ISO manquant — cliquez sur Modifier pour l'ajouter">
            À compléter
          </span>
        )}
      </div>

      {/* Produits */}
      <div className="text-center">
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10.5px] font-semibold bg-[#F5F3EE] text-[#78716C] border border-[#E7E5E4] font-body">
          {item.productCount}
        </span>
      </div>

      {/* PFS */}
      <div>
        <MpPill on={!!item.pfsCountryRef} label={item.pfsCountryRef ?? "Non mappé"} />
      </div>

      {/* eFashion */}
      <div>
        <MpPill
          on={item.efashionProvenanceId != null}
          label={
            item.efashionProvenanceLabel ??
            (item.efashionProvenanceId != null ? `id ${item.efashionProvenanceId}` : "Non mappé")
          }
        />
      </div>

      {/* Traduction */}
      <div className="text-center">
        {Object.keys(item.translations).length === 0 ? (
          <span
            className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-amber-100 border border-amber-300 text-amber-700 text-[9px] font-bold cursor-default select-none"
            title="Aucune traduction"
            aria-label="Aucune traduction"
          >
            ⚠
          </span>
        ) : (
          <span
            className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-emerald-100 border border-emerald-300 text-emerald-700 text-[9px]"
            title="Traduit"
            aria-label="Traduit"
          >
            ✓
          </span>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-0.5">
        <button
          type="button"
          onClick={onEdit}
          className="p-2 text-text-muted hover:text-text-primary transition-colors rounded-lg hover:bg-bg-secondary"
          title="Modifier"
          aria-label={`Modifier le pays ${item.name}`}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125" />
          </svg>
        </button>
        <button
          type="button"
          onClick={onDelete}
          disabled={deleting || item.productCount > 0}
          title={item.productCount > 0 ? "Impossible — utilisé par des produits" : "Supprimer"}
          aria-label={`Supprimer le pays ${item.name}`}
          className="p-2 text-text-muted hover:text-[#EF4444] transition-colors disabled:opacity-30 disabled:cursor-not-allowed rounded-lg hover:bg-bg-secondary"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
          </svg>
        </button>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// Pastille marketplace : vert « Mappé · Label » ou gris « Non mappé »
// ────────────────────────────────────────────────────────────────

function MpPill({ on, label }: { on: boolean; label: string }) {
  if (on) {
    return (
      <span
        className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[10.5px] font-semibold border font-body max-w-full"
        style={{ background: "#F0FDF4", color: "#15803D", borderColor: "#BBF7D0" }}
        title={label}
      >
        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: "#22C55E", boxShadow: "0 0 0 3px rgba(34,197,94,0.14)" }} />
        <span className="truncate">{label}</span>
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[10.5px] font-semibold border font-body"
      style={{ background: "#FAFAF9", color: "#A8A29E", borderColor: "var(--border, #E5DFD3)" }}
    >
      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: "#D6D3D1" }} />
      <span>{label}</span>
    </span>
  );
}
