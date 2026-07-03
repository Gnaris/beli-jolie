"use client";

/**
 * CountryEditModal — modale dédiée pour créer / éditer un pays de fabrication.
 *
 * Isolée de `QuickCreateModal` (partagé pour catégories, couleurs, compositions,
 * saisons) car son design cockpit — hero aurora emerald, 4 cartes marketplaces
 * en 2×2 avec logos colorés (P violet PFS, E rose eFashion, F ambre Faire) —
 * a été validé uniquement pour les pays. Les autres attributs conservent leur
 * modale historique.
 */

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useBackdropClose } from "@/hooks/useBackdropClose";
import { useToast } from "@/components/ui/Toast";
import { useAutoTranslateEnabled } from "@/components/admin/DeeplConfigContext";
import { VALID_LOCALES, LOCALE_FULL_NAMES } from "@/i18n/locales";
import { suggestIso2FromName } from "@/lib/marketplace-excel/country-iso";
import { alpha2ToAlpha3 } from "@/lib/faire-country";
import TranslateButton from "@/components/admin/TranslateButton";
import MarketplaceMappingSection from "@/components/admin/MarketplaceMappingSection";
import EfashionMappingPicker from "@/components/admin/EfashionMappingPicker";
import PfsSuggestions from "@/components/admin/pfs/PfsSuggestions";
import { fetchPfsMappingOptions, type PfsMappingOptions } from "@/app/actions/admin/pfs-annexes";
import { createManufacturingCountryQuick } from "@/app/actions/admin/quick-create";

/** Convertit un ISO 2-lettres (ex: "CN") en drapeau emoji (🇨🇳). */
function isoToFlag(iso: string | null | undefined): string {
  if (!iso || !/^[A-Za-z]{2}$/.test(iso)) return "🏳️";
  const A = 0x1f1e6;
  const up = iso.toUpperCase();
  return String.fromCodePoint(A + up.charCodeAt(0) - 65, A + up.charCodeAt(1) - 65);
}

export interface CountryEditModalEditMode {
  id: string;
  name: string;
  translations: Record<string, string>;
  isoCode: string | null;
  pfsCountryRef: string | null;
  efashionCurrentId: number | null;
  faireCountryCode: string | null;
  onSave: (
    name: string,
    translations: Record<string, string>,
    pfs: { ref: string | null; isoCode: string | null },
    faire: { countryCode: string | null },
  ) => Promise<void>;
}

interface CountryEditModalProps {
  open: boolean;
  onClose: () => void;
  /** Appelé après une création réussie (mode create uniquement). */
  onCreated?: (item: { id: string; name: string }) => void;
  editMode?: CountryEditModalEditMode;
}

export default function CountryEditModal({
  open,
  onClose,
  onCreated,
  editMode,
}: CountryEditModalProps) {
  const isEdit = !!editMode;
  const toast = useToast();
  const autoTranslateEnabled = useAutoTranslateEnabled();
  const backdrop = useBackdropClose(onClose);
  const [mounted, setMounted] = useState(false);

  const [names, setNames] = useState<Record<string, string>>({});
  const [isoCode, setIsoCode] = useState("");
  const [isoTouched, setIsoTouched] = useState(false);
  const [pfsRef, setPfsRef] = useState<string | null>(null);
  const [efashionCreateId, setEfashionCreateId] = useState<number | null>(null);
  const [faireCountryCode, setFaireCountryCode] = useState("");
  const [pfsAnnexes, setPfsAnnexes] = useState<PfsMappingOptions | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    if (editMode) {
      setNames({ fr: editMode.name, ...editMode.translations });
      setIsoCode(editMode.isoCode ?? "");
      setIsoTouched(!!editMode.isoCode);
      setPfsRef(editMode.pfsCountryRef);
      setEfashionCreateId(editMode.efashionCurrentId);
      setFaireCountryCode(editMode.faireCountryCode ?? "");
    } else {
      setNames({});
      setIsoCode("");
      setIsoTouched(false);
      setPfsRef(null);
      setEfashionCreateId(null);
      setFaireCountryCode("");
    }
    setError("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open || pfsAnnexes) return;
    let cancelled = false;
    fetchPfsMappingOptions()
      .then((res) => {
        if (!cancelled) setPfsAnnexes(res);
      })
      .catch(() => {
        /* fallback silencieux sur la liste statique */
      });
    return () => {
      cancelled = true;
    };
  }, [open, pfsAnnexes]);

  const frName = (names["fr"] ?? "").trim();
  const suggestedIso = useMemo(
    () => (frName ? suggestIso2FromName(frName) : null),
    [frName],
  );

  useEffect(() => {
    if (!open || isoTouched || !suggestedIso) return;
    if (suggestedIso !== isoCode) setIsoCode(suggestedIso);
  }, [open, isoTouched, suggestedIso, isoCode]);

  const normalizedIso = isoCode.trim().toUpperCase();
  const isoInvalid = !!normalizedIso && !/^[A-Z]{2}$/.test(normalizedIso);
  const isoMissing = !normalizedIso;
  const pfsMissing = !pfsRef && !isEdit;
  const validationError = isoMissing
    ? "Code ISO obligatoire."
    : isoInvalid
      ? "Code ISO invalide (2 lettres)."
      : pfsMissing
        ? "Complétez la correspondance Paris Fashion Shop."
        : null;

  const faireSuggestion = useMemo(
    () => alpha2ToAlpha3(normalizedIso || suggestedIso),
    [normalizedIso, suggestedIso],
  );

  const suggestionOptions = useMemo(() => {
    if (pfsAnnexes && pfsAnnexes.countries.length > 0) return pfsAnnexes.countries;
    return [] as { value: string; label: string }[];
  }, [pfsAnnexes]);

  function setName(locale: string, value: string) {
    setNames((prev) => ({ ...prev, [locale]: value }));
  }

  function applyPfsSuggestion(ref: string) {
    setPfsRef(ref);
    setNames((prev) => ({ ...prev, fr: ref }));
    const iso = suggestIso2FromName(ref);
    if (iso) {
      setIsoCode(iso);
      setIsoTouched(false);
    }
  }

  async function handleSubmit() {
    if (!frName) {
      setError("Le nom en français est requis.");
      return;
    }
    if (isoMissing) {
      setError("Le code ISO du pays (2 lettres) est obligatoire.");
      return;
    }
    if (isoInvalid) {
      setError("Le code ISO doit être composé de 2 lettres (ex: FR, CN, TR).");
      return;
    }
    if (pfsMissing) {
      setError("La correspondance Paris Fashion Shop est obligatoire.");
      return;
    }
    const trimmedFaire = faireCountryCode.trim().toUpperCase();
    if (trimmedFaire && !/^[A-Z]{3}$/.test(trimmedFaire)) {
      setError("Le code Faire doit faire exactement 3 lettres (ex: CHN, FRA).");
      return;
    }

    setLoading(true);
    setError("");
    try {
      const translations: Record<string, string> = {};
      for (const [locale, val] of Object.entries(names)) {
        if (locale !== "fr" && val?.trim()) translations[locale] = val.trim();
      }

      if (editMode) {
        await editMode.onSave(
          frName,
          translations,
          { ref: pfsRef, isoCode: normalizedIso },
          { countryCode: trimmedFaire || null },
        );
        toast.success("Pays enregistré");
        onClose();
        return;
      }

      const payload = { fr: frName, ...translations };
      const result = await createManufacturingCountryQuick(
        payload,
        normalizedIso,
        pfsRef,
        efashionCreateId,
      );
      toast.success("Pays créé");
      onCreated?.(result);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur lors de l'enregistrement.");
    } finally {
      setLoading(false);
    }
  }

  if (!mounted || !open) return null;

  const nonFrLocales = VALID_LOCALES.filter((l) => l !== "fr");
  const emeraldName = editMode?.name || frName || "…";

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onMouseDown={backdrop.onMouseDown}
      onMouseUp={backdrop.onMouseUp}
    >
      <div
        className="w-full max-w-[1500px] max-h-[92vh] flex flex-col rounded-3xl overflow-hidden shadow-[0_30px_80px_-20px_rgba(0,0,0,0.5)] bg-bg-primary"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── HEADER : aurora emerald ── */}
        <div
          className="relative px-8 py-6 border-b border-border shrink-0 overflow-hidden"
          style={{
            background:
              "radial-gradient(60% 100% at 15% 0%, rgba(16,185,129,0.14), transparent 60%)," +
              "radial-gradient(40% 90% at 90% 0%, rgba(52,211,153,0.10), transparent 60%)," +
              "linear-gradient(180deg, #F0FDF4 0%, #FDFCFA 100%)",
          }}
        >
          <span
            aria-hidden
            className="absolute rounded-full pointer-events-none"
            style={{
              width: 160,
              height: 160,
              top: -64,
              right: 96,
              filter: "blur(48px)",
              background: "rgba(16,185,129,0.22)",
            }}
          />
          <div className="relative flex items-start justify-between gap-6">
            <div className="flex items-start gap-4 min-w-0">
              <span
                className="inline-flex items-center justify-center w-14 h-14 rounded-2xl shrink-0 text-3xl"
                style={{
                  background: "linear-gradient(135deg, #1A1A1A, #2D2D2D)",
                  color: "#FDFCFA",
                  boxShadow:
                    "0 8px 20px rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.08)",
                }}
                aria-hidden
              >
                {isoToFlag(normalizedIso)}
              </span>
              <div className="min-w-0">
                <span
                  className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-[11px] font-bold uppercase tracking-[0.18em] text-emerald-700 bg-white/85 border border-border font-body"
                  style={{ backdropFilter: "blur(6px)" }}
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full"
                    style={{
                      background: "#10B981",
                      boxShadow: "0 0 0 3px rgba(16,185,129,0.18)",
                    }}
                  />
                  Catalogue · Pays de fabrication
                </span>
                <h3 className="font-heading text-2xl md:text-[26px] font-bold text-text-primary mt-2 leading-tight">
                  {isEdit ? "Modifier le pays " : "Créer un pays "}
                  <span className="text-emerald-700">{emeraldName}</span>
                </h3>
                <p className="text-[13.5px] text-text-secondary mt-1 font-body">
                  Nom traduit, code ISO et correspondance sur les marketplaces.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="w-9 h-9 rounded-full inline-flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-white transition-colors border border-border bg-white/60"
              aria-label="Fermer"
              title="Fermer"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        </div>

        {/* ── BODY: 2 colonnes ── */}
        <div className="flex-1 overflow-y-auto flex min-h-0">
          {/* Colonne gauche : Identité */}
          <div className="p-8 space-y-6 flex-1 min-w-0 overflow-y-auto">
            <section className="rounded-2xl border border-border bg-bg-primary overflow-hidden">
              <header className="px-5 py-3.5 border-b border-border bg-bg-secondary/40 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-bg-dark text-text-inverse text-[11px] font-bold font-body">
                    1
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-text-primary font-heading leading-none">
                      Identité
                    </p>
                    <p className="text-[11px] text-text-muted font-body mt-1">
                      Nom en français et traductions.
                    </p>
                  </div>
                </div>
                {autoTranslateEnabled && !isEdit ? (
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-medium font-body text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2.5 py-1">
                    <svg
                      className="w-3 h-3"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                      strokeWidth={2.5}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                    Traduction auto activée
                  </span>
                ) : (
                  <TranslateButton
                    text={frName}
                    onTranslated={(t) =>
                      setNames((prev) => ({ ...prev, ...t }))
                    }
                    disabled={!frName}
                  />
                )}
              </header>
              <div className="p-5 space-y-5">
                <div>
                  <label className="block text-xs font-semibold text-text-secondary font-body mb-1.5">
                    Français <span className="text-[#EF4444]">*</span>
                  </label>
                  <input
                    type="text"
                    value={names["fr"] ?? ""}
                    onChange={(e) => setName("fr", e.target.value)}
                    autoFocus
                    placeholder="Ex: Chine, Turquie, France…"
                    className="field-input w-full text-sm"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleSubmit();
                      }
                    }}
                  />
                </div>
                <div>
                  <p className="text-[10px] font-semibold text-text-muted font-body uppercase tracking-wider mb-2">
                    Autres langues
                  </p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                    {nonFrLocales.map((locale) => (
                      <div key={locale}>
                        <label className="block text-[10px] font-semibold text-text-muted font-body mb-0.5 uppercase">
                          {LOCALE_FULL_NAMES[locale]}
                        </label>
                        <input
                          type="text"
                          value={names[locale] ?? ""}
                          onChange={(e) => setName(locale, e.target.value)}
                          className="field-input w-full text-sm"
                          placeholder={LOCALE_FULL_NAMES[locale]}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </section>
          </div>

          <div className="w-px bg-border shrink-0" />

          {/* Colonne droite : Marketplaces + Codes */}
          <aside className="w-[940px] shrink-0 p-8 overflow-y-auto bg-bg-secondary/30 space-y-5">
            <header>
              <div className="flex items-center gap-2.5 mb-1">
                <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-bg-dark text-text-inverse text-[11px] font-bold font-body">
                  2
                </span>
                <p className="font-heading text-sm font-semibold text-text-primary leading-none">
                  Correspondances marketplaces
                </p>
              </div>
              <p className="text-[11.5px] text-text-muted font-body mt-1 leading-relaxed">
                Reliez ce pays aux référentiels des marketplaces pour pouvoir y
                publier vos produits.
              </p>
            </header>

            <div className="grid grid-cols-2 gap-4">
              {/* ─── Carte PFS ─── */}
              <section className="relative rounded-2xl border border-border bg-bg-primary overflow-hidden h-full flex flex-col shadow-sm">
                <span
                  aria-hidden
                  className="absolute inset-x-0 top-0 h-[3px]"
                  style={{ background: "linear-gradient(90deg,#4f46e5,#6366f1)" }}
                />
                <header className="flex items-center gap-2.5 px-4 py-3 border-b border-border bg-bg-secondary">
                  <span
                    className="inline-flex items-center justify-center w-8 h-8 rounded-full text-white text-[13px] font-extrabold shrink-0"
                    style={{
                      background: "linear-gradient(135deg,#4f46e5,#6366f1)",
                      boxShadow:
                        "0 2px 6px rgba(79,70,229,0.35), inset 0 1px 0 rgba(255,255,255,0.15)",
                    }}
                    aria-hidden
                  >
                    P
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold text-text-primary font-heading leading-none">
                      Paris Fashion Shop
                    </p>
                    <p className="text-[10px] text-text-muted font-body mt-1">
                      Marketplace officielle PFS
                    </p>
                  </div>
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#FEF2F2] text-[#B91C1C] border border-[#FECACA] font-body">
                    Obligatoire
                  </span>
                </header>
                <div className="p-4 flex-1">
                  <MarketplaceMappingSection
                    entityType="country"
                    pfsRef={pfsRef}
                    onPfsRefChange={setPfsRef}
                  />
                  {suggestionOptions.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-border">
                      <PfsSuggestions
                        mode="ref"
                        query={frName}
                        options={suggestionOptions}
                        currentValue={pfsRef}
                        onPick={applyPfsSuggestion}
                        label="Correspondance PFS suggérée"
                      />
                    </div>
                  )}
                </div>
              </section>

              {/* ─── Carte eFashion ─── */}
              <section className="relative rounded-2xl border border-border bg-bg-primary overflow-hidden h-full flex flex-col shadow-sm">
                <span
                  aria-hidden
                  className="absolute inset-x-0 top-0 h-[3px]"
                  style={{ background: "linear-gradient(90deg,#db2777,#ec4899)" }}
                />
                <header className="flex items-center gap-2.5 px-4 py-3 border-b border-border bg-bg-secondary">
                  <span
                    className="inline-flex items-center justify-center w-8 h-8 rounded-full text-white text-[13px] font-extrabold shrink-0"
                    style={{
                      background: "linear-gradient(135deg,#db2777,#ec4899)",
                      boxShadow:
                        "0 2px 6px rgba(219,39,119,0.35), inset 0 1px 0 rgba(255,255,255,0.15)",
                    }}
                    aria-hidden
                  >
                    E
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold text-text-primary font-heading leading-none">
                      eFashion Paris
                    </p>
                    <p className="text-[10px] text-text-muted font-body mt-1">
                      {isEdit
                        ? "Enregistré automatiquement"
                        : "Optionnel — peut être complété plus tard"}
                    </p>
                  </div>
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#F5F3EE] text-[#78716C] border border-[#E7E5E4] font-body">
                    Facultatif
                  </span>
                </header>
                <div className="p-4 flex-1">
                  {isEdit && editMode ? (
                    <EfashionMappingPicker
                      entityId={editMode.id}
                      kind="country"
                      initialValue={editMode.efashionCurrentId}
                      entityName={frName || editMode.name}
                    />
                  ) : (
                    <EfashionMappingPicker
                      kind="country"
                      initialValue={efashionCreateId}
                      entityName={frName}
                      onChange={setEfashionCreateId}
                    />
                  )}
                </div>
              </section>

              {/* ─── Carte Code ISO ─── */}
              <section className="relative rounded-2xl border border-border bg-bg-primary overflow-hidden h-full flex flex-col shadow-sm">
                <span
                  aria-hidden
                  className="absolute inset-x-0 top-0 h-[3px]"
                  style={{ background: "linear-gradient(90deg,#94A3B8,#475569)" }}
                />
                <header className="flex items-center gap-2.5 px-4 py-3 border-b border-border bg-bg-secondary">
                  <span
                    className="inline-flex items-center justify-center w-8 h-8 rounded-xl bg-slate-100 text-slate-700 shrink-0"
                    aria-hidden
                  >
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z"
                      />
                    </svg>
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold text-text-primary font-heading leading-none">
                      Code ISO
                    </p>
                    <p className="text-[10px] text-text-muted font-body mt-1">
                      Code international 2 lettres
                    </p>
                  </div>
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#FEF2F2] text-[#B91C1C] border border-[#FECACA] font-body">
                    Obligatoire
                  </span>
                </header>
                <div className="p-4 flex-1 space-y-2">
                  <input
                    type="text"
                    value={isoCode}
                    onChange={(e) => {
                      setIsoTouched(true);
                      setIsoCode(e.target.value.toUpperCase().slice(0, 2));
                    }}
                    placeholder="FR"
                    maxLength={2}
                    className="field-input w-full font-mono uppercase tracking-[0.5em] text-center text-lg font-semibold"
                  />
                  {isoInvalid && (
                    <p className="text-[11px] text-[#EF4444] font-body">
                      Le code doit faire exactement 2 lettres.
                    </p>
                  )}
                  {!isoTouched && suggestedIso && isoCode === suggestedIso && (
                    <p className="text-[11px] text-emerald-600 font-body flex items-center gap-1">
                      <svg
                        className="w-3 h-3"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                        strokeWidth={2.5}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                      Détecté automatiquement d&apos;après le nom
                    </p>
                  )}
                  {isoTouched &&
                    suggestedIso &&
                    suggestedIso !== normalizedIso && (
                      <button
                        type="button"
                        onClick={() => setIsoCode(suggestedIso)}
                        className="text-[11px] text-text-muted hover:text-text-primary underline font-body"
                      >
                        Utiliser « {suggestedIso} »
                      </button>
                    )}
                </div>
              </section>

              {/* ─── Carte Faire ─── */}
              <section className="relative rounded-2xl border border-border bg-bg-primary overflow-hidden h-full flex flex-col shadow-sm">
                <span
                  aria-hidden
                  className="absolute inset-x-0 top-0 h-[3px]"
                  style={{ background: "linear-gradient(90deg,#f59e0b,#fbbf24)" }}
                />
                <header className="flex items-center gap-2.5 px-4 py-3 border-b border-border bg-bg-secondary">
                  <span
                    className="inline-flex items-center justify-center w-8 h-8 rounded-full text-white text-[13px] font-extrabold shrink-0"
                    style={{
                      background: "linear-gradient(135deg,#f59e0b,#fbbf24)",
                      boxShadow:
                        "0 2px 6px rgba(245,158,11,0.35), inset 0 1px 0 rgba(255,255,255,0.15)",
                    }}
                    aria-hidden
                  >
                    F
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold text-text-primary font-heading leading-none">
                      Faire
                    </p>
                    <p className="text-[10px] text-text-muted font-body mt-1">
                      Code à 3 lettres (ex : CHN, FRA, PRT)
                    </p>
                  </div>
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#F5F3EE] text-[#78716C] border border-[#E7E5E4] font-body">
                    Facultatif
                  </span>
                </header>
                <div className="p-4 flex-1 space-y-2">
                  <input
                    type="text"
                    value={faireCountryCode}
                    onChange={(e) =>
                      setFaireCountryCode(
                        e.target.value
                          .toUpperCase()
                          .replace(/[^A-Z]/g, "")
                          .slice(0, 3),
                      )
                    }
                    placeholder={faireSuggestion || "CHN"}
                    maxLength={3}
                    className="field-input w-full font-mono uppercase tracking-[0.4em] text-center text-base font-semibold"
                  />
                  {faireCountryCode.length > 0 &&
                    faireCountryCode.length < 3 && (
                      <p className="text-[11px] text-[#EF4444] font-body">
                        Le code doit faire exactement 3 lettres.
                      </p>
                    )}
                  {!faireCountryCode && faireSuggestion && (
                    <button
                      type="button"
                      onClick={() => setFaireCountryCode(faireSuggestion)}
                      className="text-[11px] text-text-muted hover:text-text-primary underline font-body"
                    >
                      Utiliser « {faireSuggestion} » (détecté d&apos;après l&apos;ISO)
                    </button>
                  )}
                </div>
              </section>
            </div>
          </aside>
        </div>

        {/* ── FOOTER ── */}
        <div className="flex items-center justify-between gap-4 px-8 py-4 border-t border-border shrink-0 bg-bg-secondary/40">
          <div className="min-w-0">
            {error ? (
              <p className="inline-flex items-center gap-1.5 text-xs text-[#DC2626] font-body font-medium">
                <svg
                  className="w-3.5 h-3.5 shrink-0"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
                  />
                </svg>
                {error}
              </p>
            ) : !frName ? (
              <p className="text-[11px] text-text-muted font-body">
                Saisissez d&apos;abord le nom en français.
              </p>
            ) : validationError ? (
              <p className="inline-flex items-center gap-1.5 text-[11px] text-amber-700 font-body">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                {validationError}
              </p>
            ) : (
              <p className="inline-flex items-center gap-1.5 text-[11px] text-emerald-700 font-body">
                <svg
                  className="w-3.5 h-3.5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  strokeWidth={2.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M5 13l4 4L19 7"
                  />
                </svg>
                Prêt à {isEdit ? "enregistrer" : "créer"}.
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-border text-text-secondary hover:border-bg-dark hover:text-text-primary text-sm font-medium rounded-lg transition-colors font-body"
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={loading || !frName || !!validationError}
              className="inline-flex items-center gap-2 px-5 py-2 bg-bg-dark hover:bg-black text-text-inverse text-sm font-semibold rounded-lg shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-body"
            >
              {loading ? (
                <>
                  <svg
                    className="w-4 h-4 animate-spin"
                    viewBox="0 0 24 24"
                    fill="none"
                  >
                    <circle
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeOpacity="0.25"
                      strokeWidth="3"
                    />
                    <path
                      d="M22 12a10 10 0 00-10-10"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeLinecap="round"
                    />
                  </svg>
                  {isEdit ? "Enregistrement…" : "Création…"}
                </>
              ) : (
                <>
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M4.5 12.75l6 6 9-13.5"
                    />
                  </svg>
                  {isEdit ? "Enregistrer" : "Créer"}
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
