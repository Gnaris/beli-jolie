"use client";

/**
 * CategoryEditorModal — modale dédiée à la création et à l'édition d'une
 * catégorie. Design cockpit : header aurora avec eyebrow, colonne « Identité »
 * (FR + EN) à gauche, cartes marketplaces empilées (PFS, eFashion, Faire) à
 * droite avec statut « Reliée / Non reliée » clair.
 *
 * Réutilise les sous-composants de la modale générique :
 *   - MarketplaceMappingSection (cascade PFS Genre/Famille/Catégorie)
 *   - PfsSuggestions           (raccourcis PFS suggérés d'après le nom FR)
 *   - EfashionMappingPicker    (sélecteur eFashion embarqué avec auto-save)
 *   - FaireTaxonomySelect      (sélecteur Faire avec suggestion)
 *   - TranslateButton          (traduction manuelle EN si auto-traduction OFF)
 */

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { useBackdropClose } from "@/hooks/useBackdropClose";
import { useToast } from "@/components/ui/Toast";
import { useAutoTranslateEnabled } from "@/components/admin/DeeplConfigContext";
import { createCategoryQuick } from "@/app/actions/admin/quick-create";
import { updateCategoryFaireTaxonomy } from "@/app/actions/admin/categories";
import { fetchPfsMappingOptions, type PfsMappingOptions } from "@/app/actions/admin/pfs-annexes";
import { PFS_GENDER_LABELS, PFS_FAMILIES_BY_GENDER, PFS_SUBCATEGORIES_BY_FAMILY } from "@/lib/marketplace-excel/pfs-taxonomy";
import TranslateButton from "@/components/admin/TranslateButton";
import TranslatingInput from "@/components/admin/TranslatingInput";
import { useAutoTranslateOnBlur } from "@/hooks/useAutoTranslateOnBlur";
import MarketplaceMappingSection from "@/components/admin/MarketplaceMappingSection";
import EfashionMappingPicker from "@/components/admin/EfashionMappingPicker";
import FaireTaxonomySelect from "@/components/admin/FaireTaxonomySelect";
import PfsSuggestions, { type PfsCategoryTriple } from "@/components/admin/pfs/PfsSuggestions";

export type CategoryFocusMarketplace = "pfs" | "efashion" | "faire";

export interface CategoryEditorEditMode {
  id: string;
  name: string;
  translations: Record<string, string>;
  pfsGender?: string | null;
  pfsFamilyName?: string | null;
  pfsCategoryName?: string | null;
  efashionCurrentId?: number | null;
  faireCurrentTaxonomyId?: string | null;
  onFaireTaxonomySaved?: (next: string | null, nextLabel: string | null) => void;
  onSave: (
    name: string,
    translations: Record<string, string>,
    pfs?: { pfsGender?: string | null; pfsFamilyName?: string | null; pfsCategoryName?: string | null },
    faire?: { taxonomyId?: string | null },
  ) => Promise<void>;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated?: (item: { id: string; name: string; subCategories?: { id: string; name: string }[] }) => void;
  focusMarketplace?: CategoryFocusMarketplace;
  defaultPfsGender?: string;
  defaultPfsFamilyName?: string;
  defaultPfsCategoryName?: string;
  defaultPfsCategoryId?: string;
  editMode?: CategoryEditorEditMode;
}

export default function CategoryEditorModal({
  open,
  onClose,
  onCreated,
  focusMarketplace,
  defaultPfsGender,
  defaultPfsFamilyName,
  defaultPfsCategoryName,
  defaultPfsCategoryId,
  editMode,
}: Props) {
  const isEdit = !!editMode;
  const autoTranslateEnabled = useAutoTranslateEnabled();
  const router = useRouter();
  const toast = useToast();
  const backdrop = useBackdropClose(onClose);

  const [mounted, setMounted] = useState(false);
  const [names, setNames] = useState<Record<string, string>>({});
  const [pfsGender, setPfsGender] = useState<string | null>(null);
  const [pfsFamilyName, setPfsFamilyName] = useState<string | null>(null);
  const [pfsCategoryName, setPfsCategoryName] = useState<string | null>(null);
  const [faireTaxonomyId, setFaireTaxonomyId] = useState<string | null>(null);
  const [efashionCreateId, setEfashionCreateId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [pfsAnnexes, setPfsAnnexes] = useState<PfsMappingOptions | null>(null);

  const { handleFrBlur, isTranslating } = useAutoTranslateOnBlur({ names, setNames });

  useEffect(() => { setMounted(true); }, []);

  // Reset le state à chaque ouverture — évite les résidus d'une édition
  // précédente. Volontairement dépendant du seul flag `open` : on ne veut
  // pas re-tirer sur editMode/defaults (qui peuvent changer entre 2 renders
  // sans que la modale se rouvre).
  useEffect(() => {
    if (!open) return;
    if (editMode) {
      setNames({ fr: editMode.name, ...editMode.translations });
      setPfsGender(editMode.pfsGender ?? null);
      setPfsFamilyName(editMode.pfsFamilyName ?? null);
      setPfsCategoryName(editMode.pfsCategoryName ?? null);
      setFaireTaxonomyId(editMode.faireCurrentTaxonomyId ?? null);
    } else {
      setNames({});
      setPfsGender(defaultPfsGender ?? null);
      setPfsFamilyName(defaultPfsFamilyName ?? null);
      setPfsCategoryName(defaultPfsCategoryName ?? null);
      setFaireTaxonomyId(null);
      setEfashionCreateId(null);
    }
    setError("");
    setLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Charge les annexes PFS live (pour PfsSuggestions) — même stratégie que
  // QuickCreateModal : appel unique par ouverture, fallback silencieux sur
  // la taxonomie statique.
  useEffect(() => {
    if (!open || pfsAnnexes) return;
    let cancelled = false;
    fetchPfsMappingOptions()
      .then((res) => { if (!cancelled) setPfsAnnexes(res); })
      .catch(() => { /* fallback statique */ });
    return () => { cancelled = true; };
  }, [open, pfsAnnexes]);

  // Scroll doux vers la carte marketplace ciblée à l'ouverture (utilisé par
  // la fiche catégorie quand on clique « Modifier le mapping » sur une carte).
  useEffect(() => {
    if (!open || !focusMarketplace) return;
    const timer = setTimeout(() => {
      document
        .querySelector<HTMLElement>(`[data-category-mp="${focusMarketplace}"]`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 120);
    return () => clearTimeout(timer);
  }, [open, focusMarketplace]);

  const pfsCategoryTriples = useMemo<PfsCategoryTriple[]>(() => {
    if (pfsAnnexes && pfsAnnexes.categories.length > 0) {
      return pfsAnnexes.categories.map((c) => ({
        gender: PFS_GENDER_LABELS[c.gender] ?? c.gender,
        family: c.family,
        category: c.category,
      }));
    }
    const out: PfsCategoryTriple[] = [];
    for (const [gender, families] of Object.entries(PFS_FAMILIES_BY_GENDER)) {
      for (const family of families) {
        const cats = PFS_SUBCATEGORIES_BY_FAMILY[family] ?? [];
        for (const category of cats) {
          out.push({ gender, family, category });
        }
      }
    }
    return out;
  }, [pfsAnnexes]);

  const currentCategoryTriple = useMemo<PfsCategoryTriple | null>(() => {
    if (!pfsGender || !pfsFamilyName || !pfsCategoryName) return null;
    const genderLabel = PFS_GENDER_LABELS[pfsGender];
    if (!genderLabel) return null;
    return { gender: genderLabel, family: pfsFamilyName, category: pfsCategoryName };
  }, [pfsGender, pfsFamilyName, pfsCategoryName]);

  function applyCategoryTriple(t: PfsCategoryTriple) {
    const codeEntry = Object.entries(PFS_GENDER_LABELS).find(([, label]) => label === t.gender);
    const genderCode = codeEntry ? codeEntry[0] : null;
    setPfsGender(genderCode);
    setPfsFamilyName(t.family);
    setPfsCategoryName(t.category);
  }

  const frName = (names["fr"] ?? "").trim();
  const enName = (names["en"] ?? "").trim();

  // PFS mapping incomplet : en création on force Genre + Famille (comme
  // l'ancienne modale). En édition on tolère un mapping vide — l'admin doit
  // pouvoir sauvegarder un simple renommage sans re-compléter le mapping.
  const pfsMappingMissing = !isEdit && (!pfsGender || !pfsFamilyName);

  // Statut synthétique des cartes marketplaces, réutilisé pour l'entête et
  // le footer.
  const pfsMapped = !!(pfsGender && pfsFamilyName);
  const efashionMapped = isEdit
    ? editMode?.efashionCurrentId != null
    : efashionCreateId != null;
  const faireMapped = !!faireTaxonomyId;
  const totalMapped = [pfsMapped, efashionMapped, faireMapped].filter(Boolean).length;

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
          { pfsGender, pfsFamilyName, pfsCategoryName },
          { taxonomyId: faireTaxonomyId },
        );
        onClose();
        return;
      }
      if (pfsMappingMissing) {
        setError("Complète le genre et la famille Paris Fashion Shop.");
        setLoading(false);
        return;
      }
      const result = await createCategoryQuick(
        names,
        pfsGender,
        pfsFamilyName,
        pfsCategoryName,
        defaultPfsCategoryId ?? null,
        efashionCreateId,
        faireTaxonomyId,
      );
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

        {/* ── Header aurora ────────────────────────────────────────────── */}
        <div className="relative overflow-hidden border-b border-border shrink-0">
          <div
            aria-hidden
            className="absolute inset-0 pointer-events-none"
            style={{
              background:
                "radial-gradient(60% 80% at 10% 0%, rgba(16,185,129,0.10), transparent 60%)," +
                "radial-gradient(50% 70% at 90% 10%, rgba(148,163,184,0.10), transparent 60%)," +
                "radial-gradient(80% 60% at 50% 100%, rgba(251,191,36,0.06), transparent 60%)",
            }}
          />
          <div className="relative px-8 pt-7 pb-6">
            <div className="flex items-start justify-between gap-6">
              <div className="flex items-start gap-4 min-w-0">
                <span className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-bg-primary border border-border shadow-sm text-emerald-600">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8} aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
                  </svg>
                </span>
                <div className="min-w-0">
                  <span className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-100 text-emerald-700 text-[10.5px] font-bold uppercase tracking-[0.14em]">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    Catalogue · Catégorie
                  </span>
                  <h3 className="font-heading text-[22px] font-bold text-text-primary leading-tight mt-2 truncate">
                    {isEdit ? `Modifier la catégorie « ${editMode.name} »` : "Créer une catégorie"}
                  </h3>
                  <p className="text-[13px] text-text-secondary mt-1 leading-relaxed">
                    Le nom, sa traduction anglaise et les correspondances avec les marketplaces.
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

            {/* ── Colonne gauche : Identité ─────────────────────────── */}
            <div className="p-7 space-y-6 lg:border-r border-border bg-bg-primary">
              <section className="space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="inline-flex items-center gap-2.5 text-[11px] font-bold uppercase tracking-[0.14em] text-text-secondary">
                    <span aria-hidden className="w-[3px] h-[14px] rounded-full bg-emerald-500" />
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
                    placeholder="Ex : Bague, Collier, Boucles d'oreilles…"
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
                    <TranslatingInput
                      translating={isTranslating("en")}
                      type="text"
                      value={names["en"] ?? ""}
                      onChange={(e) => setNames((prev) => ({ ...prev, en: e.target.value }))}
                      placeholder="Ex : Ring, Necklace, Earrings…"
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
                  <strong className="text-text-primary">Astuce</strong> — une catégorie regroupe plusieurs sous-catégories. Ex : « Bague » → « Bague solitaire », « Bague trois anneaux »…
                </p>
              </div>
            </div>

            {/* ── Colonne droite : Marketplaces empilées ───────────── */}
            <div className="p-7 space-y-5 bg-bg-secondary/60">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <span className="inline-flex items-center gap-2.5 text-[11px] font-bold uppercase tracking-[0.14em] text-text-secondary">
                    <span aria-hidden className="w-[3px] h-[14px] rounded-full bg-emerald-500" />
                    2 · Marketplaces
                  </span>
                  <p className="text-[12px] text-text-secondary mt-2 leading-relaxed max-w-md">
                    Relie cette catégorie aux marketplaces où tu vends. Paris Fashion Shop est nécessaire pour publier ; eFashion et Faire sont facultatifs.
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-text-muted">Statut</p>
                  <p className={`text-[13px] font-semibold mt-0.5 flex items-center gap-1.5 justify-end ${
                    totalMapped === 3 ? "text-emerald-700" : totalMapped > 0 ? "text-amber-700" : "text-text-muted"
                  }`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${
                      totalMapped === 3 ? "bg-emerald-500" : totalMapped > 0 ? "bg-amber-500" : "bg-text-muted"
                    }`} />
                    {totalMapped} sur 3 reliées
                  </p>
                </div>
              </div>

              {/* ─ Carte PFS ─────────────────────────────────────────── */}
              <MarketplaceCard
                dataKey="pfs"
                icon={<AvatarBadge gradient="linear-gradient(135deg,#0F172A,#334155)" text="PFS" />}
                title="Paris Fashion Shop"
                subtitle="Marketplace principale — nécessaire pour publier"
                mapped={pfsMapped}
              >
                <MarketplaceMappingSection
                  entityType="category"
                  pfsGender={pfsGender}
                  pfsFamilyName={pfsFamilyName}
                  pfsCategoryName={pfsCategoryName}
                  onPfsGenderChange={setPfsGender}
                  onPfsFamilyNameChange={setPfsFamilyName}
                  onPfsCategoryNameChange={setPfsCategoryName}
                />
                <div className="mt-3 pt-3 border-t border-border">
                  <PfsSuggestions
                    mode="category"
                    query={names["fr"] ?? ""}
                    triples={pfsCategoryTriples}
                    currentValue={currentCategoryTriple}
                    onPickCategory={applyCategoryTriple}
                    label="Correspondance PFS suggérée"
                  />
                </div>
              </MarketplaceCard>

              {/* ─ Carte eFashion ────────────────────────────────────── */}
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
                    kind="category"
                    initialValue={editMode.efashionCurrentId ?? null}
                    entityName={names["fr"] ?? editMode.name}
                  />
                ) : (
                  <EfashionMappingPicker
                    kind="category"
                    initialValue={efashionCreateId}
                    entityName={names["fr"]}
                    onChange={setEfashionCreateId}
                  />
                )}
              </MarketplaceCard>

              {/* ─ Carte Faire ───────────────────────────────────────── */}
              <MarketplaceCard
                dataKey="faire"
                icon={<AvatarBadge gradient="linear-gradient(135deg,#F59E0B,#F97316)" text="Fr" />}
                title="Faire"
                subtitle={isEdit ? "Enregistré automatiquement à chaque changement" : "Facultatif — peut être complété plus tard"}
                mapped={faireMapped}
              >
                <FaireTaxonomySelect
                  label="Type de produit Faire"
                  value={faireTaxonomyId}
                  helpText="Recherche par nom (« bracelet », « bague »…). Le fil d'Ariane aide à distinguer les doublons."
                  suggestionQuery={names["fr"] ?? ""}
                  onSave={async (next, nextLabel) => {
                    if (editMode) {
                      try {
                        await updateCategoryFaireTaxonomy(editMode.id, next);
                        editMode.onFaireTaxonomySaved?.(next, nextLabel);
                        router.refresh();
                        toast.success(next ? "Catégorie Faire liée" : "Lien Faire retiré");
                      } catch (err) {
                        const message = err instanceof Error ? err.message : "Erreur d'enregistrement.";
                        toast.error("Faire", message);
                        throw err;
                      }
                    }
                    setFaireTaxonomyId(next);
                  }}
                />
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
            ) : pfsMappingMissing ? (
              <p className="inline-flex items-center gap-1.5 text-[11.5px] text-amber-700">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                Complète la correspondance Paris Fashion Shop.
              </p>
            ) : (
              <p className="inline-flex items-center gap-1.5 text-[11.5px] text-emerald-700">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                Prêt à {isEdit ? "enregistrer" : "créer"} — {totalMapped} marketplace{totalMapped > 1 ? "s" : ""} reliée{totalMapped > 1 ? "s" : ""} sur 3.
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
                  {isEdit ? "Enregistrer les modifications" : "Créer la catégorie"}
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );

  // Note about the visual identity of enName: it participates in the derived
  // "Anglais renseigné" hint. Keeping it in scope for future use (badge if the
  // user forgot the EN name) without changing runtime today.
  void enName;
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
  dataKey,
  icon,
  title,
  subtitle,
  mapped,
  children,
}: {
  dataKey: CategoryFocusMarketplace;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  mapped: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      data-category-mp={dataKey}
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
                mapped
                  ? "bg-emerald-50 text-emerald-700"
                  : "bg-amber-50 text-amber-700"
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
