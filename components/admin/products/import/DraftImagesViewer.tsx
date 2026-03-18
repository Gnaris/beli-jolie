"use client";

import { useState } from "react";
import Image from "next/image";

interface AvailableColor {
  id: string;
  name: string;
  hex: string;
}

interface DraftImageRow {
  filename: string;
  reference: string;
  color: string;
  position: number;
  tempPath: string;
  errors: string[];
  productId?: string;
  colorId?: string;
  availableColors?: AvailableColor[];
}

interface Props {
  draftId: string;
  initialRows: Record<string, unknown>[];
}

export default function DraftImagesViewer({ draftId, initialRows }: Props) {
  const [rows, setRows] = useState<DraftImageRow[]>(initialRows as unknown as DraftImageRow[]);
  const [fixing, setFixing] = useState<number | null>(null);
  const [loading, setLoading] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<{ idx: number; type: "success" | "error"; message: string } | null>(null);

  // For "create new color" form
  const [newColorName, setNewColorName] = useState("");
  const [newColorHex, setNewColorHex] = useState("#000000");

  const dismissRow = async (i: number) => {
    if (!confirm("Ignorer cette image ?")) return;
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

  const assignColor = async (i: number, colorId: string) => {
    setLoading(i);
    setFeedback(null);
    try {
      const res = await fetch(`/api/admin/products/import/draft/${draftId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rowIndex: i, colorId }),
      });
      const data = await res.json();
      if (data.ok) {
        setRows((prev) => prev.filter((_, idx) => idx !== i));
        setFixing(null);
        setFeedback({ idx: -1, type: "success", message: "Image importée avec succès." });
      } else {
        setFeedback({ idx: i, type: "error", message: data.errors?.join(" ") ?? "Erreur." });
      }
    } catch {
      setFeedback({ idx: i, type: "error", message: "Erreur réseau." });
    } finally {
      setLoading(null);
    }
  };

  const createColorAndAssign = async (i: number) => {
    if (!newColorName.trim()) return;
    setLoading(i);
    setFeedback(null);
    try {
      const res = await fetch(`/api/admin/products/import/draft/${draftId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rowIndex: i,
          newColorName: newColorName.trim(),
          newColorHex,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setRows((prev) => prev.filter((_, idx) => idx !== i));
        setFixing(null);
        setNewColorName("");
        setFeedback({ idx: -1, type: "success", message: "Variante créée et image importée." });
      } else {
        setFeedback({ idx: i, type: "error", message: data.errors?.join(" ") ?? "Erreur." });
      }
    } catch {
      setFeedback({ idx: i, type: "error", message: "Erreur réseau." });
    } finally {
      setLoading(null);
    }
  };

  if (rows.length === 0) {
    return (
      <div className="bg-green-50 border border-green-200 rounded-2xl p-8 text-center">
        <p className="text-green-700 font-medium text-lg">✓ Toutes les images ont été traitées.</p>
        <a href="/admin/produits" className="btn-primary mt-4 inline-block text-sm">
          Voir les produits
        </a>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {feedback?.idx === -1 && (
        <div className="p-3 bg-green-50 border border-green-200 rounded-xl text-sm text-green-700">
          ✓ {feedback.message}
        </div>
      )}

      <p className="text-sm text-[#666] font-[family-name:var(--font-roboto)]">
        {rows.length} image(s) en erreur. Pour chaque image, corrigez l'association ou ignorez-la.
      </p>

      {/* Table header */}
      <div className="bg-white border border-[#E5E5E5] rounded-2xl overflow-hidden">
        <div className="grid grid-cols-[80px_1fr_1fr_1fr_1fr_200px] gap-4 px-6 py-3 bg-[#F7F7F8] border-b border-[#E5E5E5] text-xs font-medium text-[#666] uppercase tracking-wide">
          <div>Aperçu</div>
          <div>Fichier</div>
          <div>Référence</div>
          <div>Couleur</div>
          <div>Position</div>
          <div>Erreur / Action</div>
        </div>

        <div className="divide-y divide-[#E5E5E5]">
          {rows.map((row, i) => {
            const isFixing = fixing === i;
            const isLoading = loading === i;
            const canAssignColor = !!(row.productId && row.availableColors);

            return (
              <div key={i}>
                <div className="grid grid-cols-[80px_1fr_1fr_1fr_1fr_200px] gap-4 items-start px-6 py-4">
                  {/* Preview */}
                  <div className="relative w-16 h-16 rounded-lg overflow-hidden bg-[#F7F7F8] border border-[#E5E5E5] flex-shrink-0">
                    {row.tempPath ? (
                      <Image
                        src={`/${row.tempPath}`}
                        alt={row.filename}
                        fill
                        className="object-cover"
                        unoptimized
                      />
                    ) : (
                      <div className="flex items-center justify-center w-full h-full text-2xl">🖼️</div>
                    )}
                  </div>

                  {/* Filename */}
                  <div>
                    <p className="text-sm font-medium text-[#1A1A1A] break-all leading-tight">{row.filename}</p>
                  </div>

                  {/* Reference */}
                  <div>
                    <span className={`text-sm ${row.reference ? "text-[#1A1A1A] font-medium" : "text-red-500 italic"}`}>
                      {row.reference || "Manquante"}
                    </span>
                  </div>

                  {/* Color */}
                  <div>
                    <span className={`text-sm ${row.color ? "text-[#1A1A1A] font-medium" : "text-red-500 italic"}`}>
                      {row.color || "Manquante"}
                    </span>
                  </div>

                  {/* Position */}
                  <div>
                    <span className={`text-sm ${row.position > 0 ? "text-[#1A1A1A] font-medium" : "text-red-500 italic"}`}>
                      {row.position > 0 ? row.position : "Invalide"}
                    </span>
                  </div>

                  {/* Error + actions */}
                  <div className="space-y-2">
                    <div className="text-xs text-red-600 leading-tight">
                      {row.errors.map((e, j) => (
                        <p key={j}>⚠️ {e}</p>
                      ))}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {canAssignColor && !isFixing && (
                        <button
                          onClick={() => { setFixing(i); setNewColorName(""); }}
                          className="text-xs px-2 py-1 border border-[#E5E5E5] rounded-lg hover:bg-[#F7F7F8] transition-colors"
                        >
                          Assigner couleur
                        </button>
                      )}
                      {!isFixing && (
                        <button
                          onClick={() => dismissRow(i)}
                          disabled={isLoading}
                          className="text-xs px-2 py-1 text-red-600 border border-red-200 rounded-lg hover:bg-red-50 transition-colors"
                        >
                          Ignorer
                        </button>
                      )}
                    </div>
                    {feedback?.idx === i && (
                      <p className={`text-xs ${feedback.type === "error" ? "text-red-600" : "text-green-600"}`}>
                        {feedback.message}
                      </p>
                    )}
                  </div>
                </div>

                {/* Color assignment panel */}
                {isFixing && canAssignColor && (
                  <div className="mx-6 mb-4 p-4 bg-[#F7F7F8] border border-[#E5E5E5] rounded-xl">
                    <p className="text-sm font-medium text-[#1A1A1A] mb-3">
                      Assigner à une variante de couleur existante
                    </p>
                    <div className="flex flex-wrap gap-2 mb-4">
                      {row.availableColors!.map((c) => (
                        <button
                          key={c.id}
                          onClick={() => assignColor(i, c.id)}
                          disabled={isLoading}
                          className="flex items-center gap-2 px-3 py-1.5 border border-[#E5E5E5] bg-white rounded-lg hover:border-[#1A1A1A] transition-colors text-sm"
                        >
                          <span
                            className="w-3 h-3 rounded-full border border-[#E5E5E5]"
                            style={{ backgroundColor: c.hex }}
                          />
                          {c.name}
                        </button>
                      ))}
                    </div>

                    <div className="border-t border-[#E5E5E5] pt-4">
                      <p className="text-sm font-medium text-[#1A1A1A] mb-3">
                        Ou créer une nouvelle variante couleur
                      </p>
                      <div className="flex gap-3 flex-wrap items-end">
                        <div>
                          <label className="field-label">Nom de la couleur</label>
                          <input
                            className="field-input w-40"
                            placeholder={row.color}
                            value={newColorName}
                            onChange={(e) => setNewColorName(e.target.value)}
                          />
                        </div>
                        <div>
                          <label className="field-label">Couleur hex</label>
                          <div className="flex items-center gap-2">
                            <input
                              type="color"
                              value={newColorHex}
                              onChange={(e) => setNewColorHex(e.target.value)}
                              className="w-10 h-9 rounded cursor-pointer border border-[#E5E5E5]"
                            />
                            <input
                              className="field-input w-28 font-mono text-sm"
                              value={newColorHex}
                              onChange={(e) => setNewColorHex(e.target.value)}
                            />
                          </div>
                        </div>
                        <button
                          onClick={() => createColorAndAssign(i)}
                          disabled={isLoading || !newColorName.trim()}
                          className="btn-primary text-sm disabled:opacity-50"
                        >
                          {isLoading ? "Création…" : "Créer et assigner"}
                        </button>
                        <button
                          onClick={() => setFixing(null)}
                          className="btn-secondary text-sm"
                        >
                          Annuler
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
