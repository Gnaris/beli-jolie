"use client";

/**
 * Composant réutilisable — CustomSelect qui liste les attributs Microstore
 * pour un type donné (category/brand/year/season/composition/color) et permet
 * à la cliente de mapper manuellement un attribut BJ vers son équivalent Microstore.
 *
 * Utilisé dans les formulaires d'édition BJ :
 *   - ColorEditorModal → type="color"
 *   - CategoryEditorModal → type="category"
 *   - SeasonEditorModal → type="season"
 *   - CompositionEditorModal → type="composition"
 *
 * Charge la liste au mount via listMicrostoreAttribute / listMicrostoreColors.
 * Affiche une option vide « Aucune correspondance » + les attributs Microstore.
 */

import { useCallback, useEffect, useState } from "react";
import CustomSelect from "@/components/ui/CustomSelect";
import {
  listMicrostoreAttribute,
  listMicrostoreColors,
} from "@/app/actions/admin/microstore-attributes";
import type { MicrostoreAttrType } from "@/lib/microstore-attributes";

type Kind = MicrostoreAttrType | "color";

interface Props {
  kind: Kind;
  value: number | null;
  onChange: (id: number | null) => void;
  /** Libellé du champ affiché au-dessus du select. */
  label?: string;
  disabled?: boolean;
  /** Placeholder quand aucune correspondance choisie. */
  placeholder?: string;
}

const DEFAULT_LABELS: Record<Kind, string> = {
  category: "Correspondance catégorie Microstore",
  brand: "Correspondance marque Microstore",
  year: "Correspondance année Microstore",
  season: "Correspondance saison Microstore",
  composition: "Correspondance composition Microstore",
  color: "Correspondance couleur Microstore",
};

export function MicrostoreAttributeSelect({
  kind,
  value,
  onChange,
  label,
  disabled = false,
  placeholder = "Aucune correspondance",
}: Props) {
  const [items, setItems] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res =
      kind === "color"
        ? await listMicrostoreColors()
        : await listMicrostoreAttribute(kind);
    if (res.success && res.data) {
      setItems(
        (res.data as Array<{ id: string; name: string }>).map((x) => ({
          id: String(x.id),
          name: x.name,
        })),
      );
    } else {
      setError(res.error ?? "Impossible de charger");
      setItems([]);
    }
    setLoading(false);
  }, [kind]);

  useEffect(() => {
    void load();
  }, [load]);

  const options = [
    { value: "", label: placeholder },
    ...items.map((x) => ({ value: x.id, label: `${x.name} (#${x.id})` })),
  ];

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <label className="text-xs font-semibold text-text-secondary uppercase tracking-wide">
          {label ?? DEFAULT_LABELS[kind]}
        </label>
        {error && (
          <button
            type="button"
            onClick={() => void load()}
            className="text-[10px] text-cyan-700 hover:underline"
            title={error}
          >
            Recharger
          </button>
        )}
      </div>
      <CustomSelect
        value={value == null ? "" : String(value)}
        onChange={(v) => onChange(v === "" ? null : Number(v))}
        options={options}
        disabled={disabled || loading}
        placeholder={loading ? "Chargement…" : placeholder}
      />
      {error && (
        <p className="text-[10px] text-rose-700">{error}</p>
      )}
    </div>
  );
}
