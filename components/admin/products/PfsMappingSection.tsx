"use client";

/**
 * Section « Mapping Paris Fashion Shop » du formulaire produit.
 *
 * Affiche **une ligne par couleur unique** du produit (et non par variante).
 * Pour chaque couleur :
 *   - le mapping PFS principal de la couleur (lecture seule, info)
 *   - un sélecteur facultatif de mapping PFS **secondaire** (override propre
 *     à ce produit), qui exclut le principal de la couleur sélectionnée
 *
 * Quand on change le mapping secondaire d'une couleur, il est propagé en
 * cascade à TOUTES les variantes (UNIT/PACK) et lignes de pack qui utilisent
 * cette couleur — il n'y a aucun cas d'usage où deux variantes de la même
 * couleur voudraient des mappings PFS différents.
 *
 * Calcule en temps réel les conflits sur le mapping effectif (override OU
 * principal) : un conflit n'existe qu'entre 2 couleurs DIFFÉRENTES qui
 * pointent sur la même cible PFS. La case « Paris Fashion Shop » de la
 * modale post-save est gérée séparément depuis ProductForm en lisant ces
 * mêmes conflits.
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

interface Props {
  variants: VariantState[];
  availableColors: AvailableColor[];
  pfsColorOptions: PfsColorOption[];
  onChangeVariantOverride: (variantTempId: string, override: string | null) => void;
  onChangePackLineOverride: (
    variantTempId: string,
    packLineTempId: string,
    override: string | null,
  ) => void;
}

/** Une ligne = une couleur unique du produit, avec les pointeurs vers
 * toutes les variantes/lignes de pack à mettre à jour quand l'override change. */
interface ColorRow {
  colorId: string;
  colorName: string;
  colorHex: string;
  principalRef: string | null;
  overrideRef: string | null;
  targets: { variantTempId: string; packLineTempId?: string }[];
}

function principalLabelOf(principalRef: string | null, options: PfsColorOption[]): string {
  if (!principalRef) return "Non défini";
  const opt = options.find((o) => o.ref === principalRef);
  return opt?.label ? `${opt.label} (${principalRef})` : principalRef;
}

export default function PfsMappingSection({
  variants,
  availableColors,
  pfsColorOptions,
  onChangeVariantOverride,
  onChangePackLineOverride,
}: Props) {
  // Build rows : 1 ligne par couleur unique du produit. On agrège les
  // variantes UNIT/PACK + toutes les lignes de pack en groupant par colorId.
  const rows: ColorRow[] = useMemo(() => {
    const byColor = new Map<string, ColorRow>();
    const upsert = (input: {
      colorId: string;
      colorName: string;
      colorHex: string;
      principalRef: string | null;
      overrideRef: string | null;
      target: { variantTempId: string; packLineTempId?: string };
    }) => {
      const existing = byColor.get(input.colorId);
      if (existing) {
        // Si une autre variante portait déjà un override pour cette couleur
        // et que celui-ci est null, on adopte le premier override non-null
        // qu'on rencontre (cohérence d'affichage avant que l'utilisatrice ne
        // re-sélectionne).
        if (!existing.overrideRef && input.overrideRef) {
          existing.overrideRef = input.overrideRef;
        }
        existing.targets.push(input.target);
        return;
      }
      byColor.set(input.colorId, {
        colorId: input.colorId,
        colorName: input.colorName,
        colorHex: input.colorHex,
        principalRef: input.principalRef,
        overrideRef: input.overrideRef,
        targets: [input.target],
      });
    };

    for (const v of variants) {
      if (v.saleType === "PACK" && v.packLines.length > 0) {
        for (const pl of v.packLines) {
          if (!pl.colorId) continue;
          const ac = availableColors.find((c) => c.id === pl.colorId);
          upsert({
            colorId: pl.colorId,
            colorName: pl.colorName || ac?.name || "Couleur sans nom",
            colorHex: pl.colorHex || ac?.hex || "#9CA3AF",
            principalRef: ac?.pfsColorRef ?? null,
            overrideRef: pl.pfsColorRefOverride ?? null,
            target: { variantTempId: v.tempId, packLineTempId: pl.tempId },
          });
        }
        continue;
      }
      if (!v.colorId) continue;
      const ac = availableColors.find((c) => c.id === v.colorId);
      upsert({
        colorId: v.colorId,
        colorName: v.colorName || ac?.name || "Couleur sans nom",
        colorHex: v.colorHex || ac?.hex || "#9CA3AF",
        principalRef: ac?.pfsColorRef ?? null,
        overrideRef: v.pfsColorRefOverride ?? null,
        target: { variantTempId: v.tempId },
      });
    }
    return Array.from(byColor.values());
  }, [variants, availableColors]);

  // Conflits sur le mapping effectif. Comme les rows sont déjà uniques par
  // couleur, le helper ne dédupliquera rien de plus côté UI.
  const conflicts = useMemo(() => {
    const items: VariantColorRefInput[] = rows.map((r) => ({
      key: r.colorId,
      colorId: r.colorId,
      label: r.colorName,
      principalRef: r.principalRef,
      overrideRef: r.overrideRef,
    }));
    return detectPfsColorConflicts(items);
  }, [rows]);

  const colorIdsInConflict = useMemo(() => {
    const s = new Set<string>();
    for (const c of conflicts) {
      for (const v of c.variants) {
        if (v.colorId) s.add(v.colorId);
      }
    }
    return s;
  }, [conflicts]);

  if (rows.length === 0) return null;

  return (
    <div className="bg-bg-primary border border-border rounded-2xl p-4 sm:p-6 shadow-sm space-y-4">
      <div>
        <h3 className="font-heading text-base font-semibold text-text-primary mb-1">
          Mapping Paris Fashion Shop
        </h3>
        <p className="text-sm text-text-secondary font-body">
          Pour chaque couleur du produit, vérifiez son mapping PFS. Le mapping
          secondaire est partagé entre toutes les variantes (et lignes de pack)
          qui utilisent cette couleur.
        </p>
      </div>

      {conflicts.length > 0 && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3">
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
          <p className="text-[11px] text-amber-700 font-body mt-1.5">
            Le produit pourra être enregistré et mis en ligne sur la boutique, mais il ne pourra pas être
            publié sur Paris Fashion Shop tant que le conflit n&apos;est pas résolu.
          </p>
        </div>
      )}

      <div className="border border-border rounded-xl overflow-hidden">
        <div className="grid grid-cols-12 gap-2 bg-bg-secondary px-4 py-2 text-[11px] uppercase tracking-wider font-semibold text-text-muted font-body">
          <div className="col-span-4">Couleur</div>
          <div className="col-span-3">Mapping principal</div>
          <div className="col-span-5">Mapping secondaire (facultatif)</div>
        </div>
        <div className="divide-y divide-border">
          {rows.map((r) => {
            const inConflict = colorIdsInConflict.has(r.colorId);
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
            return (
              <div
                key={r.colorId}
                className={`grid grid-cols-12 gap-2 items-center px-4 py-3 ${
                  inConflict ? "bg-amber-50/60" : ""
                }`}
              >
                <div className="col-span-4 flex items-center gap-2 min-w-0">
                  <ColorSwatch hex={r.colorHex} size={20} rounded="full" border />
                  <span className="text-[13px] font-body text-text-primary truncate">
                    {r.colorName}
                  </span>
                </div>
                <div className="col-span-3 text-[12px] font-body text-text-secondary">
                  {principalLabelOf(r.principalRef, pfsColorOptions)}
                </div>
                <div className="col-span-5">
                  {pfsColorOptions.length === 0 ? (
                    <span className="text-[11px] text-text-muted font-body italic">
                      Couleurs PFS indisponibles
                    </span>
                  ) : (
                    <CustomSelect
                      value={r.overrideRef ?? ""}
                      onChange={(v) => {
                        const next = v ? v : null;
                        // Propage à toutes les variantes/lignes utilisant cette couleur.
                        for (const t of r.targets) {
                          if (t.packLineTempId) {
                            onChangePackLineOverride(t.variantTempId, t.packLineTempId, next);
                          } else {
                            onChangeVariantOverride(t.variantTempId, next);
                          }
                        }
                      }}
                      options={selectOptions}
                      placeholder="— (utiliser le mapping principal)"
                    />
                  )}
                  {r.overrideRef && effective && (
                    <p className="text-[10px] text-text-muted font-body mt-1">
                      Effectif sur PFS : <span className="font-semibold">{effective}</span>
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
