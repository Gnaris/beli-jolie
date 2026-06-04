"use client";

import { useState, useMemo } from "react";
import CustomSelect from "@/components/ui/CustomSelect";
import EntitySelect, { type EntityOption, type EntityKind } from "./EntitySelect";
import CompositionEditor from "./CompositionEditor";
import { effectiveProductErrors as computeEffectiveErrors } from "./effective-status";
import type { PreviewProduct, PreviewVariant } from "@/app/api/admin/products/import/preview/route";
import type { ImportHsCodeOption } from "@/app/api/admin/products/import/options/route";

/**
 * Carte produit éditable affichée dans le récapitulatif d'import.
 *
 * Refonte UI (juin 2026) :
 *  - Onglets internes (Fiche produit / Variantes) pour limiter la charge visuelle
 *  - Champs plus grands, labels et inputs lisibles
 *  - Erreurs et statut très visibles
 *  - Plus de champs « Nom (EN) » / « Description (EN) » : la traduction anglaise
 *    est désormais générée automatiquement à l'import via l'API PFS
 *  - Code SH choisi dans une liste déroulante (HsCode existant en BDD)
 */

// ─────────────────────────────────────────────
// Types d'override (état local)
// ─────────────────────────────────────────────

export interface VariantOverride {
  color?: string;
  saleType?: "UNIT" | "PACK";
  unitPrice?: number;
  stock?: number;
  size?: string;
  packQuantity?: number | null;
}

export interface ProductOverride {
  reference: string;
  name?: string;
  description?: string;
  category?: string;
  subCategories?: string;
  tags?: string;
  composition?: string;
  primaryColor?: string;
  manufacturingCountry?: string;
  season?: string;
  hsCode?: string;
  sizeDetailsTu?: string;
  similarRefs?: string;
  status?: "OFFLINE" | "ONLINE" | "ARCHIVED";
  isBestSeller?: boolean;
  dimensionLength?: number | null;
  dimensionWidth?: number | null;
  dimensionHeight?: number | null;
  dimensionDiameter?: number | null;
  dimensionCircumference?: number | null;
  variants?: Record<number, VariantOverride>;
}

interface Props {
  product: PreviewProduct;
  override: ProductOverride;
  onChange: (next: ProductOverride) => void;
  categories: EntityOption[];
  subCategoriesAll: EntityOption[];
  colors: EntityOption[];
  compositions: EntityOption[];
  countries: EntityOption[];
  seasons: EntityOption[];
  hsCodes: ImportHsCodeOption[];
  onEntityCreated: (kind: "category" | "subcategory" | "color" | "composition" | "country" | "season", entity: EntityOption) => void;
  onRequestCreate: (kind: EntityKind, suggestedName?: string) => void;
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function getEffective<T>(override: T | undefined, original: T | undefined): T | undefined {
  return override !== undefined ? override : original;
}

// ─────────────────────────────────────────────
// Petits composants d'édition (taille « grande »)
// ─────────────────────────────────────────────

function FieldLabel({
  label,
  required,
  hint,
}: { label: string; required?: boolean; hint?: string }) {
  return (
    <div className="mb-1.5">
      <label className="block text-sm font-semibold text-text-primary">
        {label}
        {required && <span className="text-red-600 ml-1">*</span>}
      </label>
      {hint && <p className="text-xs text-text-secondary mt-0.5">{hint}</p>}
    </div>
  );
}

function TextField({
  value,
  onChange,
  placeholder,
  multiline,
  rows = 3,
  error,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  rows?: number;
  error?: boolean;
}) {
  const cls = `w-full px-3 py-2.5 text-sm border rounded-lg bg-bg-primary transition-colors focus:outline-none focus:ring-2 focus:ring-bg-dark/15 ${
    error ? "border-red-300 bg-red-50/40" : "border-border focus:border-bg-dark/30"
  }`;
  if (multiline) {
    return (
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        className={cls + " resize-y leading-relaxed"}
      />
    );
  }
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={cls}
    />
  );
}

function NumberField({
  value,
  onChange,
  placeholder,
  step = 1,
  min,
  suffix,
}: {
  value: number | null | undefined;
  onChange: (v: number | null) => void;
  placeholder?: string;
  step?: number;
  min?: number;
  suffix?: string;
}) {
  return (
    <div className="relative">
      <input
        type="number"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? null : parseFloat(e.target.value))}
        placeholder={placeholder}
        step={step}
        min={min}
        className={`w-full px-3 py-2.5 text-sm border border-border rounded-lg bg-bg-primary focus:outline-none focus:ring-2 focus:ring-bg-dark/15 focus:border-bg-dark/30 transition-colors ${
          suffix ? "pr-12" : ""
        }`}
      />
      {suffix && (
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-text-secondary pointer-events-none">
          {suffix}
        </span>
      )}
    </div>
  );
}

function BooleanField({
  value,
  onChange,
}: { value: boolean | undefined; onChange: (v: boolean) => void }) {
  return (
    <CustomSelect
      value={value === true ? "true" : value === false ? "false" : ""}
      onChange={(v) => onChange(v === "true")}
      options={[
        { value: "false", label: "Non" },
        { value: "true", label: "Oui" },
      ]}
      size="md"
    />
  );
}

// ─────────────────────────────────────────────
// Composant principal
// ─────────────────────────────────────────────

type TabKey = "produit" | "variantes";

export default function EditableProductCard({
  product,
  override,
  onChange,
  categories,
  subCategoriesAll: _subCategoriesAll,
  colors,
  compositions,
  countries,
  seasons,
  hsCodes,
  onEntityCreated,
  onRequestCreate,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>("produit");

  // Valeur effective = override si défini, sinon donnée d'origine du fichier Excel
  const v = useMemo(() => ({
    name: getEffective(override.name, product.name) ?? "",
    description: getEffective(override.description, product.description) ?? "",
    category: getEffective(override.category, product.category) ?? "",
    subCategories: getEffective(override.subCategories, product.subCategories) ?? "",
    tags: getEffective(override.tags, product.tags) ?? "",
    composition: getEffective(override.composition, product.composition) ?? "",
    manufacturingCountry: getEffective(override.manufacturingCountry, product.manufacturingCountry) ?? "",
    season: getEffective(override.season, product.season) ?? "",
    primaryColor: getEffective(override.primaryColor, product.primaryColor) ?? "",
    hsCode: getEffective(override.hsCode, product.hsCode) ?? "",
    sizeDetailsTu: getEffective(override.sizeDetailsTu, product.sizeDetailsTu) ?? "",
    similarRefs: getEffective(override.similarRefs, product.similarRefs) ?? "",
    status: getEffective(override.status, product.status) ?? "OFFLINE",
    isBestSeller: getEffective(override.isBestSeller, product.isBestSeller),
    dimensionLength: getEffective(override.dimensionLength, product.dimensionLength ?? null),
    dimensionWidth: getEffective(override.dimensionWidth, product.dimensionWidth ?? null),
    dimensionHeight: getEffective(override.dimensionHeight, product.dimensionHeight ?? null),
    dimensionDiameter: getEffective(override.dimensionDiameter, product.dimensionDiameter ?? null),
    dimensionCircumference: getEffective(override.dimensionCircumference, product.dimensionCircumference ?? null),
  }), [override, product]);

  const effectiveProductErrors = useMemo(
    () => computeEffectiveErrors(product, override),
    [product, override],
  );
  const effectiveVariantErrorsCount = product.variants.reduce((s, va) => s + va.errors.length, 0);
  const totalIssues = effectiveProductErrors.length + effectiveVariantErrorsCount;

  const patch = (partial: Partial<ProductOverride>) => {
    onChange({ ...override, ...partial });
  };

  const patchVariant = (idx: number, partial: VariantOverride) => {
    const variants = { ...(override.variants ?? {}) };
    variants[idx] = { ...(variants[idx] ?? {}), ...partial };
    onChange({ ...override, variants });
  };

  const variantValue = (idx: number, key: keyof VariantOverride, originalKey: keyof PreviewVariant): string | number | undefined => {
    const ov = override.variants?.[idx]?.[key];
    if (ov !== undefined) return ov as string | number;
    return product.variants[idx]?.[originalKey] as string | number | undefined;
  };

  // ── Statut visuel ──
  const statusBadge = product.referenceExists
    ? { color: "bg-red-100 text-red-800 border-red-200", label: "Existe déjà" }
    : totalIssues > 0
      ? { color: "bg-amber-100 text-amber-900 border-amber-200", label: `${totalIssues} à corriger` }
      : { color: "bg-emerald-100 text-emerald-900 border-emerald-200", label: "✓ Prêt à importer" };

  const cardBorder = product.referenceExists
    ? "border-red-200"
    : totalIssues > 0
      ? "border-amber-200"
      : "border-emerald-200";

  // ── Compteurs d'onglet ──
  const productTabErrors = effectiveProductErrors.length;
  const variantTabErrors = effectiveVariantErrorsCount;

  // Options HS Code formatées : "71171900 — Bijouterie fantaisie".
  // Si l'Excel pointe vers un code qui n'existe pas en base, on l'ajoute en bas
  // avec un avertissement pour ne pas perdre la valeur.
  const hsCodeOptions = useMemo(() => {
    const opts: { value: string; label: string }[] = [
      { value: "", label: "— Aucun code SH —" },
      ...hsCodes.map((h) => ({
        value: h.code,
        label: h.label ? `${h.code} — ${h.label}` : h.code,
      })),
    ];
    if (v.hsCode && !hsCodes.some((h) => h.code === v.hsCode)) {
      opts.push({ value: v.hsCode, label: `⚠ ${v.hsCode} (à créer)` });
    }
    return opts;
  }, [hsCodes, v.hsCode]);

  return (
    <div className={`bg-bg-primary rounded-2xl border ${cardBorder} shadow-sm overflow-hidden transition-all`}>
      {/* ───── EN-TÊTE ───────────────────────────────────────────────────── */}
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center gap-4 px-5 py-4 text-left hover:bg-bg-secondary/40 transition-colors"
      >
        {/* Référence en pill */}
        <span className="shrink-0 text-xs font-mono font-semibold text-text-primary bg-bg-secondary border border-border rounded-md px-2.5 py-1.5">
          {product.reference}
        </span>

        {/* Nom + catégorie */}
        <div className="flex-1 min-w-0">
          <div className="text-base font-semibold text-text-primary truncate">
            {v.name || <em className="text-red-600 font-normal">Nom manquant</em>}
          </div>
          <div className="text-xs text-text-secondary mt-0.5 flex items-center gap-2 flex-wrap">
            <span>{v.category || <em className="text-amber-700">Catégorie ?</em>}</span>
            <span className="text-text-secondary/40">·</span>
            <span>{product.variants.length} variante{product.variants.length > 1 ? "s" : ""}</span>
          </div>
        </div>

        {/* Statut */}
        <span className={`shrink-0 text-xs font-medium px-2.5 py-1 rounded-full border ${statusBadge.color}`}>
          {statusBadge.label}
        </span>

        {/* Chevron */}
        <span className={`shrink-0 text-text-secondary text-sm transition-transform ${expanded ? "rotate-180" : ""}`}>
          ▾
        </span>
      </button>

      {/* ───── CORPS REPLIABLE ───────────────────────────────────────────── */}
      {expanded && (
        <div className="border-t border-border bg-bg-secondary/20">
          {/* Onglets */}
          <div className="flex items-center border-b border-border bg-bg-primary px-2 sm:px-4 pt-1">
            <TabButton
              active={activeTab === "produit"}
              label="Fiche produit"
              count={productTabErrors}
              onClick={() => setActiveTab("produit")}
            />
            <TabButton
              active={activeTab === "variantes"}
              label={`Variantes (${product.variants.length})`}
              count={variantTabErrors}
              onClick={() => setActiveTab("variantes")}
            />
          </div>

          <div className="p-4 sm:p-6">
            {activeTab === "produit" && (
              <div className="space-y-7">
                {/* Erreurs au niveau produit */}
                {effectiveProductErrors.length > 0 && (
                  <div className="p-4 rounded-xl bg-red-50 border border-red-200">
                    <div className="text-sm font-semibold text-red-800 mb-2 flex items-center gap-2">
                      <span aria-hidden>⚠</span> À corriger sur ce produit
                    </div>
                    <ul className="space-y-1 text-sm text-red-800 list-disc list-inside ml-1">
                      {effectiveProductErrors.map((e, i) => <li key={i}>{e}</li>)}
                    </ul>
                  </div>
                )}

                {/* ───── Section : Identité ───────────────────────────── */}
                <Section
                  title="Identité"
                  hint="Le nom et la description sont en français. La traduction anglaise est générée automatiquement à l'import."
                >
                  <div className="grid grid-cols-1 gap-5">
                    <div>
                      <FieldLabel label="Nom du produit" required />
                      <TextField
                        value={v.name}
                        onChange={(val) => patch({ name: val })}
                        placeholder="Ex. : Bracelet jonc en acier inoxydable"
                        error={!v.name}
                      />
                    </div>
                    <div>
                      <FieldLabel label="Description" required />
                      <TextField
                        value={v.description}
                        onChange={(val) => patch({ description: val })}
                        multiline
                        rows={4}
                        placeholder="Description du produit"
                        error={!v.description}
                      />
                    </div>
                  </div>
                </Section>

                {/* ───── Section : Classement ─────────────────────────── */}
                <Section title="Classement">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    <div>
                      <FieldLabel label="Catégorie" required />
                      <EntitySelect
                        kind="category"
                        value={v.category}
                        onChange={(val) => patch({ category: val })}
                        options={categories}
                        onEntityCreated={(e) => onEntityCreated("category", e)}
                        onRequestCreate={onRequestCreate}
                        size="md"
                      />
                    </div>
                    <div>
                      <FieldLabel
                        label="Sous-catégories"
                        hint="Noms séparés par des virgules"
                      />
                      <TextField
                        value={v.subCategories}
                        onChange={(val) => patch({ subCategories: val })}
                        placeholder="Sautoir, Fin"
                      />
                    </div>
                    <div className="md:col-span-2">
                      <FieldLabel label="Mots-clés (tags)" hint="Séparés par des virgules" />
                      <TextField
                        value={v.tags}
                        onChange={(val) => patch({ tags: val })}
                        placeholder="étoile, fin, tendance"
                      />
                    </div>
                  </div>
                </Section>

                {/* ───── Section : Caractéristiques ───────────────────── */}
                <Section title="Caractéristiques">
                  <div className="grid grid-cols-1 gap-5">
                    <div>
                      <FieldLabel label="Composition" required hint="Matière et pourcentage (total = 100%)" />
                      <CompositionEditor
                        value={v.composition}
                        onChange={(val) => patch({ composition: val })}
                        options={compositions}
                        onRequestCreate={onRequestCreate}
                      />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                      <div>
                        <FieldLabel
                          label="Couleur principale"
                          hint="Affichée par défaut sur la fiche (doit faire partie des variantes)"
                        />
                        <EntitySelect
                          kind="color"
                          value={v.primaryColor}
                          onChange={(val) => patch({ primaryColor: val })}
                          options={colors}
                          onEntityCreated={(e) => onEntityCreated("color", e)}
                          onRequestCreate={onRequestCreate}
                          size="md"
                        />
                      </div>
                      <div>
                        <FieldLabel label="Pays de fabrication" required />
                        <EntitySelect
                          kind="country"
                          value={v.manufacturingCountry}
                          onChange={(val) => patch({ manufacturingCountry: val })}
                          options={countries}
                          onEntityCreated={(e) => onEntityCreated("country", e)}
                          onRequestCreate={onRequestCreate}
                          size="md"
                        />
                      </div>
                      <div>
                        <FieldLabel label="Saison" required />
                        <EntitySelect
                          kind="season"
                          value={v.season}
                          onChange={(val) => patch({ season: val })}
                          options={seasons}
                          onEntityCreated={(e) => onEntityCreated("season", e)}
                          onRequestCreate={onRequestCreate}
                          size="md"
                        />
                      </div>
                      <div>
                        <FieldLabel label="Code SH (douane)" hint="Code à 6-10 chiffres" />
                        <CustomSelect
                          value={v.hsCode}
                          onChange={(val) => patch({ hsCode: val || undefined })}
                          options={hsCodeOptions}
                          searchable
                          size="md"
                          placeholder="Choisir un code SH…"
                          emptyMessage="Aucun code SH en base — créez-en depuis Admin > Codes SH."
                        />
                      </div>
                    </div>
                    <div>
                      <FieldLabel
                        label="Détail taille unique"
                        hint="À renseigner uniquement si une variante utilise « Taille unique »"
                      />
                      <TextField
                        value={v.sizeDetailsTu}
                        onChange={(val) => patch({ sizeDetailsTu: val })}
                        placeholder="Ex. : 52-56"
                      />
                    </div>
                  </div>
                </Section>

                {/* ───── Section : Dimensions ─────────────────────────── */}
                <Section title="Dimensions" hint="En centimètres. Laissez vide ce qui ne s'applique pas.">
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                    {[
                      { label: "Longueur", key: "dimensionLength" as const, current: v.dimensionLength },
                      { label: "Largeur", key: "dimensionWidth" as const, current: v.dimensionWidth },
                      { label: "Hauteur", key: "dimensionHeight" as const, current: v.dimensionHeight },
                      { label: "Diamètre", key: "dimensionDiameter" as const, current: v.dimensionDiameter },
                      { label: "Circonférence", key: "dimensionCircumference" as const, current: v.dimensionCircumference },
                    ].map((d) => (
                      <div key={d.key}>
                        <FieldLabel label={d.label} />
                        <NumberField
                          value={d.current}
                          onChange={(val) => patch({ [d.key]: val } as Partial<ProductOverride>)}
                          step={0.1}
                          suffix="cm"
                        />
                      </div>
                    ))}
                  </div>
                </Section>

                {/* ───── Section : Publication ────────────────────────── */}
                <Section title="Publication">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                    <div>
                      <FieldLabel label="Statut" />
                      <CustomSelect
                        value={v.status}
                        onChange={(val) => patch({ status: val as "OFFLINE" | "ONLINE" | "ARCHIVED" })}
                        options={[
                          { value: "OFFLINE", label: "Hors ligne (brouillon)" },
                          { value: "ONLINE", label: "En ligne (publié)" },
                          { value: "ARCHIVED", label: "Archivé" },
                        ]}
                        size="md"
                      />
                    </div>
                    <div>
                      <FieldLabel label="Best Seller" />
                      <BooleanField
                        value={v.isBestSeller}
                        onChange={(val) => patch({ isBestSeller: val })}
                      />
                    </div>
                    <div>
                      <FieldLabel
                        label="Produits similaires"
                        hint="Références séparées par des virgules"
                      />
                      <TextField
                        value={v.similarRefs}
                        onChange={(val) => patch({ similarRefs: val })}
                        placeholder="PRD-002, PRD-003"
                      />
                    </div>
                  </div>
                </Section>
              </div>
            )}

            {activeTab === "variantes" && (
              <div className="space-y-3">
                {product.variants.map((variant, idx) => {
                  const variantErrors = variant.errors;
                  const hasError = variantErrors.length > 0;
                  return (
                    <div
                      key={idx}
                      className={`rounded-xl border ${
                        hasError ? "border-red-200 bg-red-50/30" : "border-border bg-bg-primary"
                      } p-4 shadow-sm`}
                    >
                      <div className="flex items-center justify-between mb-3">
                        <div className="text-sm font-semibold text-text-primary">
                          Variante {idx + 1}
                          <span className="ml-2 text-xs font-normal text-text-secondary">
                            ({String(variantValue(idx, "color", "color") || "?")} · {String(variantValue(idx, "saleType", "saleType") || "UNIT")})
                          </span>
                        </div>
                        {hasError && (
                          <span className="text-xs font-medium text-red-700 bg-red-100 border border-red-200 rounded-full px-2 py-0.5">
                            {variantErrors.length} erreur{variantErrors.length > 1 ? "s" : ""}
                          </span>
                        )}
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        <div className="md:col-span-2 lg:col-span-1">
                          <FieldLabel label="Couleur" required />
                          <EntitySelect
                            kind="color"
                            value={String(variantValue(idx, "color", "color") ?? "")}
                            onChange={(val) => patchVariant(idx, { color: val })}
                            options={colors}
                            onEntityCreated={(e) => onEntityCreated("color", e)}
                            onRequestCreate={onRequestCreate}
                            size="md"
                          />
                        </div>
                        <div>
                          <FieldLabel label="Type de vente" required />
                          <CustomSelect
                            value={String(variantValue(idx, "saleType", "saleType") ?? "UNIT")}
                            onChange={(val) => patchVariant(idx, { saleType: val as "UNIT" | "PACK" })}
                            options={[
                              { value: "UNIT", label: "UNIT (à l'unité)" },
                              { value: "PACK", label: "PACK (en lot)" },
                            ]}
                            size="md"
                          />
                        </div>
                        <div>
                          <FieldLabel
                            label="Taille"
                            required
                            hint="UNIT : « M » · PACK : « S:2,M:3,L:1 »"
                          />
                          <TextField
                            value={String(variantValue(idx, "size", "size") ?? "")}
                            onChange={(val) => patchVariant(idx, { size: val })}
                            placeholder="M"
                          />
                        </div>
                        <div>
                          <FieldLabel label="Prix unitaire" required />
                          <NumberField
                            value={Number(variantValue(idx, "unitPrice", "unitPrice")) || null}
                            onChange={(val) => patchVariant(idx, { unitPrice: val ?? 0 })}
                            step={0.01}
                            min={0}
                            suffix="€"
                          />
                        </div>
                        <div>
                          <FieldLabel label="Stock disponible" required />
                          <NumberField
                            value={Number(variantValue(idx, "stock", "stock")) || null}
                            onChange={(val) => patchVariant(idx, { stock: val ?? 0 })}
                            step={1}
                            min={0}
                          />
                        </div>
                      </div>

                      {hasError && (
                        <div className="mt-3 px-3 py-2 rounded-lg bg-red-100 border border-red-200">
                          <p className="text-sm text-red-800">
                            <span aria-hidden className="mr-1">⚠</span>
                            {variantErrors.join(" · ")}
                          </p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// Petits composants internes
// ─────────────────────────────────────────────

function TabButton({
  active,
  label,
  count,
  onClick,
}: { active: boolean; label: string; count: number; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
        active
          ? "text-text-primary border-bg-dark"
          : "text-text-secondary border-transparent hover:text-text-primary"
      }`}
    >
      {label}
      {count > 0 && (
        <span className="ml-2 inline-flex items-center justify-center min-w-[18px] h-[18px] text-[10px] font-bold rounded-full bg-red-100 text-red-800 border border-red-200 px-1">
          {count}
        </span>
      )}
    </button>
  );
}

function Section({
  title,
  hint,
  children,
}: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="bg-bg-primary rounded-xl border border-border p-4 sm:p-5">
      <header className="mb-4 pb-3 border-b border-border/60">
        <h4 className="text-base font-semibold text-text-primary">{title}</h4>
        {hint && <p className="text-xs text-text-secondary mt-1">{hint}</p>}
      </header>
      {children}
    </section>
  );
}
