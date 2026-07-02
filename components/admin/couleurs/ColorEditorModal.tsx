"use client";

/**
 * ColorEditorModal — modale dédiée à la création et à l'édition d'une couleur.
 * Même langage visuel que CategoryEditorModal (header aurora, colonne Identité
 * à gauche, cartes marketplaces empilées à droite, footer statut) mais adapté
 * aux couleurs :
 *   - Section « Aspect visuel » (toggle Hex/Motif + preview + palette rapide)
 *   - PFS via MarketplaceMappingSection entityType="color" (pfsColorRef)
 *   - eFashion via EfashionMappingPicker kind="color"
 *   - Pas de Faire (non applicable aux couleurs)
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useBackdropClose } from "@/hooks/useBackdropClose";
import { useToast } from "@/components/ui/Toast";
import { useAutoTranslateEnabled } from "@/components/admin/DeeplConfigContext";
import { createColorQuick } from "@/app/actions/admin/quick-create";
import { fetchPfsColorOptions } from "@/app/actions/admin/colors";
import { PFS_COLORS } from "@/lib/marketplace-excel/pfs-taxonomy";
import MarketplaceMappingSection from "@/components/admin/MarketplaceMappingSection";
import EfashionMappingPicker from "@/components/admin/EfashionMappingPicker";
import TranslateButton from "@/components/admin/TranslateButton";
import PfsSuggestions, { type PfsRefOption } from "@/components/admin/pfs/PfsSuggestions";

const QUICK_PALETTE: string[] = [
  "#D4AF37", // Or
  "#C0C0C0", // Argent
  "#B76E79", // Or rose
  "#0D0D0D", // Noir
  "#FFFFFF", // Blanc
  "#DC2626", // Rouge
  "#2563EB", // Bleu roi
  "#059669", // Vert émeraude
  "#DB2777", // Fuchsia
  "#F59E0B", // Ambre
];

export interface ColorEditorEditMode {
  id: string;
  name: string;
  translations: Record<string, string>;
  hex: string | null;
  patternImage: string | null;
  pfsColorRef: string | null;
  efashionCurrentId: number | null;
  onSave: (
    name: string,
    translations: Record<string, string>,
    hex: string | null,
    patternImage: string | null,
    pfsRef: string | null,
  ) => Promise<void>;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated?: (item: { id: string; name: string; hex?: string | null; patternImage?: string | null }) => void;
  editMode?: ColorEditorEditMode;
}

export default function ColorEditorModal({ open, onClose, onCreated, editMode }: Props) {
  const isEdit = !!editMode;
  const autoTranslateEnabled = useAutoTranslateEnabled();
  const toast = useToast();
  const backdrop = useBackdropClose(onClose);

  const [mounted, setMounted] = useState(false);
  const [names, setNames] = useState<Record<string, string>>({});
  const [hex, setHex] = useState("#9CA3AF");
  const [colorMode, setColorMode] = useState<"hex" | "pattern">("hex");
  const [patternFile, setPatternFile] = useState<File | null>(null);
  const [patternPreview, setPatternPreview] = useState<string | null>(null);
  const [pfsRef, setPfsRef] = useState<string | null>(null);
  const [efashionCreateId, setEfashionCreateId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const patternInputRef = useRef<HTMLInputElement | null>(null);

  const [pfsColorOptions, setPfsColorOptions] = useState<PfsRefOption[] | null>(null);

  useEffect(() => { setMounted(true); }, []);

  // Live PFS colors pour les suggestions — fallback silencieux sur PFS_COLORS.
  useEffect(() => {
    if (!open || pfsColorOptions) return;
    let cancelled = false;
    fetchPfsColorOptions()
      .then((res) => {
        if (cancelled) return;
        setPfsColorOptions(res.map((c) => ({ value: c.value, label: c.label })));
      })
      .catch(() => { /* fallback statique */ });
    return () => { cancelled = true; };
  }, [open, pfsColorOptions]);

  const suggestionOptions = useMemo<PfsRefOption[]>(() => {
    return pfsColorOptions && pfsColorOptions.length > 0
      ? pfsColorOptions
      : PFS_COLORS;
  }, [pfsColorOptions]);

  // Reset state à chaque ouverture — évite les résidus d'une édition précédente.
  useEffect(() => {
    if (!open) return;
    if (editMode) {
      setNames({ fr: editMode.name, ...editMode.translations });
      setHex(editMode.hex ?? "#9CA3AF");
      setColorMode(editMode.patternImage ? "pattern" : "hex");
      setPatternPreview(editMode.patternImage ?? null);
      setPatternFile(null);
      setPfsRef(editMode.pfsColorRef);
    } else {
      setNames({});
      setHex("#9CA3AF");
      setColorMode("hex");
      setPatternPreview(null);
      setPatternFile(null);
      setPfsRef(null);
      setEfashionCreateId(null);
    }
    setError("");
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function handlePatternPick(file: File | null) {
    if (!file) {
      setPatternFile(null);
      return;
    }
    if (!file.type.startsWith("image/")) {
      toast.error("Format", "Merci de choisir une image (PNG, JPG, WebP…).");
      return;
    }
    setPatternFile(file);
    const reader = new FileReader();
    reader.onload = (e) => setPatternPreview((e.target?.result as string) ?? null);
    reader.readAsDataURL(file);
  }

  function normalizeHex(v: string): string {
    const trimmed = v.trim().toUpperCase();
    if (!trimmed) return "";
    if (trimmed.startsWith("#")) return trimmed;
    return `#${trimmed}`;
  }

  const frName = (names["fr"] ?? "").trim();
  const isHexValid = colorMode !== "hex" || /^#[0-9A-F]{6}$/i.test(hex);
  const patternMissing = colorMode === "pattern" && !patternPreview;

  const pfsMapped = !!pfsRef;
  const efashionMapped = isEdit
    ? editMode?.efashionCurrentId != null
    : efashionCreateId != null;
  const totalMapped = [pfsMapped, efashionMapped].filter(Boolean).length;

  async function handleSubmit() {
    if (!frName) {
      setError("Le nom en français est obligatoire.");
      return;
    }
    if (!isHexValid) {
      setError("Le code hexadécimal n'est pas valide (ex : #D4AF37).");
      return;
    }
    if (patternMissing) {
      setError("Merci d'ajouter une image pour le motif.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const translations: Record<string, string> = {};
      for (const [locale, val] of Object.entries(names)) {
        if (locale !== "fr" && val?.trim()) translations[locale] = val.trim();
      }

      // Uploade l'image motif si un nouveau fichier a été choisi (pas de fichier
      // = on garde le motif existant en édition).
      let finalPatternImage: string | null = null;
      if (colorMode === "pattern") {
        if (patternFile) {
          const fd = new FormData();
          fd.append("file", patternFile);
          const res = await fetch("/api/admin/colors/upload-pattern", { method: "POST", body: fd });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "Erreur upload motif.");
          finalPatternImage = data.path;
        } else {
          finalPatternImage = editMode?.patternImage ?? null;
        }
      }

      if (editMode) {
        await editMode.onSave(
          frName,
          translations,
          colorMode === "hex" ? hex : null,
          colorMode === "pattern" ? finalPatternImage : null,
          pfsRef,
        );
        onClose();
        return;
      }

      // Création — on assemble le map { fr, en, … } attendu par createColorQuick
      const namesMap: Record<string, string> = { fr: frName };
      for (const [locale, val] of Object.entries(names)) {
        if (locale !== "fr" && val?.trim()) namesMap[locale] = val.trim();
      }
      const res = await createColorQuick(
        namesMap,
        colorMode === "hex" ? hex : null,
        colorMode === "pattern" ? finalPatternImage : null,
        pfsRef,
        efashionCreateId,
      );
      if (!res.ok) {
        setError(res.error);
        setLoading(false);
        return;
      }
      onCreated?.({ id: res.id, name: res.name, hex: res.hex, patternImage: res.patternImage });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur lors de l'enregistrement.");
    } finally {
      setLoading(false);
    }
  }

  if (!mounted || !open) return null;

  const previewStyle: React.CSSProperties =
    colorMode === "pattern" && patternPreview
      ? { backgroundImage: `url(${patternPreview})`, backgroundSize: "cover", backgroundPosition: "center" }
      : { backgroundColor: colorMode === "hex" && isHexValid ? hex : "#E4E4E7" };

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onMouseDown={backdrop.onMouseDown}
      onMouseUp={backdrop.onMouseUp}
    >
      <div
        className="w-full max-w-[1180px] bg-bg-primary rounded-[28px] shadow-[0_30px_80px_-20px_rgba(0,0,0,0.35)] flex flex-col max-h-[92vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header aurora ────────────────────────────────────────────── */}
        <div className="relative overflow-hidden border-b border-border shrink-0">
          <div
            aria-hidden
            className="absolute inset-0 pointer-events-none"
            style={{
              background:
                "radial-gradient(60% 80% at 10% 0%, rgba(244,114,182,0.12), transparent 60%)," +
                "radial-gradient(50% 70% at 90% 10%, rgba(139,92,246,0.10), transparent 60%)," +
                "radial-gradient(80% 60% at 50% 100%, rgba(251,191,36,0.06), transparent 60%)",
            }}
          />
          <div className="relative px-8 pt-7 pb-6">
            <div className="flex items-start justify-between gap-6">
              <div className="flex items-start gap-4 min-w-0">
                <span className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-bg-primary border border-border shadow-sm overflow-hidden shrink-0">
                  <span
                    aria-hidden
                    className="block w-8 h-8 rounded-lg border border-border"
                    style={previewStyle}
                  />
                </span>
                <div className="min-w-0">
                  <span className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-rose-50 border border-rose-100 text-rose-700 text-[10.5px] font-bold uppercase tracking-[0.14em]">
                    <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                    Catalogue · Couleur
                  </span>
                  <h3 className="font-heading text-[22px] font-bold text-text-primary leading-tight mt-2 truncate">
                    {isEdit ? `Modifier la couleur « ${editMode.name} »` : "Créer une couleur"}
                  </h3>
                  <p className="text-[13px] text-text-secondary mt-1 leading-relaxed">
                    L'apparence visuelle, la traduction anglaise et les correspondances avec les marketplaces.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Fermer"
                className="shrink-0 inline-flex items-center justify-center w-10 h-10 rounded-full text-text-muted hover:text-text-primary hover:bg-bg-secondary transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        {/* ── Body ─────────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto">
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
            {/* ── Colonne gauche : Identité + Aspect ─────────────────── */}
            <div className="p-7 space-y-6 lg:border-r border-border bg-bg-primary">
              {/* Identité */}
              <section className="space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="inline-flex items-center gap-2.5 text-[11px] font-bold uppercase tracking-[0.14em] text-text-secondary">
                    <span aria-hidden className="w-[3px] h-[14px] rounded-full bg-rose-500" />
                    1 · Identité
                  </span>
                  {autoTranslateEnabled && !isEdit && (
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-full px-2.5 py-1">
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5} aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                      Traduction auto activée
                    </span>
                  )}
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-text-secondary uppercase tracking-wider mb-2">
                    Nom en français <span className="text-[#EF4444] normal-case font-bold">*</span>
                  </label>
                  <input
                    type="text"
                    value={names["fr"] ?? ""}
                    onChange={(e) => setNames((prev) => ({ ...prev, fr: e.target.value }))}
                    autoFocus
                    placeholder="Ex : Or rose, Argent, Noir…"
                    className="field-input w-full text-sm"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { e.preventDefault(); handleSubmit(); }
                    }}
                  />
                  <p className="text-[11px] text-text-muted mt-1.5">Ce nom apparaît sur ton site et sert aux recherches.</p>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[11px] font-semibold text-text-secondary uppercase tracking-wider">Anglais</p>
                    {!autoTranslateEnabled && (
                      <TranslateButton
                        text={frName}
                        onTranslated={(t) => setNames((prev) => ({ ...prev, ...t }))}
                        disabled={!frName}
                      />
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="shrink-0 inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-bg-tertiary text-text-secondary text-[10.5px] font-semibold">
                      🇬🇧 EN
                    </span>
                    <input
                      type="text"
                      value={names["en"] ?? ""}
                      onChange={(e) => setNames((prev) => ({ ...prev, en: e.target.value }))}
                      placeholder="Ex : Gold, Rose gold, Black…"
                      className="field-input w-full text-sm"
                    />
                  </div>
                  <p className="text-[11px] text-text-muted mt-1.5">
                    {autoTranslateEnabled
                      ? "Traduite automatiquement à l'enregistrement — tu peux la corriger à la main."
                      : "Utilisée pour les visiteurs anglophones du site."}
                  </p>
                </div>
              </section>

              {/* Aspect visuel */}
              <section className="space-y-4">
                <div className="flex items-center gap-3">
                  <span className="inline-flex items-center gap-2.5 text-[11px] font-bold uppercase tracking-[0.14em] text-text-secondary">
                    <span aria-hidden className="w-[3px] h-[14px] rounded-full bg-rose-500" />
                    2 · Aspect visuel
                  </span>
                </div>

                {/* Toggle Hex / Motif */}
                <div className="inline-flex bg-bg-tertiary rounded-xl p-1 shadow-[var(--shadow-inset)]">
                  <button
                    type="button"
                    onClick={() => setColorMode("hex")}
                    className={`px-4 py-1.5 text-[12px] font-semibold rounded-lg transition-colors ${
                      colorMode === "hex"
                        ? "bg-bg-primary text-text-primary shadow-[var(--shadow-sm)]"
                        : "text-text-secondary hover:text-text-primary"
                    }`}
                  >
                    Couleur unie
                  </button>
                  <button
                    type="button"
                    onClick={() => setColorMode("pattern")}
                    className={`px-4 py-1.5 text-[12px] font-semibold rounded-lg transition-colors ${
                      colorMode === "pattern"
                        ? "bg-bg-primary text-text-primary shadow-[var(--shadow-sm)]"
                        : "text-text-secondary hover:text-text-primary"
                    }`}
                  >
                    Motif image
                  </button>
                </div>

                {colorMode === "hex" ? (
                  <div className="rounded-2xl border border-border bg-bg-primary p-4">
                    <div className="flex items-center gap-4">
                      <div className="relative shrink-0">
                        <span
                          aria-hidden
                          className="block w-20 h-20 rounded-2xl border border-border shadow-[var(--shadow-inset)]"
                          style={{ backgroundColor: isHexValid ? hex : "#E4E4E7" }}
                        />
                      </div>
                      <div className="flex-1 space-y-2 min-w-0">
                        <label className="block text-[11px] font-semibold text-text-secondary uppercase tracking-wider">Code hexadécimal</label>
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={hex}
                            onChange={(e) => setHex(normalizeHex(e.target.value))}
                            className="field-input font-mono uppercase"
                            style={{ maxWidth: "160px" }}
                            placeholder="#D4AF37"
                          />
                          <label className="inline-flex items-center gap-1.5 h-9 px-2.5 rounded-lg border border-border bg-bg-primary text-text-secondary hover:text-text-primary hover:border-ink text-[12px] font-medium cursor-pointer transition-colors">
                            <span
                              aria-hidden
                              className="w-3 h-3 rounded-full"
                              style={{ background: "linear-gradient(135deg,#f87171,#facc15,#4ade80,#38bdf8,#a78bfa)" }}
                            />
                            Choisir…
                            <input
                              type="color"
                              value={isHexValid ? hex : "#D4AF37"}
                              onChange={(e) => setHex(e.target.value.toUpperCase())}
                              className="sr-only"
                            />
                          </label>
                        </div>
                        {!isHexValid && (
                          <p className="text-[11px] text-[#DC2626]">Format à 6 chiffres, commençant par #.</p>
                        )}
                      </div>
                    </div>

                    <div className="mt-4 pt-4 border-t border-border">
                      <p className="text-[10.5px] font-bold uppercase tracking-wider text-text-muted mb-2">Palette suggérée</p>
                      <div className="flex flex-wrap gap-1.5">
                        {QUICK_PALETTE.map((c) => {
                          const active = hex.toUpperCase() === c.toUpperCase();
                          return (
                            <button
                              key={c}
                              type="button"
                              onClick={() => setHex(c.toUpperCase())}
                              aria-label={`Choisir ${c}`}
                              className={`w-7 h-7 rounded-lg transition-transform ${
                                active
                                  ? "ring-2 ring-ink ring-offset-2 ring-offset-white"
                                  : "border border-border hover:scale-105"
                              }`}
                              style={{ backgroundColor: c }}
                            />
                          );
                        })}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-border bg-bg-primary p-4">
                    <div className="flex items-center gap-4">
                      <div className="relative shrink-0">
                        <span
                          aria-hidden
                          className="block w-20 h-20 rounded-2xl border border-border shadow-[var(--shadow-inset)] bg-bg-tertiary overflow-hidden"
                          style={
                            patternPreview
                              ? { backgroundImage: `url(${patternPreview})`, backgroundSize: "cover", backgroundPosition: "center" }
                              : undefined
                          }
                        />
                      </div>
                      <div className="flex-1 space-y-2 min-w-0">
                        <label className="block text-[11px] font-semibold text-text-secondary uppercase tracking-wider">Image motif</label>
                        <div className="flex items-center gap-2 flex-wrap">
                          <button
                            type="button"
                            onClick={() => patternInputRef.current?.click()}
                            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-border bg-bg-primary text-text-secondary hover:text-text-primary hover:border-ink text-[12px] font-semibold transition-colors"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" /></svg>
                            {patternPreview ? "Remplacer l'image" : "Choisir une image"}
                          </button>
                          {patternPreview && (
                            <button
                              type="button"
                              onClick={() => { setPatternFile(null); setPatternPreview(null); }}
                              className="text-[11.5px] text-text-muted hover:text-[#DC2626] transition-colors"
                            >
                              Retirer
                            </button>
                          )}
                          <input
                            ref={patternInputRef}
                            type="file"
                            accept="image/*"
                            className="sr-only"
                            onChange={(e) => handlePatternPick(e.target.files?.[0] ?? null)}
                          />
                        </div>
                        <p className="text-[11px] text-text-muted">PNG, JPG ou WebP. Le motif remplace la couleur unie sur les fiches produit.</p>
                      </div>
                    </div>
                  </div>
                )}

                <div className="rounded-2xl bg-bg-secondary border border-border p-3.5 flex gap-3">
                  <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-bg-primary border border-border shrink-0 text-text-secondary">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8} aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M12 18h.008v-.008H12V18z" />
                    </svg>
                  </span>
                  <p className="text-[11.5px] text-text-secondary leading-relaxed">
                    <strong className="text-text-primary">Motif prioritaire.</strong> Si tu ajoutes un motif image, il remplace la couleur unie sur les fiches produit.
                  </p>
                </div>
              </section>
            </div>

            {/* ── Colonne droite : Marketplaces ─────────────────────── */}
            <div className="p-7 space-y-5 bg-bg-secondary/60">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <span className="inline-flex items-center gap-2.5 text-[11px] font-bold uppercase tracking-[0.14em] text-text-secondary">
                    <span aria-hidden className="w-[3px] h-[14px] rounded-full bg-rose-500" />
                    3 · Marketplaces
                  </span>
                  <p className="text-[12px] text-text-secondary mt-2 leading-relaxed max-w-md">
                    Relie cette couleur à ses équivalents sur les marketplaces où tu vends. Facultatif — mais nécessaire pour publier tes produits.
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-text-muted">Statut</p>
                  <p className={`text-[13px] font-semibold mt-0.5 flex items-center gap-1.5 justify-end ${
                    totalMapped === 2 ? "text-emerald-700" : totalMapped > 0 ? "text-amber-700" : "text-text-muted"
                  }`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${
                      totalMapped === 2 ? "bg-emerald-500" : totalMapped > 0 ? "bg-amber-500" : "bg-text-muted"
                    }`} />
                    {totalMapped} sur 2 reliées
                  </p>
                </div>
              </div>

              {/* Carte PFS */}
              <MarketplaceCard
                icon={<AvatarBadge gradient="linear-gradient(135deg,#0F172A,#334155)" text="PFS" />}
                title="Paris Fashion Shop"
                subtitle="Choisir la couleur équivalente dans le catalogue PFS."
                mapped={pfsMapped}
              >
                <MarketplaceMappingSection
                  entityType="color"
                  pfsRef={pfsRef}
                  onPfsRefChange={setPfsRef}
                />
                {suggestionOptions.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-border">
                    <PfsSuggestions
                      mode="ref"
                      query={names["fr"] ?? ""}
                      options={suggestionOptions}
                      currentValue={pfsRef}
                      onPick={setPfsRef}
                      label="Correspondance PFS suggérée"
                    />
                  </div>
                )}
              </MarketplaceCard>

              {/* Carte eFashion */}
              <MarketplaceCard
                icon={<AvatarBadge gradient="linear-gradient(135deg,#7C3AED,#A855F7)" text="eF" />}
                title="eFashion Paris"
                subtitle={isEdit ? "Enregistré automatiquement à chaque changement." : "Facultatif — peut être complété plus tard."}
                mapped={!!efashionMapped}
              >
                {isEdit && editMode ? (
                  <EfashionMappingPicker
                    entityId={editMode.id}
                    kind="color"
                    initialValue={editMode.efashionCurrentId ?? null}
                    entityName={names["fr"] ?? editMode.name}
                  />
                ) : (
                  <EfashionMappingPicker
                    kind="color"
                    initialValue={efashionCreateId}
                    entityName={names["fr"]}
                    onChange={setEfashionCreateId}
                  />
                )}
              </MarketplaceCard>
            </div>
          </div>
        </div>

        {/* ── Footer ───────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between gap-4 px-8 py-5 border-t border-border shrink-0 bg-bg-primary">
          <div className="flex-1 min-w-0">
            {error ? (
              <p className="inline-flex items-center gap-1.5 text-xs text-[#DC2626] font-medium">
                <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                </svg>
                {error}
              </p>
            ) : !frName ? (
              <p className="text-[11.5px] text-text-muted">Commence par le nom en français.</p>
            ) : patternMissing ? (
              <p className="inline-flex items-center gap-1.5 text-[11.5px] text-amber-700">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                Ajoute une image pour le motif.
              </p>
            ) : (
              <p className="inline-flex items-center gap-1.5 text-[11.5px] text-emerald-700">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                Prêt à {isEdit ? "enregistrer" : "créer"} — {totalMapped} marketplace{totalMapped > 1 ? "s" : ""} reliée{totalMapped > 1 ? "s" : ""} sur 2.
              </p>
            )}
          </div>
          <div className="flex gap-2 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center justify-center h-10 px-4 border border-border text-text-secondary hover:border-ink hover:text-text-primary text-sm font-medium rounded-lg transition-colors"
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={loading || !frName || !isHexValid || patternMissing}
              className="inline-flex items-center justify-center gap-2 h-10 px-5 bg-bg-dark hover:bg-black text-text-inverse text-sm font-semibold rounded-lg shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <>
                  <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
                    <path d="M22 12a10 10 0 00-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                  </svg>
                  {isEdit ? "Enregistrement…" : "Création…"}
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                  {isEdit ? "Enregistrer les modifications" : "Créer la couleur"}
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ── Sous-composants internes ─────────────────────────────────────────── */

function AvatarBadge({ gradient, text }: { gradient: string; text: string }) {
  return (
    <span
      className="inline-flex items-center justify-center w-11 h-11 rounded-xl shrink-0 text-white shadow-sm"
      style={{ background: gradient }}
    >
      <span className="font-heading font-bold text-[13px]">{text}</span>
    </span>
  );
}

function MarketplaceCard({
  icon,
  title,
  subtitle,
  mapped,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  mapped: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      className={`relative bg-bg-primary rounded-2xl overflow-hidden shadow-[var(--shadow-sm)] border ${
        mapped ? "border-emerald-200" : "border-amber-200/70"
      }`}
    >
      <header className="flex items-start gap-3 px-5 pt-5">
        {icon}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-[14px] font-semibold text-text-primary font-heading leading-none">{title}</p>
            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-[0.06em] ${
                mapped ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
              }`}
            >
              {mapped ? (
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
              )}
              {mapped ? "Reliée" : "Non reliée"}
            </span>
          </div>
          <p className="text-[11px] text-text-muted mt-1">{subtitle}</p>
        </div>
      </header>
      <div className="p-5 pt-4">{children}</div>
    </section>
  );
}
