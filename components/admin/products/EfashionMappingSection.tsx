"use client";

/**
 * Section « Mapping eFashion » du formulaire produit.
 *
 * Miroir de `PfsMappingSection` : pour chaque couleur unique du produit,
 * affiche le mapping eFashion principal (Color.efashionColorId, lecture
 * seule) et un sélecteur facultatif de mapping **secondaire** (override
 * propre à ce produit). Un override s'applique à toutes les variantes et
 * lignes de pack utilisant la couleur.
 *
 * Détecte en temps réel les conflits : deux couleurs différentes du produit
 * qui pointeraient sur le même ID eFashion effectif — bloquant côté
 * marketplace car eFashion crée un « produit » par couleur.
 */

import { useMemo } from "react";
import CustomSelect from "@/components/ui/CustomSelect";
import ColorSwatch from "@/components/ui/ColorSwatch";
import type {
  AvailableColor,
  VariantState,
} from "./ColorVariantManager";
import {
  detectEfashionColorConflicts,
  effectiveEfashionColorId,
  type EfashionVariantColorRefInput,
} from "@/lib/efashion-color-conflicts";

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
  efashionColorOptions: EfashionColorOption[];
  /** Pose le même override sur toutes les variantes/lignes ciblées en UN
   * SEUL appel — évite tout problème de batching React quand plusieurs
   * variantes partagent la même couleur. */
  onChangeOverrideForTargets: (
    targets: { variantTempId: string; packLineTempId?: string }[],
    override: number | null,
  ) => void;
}

interface ColorRow {
  groupKey: string;
  colorName: string;
  colorHex: string;
  principalId: number | null;
  overrideId: number | null;
  hasNameCollision: boolean;
  targets: { variantTempId: string; packLineTempId?: string }[];
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

function principalLabelOf(
  principalId: number | null,
  options: EfashionColorOption[],
): string {
  if (principalId == null) return "Non défini";
  const opt = options.find((o) => o.id === principalId);
  return opt?.label ? `${opt.label} (id ${principalId})` : `id ${principalId}`;
}

function labelOf(id: number | null, options: EfashionColorOption[]): string {
  if (id == null) return "—";
  const opt = options.find((o) => o.id === id);
  return opt?.label ? `${opt.label} (id ${id})` : `id ${id}`;
}

export default function EfashionMappingSection({
  variants,
  availableColors,
  efashionColorOptions,
  onChangeOverrideForTargets,
}: Props) {
  const rows: ColorRow[] = useMemo(() => {
    const byName = new Map<string, ColorRow & { colorIdsSeen: Set<string> }>();
    const upsert = (input: {
      colorId: string;
      colorName: string;
      colorHex: string;
      principalId: number | null;
      overrideId: number | null;
      target: { variantTempId: string; packLineTempId?: string };
    }) => {
      const key = normalizeName(input.colorName);
      const existing = byName.get(key);
      if (existing) {
        if (existing.overrideId == null && input.overrideId != null) {
          existing.overrideId = input.overrideId;
        }
        existing.colorIdsSeen.add(input.colorId);
        existing.hasNameCollision = existing.colorIdsSeen.size > 1;
        existing.targets.push(input.target);
        return;
      }
      byName.set(key, {
        groupKey: key,
        colorName: input.colorName,
        colorHex: input.colorHex,
        principalId: input.principalId,
        overrideId: input.overrideId,
        hasNameCollision: false,
        colorIdsSeen: new Set([input.colorId]),
        targets: [input.target],
      });
    };

    for (const v of variants) {
      if (v.colorId) {
        const ac = availableColors.find((c) => c.id === v.colorId);
        upsert({
          colorId: v.colorId,
          colorName: v.colorName || ac?.name || "Couleur sans nom",
          colorHex: v.colorHex || ac?.hex || "#9CA3AF",
          principalId: ac?.efashionColorId ?? null,
          overrideId: v.efashionColorIdOverride ?? null,
          target: { variantTempId: v.tempId },
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
            principalId: ac?.efashionColorId ?? null,
            overrideId: pl.efashionColorIdOverride ?? null,
            target: { variantTempId: v.tempId, packLineTempId: pl.tempId },
          });
        }
      }
    }
    return Array.from(byName.values()).map(({ colorIdsSeen: _ignored, ...row }) => row);
  }, [variants, availableColors]);

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
          Mapping eFashion
        </h3>
        <p className="text-sm text-text-secondary font-body">
          Pour chaque couleur du produit, vérifiez son mapping eFashion. Le
          mapping secondaire est partagé entre toutes les variantes (et lignes
          de pack) qui utilisent cette couleur.
        </p>
      </div>

      {conflicts.length > 0 && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3">
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
          <p className="text-[11px] text-amber-700 font-body mt-1.5">
            Le produit pourra être enregistré et mis en ligne sur la boutique,
            mais il ne pourra pas être publié sur eFashion tant que le conflit
            n&apos;est pas résolu.
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
            const inConflict = groupKeysInConflict.has(r.groupKey);
            const effective = effectiveEfashionColorId({
              principalId: r.principalId,
              overrideId: r.overrideId,
            });
            const selectOptions = [
              { value: "", label: "— (utiliser le mapping principal)" },
              ...efashionColorOptions
                .filter((o) => o.id !== r.principalId)
                .map((o) => ({
                  value: String(o.id),
                  label: `${o.label} (id ${o.id})`,
                })),
            ];
            return (
              <div
                key={r.groupKey}
                className={`grid grid-cols-12 gap-2 items-center px-4 py-3 ${
                  inConflict ? "bg-amber-50/60" : ""
                }`}
              >
                <div className="col-span-4 flex items-center gap-2 min-w-0 flex-wrap">
                  <ColorSwatch hex={r.colorHex} size={20} rounded="full" border />
                  <span className="text-[13px] font-body text-text-primary truncate">
                    {r.colorName}
                  </span>
                  {r.overrideId != null && r.overrideId !== r.principalId && (
                    <span
                      className="text-[10px] text-sky-700 bg-sky-50 border border-sky-200 rounded px-1.5 py-0.5 font-body"
                      title="Cette couleur BJ pointe vers une couleur eFashion différente du mapping principal (override secondaire actif)."
                    >
                      ↔ {labelOf(r.overrideId, efashionColorOptions)} côté eFashion
                    </span>
                  )}
                  {r.hasNameCollision && (
                    <span
                      className="text-[10px] text-amber-700 bg-amber-100 rounded px-1.5 py-0.5 font-body"
                      title="Plusieurs fiches couleur portent ce nom dans la bibliothèque. Le mapping s'appliquera à toutes les variantes du produit utilisant ce nom."
                    >
                      Doublons biblio
                    </span>
                  )}
                </div>
                <div className="col-span-3 text-[12px] font-body text-text-secondary">
                  {principalLabelOf(r.principalId, efashionColorOptions)}
                </div>
                <div className="col-span-5">
                  {efashionColorOptions.length === 0 ? (
                    <span className="text-[11px] text-text-muted font-body italic">
                      Couleurs eFashion indisponibles
                    </span>
                  ) : (
                    <CustomSelect
                      value={r.overrideId != null ? String(r.overrideId) : ""}
                      onChange={(v) => {
                        const next = v ? Number(v) : null;
                        onChangeOverrideForTargets(
                          r.targets,
                          next != null && Number.isFinite(next) ? next : null,
                        );
                      }}
                      options={selectOptions}
                      placeholder="— (utiliser le mapping principal)"
                    />
                  )}
                  {r.overrideId != null && effective != null && (
                    <p className="text-[10px] text-text-muted font-body mt-1">
                      Effectif sur eFashion :{" "}
                      <span className="font-semibold">
                        {labelOf(effective, efashionColorOptions)}
                      </span>
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
