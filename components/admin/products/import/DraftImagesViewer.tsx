"use client";

import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import ColorSwatch from "@/components/ui/ColorSwatch";

interface AvailableColor {
  id: string;       // ProductColor ID (variant), not Color model ID
  name: string;     // Full name: "Doré/Noir/Rouge" (main + sub-colors)
  hex: string;
  patternImage?: string | null;
  subColors?: { hex: string; patternImage?: string | null }[];
}

interface ColorOption {
  id: string;
  name: string;
  hex: string | null;
  patternImage: string | null;
}

interface SelectedColor {
  colorId: string;
  colorName: string;
  colorHex: string;
  patternImage: string | null;
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

  // For reference search
  const [refSearch, setRefSearch] = useState("");
  const [searchedProduct, setSearchedProduct] = useState<SearchedProduct | null>(null);
  const [searchingProduct, setSearchingProduct] = useState(false);

  // Color selection modal state
  const [colorModalIdx, setColorModalIdx] = useState<number | null>(null);
  const [allColors, setAllColors] = useState<ColorOption[]>([]);
  const [loadingColors, setLoadingColors] = useState(false);
  const [selectedColors, setSelectedColors] = useState<SelectedColor[]>([]);
  const [colorSearch, setColorSearch] = useState("");
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const colorSearchRef = useRef<HTMLInputElement>(null);

  // Variant attributes for new variant
  const [variantPrice, setVariantPrice] = useState("");
  const [variantStock, setVariantStock] = useState("");
  const [variantWeight, setVariantWeight] = useState("");
  const [variantSaleType, setVariantSaleType] = useState<"UNIT" | "PACK">("UNIT");
  const [variantPackQty, setVariantPackQty] = useState("");
  const [variantSize, setVariantSize] = useState("");

  // Modal step: false = color selection, true = variant attributes form
  const [showVariantForm, setShowVariantForm] = useState(false);

  // Create new color in modal
  const [creatingColor, setCreatingColor] = useState(false);
  const [newColorName, setNewColorName] = useState("");
  const [newColorHex, setNewColorHex] = useState("#9CA3AF");
  const [newColorMode, setNewColorMode] = useState<"hex" | "pattern">("hex");
  const [newColorPatternFile, setNewColorPatternFile] = useState<File | null>(null);
  const [newColorPatternPreview, setNewColorPatternPreview] = useState<string | null>(null);
  const [savingColor, setSavingColor] = useState(false);

  // Deduplicate availableColors by name (UNIT + PACK variants share images)
  const dedupeColors = (colors: AvailableColor[]): AvailableColor[] => {
    const seen = new Map<string, AvailableColor>();
    for (const c of colors) {
      if (!seen.has(c.name)) {
        seen.set(c.name, c);
      }
    }
    return [...seen.values()];
  };

  // ─── Color modal helpers ───────────────────────

  const fetchAllColors = useCallback(async () => {
    setLoadingColors(true);
    try {
      const res = await fetch(`/api/admin/products/import/draft/${draftId}/fix`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "list_colors" }),
      });
      const data = await res.json();
      if (data.colors) setAllColors(data.colors);
    } finally {
      setLoadingColors(false);
    }
  }, [draftId]);

  const resetVariantAttrs = useCallback(() => {
    setVariantPrice(""); setVariantStock(""); setVariantWeight("");
    setVariantSaleType("UNIT"); setVariantPackQty(""); setVariantSize("");
  }, []);

  const openColorModal = useCallback((idx: number) => {
    setColorModalIdx(idx);
    setSelectedColors([]);
    setColorSearch("");
    setCreatingColor(false);
    resetVariantAttrs();
    fetchAllColors();
  }, [fetchAllColors, resetVariantAttrs]);

  const closeColorModal = useCallback(() => {
    setColorModalIdx(null);
    setSelectedColors([]);
    setColorSearch("");
    setCreatingColor(false);
    setShowVariantForm(false);
    resetVariantAttrs();
    setNewColorName("");
    setNewColorHex("#9CA3AF");
    setNewColorMode("hex");
    setNewColorPatternFile(null);
    setNewColorPatternPreview(null);
  }, [resetVariantAttrs]);

  // Lock body scroll when modal is open
  useEffect(() => {
    if (colorModalIdx === null) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [colorModalIdx]);

  useEffect(() => {
    if (colorModalIdx !== null) setTimeout(() => colorSearchRef.current?.focus(), 50);
  }, [colorModalIdx]);

  const toggleColor = (opt: ColorOption) => {
    const exists = selectedColors.find((s) => s.colorId === opt.id);
    if (exists) {
      setSelectedColors(selectedColors.filter((s) => s.colorId !== opt.id));
    } else {
      setSelectedColors([...selectedColors, {
        colorId: opt.id,
        colorName: opt.name,
        colorHex: opt.hex ?? "#9CA3AF",
        patternImage: opt.patternImage,
      }]);
    }
  };

  const removeSelectedColor = (colorId: string) => {
    setSelectedColors(selectedColors.filter((s) => s.colorId !== colorId));
  };

  // Drag & drop for reordering selected colors
  const handleDragStart = (idx: number) => setDragIdx(idx);
  const handleDragOver = (e: React.DragEvent, idx: number) => { e.preventDefault(); setDragOverIdx(idx); };
  const handleDragEnd = () => {
    if (dragIdx !== null && dragOverIdx !== null && dragIdx !== dragOverIdx) {
      const updated = [...selectedColors];
      const [moved] = updated.splice(dragIdx, 1);
      updated.splice(dragOverIdx, 0, moved);
      setSelectedColors(updated);
    }
    setDragIdx(null);
    setDragOverIdx(null);
  };

  const handlePatternFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const validTypes = ["image/png", "image/jpeg", "image/webp"];
    if (!validTypes.includes(file.type)) return;
    if (file.size > 500 * 1024) return; // 500 KB max
    setNewColorPatternFile(file);
    setNewColorPatternPreview(URL.createObjectURL(file));
  };

  const createNewColorInModal = async () => {
    if (!newColorName.trim()) return;
    setSavingColor(true);
    try {
      // Upload pattern if needed
      let patternPath: string | null = null;
      if (newColorMode === "pattern" && newColorPatternFile) {
        const fd = new FormData();
        fd.append("file", newColorPatternFile);
        const uploadRes = await fetch("/api/admin/colors/upload-pattern", { method: "POST", body: fd });
        if (!uploadRes.ok) { setSavingColor(false); return; }
        const uploadData = await uploadRes.json();
        if (uploadData.path) patternPath = uploadData.path;
      }

      const res = await fetch(`/api/admin/products/import/draft/${draftId}/fix`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create_color",
          colorName: newColorName.trim(),
          colorHex: newColorMode === "hex" ? newColorHex : null,
          colorPatternImage: patternPath,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        const entity = data.entity;
        const newOpt: ColorOption = { id: entity.id, name: entity.name, hex: entity.hex, patternImage: entity.patternImage };
        setAllColors((prev) => [...prev, newOpt].sort((a, b) => a.name.localeCompare(b.name)));
        // Auto-select
        setSelectedColors((prev) => [...prev, {
          colorId: entity.id,
          colorName: entity.name,
          colorHex: entity.hex ?? "#9CA3AF",
          patternImage: entity.patternImage,
        }]);
        // Reset form
        setCreatingColor(false);
        setNewColorName("");
        setNewColorHex("#9CA3AF");
        setNewColorMode("hex");
        setNewColorPatternFile(null);
        setNewColorPatternPreview(null);
      }
    } finally {
      setSavingColor(false);
    }
  };

  const createVariantAndAssign = async (rowIdx: number) => {
    if (selectedColors.length === 0) return;
    setLoading(rowIdx);
    setFeedback(null);
    try {
      const res = await fetch(`/api/admin/products/import/draft/${draftId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rowIndex: rowIdx,
          createVariant: {
            colorIds: selectedColors.map((c) => c.colorId),
            unitPrice: variantPrice ? parseFloat(variantPrice) : undefined,
            stock: variantStock ? parseInt(variantStock) : undefined,
            weight: variantWeight ? parseFloat(variantWeight) / 1000 : undefined,
            saleType: variantSaleType,
            packQuantity: variantSaleType === "PACK" && variantPackQty ? parseInt(variantPackQty) : undefined,
            size: variantSize || undefined,
          },
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setRows((prev) => prev.filter((_, idx) => idx !== rowIdx));
        closeColorModal();
        setFixing(null);
        setFeedback({ idx: -1, type: "success", message: "Variante créée et image importée." });
      } else {
        setFeedback({ idx: rowIdx, type: "error", message: data.errors?.join(" ") ?? "Erreur." });
      }
    } catch {
      setFeedback({ idx: rowIdx, type: "error", message: "Erreur réseau." });
    } finally {
      setLoading(null);
    }
  };

  const filteredModalColors = colorSearch.trim()
    ? allColors.filter((o) => o.name.toLowerCase().includes(colorSearch.trim().toLowerCase()))
    : allColors;

  const selectedColorIds = new Set(selectedColors.map((s) => s.colorId));

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
                              <ColorSwatch
                                hex={c.hex}
                                patternImage={c.patternImage}
                                subColors={c.subColors}
                                size={14}
                                rounded="full"
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
                    <div className="flex flex-col gap-1.5 mb-4">
                      {dedupeColors(row.availableColors!).map((c) => (
                        <button
                          key={c.id}
                          onClick={() => assignColor(i, c.id)}
                          disabled={isLoading}
                          className="flex items-center gap-2.5 px-3 py-2 border border-[#E5E5E5] bg-white rounded-lg hover:border-[#1A1A1A] transition-colors text-sm text-left"
                        >
                          <ColorSwatch
                            hex={c.hex}
                            patternImage={c.patternImage}
                            subColors={c.subColors}
                            size={20}
                            rounded="full"
                          />
                          <span className="flex-1 font-[family-name:var(--font-roboto)]">{c.name}</span>
                        </button>
                      ))}
                    </div>

                    <div className="border-t border-[#E5E5E5] pt-4">
                      <p className="text-sm font-medium text-[#1A1A1A] mb-3">
                        Ou créer une nouvelle variante couleur
                      </p>
                      <button
                        type="button"
                        onClick={() => openColorModal(i)}
                        className="btn-primary text-sm"
                      >
                        Sélectionner les couleurs
                      </button>
                      <button
                        onClick={() => setFixing(null)}
                        className="btn-secondary text-sm ml-2"
                      >
                        Annuler
                      </button>
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
                            <ColorSwatch
                              hex={c.hex}
                              patternImage={c.patternImage}
                              subColors={c.subColors}
                              size={14}
                              rounded="full"
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
                    Assigner à une variante
                  </p>
                  <div className="flex flex-col gap-1.5 mb-3">
                    {dedupeColors(row.availableColors!).map((c) => (
                      <button
                        key={c.id}
                        onClick={() => assignColor(i, c.id)}
                        disabled={isLoading}
                        className="flex items-center gap-2.5 px-3 py-2 border border-[#E5E5E5] bg-white rounded-lg hover:border-[#1A1A1A] transition-colors text-sm text-left"
                      >
                        <ColorSwatch
                          hex={c.hex}
                          patternImage={c.patternImage}
                          subColors={c.subColors}
                          size={20}
                          rounded="full"
                        />
                        <span className="flex-1 font-[family-name:var(--font-roboto)]">{c.name}</span>
                      </button>
                    ))}
                  </div>

                  <div className="border-t border-[#E5E5E5] pt-3">
                    <p className="text-sm font-medium text-[#1A1A1A] mb-2">
                      Ou créer une nouvelle variante
                    </p>
                    <button
                      type="button"
                      onClick={() => openColorModal(i)}
                      className="btn-primary text-sm"
                    >
                      Sélectionner les couleurs
                    </button>
                    <button
                      onClick={() => setFixing(null)}
                      className="btn-secondary text-sm ml-2"
                    >
                      Annuler
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Color selection modal (portal) */}
      {colorModalIdx !== null && createPortal(
        <div className="fixed inset-0 z-[9000] flex items-center justify-center p-4" onClick={closeColorModal}>
          <div className="absolute inset-0 bg-black/40" />
          <div
            className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md flex flex-col"
            style={{ maxHeight: "min(90vh, 780px)" }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Sliding container — 2 pages */}
            <div className="overflow-hidden flex-1 flex flex-col">
              <div
                className="flex transition-transform duration-300 ease-in-out flex-1 min-h-0"
                style={{ transform: showVariantForm ? "translateX(-100%)" : "translateX(0)" }}
              >
                {/* ═══ PAGE 1: Color selection ═══ */}
                <div className="w-full shrink-0 flex flex-col min-h-0">
                  {/* Header */}
                  <div className="flex items-center justify-between px-5 py-4 border-b border-[#E5E5E5]">
                    <div>
                      <h3 className="text-sm font-semibold font-[family-name:var(--font-poppins)] text-[#1A1A1A]">
                        Sélectionner les couleurs
                      </h3>
                      <p className="text-[11px] text-[#9CA3AF] font-[family-name:var(--font-roboto)] mt-0.5">
                        1re = principale. Glissez pour réordonner.
                      </p>
                    </div>
                    <button type="button" onClick={closeColorModal} className="p-1.5 hover:bg-[#F7F7F8] rounded-lg transition-colors" aria-label="Fermer">
                      <svg className="w-4 h-4 text-[#6B6B6B]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>

                  {/* Selected colors — drag & drop reorderable */}
                  {selectedColors.length > 0 && (
                    <div className="px-4 py-3 bg-[#F7F7F8] border-b border-[#E5E5E5] shrink-0">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[11px] font-semibold text-[#6B6B6B] font-[family-name:var(--font-roboto)] uppercase tracking-wide">
                          Ordre des couleurs ({selectedColors.length})
                        </span>
                        {selectedColors.length > 1 && (
                          <span className="text-[10px] text-[#9CA3AF] font-[family-name:var(--font-roboto)]">
                            Glissez pour réordonner
                          </span>
                        )}
                      </div>
                      <div className="space-y-1 max-h-36 overflow-y-auto">
                        {selectedColors.map((s, idx) => {
                          const isDragging = dragIdx === idx;
                          const isDragOver = dragOverIdx === idx && dragIdx !== idx;
                          return (
                            <div
                              key={s.colorId}
                              draggable
                              onDragStart={() => handleDragStart(idx)}
                              onDragOver={(e) => handleDragOver(e, idx)}
                              onDragEnd={handleDragEnd}
                              className={`flex items-center gap-2 bg-white border rounded-lg px-2.5 py-2 cursor-grab active:cursor-grabbing transition-all
                                ${isDragging ? "opacity-40 scale-95" : ""}
                                ${isDragOver ? "border-[#1A1A1A] shadow-sm" : "border-[#E5E5E5]"}
                              `}
                            >
                              <svg className="w-3.5 h-3.5 text-[#C0C0C0] shrink-0" viewBox="0 0 24 24" fill="currentColor">
                                <circle cx="9" cy="6" r="1.5" /><circle cx="15" cy="6" r="1.5" />
                                <circle cx="9" cy="12" r="1.5" /><circle cx="15" cy="12" r="1.5" />
                                <circle cx="9" cy="18" r="1.5" /><circle cx="15" cy="18" r="1.5" />
                              </svg>
                              <span className={`text-[10px] font-bold w-5 h-5 flex items-center justify-center rounded-full shrink-0
                                ${idx === 0 ? "bg-[#1A1A1A] text-white" : "bg-[#E5E5E5] text-[#6B6B6B]"}
                              `}>
                                {idx + 1}
                              </span>
                              <ColorSwatch hex={s.colorHex} patternImage={s.patternImage} size={16} rounded="full" />
                              <span className="flex-1 text-xs font-[family-name:var(--font-roboto)] text-[#1A1A1A]">{s.colorName}</span>
                              {idx === 0 && (
                                <span className="text-[9px] font-semibold bg-[#22C55E] text-white px-1.5 py-0.5 rounded">principale</span>
                              )}
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); removeSelectedColor(s.colorId); }}
                                className="p-1 hover:bg-red-50 rounded transition-colors shrink-0"
                                aria-label={`Retirer ${s.colorName}`}
                              >
                                <svg className="w-3.5 h-3.5 text-[#C0C0C0] hover:text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Search */}
                  <div className="px-4 py-3 border-b border-[#E5E5E5]">
                    <div className="flex items-center gap-2 bg-[#F7F7F8] border border-[#E5E5E5] px-3 py-2 rounded-lg">
                      <svg className="w-4 h-4 text-[#9CA3AF] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
                      </svg>
                      <input
                        ref={colorSearchRef}
                        type="text"
                        value={colorSearch}
                        onChange={(e) => setColorSearch(e.target.value)}
                        placeholder="Rechercher une couleur..."
                        className="flex-1 bg-transparent text-sm text-[#1A1A1A] placeholder-[#9CA3AF] outline-none min-w-0 font-[family-name:var(--font-roboto)]"
                      />
                      {colorSearch && (
                        <button type="button" onClick={() => setColorSearch("")} className="text-[#9CA3AF] hover:text-[#1A1A1A]">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Color list */}
                  <div className="flex-1 overflow-y-auto" style={{ minHeight: 180 }}>
                    {loadingColors ? (
                      <div className="px-5 py-8 text-center text-sm text-[#9CA3AF] font-[family-name:var(--font-roboto)]">Chargement...</div>
                    ) : filteredModalColors.length === 0 ? (
                      <div className="px-5 py-8 text-center text-sm text-[#9CA3AF] font-[family-name:var(--font-roboto)]">Aucun résultat</div>
                    ) : filteredModalColors.map((opt) => {
                      const isChecked = selectedColorIds.has(opt.id);
                      const position = selectedColors.findIndex((s) => s.colorId === opt.id);
                      return (
                        <button key={opt.id} type="button"
                          onClick={() => toggleColor(opt)}
                          className={`w-full flex items-center gap-3 px-5 py-3 text-sm hover:bg-[#F7F7F8] transition-colors text-left border-b border-[#F0F0F0] last:border-b-0 ${isChecked ? "bg-[#F0FDF4]" : ""}`}
                        >
                          <input type="checkbox" checked={isChecked} readOnly className="accent-[#22C55E] w-4 h-4 pointer-events-none shrink-0" />
                          <ColorSwatch hex={opt.hex} patternImage={opt.patternImage} size={20} rounded="full" />
                          <span className="flex-1 font-[family-name:var(--font-roboto)] text-[#1A1A1A]">{opt.name}</span>
                          {isChecked && (
                            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${position === 0 ? "bg-[#1A1A1A] text-white" : "bg-[#E5E5E5] text-[#6B6B6B]"}`}>
                              {position === 0 ? "principale" : `+${position + 1}`}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>

                  {/* Create new color form */}
                  <div className="border-t border-[#E5E5E5] px-4 py-3 bg-[#FAFAFA]">
                    {!creatingColor ? (
                      <button
                        type="button"
                        onClick={() => setCreatingColor(true)}
                        className="text-sm text-[#1A1A1A] font-medium hover:underline flex items-center gap-1.5"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                        Créer une couleur
                      </button>
                    ) : (
                      <div className="space-y-3">
                        <p className="text-xs font-semibold text-[#6B6B6B] uppercase tracking-wide">Nouvelle couleur</p>
                        <input
                          className="field-input w-full"
                          placeholder="Nom de la couleur"
                          value={newColorName}
                          onChange={(e) => setNewColorName(e.target.value)}
                          autoFocus
                        />
                        <div className="flex gap-1">
                          <button
                            type="button"
                            onClick={() => setNewColorMode("hex")}
                            className={`flex-1 text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                              newColorMode === "hex"
                                ? "bg-[#1A1A1A] text-white border-[#1A1A1A]"
                                : "bg-white text-[#6B6B6B] border-[#E5E5E5] hover:border-[#9CA3AF]"
                            }`}
                          >
                            Couleur unie
                          </button>
                          <button
                            type="button"
                            onClick={() => setNewColorMode("pattern")}
                            className={`flex-1 text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                              newColorMode === "pattern"
                                ? "bg-[#1A1A1A] text-white border-[#1A1A1A]"
                                : "bg-white text-[#6B6B6B] border-[#E5E5E5] hover:border-[#9CA3AF]"
                            }`}
                          >
                            Motif / Image
                          </button>
                        </div>

                        {newColorMode === "hex" ? (
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
                        ) : (
                          <div>
                            {newColorPatternPreview ? (
                              <div className="flex items-center gap-3">
                                <div
                                  className="w-16 h-16 rounded-lg border border-[#E5E5E5]"
                                  style={{ backgroundImage: `url(${newColorPatternPreview})`, backgroundSize: "cover", backgroundPosition: "center" }}
                                />
                                <button
                                  type="button"
                                  onClick={() => { setNewColorPatternFile(null); setNewColorPatternPreview(null); }}
                                  className="text-xs text-red-500 hover:underline"
                                >
                                  Supprimer
                                </button>
                              </div>
                            ) : (
                              <label className="flex items-center justify-center gap-2 px-4 py-3 border-2 border-dashed border-[#E5E5E5] rounded-lg cursor-pointer hover:border-[#9CA3AF] transition-colors">
                                <svg className="w-5 h-5 text-[#9CA3AF]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                </svg>
                                <span className="text-xs text-[#9CA3AF]">PNG, JPG, WebP — max 500 Ko</span>
                                <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={handlePatternFileChange} />
                              </label>
                            )}
                          </div>
                        )}

                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={createNewColorInModal}
                            disabled={savingColor || !newColorName.trim() || (newColorMode === "pattern" && !newColorPatternFile)}
                            className="btn-primary text-sm disabled:opacity-50"
                          >
                            {savingColor ? "Création..." : "Créer"}
                          </button>
                          <button
                            type="button"
                            onClick={() => { setCreatingColor(false); setNewColorName(""); setNewColorPatternFile(null); setNewColorPatternPreview(null); }}
                            className="btn-secondary text-sm"
                          >
                            Annuler
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Footer — page 1 */}
                  <div className="flex items-center justify-between px-5 py-3.5 border-t border-[#E5E5E5] bg-[#FAFAFA] rounded-b-2xl">
                    <span className="text-xs text-[#9CA3AF] font-[family-name:var(--font-roboto)]">
                      {selectedColors.length === 0 ? "Aucune couleur" : `${selectedColors.length} couleur${selectedColors.length > 1 ? "s" : ""}`}
                    </span>
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={closeColorModal}
                        className="px-4 py-2 text-xs font-medium font-[family-name:var(--font-roboto)] text-[#6B6B6B] bg-white border border-[#E5E5E5] rounded-lg hover:bg-[#F7F7F8] transition-colors"
                      >
                        Annuler
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowVariantForm(true)}
                        disabled={selectedColors.length === 0}
                        className="px-4 py-2 text-xs font-medium font-[family-name:var(--font-roboto)] text-white bg-[#1A1A1A] rounded-lg hover:bg-[#333] transition-colors disabled:opacity-50 flex items-center gap-1.5"
                      >
                        Suivant
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>

                {/* ═══ PAGE 2: Variant attributes form ═══ */}
                <div className="w-full shrink-0 flex flex-col min-h-0">
                  {/* Header — page 2 */}
                  <div className="flex items-center justify-between px-5 py-4 border-b border-[#E5E5E5]">
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => setShowVariantForm(false)}
                        className="p-1.5 hover:bg-[#F7F7F8] rounded-lg transition-colors"
                        aria-label="Retour"
                      >
                        <svg className="w-4 h-4 text-[#6B6B6B]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                        </svg>
                      </button>
                      <div>
                        <h3 className="text-sm font-semibold font-[family-name:var(--font-poppins)] text-[#1A1A1A]">
                          Attributs de la variante
                        </h3>
                        <p className="text-[11px] text-[#9CA3AF] font-[family-name:var(--font-roboto)] mt-0.5">
                          Étape 2/2 — Renseignez les détails
                        </p>
                      </div>
                    </div>
                    <button type="button" onClick={closeColorModal} className="p-1.5 hover:bg-[#F7F7F8] rounded-lg transition-colors" aria-label="Fermer">
                      <svg className="w-4 h-4 text-[#6B6B6B]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>

                  {/* Selected colors summary */}
                  <div className="px-5 py-3 bg-[#F7F7F8] border-b border-[#E5E5E5] shrink-0">
                    <p className="text-[11px] font-semibold text-[#6B6B6B] font-[family-name:var(--font-roboto)] uppercase tracking-wide mb-2">
                      Couleurs sélectionnées
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {selectedColors.map((s, idx) => (
                        <div key={s.colorId} className="flex items-center gap-1.5 bg-white border border-[#E5E5E5] rounded-lg px-2.5 py-1.5">
                          <span className={`text-[9px] font-bold w-4 h-4 flex items-center justify-center rounded-full shrink-0
                            ${idx === 0 ? "bg-[#1A1A1A] text-white" : "bg-[#E5E5E5] text-[#6B6B6B]"}
                          `}>
                            {idx + 1}
                          </span>
                          <ColorSwatch hex={s.colorHex} patternImage={s.patternImage} size={14} rounded="full" />
                          <span className="text-xs font-[family-name:var(--font-roboto)] text-[#1A1A1A]">{s.colorName}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Form fields */}
                  <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="field-label">Prix unitaire (€)</label>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          className="field-input w-full"
                          placeholder="0.00"
                          value={variantPrice}
                          onChange={(e) => setVariantPrice(e.target.value)}
                          autoFocus
                        />
                      </div>
                      <div>
                        <label className="field-label">Stock</label>
                        <input
                          type="number"
                          min="0"
                          className="field-input w-full"
                          placeholder="0"
                          value={variantStock}
                          onChange={(e) => setVariantStock(e.target.value)}
                        />
                      </div>
                      <div>
                        <label className="field-label">Poids (g)</label>
                        <input
                          type="number"
                          min="0"
                          className="field-input w-full"
                          placeholder="100"
                          value={variantWeight}
                          onChange={(e) => setVariantWeight(e.target.value)}
                        />
                      </div>
                      <div>
                        <label className="field-label">Taille</label>
                        <input
                          type="text"
                          className="field-input w-full"
                          placeholder="—"
                          value={variantSize}
                          onChange={(e) => setVariantSize(e.target.value)}
                        />
                      </div>
                    </div>

                    <div>
                      <label className="field-label">Type de vente</label>
                      <div className="flex gap-2 mt-1">
                        <button
                          type="button"
                          onClick={() => setVariantSaleType("UNIT")}
                          className={`flex-1 text-sm px-4 py-2.5 rounded-lg border transition-colors font-medium ${
                            variantSaleType === "UNIT"
                              ? "bg-[#1A1A1A] text-white border-[#1A1A1A]"
                              : "bg-white text-[#6B6B6B] border-[#E5E5E5] hover:border-[#9CA3AF]"
                          }`}
                        >
                          Unité
                        </button>
                        <button
                          type="button"
                          onClick={() => setVariantSaleType("PACK")}
                          className={`flex-1 text-sm px-4 py-2.5 rounded-lg border transition-colors font-medium ${
                            variantSaleType === "PACK"
                              ? "bg-[#1A1A1A] text-white border-[#1A1A1A]"
                              : "bg-white text-[#6B6B6B] border-[#E5E5E5] hover:border-[#9CA3AF]"
                          }`}
                        >
                          Pack
                        </button>
                      </div>
                    </div>

                    {variantSaleType === "PACK" && (
                      <div>
                        <label className="field-label">Quantité par pack</label>
                        <input
                          type="number"
                          min="2"
                          className="field-input w-full"
                          placeholder="6"
                          value={variantPackQty}
                          onChange={(e) => setVariantPackQty(e.target.value)}
                        />
                      </div>
                    )}
                  </div>

                  {/* Footer — page 2 */}
                  <div className="flex items-center justify-between px-5 py-3.5 border-t border-[#E5E5E5] bg-[#FAFAFA] rounded-b-2xl">
                    <button
                      type="button"
                      onClick={() => setShowVariantForm(false)}
                      className="px-4 py-2 text-xs font-medium font-[family-name:var(--font-roboto)] text-[#6B6B6B] bg-white border border-[#E5E5E5] rounded-lg hover:bg-[#F7F7F8] transition-colors flex items-center gap-1.5"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                      </svg>
                      Retour
                    </button>
                    <button
                      type="button"
                      onClick={() => createVariantAndAssign(colorModalIdx)}
                      disabled={selectedColors.length === 0 || loading === colorModalIdx}
                      className="px-4 py-2 text-xs font-medium font-[family-name:var(--font-roboto)] text-white bg-[#1A1A1A] rounded-lg hover:bg-[#333] transition-colors disabled:opacity-50"
                    >
                      {loading === colorModalIdx ? "Création..." : "Créer et assigner"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
