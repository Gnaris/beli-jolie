"use client";

import { useMemo } from "react";
import EntitySelect, { type EntityOption, type EntityKind } from "./EntitySelect";

/**
 * Éditeur de composition multi-matières.
 *
 * Format interne BDD/Excel : "Coton:85,Polyester:15" (matière:pourcentage,
 * séparés par virgules).
 *
 * UI : une ligne par matière avec une liste déroulante (compositions
 * existantes en base + bouton « + » pour créer celles manquantes) et un
 * pourcentage. Bouton « + ajouter une matière » pour empiler des lignes.
 */

interface CompositionLine {
  material: string;
  percentage: string;  // string pour éviter les soucis d'input vide / NaN
}

interface Props {
  /** Valeur sérialisée actuelle (« Coton:85,Polyester:15 »). */
  value: string;
  onChange: (next: string) => void;
  /** Liste des compositions existantes en base (alimente la dropdown). */
  options: EntityOption[];
  /** Ouvre le modal QuickCreate pour créer une composition manquante. */
  onRequestCreate: (kind: EntityKind, suggestedName?: string) => void;
}

function parseComposition(raw: string): CompositionLine[] {
  if (!raw.trim()) return [{ material: "", percentage: "" }];
  return raw.split(",").map((part) => {
    const [material, percentage] = part.split(":").map((s) => s.trim());
    return { material: material || "", percentage: percentage ?? "" };
  });
}

function serializeComposition(lines: CompositionLine[]): string {
  return lines
    .map((l) => l.material.trim() ? `${l.material.trim()}:${l.percentage.trim() || "0"}` : "")
    .filter(Boolean)
    .join(",");
}

export default function CompositionEditor({ value, onChange, options, onRequestCreate }: Props) {
  // Parser en mémo pour ne pas reparser à chaque render
  const lines = useMemo(() => parseComposition(value), [value]);

  const updateLine = (idx: number, partial: Partial<CompositionLine>) => {
    const next = lines.map((l, i) => (i === idx ? { ...l, ...partial } : l));
    onChange(serializeComposition(next));
  };

  const addLine = () => {
    const next = [...lines, { material: "", percentage: "" }];
    onChange(serializeComposition(next));
  };

  const removeLine = (idx: number) => {
    const next = lines.filter((_, i) => i !== idx);
    // Garde au moins une ligne vide pour permettre re-saisie
    onChange(serializeComposition(next.length > 0 ? next : [{ material: "", percentage: "" }]));
  };

  // Total des pourcentages (pour aider l'utilisatrice à viser 100)
  const totalPercent = lines.reduce((sum, l) => {
    const n = parseFloat(l.percentage);
    return sum + (isNaN(n) ? 0 : n);
  }, 0);
  const totalIsValid = totalPercent === 100;
  const totalIsZero = totalPercent === 0;

  return (
    <div className="space-y-1.5">
      {lines.map((line, idx) => (
        <div key={idx} className="flex items-center gap-1.5">
          <div className="flex-1 min-w-0">
            <EntitySelect
              kind="composition"
              value={line.material}
              onChange={(v) => updateLine(idx, { material: v })}
              options={options}
              onRequestCreate={onRequestCreate}
              size="sm"
              placeholder="Matière…"
            />
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <input
              type="number"
              min="0"
              max="100"
              step="0.1"
              value={line.percentage}
              onChange={(e) => updateLine(idx, { percentage: e.target.value })}
              placeholder="%"
              className="w-16 px-2 py-1.5 text-sm text-center border border-border rounded-md bg-bg-primary focus:outline-none focus:ring-1 focus:ring-bg-dark/30"
            />
            <span className="text-xs text-[#666]">%</span>
          </div>
          {lines.length > 1 && (
            <button
              type="button"
              onClick={() => removeLine(idx)}
              title="Retirer cette matière"
              className="shrink-0 w-7 h-7 flex items-center justify-center rounded-md border border-border bg-bg-primary hover:bg-red-50 hover:border-red-300 text-[#666] hover:text-red-600 text-sm transition-colors"
            >
              ×
            </button>
          )}
        </div>
      ))}
      <div className="flex items-center justify-between gap-2 mt-1">
        <button
          type="button"
          onClick={addLine}
          className="text-xs text-text-primary hover:underline"
        >
          + Ajouter une matière
        </button>
        {!totalIsZero && (
          <span className={`text-xs ${totalIsValid ? "text-green-700" : "text-amber-700"}`}>
            Total : {totalPercent}% {totalIsValid ? "✓" : "(doit faire 100%)"}
          </span>
        )}
      </div>
    </div>
  );
}
