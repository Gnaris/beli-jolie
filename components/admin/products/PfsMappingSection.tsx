"use client";

/**
 * Section « Mapping Paris Fashion Shop » du formulaire produit.
 *
 * Affiche pour chaque variante (et chaque ligne d'un pack multi-couleurs) :
 *   - le mapping PFS principal de la couleur (lecture seule, info)
 *   - un sélecteur facultatif de mapping PFS **secondaire** (override propre
 *     à ce produit), qui exclut le principal de la couleur sélectionnée
 *
 * Calcule en temps réel les conflits sur le mapping effectif (override OU
 * principal) et affiche un avertissement par variante en conflit + un bandeau
 * récapitulatif. La case « Paris Fashion Shop » de la modale post-save est
 * gérée séparément depuis ProductForm en lisant ces mêmes conflits.
 */

import { useMemo } from "react";
import CustomSelect from "@/components/ui/CustomSelect";
import ColorSwatch from "@/components/ui/ColorSwatch";
import type {
  AvailableColor,
  PackLineState,
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

interface RowItem {
  /** Clé stable pour la détection des conflits. */
  key: string;
  variantTempId: string;
  packLineTempId?: string;
  colorId: string;
  colorName: string;
  colorHex: string;
  principalRef: string | null;
  overrideRef: string | null;
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
  // Build rows : 1 ligne pour chaque variante UNIT/PACK + 1 par ligne d'un pack multi-couleurs.
  const rows: RowItem[] = useMemo(() => {
    const out: RowItem[] = [];
    for (const v of variants) {
      // Pack multi-couleurs : on liste les lignes (la variante elle-même partage
      // sa couleur avec la 1re ligne, donc on n'affiche pas la variante "racine").
      if (v.saleType === "PACK" && v.packLines.length > 0) {
        for (const pl of v.packLines) {
          const ac = availableColors.find((c) => c.id === pl.colorId);
          out.push({
            key: `v${v.tempId}-pl${pl.tempId}`,
            variantTempId: v.tempId,
            packLineTempId: pl.tempId,
            colorId: pl.colorId,
            colorName: pl.colorName || ac?.name || "Couleur sans nom",
            colorHex: pl.colorHex || ac?.hex || "#9CA3AF",
            principalRef: ac?.pfsColorRef ?? null,
            overrideRef: pl.pfsColorRefOverride ?? null,
          });
        }
        continue;
      }
      const ac = availableColors.find((c) => c.id === v.colorId);
      out.push({
        key: `v${v.tempId}`,
        variantTempId: v.tempId,
        colorId: v.colorId,
        colorName: v.colorName || ac?.name || "Couleur sans nom",
        colorHex: v.colorHex || ac?.hex || "#9CA3AF",
        principalRef: ac?.pfsColorRef ?? null,
        overrideRef: v.pfsColorRefOverride ?? null,
      });
    }
    return out;
  }, [variants, availableColors]);

  // Conflits sur le mapping effectif.
  const conflicts = useMemo(() => {
    const items: VariantColorRefInput[] = rows.map((r) => ({
      key: r.key,
      label: r.colorName,
      principalRef: r.principalRef,
      overrideRef: r.overrideRef,
    }));
    return detectPfsColorConflicts(items);
  }, [rows]);

  // Set des row keys en conflit pour décoration.
  const keysInConflict = useMemo(() => {
    const s = new Set<string>();
    for (const c of conflicts) {
      for (const v of c.variants) s.add(v.key);
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
          Pour chaque variante, vérifiez le mapping PFS de la couleur. Si deux variantes pointent
          sur le même mapping, vous pouvez en choisir un secondaire propre à ce produit.
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
          <div className="col-span-4">Variante</div>
          <div className="col-span-3">Mapping principal</div>
          <div className="col-span-5">Mapping secondaire (facultatif)</div>
        </div>
        <div className="divide-y divide-border">
          {rows.map((r) => {
            const inConflict = keysInConflict.has(r.key);
            const effective = effectivePfsColorRef({
              principalRef: r.principalRef,
              overrideRef: r.overrideRef,
            });
            // Le sélecteur exclut le mapping principal (logique : le secondaire
            // doit être différent). On affiche tout le reste.
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
                key={r.key}
                className={`grid grid-cols-12 gap-2 items-center px-4 py-3 ${
                  inConflict ? "bg-amber-50/60" : ""
                }`}
              >
                <div className="col-span-4 flex items-center gap-2 min-w-0">
                  <ColorSwatch hex={r.colorHex} size={20} rounded="full" border />
                  <span className="text-[13px] font-body text-text-primary truncate">
                    {r.colorName}
                  </span>
                  {r.packLineTempId && (
                    <span className="text-[10px] text-text-muted font-body">(pack)</span>
                  )}
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
                        if (r.packLineTempId) {
                          onChangePackLineOverride(r.variantTempId, r.packLineTempId, next);
                        } else {
                          onChangeVariantOverride(r.variantTempId, next);
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
