"use client";

import { useState, useTransition, useRef, useEffect } from "react";
import Link from "next/link";
import ColorVariantManager, { VariantState, ColorImageState, AvailableColor, uid as genUid, variantGroupKeyFromState } from "./ColorVariantManager";
import { createProduct, updateProduct, saveProductTranslations } from "@/app/actions/admin/products";
import { VALID_LOCALES, LOCALE_LABELS } from "@/i18n/locales";
import LocaleTabs from "./LocaleTabs";
import QuickCreateModal, { QuickCreateType } from "./QuickCreateModal";
import CustomSelect from "@/components/ui/CustomSelect";
import AiCostDialog from "./AiCostDialog";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { LOCALE_FULL_NAMES } from "@/i18n/locales";

interface Category {
  id: string;
  name: string;
  subCategories: { id: string; name: string }[];
}

export interface AvailableComposition {
  id: string;
  name: string;
}

export interface AvailableProduct {
  id: string;
  name: string;
  reference: string;
}

interface CompositionItem {
  compositionId: string;
  percentage: string;
}

interface TranslationState {
  name: string;
  description: string;
}

interface ProductFormProps {
  categories: Category[];
  availableColors: AvailableColor[];
  availableCompositions: AvailableComposition[];
  availableTags?: { id: string; name: string }[];
  mode?: "create" | "edit";
  productId?: string;
  initialData?: {
    reference: string;
    name: string;
    description: string;
    categoryId: string;
    subCategoryIds: string[];
    variants: VariantState[];
    colorImages: ColorImageState[];
    compositions: CompositionItem[];
    similarProductIds: string[];
    similarProducts?: { id: string; name: string; reference: string; category: string; image: string | null }[];
    tagNames: string[];
    isBestSeller: boolean;
    dimLength: string;
    dimWidth: string;
    dimHeight: string;
    dimDiameter: string;
    dimCircumference: string;
    translations?: { locale: string; name: string; description: string }[];
    status?: "OFFLINE" | "ONLINE" | "ARCHIVED" | "SYNCING";
  };
}

function defaultVariant(availableColors: AvailableColor[]): VariantState {
  const first = availableColors[0];
  return {
    tempId:       genUid(),
    colorId:      first?.id   ?? "",
    colorName:    first?.name ?? "",
    colorHex:     first?.hex  ?? "#9CA3AF",
    subColors:    [],
    unitPrice:    "",
    weight:       "",
    stock:        "",
    isPrimary:    true,
    saleType:     "UNIT",
    packQuantity: "",
    size:         "",
    discountType: "",
    discountValue: "",
  };
}

export default function ProductForm({
  categories,
  availableColors,
  availableCompositions,
  availableTags = [],
  mode = "create",
  productId,
  initialData,
}: ProductFormProps) {
  const [isPending, startTransition] = useTransition();

  // ── Local lists — allow modal creation to append items ───────────────
  const [localCategories,   setLocalCategories]   = useState(categories);
  const [localCompositions, setLocalCompositions] = useState(availableCompositions);
  const [localColors,       setLocalColors]       = useState(availableColors);
  const [localTags,         setLocalTags]         = useState(availableTags);

  // ── Form fields ──────────────────────────────────────────────────────
  const [reference,       setReference]       = useState(initialData?.reference       ?? "");
  const [name,            setName]            = useState(initialData?.name            ?? "");
  const [description,     setDescription]     = useState(initialData?.description     ?? "");
  const [categoryId,      setCategoryId]      = useState(initialData?.categoryId      ?? "");
  const [subCategoryIds,  setSubCategoryIds]  = useState<string[]>(initialData?.subCategoryIds ?? []);
  const [variants, setVariants] = useState<VariantState[]>(
    initialData?.variants ??
    (availableColors.length > 0 ? [defaultVariant(availableColors)] : [])
  );
  const [colorImages, setColorImages] = useState<ColorImageState[]>(
    initialData?.colorImages ?? []
  );
  const [compositions, setCompositions] = useState<CompositionItem[]>(initialData?.compositions ?? []);
  const [similarProductIds, setSimilarProductIds] = useState<string[]>(initialData?.similarProductIds ?? []);
  const [tagNames,          setTagNames]          = useState<string[]>(initialData?.tagNames ?? []);
  const [isBestSeller,      setIsBestSeller]      = useState(initialData?.isBestSeller ?? false);

  // ── Dimensions ───────────────────────────────────────────────────────
  const [dimLength,        setDimLength]        = useState(initialData?.dimLength        ?? "");
  const [dimWidth,         setDimWidth]         = useState(initialData?.dimWidth         ?? "");
  const [dimHeight,        setDimHeight]        = useState(initialData?.dimHeight        ?? "");
  const [dimDiameter,      setDimDiameter]      = useState(initialData?.dimDiameter      ?? "");
  const [dimCircumference, setDimCircumference] = useState(initialData?.dimCircumference ?? "");

  const [error, setError] = useState("");
  const [onlineErrors, setOnlineErrors] = useState<string[]>([]);
  const [productStatus, setProductStatus] = useState<"OFFLINE" | "ONLINE" | "ARCHIVED">(
    initialData?.status === "SYNCING" ? "OFFLINE" : (initialData?.status ?? "OFFLINE")
  );

  // ── Sync colorImages when variant colors change ───────────────────────
  // One ColorImageState per color group (colorId + sub-colors), shared across UNIT/PACK variants
  const variantColorKey = variants
    .filter((v) => v.colorId)
    .map((v) => variantGroupKeyFromState(v))
    .sort()
    .join(",");
  useEffect(() => {
    // Build unique groups: groupKey → display info
    const groupMap = new Map<string, { colorId: string; name: string; hex: string }>();
    for (const v of variants) {
      if (!v.colorId) continue;
      const gk = variantGroupKeyFromState(v);
      if (!groupMap.has(gk)) {
        const allNames = [v.colorName, ...v.subColors.map((sc) => sc.colorName)];
        groupMap.set(gk, { colorId: v.colorId, name: allNames.join(" / "), hex: v.colorHex });
      }
    }
    setColorImages((prev) => {
      // Keep entries whose group still exists or that have uploaded images
      const filtered = prev.filter((ci) =>
        groupMap.has(ci.groupKey) || ci.uploadedPaths.length > 0
      );
      // Update existing entries with latest display name/hex/colorId
      const updated = filtered.map((ci) => {
        const info = groupMap.get(ci.groupKey);
        if (info && (ci.colorName !== info.name || ci.colorHex !== info.hex || ci.colorId !== info.colorId)) {
          return { ...ci, colorId: info.colorId, colorName: info.name, colorHex: info.hex };
        }
        return ci;
      });
      const existingKeys = new Set(updated.map((ci) => ci.groupKey));
      const toAdd: ColorImageState[] = [];
      for (const [gk, info] of groupMap) {
        if (!existingKeys.has(gk)) {
          toAdd.push({
            groupKey: gk,
            colorId: info.colorId,
            colorName: info.name,
            colorHex: info.hex,
            imagePreviews: [],
            uploadedPaths: [],
            orders: [],
            uploading: false,
          });
        }
      }
      const result = [...updated, ...toAdd];
      if (result.length === prev.length && result.every((r, i) => r === prev[i])) return prev;
      return result;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variantColorKey]);

  // ── Composition picker state ─────────────────────────────────────────
  const [newCompId, setNewCompId] = useState("");

  // ── Locale tabs ──────────────────────────────────────────────────────
  const [activeLocale, setActiveLocale] = useState("fr");
  const [translations, setTranslations] = useState<Record<string, TranslationState>>(() => {
    const map: Record<string, TranslationState> = {};
    for (const t of initialData?.translations ?? []) {
      if (t.locale !== "fr") map[t.locale] = { name: t.name, description: t.description };
    }
    return map;
  });

  // ── Quick-create modal ───────────────────────────────────────────────
  const [modalType, setModalType] = useState<QuickCreateType | null>(null);

  // ── AI generation ────────────────────────────────────────────────────
  const [aiLoading,    setAiLoading]    = useState(false);
  const [aiError,      setAiError]      = useState("");
  const [aiCostDialog, setAiCostDialog] = useState<{
    estimatedCostUsd: number;
    productInfo: Record<string, unknown>;
    imagePaths: string[];
  } | null>(null);
  const [aiSuccess, setAiSuccess] = useState("");

  // ── Translate all (name + description) ─────────────────────────────
  const [translateLoading, setTranslateLoading] = useState(false);
  const [translateError, setTranslateError] = useState("");
  const [translateSuccess, setTranslateSuccess] = useState("");
  const { confirm } = useConfirm();

  const localeListStr = Object.entries(LOCALE_FULL_NAMES)
    .filter(([k]) => k !== "fr")
    .map(([, v]) => v)
    .join(", ");

  async function handleTranslateAll() {
    if (!name.trim() && !description.trim()) return;
    setTranslateError("");
    setTranslateSuccess("");

    // Fetch quota
    let remaining: number;
    let resetDate: string;
    try {
      const res = await fetch("/api/admin/translate");
      const data = await res.json();
      remaining = data.remaining;
      resetDate = data.resetDate;
    } catch {
      setTranslateError("Impossible de vérifier le quota.");
      return;
    }

    const texts = [name.trim(), description.trim()].filter(Boolean);
    const totalChars = texts.reduce((sum, t) => sum + t.length, 0) * 6;

    if (remaining < totalChars) {
      const formatted = new Date(resetDate).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
      setTranslateError(`Quota insuffisant. Réinitialisation le ${formatted}.`);
      return;
    }

    const confirmed = await confirm({
      type: "info",
      title: "Tout traduire (nom + description)",
      message: `Traduire le nom et la description vers ${localeListStr}.\n\nCaractères nécessaires : ${totalChars.toLocaleString("fr-FR")} (× 6 langues)\nCaractères restants : ${remaining.toLocaleString("fr-FR")} / 500 000`,
      confirmLabel: "Traduire",
      cancelLabel: "Annuler",
    });
    if (!confirmed) return;

    setTranslateLoading(true);
    try {
      const res = await fetch("/api/admin/translate-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texts }),
      });

      if (res.status === 429) {
        const data = await res.json();
        setTranslateError(data.message);
        return;
      }
      if (!res.ok) throw new Error("Erreur traduction");

      const data = await res.json();
      const results: Record<string, string>[] = data.results;

      // results[0] = name translations, results[1] = description translations (if both provided)
      const nameIdx = name.trim() ? 0 : -1;
      const descIdx = name.trim() && description.trim() ? 1 : description.trim() ? 0 : -1;

      const newTranslations: Record<string, { name: string; description: string }> = {};
      for (const locale of ["en", "ar", "zh", "de", "es", "it"]) {
        newTranslations[locale] = {
          name: nameIdx >= 0 ? (results[nameIdx]?.[locale] ?? "") : "",
          description: descIdx >= 0 ? (results[descIdx]?.[locale] ?? "") : "",
        };
      }

      setTranslations((prev) => {
        const next = { ...prev };
        for (const locale of ["en", "ar", "zh", "de", "es", "it"]) {
          next[locale] = {
            name: newTranslations[locale].name || (next[locale]?.name ?? ""),
            description: newTranslations[locale].description || (next[locale]?.description ?? ""),
          };
        }
        return next;
      });

      // Auto-save translations in edit mode
      if (mode === "edit" && productId) {
        try {
          const toSave = Object.entries(newTranslations)
            .filter(([, t]) => t.name.trim() || t.description.trim())
            .map(([locale, t]) => ({ locale, name: t.name, description: t.description }));
          await saveProductTranslations(productId, toSave);
          setTranslateSuccess("Traductions générées et enregistrées !");
        } catch {
          setTranslateSuccess("Traductions générées (erreur lors de la sauvegarde automatique).");
        }
      } else {
        setTranslateSuccess("Traductions générées avec succès !");
      }
      setTimeout(() => setTranslateSuccess(""), 4000);
    } catch {
      setTranslateError("Erreur lors de la traduction.");
    } finally {
      setTranslateLoading(false);
    }
  }

  // ── Derived ──────────────────────────────────────────────────────────
  const selectedCategory = localCategories.find((c) => c.id === categoryId);
  const subCategories    = selectedCategory?.subCategories ?? [];

  // Locales that have at least a name filled (green dot)
  const filledLocales = new Set<string>(
    VALID_LOCALES.filter((l) =>
      l === "fr" ? name.trim().length > 0 : (translations[l]?.name?.trim().length ?? 0) > 0
    )
  );

  // Locales that have NO saved DB translation — only relevant in edit mode
  const missingDbLocales = mode === "edit"
    ? new Set<string>(
        VALID_LOCALES.filter((l) => {
          if (l === "fr") return false; // FR is always in product.name
          const saved = initialData?.translations?.find((t) => t.locale === l);
          return !saved; // missing if not in DB at all
        })
      )
    : undefined;

  function toggleSubCategory(id: string) {
    setSubCategoryIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  // ── Composition helpers ──────────────────────────────────────────────
  const totalPct = compositions.reduce((sum, c) => sum + parseFloat(c.percentage || "0"), 0);

  function addComposition() {
    if (!newCompId) return;
    if (compositions.some((c) => c.compositionId === newCompId)) return;
    const evenPct = (100 / (compositions.length + 1)).toFixed(1);
    const updated = compositions.map((c) => ({ ...c, percentage: evenPct }));
    setCompositions([...updated, { compositionId: newCompId, percentage: evenPct }]);
    setNewCompId("");
  }

  function updateCompositionPct(compositionId: string, pct: string) {
    setCompositions(compositions.map((c) =>
      c.compositionId === compositionId ? { ...c, percentage: pct } : c
    ));
  }

  function removeComposition(compositionId: string) {
    const remaining = compositions.filter((c) => c.compositionId !== compositionId);
    if (remaining.length === 0) { setCompositions([]); return; }
    const evenPct = (100 / remaining.length).toFixed(1);
    setCompositions(remaining.map((c) => ({ ...c, percentage: evenPct })));
  }

  // ── Tag helpers ──────────────────────────────────────────────────────
  function removeTag(tag: string) {
    setTagNames((prev) => prev.filter((x) => x !== tag));
  }

  // ── Color quick-create handler ────────────────────────────────────────
  async function handleQuickCreateColor(colorName: string, hex: string | null, patternImage: string | null): Promise<AvailableColor> {
    const { createColorQuick } = await import("@/app/actions/admin/quick-create");
    const created = await createColorQuick({ fr: colorName }, hex, patternImage);
    setLocalColors((prev) => [...prev, created]);
    return created;
  }

  // ── Quick-create modal handlers ──────────────────────────────────────
  function handleModalCreated(item: { id: string; name: string; hex?: string | null; subCategories?: { id: string; name: string }[] }) {
    if (modalType === "category") {
      const cat = { id: item.id, name: item.name, subCategories: item.subCategories ?? [] };
      setLocalCategories((prev) => [...prev, cat]);
      setCategoryId(item.id);
      setSubCategoryIds([]);
    } else if (modalType === "subcategory") {
      setLocalCategories((prev) =>
        prev.map((cat) =>
          cat.id === categoryId
            ? { ...cat, subCategories: [...cat.subCategories, { id: item.id, name: item.name }] }
            : cat
        )
      );
      setSubCategoryIds((prev) => [...prev, item.id]);
    } else if (modalType === "composition") {
      setLocalCompositions((prev) => [...prev, { id: item.id, name: item.name }]);
    } else if (modalType === "color") {
      setLocalColors((prev) => [...prev, { id: item.id, name: item.name, hex: item.hex ?? null }]);
    } else if (modalType === "tag") {
      setLocalTags((prev) => [...prev, { id: item.id, name: item.name }]);
      setTagNames((prev) => (prev.includes(item.name) ? prev : [...prev, item.name]));
    }
    setModalType(null);
  }

  // ── Locale field helpers ─────────────────────────────────────────────
  const activeName        = activeLocale === "fr" ? name        : (translations[activeLocale]?.name        ?? "");
  const activeDescription = activeLocale === "fr" ? description : (translations[activeLocale]?.description ?? "");

  function setActiveName(val: string) {
    if (activeLocale === "fr") {
      setName(val);
    } else {
      setTranslations((prev) => ({
        ...prev,
        [activeLocale]: { name: val, description: prev[activeLocale]?.description ?? "" },
      }));
    }
  }

  function setActiveDescription(val: string) {
    if (activeLocale === "fr") {
      setDescription(val);
    } else {
      setTranslations((prev) => ({
        ...prev,
        [activeLocale]: { name: prev[activeLocale]?.name ?? "", description: val },
      }));
    }
  }

  // ── AI generation ────────────────────────────────────────────────────
  async function handleAiEstimate() {
    setAiError("");
    setAiSuccess("");
    setAiLoading(true);
    try {
      const catName     = localCategories.find((c) => c.id === categoryId)?.name ?? "";
      const subCatNames = subCategoryIds.flatMap((id) =>
        localCategories.flatMap((cat) => cat.subCategories.filter((s) => s.id === id).map((s) => s.name))
      );
      const compData  = compositions.map((c) => ({
        name:       localCompositions.find((lc) => lc.id === c.compositionId)?.name ?? "",
        percentage: parseFloat(c.percentage) || 0,
      })).filter((c) => c.name);
      const colorData = [...new Map(variants.map((v) => [v.colorId, { name: v.colorName, hex: v.colorHex }])).values()];
      const imagePaths = colorImages.flatMap((ci) => ci.uploadedPaths);

      const productInfo = {
        categoryName:     catName,
        subCategoryNames: subCatNames,
        tagNames,
        compositions:     compData,
        colors:           colorData,
        dimensions: {
          length:        dimLength        ? parseFloat(dimLength)        : null,
          width:         dimWidth         ? parseFloat(dimWidth)         : null,
          height:        dimHeight        ? parseFloat(dimHeight)        : null,
          diameter:      dimDiameter      ? parseFloat(dimDiameter)      : null,
          circumference: dimCircumference ? parseFloat(dimCircumference) : null,
        },
      };

      const res  = await fetch("/api/admin/products/generate-ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ estimateOnly: true, productInfo, imagePaths }),
      });
      const data = await res.json();
      setAiCostDialog({ estimatedCostUsd: data.estimatedCostUsd, productInfo, imagePaths });
    } catch (e) {
      setAiError(e instanceof Error ? e.message : "Erreur lors de l'estimation.");
    } finally {
      setAiLoading(false);
    }
  }

  async function handleAiConfirm() {
    if (!aiCostDialog) return;
    const { productInfo, imagePaths } = aiCostDialog;
    setAiCostDialog(null);
    setAiLoading(true);
    setAiError("");
    try {
      const res  = await fetch("/api/admin/products/generate-ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productInfo, imagePaths, locales: ["fr"] }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erreur IA");

      const aiTranslations: Record<string, { name: string; description: string }> = data.translations;

      if (aiTranslations.fr) {
        setName(aiTranslations.fr.name);
        setDescription(aiTranslations.fr.description);
      }

      const actualCost = data.actualCostUsd ?? data.estimatedCostUsd ?? 0;
      setAiSuccess(`Généré avec succès ! Coût réel : $${actualCost.toFixed(4)}. Utilisez "Tout traduire" pour les autres langues.`);
      setTimeout(() => setAiSuccess(""), 6000);
    } catch (e) {
      setAiError(e instanceof Error ? e.message : "Erreur lors de la génération IA.");
    } finally {
      setAiLoading(false);
    }
  }

  // ── Online requirements validation ───────────────────────────────────
  function getOnlineValidationErrors(): string[] {
    const errors: string[] = [];
    if (!reference.trim())    errors.push("Référence produit manquante");
    if (!name.trim())         errors.push("Nom du produit manquant");
    if (!description.trim())  errors.push("Description manquante");
    if (!categoryId)          errors.push("Catégorie non sélectionnée");
    if (compositions.length === 0) errors.push("Au moins une composition est requise");
    if (variants.length === 0) {
      errors.push("Au moins une variante de couleur est requise");
    } else {
      const hasImage = colorImages.some((ci) => ci.uploadedPaths.length > 0);
      if (!hasImage) errors.push("Au moins une variante doit avoir une image");
    }
    return errors;
  }

  // ── Submit ───────────────────────────────────────────────────────────
  async function handleSave(statusOverride?: "OFFLINE" | "ONLINE" | "ARCHIVED") {
    const targetStatus = statusOverride ?? productStatus;
    setError("");
    setOnlineErrors([]);

    // When going online, validate specific requirements first
    if (targetStatus === "ONLINE") {
      const onlineErrs = getOnlineValidationErrors();
      if (onlineErrs.length > 0) {
        setOnlineErrors(onlineErrs);
        return;
      }
    }

    if (!reference.trim())    return setError("La référence est requise.");
    if (!name.trim())         return setError("Le nom est requis.");
    if (!description.trim())  return setError("La description est requise.");
    if (!categoryId)          return setError("Veuillez choisir une catégorie.");
    if (variants.length === 0) return setError("Ajoutez au moins une variante.");

    for (const v of variants) {
      if (!v.colorId) return setError("Chaque variante doit avoir une couleur sélectionnée.");
      const price = parseFloat(v.unitPrice);
      if (isNaN(price) || price <= 0) return setError(`Prix invalide pour "${v.colorName || "variante"}".`);
      const w = parseFloat(v.weight);
      if (isNaN(w) || w <= 0) return setError(`Poids invalide pour "${v.colorName || "variante"}".`);
      if (v.stock !== "" && parseInt(v.stock) < 0)
        return setError(`Stock invalide pour "${v.colorName || "variante"}" (doit être ≥ 0).`);
      if (v.saleType === "PACK") {
        const qty = parseInt(v.packQuantity);
        if (isNaN(qty) || qty < 2) return setError(`Quantité paquet invalide pour "${v.colorName}" (minimum 2).`);
      }
    }
    // Duplicate variant checks — use full groupKey (colorId + ordered sub-colors)
    const unitByGroup = new Map<string, boolean>();
    for (const v of variants) {
      if (v.saleType === "UNIT") {
        const gk = variantGroupKeyFromState(v);
        if (unitByGroup.has(gk)) return setError(`La couleur "${v.colorName}" a déjà une variante à l'unité.`);
        unitByGroup.set(gk, true);
      }
    }
    const packKeys2 = new Set<string>();
    for (const v of variants) {
      if (v.saleType === "PACK" && v.packQuantity) {
        const gk = variantGroupKeyFromState(v);
        const key = `${gk}__${v.packQuantity}`;
        if (packKeys2.has(key)) return setError(`La couleur "${v.colorName}" a deux paquets de même quantité.`);
        packKeys2.add(key);
      }
    }
    if (colorImages.some((ci) => ci.uploading)) return setError("Des images sont encore en cours d'upload. Veuillez patienter.");

    if (compositions.length > 0 && Math.abs(totalPct - 100) > 0.5) {
      return setError(`La composition doit totaliser 100%. Total actuel : ${totalPct.toFixed(1)}%`);
    }

    const payload = {
      reference:     reference.trim().toUpperCase(),
      name:          name.trim(),
      description:   description.trim(),
      categoryId,
      subCategoryIds,
      colors: variants.map((v) => ({
        dbId:          v.dbId,
        colorId:       v.colorId,
        subColorIds:   v.subColors.map((sc) => sc.colorId),
        unitPrice:     parseFloat(v.unitPrice),
        weight:        parseFloat(v.weight),
        stock:         parseInt(v.stock) || 0,
        isPrimary:     v.isPrimary,
        saleType:      v.saleType,
        packQuantity:  v.saleType === "PACK" ? (parseInt(v.packQuantity) || null) : null,
        size:          v.size.trim() || null,
        discountType:  v.discountType || null,
        discountValue: v.discountValue ? parseFloat(v.discountValue) : null,
      })),
      imagePaths: colorImages.map((ci) => {
        const v = variants.find((vr) => variantGroupKeyFromState(vr) === ci.groupKey);
        return {
          colorId: ci.colorId,
          subColorIds: v ? v.subColors.map((sc) => sc.colorId) : [],
          variantDbId: v?.dbId ?? undefined,
          paths: ci.uploadedPaths,
          orders: ci.orders,
        };
      }),
      compositions: compositions.map((c) => ({
        compositionId: c.compositionId,
        percentage:    parseFloat(c.percentage),
      })),
      similarProductIds,
      tagNames,
      isBestSeller,
      status: targetStatus,
      dimensionLength:        dimLength        ? parseFloat(dimLength)        : null,
      dimensionWidth:         dimWidth         ? parseFloat(dimWidth)         : null,
      dimensionHeight:        dimHeight        ? parseFloat(dimHeight)        : null,
      dimensionDiameter:      dimDiameter      ? parseFloat(dimDiameter)      : null,
      dimensionCircumference: dimCircumference ? parseFloat(dimCircumference) : null,
      translations: Object.entries(translations)
        .filter(([, t]) => t.name.trim() || t.description.trim())
        .map(([locale, t]) => ({ locale, name: t.name, description: t.description })),
    };

    startTransition(async () => {
      try {
        if (mode === "edit" && productId) {
          await updateProduct(productId, payload);
        } else {
          await createProduct(payload);
        }
        setProductStatus(targetStatus);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Une erreur est survenue.");
      }
    });
  }

  return (
    <>
      <form onSubmit={(e) => { e.preventDefault(); handleSave(); }} className="space-y-8">

        {/* ── Informations du produit ── */}
        <div className="space-y-4">
          <h2 className="font-[family-name:var(--font-poppins)] text-xl font-bold text-[#1A1A1A]">
            Informations du produit
          </h2>

          {/* Row 1 : Bloc principal (left) + Bloc mots clés (right) */}
          <div className="grid grid-cols-1 xl:grid-cols-[1fr_380px] gap-4">

            {/* ── BLOC PRINCIPAL ── */}
            <div className="bg-white border border-[#E5E5E5] rounded-2xl p-6 space-y-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">

              {/* Header: titre + langue tabs + bouton IA */}
              <div className="flex flex-wrap items-center gap-3">
                <p className="text-sm font-semibold text-[#1A1A1A] font-[family-name:var(--font-poppins)] shrink-0">
                  Fiche produit
                </p>
                <div className="flex-1 flex flex-wrap items-center gap-2">
                  <LocaleTabs
                    locales={VALID_LOCALES}
                    activeLocale={activeLocale}
                    localeLabels={LOCALE_LABELS}
                    onChange={setActiveLocale}
                    filledLocales={filledLocales}
                    missingDbLocales={missingDbLocales}
                  />
                </div>
                <button
                  type="button"
                  onClick={handleAiEstimate}
                  disabled={aiLoading}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-[#1A1A1A] hover:bg-black text-white text-xs font-semibold rounded-lg transition-colors disabled:opacity-50 font-[family-name:var(--font-roboto)] shrink-0"
                >
                  {aiLoading ? (
                    <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                        d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09Z" />
                    </svg>
                  )}
                  Générer avec l&apos;IA
                </button>
                <button
                  type="button"
                  onClick={handleTranslateAll}
                  disabled={translateLoading || (!name.trim() && !description.trim())}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-[#F7F7F8] hover:bg-[#E5E5E5] text-[#1A1A1A] border border-[#E5E5E5] text-xs font-medium rounded-lg transition-colors disabled:opacity-50 font-[family-name:var(--font-roboto)] shrink-0"
                >
                  {translateLoading ? (
                    <span className="w-3.5 h-3.5 border-2 border-[#1A1A1A]/30 border-t-[#1A1A1A] rounded-full animate-spin" />
                  ) : (
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                        d="m10.5 21 5.25-11.25L21 21m-9-3h7.5M3 5.621a48.474 48.474 0 0 1 6-.371m0 0c1.12 0 2.233.038 3.334.114M9 5.25V3m3.334 2.364C11.176 10.658 7.69 15.08 3 17.502m9.334-12.138c.896.061 1.785.147 2.666.257m-4.589 8.495a18.023 18.023 0 0 1-3.827-5.802" />
                    </svg>
                  )}
                  Tout traduire
                </button>
              </div>

              {/* AI feedback */}
              {aiError && (
                <p className="text-xs text-[#DC2626] font-[family-name:var(--font-roboto)] bg-[#FEF2F2] px-3 py-2 rounded-lg">
                  {aiError}
                </p>
              )}
              {aiSuccess && (
                <p className="text-xs text-[#15803D] font-[family-name:var(--font-roboto)] bg-[#F0FDF4] px-3 py-2 rounded-lg">
                  {aiSuccess}
                </p>
              )}
              {translateError && (
                <p className="text-xs text-[#DC2626] font-[family-name:var(--font-roboto)] bg-[#FEF2F2] px-3 py-2 rounded-lg">
                  {translateError}
                </p>
              )}
              {translateSuccess && (
                <p className="text-xs text-[#15803D] font-[family-name:var(--font-roboto)] bg-[#F0FDF4] px-3 py-2 rounded-lg">
                  {translateSuccess}
                </p>
              )}

              {/* Référence (always FR, not locale-dependent) */}
              <Field label="Référence produit *" hint="Ex: BJ-COL-001">
                <input type="text" value={reference} onChange={(e) => setReference(e.target.value.toUpperCase())}
                  placeholder="BJ-COL-001" className="field-input" required />
              </Field>

              {/* Non-FR hint + missing translation warning */}
              {activeLocale !== "fr" && (
                <div className="space-y-2">
                  <div className="bg-[#F7F7F8] border border-[#E5E5E5] rounded-lg px-3 py-2 text-xs text-[#6B6B6B] font-[family-name:var(--font-roboto)]">
                    Langue active : <strong>{LOCALE_LABELS[activeLocale]}</strong> — le nom et la description seront sauvegardés en tant que traduction.
                    Les champs Catégorie, Sous-catégories, Tags, Composition et Couleurs restent en français.
                  </div>
                  {missingDbLocales?.has(activeLocale) && (
                    <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-800 font-[family-name:var(--font-roboto)]">
                      <span className="text-base leading-none mt-0.5">⚠️</span>
                      <span>
                        <strong>Traduction manquante</strong> — Aucune traduction enregistrée en <strong>{LOCALE_LABELS[activeLocale]}</strong>.
                        Le produit s&apos;affichera en français par défaut pour les visiteurs dans cette langue.
                        Utilisez le bouton &laquo;&nbsp;Générer avec l&apos;IA&nbsp;&raquo; ou remplissez manuellement les champs.
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* Nom */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-sm font-[family-name:var(--font-roboto)] font-semibold text-[#6B6B6B]">
                    Nom du produit *{activeLocale !== "fr" ? ` (${LOCALE_LABELS[activeLocale]})` : ""}
                  </label>
                </div>
                <input
                  type="text"
                  value={activeName}
                  onChange={(e) => setActiveName(e.target.value)}
                  placeholder={activeLocale === "fr" ? "Collier sautoir doré" : `Nom en ${LOCALE_LABELS[activeLocale]}…`}
                  className="field-input"
                  required={activeLocale === "fr"}
                />
              </div>

              {/* Catégorie + sous-catégories (always FR) */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                {/* Catégorie */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-sm font-[family-name:var(--font-roboto)] font-semibold text-[#6B6B6B]">Catégorie *</label>
                    <button type="button"
                      onClick={() => setModalType("category")}
                      className="text-xs text-[#1A1A1A] hover:text-[#000000] font-medium font-[family-name:var(--font-roboto)] transition-colors"
                    >+ Créer</button>
                  </div>
                  <CustomSelect
                    value={categoryId}
                    onChange={(v) => { setCategoryId(v); setSubCategoryIds([]); }}
                    options={[
                      { value: "", label: "— Sélectionner —" },
                      ...localCategories.map((cat) => ({ value: cat.id, label: cat.name })),
                    ]}
                    placeholder="— Sélectionner —"
                  />
                </div>

                {/* Sous-catégories */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-sm font-[family-name:var(--font-roboto)] font-semibold text-[#6B6B6B]">
                      Sous-catégories
                      {subCategoryIds.length > 0 && (
                        <span className="ml-2 font-normal text-[#9CA3AF]">({subCategoryIds.length})</span>
                      )}
                    </label>
                    {categoryId && (
                      <button type="button"
                        onClick={() => setModalType("subcategory")}
                        className="text-xs text-[#1A1A1A] hover:text-[#000000] font-medium font-[family-name:var(--font-roboto)] transition-colors"
                      >+ Créer</button>
                    )}
                  </div>
                  {!categoryId ? (
                    <p className="text-xs text-[#9CA3AF] font-[family-name:var(--font-roboto)] py-2">Sélectionnez d&apos;abord une catégorie.</p>
                  ) : subCategories.length === 0 ? (
                    <p className="text-xs text-[#9CA3AF] font-[family-name:var(--font-roboto)] py-2">Aucune sous-catégorie — créez-en une.</p>
                  ) : (
                    <div className="flex flex-wrap gap-2 min-h-[38px] items-start">
                      {subCategories.map((sub) => {
                        const selected = subCategoryIds.includes(sub.id);
                        return (
                          <button key={sub.id} type="button" onClick={() => toggleSubCategory(sub.id)}
                            className={`px-3 py-1.5 text-sm border rounded-lg transition-colors font-[family-name:var(--font-roboto)] ${
                              selected ? "bg-[#1A1A1A] text-white border-[#1A1A1A]" : "bg-white text-[#6B6B6B] border-[#E5E5E5] hover:border-[#1A1A1A]"
                            }`}
                          >{sub.name}</button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* Description */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-sm font-[family-name:var(--font-roboto)] font-semibold text-[#6B6B6B]">
                    Description *{activeLocale !== "fr" ? ` (${LOCALE_LABELS[activeLocale]})` : ""}
                  </label>
                </div>
                <textarea
                  value={activeDescription}
                  onChange={(e) => setActiveDescription(e.target.value)}
                  rows={4}
                  placeholder={activeLocale === "fr" ? "Description commerciale du produit…" : `Description en ${LOCALE_LABELS[activeLocale]}…`}
                  className="field-input resize-none"
                  required={activeLocale === "fr"}
                />
              </div>
            </div>

            {/* ── BLOC MOTS CLÉS ── */}
            <div className="bg-white border border-[#E5E5E5] rounded-2xl p-6 space-y-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-[#1A1A1A] font-[family-name:var(--font-poppins)]">Mots clés & Tags</p>
                <button type="button"
                  onClick={() => setModalType("tag")}
                  className="text-xs text-[#1A1A1A] hover:text-[#000000] font-medium font-[family-name:var(--font-roboto)] transition-colors"
                >+ Créer</button>
              </div>

              {/* Tags existants — picker */}
              {localTags.length > 0 ? (
                <div className="flex flex-wrap gap-1.5 p-3 bg-[#EFEFEF] border border-[#E5E5E5] rounded-lg max-h-44 overflow-y-auto">
                  {localTags.map((t) => {
                    const selected = tagNames.includes(t.name);
                    return (
                      <button key={t.id} type="button"
                        onClick={() => selected ? removeTag(t.name) : setTagNames((prev) => [...prev, t.name])}
                        className={`flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border font-[family-name:var(--font-roboto)] transition-all ${
                          selected
                            ? "bg-[#1A1A1A] text-white border-[#1A1A1A]"
                            : "bg-white text-[#6B6B6B] border-[#E5E5E5] hover:border-[#1A1A1A] hover:text-[#1A1A1A]"
                        }`}
                      >
                        {selected && <span className="text-[10px]">&#10003;</span>}
                        {t.name}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-[#9CA3AF] font-[family-name:var(--font-roboto)]">
                  Aucun tag — cliquez sur &ldquo;+ Créer&rdquo; pour en ajouter.
                </p>
              )}

              {tagNames.length > 0 && (
                <p className="text-xs text-[#9CA3AF] font-[family-name:var(--font-roboto)]">
                  {tagNames.length} sélectionné{tagNames.length > 1 ? "s" : ""} : {tagNames.join(", ")}
                </p>
              )}

              {/* Best Seller */}
              <div className="pt-3 border-t border-[#F0F0F0]">
                <label className="flex items-center gap-3 cursor-pointer group">
                  <input type="checkbox" checked={isBestSeller} onChange={(e) => setIsBestSeller(e.target.checked)}
                    className="w-4 h-4 border-[#E5E5E5] accent-[#1A1A1A]" />
                  <div>
                    <span className="text-sm font-[family-name:var(--font-roboto)] font-semibold text-[#6B6B6B]">Best Seller</span>
                    <p className="text-xs text-[#9CA3AF] font-[family-name:var(--font-roboto)] mt-0.5">Mettre en avant dans les filtres</p>
                  </div>
                </label>
              </div>
            </div>
          </div>

          {/* Row 2 : Bloc dimensions (left) + Bloc composition (right) */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

            {/* ── BLOC DIMENSIONS ── */}
            <div className="bg-white border border-[#E5E5E5] rounded-2xl p-6 space-y-4 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
              <div>
                <p className="text-sm font-semibold text-[#1A1A1A] font-[family-name:var(--font-poppins)]">Dimensions</p>
                <p className="text-xs text-[#9CA3AF] font-[family-name:var(--font-roboto)] mt-0.5">
                  En millimètres (mm) — laisser vide si non applicable.
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <Field label="Longueur">
                  <input type="number" min="0" step="0.1" value={dimLength} placeholder="—"
                    onChange={(e) => setDimLength(e.target.value)} className="field-input text-right" />
                </Field>
                <Field label="Largeur">
                  <input type="number" min="0" step="0.1" value={dimWidth} placeholder="—"
                    onChange={(e) => setDimWidth(e.target.value)} className="field-input text-right" />
                </Field>
                <Field label="Hauteur">
                  <input type="number" min="0" step="0.1" value={dimHeight} placeholder="—"
                    onChange={(e) => setDimHeight(e.target.value)} className="field-input text-right" />
                </Field>
                <Field label="Diamètre">
                  <input type="number" min="0" step="0.1" value={dimDiameter} placeholder="—"
                    onChange={(e) => setDimDiameter(e.target.value)} className="field-input text-right" />
                </Field>
                <Field label="Circonférence">
                  <input type="number" min="0" step="0.1" value={dimCircumference} placeholder="—"
                    onChange={(e) => setDimCircumference(e.target.value)} className="field-input text-right" />
                </Field>
              </div>
            </div>

            {/* ── BLOC COMPOSITION ── */}
            <div className="bg-white border border-[#E5E5E5] rounded-2xl p-6 space-y-4 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-[#1A1A1A] font-[family-name:var(--font-poppins)]">Composition</p>
                  <p className="text-xs text-[#9CA3AF] font-[family-name:var(--font-roboto)] mt-0.5">
                    Matériaux et pourcentages.
                  </p>
                </div>
                <button type="button"
                  onClick={() => setModalType("composition")}
                  className="text-xs text-[#1A1A1A] hover:text-[#000000] font-medium font-[family-name:var(--font-roboto)] transition-colors"
                >+ Créer un matériau</button>
              </div>

              {localCompositions.length > 0 && (
                <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
                  <div className="flex-1">
                    <CustomSelect
                      value={newCompId}
                      onChange={(v) => setNewCompId(v)}
                      options={[
                        { value: "", label: "— Choisir un matériau —" },
                        ...localCompositions
                          .filter((c) => !compositions.some((x) => x.compositionId === c.id))
                          .map((c) => ({ value: c.id, label: c.name })),
                      ]}
                      placeholder="— Choisir un matériau —"
                    />
                  </div>
                  <button type="button" onClick={addComposition} disabled={!newCompId}
                    className="px-4 py-2.5 bg-[#1A1A1A] text-white text-sm font-medium rounded-lg hover:bg-[#000000] transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0 font-[family-name:var(--font-roboto)]"
                  >Ajouter</button>
                </div>
              )}

              {localCompositions.length === 0 && (
                <p className="text-xs text-[#9CA3AF] font-[family-name:var(--font-roboto)]">
                  Aucun matériau — cliquez sur &ldquo;+ Créer un matériau&rdquo; pour en ajouter.
                </p>
              )}

              {compositions.length > 0 && (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-[#6B6B6B] font-[family-name:var(--font-roboto)]">
                      {compositions.length} matériau{compositions.length > 1 ? "x" : ""}
                    </span>
                    <span className={`text-sm font-semibold px-3 py-1 rounded-full font-[family-name:var(--font-roboto)] ${
                      Math.abs(totalPct - 100) <= 0.5
                        ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                        : "bg-[#FEE2E2] text-[#DC2626] border border-[#FECACA]"
                    }`}>
                      Total : {totalPct.toFixed(1)} %{Math.abs(totalPct - 100) <= 0.5 ? " ✓" : " ≠ 100%"}
                    </span>
                  </div>
                  <ul className="divide-y divide-[#E5E5E5] border border-[#E5E5E5] rounded-xl overflow-hidden">
                    {compositions.map((item) => {
                      const comp = localCompositions.find((c) => c.id === item.compositionId);
                      return (
                        <li key={item.compositionId} className="flex items-center justify-between px-4 py-2.5 gap-3">
                          <span className="text-sm font-medium text-[#1A1A1A] font-[family-name:var(--font-roboto)] flex-1 min-w-0 truncate">
                            {comp?.name ?? item.compositionId}
                          </span>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <input type="number" min="0" max="100" step="0.1" value={item.percentage}
                              onChange={(e) => updateCompositionPct(item.compositionId, e.target.value)}
                              className="w-20 field-input px-2 py-1.5 text-sm text-right" />
                            <span className="text-sm text-[#6B6B6B]">%</span>
                          </div>
                          <button type="button" onClick={() => removeComposition(item.compositionId)}
                            className="text-[#1A1A1A] hover:text-[#DC2626] transition-colors text-sm shrink-0"
                          >Retirer</button>
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
            </div>
          </div>
        </div>

        {/* ── Variantes couleur ── */}
        <section className="bg-white border border-[#E5E5E5] rounded-2xl p-8 space-y-5 shadow-card">
          <div className="flex items-center justify-between border-b border-[#E5E5E5] pb-4">
            <h2 className="font-[family-name:var(--font-poppins)] text-xl font-bold text-[#1A1A1A]">
              Variantes
            </h2>
            <span className="text-sm text-[#9CA3AF] font-[family-name:var(--font-roboto)]">
              {variants.length} variante{variants.length > 1 ? "s" : ""}
            </span>
          </div>
          <ColorVariantManager
            variants={variants}
            colorImages={colorImages}
            availableColors={localColors}
            onChange={setVariants}
            onChangeImages={setColorImages}
            onQuickCreateColor={handleQuickCreateColor}
          />
        </section>

        {/* ── Produits similaires ── */}
        <section className="bg-white border border-[#E5E5E5] rounded-2xl p-8 space-y-5 shadow-card">
          <div className="border-b border-[#E5E5E5] pb-4">
            <h2 className="font-[family-name:var(--font-poppins)] text-xl font-bold text-[#1A1A1A]">
              Produits similaires
            </h2>
            <p className="text-sm text-[#9CA3AF] font-[family-name:var(--font-roboto)] mt-1">
              Ces produits seront affichés dans la section &quot;Vous aimerez aussi&quot; sur la fiche client.
            </p>
          </div>
          <SimilarProductPicker
            productId={productId}
            selected={similarProductIds}
            initialProducts={initialData?.similarProducts}
            onAdd={(id) => setSimilarProductIds((prev) => [...prev, id])}
            onRemove={(id) => setSimilarProductIds((prev) => prev.filter((x) => x !== id))}
          />
        </section>

        {/* ── Erreurs ── */}
        {error && (
          <div className="bg-[#FEE2E2] border border-[#FECACA] text-[#DC2626] px-5 py-4 text-sm font-[family-name:var(--font-roboto)] rounded-xl">
            {error}
          </div>
        )}

        {onlineErrors.length > 0 && (
          <div className="bg-[#FEF2F2] border border-[#FECACA] text-[#DC2626] px-5 py-4 text-sm font-[family-name:var(--font-roboto)] rounded-xl space-y-2">
            <p className="font-semibold font-[family-name:var(--font-poppins)]">
              Ce produit ne peut pas être mis en ligne :
            </p>
            <ul className="space-y-1 list-none">
              {onlineErrors.map((e) => (
                <li key={e} className="flex items-start gap-2">
                  <svg className="w-4 h-4 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  {e}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex items-center flex-wrap gap-3 pt-2 pb-8">
          {/* Statut actuel */}
          <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold font-[family-name:var(--font-roboto)] ${
            productStatus === "ONLINE"
              ? "bg-[#F0FDF4] text-[#15803D] border border-[#BBF7D0]"
              : "bg-[#F7F7F8] text-[#6B6B6B] border border-[#E5E5E5]"
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${productStatus === "ONLINE" ? "bg-[#22C55E]" : "bg-[#9CA3AF]"}`} />
            {productStatus === "ONLINE" ? "En ligne" : "Hors ligne"}
          </span>

          {/* Enregistrer */}
          <button type="submit" disabled={isPending}
            className="btn-primary px-10 py-3.5 text-base disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {isPending
              ? mode === "edit" ? "Enregistrement…" : "Création en cours…"
              : mode === "edit" ? "Enregistrer les modifications" : "Créer le produit"}
          </button>

          {/* Mettre en ligne / hors ligne */}
          {productStatus === "OFFLINE" ? (
            <button
              type="button"
              disabled={isPending}
              onClick={() => handleSave("ONLINE")}
              className="flex items-center gap-2 px-6 py-3.5 bg-[#22C55E] hover:bg-[#16A34A] text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-60 disabled:cursor-not-allowed font-[family-name:var(--font-roboto)]"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Enregistrer et mettre en ligne
            </button>
          ) : (
            <button
              type="button"
              disabled={isPending}
              onClick={() => handleSave("OFFLINE")}
              className="flex items-center gap-2 px-6 py-3.5 bg-[#F7F7F8] hover:bg-[#F0F0F0] text-[#6B6B6B] text-sm font-semibold rounded-xl border border-[#E5E5E5] transition-colors disabled:opacity-60 disabled:cursor-not-allowed font-[family-name:var(--font-roboto)]"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
              </svg>
              Enregistrer et mettre hors ligne
            </button>
          )}

          <Link href="/admin/produits" className="btn-secondary px-7 py-3.5 text-sm">
            Annuler
          </Link>
          <Link href="/admin/produits" className="text-sm text-[#6B6B6B] underline hover:text-[#1A1A1A] transition-colors font-[family-name:var(--font-roboto)]">
            Retourner à la page des produits
          </Link>
        </div>
      </form>

      {/* ── Quick-create modal ── */}
      <QuickCreateModal
        type={modalType ?? "category"}
        open={modalType !== null}
        onClose={() => setModalType(null)}
        onCreated={handleModalCreated}
        categoryId={categoryId}
      />

      {/* ── AI cost confirmation dialog ── */}
      {aiCostDialog && (
        <AiCostDialog
          estimatedCostUsd={aiCostDialog.estimatedCostUsd}
          onConfirm={handleAiConfirm}
          onCancel={() => setAiCostDialog(null)}
        />
      )}
    </>
  );
}

// ── Field wrapper ─────────────────────────────────────────────────────────
function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-[family-name:var(--font-roboto)] font-semibold text-[#6B6B6B] mb-1.5">
        {label}
        {hint && <span className="ml-2 font-normal text-[#9CA3AF]">— {hint}</span>}
      </label>
      {children}
    </div>
  );
}

// ── SimilarProductPicker (search-based with images) ──────────────────────
interface SearchProduct {
  id: string;
  name: string;
  reference: string;
  category: string;
  image: string | null;
}

function SimilarProductPicker({
  productId,
  selected,
  initialProducts,
  onAdd,
  onRemove,
}: {
  productId?: string;
  selected: string[];
  initialProducts?: SearchProduct[];
  onAdd: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<SearchProduct[]>([]);
  const [selectedProducts, setSelectedProducts] = useState<SearchProduct[]>(initialProducts ?? []);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  function handleSearchChange(value: string) {
    setSearch(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (value.trim().length < 1) {
      setResults([]);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/admin/products/search?q=${encodeURIComponent(value.trim())}${productId ? `&exclude=${productId}` : ""}`);
        const data = await res.json();
        setResults(data.products ?? []);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);
  }

  function handleSelect(product: SearchProduct) {
    if (selected.includes(product.id)) return;
    onAdd(product.id);
    setSelectedProducts((prev) => [...prev, product]);
  }

  function handleRemove(id: string) {
    onRemove(id);
    setSelectedProducts((prev) => prev.filter((p) => p.id !== id));
  }

  const filteredResults = results.filter((r) => !selected.includes(r.id));

  return (
    <div className="space-y-4">
      <div className="relative">
        <input
          type="text"
          value={search}
          onChange={(e) => handleSearchChange(e.target.value)}
          placeholder="Rechercher un produit par nom ou reference..."
          className="field-input !pl-10"
        />
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#9CA3AF]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
        </svg>
        {loading && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <div className="w-4 h-4 border-2 border-[#E5E5E5] border-t-[#1A1A1A] rounded-full animate-spin" />
          </div>
        )}
      </div>

      {search.trim().length >= 1 && (
        <div className="border border-[#E5E5E5] rounded-xl overflow-hidden max-h-80 overflow-y-auto">
          {filteredResults.length === 0 ? (
            <p className="px-4 py-3 text-sm text-[#9CA3AF] font-[family-name:var(--font-roboto)]">
              {loading ? "Recherche…" : "Aucun résultat."}
            </p>
          ) : (
            filteredResults.map((product) => (
              <button
                key={product.id}
                type="button"
                onClick={() => handleSelect(product)}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[#F7F7F8] transition-colors border-b border-[#F0F0F0] last:border-b-0"
              >
                {product.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={product.image} alt="" className="w-10 h-10 object-cover rounded-lg border border-[#E5E5E5]" />
                ) : (
                  <div className="w-10 h-10 rounded-lg bg-[#F0F0F0] flex items-center justify-center shrink-0">
                    <svg className="w-5 h-5 text-[#9CA3AF]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
                    </svg>
                  </div>
                )}
                <div className="flex-1 text-left min-w-0">
                  <p className="text-sm font-medium text-[#1A1A1A] font-[family-name:var(--font-roboto)] truncate">{product.name}</p>
                  <p className="text-xs text-[#9CA3AF] font-[family-name:var(--font-roboto)]">{product.reference} · {product.category}</p>
                </div>
              </button>
            ))
          )}
        </div>
      )}

      {selectedProducts.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-[#6B6B6B] uppercase tracking-wide font-[family-name:var(--font-roboto)]">
            Sélectionnés ({selectedProducts.length})
          </p>
          <div className="flex flex-wrap gap-2">
            {selectedProducts.map((p) => (
              <div key={p.id} className="flex items-center gap-2 bg-[#F7F7F8] border border-[#E5E5E5] rounded-lg px-3 py-1.5">
                <span className="text-sm font-[family-name:var(--font-roboto)] text-[#1A1A1A]">{p.name}</span>
                <span className="text-xs text-[#9CA3AF] font-mono">{p.reference}</span>
                <button type="button" onClick={() => handleRemove(p.id)}
                  className="text-[#9CA3AF] hover:text-[#DC2626] transition-colors ml-1"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
