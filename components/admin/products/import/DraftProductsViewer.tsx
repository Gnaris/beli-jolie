"use client";

import { useState } from "react";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import CustomSelect from "@/components/ui/CustomSelect";

interface DraftProductRow {
  _rowIndex: number;
  reference: string;
  name: string;
  description?: string;
  category?: string;
  color: string;
  saleType: "UNIT" | "PACK";
  unitPrice: number;
  packQuantity?: number;
  stock: number;
  weight?: number;
  tags?: string;
  composition?: string;
  errors: string[];
  availableColors?: { id: string; name: string; hex: string }[];
}

interface Props {
  draftId: string;
  initialRows: Record<string, unknown>[];
  successCount?: number;
  totalCount?: number;
}

// Extract the "quoted name" from error messages like `Couleur "Doré" introuvable`
function extractQuotedName(error: string): string | null {
  const m = error.match(/"([^"]+)"/);
  return m ? m[1] : null;
}

function detectErrorType(
  error: string
): "missing_color" | "missing_category" | "missing_subcategory" | "missing_composition" | "ref_exists" | "generic" {
  const lower = error.toLowerCase();
  if (lower.includes("sous-catégorie") || lower.includes("sous-categorie") || lower.includes("sub_category"))
    return "missing_subcategory";
  if (lower.includes("composition") && lower.includes("introuvable")) return "missing_composition";
  if (lower.includes("couleur")) return "missing_color";
  if (lower.includes("catégorie") || lower.includes("categorie")) return "missing_category";
  if (lower.includes("référence") && lower.includes("existe")) return "ref_exists";
  return "generic";
}

export default function DraftProductsViewer({ draftId, initialRows, successCount, totalCount }: Props) {
  const { confirm } = useConfirm();
  const [rows, setRows] = useState<DraftProductRow[]>(initialRows as unknown as DraftProductRow[]);
  const [editing, setEditing] = useState<number | null>(null);
  const [editValues, setEditValues] = useState<Partial<DraftProductRow>>({});
  const [loading, setLoading] = useState<number | null>(null);
  const [fixingColor, setFixingColor] = useState<{ rowIndex: number; name: string } | null>(null);
  const [fixColorHex, setFixColorHex] = useState("#9CA3AF");
  const [feedback, setFeedback] = useState<{ rowIdx: number; type: "success" | "error"; message: string } | null>(null);

  // ── Dismiss row ──────────────────────────────────────────────────────
  const dismissRow = async (i: number) => {
    const ok = await confirm({
      type: "warning",
      title: "Ignorer cette ligne ?",
      message: "La ligne sera définitivement ignorée et ne sera pas importée.",
      confirmLabel: "Ignorer",
    });
    if (!ok) return;
    setLoading(i);
    try {
      await fetch(`/api/admin/products/import/draft/${draftId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rowIndex: i, dismiss: true }),
      });
      setRows((prev) => prev.filter((_, idx) => idx !== i));
    } finally {
      setLoading(null);
    }
  };

  // ── Save edited row ──────────────────────────────────────────────────
  const saveRow = async (i: number) => {
    setLoading(i);
    setFeedback(null);
    try {
      const res = await fetch(`/api/admin/products/import/draft/${draftId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rowIndex: i, updatedRow: editValues }),
      });
      const data = await res.json();
      if (data.ok) {
        setRows((prev) => prev.filter((_, idx) => idx !== i));
        setEditing(null);
        setFeedback({ rowIdx: -1, type: "success", message: "Produit créé avec succès." });
      } else {
        setRows((prev) =>
          prev.map((r, idx) => idx === i ? { ...r, ...editValues, errors: data.errors ?? [] } : r)
        );
        setFeedback({ rowIdx: i, type: "error", message: data.errors?.join(" ") ?? "Erreur." });
      }
    } catch {
      setFeedback({ rowIdx: i, type: "error", message: "Erreur réseau." });
    } finally {
      setLoading(null);
      setEditing(null);
    }
  };

  // ── Auto-fix: create category ────────────────────────────────────────
  const fixCreateCategory = async (i: number, categoryName: string) => {
    setLoading(i);
    setFeedback(null);
    try {
      const res = await fetch(`/api/admin/products/import/draft/${draftId}/fix`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create_category", categoryName }),
      });
      const data = await res.json();
      if (data.ok) {
        // Retry the row import now that category exists
        await retryRow(i);
      } else {
        setFeedback({ rowIdx: i, type: "error", message: data.error ?? "Erreur création catégorie." });
        setLoading(null);
      }
    } catch {
      setFeedback({ rowIdx: i, type: "error", message: "Erreur réseau." });
      setLoading(null);
    }
  };

  // ── Auto-fix: create subcategory ───────────────────────────────────
  const fixCreateSubcategory = async (i: number, subcategoryName: string) => {
    setLoading(i);
    setFeedback(null);
    try {
      const res = await fetch(`/api/admin/products/import/draft/${draftId}/fix`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create_subcategory", subcategoryName }),
      });
      const data = await res.json();
      if (data.ok) {
        await retryRow(i);
      } else {
        setFeedback({ rowIdx: i, type: "error", message: data.error ?? "Erreur création sous-catégorie." });
        setLoading(null);
      }
    } catch {
      setFeedback({ rowIdx: i, type: "error", message: "Erreur réseau." });
      setLoading(null);
    }
  };

  // ── Auto-fix: create composition ───────────────────────────────────
  const fixCreateComposition = async (i: number, compositionName: string) => {
    setLoading(i);
    setFeedback(null);
    try {
      const res = await fetch(`/api/admin/products/import/draft/${draftId}/fix`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create_composition", compositionName }),
      });
      const data = await res.json();
      if (data.ok) {
        await retryRow(i);
      } else {
        setFeedback({ rowIdx: i, type: "error", message: data.error ?? "Erreur création composition." });
        setLoading(null);
      }
    } catch {
      setFeedback({ rowIdx: i, type: "error", message: "Erreur réseau." });
      setLoading(null);
    }
  };

  // ── Auto-fix: create color ───────────────────────────────────────────
  const fixCreateColor = async (i: number, colorName: string, hex: string) => {
    setLoading(i);
    setFeedback(null);
    try {
      const res = await fetch(`/api/admin/products/import/draft/${draftId}/fix`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create_color", colorName, colorHex: hex }),
      });
      const data = await res.json();
      if (data.ok) {
        setFixingColor(null);
        await retryRow(i);
      } else {
        setFeedback({ rowIdx: i, type: "error", message: data.error ?? "Erreur création couleur." });
        setLoading(null);
      }
    } catch {
      setFeedback({ rowIdx: i, type: "error", message: "Erreur réseau." });
      setLoading(null);
    }
  };

  // ── Auto-fix: select existing color ────────────────────────────────
  const fixSelectExistingColor = async (i: number, colorName: string) => {
    setLoading(i);
    setFeedback(null);
    try {
      // Update the row's color field to the selected color name and retry
      setRows((prev) =>
        prev.map((r, idx) => (idx === i ? { ...r, color: colorName } : r))
      );
      const res = await fetch(`/api/admin/products/import/draft/${draftId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rowIndex: i, updatedRow: { ...rows[i], color: colorName } }),
      });
      const data = await res.json();
      if (data.ok) {
        setRows((prev) => prev.filter((_, idx) => idx !== i));
        setFeedback({ rowIdx: -1, type: "success", message: "Produit créé avec succès." });
      } else {
        setRows((prev) =>
          prev.map((r, idx) => (idx === i ? { ...r, color: colorName, errors: data.errors ?? [] } : r))
        );
        setFeedback({ rowIdx: i, type: "error", message: data.errors?.join(" ") ?? "Erreur." });
      }
    } catch {
      setFeedback({ rowIdx: i, type: "error", message: "Erreur réseau." });
    } finally {
      setLoading(null);
    }
  };

  // ── Retry row after fix ──────────────────────────────────────────────
  const retryRow = async (i: number) => {
    try {
      const res = await fetch(`/api/admin/products/import/draft/${draftId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rowIndex: i, updatedRow: rows[i] }),
      });
      const data = await res.json();
      if (data.ok) {
        setRows((prev) => prev.filter((_, idx) => idx !== i));
        setFeedback({ rowIdx: -1, type: "success", message: "Produit créé avec succès." });
      } else {
        // Update errors
        setRows((prev) =>
          prev.map((r, idx) => idx === i ? { ...r, errors: data.errors ?? [] } : r)
        );
        setFeedback({ rowIdx: i, type: "error", message: data.errors?.join(" ") ?? "Erreur." });
      }
    } finally {
      setLoading(null);
    }
  };

  if (rows.length === 0) {
    return (
      <div className="bg-green-50 border border-green-200 rounded-2xl p-8 text-center">
        <p className="text-green-700 font-medium text-lg">✓ Toutes les lignes ont été traitées.</p>
        <a href="/admin/produits" className="btn-primary mt-4 inline-block text-sm">Voir les produits</a>
      </div>
    );
  }

  const showSummary = successCount != null || totalCount != null;

  return (
    <div className="space-y-4">
      {/* ── Summary bar ─────────────────────────────────────────────── */}
      {showSummary && (
        <div className="flex flex-wrap gap-3">
          {successCount != null && successCount > 0 && (
            <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-xl px-4 py-2.5">
              <span className="text-green-600 text-sm font-semibold">✓</span>
              <span className="text-sm text-green-700 font-medium font-[family-name:var(--font-roboto)]">
                {successCount} produit{successCount > 1 ? "s" : ""} importé{successCount > 1 ? "s" : ""} avec succès
              </span>
            </div>
          )}
          {rows.length > 0 && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5">
              <span className="text-red-600 text-sm font-semibold">✕</span>
              <span className="text-sm text-red-700 font-medium font-[family-name:var(--font-roboto)]">
                {rows.length} erreur{rows.length > 1 ? "s" : ""} à corriger
              </span>
            </div>
          )}
          {totalCount != null && (
            <div className="flex items-center gap-2 bg-[#F7F7F8] border border-[#E5E5E5] rounded-xl px-4 py-2.5">
              <span className="text-sm text-[#666] font-medium font-[family-name:var(--font-roboto)]">
                Total : {totalCount} ligne{totalCount > 1 ? "s" : ""}
              </span>
            </div>
          )}
        </div>
      )}

      {feedback?.rowIdx === -1 && (
        <div className="p-3 bg-green-50 border border-green-200 rounded-xl text-sm text-green-700">✓ {feedback.message}</div>
      )}

      {!showSummary && (
        <p className="text-sm text-[#666] font-[family-name:var(--font-roboto)]">
          {rows.length} ligne(s) en erreur. Corrigez ou utilisez les boutons de résolution rapide.
        </p>
      )}

      <div className="space-y-3">
        {rows.map((row, i) => {
          const isEditing = editing === i;
          const isLoading = loading === i;
          const isFixingColorHere = fixingColor?.rowIndex === i;

          return (
            <div key={i} className="bg-white border border-red-200 rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] overflow-hidden">
              {/* Header */}
              <div className="bg-red-50 border-b border-red-200 px-6 py-3 flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-3">
                  <span className="text-xs font-mono bg-red-100 text-red-700 px-2 py-0.5 rounded">Ligne {row._rowIndex}</span>
                  <span className="font-medium text-[#1A1A1A] text-sm">
                    {row.reference || "(sans référence)"} — {row.name || "(sans nom)"}
                  </span>
                </div>
                <div className="flex gap-2">
                  {!isEditing && (
                    <>
                      <button
                        onClick={() => { setEditing(i); setEditValues({ ...row }); setFeedback(null); }}
                        className="text-xs px-3 py-1.5 border border-[#E5E5E5] bg-white rounded-lg hover:bg-[#F7F7F8] transition-colors"
                      >
                        ✏️ Modifier
                      </button>
                      <button
                        onClick={() => dismissRow(i)}
                        disabled={isLoading}
                        className="text-xs px-3 py-1.5 text-red-600 border border-red-200 bg-red-50 rounded-lg hover:bg-red-100 transition-colors"
                      >
                        Ignorer
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Errors + fix buttons */}
              <div className="px-6 py-3 bg-red-50/50 border-b border-red-100 space-y-2">
                {row.errors.map((err, j) => {
                  const errType = detectErrorType(err);
                  const quotedName = extractQuotedName(err);

                  return (
                    <div key={j} className="space-y-2">
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <p className="text-sm text-red-700 flex items-start gap-2">
                          <span className="mt-0.5 shrink-0">⚠️</span>
                          <span>{err}</span>
                        </p>

                        {/* Quick-fix buttons */}
                        <div className="flex gap-2 shrink-0">
                          {errType === "missing_category" && quotedName && (
                            <button
                              onClick={() => fixCreateCategory(i, quotedName)}
                              disabled={isLoading}
                              className="text-xs px-3 py-1 bg-amber-100 hover:bg-amber-200 text-amber-800 border border-amber-200 rounded-lg transition-colors font-medium disabled:opacity-50"
                            >
                              {isLoading ? "…" : `✚ Créer la catégorie "${quotedName}"`}
                            </button>
                          )}
                          {errType === "missing_subcategory" && quotedName && (
                            <button
                              onClick={() => fixCreateSubcategory(i, quotedName)}
                              disabled={isLoading}
                              className="text-xs px-3 py-1 bg-blue-100 hover:bg-blue-200 text-blue-800 border border-blue-200 rounded-lg transition-colors font-medium disabled:opacity-50"
                            >
                              {isLoading ? "…" : `✚ Créer la sous-catégorie "${quotedName}"`}
                            </button>
                          )}
                          {errType === "missing_composition" && quotedName && (
                            <button
                              onClick={() => fixCreateComposition(i, quotedName)}
                              disabled={isLoading}
                              className="text-xs px-3 py-1 bg-teal-100 hover:bg-teal-200 text-teal-800 border border-teal-200 rounded-lg transition-colors font-medium disabled:opacity-50"
                            >
                              {isLoading ? "…" : `✚ Créer la composition "${quotedName}"`}
                            </button>
                          )}
                          {errType === "missing_color" && quotedName && !isFixingColorHere && (
                            <button
                              onClick={() => { setFixingColor({ rowIndex: i, name: quotedName }); setFixColorHex("#9CA3AF"); }}
                              disabled={isLoading}
                              className="text-xs px-3 py-1 bg-purple-100 hover:bg-purple-200 text-purple-800 border border-purple-200 rounded-lg transition-colors font-medium disabled:opacity-50"
                            >
                              ✚ Créer la couleur &ldquo;{quotedName}&rdquo;
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Color chips: select from existing colors */}
                      {errType === "missing_color" && row.availableColors && row.availableColors.length > 0 && (
                        <div className="ml-6 mt-1">
                          <p className="text-xs text-[#666] mb-1.5 font-[family-name:var(--font-roboto)]">
                            Ou sélectionner une couleur existante :
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {row.availableColors.map((c) => (
                              <button
                                key={c.id}
                                onClick={() => fixSelectExistingColor(i, c.name)}
                                disabled={isLoading}
                                className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg border border-[#E5E5E5] bg-white hover:bg-[#F7F7F8] transition-colors font-medium disabled:opacity-50"
                                title={`${c.name} (${c.hex})`}
                              >
                                <span
                                  className="w-3.5 h-3.5 rounded-full border border-[#E5E5E5] shrink-0"
                                  style={{ backgroundColor: c.hex }}
                                />
                                <span className="text-[#1A1A1A]">{c.name}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Color creation form */}
              {isFixingColorHere && fixingColor && (
                <div className="px-6 py-4 bg-purple-50 border-b border-purple-100">
                  <p className="text-sm font-medium text-purple-900 mb-3">
                    Créer la couleur &ldquo;{fixingColor.name}&rdquo;
                  </p>
                  <div className="flex items-end gap-3 flex-wrap">
                    <div>
                      <label className="field-label text-xs">Couleur hex</label>
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          value={fixColorHex}
                          onChange={(e) => setFixColorHex(e.target.value)}
                          className="w-10 h-9 rounded cursor-pointer border border-[#E5E5E5]"
                        />
                        <input
                          className="field-input w-28 font-mono text-sm"
                          value={fixColorHex}
                          onChange={(e) => setFixColorHex(e.target.value)}
                        />
                      </div>
                    </div>
                    <button
                      onClick={() => fixCreateColor(i, fixingColor.name, fixColorHex)}
                      disabled={isLoading}
                      className="btn-primary text-sm disabled:opacity-50"
                    >
                      {isLoading ? "Création…" : "Créer et réessayer"}
                    </button>
                    <button onClick={() => setFixingColor(null)} className="btn-secondary text-sm">Annuler</button>
                  </div>
                </div>
              )}

              {feedback?.rowIdx === i && (
                <div className={`px-6 py-2 text-sm ${feedback.type === "error" ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700"}`}>
                  {feedback.message}
                </div>
              )}

              {/* Fields */}
              <div className="px-6 py-4">
                {isEditing ? (
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    <div>
                      <label className="field-label">Référence *</label>
                      <input className="field-input" value={String(editValues.reference ?? "")} onChange={(e) => setEditValues((v) => ({ ...v, reference: e.target.value }))} />
                    </div>
                    <div>
                      <label className="field-label">Nom *</label>
                      <input className="field-input" value={String(editValues.name ?? "")} onChange={(e) => setEditValues((v) => ({ ...v, name: e.target.value }))} />
                    </div>
                    <div>
                      <label className="field-label">Catégorie</label>
                      <input className="field-input" value={String(editValues.category ?? "")} onChange={(e) => setEditValues((v) => ({ ...v, category: e.target.value }))} />
                    </div>
                    <div>
                      <label className="field-label">Couleur *</label>
                      <input className="field-input" value={String(editValues.color ?? "")} onChange={(e) => setEditValues((v) => ({ ...v, color: e.target.value }))} />
                    </div>
                    <div>
                      <label className="field-label">Type de vente *</label>
                      <CustomSelect
                        value={String(editValues.saleType ?? "UNIT")}
                        onChange={(v) => setEditValues((prev) => ({ ...prev, saleType: v as "UNIT" | "PACK" }))}
                        options={[
                          { value: "UNIT", label: "À l'unité" },
                          { value: "PACK", label: "Par lot" },
                        ]}
                      />
                    </div>
                    <div>
                      <label className="field-label">Prix HT (€) *</label>
                      <input type="number" step="0.01" className="field-input" value={editValues.unitPrice ?? 0} onChange={(e) => setEditValues((v) => ({ ...v, unitPrice: parseFloat(e.target.value) }))} />
                    </div>
                    <div>
                      <label className="field-label">Stock *</label>
                      <input type="number" className="field-input" value={editValues.stock ?? 0} onChange={(e) => setEditValues((v) => ({ ...v, stock: parseInt(e.target.value) }))} />
                    </div>
                    {editValues.saleType === "PACK" && (
                      <div>
                        <label className="field-label">Qté/paquet</label>
                        <input type="number" className="field-input" value={editValues.packQuantity ?? ""} onChange={(e) => setEditValues((v) => ({ ...v, packQuantity: parseInt(e.target.value) }))} />
                      </div>
                    )}
                    <div>
                      <label className="field-label">Tags (virgules)</label>
                      <input className="field-input" value={String(editValues.tags ?? "")} onChange={(e) => setEditValues((v) => ({ ...v, tags: e.target.value }))} />
                    </div>
                    <div className="col-span-2 md:col-span-3 flex gap-2 pt-2">
                      <button onClick={() => saveRow(i)} disabled={isLoading} className="btn-primary text-sm disabled:opacity-50">
                        {isLoading ? "Création…" : "✓ Créer le produit"}
                      </button>
                      <button onClick={() => setEditing(null)} className="btn-secondary text-sm">Annuler</button>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-2 text-sm">
                    <Field label="Référence" value={row.reference} />
                    <Field label="Nom" value={row.name} />
                    <Field label="Catégorie" value={row.category} />
                    <Field label="Couleur" value={row.color} />
                    <Field label="Type vente" value={row.saleType} />
                    <Field label="Prix HT" value={row.unitPrice ? `${row.unitPrice} €` : undefined} />
                    <Field label="Stock" value={row.stock?.toString()} />
                    <Field label="Qté/paquet" value={row.packQuantity?.toString()} />
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | undefined | null }) {
  if (!value) return null;
  return (
    <div>
      <span className="text-xs text-[#999]">{label}</span>
      <p className="text-sm text-[#1A1A1A] font-medium truncate">{value}</p>
    </div>
  );
}
