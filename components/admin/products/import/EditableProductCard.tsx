"use client";

import { useState, useMemo } from "react";
import CustomSelect from "@/components/ui/CustomSelect";
import EntitySelect, { type EntityOption, type EntityKind } from "./EntitySelect";
import CompositionEditor from "./CompositionEditor";
import { effectiveProductErrors as computeEffectiveErrors } from "./effective-status";
import type { PreviewProduct, PreviewVariant } from "@/app/api/admin/products/import/preview/route";

/**
 * Carte produit éditable affichée dans le récapitulatif d'import.
 *
 * Toutes les valeurs (fiche produit + chaque variante) sont modifiables.
 * Les listes (catégorie, couleur, pays, saison, composition, sous-catégories)
 * passent par EntitySelect qui permet aussi de créer à la volée.
 *
 * Au moindre changement, on appelle `onChange(reference, override)` — le parent
 * stocke les modifs et les envoie au backend au moment de l'import.
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
  nameEn?: string;
  descriptionEn?: string;
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
  // Listes d'entités pour les dropdowns
  categories: EntityOption[];
  subCategoriesAll: EntityOption[];
  colors: EntityOption[];
  compositions: EntityOption[];
  countries: EntityOption[];
  seasons: EntityOption[];
  onEntityCreated: (kind: "category" | "subcategory" | "color" | "composition" | "country" | "season", entity: EntityOption) => void;
  /** Le parent ouvre un modal de création + mapping PFS/eFashion. */
  onRequestCreate: (kind: EntityKind, suggestedName?: string) => void;
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function getEffective<T>(override: T | undefined, original: T | undefined): T | undefined {
  return override !== undefined ? override : original;
}

// ─────────────────────────────────────────────
// Petits composants d'édition
// ─────────────────────────────────────────────

function FieldLabel({ label, required }: { label: string; required?: boolean }) {
  return (
    <label className="block text-xs font-medium text-text-primary mb-1">
      {label}{required && <span className="text-red-600 ml-0.5">*</span>}
    </label>
  );
}

function TextField({
  value, onChange, placeholder, multiline,
}: { value: string; onChange: (v: string) => void; placeholder?: string; multiline?: boolean }) {
  const cls = "w-full px-2 py-1.5 text-sm border border-border rounded-md bg-bg-primary focus:outline-none focus:ring-1 focus:ring-bg-dark/30";
  if (multiline) {
    return (
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={2}
        className={cls + " resize-y min-h-[60px]"}
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
  value, onChange, placeholder, step = 1, min,
}: { value: number | null | undefined; onChange: (v: number | null) => void; placeholder?: string; step?: number; min?: number }) {
  return (
    <input
      type="number"
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value === "" ? null : parseFloat(e.target.value))}
      placeholder={placeholder}
      step={step}
      min={min}
      className="w-full px-2 py-1.5 text-sm border border-border rounded-md bg-bg-primary focus:outline-none focus:ring-1 focus:ring-bg-dark/30"
    />
  );
}

function BooleanField({
  value, onChange,
}: { value: boolean | undefined; onChange: (v: boolean) => void }) {
  return (
    <CustomSelect
      value={value === true ? "true" : value === false ? "false" : ""}
      onChange={(v) => onChange(v === "true")}
      options={[
        { value: "false", label: "Non" },
        { value: "true", label: "Oui" },
      ]}
      size="sm"
    />
  );
}

// ─────────────────────────────────────────────
// Composant principal
// ─────────────────────────────────────────────

export default function EditableProductCard({
  product,
  override,
  onChange,
  categories,
  subCategoriesAll,
  colors,
  compositions,
  countries,
  seasons,
  onEntityCreated,
  onRequestCreate,
}: Props) {
  const [expanded, setExpanded] = useState(false);

  // Valeur effective = override si défini, sinon donnée d'origine
  const v = useMemo(() => ({
    name: getEffective(override.name, product.name) ?? "",
    description: getEffective(override.description, product.description) ?? "",
    category: getEffective(override.category, product.category) ?? "",
    subCategories: getEffective(override.subCategories, product.subCategories) ?? "",
    tags: getEffective(override.tags, product.tags) ?? "",
    composition: getEffective(override.composition, product.composition) ?? "",
    manufacturingCountry: getEffective(override.manufacturingCountry, product.manufacturingCountry) ?? "",
    season: getEffective(override.season, product.season) ?? "",
    sizeDetailsTu: getEffective(override.sizeDetailsTu, undefined) ?? "",
  }), [override, product]);

  // Erreurs « effectives » : on filtre les erreurs venant du serveur qui sont
  // résolues par les overrides locaux. Ainsi, dès que la cliente tape un
  // détail de taille unique / une catégorie / une description, le message
  // d'erreur disparaît sans attendre une nouvelle analyse serveur.
  const effectiveProductErrors = useMemo(
    () => computeEffectiveErrors(product, override),
    [product, override],
  );

  // Erreurs « effectives » par variante : pour l'instant on garde celles du
  // serveur (pas de logique complexe à filtrer côté client).
  const effectiveVariantErrorsCount = product.variants.reduce((s, va) => s + va.errors.length, 0);
  const effectiveTotalIssues = effectiveProductErrors.length + effectiveVariantErrorsCount;

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

  // ── Statut visuel (vert / orange / rouge) basé sur les erreurs EFFECTIVES
  //    (= erreurs serveur moins celles résolues par les overrides locaux).
  const totalIssues = effectiveTotalIssues;
  const statusColor =
    product.referenceExists ? "border-red-300 bg-red-50/40" :
    totalIssues > 0 ? "border-amber-300 bg-amber-50/40" :
    "border-green-300 bg-green-50/30";

  return (
    <div className={`border rounded-xl ${statusColor} transition-colors`}>
      {/* En-tête repliable */}
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-black/[0.02] transition-colors"
      >
        <span className="text-xs font-mono text-text-primary bg-bg-primary border border-border rounded px-2 py-0.5">
          {product.reference}
        </span>
        <span className="flex-1 font-medium text-text-primary truncate">{v.name || <em className="text-red-600">Nom manquant</em>}</span>
        <span className="text-xs text-[#666] truncate max-w-[200px]">{v.category || "—"}</span>
        <span className="text-xs text-[#666]">
          {product.variants.length} variante{product.variants.length > 1 ? "s" : ""}
        </span>
        {product.referenceExists ? (
          <span className="text-xs text-red-700 font-medium">Existe déjà</span>
        ) : totalIssues > 0 ? (
          <span className="text-xs text-amber-700 font-medium">{totalIssues} à corriger</span>
        ) : (
          <span className="text-xs text-green-700 font-medium">✓ Prêt</span>
        )}
        <span className="text-[#999] text-xs">{expanded ? "▲" : "▼"}</span>
      </button>

      {/* Détail éditable */}
      {expanded && (
        <div className="border-t border-border/60 p-4 space-y-5 bg-bg-primary/50">
          {/* Erreurs au niveau produit — affichage en direct des erreurs
              EFFECTIVES (qui tiennent compte des modifs locales) */}
          {effectiveProductErrors.length > 0 && (
            <div className="p-3 rounded-md bg-red-50 border border-red-200">
              <div className="text-xs font-semibold text-red-700 mb-1">À corriger sur ce produit :</div>
              <ul className="space-y-0.5 text-xs text-red-700 list-disc list-inside">
                {effectiveProductErrors.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            </div>
          )}

          {/* ─── Identité ─── */}
          <section>
            <h4 className="text-xs font-semibold text-text-primary uppercase tracking-wide mb-2">Identité du produit</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <FieldLabel label="Nom" required />
                <TextField value={v.name} onChange={(val) => patch({ name: val })} />
              </div>
              <div>
                <FieldLabel label="Nom (EN)" />
                <TextField value={getEffective(override.nameEn, undefined) ?? ""} onChange={(val) => patch({ nameEn: val })} placeholder="(traduction auto si vide)" />
              </div>
              <div className="md:col-span-2">
                <FieldLabel label="Description" required />
                <TextField value={v.description} onChange={(val) => patch({ description: val })} multiline />
              </div>
              <div className="md:col-span-2">
                <FieldLabel label="Description (EN)" />
                <TextField value={getEffective(override.descriptionEn, undefined) ?? ""} onChange={(val) => patch({ descriptionEn: val })} placeholder="(traduction auto si vide)" multiline />
              </div>
            </div>
          </section>

          {/* ─── Classement ─── */}
          <section>
            <h4 className="text-xs font-semibold text-text-primary uppercase tracking-wide mb-2">Classement</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <FieldLabel label="Catégorie" required />
                <EntitySelect
                  kind="category"
                  value={v.category}
                  onChange={(val) => patch({ category: val })}
                  options={categories}
                  onEntityCreated={(e) => onEntityCreated("category", e)}
                  onRequestCreate={onRequestCreate}
                />
              </div>
              <div>
                <FieldLabel label="Sous-catégories (virgules)" />
                <TextField
                  value={v.subCategories}
                  onChange={(val) => patch({ subCategories: val })}
                  placeholder="Sautoir,Fin"
                />
              </div>
              <div className="md:col-span-2">
                <FieldLabel label="Tags (virgules)" />
                <TextField value={v.tags} onChange={(val) => patch({ tags: val })} placeholder="étoile,fin" />
              </div>
            </div>
          </section>

          {/* ─── Caractéristiques ─── */}
          <section>
            <h4 className="text-xs font-semibold text-text-primary uppercase tracking-wide mb-2">Caractéristiques</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <FieldLabel label="Composition" required />
                <CompositionEditor
                  value={v.composition}
                  onChange={(val) => patch({ composition: val })}
                  options={compositions}
                  onRequestCreate={onRequestCreate}
                />
              </div>
              <div>
                <FieldLabel label="Couleur principale" />
                <EntitySelect
                  kind="color"
                  value={getEffective(override.primaryColor, undefined) ?? ""}
                  onChange={(val) => patch({ primaryColor: val })}
                  options={colors}
                  onEntityCreated={(e) => onEntityCreated("color", e)}
                  onRequestCreate={onRequestCreate}
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
                />
              </div>
              <div>
                <FieldLabel label="Code SH" />
                <TextField value={getEffective(override.hsCode, undefined) ?? ""} onChange={(val) => patch({ hsCode: val })} placeholder="71171900" />
              </div>
              <div>
                <FieldLabel label="Détail taille unique" />
                <TextField value={getEffective(override.sizeDetailsTu, undefined) ?? ""} onChange={(val) => patch({ sizeDetailsTu: val })} placeholder="52-56" />
              </div>
            </div>
          </section>

          {/* ─── Dimensions ─── */}
          <section>
            <h4 className="text-xs font-semibold text-text-primary uppercase tracking-wide mb-2">Dimensions (cm)</h4>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <div>
                <FieldLabel label="Longueur" />
                <NumberField value={getEffective(override.dimensionLength, null)} onChange={(val) => patch({ dimensionLength: val })} step={0.1} />
              </div>
              <div>
                <FieldLabel label="Largeur" />
                <NumberField value={getEffective(override.dimensionWidth, null)} onChange={(val) => patch({ dimensionWidth: val })} step={0.1} />
              </div>
              <div>
                <FieldLabel label="Hauteur" />
                <NumberField value={getEffective(override.dimensionHeight, null)} onChange={(val) => patch({ dimensionHeight: val })} step={0.1} />
              </div>
              <div>
                <FieldLabel label="Diamètre" />
                <NumberField value={getEffective(override.dimensionDiameter, null)} onChange={(val) => patch({ dimensionDiameter: val })} step={0.1} />
              </div>
              <div>
                <FieldLabel label="Circonférence" />
                <NumberField value={getEffective(override.dimensionCircumference, null)} onChange={(val) => patch({ dimensionCircumference: val })} step={0.1} />
              </div>
            </div>
          </section>

          {/* ─── Publication ─── */}
          <section>
            <h4 className="text-xs font-semibold text-text-primary uppercase tracking-wide mb-2">Publication</h4>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <FieldLabel label="Statut" />
                <CustomSelect
                  value={getEffective(override.status, undefined) ?? "OFFLINE"}
                  onChange={(val) => patch({ status: val as "OFFLINE" | "ONLINE" | "ARCHIVED" })}
                  options={[
                    { value: "OFFLINE", label: "Hors ligne (brouillon)" },
                    { value: "ONLINE", label: "En ligne (publié)" },
                    { value: "ARCHIVED", label: "Archivé" },
                  ]}
                  size="sm"
                />
              </div>
              <div>
                <FieldLabel label="Best Seller" />
                <BooleanField value={getEffective(override.isBestSeller, undefined)} onChange={(val) => patch({ isBestSeller: val })} />
              </div>
              <div>
                <FieldLabel label="Réf. similaires (virgules)" />
                <TextField value={getEffective(override.similarRefs, undefined) ?? ""} onChange={(val) => patch({ similarRefs: val })} placeholder="PRD-002,PRD-003" />
              </div>
            </div>
          </section>

          {/* ─── Variantes ─── */}
          <section>
            <h4 className="text-xs font-semibold text-text-primary uppercase tracking-wide mb-2">
              Variantes ({product.variants.length})
            </h4>
            <div className="space-y-2">
              {product.variants.map((variant, idx) => {
                const variantErrors = variant.errors;
                return (
                  <div key={idx} className={`p-3 rounded-md border ${variantErrors.length > 0 ? "bg-red-50/50 border-red-200" : "bg-bg-primary border-border"}`}>
                    <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
                      <div className="md:col-span-2">
                        <FieldLabel label="Couleur" required />
                        <EntitySelect
                          kind="color"
                          value={String(variantValue(idx, "color", "color") ?? "")}
                          onChange={(val) => patchVariant(idx, { color: val })}
                          options={colors}
                          onEntityCreated={(e) => onEntityCreated("color", e)}
                  onRequestCreate={onRequestCreate}
                        />
                      </div>
                      <div>
                        <FieldLabel label="Type" required />
                        <CustomSelect
                          value={String(variantValue(idx, "saleType", "saleType") ?? "UNIT")}
                          onChange={(val) => patchVariant(idx, { saleType: val as "UNIT" | "PACK" })}
                          options={[
                            { value: "UNIT", label: "UNIT (unité)" },
                            { value: "PACK", label: "PACK (lot)" },
                          ]}
                          size="sm"
                        />
                      </div>
                      <div>
                        <FieldLabel label="Taille" required />
                        <TextField
                          value={String(variantValue(idx, "size", "size") ?? "")}
                          onChange={(val) => patchVariant(idx, { size: val })}
                          placeholder="M ou S:2,M:3,L:1"
                        />
                      </div>
                      <div>
                        <FieldLabel label="Prix unitaire (€)" required />
                        <NumberField
                          value={Number(variantValue(idx, "unitPrice", "unitPrice")) || null}
                          onChange={(val) => patchVariant(idx, { unitPrice: val ?? 0 })}
                          step={0.01}
                          min={0}
                        />
                      </div>
                      <div>
                        <FieldLabel label="Stock" required />
                        <NumberField
                          value={Number(variantValue(idx, "stock", "stock")) || null}
                          onChange={(val) => patchVariant(idx, { stock: val ?? 0 })}
                          step={1}
                          min={0}
                        />
                      </div>
                    </div>
                    {variantErrors.length > 0 && (
                      <p className="mt-2 text-xs text-red-700">
                        ⚠ {variantErrors.join(" · ")}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
