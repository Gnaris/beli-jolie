"use client";

import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import CustomSelect from "@/components/ui/CustomSelect";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface BulkEditCategoryOption {
  id: string;
  name: string;
  subCategories: { id: string; name: string }[];
}

export interface BulkEditOptions {
  categories: BulkEditCategoryOption[];
  hsCodes: { id: string; code: string; label: string }[];
  compositions: { id: string; name: string }[];
  manufacturingCountries: { id: string; name: string }[];
  seasons: { id: string; name: string }[];
}

export interface BulkEditPayload {
  categoryId?: string;
  subCategoryIds?: string[];
  hsCodeId?: string | null;
  countryIsoCode?: string | null;
  seasonId?: string | null;
  isBestSeller?: boolean;
  compositions?: { compositionId: string; percentage: number }[];
}

interface Props {
  open: boolean;
  selectedCount: number;
  options: BulkEditOptions;
  onCancel: () => void;
  onApply: (payload: BulkEditPayload) => Promise<void> | void;
  isPending?: boolean;
}

// ─────────────────────────────────────────────
// Sous-bloc : section avec switch "modifier"
// ─────────────────────────────────────────────

function Section({
  title,
  hint,
  enabled,
  onToggle,
  children,
}: {
  title: string;
  hint?: string;
  enabled: boolean;
  onToggle: (v: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`rounded-xl border p-4 transition-colors ${
        enabled ? "border-bg-dark/30 bg-bg-primary" : "border-border bg-[#FAFAFA]"
      }`}
    >
      <label className="flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onToggle(e.target.checked)}
          className="checkbox-custom mt-0.5"
        />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-heading font-semibold text-text-primary">{title}</div>
          {hint && <div className="text-[11px] text-text-muted font-body mt-0.5">{hint}</div>}
        </div>
      </label>
      {enabled && <div className="mt-3 pl-7">{children}</div>}
    </div>
  );
}

// ─────────────────────────────────────────────
// Mini éditeur de composition (matière + %)
// ─────────────────────────────────────────────

interface CompoLine {
  compositionId: string;
  percentage: string;
}

function CompositionMiniEditor({
  lines,
  options,
  onChange,
}: {
  lines: CompoLine[];
  options: { id: string; name: string }[];
  onChange: (next: CompoLine[]) => void;
}) {
  const selectOptions = useMemo(
    () => options.map((o) => ({ value: o.id, label: o.name })),
    [options],
  );

  const total = lines.reduce((sum, l) => {
    const n = parseFloat(l.percentage);
    return sum + (isNaN(n) ? 0 : n);
  }, 0);
  const totalOk = Math.round(total * 100) === 10000;

  return (
    <div className="space-y-2">
      {lines.map((l, idx) => (
        <div key={idx} className="flex items-center gap-2">
          <div className="flex-1 min-w-0">
            <CustomSelect
              value={l.compositionId}
              onChange={(v) => onChange(lines.map((cur, i) => (i === idx ? { ...cur, compositionId: v } : cur)))}
              options={selectOptions}
              placeholder="Matière…"
              size="sm"
              searchable
            />
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <input
              type="number"
              min="0"
              max="100"
              step="0.1"
              value={l.percentage}
              onChange={(e) =>
                onChange(lines.map((cur, i) => (i === idx ? { ...cur, percentage: e.target.value } : cur)))
              }
              placeholder="%"
              className="w-16 px-2 py-1.5 text-sm text-center border border-border rounded-md bg-bg-primary focus:outline-none focus:ring-1 focus:ring-bg-dark/30"
            />
            <span className="text-xs text-text-muted">%</span>
          </div>
          {lines.length > 1 && (
            <button
              type="button"
              onClick={() => onChange(lines.filter((_, i) => i !== idx))}
              title="Retirer cette matière"
              className="shrink-0 w-7 h-7 flex items-center justify-center rounded-md border border-border bg-bg-primary hover:bg-red-50 hover:border-red-300 text-text-muted hover:text-red-600 text-sm transition-colors"
            >
              ×
            </button>
          )}
        </div>
      ))}
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => onChange([...lines, { compositionId: "", percentage: "" }])}
          className="text-xs text-text-primary hover:underline font-body"
        >
          + Ajouter une matière
        </button>
        {lines.some((l) => l.percentage) && (
          <span className={`text-xs font-body ${totalOk ? "text-green-700" : "text-amber-700"}`}>
            Total : {total}% {totalOk ? "✓" : "(doit faire 100%)"}
          </span>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Composant principal
// ─────────────────────────────────────────────

export default function BulkEditAttributesModal({
  open,
  selectedCount,
  options,
  onCancel,
  onApply,
  isPending = false,
}: Props) {
  // Quels champs modifier ?
  const [editCat, setEditCat] = useState(false);
  const [editHs, setEditHs] = useState(false);
  const [editCompo, setEditCompo] = useState(false);
  const [editCountry, setEditCountry] = useState(false);
  const [editSeason, setEditSeason] = useState(false);
  const [editBest, setEditBest] = useState(false);

  // Valeurs
  const [categoryId, setCategoryId] = useState("");
  const [subCategoryIds, setSubCategoryIds] = useState<string[]>([]);
  const [hsCodeId, setHsCodeId] = useState<string>("");
  const [compoLines, setCompoLines] = useState<CompoLine[]>([{ compositionId: "", percentage: "" }]);
  const [countryId, setCountryId] = useState<string>("");
  const [seasonId, setSeasonId] = useState<string>("");
  const [bestSeller, setBestSeller] = useState<"true" | "false">("true");
  const [error, setError] = useState<string | null>(null);

  // Sous-catégories disponibles pour la catégorie choisie
  const availableSubCats = useMemo(() => {
    if (!categoryId) return [];
    const cat = options.categories.find((c) => c.id === categoryId);
    return cat?.subCategories ?? [];
  }, [categoryId, options.categories]);

  const reset = () => {
    setEditCat(false);
    setEditHs(false);
    setEditCompo(false);
    setEditCountry(false);
    setEditSeason(false);
    setEditBest(false);
    setCategoryId("");
    setSubCategoryIds([]);
    setHsCodeId("");
    setCompoLines([{ compositionId: "", percentage: "" }]);
    setCountryId("");
    setSeasonId("");
    setBestSeller("true");
    setError(null);
  };

  const handleCancel = () => {
    reset();
    onCancel();
  };

  const handleApply = async () => {
    setError(null);

    // Au moins un champ doit être coché
    if (!editCat && !editHs && !editCompo && !editCountry && !editSeason && !editBest) {
      setError("Cochez au moins un champ à modifier.");
      return;
    }

    const payload: BulkEditPayload = {};

    if (editCat) {
      if (!categoryId) {
        setError("Choisissez une catégorie.");
        return;
      }
      payload.categoryId = categoryId;
      payload.subCategoryIds = subCategoryIds; // tableau vide = vider
    }

    if (editHs) {
      payload.hsCodeId = hsCodeId || null;
    }

    if (editCompo) {
      const cleaned = compoLines
        .filter((l) => l.compositionId && l.percentage)
        .map((l) => ({
          compositionId: l.compositionId,
          percentage: parseFloat(l.percentage),
        }));
      if (cleaned.length === 0) {
        setError("Ajoutez au moins une matière avec son pourcentage.");
        return;
      }
      if (cleaned.some((c) => isNaN(c.percentage) || c.percentage <= 0 || c.percentage > 100)) {
        setError("Chaque pourcentage doit être entre 0 et 100.");
        return;
      }
      const total = cleaned.reduce((s, c) => s + c.percentage, 0);
      if (Math.round(total * 100) !== 10000) {
        setError(`La somme des pourcentages doit faire 100% (actuel : ${total}%).`);
        return;
      }
      // Vérifier qu'on n'a pas la même matière 2 fois
      const ids = new Set<string>();
      for (const c of cleaned) {
        if (ids.has(c.compositionId)) {
          setError("Une même matière ne peut pas être ajoutée plusieurs fois.");
          return;
        }
        ids.add(c.compositionId);
      }
      payload.compositions = cleaned;
    }

    if (editCountry) {
      payload.countryIsoCode = countryId || null;
    }

    if (editSeason) {
      payload.seasonId = seasonId || null;
    }

    if (editBest) {
      payload.isBestSeller = bestSeller === "true";
    }

    await onApply(payload);
    reset();
  };

  if (!open || typeof window === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center px-4 py-8">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={isPending ? undefined : handleCancel}
      />

      {/* Panneau */}
      <div className="relative bg-bg-primary rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-border flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-heading font-bold text-text-primary">Modifier en masse</h2>
            <p className="text-sm text-text-secondary font-body mt-0.5">
              {selectedCount} produit{selectedCount > 1 ? "s" : ""} sélectionné{selectedCount > 1 ? "s" : ""}. Cochez
              les champs à modifier — les autres restent inchangés.
            </p>
          </div>
          <button
            type="button"
            onClick={handleCancel}
            disabled={isPending}
            className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg hover:bg-bg-secondary text-text-muted hover:text-text-primary transition-colors disabled:opacity-40"
            aria-label="Fermer"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body — scrollable */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-3">
          {/* Catégorie */}
          <Section
            title="Catégorie"
            hint="Catégorie principale (obligatoire) + sous-catégories (optionnel)."
            enabled={editCat}
            onToggle={(v) => {
              setEditCat(v);
              if (!v) {
                setCategoryId("");
                setSubCategoryIds([]);
              }
            }}
          >
            <div className="space-y-2">
              <CustomSelect
                value={categoryId}
                onChange={(v) => {
                  setCategoryId(v);
                  setSubCategoryIds([]); // reset les sous-cats quand on change de cat
                }}
                options={options.categories.map((c) => ({ value: c.id, label: c.name }))}
                placeholder="Choisir une catégorie…"
                searchable
              />
              {availableSubCats.length > 0 && (
                <div>
                  <div className="text-[11px] font-body text-text-muted mb-1.5">Sous-catégories</div>
                  <div className="flex flex-wrap gap-1.5">
                    {availableSubCats.map((s) => {
                      const checked = subCategoryIds.includes(s.id);
                      return (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() =>
                            setSubCategoryIds(checked ? subCategoryIds.filter((id) => id !== s.id) : [...subCategoryIds, s.id])
                          }
                          className={`px-2.5 py-1 text-xs rounded-md border transition-colors font-body ${
                            checked
                              ? "bg-bg-dark text-text-inverse border-bg-dark"
                              : "bg-bg-primary text-text-primary border-border hover:border-bg-dark/40"
                          }`}
                        >
                          {s.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </Section>

          {/* Code SH */}
          <Section
            title="Code SH (douane)"
            hint="Laisser vide pour retirer le code SH des produits cochés."
            enabled={editHs}
            onToggle={(v) => {
              setEditHs(v);
              if (!v) setHsCodeId("");
            }}
          >
            <CustomSelect
              value={hsCodeId}
              onChange={setHsCodeId}
              options={[
                { value: "", label: "— Aucun code SH —" },
                ...options.hsCodes.map((h) => ({ value: h.id, label: `${h.code} — ${h.label}` })),
              ]}
              placeholder="Choisir un code SH…"
              searchable
            />
          </Section>

          {/* Composition */}
          <Section
            title="Composition"
            hint="Remplace entièrement la composition existante des produits cochés."
            enabled={editCompo}
            onToggle={(v) => {
              setEditCompo(v);
              if (!v) setCompoLines([{ compositionId: "", percentage: "" }]);
            }}
          >
            <CompositionMiniEditor
              lines={compoLines}
              options={options.compositions}
              onChange={setCompoLines}
            />
          </Section>

          {/* Pays */}
          <Section
            title="Pays de fabrication"
            hint="Laisser vide pour retirer le pays."
            enabled={editCountry}
            onToggle={(v) => {
              setEditCountry(v);
              if (!v) setCountryId("");
            }}
          >
            <CustomSelect
              value={countryId}
              onChange={setCountryId}
              options={[
                { value: "", label: "— Aucun pays —" },
                ...options.manufacturingCountries.map((c) => ({ value: c.id, label: c.name })),
              ]}
              placeholder="Choisir un pays…"
              searchable
            />
          </Section>

          {/* Saison */}
          <Section
            title="Saison"
            hint="Laisser vide pour retirer la saison."
            enabled={editSeason}
            onToggle={(v) => {
              setEditSeason(v);
              if (!v) setSeasonId("");
            }}
          >
            <CustomSelect
              value={seasonId}
              onChange={setSeasonId}
              options={[
                { value: "", label: "— Aucune saison —" },
                ...options.seasons.map((s) => ({ value: s.id, label: s.name })),
              ]}
              placeholder="Choisir une saison…"
              searchable
            />
          </Section>

          {/* Best seller */}
          <Section
            title="Best-seller"
            enabled={editBest}
            onToggle={setEditBest}
          >
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setBestSeller("true")}
                className={`px-3 py-1.5 text-sm rounded-md border transition-colors font-body ${
                  bestSeller === "true"
                    ? "bg-[#22C55E] text-white border-[#22C55E]"
                    : "bg-bg-primary text-text-primary border-border hover:border-bg-dark/40"
                }`}
              >
                ★ Marquer best-seller
              </button>
              <button
                type="button"
                onClick={() => setBestSeller("false")}
                className={`px-3 py-1.5 text-sm rounded-md border transition-colors font-body ${
                  bestSeller === "false"
                    ? "bg-bg-dark text-text-inverse border-bg-dark"
                    : "bg-bg-primary text-text-primary border-border hover:border-bg-dark/40"
                }`}
              >
                Retirer best-seller
              </button>
            </div>
          </Section>

          {error && (
            <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm font-body px-3 py-2">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={handleCancel}
            disabled={isPending}
            className="btn-secondary"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={handleApply}
            disabled={isPending}
            className="btn-primary flex items-center gap-2"
          >
            {isPending && (
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
            )}
            Appliquer aux {selectedCount} produit{selectedCount > 1 ? "s" : ""}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
