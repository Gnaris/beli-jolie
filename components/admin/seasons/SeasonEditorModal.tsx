"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useBackdropClose } from "@/hooks/useBackdropClose";
import { useAutoTranslateEnabled } from "@/components/admin/DeeplConfigContext";
import { createSeasonQuick } from "@/app/actions/admin/quick-create";
import { fetchPfsMappingOptions, type PfsMappingOptions } from "@/app/actions/admin/pfs-annexes";
import TranslateButton from "@/components/admin/TranslateButton";
import TranslatingInput from "@/components/admin/TranslatingInput";
import { useAutoTranslateOnBlur } from "@/hooks/useAutoTranslateOnBlur";
import MarketplaceMappingSection from "@/components/admin/MarketplaceMappingSection";
import EfashionMappingPicker from "@/components/admin/EfashionMappingPicker";
import PfsSuggestions, { type PfsRefOption } from "@/components/admin/pfs/PfsSuggestions";

export type SeasonFocusMarketplace = "pfs" | "efashion";

export interface SeasonEditorEditMode {
  id: string;
  name: string;
  translations: Record<string, string>;
  pfsRef?: string | null;
  efashionCurrentId?: number | null;
  onSave: (
    name: string,
    translations: Record<string, string>,
    _hex?: string,
    _patternImage?: string | null,
    pfs?: { ref?: string },
  ) => Promise<void>;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated?: (item: { id: string; name: string }) => void;
  focusMarketplace?: SeasonFocusMarketplace;
  editMode?: SeasonEditorEditMode;
}

export default function SeasonEditorModal({
  open,
  onClose,
  onCreated,
  focusMarketplace,
  editMode,
}: Props) {
  const isEdit = !!editMode;
  const autoTranslateEnabled = useAutoTranslateEnabled();
  const backdrop = useBackdropClose(onClose);

  const [mounted, setMounted] = useState(false);
  const [names, setNames] = useState<Record<string, string>>({});
  const [pfsRef, setPfsRef] = useState<string | null>(null);
  const [efashionCreateId, setEfashionCreateId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [pfsAnnexes, setPfsAnnexes] = useState<PfsMappingOptions | null>(null);

  const { handleFrBlur, isTranslating } = useAutoTranslateOnBlur({ names, setNames });

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!open || pfsAnnexes) return;
    let cancelled = false;
    fetchPfsMappingOptions()
      .then((res) => { if (!cancelled) setPfsAnnexes(res); })
      .catch(() => { /* fallback silencieux */ });
    return () => { cancelled = true; };
  }, [open, pfsAnnexes]);

  const suggestionOptions = useMemo<PfsRefOption[]>(() => {
    return pfsAnnexes?.seasons ?? [];
  }, [pfsAnnexes]);

  useEffect(() => {
    if (!open) return;
    if (editMode) {
      setNames({ fr: editMode.name, ...editMode.translations });
      setPfsRef(editMode.pfsRef ?? null);
    } else {
      setNames({});
      setPfsRef(null);
      setEfashionCreateId(null);
    }
    setError("");
    setLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open || !focusMarketplace) return;
    const timer = setTimeout(() => {
      document
        .querySelector<HTMLElement>(`[data-season-mp="${focusMarketplace}"]`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 120);
    return () => clearTimeout(timer);
  }, [open, focusMarketplace]);

  const frName = (names["fr"] ?? "").trim();
  const pfsMappingMissing = !isEdit && !pfsRef;

  const pfsMapped = !!pfsRef;
  const efashionMapped = isEdit
    ? editMode?.efashionCurrentId != null
    : efashionCreateId != null;
  const totalMapped = [pfsMapped, efashionMapped].filter(Boolean).length;

  async function handleSubmit() {
    if (!frName) { setError("Le nom en français est obligatoire."); return; }
    setLoading(true);
    setError("");
    try {
      if (editMode) {
        const translations: Record<string, string> = {};
        for (const [locale, val] of Object.entries(names)) {
          if (locale !== "fr" && val?.trim()) translations[locale] = val.trim();
        }
        await editMode.onSave(
          frName,
          translations,
          undefined,
          undefined,
          { ref: pfsRef || undefined },
        );
        onClose();
        return;
      }
      if (pfsMappingMissing) {
        setError("Choisis la correspondance Paris Fashion Shop.");
        setLoading(false);
        return;
      }
      const result = await createSeasonQuick(names, pfsRef || null, efashionCreateId);
      onCreated?.(result);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur lors de l'enregistrement.");
    } finally {
      setLoading(false);
    }
  }

  if (!mounted || !open) return null;

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

        {/* Header aurora bleu ciel */}
        <div className="relative overflow-hidden border-b border-border shrink-0">
          <div
            aria-hidden
            className="absolute inset-0 pointer-events-none"
            style={{
              background:
                "radial-gradient(60% 80% at 10% 0%, rgba(186,230,253,0.55), transparent 60%)," +
                "radial-gradient(50% 70% at 90% 10%, rgba(147,197,253,0.28), transparent 65%)," +
                "radial-gradient(80% 60% at 50% 100%, rgba(148,163,184,0.08), transparent 60%)",
            }}
          />
          <div className="relative px-8 pt-7 pb-6">
            <div className="flex items-start justify-between gap-6">
              <div className="flex items-start gap-4 min-w-0">
                <span
                  className="inline-flex items-center justify-center w-14 h-14 rounded-2xl shrink-0"
                  style={{
                    background: "linear-gradient(135deg, #BAE6FD 0%, #38BDF8 100%)",
                    color: "#0C4A6E",
                    boxShadow: "0 8px 20px rgba(2, 132, 199, 0.22), inset 0 1px 0 rgba(255,255,255,0.6)",
                  }}
                >
                  <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.7} aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
                  </svg>
                </span>
                <div className="min-w-0">
                  <span className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-sky-50 border border-sky-100 text-sky-800 text-[10.5px] font-bold uppercase tracking-[0.14em]">
                    <span className="w-1.5 h-1.5 rounded-full bg-sky-500" />
                    {isEdit ? `Édition · ${editMode!.name}` : "Nouvelle saison"}
                  </span>
                  <h3 className="font-heading text-[22px] font-bold text-text-primary leading-tight mt-2 truncate">
                    {isEdit ? "Modifier la saison" : "Créer une saison"}
                  </h3>
                  <p className="text-[13px] text-text-secondary mt-1 leading-relaxed">
                    Une saison (Printemps/Été 2026, Fêtes, intemporel…) — son nom, sa traduction anglaise et sa correspondance avec les marketplaces.
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

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">

            {/* Colonne gauche : Identité */}
            <div className="p-7 space-y-6 lg:border-r border-border bg-bg-primary">
              <section className="space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="inline-flex items-center gap-2.5 text-[11px] font-bold uppercase tracking-[0.14em] text-text-secondary">
                    <span aria-hidden className="w-[3px] h-[14px] rounded-full bg-sky-500" />
                    1 · Identité
                  </span>
                  {autoTranslateEnabled && (
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
                    onBlur={handleFrBlur}
                    autoFocus
                    placeholder="Ex : Printemps/Été 2026, Fêtes 2026, Toute saison…"
                    className="field-input w-full text-sm"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { e.preventDefault(); handleSubmit(); }
                    }}
                  />
                  <p className="text-[11px] text-text-muted mt-1.5">
                    Ce nom apparaît sur les fiches produit et sert aux recherches.
                  </p>
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
                    <TranslatingInput
                      translating={isTranslating("en")}
                      type="text"
                      value={names["en"] ?? ""}
                      onChange={(e) => setNames((prev) => ({ ...prev, en: e.target.value }))}
                      placeholder="Ex : Spring/Summer 2026, Holidays 2026, All year…"
                      className="field-input w-full text-sm"
                    />
                  </div>
                  <p className="text-[11px] text-text-muted mt-1.5">
                    {autoTranslateEnabled
                      ? "Traduite automatiquement quand tu quittes le champ français — tu peux la corriger à la main."
                      : "Utilisée pour les visiteurs anglophones du site."}
                  </p>
                </div>
              </section>

              <div className="rounded-2xl bg-bg-secondary border border-border p-4 flex gap-3">
                <span className="inline-flex items-center justify-center w-8 h-8 rounded-xl bg-bg-primary border border-border shrink-0 text-text-secondary">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8} aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M12 18h.008v-.008H12V18z" />
                  </svg>
                </span>
                <p className="text-[12px] text-text-secondary leading-relaxed">
                  <strong className="text-text-primary">Astuce</strong> — une saison peut regrouper plusieurs collections thématiques. Utilise « Toute saison » ou « Intemporel » pour les produits qui ne suivent aucun cycle saisonnier.
                </p>
              </div>
            </div>

            {/* Colonne droite : Marketplaces */}
            <div className="p-7 space-y-5 bg-bg-secondary/60">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <span className="inline-flex items-center gap-2.5 text-[11px] font-bold uppercase tracking-[0.14em] text-text-secondary">
                    <span aria-hidden className="w-[3px] h-[14px] rounded-full bg-sky-500" />
                    2 · Marketplaces
                  </span>
                  <p className="text-[12px] text-text-secondary mt-2 leading-relaxed max-w-md">
                    Relie cette saison aux marketplaces où tu vends. Paris Fashion Shop est nécessaire pour publier ; eFashion est facultatif.
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
                dataKey="pfs"
                icon={<AvatarBadge gradient="linear-gradient(135deg,#0F172A,#334155)" text="PFS" />}
                title="Paris Fashion Shop"
                subtitle="Marketplace principale — nécessaire pour publier"
                mapped={pfsMapped}
              >
                <MarketplaceMappingSection
                  entityType="season"
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
                dataKey="efashion"
                icon={<AvatarBadge gradient="linear-gradient(135deg,#7C3AED,#A855F7)" text="eF" />}
                title="eFashion Paris"
                subtitle={isEdit ? "Enregistré automatiquement à chaque changement" : "Facultatif — peut être complété plus tard"}
                mapped={!!efashionMapped}
              >
                {isEdit && editMode ? (
                  <EfashionMappingPicker
                    entityId={editMode.id}
                    kind="season"
                    initialValue={editMode.efashionCurrentId ?? null}
                    entityName={names["fr"] ?? editMode.name}
                  />
                ) : (
                  <EfashionMappingPicker
                    kind="season"
                    initialValue={efashionCreateId}
                    entityName={names["fr"]}
                    onChange={setEfashionCreateId}
                  />
                )}
              </MarketplaceCard>
            </div>
          </div>
        </div>

        {/* Footer */}
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
            ) : pfsMappingMissing ? (
              <p className="inline-flex items-center gap-1.5 text-[11.5px] text-amber-700">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                Choisis la correspondance Paris Fashion Shop pour pouvoir publier.
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
              disabled={loading || !frName || pfsMappingMissing}
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
                  {isEdit ? "Enregistrer les modifications" : "Créer la saison"}
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
  dataKey,
  icon,
  title,
  subtitle,
  mapped,
  children,
}: {
  dataKey: SeasonFocusMarketplace;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  mapped: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      data-season-mp={dataKey}
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
