"use client";

import { useState } from "react";
import CustomSelect from "@/components/ui/CustomSelect";
import QuickCreateModal from "@/components/admin/products/QuickCreateModal";
import { useBackdropClose } from "@/hooks/useBackdropClose";
import {
  createCategoryQuick,
  createColorQuick,
  createCompositionQuick,
  createManufacturingCountryQuick,
  createSeasonQuick,
} from "@/app/actions/admin/quick-create";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

interface ExistingEntity {
  id: string;
  name: string;
}

interface ExistingColor extends ExistingEntity {
  hex: string | null;
  patternImage: string | null;
}

interface ExistingEntities {
  categories: (ExistingEntity & { pfsCategoryId?: string | null })[];
  colors: ExistingColor[];
  compositions: ExistingEntity[];
  countries: (ExistingEntity & { isoCode: string | null })[];
  seasons: ExistingEntity[];
}

interface EditableCategory {
  pfsName: string;
  pfsCategoryId: string;
  pfsGender: string;
  pfsFamilyId: string;
  bjEntityId: string | null;
  usedBy: number;
  pfsLabels: Record<string, string>;
}

interface EditableColor {
  pfsName: string;
  pfsReference: string;
  bjEntityId: string | null;
  usedBy: number;
  hex: string | null;
  pfsLabels: Record<string, string>;
}

interface EditableComposition {
  pfsName: string;
  pfsReference: string;
  bjEntityId: string | null;
  usedBy: number;
  pfsLabels: Record<string, string>;
}

interface EditableCountry {
  pfsName: string;
  pfsReference: string;
  bjEntityId: string | null;
  pfsLabels: Record<string, string>;
}

interface EditableSeason {
  pfsName: string;
  pfsReference: string;
  bjEntityId: string | null;
  pfsLabels: Record<string, string>;
}

interface EditableSize {
  name: string;
  usedBy: number;
  bjCategoryIds: string[];
  pfsSizeRefs: string[];
}

interface AnalyzeResult {
  totalScanned: number;
  totalNewProducts: number;
  totalExistingSkipped: number;
  missingEntities: {
    categories: { pfsName: string; pfsCategoryId: string; pfsGender?: string; pfsFamilyId?: string; suggestedName: string; usedBy: number; pfsLabels: Record<string, string> }[];
    colors: { pfsName: string; pfsReference: string; suggestedName: string; hex: string | null; usedBy: number; pfsLabels: Record<string, string> }[];
    compositions: { pfsName: string; pfsReference: string; suggestedName: string; usedBy: number; pfsLabels: Record<string, string> }[];
    countries: { pfsReference: string; suggestedName: string; pfsLabels: Record<string, string> }[];
    seasons: { pfsReference: string; suggestedName: string; pfsLabels: Record<string, string> }[];
    sizes: { name: string; usedBy: number; pfsCategoryIds: string[] }[];
  };
  existingMappings: number;
  existingEntities: ExistingEntities;
}

interface PfsValidationPanelProps {
  jobId: string;
  analyzeResult: AnalyzeResult;
  onValidated: () => void;
}

// ─────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────

export default function PfsValidationPanel({ jobId, analyzeResult, onValidated }: PfsValidationPanelProps) {
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [batchCreating, setBatchCreating] = useState<string | null>(null);

  // Editable state
  const [existingEntities, setExistingEntities] = useState<ExistingEntities>(
    analyzeResult.existingEntities,
  );

  const [editCategories, setEditCategories] = useState<EditableCategory[]>(
    analyzeResult.missingEntities.categories.map((c) => ({
      pfsName: c.pfsName,
      pfsCategoryId: c.pfsCategoryId,
      pfsGender: c.pfsGender || "WOMAN",
      pfsFamilyId: c.pfsFamilyId || "",
      bjEntityId: null,
      usedBy: c.usedBy,
      pfsLabels: c.pfsLabels || {},
    })),
  );

  const [editColors, setEditColors] = useState<EditableColor[]>(
    analyzeResult.missingEntities.colors.map((c) => ({
      pfsName: c.pfsName,
      pfsReference: c.pfsReference,
      bjEntityId: null,
      usedBy: c.usedBy,
      hex: c.hex || null,
      pfsLabels: c.pfsLabels || {},
    })),
  );

  const [editCompositions, setEditCompositions] = useState<EditableComposition[]>(
    analyzeResult.missingEntities.compositions.map((c) => ({
      pfsName: c.pfsName,
      pfsReference: c.pfsReference,
      bjEntityId: null,
      usedBy: c.usedBy,
      pfsLabels: c.pfsLabels || {},
    })),
  );

  const [editCountries, setEditCountries] = useState<EditableCountry[]>(
    (analyzeResult.missingEntities.countries ?? []).map((c) => ({
      pfsName: c.suggestedName || c.pfsReference,
      pfsReference: c.pfsReference,
      bjEntityId: null,
      pfsLabels: c.pfsLabels || {},
    })),
  );

  const [editSeasons, setEditSeasons] = useState<EditableSeason[]>(
    (analyzeResult.missingEntities.seasons ?? []).map((s) => ({
      pfsName: s.suggestedName || s.pfsReference,
      pfsReference: s.pfsReference,
      bjEntityId: null,
      pfsLabels: s.pfsLabels || {},
    })),
  );

  const [editSizes, setEditSizes] = useState<EditableSize[]>(
    (analyzeResult.missingEntities.sizes ?? []).map((s) => ({
      name: s.name,
      usedBy: s.usedBy,
      bjCategoryIds: [],
      pfsSizeRefs: [s.name],
    })),
  );

  // ── Batch create helpers ──
  async function handleBatchCreateCategories() {
    const unresolved = editCategories.filter((c) => !c.bjEntityId);
    if (unresolved.length === 0) return;
    setBatchCreating("categories");
    try {
      for (const cat of unresolved) {
        const names: Record<string, string> = { fr: cat.pfsName, ...cat.pfsLabels };
        try {
          const result = await createCategoryQuick(names, cat.pfsCategoryId, cat.pfsGender, cat.pfsFamilyId);
          setExistingEntities((prev) => ({
            ...prev,
            categories: [...prev.categories, { id: result.id, name: result.name }],
          }));
          setEditCategories((prev) =>
            prev.map((c) => c.pfsCategoryId === cat.pfsCategoryId ? { ...c, bjEntityId: result.id } : c),
          );
        } catch { /* skip */ }
      }
    } finally {
      setBatchCreating(null);
    }
  }

  async function handleBatchCreateColors() {
    const unresolved = editColors.filter((c) => !c.bjEntityId);
    if (unresolved.length === 0) return;
    setBatchCreating("colors");
    try {
      for (const col of unresolved) {
        const names: Record<string, string> = { fr: col.pfsName, ...col.pfsLabels };
        try {
          const result = await createColorQuick(names, col.hex, null, col.pfsReference);
          setExistingEntities((prev) => ({
            ...prev,
            colors: [...prev.colors, { id: result.id, name: result.name, hex: result.hex ?? null, patternImage: null }],
          }));
          setEditColors((prev) =>
            prev.map((c) => c.pfsReference === col.pfsReference ? { ...c, bjEntityId: result.id } : c),
          );
        } catch { /* skip */ }
      }
    } finally {
      setBatchCreating(null);
    }
  }

  async function handleBatchCreateCompositions() {
    const unresolved = editCompositions.filter((c) => !c.bjEntityId);
    if (unresolved.length === 0) return;
    setBatchCreating("compositions");
    try {
      for (const comp of unresolved) {
        const names: Record<string, string> = { fr: comp.pfsName, ...comp.pfsLabels };
        try {
          const result = await createCompositionQuick(names, comp.pfsReference);
          setExistingEntities((prev) => ({
            ...prev,
            compositions: [...prev.compositions, { id: result.id, name: result.name }],
          }));
          setEditCompositions((prev) =>
            prev.map((c) => c.pfsReference === comp.pfsReference ? { ...c, bjEntityId: result.id } : c),
          );
        } catch { /* skip */ }
      }
    } finally {
      setBatchCreating(null);
    }
  }

  async function handleBatchCreateCountries() {
    const unresolved = editCountries.filter((c) => !c.bjEntityId);
    if (unresolved.length === 0) return;
    setBatchCreating("countries");
    try {
      for (const ctr of unresolved) {
        const names: Record<string, string> = { fr: ctr.pfsName, ...ctr.pfsLabels };
        try {
          const result = await createManufacturingCountryQuick(names, undefined, ctr.pfsReference);
          setExistingEntities((prev) => ({
            ...prev,
            countries: [...prev.countries, { id: result.id, name: result.name, isoCode: null }],
          }));
          setEditCountries((prev) =>
            prev.map((c) => c.pfsReference === ctr.pfsReference ? { ...c, bjEntityId: result.id } : c),
          );
        } catch { /* skip */ }
      }
    } finally {
      setBatchCreating(null);
    }
  }

  async function handleBatchCreateSeasons() {
    const unresolved = editSeasons.filter((s) => !s.bjEntityId);
    if (unresolved.length === 0) return;
    setBatchCreating("seasons");
    try {
      for (const s of unresolved) {
        const names: Record<string, string> = { fr: s.pfsName, ...s.pfsLabels };
        try {
          const result = await createSeasonQuick(names, s.pfsReference);
          setExistingEntities((prev) => ({
            ...prev,
            seasons: [...prev.seasons, { id: result.id, name: result.name }],
          }));
          setEditSeasons((prev) =>
            prev.map((ss) => ss.pfsReference === s.pfsReference ? { ...ss, bjEntityId: result.id } : ss),
          );
        } catch { /* skip */ }
      }
    } finally {
      setBatchCreating(null);
    }
  }

  // ── Submit validation ──
  const handleValidate = async () => {
    const unresolved = [
      ...editCategories.filter((c) => !c.bjEntityId),
      ...editColors.filter((c) => !c.bjEntityId),
      ...editCompositions.filter((c) => !c.bjEntityId),
      ...editCountries.filter((c) => !c.bjEntityId),
      ...editSeasons.filter((s) => !s.bjEntityId),
    ];
    if (unresolved.length > 0) {
      setError(`${unresolved.length} élément(s) non lié(s). Veuillez lier ou créer chaque élément.`);
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch(`/api/admin/pfs-sync/prepare/${jobId}/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          categories: editCategories.map((c) => ({
            pfsName: c.pfsName,
            pfsCategoryId: c.pfsCategoryId,
            pfsGender: c.pfsGender,
            pfsFamilyId: c.pfsFamilyId,
            bjEntityId: c.bjEntityId,
          })),
          colors: editColors.map((c) => ({
            pfsName: c.pfsName,
            pfsReference: c.pfsReference,
            bjEntityId: c.bjEntityId,
          })),
          compositions: editCompositions.map((c) => ({
            pfsName: c.pfsName,
            pfsReference: c.pfsReference,
            bjEntityId: c.bjEntityId,
          })),
          countries: editCountries.map((c) => ({
            pfsName: c.pfsName,
            pfsReference: c.pfsReference,
            bjEntityId: c.bjEntityId,
          })),
          seasons: editSeasons.map((s) => ({
            pfsName: s.pfsName,
            pfsReference: s.pfsReference,
            bjEntityId: s.bjEntityId,
          })),
          sizes: editSizes.map((s) => ({
            name: s.name,
            bjCategoryIds: s.bjCategoryIds,
            pfsSizeRefs: s.pfsSizeRefs,
          })),
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Erreur lors de la validation");
        return;
      }

      onValidated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur réseau");
    } finally {
      setSubmitting(false);
    }
  };

  // ── Progress ──
  const total = editCategories.length + editColors.length + editCompositions.length + editCountries.length + editSeasons.length;
  const resolved = [
    ...editCategories.filter((c) => !!c.bjEntityId),
    ...editColors.filter((c) => !!c.bjEntityId),
    ...editCompositions.filter((c) => !!c.bjEntityId),
    ...editCountries.filter((c) => !!c.bjEntityId),
    ...editSeasons.filter((s) => !!s.bjEntityId),
  ].length;

  return (
    <div className="space-y-6">
      {/* Summary card */}
      <div className="card p-6">
        <h2 className="font-heading font-semibold text-text-primary mb-2">
          Résultat de l&apos;analyse
        </h2>
        <div className="flex flex-wrap gap-4 text-sm text-text-secondary">
          <span>{analyzeResult.totalScanned} produits analysés</span>
          <span>{analyzeResult.totalNewProducts} nouveaux produits</span>
          <span>{analyzeResult.totalExistingSkipped} déjà existants</span>
          <span>{analyzeResult.existingMappings} mappings existants</span>
        </div>
        <div className="flex flex-wrap gap-2 mt-4">
          {total === 0 && (
            <span className="badge badge-success">Toutes les entités sont mappées</span>
          )}
          {editCategories.length > 0 && (
            <span className="badge badge-warning">{editCategories.length} catégorie{editCategories.length > 1 ? "s" : ""}</span>
          )}
          {editColors.length > 0 && (
            <span className="badge badge-info">{editColors.length} couleur{editColors.length > 1 ? "s" : ""}</span>
          )}
          {editCompositions.length > 0 && (
            <span className="badge badge-neutral">{editCompositions.length} composition{editCompositions.length > 1 ? "s" : ""}</span>
          )}
          {editCountries.length > 0 && (
            <span className="badge badge-purple">{editCountries.length} pays</span>
          )}
          {editSeasons.length > 0 && (
            <span className="badge badge-info">{editSeasons.length} saison{editSeasons.length > 1 ? "s" : ""}</span>
          )}
          {editSizes.length > 0 && (
            <span className="badge badge-neutral">{editSizes.length} taille{editSizes.length > 1 ? "s" : ""}</span>
          )}
        </div>
      </div>

      {error && (
        <div className="bg-[#EF4444]/5 border border-[#EF4444]/20 text-[#EF4444] px-4 py-3 rounded-xl text-sm">
          {error}
        </div>
      )}

      {/* Entity sections */}
      {editCategories.length > 0 && (
        <GridValidationSection title="Catégories non reconnues" count={editCategories.length} unresolvedCount={editCategories.filter((c) => !c.bjEntityId).length} onBatchCreate={handleBatchCreateCategories} batchCreating={batchCreating !== null} batchActive={batchCreating === "categories"}>
          {editCategories.map((cat, idx) => (
            <CompactEntityCard key={`cat-${idx}`} pfsName={cat.pfsName} usedBy={cat.usedBy} bjEntityId={cat.bjEntityId} existingOptions={existingEntities.categories} modalType="category" pfsCategoryId={cat.pfsCategoryId} pfsCategoryGender={cat.pfsGender} pfsCategoryFamilyId={cat.pfsFamilyId}
              onBjEntityIdChange={(id) => { const u = [...editCategories]; u[idx] = { ...u[idx], bjEntityId: id }; setEditCategories(u); }}
              onEntityCreated={(entity) => { setExistingEntities((prev) => ({ ...prev, categories: [...prev.categories, { id: entity.id, name: entity.name }] })); const u = [...editCategories]; u[idx] = { ...u[idx], bjEntityId: entity.id }; setEditCategories(u); }}
            />
          ))}
        </GridValidationSection>
      )}

      {editColors.length > 0 && (
        <GridValidationSection title="Couleurs non reconnues" count={editColors.length} unresolvedCount={editColors.filter((c) => !c.bjEntityId).length} onBatchCreate={handleBatchCreateColors} batchCreating={batchCreating !== null} batchActive={batchCreating === "colors"}>
          {editColors.map((col, idx) => (
            <CompactColorCard key={`col-${idx}`} color={col} existingColors={existingEntities.colors}
              onBjEntityIdChange={(id) => { const u = [...editColors]; u[idx] = { ...u[idx], bjEntityId: id }; setEditColors(u); }}
              onEntityCreated={(entity) => { setExistingEntities((prev) => ({ ...prev, colors: [...prev.colors, { id: entity.id, name: entity.name, hex: entity.hex ?? null, patternImage: null }] })); const u = [...editColors]; u[idx] = { ...u[idx], bjEntityId: entity.id }; setEditColors(u); }}
            />
          ))}
        </GridValidationSection>
      )}

      <GridValidationSection title="Compositions" count={editCompositions.length} allClearMessage="Toutes les compositions sont déjà présentes." unresolvedCount={editCompositions.filter((c) => !c.bjEntityId).length} onBatchCreate={handleBatchCreateCompositions} batchCreating={batchCreating !== null} batchActive={batchCreating === "compositions"}>
        {editCompositions.map((comp, idx) => (
          <CompactEntityCard key={comp.pfsReference} pfsName={comp.pfsName} pfsRef={comp.pfsReference} usedBy={comp.usedBy} bjEntityId={comp.bjEntityId} existingOptions={existingEntities.compositions} modalType="composition"
            onBjEntityIdChange={(id) => { const u = [...editCompositions]; u[idx] = { ...u[idx], bjEntityId: id }; setEditCompositions(u); }}
            onEntityCreated={(entity) => { setExistingEntities((prev) => ({ ...prev, compositions: [...prev.compositions, { id: entity.id, name: entity.name }] })); const u = [...editCompositions]; u[idx] = { ...u[idx], bjEntityId: entity.id }; setEditCompositions(u); }}
          />
        ))}
      </GridValidationSection>

      <GridValidationSection title="Pays de fabrication" count={editCountries.length} allClearMessage="Tous les pays sont déjà présents." unresolvedCount={editCountries.filter((c) => !c.bjEntityId).length} onBatchCreate={handleBatchCreateCountries} batchCreating={batchCreating !== null} batchActive={batchCreating === "countries"}>
        {editCountries.map((ctr, idx) => (
          <CompactEntityCard key={ctr.pfsReference} pfsName={ctr.pfsName} pfsRef={ctr.pfsReference} bjEntityId={ctr.bjEntityId} existingOptions={existingEntities.countries} modalType="country"
            onBjEntityIdChange={(id) => { const u = [...editCountries]; u[idx] = { ...u[idx], bjEntityId: id }; setEditCountries(u); }}
            onEntityCreated={(entity) => { setExistingEntities((prev) => ({ ...prev, countries: [...prev.countries, { id: entity.id, name: entity.name, isoCode: null }] })); const u = [...editCountries]; u[idx] = { ...u[idx], bjEntityId: entity.id }; setEditCountries(u); }}
          />
        ))}
      </GridValidationSection>

      <GridValidationSection title="Saisons / Collections" count={editSeasons.length} allClearMessage="Toutes les saisons sont déjà présentes." unresolvedCount={editSeasons.filter((s) => !s.bjEntityId).length} onBatchCreate={handleBatchCreateSeasons} batchCreating={batchCreating !== null} batchActive={batchCreating === "seasons"}>
        {editSeasons.map((s, idx) => (
          <CompactEntityCard key={s.pfsReference} pfsName={s.pfsName} pfsRef={s.pfsReference} bjEntityId={s.bjEntityId} existingOptions={existingEntities.seasons} modalType="season"
            onBjEntityIdChange={(id) => { const u = [...editSeasons]; u[idx] = { ...u[idx], bjEntityId: id }; setEditSeasons(u); }}
            onEntityCreated={(entity) => { setExistingEntities((prev) => ({ ...prev, seasons: [...prev.seasons, { id: entity.id, name: entity.name }] })); const u = [...editSeasons]; u[idx] = { ...u[idx], bjEntityId: entity.id }; setEditSeasons(u); }}
          />
        ))}
      </GridValidationSection>

      <GridValidationSection title="Tailles" count={editSizes.length} allClearMessage="Toutes les tailles sont déjà présentes.">
        {editSizes.map((s, idx) => (
          <CompactSizeCard key={s.name} size={s} availableCategories={existingEntities.categories}
            onChange={(updated) => { const list = [...editSizes]; list[idx] = updated; setEditSizes(list); }}
          />
        ))}
      </GridValidationSection>

      {/* Progress + actions */}
      {total > 0 && (
        <div className="flex items-center gap-3 text-sm">
          <div className="flex-1 bg-bg-secondary rounded-full h-2">
            <div className="h-2 bg-[#22C55E] rounded-full transition-all" style={{ width: `${(resolved / total) * 100}%` }} />
          </div>
          <span className="text-text-secondary shrink-0">{resolved}/{total} résolus</span>
        </div>
      )}

      <div className="flex gap-3 flex-wrap">
        <button onClick={handleValidate} disabled={submitting} className="btn-primary">
          {submitting ? (
            <>
              <svg className="animate-spin w-5 h-5 mr-2 inline" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Validation...
            </>
          ) : (
            <>
              <svg className="w-5 h-5 mr-2 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Valider et lancer la préparation
            </>
          )}
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────

function GridValidationSection({
  title, count, allClearMessage, children,
  unresolvedCount, onBatchCreate, batchCreating, batchActive,
}: {
  title: string;
  count: number;
  allClearMessage?: string;
  children: React.ReactNode;
  unresolvedCount?: number;
  onBatchCreate?: () => void;
  batchCreating?: boolean;
  batchActive?: boolean;
}) {
  return (
    <div className="card p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-heading font-semibold text-text-primary text-sm flex items-center gap-2">
          {title}
          {count > 0 ? (
            <span className="text-xs font-normal text-text-secondary">({count})</span>
          ) : (
            <span className="badge badge-success text-[10px]">OK</span>
          )}
        </h3>
        {onBatchCreate && unresolvedCount !== undefined && unresolvedCount > 0 && (
          <button
            type="button"
            onClick={onBatchCreate}
            disabled={batchCreating}
            className="flex items-center gap-1.5 text-[11px] font-medium text-text-inverse bg-bg-dark hover:bg-black px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
          >
            {batchActive ? (
              <>
                <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                </svg>
                Création...
              </>
            ) : (
              <>
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                Créer tout ({unresolvedCount})
              </>
            )}
          </button>
        )}
      </div>
      {count === 0 ? (
        <p className="text-xs text-text-secondary">{allClearMessage ?? "Aucun élément manquant."}</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
          {children}
        </div>
      )}
    </div>
  );
}

function CompactEntityCard({
  pfsName, pfsRef, usedBy, bjEntityId, existingOptions, modalType,
  onBjEntityIdChange, onEntityCreated,
  pfsCategoryId: propPfsCategoryId, pfsCategoryGender, pfsCategoryFamilyId,
}: {
  pfsName: string;
  pfsRef?: string;
  usedBy?: number;
  bjEntityId: string | null;
  existingOptions: { id: string; name: string }[];
  modalType: "category" | "composition" | "country" | "season";
  onBjEntityIdChange: (id: string | null) => void;
  onEntityCreated: (entity: { id: string; name: string; hex?: string | null }) => void;
  pfsCategoryId?: string;
  pfsCategoryGender?: string;
  pfsCategoryFamilyId?: string;
}) {
  const [showModal, setShowModal] = useState(false);
  const isResolved = !!bjEntityId;

  return (
    <div className={`border rounded-xl p-3 flex flex-col gap-2.5 bg-bg-primary transition-colors ${isResolved ? "border-[#22C55E]/30 bg-[#22C55E]/[0.03]" : "border-[#F59E0B]/40"}`}>
      <div className="flex items-start gap-1.5 min-w-0">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-text-primary truncate leading-tight" title={pfsName}>{pfsName}</p>
          {pfsRef && pfsRef !== pfsName && <p className="text-[10px] text-text-secondary font-mono truncate">{pfsRef}</p>}
          {usedBy !== undefined && usedBy > 0 && <p className="text-[10px] text-text-secondary">{usedBy} produit{usedBy > 1 ? "s" : ""}</p>}
        </div>
        <span className={`shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${isResolved ? "bg-[#22C55E]/15 text-[#22C55E]" : "bg-[#F59E0B]/15 text-[#F59E0B]"}`}>
          {isResolved ? "✓" : "!"}
        </span>
      </div>

      {existingOptions.length > 0 ? (
        <CustomSelect
          options={existingOptions.map((opt) => ({ value: opt.id, label: opt.name }))}
          value={bjEntityId || ""}
          onChange={(val) => onBjEntityIdChange(val || null)}
          placeholder="Lier à un existant..."
          size="sm"
          searchable
        />
      ) : (
        <p className="text-[10px] text-[#F59E0B]">Aucun existant — créez-en un ci-dessous.</p>
      )}

      <button type="button" onClick={() => setShowModal(true)} className="w-full flex items-center justify-center gap-1.5 text-[10px] font-medium text-text-secondary border border-dashed border-border rounded-lg px-2 py-1.5 hover:border-text-secondary hover:text-text-primary transition-colors">
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
        </svg>
        Créer nouveau
      </button>

      <QuickCreateModal
        type={modalType}
        open={showModal}
        onClose={() => setShowModal(false)}
        onCreated={(entity) => onEntityCreated(entity)}
        defaultName={pfsName}
        defaultPfsRef={pfsRef}
        defaultPfsCategoryId={propPfsCategoryId}
        defaultPfsCategoryGender={pfsCategoryGender}
        defaultPfsCategoryFamilyId={pfsCategoryFamilyId}
      />
    </div>
  );
}

function CompactColorCard({
  color, existingColors, onBjEntityIdChange, onEntityCreated,
}: {
  color: EditableColor;
  existingColors: ExistingColor[];
  onBjEntityIdChange: (id: string | null) => void;
  onEntityCreated: (entity: { id: string; name: string; hex?: string | null }) => void;
}) {
  const [showModal, setShowModal] = useState(false);
  const isResolved = !!color.bjEntityId;
  const selected = color.bjEntityId ? existingColors.find((c) => c.id === color.bjEntityId) : null;

  return (
    <div className={`border rounded-xl p-3 flex flex-col gap-2.5 bg-bg-primary transition-colors ${isResolved ? "border-[#22C55E]/30 bg-[#22C55E]/[0.03]" : "border-[#F59E0B]/40"}`}>
      <div className="flex items-start gap-1.5 min-w-0">
        <div className="w-4 h-4 rounded-full border border-border shrink-0 mt-0.5" style={{ backgroundColor: color.hex || "#9CA3AF" }} />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-text-primary truncate leading-tight" title={color.pfsName}>{color.pfsName}</p>
          <p className="text-[10px] text-text-secondary font-mono truncate">{color.pfsReference}</p>
          <p className="text-[10px] text-text-secondary">{color.usedBy} produit{color.usedBy > 1 ? "s" : ""}</p>
        </div>
        <span className={`shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${isResolved ? "bg-[#22C55E]/15 text-[#22C55E]" : "bg-[#F59E0B]/15 text-[#F59E0B]"}`}>
          {isResolved ? "✓" : "!"}
        </span>
      </div>

      {existingColors.length === 0 ? (
        <p className="text-[10px] text-[#F59E0B]">Aucune couleur existante — créez-en une ci-dessous.</p>
      ) : (
        <div className="space-y-1.5">
          <CustomSelect
            options={existingColors.map((opt) => ({ value: opt.id, label: opt.name }))}
            value={color.bjEntityId || ""}
            onChange={(val) => onBjEntityIdChange(val || null)}
            placeholder="Lier à une couleur..."
            size="sm"
            searchable
          />
          {selected && (
            <div className="flex items-center gap-1.5">
              <div className="w-4 h-4 rounded-full border border-border shrink-0"
                style={selected.patternImage ? { backgroundImage: `url(${selected.patternImage})`, backgroundSize: "cover" } : { backgroundColor: selected.hex || "#9CA3AF" }}
              />
              <span className="text-[10px] text-text-secondary truncate">{selected.name}</span>
            </div>
          )}
        </div>
      )}

      <button type="button" onClick={() => setShowModal(true)} className="w-full py-1.5 text-[10px] font-medium text-text-secondary border border-dashed border-border rounded-lg hover:border-text-secondary hover:text-text-primary transition-colors">
        + Créer une nouvelle couleur
      </button>

      <QuickCreateModal
        type="color"
        open={showModal}
        onClose={() => setShowModal(false)}
        onCreated={(entity) => { onEntityCreated(entity); setShowModal(false); }}
        defaultName={color.pfsName}
        defaultPfsRef={color.pfsReference}
        defaultHex={color.hex}
      />
    </div>
  );
}

function CompactSizeCard({ size, availableCategories, onChange }: {
  size: EditableSize;
  availableCategories: { id: string; name: string }[];
  onChange: (updated: EditableSize) => void;
}) {
  const [showModal, setShowModal] = useState(false);

  return (
    <div className="border border-border rounded-xl p-3 flex flex-col gap-2 bg-bg-primary">
      <div className="flex items-start gap-1.5 min-w-0">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="font-mono font-bold text-sm text-text-primary bg-bg-secondary px-2 py-0.5 rounded-md shrink-0">{size.name}</span>
            {size.usedBy > 0 && <span className="text-[10px] text-text-secondary">{size.usedBy} prod.</span>}
          </div>
          <div className="mt-1 space-y-0.5">
            {size.pfsSizeRefs.length > 0 && (
              <p className="text-[10px] text-text-secondary">Paris Fashion Shop : <span className="font-mono">{size.pfsSizeRefs.join(", ")}</span></p>
            )}
            {size.bjCategoryIds.length > 0 && (
              <p className="text-[10px] text-text-secondary">{size.bjCategoryIds.length} catégorie{size.bjCategoryIds.length > 1 ? "s" : ""}</p>
            )}
          </div>
        </div>
        <span className="shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-[#22C55E]/15 text-[#22C55E]">✓</span>
      </div>

      <button type="button" onClick={() => setShowModal(true)} className="w-full text-left text-[11px] font-medium text-text-secondary border border-border rounded-lg px-2 py-1.5 bg-bg-secondary hover:bg-bg-primary hover:text-text-primary transition-colors">
        Configurer...
      </button>

      {showModal && (
        <CreateSizeModal size={size} availableCategories={availableCategories}
          onSave={(updated) => { onChange(updated); setShowModal(false); }}
          onClose={() => setShowModal(false)}
        />
      )}
    </div>
  );
}

function CreateSizeModal({ size, availableCategories, onSave, onClose }: {
  size: EditableSize;
  availableCategories: { id: string; name: string }[];
  onSave: (updated: EditableSize) => void;
  onClose: () => void;
}) {
  const backdrop = useBackdropClose(onClose);
  const [name, setName] = useState(size.name);
  const [bjCategoryIds, setBjCategoryIds] = useState<string[]>(size.bjCategoryIds);
  const [pfsSizeRefs, setPfsSizeRefs] = useState<string[]>(size.pfsSizeRefs);
  const [newPfsRef, setNewPfsRef] = useState("");

  const addPfsRef = () => {
    const ref = newPfsRef.trim();
    if (ref && !pfsSizeRefs.includes(ref)) setPfsSizeRefs((prev) => [...prev, ref]);
    setNewPfsRef("");
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60" onMouseDown={backdrop.onMouseDown} onMouseUp={backdrop.onMouseUp}>
      <div className="bg-bg-primary border border-border rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="p-6 space-y-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="font-heading font-semibold text-text-primary">Créer une taille</h2>
              <p className="text-xs text-text-secondary mt-0.5">
                Réf. Paris Fashion Shop : <span className="font-mono font-semibold">{size.name}</span>
                {size.usedBy > 0 && <span> — {size.usedBy} produit{size.usedBy > 1 ? "s" : ""}</span>}
              </p>
            </div>
            <button type="button" onClick={onClose} className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg hover:bg-bg-secondary transition-colors" aria-label="Fermer">
              <svg className="w-4 h-4 text-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="space-y-1.5">
            <label className="field-label">Nom de la taille (BJ) <span className="text-[#EF4444]">*</span></label>
            <input type="text" className="field-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex : S, M, XL, TU..." autoFocus />
          </div>

          <div className="space-y-2">
            <label className="field-label">Références Paris Fashion Shop liées</label>
            <div className="flex gap-2">
              <input type="text" className="field-input flex-1" value={newPfsRef} onChange={(e) => setNewPfsRef(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addPfsRef(); } }}
                placeholder="Ex : XS, S, M..."
              />
              <button type="button" onClick={addPfsRef} className="btn-secondary shrink-0 text-sm px-3">Ajouter</button>
            </div>
            {pfsSizeRefs.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {pfsSizeRefs.map((ref) => (
                  <span key={ref} className="inline-flex items-center gap-1.5 text-xs bg-bg-secondary border border-border rounded-full px-2.5 py-1">
                    <span className="font-mono font-semibold text-text-primary">{ref}</span>
                    <button type="button" onClick={() => setPfsSizeRefs((prev) => prev.filter((r) => r !== ref))} className="text-[#EF4444] opacity-60 hover:opacity-100 transition-opacity leading-none" aria-label={`Retirer ${ref}`}>×</button>
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <label className="field-label">Catégories BJ</label>
            {availableCategories.filter((c) => !bjCategoryIds.includes(c.id)).length > 0 && (
              <CustomSelect
                options={availableCategories.filter((c) => !bjCategoryIds.includes(c.id)).map((c) => ({ value: c.id, label: c.name }))}
                value="" onChange={(catId) => { if (catId && !bjCategoryIds.includes(catId)) setBjCategoryIds((prev) => [...prev, catId]); }}
                placeholder="Ajouter une catégorie..." searchable
              />
            )}
            {bjCategoryIds.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {bjCategoryIds.map((catId) => {
                  const cat = availableCategories.find((c) => c.id === catId);
                  return (
                    <span key={catId} className="inline-flex items-center gap-1 text-xs bg-[#22C55E]/10 text-[#22C55E] border border-[#22C55E]/20 rounded-full px-2.5 py-1">
                      {cat?.name ?? catId}
                      <button type="button" onClick={() => setBjCategoryIds((prev) => prev.filter((id) => id !== catId))} className="opacity-60 hover:opacity-100 transition-opacity leading-none" aria-label={`Retirer ${cat?.name ?? catId}`}>×</button>
                    </span>
                  );
                })}
              </div>
            )}
          </div>

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">Annuler</button>
            <button type="button" onClick={() => { if (name.trim()) onSave({ ...size, name: name.trim(), bjCategoryIds, pfsSizeRefs }); }} disabled={!name.trim()} className="btn-primary flex-1">Enregistrer</button>
          </div>
        </div>
      </div>
    </div>
  );
}
