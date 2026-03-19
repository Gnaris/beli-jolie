"use client";

import { useState, useMemo } from "react";
import Image from "next/image";
import { useConfirm } from "@/components/ui/ConfirmDialog";

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
  availableRefs?: string[];
}

interface SearchedProduct {
  id: string;
  reference: string;
  name: string;
  colors: AvailableColor[];
}

interface Props {
  draftId: string;
  initialRows: Record<string, unknown>[];
  successCount?: number;
  totalCount?: number;
}

export default function DraftImagesViewer({ draftId, initialRows, successCount, totalCount }: Props) {
  const { confirm } = useConfirm();
  const [rows, setRows] = useState<DraftImageRow[]>(initialRows as unknown as DraftImageRow[]);
  const [fixing, setFixing] = useState<number | null>(null);
  const [fixingRef, setFixingRef] = useState<number | null>(null);
  const [loading, setLoading] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<{ idx: number; type: "success" | "error"; message: string } | null>(null);

  // For "create new color" form
  const [newColorName, setNewColorName] = useState("");
  const [newColorHex, setNewColorHex] = useState("#000000");

  // For reference search
  const [refSearch, setRefSearch] = useState("");
  const [searchedProduct, setSearchedProduct] = useState<SearchedProduct | null>(null);
  const [searchingProduct, setSearchingProduct] = useState(false);

  // Sort rows: reference errors first, then color errors, then others
  const sortedRows = useMemo(() => {
    return [...rows].sort((a, b) => {
      const aRef = a.errors.some((e) => e.includes("Référence"));
      const bRef = b.errors.some((e) => e.includes("Référence"));
      const aColor = a.errors.some((e) => e.toLowerCase().includes("couleur"));
      const bColor = b.errors.some((e) => e.toLowerCase().includes("couleur"));
      if (aRef && !bRef) return -1;
      if (!aRef && bRef) return 1;
      if (aColor && !bColor) return -1;
      if (!aColor && bColor) return 1;
      return 0;
    });
  }, [rows]);

  // Map sorted rows back to their original index
  const getOriginalIndex = (row: DraftImageRow) => rows.indexOf(row);

  const filteredRefs = (row: DraftImageRow) => {
    if (!row.availableRefs) return [];
    if (!refSearch.trim()) return row.availableRefs.slice(0, 20);
    const q = refSearch.toLowerCase();
    return row.availableRefs.filter((r) => r.toLowerCase().includes(q)).slice(0, 20);
  };

  const dismissRow = async (i: number) => {
    const ok = await confirm({
      type: "warning",
      title: "Ignorer cette image ?",
      message: "L'image ne sera pas importée.",
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

  const searchProductByRef = async (ref: string) => {
    setSearchingProduct(true);
    setSearchedProduct(null);
    try {
      const res = await fetch(`/api/admin/products/import/draft/${draftId}/fix`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "search_products", query: ref }),
      });
      const data = await res.json();
      if (data.product) {
        setSearchedProduct(data.product);
      } else {
        setSearchedProduct(null);
        setFeedback({ idx: fixingRef!, type: "error", message: data.error ?? "Produit introuvable." });
      }
    } catch {
      setFeedback({ idx: fixingRef!, type: "error", message: "Erreur réseau." });
    } finally {
      setSearchingProduct(false);
    }
  };

  const assignRefAndColor = async (i: number, productId: string, colorId: string) => {
    setLoading(i);
    setFeedback(null);
    try {
      const res = await fetch(`/api/admin/products/import/draft/${draftId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rowIndex: i, productId, colorId }),
      });
      const data = await res.json();
      if (data.ok) {
        setRows((prev) => prev.filter((_, idx) => idx !== i));
        setFixingRef(null);
        setSearchedProduct(null);
        setRefSearch("");
        setFeedback({ idx: -1, type: "success", message: "Référence assignée et image importée." });
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
        <p className="text-green-700 font-medium text-lg">Toutes les images ont été traitées.</p>
        <a href="/admin/produits" className="btn-primary mt-4 inline-block text-sm">
          Voir les produits
        </a>
      </div>
    );
  }

  const errorCount = rows.length;
  const hasRefError = (row: DraftImageRow) => row.errors.some((e) => e.includes("Référence"));
  const hasColorError = (row: DraftImageRow) => !hasRefError(row) && row.productId && row.availableColors;

  return (
    <div className="space-y-4">
      {/* Success summary bar */}
      {(successCount != null || totalCount != null) && (
        <div className="flex flex-col sm:flex-row gap-3">
          {successCount != null && successCount > 0 && (
            <div className="flex-1 p-3 bg-green-50 border border-green-200 rounded-xl text-sm text-green-700 font-medium">
              {successCount} image(s) importée(s) avec succès
            </div>
          )}
          {errorCount > 0 && (
            <div className="flex-1 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700 font-medium">
              {errorCount} erreur(s) à corriger
            </div>
          )}
        </div>
      )}

      {feedback?.idx === -1 && (
        <div className="p-3 bg-green-50 border border-green-200 rounded-xl text-sm text-green-700">
          {feedback.message}
        </div>
      )}

      <p className="text-sm text-[#666] font-[family-name:var(--font-roboto)]">
        {rows.length} image(s) en erreur. Pour chaque image, corrigez l&apos;association ou ignorez-la.
      </p>

      {/* Desktop table */}
      <div className="bg-white border border-[#E5E5E5] rounded-2xl overflow-hidden hidden lg:block">
        <div className="grid grid-cols-[80px_1fr_1fr_1fr_1fr_200px] gap-4 px-6 py-3 bg-[#F7F7F8] border-b border-[#E5E5E5] text-xs font-medium text-[#666] uppercase tracking-wide">
          <div>Aperçu</div>
          <div>Fichier</div>
          <div>Référence</div>
          <div>Couleur</div>
          <div>Position</div>
          <div>Erreur / Action</div>
        </div>

        <div className="divide-y divide-[#E5E5E5]">
          {sortedRows.map((row) => {
            const i = getOriginalIndex(row);
            const isFixing = fixing === i;
            const isFixingRef = fixingRef === i;
            const isLoading = loading === i;
            const canAssignColor = !!(row.productId && row.availableColors);
            const canAssignRef = hasRefError(row);

            return (
              <div key={`${row.filename}-${i}`}>
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
                      <div className="flex items-center justify-center w-full h-full text-[#999] text-xs">IMG</div>
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
                        <p key={j}>{e}</p>
                      ))}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {canAssignRef && !isFixingRef && (
                        <button
                          onClick={() => {
                            setFixingRef(i);
                            setFixing(null);
                            setRefSearch("");
                            setSearchedProduct(null);
                          }}
                          className="text-xs px-2 py-1 border border-[#E5E5E5] rounded-lg hover:bg-[#F7F7F8] transition-colors"
                        >
                          Assigner référence
                        </button>
                      )}
                      {canAssignColor && !isFixing && !isFixingRef && (
                        <button
                          onClick={() => { setFixing(i); setFixingRef(null); setNewColorName(""); }}
                          className="text-xs px-2 py-1 border border-[#E5E5E5] rounded-lg hover:bg-[#F7F7F8] transition-colors"
                        >
                          Assigner couleur
                        </button>
                      )}
                      {!isFixing && !isFixingRef && (
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

                {/* Reference assignment panel */}
                {isFixingRef && (
                  <div className="mx-6 mb-4 p-4 bg-[#F7F7F8] border border-[#E5E5E5] rounded-xl">
                    <p className="text-sm font-medium text-[#1A1A1A] mb-3">
                      Rechercher et assigner une référence produit
                    </p>
                    <div className="relative mb-3">
                      <input
                        type="text"
                        className="field-input w-full max-w-sm"
                        placeholder="Rechercher une référence..."
                        value={refSearch}
                        onChange={(e) => {
                          setRefSearch(e.target.value);
                          setSearchedProduct(null);
                        }}
                        autoFocus
                      />
                      {refSearch.trim() && !searchedProduct && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {filteredRefs(row).map((ref) => (
                            <button
                              key={ref}
                              onClick={() => {
                                setRefSearch(ref);
                                searchProductByRef(ref);
                              }}
                              className="text-xs px-2 py-1 border border-[#E5E5E5] bg-white rounded-lg hover:border-[#1A1A1A] transition-colors"
                            >
                              {ref}
                            </button>
                          ))}
                          {filteredRefs(row).length === 0 && (
                            <p className="text-xs text-[#999]">Aucune référence correspondante</p>
                          )}
                        </div>
                      )}
                    </div>

                    {searchingProduct && (
                      <p className="text-sm text-[#666]">Recherche en cours...</p>
                    )}

                    {searchedProduct && (
                      <div className="mt-3 p-3 bg-white border border-[#E5E5E5] rounded-lg">
                        <p className="text-sm font-medium text-[#1A1A1A] mb-1">
                          {searchedProduct.reference} — {searchedProduct.name}
                        </p>
                        <p className="text-xs text-[#666] mb-3">Sélectionnez une variante couleur :</p>
                        <div className="flex flex-wrap gap-2">
                          {searchedProduct.colors.map((c) => (
                            <button
                              key={c.id}
                              onClick={() => assignRefAndColor(i, searchedProduct.id, c.id)}
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
                          {searchedProduct.colors.length === 0 && (
                            <p className="text-xs text-[#999]">Aucune variante couleur disponible</p>
                          )}
                        </div>
                      </div>
                    )}

                    <div className="mt-3 flex gap-2">
                      {!searchedProduct && refSearch.trim() && (
                        <button
                          onClick={() => searchProductByRef(refSearch.trim())}
                          disabled={searchingProduct}
                          className="btn-primary text-sm disabled:opacity-50"
                        >
                          {searchingProduct ? "Recherche..." : "Rechercher"}
                        </button>
                      )}
                      <button
                        onClick={() => {
                          setFixingRef(null);
                          setRefSearch("");
                          setSearchedProduct(null);
                        }}
                        className="btn-secondary text-sm"
                      >
                        Annuler
                      </button>
                    </div>
                  </div>
                )}

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
                          {isLoading ? "Création..." : "Créer et assigner"}
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

      {/* Mobile card layout */}
      <div className="space-y-3 lg:hidden">
        {sortedRows.map((row) => {
          const i = getOriginalIndex(row);
          const isFixing = fixing === i;
          const isFixingRef = fixingRef === i;
          const isLoading = loading === i;
          const canAssignColor = !!(row.productId && row.availableColors);
          const canAssignRef = hasRefError(row);

          return (
            <div
              key={`mobile-${row.filename}-${i}`}
              className="bg-white border border-[#E5E5E5] rounded-2xl p-4"
            >
              <div className="flex gap-3">
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
                    <div className="flex items-center justify-center w-full h-full text-[#999] text-xs">IMG</div>
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  {/* Filename */}
                  <p className="text-sm font-medium text-[#1A1A1A] break-all leading-tight">{row.filename}</p>

                  {/* Ref / Color / Position */}
                  <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1 text-xs text-[#666]">
                    <span>
                      Réf:{" "}
                      <span className={row.reference ? "text-[#1A1A1A] font-medium" : "text-red-500 italic"}>
                        {row.reference || "Manquante"}
                      </span>
                    </span>
                    <span>
                      Couleur:{" "}
                      <span className={row.color ? "text-[#1A1A1A] font-medium" : "text-red-500 italic"}>
                        {row.color || "Manquante"}
                      </span>
                    </span>
                    <span>
                      Pos:{" "}
                      <span className={row.position > 0 ? "text-[#1A1A1A] font-medium" : "text-red-500 italic"}>
                        {row.position > 0 ? row.position : "Invalide"}
                      </span>
                    </span>
                  </div>

                  {/* Errors */}
                  <div className="mt-2 text-xs text-red-600 leading-tight">
                    {row.errors.map((e, j) => (
                      <p key={j}>{e}</p>
                    ))}
                  </div>

                  {/* Action buttons */}
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {canAssignRef && !isFixingRef && (
                      <button
                        onClick={() => {
                          setFixingRef(i);
                          setFixing(null);
                          setRefSearch("");
                          setSearchedProduct(null);
                        }}
                        className="text-xs px-2 py-1 border border-[#E5E5E5] rounded-lg hover:bg-[#F7F7F8] transition-colors"
                      >
                        Assigner référence
                      </button>
                    )}
                    {canAssignColor && !isFixing && !isFixingRef && (
                      <button
                        onClick={() => { setFixing(i); setFixingRef(null); setNewColorName(""); }}
                        className="text-xs px-2 py-1 border border-[#E5E5E5] rounded-lg hover:bg-[#F7F7F8] transition-colors"
                      >
                        Assigner couleur
                      </button>
                    )}
                    {!isFixing && !isFixingRef && (
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
                    <p className={`text-xs mt-1 ${feedback.type === "error" ? "text-red-600" : "text-green-600"}`}>
                      {feedback.message}
                    </p>
                  )}
                </div>
              </div>

              {/* Mobile reference assignment panel */}
              {isFixingRef && (
                <div className="mt-3 p-3 bg-[#F7F7F8] border border-[#E5E5E5] rounded-xl">
                  <p className="text-sm font-medium text-[#1A1A1A] mb-2">
                    Assigner une référence
                  </p>
                  <input
                    type="text"
                    className="field-input w-full"
                    placeholder="Rechercher une référence..."
                    value={refSearch}
                    onChange={(e) => {
                      setRefSearch(e.target.value);
                      setSearchedProduct(null);
                    }}
                    autoFocus
                  />
                  {refSearch.trim() && !searchedProduct && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {filteredRefs(row).map((ref) => (
                        <button
                          key={ref}
                          onClick={() => {
                            setRefSearch(ref);
                            searchProductByRef(ref);
                          }}
                          className="text-xs px-2 py-1 border border-[#E5E5E5] bg-white rounded-lg hover:border-[#1A1A1A] transition-colors"
                        >
                          {ref}
                        </button>
                      ))}
                      {filteredRefs(row).length === 0 && (
                        <p className="text-xs text-[#999]">Aucune référence correspondante</p>
                      )}
                    </div>
                  )}

                  {searchingProduct && (
                    <p className="text-sm text-[#666] mt-2">Recherche en cours...</p>
                  )}

                  {searchedProduct && (
                    <div className="mt-2 p-3 bg-white border border-[#E5E5E5] rounded-lg">
                      <p className="text-sm font-medium text-[#1A1A1A] mb-1">
                        {searchedProduct.reference} — {searchedProduct.name}
                      </p>
                      <p className="text-xs text-[#666] mb-2">Sélectionnez une couleur :</p>
                      <div className="flex flex-wrap gap-2">
                        {searchedProduct.colors.map((c) => (
                          <button
                            key={c.id}
                            onClick={() => assignRefAndColor(i, searchedProduct.id, c.id)}
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
                        {searchedProduct.colors.length === 0 && (
                          <p className="text-xs text-[#999]">Aucune variante couleur</p>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="mt-2 flex gap-2">
                    {!searchedProduct && refSearch.trim() && (
                      <button
                        onClick={() => searchProductByRef(refSearch.trim())}
                        disabled={searchingProduct}
                        className="btn-primary text-sm disabled:opacity-50"
                      >
                        {searchingProduct ? "Recherche..." : "Rechercher"}
                      </button>
                    )}
                    <button
                      onClick={() => {
                        setFixingRef(null);
                        setRefSearch("");
                        setSearchedProduct(null);
                      }}
                      className="btn-secondary text-sm"
                    >
                      Annuler
                    </button>
                  </div>
                </div>
              )}

              {/* Mobile color assignment panel */}
              {isFixing && canAssignColor && (
                <div className="mt-3 p-3 bg-[#F7F7F8] border border-[#E5E5E5] rounded-xl">
                  <p className="text-sm font-medium text-[#1A1A1A] mb-2">
                    Assigner une couleur
                  </p>
                  <div className="flex flex-wrap gap-2 mb-3">
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

                  <div className="border-t border-[#E5E5E5] pt-3">
                    <p className="text-sm font-medium text-[#1A1A1A] mb-2">
                      Ou créer une nouvelle couleur
                    </p>
                    <div className="space-y-2">
                      <div>
                        <label className="field-label">Nom</label>
                        <input
                          className="field-input w-full"
                          placeholder={row.color}
                          value={newColorName}
                          onChange={(e) => setNewColorName(e.target.value)}
                        />
                      </div>
                      <div>
                        <label className="field-label">Hex</label>
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
                      <div className="flex gap-2">
                        <button
                          onClick={() => createColorAndAssign(i)}
                          disabled={isLoading || !newColorName.trim()}
                          className="btn-primary text-sm disabled:opacity-50"
                        >
                          {isLoading ? "Création..." : "Créer et assigner"}
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
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
