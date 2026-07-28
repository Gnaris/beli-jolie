"use client";

/**
 * Section « Mapping Marketplaces » — bloc unique qui remplace les anciennes
 * PfsMappingSection + EfashionMappingSection.
 *
 * 4 sous-sections empilées (PFS / Ankorstore / eFashion / Faire). Pour chaque
 * couleur unique du produit, chaque sous-section affiche :
 *   - Badge de liaison à droite du nom (ID variante marketplace + palette
 *     colorée marque du marketplace, ou pastille grise « Non lié »)
 *   - Mapping principal (Color.pfsColorRef / Color.efashionColorId / Color.name)
 *   - Mapping secondaire (dropdown pour PFS/eFa, input texte pour Ankor/Faire)
 *
 * Un override s'applique à toutes les variantes/lignes de pack utilisant la
 * couleur (propagation en cascade via onChangeOverrideForTargets*).
 */

import { useMemo } from "react";
import CustomSelect from "@/components/ui/CustomSelect";
import ColorSwatch from "@/components/ui/ColorSwatch";
import type {
  AvailableColor,
  PfsColorOption,
  VariantState,
} from "./ColorVariantManager";
import {
  detectPfsColorConflicts,
  effectivePfsColorRef,
  type VariantColorRefInput,
} from "@/lib/pfs-color-conflicts";
import {
  detectEfashionColorConflicts,
  effectiveEfashionColorId,
  type EfashionVariantColorRefInput,
} from "@/lib/efashion-color-conflicts";

type Target = { variantTempId: string; packLineTempId?: string };

/** Option de couleur eFashion pour le sélecteur de mapping secondaire. */
export interface EfashionColorOption {
  /** ID entier eFashion (ex: 78, 22). */
  id: number;
  /** Libellé humain (ex: "Doré"). */
  label: string;
}

interface Props {
  variants: VariantState[];
  availableColors: AvailableColor[];
  hasPfsConfig: boolean;
  hasAnkorstoreConfig: boolean;
  hasEfashionConfig: boolean;
  hasFaireConfig: boolean;
  pfsColorOptions: PfsColorOption[];
  efashionColorOptions: EfashionColorOption[];
  onChangePfsOverride: (targets: Target[], override: string | null) => void;
  onChangeEfashionOverride: (targets: Target[], override: number | null) => void;
  onChangeAnkorsOverride: (targets: Target[], override: string | null) => void;
  onChangeFaireOverride: (targets: Target[], override: string | null) => void;
}

// ─────────────────────────────────────────────
// Helpers de regroupement (dédup par nom de couleur)
// ─────────────────────────────────────────────

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

interface ColorRowBase {
  groupKey: string;
  colorName: string;
  colorHex: string;
  hasNameCollision: boolean;
  targets: Target[];
}

/**
 * Génère une ligne par couleur unique du produit (agrège variantes racine +
 * lignes de pack + doublons de bibliothèque). Chaque appelant enrichit ensuite
 * la ligne avec ses champs marketplace-spécifiques.
 */
function buildRows<T extends ColorRowBase>(
  variants: VariantState[],
  availableColors: AvailableColor[],
  enrich: (input: {
    colorId: string;
    availableColor: AvailableColor | undefined;
    variant: VariantState;
    packLineTempId?: string;
  }) => Omit<T, keyof ColorRowBase>,
  mergeExisting: (existing: T, next: Omit<T, keyof ColorRowBase>) => void,
): T[] {
  const byName = new Map<string, T & { colorIdsSeen: Set<string> }>();

  const upsert = (input: {
    colorId: string;
    colorName: string;
    colorHex: string;
    target: Target;
    extra: Omit<T, keyof ColorRowBase>;
  }) => {
    const key = normalizeName(input.colorName);
    const existing = byName.get(key);
    if (existing) {
      mergeExisting(existing as unknown as T, input.extra);
      existing.colorIdsSeen.add(input.colorId);
      existing.hasNameCollision = existing.colorIdsSeen.size > 1;
      existing.targets.push(input.target);
      return;
    }
    byName.set(key, {
      groupKey: key,
      colorName: input.colorName,
      colorHex: input.colorHex,
      hasNameCollision: false,
      colorIdsSeen: new Set([input.colorId]),
      targets: [input.target],
      ...(input.extra as object),
    } as T & { colorIdsSeen: Set<string> });
  };

  for (const v of variants) {
    if (v.colorId) {
      const ac = availableColors.find((c) => c.id === v.colorId);
      upsert({
        colorId: v.colorId,
        colorName: v.colorName || ac?.name || "Couleur sans nom",
        colorHex: v.colorHex || ac?.hex || "#9CA3AF",
        target: { variantTempId: v.tempId },
        extra: enrich({ colorId: v.colorId, availableColor: ac, variant: v }),
      });
    }
    if (v.saleType === "PACK" && v.packLines.length > 0) {
      for (const pl of v.packLines) {
        if (!pl.colorId) continue;
        const ac = availableColors.find((c) => c.id === pl.colorId);
        upsert({
          colorId: pl.colorId,
          colorName: pl.colorName || ac?.name || "Couleur sans nom",
          colorHex: pl.colorHex || ac?.hex || "#9CA3AF",
          target: { variantTempId: v.tempId, packLineTempId: pl.tempId },
          extra: enrich({
            colorId: pl.colorId,
            availableColor: ac,
            variant: v,
            packLineTempId: pl.tempId,
          }),
        });
      }
    }
  }

  return Array.from(byName.values()).map(({ colorIdsSeen: _ignored, ...row }) => row as unknown as T);
}

// ─────────────────────────────────────────────
// Palettes de marque marketplace (figées, cf. CLAUDE.md)
// ─────────────────────────────────────────────

const MARKETPLACE_STYLE = {
  pfs: {
    grad: "linear-gradient(135deg,#4f46e5,#6366f1)",
    label: "PFS",
    subHeaderCls: "bg-indigo-50/40 border-indigo-500",
    counterCls: "text-indigo-700 bg-indigo-100",
    softCls: "text-indigo-700 bg-indigo-50 border border-indigo-200",
  },
  ankor: {
    grad: "linear-gradient(135deg,#0ea5e9,#38bdf8)",
    label: "Ankor",
    subHeaderCls: "bg-sky-50/40 border-sky-500",
    counterCls: "text-sky-700 bg-sky-100",
    softCls: "text-sky-700 bg-sky-50 border border-sky-200",
  },
  efashion: {
    grad: "linear-gradient(135deg,#db2777,#ec4899)",
    label: "eFa",
    subHeaderCls: "bg-rose-50/40 border-rose-500",
    counterCls: "text-rose-700 bg-rose-100",
    softCls: "text-rose-700 bg-rose-50 border border-rose-200",
  },
  faire: {
    grad: "linear-gradient(135deg,#f59e0b,#fbbf24)",
    label: "Faire",
    subHeaderCls: "bg-amber-50/40 border-amber-500",
    counterCls: "text-amber-700 bg-amber-100",
    softCls: "text-amber-700 bg-amber-50 border border-amber-200",
  },
} as const;

// ─────────────────────────────────────────────
// Sub-composants
// ─────────────────────────────────────────────

/**
 * Cellule « Variante marketplace » : badge coloré aux couleurs de marque du
 * marketplace, contenant l'ID de la variante (si liée) + le nom de la couleur
 * tel qu'envoyé à la marketplace (nom effectif principal ou secondaire).
 *
 * - Liée → dégradé plein, blanc, icône chaîne
 * - Non liée → même palette mais version soft (fond pastel, texte accent)
 *   avec icône chaîne cassée. On affiche quand même le nom marketplace prévu
 *   pour donner l'aperçu de ce qui sera envoyé au moment de la publication.
 */
function MarketplaceVariantCell({
  linked,
  variantId,
  marketplaceColorLabel,
  marketplace,
}: {
  linked: boolean;
  variantId: string | null;
  marketplaceColorLabel: string | null;
  marketplace: keyof typeof MARKETPLACE_STYLE;
}) {
  const style = MARKETPLACE_STYLE[marketplace];
  const hasColorLabel = !!(marketplaceColorLabel && marketplaceColorLabel.trim().length > 0);
  if (linked && variantId) {
    return (
      <span
        className="inline-flex items-center gap-1.5 text-[12px] font-semibold rounded-md px-2.5 py-1 text-white font-body max-w-full"
        style={{ background: style.grad }}
        title={`Variante liée à ${style.label} (id ${variantId})${hasColorLabel ? ` — couleur : ${marketplaceColorLabel}` : ""}`}
      >
        <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
          />
        </svg>
        <span className="truncate">
          {variantId}
          {hasColorLabel && <span className="opacity-90"> · {marketplaceColorLabel}</span>}
        </span>
      </span>
    );
  }
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-[12px] font-medium rounded-md px-2.5 py-1 font-body max-w-full ${style.softCls}`}
      title={`Variante pas encore publiée sur ${style.label}${hasColorLabel ? ` — sera envoyée sous le nom « ${marketplaceColorLabel} »` : ""}`}
    >
      <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244"
        />
      </svg>
      <span className="truncate">
        Non lié{hasColorLabel && <span className="opacity-80"> · {marketplaceColorLabel}</span>}
      </span>
    </span>
  );
}

function SubHeader({
  marketplace,
  title,
  hint,
  linkedCount,
  totalCount,
}: {
  marketplace: keyof typeof MARKETPLACE_STYLE;
  title: string;
  hint: string;
  linkedCount: number;
  totalCount: number;
}) {
  const style = MARKETPLACE_STYLE[marketplace];
  return (
    <div
      className={`px-4 sm:px-6 py-4 border-l-4 flex items-center gap-3 flex-wrap ${style.subHeaderCls}`}
    >
      <div
        className="w-8 h-8 rounded-lg flex items-center justify-center text-white font-heading font-bold text-sm shrink-0"
        style={{ background: style.grad }}
      >
        {style.label.charAt(0)}
      </div>
      <div className="flex-1 min-w-0">
        <h3 className="font-heading text-[15px] font-semibold text-text-primary">{title}</h3>
        <p className="text-[11px] text-text-secondary font-body">{hint}</p>
      </div>
      <span
        className={`text-[11px] font-semibold rounded-full px-3 py-1 font-body shrink-0 ${style.counterCls}`}
      >
        {linkedCount} / {totalCount} variante{totalCount > 1 ? "s" : ""} liée{linkedCount > 1 ? "s" : ""}
      </span>
    </div>
  );
}

function TableHeader({ label3rdCol }: { label3rdCol: string }) {
  return (
    <div className="grid grid-cols-12 gap-2 bg-bg-secondary px-4 sm:px-6 py-2 text-[11px] uppercase tracking-wider font-semibold text-text-muted font-body border-b border-border">
      <div className="col-span-3">Variante (couleur BJ)</div>
      <div className="col-span-3">Variante marketplace</div>
      <div className="col-span-2">Mapping principal</div>
      <div className="col-span-4">{label3rdCol}</div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Sub-section PFS
// ─────────────────────────────────────────────

interface PfsRow extends ColorRowBase {
  principalRef: string | null;
  overrideRef: string | null;
  isLinked: boolean;
  variantId: string | null;
}

function PfsSubSection({
  variants,
  availableColors,
  pfsColorOptions,
  onChangeOverride,
}: {
  variants: VariantState[];
  availableColors: AvailableColor[];
  pfsColorOptions: PfsColorOption[];
  onChangeOverride: (targets: Target[], override: string | null) => void;
}) {
  const rows = useMemo<PfsRow[]>(
    () =>
      buildRows<PfsRow>(
        variants,
        availableColors,
        ({ availableColor, variant, packLineTempId }) => {
          if (packLineTempId) {
            const pl = variant.packLines.find((p) => p.tempId === packLineTempId);
            return {
              principalRef: availableColor?.pfsColorRef ?? null,
              overrideRef: pl?.pfsColorRefOverride ?? null,
              isLinked: !!variant.pfsVariantId,
              variantId: variant.pfsVariantId ?? null,
            };
          }
          return {
            principalRef: availableColor?.pfsColorRef ?? null,
            overrideRef: variant.pfsColorRefOverride ?? null,
            isLinked: !!variant.pfsVariantId,
            variantId: variant.pfsVariantId ?? null,
          };
        },
        (existing, next) => {
          if (!existing.overrideRef && next.overrideRef) existing.overrideRef = next.overrideRef;
          if (!existing.isLinked && next.isLinked) {
            existing.isLinked = true;
            existing.variantId = next.variantId;
          }
        },
      ),
    [variants, availableColors],
  );

  const conflicts = useMemo(() => {
    const items: VariantColorRefInput[] = rows.map((r) => ({
      key: r.groupKey,
      colorId: r.groupKey,
      label: r.colorName,
      principalRef: r.principalRef,
      overrideRef: r.overrideRef,
    }));
    return detectPfsColorConflicts(items);
  }, [rows]);

  const groupKeysInConflict = useMemo(() => {
    const s = new Set<string>();
    for (const c of conflicts) for (const v of c.variants) if (v.colorId) s.add(v.colorId);
    return s;
  }, [conflicts]);

  const linkedCount = rows.filter((r) => r.isLinked).length;

  return (
    <section className="border-b border-border">
      <SubHeader
        marketplace="pfs"
        title="Paris Fashion Shop"
        hint="Mapping principal = couleur PFS de la biblio · Secondaire = autre couleur PFS pour cette variante"
        linkedCount={linkedCount}
        totalCount={rows.length}
      />

      {conflicts.length > 0 && (
        <div className="mx-4 sm:mx-6 mt-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3">
          <p className="text-[13px] font-semibold text-amber-800 font-body mb-1.5">
            ⚠ Conflit{conflicts.length > 1 ? "s" : ""} de mapping PFS
          </p>
          <ul className="text-xs text-amber-800 font-body space-y-1">
            {conflicts.map((c, i) => (
              <li key={i}>
                {c.variants.map((v) => `« ${v.label} »`).join(" et ")} pointent toutes sur{" "}
                <span className="font-semibold">{c.effectiveRef}</span>.
              </li>
            ))}
          </ul>
        </div>
      )}

      <TableHeader label3rdCol="Mapping secondaire (facultatif)" />
      <div className="divide-y divide-border">
        {rows.map((r) => {
          const inConflict = groupKeysInConflict.has(r.groupKey);
          const effective = effectivePfsColorRef({
            principalRef: r.principalRef,
            overrideRef: r.overrideRef,
          });
          const selectOptions = [
            { value: "", label: "— (utiliser le mapping principal)" },
            ...pfsColorOptions
              .filter((o) => o.ref !== r.principalRef)
              .map((o) => ({
                value: o.ref,
                label: o.label ? `${o.label} (${o.ref})` : o.ref,
              })),
          ];
          // Nom couleur PFS effectif : on affiche toujours (même identique BJ).
          // Priorité : label de l'override → label du principal → ref brute.
          const effectiveRefForLabel = effective ?? r.principalRef;
          const effectiveOpt = effectiveRefForLabel
            ? pfsColorOptions.find((o) => o.ref === effectiveRefForLabel)
            : null;
          const marketplaceColorLabel = effectiveRefForLabel
            ? (effectiveOpt?.label ? `${effectiveOpt.label} (${effectiveRefForLabel})` : effectiveRefForLabel)
            : null;
          return (
            <div
              key={r.groupKey}
              className={`grid grid-cols-12 gap-2 items-center px-4 sm:px-6 py-3 ${inConflict ? "bg-amber-50/60" : ""}`}
            >
              <div className="col-span-3 flex items-center gap-2 min-w-0 flex-wrap">
                <ColorSwatch hex={r.colorHex} size={20} rounded="full" border />
                <span className="text-[13px] font-body text-text-primary truncate">
                  {r.colorName}
                </span>
                {r.hasNameCollision && (
                  <span
                    className="text-[10px] text-amber-700 bg-amber-100 rounded px-1.5 py-0.5 font-body"
                    title="Plusieurs fiches couleur portent ce nom dans la bibliothèque."
                  >
                    Doublons biblio
                  </span>
                )}
              </div>
              <div className="col-span-3 min-w-0">
                <MarketplaceVariantCell
                  linked={r.isLinked}
                  variantId={r.variantId}
                  marketplaceColorLabel={marketplaceColorLabel}
                  marketplace="pfs"
                />
              </div>
              <div className="col-span-2 text-[12px] font-body text-text-secondary truncate">
                {r.principalRef ? r.principalRef : <span className="text-text-muted italic">Non défini</span>}
              </div>
              <div className="col-span-4">
                {pfsColorOptions.length === 0 ? (
                  <span className="text-[11px] text-text-muted font-body italic">
                    Couleurs PFS indisponibles
                  </span>
                ) : (
                  <CustomSelect
                    value={r.overrideRef ?? ""}
                    onChange={(v) => onChangeOverride(r.targets, v ? v : null)}
                    options={selectOptions}
                    placeholder="— (utiliser le mapping principal)"
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────
// Sub-section eFashion
// ─────────────────────────────────────────────

interface EfashionRow extends ColorRowBase {
  principalId: number | null;
  overrideId: number | null;
  isLinked: boolean;
  variantId: number | null;
}

function labelOfEfaId(id: number | null, options: EfashionColorOption[]): string {
  if (id == null) return "—";
  const opt = options.find((o) => o.id === id);
  return opt?.label ? `${opt.label} (id ${id})` : `id ${id}`;
}

function EfashionSubSection({
  variants,
  availableColors,
  efashionColorOptions,
  onChangeOverride,
}: {
  variants: VariantState[];
  availableColors: AvailableColor[];
  efashionColorOptions: EfashionColorOption[];
  onChangeOverride: (targets: Target[], override: number | null) => void;
}) {
  const rows = useMemo<EfashionRow[]>(
    () =>
      buildRows<EfashionRow>(
        variants,
        availableColors,
        ({ availableColor, variant, packLineTempId }) => {
          if (packLineTempId) {
            const pl = variant.packLines.find((p) => p.tempId === packLineTempId);
            return {
              principalId: availableColor?.efashionColorId ?? null,
              overrideId: pl?.efashionColorIdOverride ?? null,
              isLinked: variant.efashionProductId != null,
              variantId: variant.efashionProductId ?? null,
            };
          }
          return {
            principalId: availableColor?.efashionColorId ?? null,
            overrideId: variant.efashionColorIdOverride ?? null,
            isLinked: variant.efashionProductId != null,
            variantId: variant.efashionProductId ?? null,
          };
        },
        (existing, next) => {
          if (existing.overrideId == null && next.overrideId != null) existing.overrideId = next.overrideId;
          if (!existing.isLinked && next.isLinked) {
            existing.isLinked = true;
            existing.variantId = next.variantId;
          }
        },
      ),
    [variants, availableColors],
  );

  const conflicts = useMemo(() => {
    const items: EfashionVariantColorRefInput[] = rows.map((r) => ({
      key: r.groupKey,
      colorId: r.groupKey,
      label: r.colorName,
      principalId: r.principalId,
      overrideId: r.overrideId,
    }));
    return detectEfashionColorConflicts(items);
  }, [rows]);

  const groupKeysInConflict = useMemo(() => {
    const s = new Set<string>();
    for (const c of conflicts) for (const v of c.variants) if (v.colorId) s.add(v.colorId);
    return s;
  }, [conflicts]);

  const linkedCount = rows.filter((r) => r.isLinked).length;

  return (
    <section className="border-b border-border">
      <SubHeader
        marketplace="efashion"
        title="eFashion Paris"
        hint="Mapping principal = couleur eFa de la biblio · Secondaire = autre couleur eFa pour cette variante"
        linkedCount={linkedCount}
        totalCount={rows.length}
      />

      {conflicts.length > 0 && (
        <div className="mx-4 sm:mx-6 mt-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3">
          <p className="text-[13px] font-semibold text-amber-800 font-body mb-1.5">
            ⚠ Conflit{conflicts.length > 1 ? "s" : ""} de mapping eFashion
          </p>
          <ul className="text-xs text-amber-800 font-body space-y-1">
            {conflicts.map((c, i) => (
              <li key={i}>
                {c.variants.map((v) => `« ${v.label} »`).join(" et ")} pointent toutes sur{" "}
                <span className="font-semibold">id {c.effectiveId}</span>.
              </li>
            ))}
          </ul>
        </div>
      )}

      <TableHeader label3rdCol="Mapping secondaire (facultatif)" />
      <div className="divide-y divide-border">
        {rows.map((r) => {
          const inConflict = groupKeysInConflict.has(r.groupKey);
          const effective = effectiveEfashionColorId({
            principalId: r.principalId,
            overrideId: r.overrideId,
          });
          const selectOptions = [
            { value: "", label: "— (utiliser le mapping principal)" },
            ...efashionColorOptions
              .filter((o) => o.id !== r.principalId)
              .map((o) => ({ value: String(o.id), label: `${o.label} (id ${o.id})` })),
          ];
          const effectiveIdForLabel = effective ?? r.principalId;
          const marketplaceColorLabel =
            effectiveIdForLabel != null ? labelOfEfaId(effectiveIdForLabel, efashionColorOptions) : null;
          return (
            <div
              key={r.groupKey}
              className={`grid grid-cols-12 gap-2 items-center px-4 sm:px-6 py-3 ${inConflict ? "bg-amber-50/60" : ""}`}
            >
              <div className="col-span-3 flex items-center gap-2 min-w-0 flex-wrap">
                <ColorSwatch hex={r.colorHex} size={20} rounded="full" border />
                <span className="text-[13px] font-body text-text-primary truncate">
                  {r.colorName}
                </span>
                {r.hasNameCollision && (
                  <span
                    className="text-[10px] text-amber-700 bg-amber-100 rounded px-1.5 py-0.5 font-body"
                    title="Plusieurs fiches couleur portent ce nom dans la bibliothèque."
                  >
                    Doublons biblio
                  </span>
                )}
              </div>
              <div className="col-span-3 min-w-0">
                <MarketplaceVariantCell
                  linked={r.isLinked}
                  variantId={r.variantId != null ? `#${r.variantId}` : null}
                  marketplaceColorLabel={marketplaceColorLabel}
                  marketplace="efashion"
                />
              </div>
              <div className="col-span-2 text-[12px] font-body text-text-secondary truncate">
                {r.principalId != null ? (
                  labelOfEfaId(r.principalId, efashionColorOptions)
                ) : (
                  <span className="text-text-muted italic">Non défini</span>
                )}
              </div>
              <div className="col-span-4">
                {efashionColorOptions.length === 0 ? (
                  <span className="text-[11px] text-text-muted font-body italic">
                    Couleurs eFashion indisponibles
                  </span>
                ) : (
                  <CustomSelect
                    value={r.overrideId != null ? String(r.overrideId) : ""}
                    onChange={(v) => {
                      const next = v ? Number(v) : null;
                      onChangeOverride(r.targets, next != null && Number.isFinite(next) ? next : null);
                    }}
                    options={selectOptions}
                    placeholder="— (utiliser le mapping principal)"
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────
// Sub-section Ankor / Faire (texte libre)
// ─────────────────────────────────────────────

interface FreeTextRow extends ColorRowBase {
  overrideName: string | null;
  isLinked: boolean;
  variantId: string | null;
}

function FreeTextSubSection({
  marketplace,
  title,
  hint,
  variants,
  availableColors,
  onChangeOverride,
  extractVariantId,
  extractOverride,
  extractPackLineOverride,
  border,
}: {
  marketplace: "ankor" | "faire";
  title: string;
  hint: string;
  variants: VariantState[];
  availableColors: AvailableColor[];
  onChangeOverride: (targets: Target[], override: string | null) => void;
  extractVariantId: (v: VariantState) => string | null;
  extractOverride: (v: VariantState) => string | null | undefined;
  extractPackLineOverride: (v: VariantState, packLineTempId: string) => string | null | undefined;
  border: boolean;
}) {
  const rows = useMemo<FreeTextRow[]>(
    () =>
      buildRows<FreeTextRow>(
        variants,
        availableColors,
        ({ variant, packLineTempId }) => {
          const vid = extractVariantId(variant);
          if (packLineTempId) {
            return {
              overrideName: extractPackLineOverride(variant, packLineTempId) ?? null,
              isLinked: !!vid,
              variantId: vid,
            };
          }
          return {
            overrideName: extractOverride(variant) ?? null,
            isLinked: !!vid,
            variantId: vid,
          };
        },
        (existing, next) => {
          if (!existing.overrideName && next.overrideName) existing.overrideName = next.overrideName;
          if (!existing.isLinked && next.isLinked) {
            existing.isLinked = true;
            existing.variantId = next.variantId;
          }
        },
      ),
    [variants, availableColors, extractVariantId, extractOverride, extractPackLineOverride],
  );

  const linkedCount = rows.filter((r) => r.isLinked).length;

  return (
    <section className={border ? "border-b border-border" : ""}>
      <SubHeader
        marketplace={marketplace}
        title={title}
        hint={hint}
        linkedCount={linkedCount}
        totalCount={rows.length}
      />
      <TableHeader label3rdCol="Nom secondaire (facultatif)" />
      <div className="divide-y divide-border">
        {rows.map((r) => {
          const effective = (r.overrideName?.trim() || r.colorName).trim();
          return (
            <div key={r.groupKey} className="grid grid-cols-12 gap-2 items-center px-4 sm:px-6 py-3">
              <div className="col-span-3 flex items-center gap-2 min-w-0 flex-wrap">
                <ColorSwatch hex={r.colorHex} size={20} rounded="full" border />
                <span className="text-[13px] font-body text-text-primary truncate">
                  {r.colorName}
                </span>
                {r.hasNameCollision && (
                  <span
                    className="text-[10px] text-amber-700 bg-amber-100 rounded px-1.5 py-0.5 font-body"
                    title="Plusieurs fiches couleur portent ce nom dans la bibliothèque."
                  >
                    Doublons biblio
                  </span>
                )}
              </div>
              <div className="col-span-3 min-w-0">
                <MarketplaceVariantCell
                  linked={r.isLinked}
                  variantId={r.variantId}
                  marketplaceColorLabel={effective}
                  marketplace={marketplace}
                />
              </div>
              <div className="col-span-2 text-[12px] font-body text-text-secondary truncate">
                {r.colorName}
              </div>
              <div className="col-span-4">
                <input
                  type="text"
                  value={r.overrideName ?? ""}
                  onChange={(e) => {
                    const raw = e.target.value;
                    const trimmed = raw.trim();
                    onChangeOverride(r.targets, trimmed.length > 0 ? raw : null);
                  }}
                  placeholder={`ex: ${r.colorName === "Doré" ? "Or" : "Autre nom"} (laisser vide = « ${r.colorName} »)`}
                  className="w-full text-[13px] font-body border border-border rounded-lg px-3 py-2 bg-bg-primary text-text-primary placeholder:text-text-muted focus:border-border-dark focus:outline-none"
                />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────
// Composant principal
// ─────────────────────────────────────────────

export default function MarketplacesMappingSection({
  variants,
  availableColors,
  hasPfsConfig,
  hasAnkorstoreConfig,
  hasEfashionConfig,
  hasFaireConfig,
  pfsColorOptions,
  efashionColorOptions,
  onChangePfsOverride,
  onChangeEfashionOverride,
  onChangeAnkorsOverride,
  onChangeFaireOverride,
}: Props) {
  if (variants.length === 0) return null;

  const enabled = {
    pfs: hasPfsConfig,
    ankor: hasAnkorstoreConfig,
    efashion: hasEfashionConfig,
    faire: hasFaireConfig,
  };
  const enabledCount = Object.values(enabled).filter(Boolean).length;
  if (enabledCount === 0) return null;

  // Ordre stable : PFS → Ankor → eFa → Faire. La dernière visible ne doit pas
  // avoir de border-bottom (border only if it's not the last one shown).
  const order: Array<"pfs" | "ankor" | "efashion" | "faire"> = ["pfs", "ankor", "efashion", "faire"];
  const visibleOrder = order.filter((k) => enabled[k]);
  const isLast = (k: (typeof order)[number]) => visibleOrder[visibleOrder.length - 1] === k;

  return (
    <div className="bg-bg-primary border border-border rounded-2xl shadow-sm overflow-hidden">
      <div className="px-4 sm:px-6 py-5 border-b border-border bg-gradient-to-r from-bg-secondary to-bg-primary">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-bg-dark flex items-center justify-center shrink-0">
            <svg className="w-5 h-5 text-text-inverse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
              />
            </svg>
          </div>
          <div className="min-w-0">
            <h2 className="font-heading text-lg font-bold text-text-primary">Mapping Marketplaces</h2>
            <p className="text-[13px] text-text-secondary font-body">
              Pour chaque marketplace, voyez quelles variantes sont liées et ajustez le mapping secondaire si besoin.
            </p>
          </div>
        </div>
      </div>

      {enabled.pfs && (
        <div className={isLast("pfs") ? "" : "border-b border-border"}>
          <PfsSubSection
            variants={variants}
            availableColors={availableColors}
            pfsColorOptions={pfsColorOptions}
            onChangeOverride={onChangePfsOverride}
          />
        </div>
      )}

      {enabled.ankor && (
        <FreeTextSubSection
          marketplace="ankor"
          title="Ankorstore"
          hint="Envoi par défaut = nom de la couleur BJ · Secondaire = nom libre pour cette variante"
          variants={variants}
          availableColors={availableColors}
          onChangeOverride={onChangeAnkorsOverride}
          extractVariantId={(v) => v.ankorsVariantId ?? null}
          extractOverride={(v) => v.ankorsColorNameOverride}
          extractPackLineOverride={(v, plId) =>
            v.packLines.find((p) => p.tempId === plId)?.ankorsColorNameOverride
          }
          border={!isLast("ankor")}
        />
      )}

      {enabled.efashion && (
        <div className={isLast("efashion") ? "" : "border-b border-border"}>
          <EfashionSubSection
            variants={variants}
            availableColors={availableColors}
            efashionColorOptions={efashionColorOptions}
            onChangeOverride={onChangeEfashionOverride}
          />
        </div>
      )}

      {enabled.faire && (
        <FreeTextSubSection
          marketplace="faire"
          title="Faire"
          hint="Envoi par défaut = nom de la couleur BJ · Secondaire = nom libre pour cette variante"
          variants={variants}
          availableColors={availableColors}
          onChangeOverride={onChangeFaireOverride}
          extractVariantId={(v) => v.faireVariantId ?? null}
          extractOverride={(v) => v.faireColorNameOverride}
          extractPackLineOverride={(v, plId) =>
            v.packLines.find((p) => p.tempId === plId)?.faireColorNameOverride
          }
          border={!isLast("faire")}
        />
      )}
    </div>
  );
}
