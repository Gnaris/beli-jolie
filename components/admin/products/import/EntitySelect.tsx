"use client";

import { useState, useMemo } from "react";
import CustomSelect from "@/components/ui/CustomSelect";

/**
 * Dropdown spécialisé pour les écrans d'import : catégorie / sous-catégorie /
 * couleur / pays / saison / composition.
 *
 * - Liste déroulante avec recherche (via CustomSelect searchable)
 * - Petit bouton « + » à droite qui ouvre un mini-formulaire pour créer
 *   l'entité à la volée via /api/admin/products/import/quick-create
 * - L'entité créée est sélectionnée automatiquement et ajoutée à la liste
 */

export type EntityKind = "category" | "subcategory" | "color" | "composition" | "country" | "season";

export interface EntityOption {
  id: string;
  name: string;
  categoryId?: string;     // pour subcategory : id du parent
  categoryName?: string;   // pour subcategory : nom du parent
}

interface Props {
  kind: EntityKind;
  /** Valeur courante (nom de l'entité). Vide = rien sélectionné. */
  value: string;
  onChange: (newName: string) => void;
  /** Liste des entités existantes (chargée via /api/admin/products/import/options). */
  options: EntityOption[];
  /** Pour les sous-catégories : restreint la liste à cette catégorie. */
  parentCategoryName?: string;
  /** Appelé après création — le parent met à jour sa liste globale.
   *  Utilisé uniquement avec le mini-formulaire interne (fallback). */
  onEntityCreated?: (entity: EntityOption) => void;
  /** Si fourni, le bouton « + » délègue au parent (qui ouvre son propre modal,
   *  par ex. avec mapping PFS/eFashion). Sinon, mini-formulaire interne. */
  onRequestCreate?: (kind: EntityKind, suggestedName?: string) => void;
  placeholder?: string;
  size?: "sm" | "md";
  disabled?: boolean;
}

const QUICK_CREATE_ACTION: Record<EntityKind, string> = {
  category: "create_category",
  subcategory: "create_subcategory",
  color: "create_color",
  composition: "create_composition",
  country: "create_country",
  season: "create_season",
};

const ENTITY_LABEL: Record<EntityKind, string> = {
  category: "catégorie",
  subcategory: "sous-catégorie",
  color: "couleur",
  composition: "composition",
  country: "pays",
  season: "saison",
};

export default function EntitySelect({
  kind,
  value,
  onChange,
  options,
  parentCategoryName,
  onEntityCreated,
  onRequestCreate,
  placeholder,
  size = "sm",
  disabled,
}: Props) {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filtrage par parent pour les sous-catégories
  const filteredOptions = useMemo(() => {
    if (kind === "subcategory" && parentCategoryName) {
      return options.filter((o) => o.categoryName === parentCategoryName);
    }
    return options;
  }, [kind, parentCategoryName, options]);

  // Options affichées : vide + entités existantes + valeur courante si manquante en base
  const selectOptions = useMemo(() => {
    const opts = [
      { value: "", label: "— Aucun —" },
      ...filteredOptions.map((o) => ({ value: o.name, label: o.name })),
    ];
    if (value && !filteredOptions.some((o) => o.name === value)) {
      opts.push({ value, label: `⚠ ${value} (à créer)` });
    }
    return opts;
  }, [filteredOptions, value]);

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    setError(null);
    try {
      const body: Record<string, string | undefined> = {
        action: QUICK_CREATE_ACTION[kind],
        name,
      };
      if (kind === "subcategory" && parentCategoryName) {
        body.parentCategoryName = parentCategoryName;
      }
      const res = await fetch("/api/admin/products/import/quick-create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Création impossible");
        return;
      }
      const created: EntityOption = {
        id: data.entity.id,
        name: data.entity.name,
        categoryId: data.entity.categoryId,
        categoryName: parentCategoryName,
      };
      onEntityCreated?.(created);
      onChange(created.name);
      setNewName("");
      setShowCreate(false);
    } catch {
      setError("Erreur réseau");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="w-full">
      <div className="flex items-center gap-1">
        <div className="flex-1 min-w-0">
          <CustomSelect
            value={value}
            onChange={onChange}
            options={selectOptions}
            placeholder={placeholder ?? `Choisir une ${ENTITY_LABEL[kind]}…`}
            searchable
            size={size}
            disabled={disabled}
            emptyMessage={`Aucune ${ENTITY_LABEL[kind]} — utilisez « + » pour en créer une.`}
          />
        </div>
        <button
          type="button"
          onClick={() => {
            // Si le parent gère son propre modal de création (recommandé : avec
            // mapping PFS/eFashion), on lui délègue. Sinon, mini-form interne.
            if (onRequestCreate) {
              onRequestCreate(kind, value || undefined);
            } else {
              setShowCreate((v) => !v);
            }
          }}
          disabled={disabled || (kind === "subcategory" && !parentCategoryName)}
          title={`Créer une nouvelle ${ENTITY_LABEL[kind]}`}
          className="shrink-0 w-7 h-7 flex items-center justify-center rounded-md border border-border bg-bg-primary hover:bg-bg-secondary text-text-primary text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          +
        </button>
      </div>
      {!onRequestCreate && showCreate && (
        <div className="mt-1.5 flex items-center gap-1.5">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); handleCreate(); }
              if (e.key === "Escape") { setShowCreate(false); setNewName(""); setError(null); }
            }}
            autoFocus
            placeholder={`Nom de la nouvelle ${ENTITY_LABEL[kind]}…`}
            className="flex-1 min-w-0 px-2 py-1 text-xs border border-border rounded-md bg-bg-primary focus:outline-none focus:ring-1 focus:ring-bg-dark/30"
          />
          <button
            type="button"
            onClick={handleCreate}
            disabled={!newName.trim() || creating}
            className="shrink-0 px-2 py-1 text-xs rounded-md bg-bg-dark text-text-inverse disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
          >
            {creating ? "…" : "Créer"}
          </button>
          <button
            type="button"
            onClick={() => { setShowCreate(false); setNewName(""); setError(null); }}
            disabled={creating}
            className="shrink-0 px-2 py-1 text-xs rounded-md border border-border hover:bg-bg-secondary transition-colors"
          >
            ✕
          </button>
        </div>
      )}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      {kind === "subcategory" && !parentCategoryName && (
        <p className="mt-1 text-xs text-amber-700">Choisissez d'abord une catégorie.</p>
      )}
    </div>
  );
}
