"use client";

import { useState } from "react";
import CustomSelect from "@/components/ui/CustomSelect";

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
  categories: ExistingEntity[];
  colors: ExistingColor[];
  compositions: ExistingEntity[];
}

interface EditableCategory {
  efashionName: string;
  efashionId?: number;
  bjEntityId: string | null;
  usedBy: number;
}

interface EditableColor {
  efashionName: string;
  bjEntityId: string | null;
  usedBy: number;
  hex: string | null;
}

interface EditableComposition {
  efashionName: string;
  bjEntityId: string | null;
  usedBy: number;
}

interface AnalyzeResult {
  totalScanned: number;
  totalNewProducts: number;
  totalExistingSkipped: number;
  missingEntities: {
    categories: { efashionName: string; efashionId?: number; suggestedName: string; usedBy: number }[];
    colors: { efashionName: string; suggestedName: string; hex: string | null; usedBy: number }[];
    compositions: { efashionName: string; suggestedName: string; usedBy: number }[];
  };
  existingMappings: number;
  existingEntities: ExistingEntities;
}

interface EfashionValidationPanelProps {
  jobId: string;
  analyzeResult: AnalyzeResult;
  onValidated: () => void;
}

type Tab = "categories" | "colors" | "compositions";

// ─────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────

export default function EfashionValidationPanel({ jobId, analyzeResult, onValidated }: EfashionValidationPanelProps) {
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [tab, setTab] = useState<Tab>("categories");

  const [existingEntities] = useState<ExistingEntities>(
    analyzeResult.existingEntities,
  );

  const [editCategories, setEditCategories] = useState<EditableCategory[]>(
    analyzeResult.missingEntities.categories.map((c) => ({
      efashionName: c.efashionName,
      efashionId: c.efashionId,
      bjEntityId: null,
      usedBy: c.usedBy,
    })),
  );

  const [editColors, setEditColors] = useState<EditableColor[]>(
    analyzeResult.missingEntities.colors.map((c) => ({
      efashionName: c.efashionName,
      bjEntityId: null,
      usedBy: c.usedBy,
      hex: c.hex || null,
    })),
  );

  const [editCompositions, setEditCompositions] = useState<EditableComposition[]>(
    analyzeResult.missingEntities.compositions.map((c) => ({
      efashionName: c.efashionName,
      bjEntityId: null,
      usedBy: c.usedBy,
    })),
  );

  const totalMissing = editCategories.length + editColors.length + editCompositions.length;

  // ── Submit all mappings ──
  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);

    try {
      // Build mappings array
      const mappings: {
        type: string;
        efashionName: string;
        efashionId?: number;
        bjEntityId?: string;
        name?: string;
        hex?: string | null;
      }[] = [];

      for (const cat of editCategories) {
        mappings.push({
          type: "category",
          efashionName: cat.efashionName,
          efashionId: cat.efashionId,
          bjEntityId: cat.bjEntityId || undefined,
          name: cat.bjEntityId ? undefined : cat.efashionName,
        });
      }

      for (const col of editColors) {
        mappings.push({
          type: "color",
          efashionName: col.efashionName,
          bjEntityId: col.bjEntityId || undefined,
          name: col.bjEntityId ? undefined : col.efashionName,
          hex: col.hex,
        });
      }

      for (const comp of editCompositions) {
        mappings.push({
          type: "composition",
          efashionName: comp.efashionName,
          bjEntityId: comp.bjEntityId || undefined,
          name: comp.bjEntityId ? undefined : comp.efashionName,
        });
      }

      const res = await fetch("/api/admin/efashion-sync/create-entities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, mappings }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Erreur lors de la création des entités");
        return;
      }

      onValidated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur réseau");
    } finally {
      setSubmitting(false);
    }
  };

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: "categories", label: "Catégories", count: editCategories.length },
    { key: "colors", label: "Couleurs", count: editColors.length },
    { key: "compositions", label: "Compositions", count: editCompositions.length },
  ];

  if (totalMissing === 0) {
    return (
      <div className="card p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#22C55E]/10 flex items-center justify-center shrink-0">
            <svg className="w-5 h-5 text-[#22C55E]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-medium text-text-primary">Aucune entité manquante</p>
            <p className="text-xs text-text-secondary mt-0.5">
              Toutes les catégories, couleurs et compositions sont déjà mappées.
            </p>
          </div>
        </div>
        <button onClick={handleSubmit} disabled={submitting} className="btn-primary">
          {submitting ? "Lancement..." : "Continuer la préparation"}
        </button>
      </div>
    );
  }

  return (
    <div className="card space-y-0 overflow-hidden">
      {/* Summary header */}
      <div className="p-6 border-b border-border">
        <h2 className="text-lg font-semibold text-text-primary font-heading">
          Validation des entités
        </h2>
        <p className="text-sm text-text-secondary font-body mt-1">
          {analyzeResult.totalNewProducts} nouveaux produits détectés sur {analyzeResult.totalScanned} analysés.
          {totalMissing > 0 && ` ${totalMissing} entité(s) manquante(s) à mapper ou créer.`}
        </p>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              tab === t.key
                ? "border-text-primary text-text-primary"
                : "border-transparent text-text-secondary hover:text-text-primary"
            }`}
          >
            {t.label}
            {t.count > 0 && (
              <span className="badge badge-warning text-[10px]">{t.count}</span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="p-6 space-y-4 max-h-[500px] overflow-y-auto">
        {tab === "categories" && (
          editCategories.length === 0 ? (
            <p className="text-sm text-text-secondary">Toutes les catégories sont déjà mappées.</p>
          ) : (
            <div className="space-y-3">
              {editCategories.map((cat, idx) => (
                <div key={cat.efashionName} className="flex items-center gap-3 p-3 bg-bg-secondary rounded-xl">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-text-primary truncate">{cat.efashionName}</p>
                    <p className="text-xs text-text-muted">{cat.usedBy} produit(s)</p>
                  </div>
                  <div className="w-64">
                    <CustomSelect
                      value={cat.bjEntityId || ""}
                      onChange={(val) => {
                        setEditCategories((prev) =>
                          prev.map((c, i) => i === idx ? { ...c, bjEntityId: val || null } : c),
                        );
                      }}
                      options={[
                        { value: "", label: "Créer automatiquement" },
                        ...existingEntities.categories.map((c) => ({ value: c.id, label: c.name })),
                      ]}
                      placeholder="Mapper vers..."
                    />
                  </div>
                </div>
              ))}
            </div>
          )
        )}

        {tab === "colors" && (
          editColors.length === 0 ? (
            <p className="text-sm text-text-secondary">Toutes les couleurs sont déjà mappées.</p>
          ) : (
            <div className="space-y-3">
              {editColors.map((col, idx) => (
                <div key={col.efashionName} className="flex items-center gap-3 p-3 bg-bg-secondary rounded-xl">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    {col.hex && (
                      <div
                        className="w-5 h-5 rounded-full border border-border shrink-0"
                        style={{ backgroundColor: col.hex }}
                      />
                    )}
                    <div>
                      <p className="text-sm font-medium text-text-primary truncate">{col.efashionName}</p>
                      <p className="text-xs text-text-muted">{col.usedBy} produit(s)</p>
                    </div>
                  </div>
                  <div className="w-64">
                    <CustomSelect
                      value={col.bjEntityId || ""}
                      onChange={(val) => {
                        setEditColors((prev) =>
                          prev.map((c, i) => i === idx ? { ...c, bjEntityId: val || null } : c),
                        );
                      }}
                      options={[
                        { value: "", label: "Créer automatiquement" },
                        ...existingEntities.colors.map((c) => ({ value: c.id, label: c.name })),
                      ]}
                      placeholder="Mapper vers..."
                    />
                  </div>
                </div>
              ))}
            </div>
          )
        )}

        {tab === "compositions" && (
          editCompositions.length === 0 ? (
            <p className="text-sm text-text-secondary">Toutes les compositions sont déjà mappées.</p>
          ) : (
            <div className="space-y-3">
              {editCompositions.map((comp, idx) => (
                <div key={comp.efashionName} className="flex items-center gap-3 p-3 bg-bg-secondary rounded-xl">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-text-primary truncate">{comp.efashionName}</p>
                    <p className="text-xs text-text-muted">{comp.usedBy} produit(s)</p>
                  </div>
                  <div className="w-64">
                    <CustomSelect
                      value={comp.bjEntityId || ""}
                      onChange={(val) => {
                        setEditCompositions((prev) =>
                          prev.map((c, i) => i === idx ? { ...c, bjEntityId: val || null } : c),
                        );
                      }}
                      options={[
                        { value: "", label: "Créer automatiquement" },
                        ...existingEntities.compositions.map((c) => ({ value: c.id, label: c.name })),
                      ]}
                      placeholder="Mapper vers..."
                    />
                  </div>
                </div>
              ))}
            </div>
          )
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="px-6 pb-2">
          <div className="bg-[#EF4444]/5 border border-[#EF4444]/20 text-[#EF4444] px-4 py-3 rounded-xl text-sm">
            {error}
          </div>
        </div>
      )}

      {/* Submit */}
      <div className="p-6 border-t border-border flex items-center justify-between">
        <p className="text-xs text-text-muted font-body">
          Les entités non mappées seront créées automatiquement.
        </p>
        <button
          onClick={handleSubmit}
          disabled={submitting}
          className="btn-primary"
        >
          {submitting ? (
            <>
              <svg className="animate-spin w-4 h-4 mr-2 inline" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Création...
            </>
          ) : (
            "Créer et continuer"
          )}
        </button>
      </div>
    </div>
  );
}
