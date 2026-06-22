"use client";

import { useMemo, useState } from "react";
import type { VariantState, ColorImageState } from "./ColorVariantManager";
import { imageGroupKeyFromVariant, isMultiColorPack } from "./ColorVariantManager";
import { getAnkorstoreReferenceSuffixLength } from "@/lib/ankorstore-description";

const DESCRIPTION_MIN_CHARS = 30;

export interface ChecklistInput {
  reference: string;
  name: string;
  description: string;
  categoryId: string;
  compositions: { compositionId: string; percentage: string }[];
  variants: VariantState[];
  colorImages: ColorImageState[];
}

interface CheckItem {
  key: string;
  label: string;
  done: boolean;
  detail?: string;
  /** Si vrai, affiche le `detail` même quand `done=true`, en couleur d'alerte. */
  detailIsWarning?: boolean;
}

function computeChecklist(input: ChecklistInput): CheckItem[] {
  const items: CheckItem[] = [];

  // 1. Reference
  items.push({
    key: "reference",
    label: "Référence produit",
    done: !!input.reference.trim(),
  });

  // 2. Name
  items.push({
    key: "name",
    label: "Nom du produit (FR)",
    done: !!input.name.trim(),
  });

  // 3. Description (30 chars min — la ligne référence ajoutée automatiquement à l'envoi Ankorstore compte aussi)
  const rawDescLen = input.description.trim().length;
  const refSuffixLen = getAnkorstoreReferenceSuffixLength(input.reference);
  const effectiveDescLen = rawDescLen + refSuffixLen;
  items.push({
    key: "description",
    label: `Description (FR, ${DESCRIPTION_MIN_CHARS} car. min)`,
    done: effectiveDescLen >= DESCRIPTION_MIN_CHARS,
    detail: rawDescLen === 0
      ? "vide"
      : effectiveDescLen < DESCRIPTION_MIN_CHARS
        ? `${effectiveDescLen} / ${DESCRIPTION_MIN_CHARS} car.`
        : undefined,
  });

  // 4. Category
  items.push({
    key: "category",
    label: "Catégorie",
    done: !!input.categoryId,
  });

  // 5. Composition
  const totalPct = input.compositions.reduce(
    (sum, c) => sum + parseFloat(c.percentage || "0"),
    0
  );
  const compositionOk =
    input.compositions.length > 0 && Math.abs(totalPct - 100) <= 0.5;
  items.push({
    key: "composition",
    label: "Composition (100%)",
    done: compositionOk,
    detail: input.compositions.length === 0
      ? "Aucune matière"
      : `${totalPct.toFixed(1)}%`,
  });

  // 6. At least 1 variant
  items.push({
    key: "variants",
    label: "Au moins une variante",
    done: input.variants.length > 0,
  });

  if (input.variants.length > 0) {
    // 7. All variants have valid price
    const allPriceOk = input.variants.every((v) => {
      const p = parseFloat(v.unitPrice);
      return !isNaN(p) && p > 0;
    });
    items.push({
      key: "prices",
      label: "Prix renseignés",
      done: allPriceOk,
      detail: allPriceOk
        ? undefined
        : `${input.variants.filter((v) => { const p = parseFloat(v.unitPrice); return isNaN(p) || p <= 0; }).length} manquant(s)`,
    });

    // 8. All variants have valid weight
    const allWeightOk = input.variants.every((v) => {
      const w = parseFloat(v.weight);
      return !isNaN(w) && w > 0;
    });
    items.push({
      key: "weights",
      label: "Poids renseignés",
      done: allWeightOk,
    });

    // 9. All variants have stock set
    const allStockOk = input.variants.every(
      (v) => v.stock !== "" && v.stock !== undefined && v.stock !== null
    );
    items.push({
      key: "stocks",
      label: "Stock renseigné",
      done: allStockOk,
    });

    // 10. All variants have at least 1 size.
    //     PACK multi-couleurs : les tailles vivent dans packLines (1 ligne
    //     par couleur, chacune avec ses propres tailles). On considère la
    //     variante valide si chaque ligne du pack a au moins 1 taille.
    const allSizesOk = input.variants.every((v) => {
      if (isMultiColorPack(v)) {
        return (
          v.packLines.length > 0 &&
          v.packLines.every((line) => line.sizeEntries.length > 0)
        );
      }
      return v.sizeEntries.length > 0;
    });
    items.push({
      key: "sizes",
      label: "Tailles renseignées",
      done: allSizesOk,
    });

    // 11. Au moins une couleur a au moins une image. Les couleurs sans image
    //     sont autorisées : elles seront masquées côté public et ignorées sur
    //     les marketplaces (le bandeau d'alerte du form le rappelle).
    const checkedGroupKeys = new Set<string>();
    let groupsTotal = 0;
    let groupsWithImage = 0;
    for (const v of input.variants) {
      if (isMultiColorPack(v)) {
        for (const line of v.packLines) {
          if (!line.colorId || checkedGroupKeys.has(line.colorId)) continue;
          checkedGroupKeys.add(line.colorId);
          groupsTotal++;
          const ci = input.colorImages.find((c) => c.groupKey === line.colorId);
          if (ci && ci.imagePreviews.length > 0) groupsWithImage++;
        }
      } else {
        const gk = imageGroupKeyFromVariant(v);
        if (checkedGroupKeys.has(gk)) continue;
        checkedGroupKeys.add(gk);
        groupsTotal++;
        const ci = input.colorImages.find((c) => c.groupKey === gk);
        if (ci && ci.imagePreviews.length > 0) groupsWithImage++;
      }
    }
    const missingImageCount = groupsTotal - groupsWithImage;
    items.push({
      key: "images",
      label: "Au moins une couleur avec image",
      done: groupsWithImage > 0,
      detail:
        groupsWithImage === 0
          ? "aucune image"
          : missingImageCount > 0
            ? `${missingImageCount} couleur(s) sans image, sera masquée`
            : undefined,
      detailIsWarning: groupsWithImage > 0 && missingImageCount > 0,
    });
  }

  return items;
}

export { computeChecklist };
export type { CheckItem };

export default function CompletenessChecklist({
  input,
}: {
  input: ChecklistInput;
}) {
  const [expanded, setExpanded] = useState(false);
  const items = useMemo(() => computeChecklist(input), [input]);

  const doneCount = items.filter((i) => i.done).length;
  const total = items.length;
  const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0;
  const isComplete = doneCount === total;

  return (
    <div
      className={`bg-bg-primary border rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] overflow-hidden transition-colors ${
        isComplete ? "border-[#22C55E]" : "border-border"
      }`}
    >
      {/* Header — always visible */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-5 py-3.5 hover:bg-bg-secondary/50 transition-colors"
      >
        {/* Circular progress */}
        <div className="relative w-10 h-10 shrink-0">
          <svg className="w-10 h-10 -rotate-90" viewBox="0 0 36 36">
            <circle
              cx="18"
              cy="18"
              r="15.9"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              className="text-border"
            />
            <circle
              cx="18"
              cy="18"
              r="15.9"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeDasharray={`${pct} ${100 - pct}`}
              strokeLinecap="round"
              className={
                isComplete
                  ? "text-[#22C55E]"
                  : pct >= 70
                    ? "text-[#F59E0B]"
                    : "text-[#EF4444]"
              }
              style={{ transition: "stroke-dasharray 0.4s ease" }}
            />
          </svg>
          <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-text-primary font-body">
            {pct}%
          </span>
        </div>

        <div className="flex-1 text-left">
          <p className="text-sm font-semibold text-text-primary font-heading">
            {isComplete
              ? "Prêt à mettre en ligne"
              : `Complétude — ${doneCount}/${total}`}
          </p>
          <p className="text-xs text-text-muted font-body">
            {isComplete
              ? "Toutes les informations requises sont renseignées."
              : `${total - doneCount} élément${total - doneCount > 1 ? "s" : ""} manquant${total - doneCount > 1 ? "s" : ""} pour la mise en ligne.`}
          </p>
        </div>

        {/* Badge */}
        {isComplete ? (
          <span className="badge badge-success text-xs">Complet</span>
        ) : (
          <span className="badge badge-purple text-xs">Brouillon</span>
        )}

        {/* Chevron */}
        <svg
          className={`w-4 h-4 text-text-muted shrink-0 transition-transform ${
            expanded ? "rotate-180" : ""
          }`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>

      {/* Expandable checklist */}
      {expanded && (
        <div className="px-5 pb-4 pt-1 border-t border-border">
          <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-1.5 mt-2">
            {items.map((item) => (
              <li key={item.key} className="flex items-center gap-2 py-0.5">
                {item.done ? (
                  <svg
                    className="w-4 h-4 text-[#22C55E] shrink-0"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2.5}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                ) : (
                  <svg
                    className="w-4 h-4 text-[#EF4444] shrink-0"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <circle cx="12" cy="12" r="9" strokeWidth={2} />
                  </svg>
                )}
                <span
                  className={`text-xs font-body ${
                    item.done
                      ? "text-text-muted line-through"
                      : "text-text-primary font-medium"
                  }`}
                >
                  {item.label}
                </span>
                {item.detail && (!item.done || item.detailIsWarning) && (
                  <span
                    className={`text-[10px] font-body ${
                      item.done && item.detailIsWarning
                        ? "text-[#F59E0B]"
                        : "text-[#EF4444]"
                    }`}
                  >
                    ({item.detail})
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
