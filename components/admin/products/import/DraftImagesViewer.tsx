"use client";

import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import Link from "next/link";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import ColorSwatch from "@/components/ui/ColorSwatch";
import { useBackdropClose } from "@/hooks/useBackdropClose";

interface AvailableColor {
  id: string;       // ProductColor ID (variant), not Color model ID
  name: string;
  hex: string;
  patternImage?: string | null;
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
  const [chipDragIdx, setChipDragIdx] = useState<number | null>(null);
  const [chipDragOverIdx, setChipDragOverIdx] = useState<number | null>(null);
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

  const backdropColorModal = useBackdropClose(closeColorModal);

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

  // Drag & drop for reordering selected color chips
  const handleChipDragStart = (e: React.DragEvent, idx: number) => {
    setChipDragIdx(idx);
    e.dataTransfer.effectAllowed = "move";
    // Make drag image semi-transparent
    if (e.currentTarget instanceof HTMLElement) {
      e.dataTransfer.setDragImage(e.currentTarget, 20, 20);
    }
  };
  const handleChipDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setChipDragOverIdx(idx);
  };
  const handleChipDragEnd = () => {
    if (chipDragIdx !== null && chipDragOverIdx !== null && chipDragIdx !== chipDragOverIdx) {
      const updated = [...selectedColors];
      const [moved] = updated.splice(chipDragIdx, 1);
      updated.splice(chipDragOverIdx, 0, moved);
      setSelectedColors(updated);
    }
    setChipDragIdx(null);
    setChipDragOverIdx(null);
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

  // Variant form validation
  const variantPriceNum = variantPrice ? parseFloat(variantPrice) : 0;
  const variantWeightNum = variantWeight ? parseFloat(variantWeight) : 0;
  const variantPackQtyNum = variantPackQty ? parseInt(variantPackQty) : 0;
  const canSubmitVariant =
    selectedColors.length > 0 &&
    variantPriceNum > 0 &&
    variantWeightNum > 0 &&
    (variantSaleType === "UNIT" || variantPackQtyNum >= 2);

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
        <Link href="/admin/produits" className="btn-primary mt-4 inline-block text-sm">
          Voir les produits
        </Link>
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

      <p className="text-sm text-[#666] font-body">
        {rows.length} image(s) en erreur. Pour chaque image, corrigez l&apos;association ou ignorez-la.
      </p>

      {/* Desktop table */}
      <div className="bg-bg-primary border border-border rounded-2xl overflow-hidden hidden lg:block">
        <div className="grid grid-cols-[80px_1fr_1fr_1fr_1fr_200px] gap-4 px-6 py-3 bg-bg-secondary border-b border-border text-xs font-medium text-[#666] uppercase tracking-wide">
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
                  <div className="relative w-16 h-16 rounded-lg overflow-hidden bg-bg-secondary border border-border flex-shrink-0">
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
                    <p className="text-sm font-medium text-text-primary break-all leading-tight">{row.filename}</p>
                  </div>

                  {/* Reference */}
                  <div>
                    <span className={`text-sm ${row.reference ? "text-text-primary font-medium" : "text-red-500 italic"}`}>
                      {row.reference || "Manquante"}
                    </span>
                  </div>

                  {/* Color */}
                  <div>
                    <span className={`text-sm ${row.color ? "text-text-primary font-medium" : "text-red-500 italic"}`}>
                      {row.color || "Manquante"}
                    </span>
                  </div>

                  {/* Position */}
                  <div>
                    <span className={`text-sm ${row.position > 0 ? "text-text-primary font-medium" : "text-red-500 italic"}`}>
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
                          className="text-xs px-2 py-1 border border-border rounded-lg hover:bg-bg-secondary transition-colors"
                        >
                          Assigner référence
                        </button>
                      )}
                      {canAssignColor && !isFixing && !isFixingRef && (
                        <button
                          onClick={() => { setFixing(i); setFixingRef(null); setNewColorName(""); }}
                          className="text-xs px-2 py-1 border border-border rounded-lg hover:bg-bg-secondary transition-colors"
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
                  <div className="mx-6 mb-4 p-4 bg-bg-secondary border border-border rounded-xl">
                    <p className="text-sm font-medium text-text-primary mb-3">
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
                              className="text-xs px-2 py-1 border border-border bg-bg-primary rounded-lg hover:border-bg-dark transition-colors"
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
                      <div className="mt-3 p-3 bg-bg-primary border border-border rounded-lg">
                        <p className="text-sm font-medium text-text-primary mb-1">
                          {searchedProduct.reference} — {searchedProduct.name}
                        </p>
                        <p className="text-xs text-[#666] mb-3">Sélectionnez une variante couleur :</p>
                        <div className="flex flex-wrap gap-2">
                          {searchedProduct.colors.map((c) => (
                            <button
                              key={c.id}
                              onClick={() => assignRefAndColor(i, searchedProduct.id, c.id)}
                              disabled={isLoading}
                              className="flex items-center gap-2 px-3 py-1.5 border border-border bg-bg-primary rounded-lg hover:border-bg-dark transition-colors text-sm"
                            >
                              <ColorSwatch
                                hex={c.hex}
                                patternImage={c.patternImage}
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
                  <div className="mx-6 mb-4 p-4 bg-bg-secondary border border-border rounded-xl">
                    <p className="text-sm font-medium text-text-primary mb-3">
                      Assigner à une variante de couleur existante
                    </p>
                    <div className="flex flex-col gap-1.5 mb-4">
                      {dedupeColors(row.availableColors!).map((c) => (
                        <button
                          key={c.id}
                          onClick={() => assignColor(i, c.id)}
                          disabled={isLoading}
                          className="flex items-center gap-2.5 px-3 py-2 border border-border bg-bg-primary rounded-lg hover:border-bg-dark transition-colors text-sm text-left"
                        >
                          <ColorSwatch
                            hex={c.hex}
                            patternImage={c.patternImage}
                            size={20}
                            rounded="full"
                          />
                          <span className="flex-1 font-body">{c.name}</span>
                        </button>
                      ))}
                    </div>

                    <div className="border-t border-border pt-4">
                      <p className="text-sm font-medium text-text-primary mb-3">
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
              className="bg-bg-primary border border-border rounded-2xl p-4"
            >
              <div className="flex gap-3">
                {/* Preview */}
                <div className="relative w-16 h-16 rounded-lg overflow-hidden bg-bg-secondary border border-border flex-shrink-0">
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
                  <p className="text-sm font-medium text-text-primary break-all leading-tight">{row.filename}</p>

                  {/* Ref / Color / Position */}
                  <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1 text-xs text-[#666]">
                    <span>
                      Réf:{" "}
                      <span className={row.reference ? "text-text-primary font-medium" : "text-red-500 italic"}>
                        {row.reference || "Manquante"}
                      </span>
                    </span>
                    <span>
                      Couleur:{" "}
                      <span className={row.color ? "text-text-primary font-medium" : "text-red-500 italic"}>
                        {row.color || "Manquante"}
                      </span>
                    </span>
                    <span>
                      Pos:{" "}
                      <span className={row.position > 0 ? "text-text-primary font-medium" : "text-red-500 italic"}>
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
                        className="text-xs px-2 py-1 border border-border rounded-lg hover:bg-bg-secondary transition-colors"
                      >
                        Assigner référence
                      </button>
                    )}
                    {canAssignColor && !isFixing && !isFixingRef && (
                      <button
                        onClick={() => { setFixing(i); setFixingRef(null); setNewColorName(""); }}
                        className="text-xs px-2 py-1 border border-border rounded-lg hover:bg-bg-secondary transition-colors"
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
                <div className="mt-3 p-3 bg-bg-secondary border border-border rounded-xl">
                  <p className="text-sm font-medium text-text-primary mb-2">
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
                          className="text-xs px-2 py-1 border border-border bg-bg-primary rounded-lg hover:border-bg-dark transition-colors"
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
                    <div className="mt-2 p-3 bg-bg-primary border border-border rounded-lg">
                      <p className="text-sm font-medium text-text-primary mb-1">
                        {searchedProduct.reference} — {searchedProduct.name}
                      </p>
                      <p className="text-xs text-[#666] mb-2">Sélectionnez une couleur :</p>
                      <div className="flex flex-wrap gap-2">
                        {searchedProduct.colors.map((c) => (
                          <button
                            key={c.id}
                            onClick={() => assignRefAndColor(i, searchedProduct.id, c.id)}
                            disabled={isLoading}
                            className="flex items-center gap-2 px-3 py-1.5 border border-border bg-bg-primary rounded-lg hover:border-bg-dark transition-colors text-sm"
                          >
                            <ColorSwatch
                              hex={c.hex}
                              patternImage={c.patternImage}
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
                <div className="mt-3 p-3 bg-bg-secondary border border-border rounded-xl">
                  <p className="text-sm font-medium text-text-primary mb-2">
                    Assigner à une variante
                  </p>
                  <div className="flex flex-col gap-1.5 mb-3">
                    {dedupeColors(row.availableColors!).map((c) => (
                      <button
                        key={c.id}
                        onClick={() => assignColor(i, c.id)}
                        disabled={isLoading}
                        className="flex items-center gap-2.5 px-3 py-2 border border-border bg-bg-primary rounded-lg hover:border-bg-dark transition-colors text-sm text-left"
                      >
                        <ColorSwatch
                          hex={c.hex}
                          patternImage={c.patternImage}
                          size={20}
                          rounded="full"
                        />
                        <span className="flex-1 font-body">{c.name}</span>
                      </button>
                    ))}
                  </div>

                  <div className="border-t border-border pt-3">
                    <p className="text-sm font-medium text-text-primary mb-2">
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
        <div className="fixed inset-0 z-[9000] flex items-center justify-center p-4" onMouseDown={backdropColorModal.onMouseDown} onMouseUp={backdropColorModal.onMouseUp}>
          <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" />
          <div
            className="relative bg-bg-primary rounded-2xl shadow-2xl w-full max-w-lg flex flex-col overflow-hidden"
            style={{ maxHeight: "min(90vh, 780px)" }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* ═══ PAGE 1: Color selection ═══ */}
            {!showVariantForm ? (
              <>
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
                  <div>
                    <h3 className="text-sm font-semibold font-heading text-text-primary">
                      Sélectionner les couleurs
                    </h3>
                    <p className="text-[11px] text-text-muted font-body mt-0.5">
                      Étape 1/2 — 1re couleur = principale
                    </p>
                  </div>
                  <button type="button" onClick={closeColorModal} className="w-8 h-8 flex items-center justify-center hover:bg-bg-secondary rounded-lg transition-colors" aria-label="Fermer">
                    <svg className="w-4 h-4 text-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                {/* Selected colors — draggable chips */}
                {selectedColors.length > 0 && (
                  <div className="px-5 py-3 bg-bg-secondary border-b border-border shrink-0">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[11px] font-semibold text-text-secondary font-body uppercase tracking-wide">
                        Sélection ({selectedColors.length})
                      </span>
                      {selectedColors.length > 1 && (
                        <span className="text-[10px] text-text-muted font-body">
                          Glissez pour réordonner
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {selectedColors.map((s, idx) => {
                        const isDragging = chipDragIdx === idx;
                        const isDragOver = chipDragOverIdx === idx && chipDragIdx !== idx;
                        return (
                          <div
                            key={s.colorId}
                            draggable
                            onDragStart={(e) => handleChipDragStart(e, idx)}
                            onDragOver={(e) => handleChipDragOver(e, idx)}
                            onDragEnd={handleChipDragEnd}
                            className={`flex items-center gap-2 bg-bg-primary border-2 rounded-xl px-3 py-2 cursor-grab active:cursor-grabbing transition-all select-none
                              ${isDragging ? "opacity-40 scale-95" : ""}
                              ${isDragOver ? "border-[#1A1A1A] shadow-md" : "border-border"}
                            `}
                          >
                            {/* Drag handle */}
                            <svg className="w-3.5 h-3.5 text-[#C0C0C0] shrink-0" viewBox="0 0 24 24" fill="currentColor">
                              <circle cx="9" cy="6" r="1.5" /><circle cx="15" cy="6" r="1.5" />
                              <circle cx="9" cy="12" r="1.5" /><circle cx="15" cy="12" r="1.5" />
                              <circle cx="9" cy="18" r="1.5" /><circle cx="15" cy="18" r="1.5" />
                            </svg>
                            <span className={`text-[10px] font-bold w-5 h-5 flex items-center justify-center rounded-full shrink-0
                              ${idx === 0 ? "bg-bg-dark text-text-inverse" : "bg-[#E5E5E5] text-text-secondary"}
                            `}>
                              {idx + 1}
                            </span>
                            <ColorSwatch hex={s.colorHex} patternImage={s.patternImage} size={22} rounded="full" />
                            <span className="text-xs font-medium font-body text-text-primary max-w-[100px] truncate">
                              {s.colorName}
                            </span>
                            {idx === 0 && (
                              <span className="text-[9px] font-semibold bg-[#22C55E] text-white px-1.5 py-0.5 rounded">1re</span>
                            )}
                            {/* Remove */}
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); removeSelectedColor(s.colorId); }}
                              className="w-6 h-6 flex items-center justify-center rounded-full hover:bg-red-50 transition-colors shrink-0 ml-0.5"
                              aria-label={`Retirer ${s.colorName}`}
                            >
                              <svg className="w-3.5 h-3.5 text-[#C0C0C0] hover:text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Search */}
                <div className="px-5 py-3 border-b border-border shrink-0">
                  <div className="flex items-center gap-2 bg-bg-secondary border border-border px-3 py-2.5 rounded-xl">
                    <svg className="w-4 h-4 text-text-muted shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
                    </svg>
                    <input
                      ref={colorSearchRef}
                      type="text"
                      value={colorSearch}
                      onChange={(e) => setColorSearch(e.target.value)}
                      placeholder="Rechercher une couleur..."
                      className="flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-muted outline-none min-w-0 font-body"
                    />
                    {colorSearch && (
                      <button type="button" onClick={() => setColorSearch("")} className="w-5 h-5 flex items-center justify-center text-text-muted hover:text-text-primary">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>

                {/* Color grid */}
                <div className="flex-1 overflow-y-auto px-5 py-3" style={{ minHeight: 160 }}>
                  {loadingColors ? (
                    <div className="py-10 text-center text-sm text-text-muted font-body">Chargement...</div>
                  ) : filteredModalColors.length === 0 ? (
                    <div className="py-10 text-center text-sm text-text-muted font-body">Aucun résultat</div>
                  ) : (
                    <div className="grid grid-cols-4 sm:grid-cols-5 gap-2">
                      {filteredModalColors.map((opt) => {
                        const isChecked = selectedColorIds.has(opt.id);
                        const position = selectedColors.findIndex((s) => s.colorId === opt.id);
                        return (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => toggleColor(opt)}
                            className={`relative flex flex-col items-center gap-1.5 p-2.5 rounded-xl border-2 transition-all text-center
                              ${isChecked
                                ? "border-[#1A1A1A] bg-bg-secondary shadow-sm"
                                : "border-transparent hover:border-border hover:bg-[#FAFAFA]"
                              }
                            `}
                            title={opt.name}
                          >
                            {/* Checkmark badge */}
                            {isChecked && (
                              <span className={`absolute -top-1.5 -right-1.5 w-5 h-5 flex items-center justify-center rounded-full text-[9px] font-bold shadow-sm
                                ${position === 0 ? "bg-[#22C55E] text-white" : "bg-bg-dark text-text-inverse"}
                              `}>
                                {position + 1}
                              </span>
                            )}
                            {/* Color swatch */}
                            <div
                              className={`w-10 h-10 rounded-full border-2 transition-all shrink-0
                                ${isChecked ? "border-[#1A1A1A] scale-110" : "border-border"}
                              `}
                              style={
                                opt.patternImage
                                  ? { backgroundImage: `url(${opt.patternImage})`, backgroundSize: "cover", backgroundPosition: "center" }
                                  : { backgroundColor: opt.hex || "#9CA3AF" }
                              }
                            />
                            {/* Name */}
                            <span className="text-[10px] leading-tight font-body text-text-secondary w-full truncate">
                              {opt.name}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Create new color — collapsible */}
                <div className="border-t border-border shrink-0">
                  {!creatingColor ? (
                    <button
                      type="button"
                      onClick={() => setCreatingColor(true)}
                      className="w-full flex items-center justify-center gap-2 px-5 py-3 text-sm text-text-secondary font-medium hover:text-text-primary hover:bg-[#FAFAFA] transition-colors"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                      Créer une nouvelle couleur
                    </button>
                  ) : (
                    <div className="px-5 py-4 bg-[#FAFAFA] space-y-3">
                      <div className="flex items-center justify-between">
                        <p className="text-[11px] font-semibold text-text-secondary font-body uppercase tracking-wide">Nouvelle couleur</p>
                        <button
                          type="button"
                          onClick={() => { setCreatingColor(false); setNewColorName(""); setNewColorPatternFile(null); setNewColorPatternPreview(null); }}
                          className="w-6 h-6 flex items-center justify-center rounded-full hover:bg-[#E5E5E5] transition-colors"
                          aria-label="Fermer"
                        >
                          <svg className="w-3.5 h-3.5 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                      <div className="flex gap-2">
                        <input
                          className="field-input flex-1"
                          placeholder="Nom de la couleur"
                          value={newColorName}
                          onChange={(e) => setNewColorName(e.target.value)}
                          autoFocus
                        />
                        <div className="flex rounded-lg border border-border overflow-hidden shrink-0">
                          <button
                            type="button"
                            onClick={() => setNewColorMode("hex")}
                            className={`text-[11px] px-2.5 py-2 transition-colors ${
                              newColorMode === "hex" ? "bg-bg-dark text-text-inverse" : "bg-bg-primary text-text-secondary hover:bg-bg-secondary"
                            }`}
                          >
                            Unie
                          </button>
                          <button
                            type="button"
                            onClick={() => setNewColorMode("pattern")}
                            className={`text-[11px] px-2.5 py-2 border-l border-border transition-colors ${
                              newColorMode === "pattern" ? "bg-bg-dark text-text-inverse" : "bg-bg-primary text-text-secondary hover:bg-bg-secondary"
                            }`}
                          >
                            Motif
                          </button>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        {newColorMode === "hex" ? (
                          <>
                            <input
                              type="color"
                              value={newColorHex}
                              onChange={(e) => setNewColorHex(e.target.value)}
                              className="w-9 h-9 rounded-lg cursor-pointer border border-border shrink-0"
                            />
                            <input
                              className="field-input w-24 font-mono text-xs"
                              value={newColorHex}
                              onChange={(e) => setNewColorHex(e.target.value)}
                            />
                          </>
                        ) : (
                          <>
                            {newColorPatternPreview ? (
                              <div className="flex items-center gap-2">
                                <div
                                  className="w-9 h-9 rounded-lg border border-border shrink-0"
                                  style={{ backgroundImage: `url(${newColorPatternPreview})`, backgroundSize: "cover", backgroundPosition: "center" }}
                                />
                                <button
                                  type="button"
                                  onClick={() => { setNewColorPatternFile(null); setNewColorPatternPreview(null); }}
                                  className="text-[11px] text-red-500 hover:underline"
                                >
                                  Supprimer
                                </button>
                              </div>
                            ) : (
                              <label className="flex items-center gap-2 px-3 py-2 border border-dashed border-[#D0D0D0] rounded-lg cursor-pointer hover:border-[#9CA3AF] transition-colors">
                                <svg className="w-4 h-4 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                </svg>
                                <span className="text-[11px] text-text-muted">PNG, JPG, WebP — max 500 Ko</span>
                                <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={handlePatternFileChange} />
                              </label>
                            )}
                          </>
                        )}
                        <button
                          type="button"
                          onClick={createNewColorInModal}
                          disabled={savingColor || !newColorName.trim() || (newColorMode === "pattern" && !newColorPatternFile)}
                          className="btn-primary text-xs px-3 py-2 ml-auto disabled:opacity-50 shrink-0"
                        >
                          {savingColor ? "..." : "Créer"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Footer — page 1 */}
                <div className="flex items-center justify-between px-5 py-3.5 border-t border-border bg-bg-primary shrink-0">
                  <span className="text-xs text-text-muted font-body">
                    {selectedColors.length === 0 ? "Aucune couleur" : `${selectedColors.length} couleur${selectedColors.length > 1 ? "s" : ""}`}
                  </span>
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={closeColorModal}
                      className="px-4 py-2.5 text-xs font-medium font-body text-text-secondary bg-bg-primary border border-border rounded-lg hover:bg-bg-secondary transition-colors"
                    >
                      Annuler
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowVariantForm(true)}
                      disabled={selectedColors.length === 0}
                      className="px-4 py-2.5 text-xs font-medium font-body text-text-inverse bg-bg-dark rounded-lg hover:bg-primary-hover transition-colors disabled:opacity-40 flex items-center gap-1.5"
                    >
                      Suivant
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </button>
                  </div>
                </div>
              </>
            ) : (
              /* ═══ PAGE 2: Variant attributes form ═══ */
              <>
                {/* Header — page 2 */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setShowVariantForm(false)}
                      className="w-8 h-8 flex items-center justify-center hover:bg-bg-secondary rounded-lg transition-colors"
                      aria-label="Retour"
                    >
                      <svg className="w-4 h-4 text-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                      </svg>
                    </button>
                    <div>
                      <h3 className="text-sm font-semibold font-heading text-text-primary">
                        Attributs de la variante
                      </h3>
                      <p className="text-[11px] text-text-muted font-body mt-0.5">
                        Étape 2/2 — Renseignez les détails
                      </p>
                    </div>
                  </div>
                  <button type="button" onClick={closeColorModal} className="w-8 h-8 flex items-center justify-center hover:bg-bg-secondary rounded-lg transition-colors" aria-label="Fermer">
                    <svg className="w-4 h-4 text-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                {/* Selected colors summary */}
                <div className="px-5 py-3 bg-bg-secondary border-b border-border shrink-0">
                  <p className="text-[11px] font-semibold text-text-secondary font-body uppercase tracking-wide mb-2">
                    Couleurs sélectionnées
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {selectedColors.map((s, idx) => (
                      <div key={s.colorId} className="flex items-center gap-1.5 bg-bg-primary border border-border rounded-full px-2.5 py-1">
                        <span className={`text-[9px] font-bold w-4 h-4 flex items-center justify-center rounded-full shrink-0
                          ${idx === 0 ? "bg-bg-dark text-text-inverse" : "bg-[#E5E5E5] text-text-secondary"}
                        `}>
                          {idx + 1}
                        </span>
                        <ColorSwatch hex={s.colorHex} patternImage={s.patternImage} size={14} rounded="full" />
                        <span className="text-[11px] font-body text-text-primary">{s.colorName}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Form fields */}
                <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="field-label">Prix unitaire HT (€) <span className="text-red-500">*</span></label>
                      <input
                        type="number"
                        step="0.01"
                        min="0.01"
                        className={`field-input w-full ${variantPrice && variantPriceNum <= 0 ? "!border-red-400" : ""}`}
                        placeholder="Ex : 4.50"
                        value={variantPrice}
                        onChange={(e) => setVariantPrice(e.target.value)}
                        autoFocus
                      />
                      {variantPrice && variantPriceNum <= 0 && (
                        <p className="text-[10px] text-red-500 mt-0.5">Le prix doit être supérieur à 0</p>
                      )}
                    </div>
                    <div>
                      <label className="field-label">Poids (g) <span className="text-red-500">*</span></label>
                      <input
                        type="number"
                        min="1"
                        className={`field-input w-full ${variantWeight && variantWeightNum <= 0 ? "!border-red-400" : ""}`}
                        placeholder="Ex : 8"
                        value={variantWeight}
                        onChange={(e) => setVariantWeight(e.target.value)}
                      />
                      {variantWeight && variantWeightNum <= 0 && (
                        <p className="text-[10px] text-red-500 mt-0.5">Le poids doit être supérieur à 0</p>
                      )}
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
                      <label className="field-label">Taille</label>
                      <input
                        type="text"
                        className="field-input w-full"
                        placeholder="Ex : 17, L, XL"
                        value={variantSize}
                        onChange={(e) => setVariantSize(e.target.value)}
                      />
                    </div>
                  </div>

                  <div>
                    <label className="field-label">Type de vente <span className="text-red-500">*</span></label>
                    <div className="flex gap-2 mt-1">
                      <button
                        type="button"
                        onClick={() => setVariantSaleType("UNIT")}
                        className={`flex-1 text-sm px-4 py-2.5 rounded-lg border transition-colors font-medium ${
                          variantSaleType === "UNIT"
                            ? "bg-bg-dark text-text-inverse border-[#1A1A1A]"
                            : "bg-bg-primary text-text-secondary border-border hover:border-[#9CA3AF]"
                        }`}
                      >
                        Unité
                      </button>
                      <button
                        type="button"
                        onClick={() => setVariantSaleType("PACK")}
                        className={`flex-1 text-sm px-4 py-2.5 rounded-lg border transition-colors font-medium ${
                          variantSaleType === "PACK"
                            ? "bg-bg-dark text-text-inverse border-[#1A1A1A]"
                            : "bg-bg-primary text-text-secondary border-border hover:border-[#9CA3AF]"
                        }`}
                      >
                        Pack
                      </button>
                    </div>
                  </div>

                  {variantSaleType === "PACK" && (
                    <div>
                      <label className="field-label">Quantité par pack <span className="text-red-500">*</span></label>
                      <input
                        type="number"
                        min="2"
                        className={`field-input w-full ${variantPackQty && variantPackQtyNum < 2 ? "!border-red-400" : ""}`}
                        placeholder="Ex : 6"
                        value={variantPackQty}
                        onChange={(e) => setVariantPackQty(e.target.value)}
                      />
                      {variantPackQty && variantPackQtyNum < 2 && (
                        <p className="text-[10px] text-red-500 mt-0.5">Minimum 2 unités par pack</p>
                      )}
                    </div>
                  )}

                  {/* Validation summary */}
                  {!canSubmitVariant && (variantPrice || variantWeight) && (
                    <div className="flex items-start gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg">
                      <svg className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <p className="text-[11px] text-amber-700 font-body">
                        Remplissez les champs obligatoires (<span className="text-red-500">*</span>) pour continuer.
                      </p>
                    </div>
                  )}
                </div>

                {/* Footer — page 2 */}
                <div className="flex items-center justify-between px-5 py-3.5 border-t border-border bg-bg-primary shrink-0">
                  <button
                    type="button"
                    onClick={() => setShowVariantForm(false)}
                    className="px-4 py-2.5 text-xs font-medium font-body text-text-secondary bg-bg-primary border border-border rounded-lg hover:bg-bg-secondary transition-colors flex items-center gap-1.5"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                    Retour
                  </button>
                  <button
                    type="button"
                    onClick={() => createVariantAndAssign(colorModalIdx)}
                    disabled={!canSubmitVariant || loading === colorModalIdx}
                    className="px-5 py-2.5 text-xs font-medium font-body text-text-inverse bg-bg-dark rounded-lg hover:bg-primary-hover transition-colors disabled:opacity-40"
                  >
                    {loading === colorModalIdx ? "Création..." : "Créer et assigner"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
