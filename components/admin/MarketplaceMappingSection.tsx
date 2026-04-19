"use client";

import { useMemo } from "react";
import CustomSelect from "@/components/ui/CustomSelect";
import {
  PFS_GENDER_LABELS,
  PFS_FAMILIES_BY_GENDER,
  PFS_SUBCATEGORIES_BY_FAMILY,
  PFS_COLORS,
  PFS_COMPOSITIONS,
  PFS_COUNTRIES,
} from "@/lib/marketplace-excel/pfs-taxonomy";

export type MappableEntityType =
  | "color"
  | "size"
  | "composition"
  | "country"
  | "season"
  | "category"
  | "subcategory"
  | "tag";

/* ── Legacy stub exports (used by ColorVariantManager) ── */

interface PfsRef {
  reference: string;
  label: string;
  labels?: { fr?: string; en?: string; [k: string]: string | undefined };
}

export interface PfsAttributesData {
  colors: PfsRef[];
  sizes: PfsRef[];
  compositions: PfsRef[];
  countries: PfsRef[];
  seasons: PfsRef[];
  mappedCombos: Record<string, string>;
}

export interface PfsAttributesBundle {
  pfsColors: PfsRef[];
  pfsSizes: PfsRef[];
  pfsMaterials: PfsRef[];
  pfsCountries: PfsRef[];
  pfsSeasons: PfsRef[];
  data: PfsAttributesData;
  loading: boolean;
  error: string | null;
}

export function usePfsAttributes(): PfsAttributesBundle {
  return {
    pfsColors: [],
    pfsSizes: [],
    pfsMaterials: [],
    pfsCountries: [],
    pfsSeasons: [],
    data: {
      colors: [],
      sizes: [],
      compositions: [],
      countries: [],
      seasons: [],
      mappedCombos: {},
    },
    loading: false,
    error: null,
  };
}

/* ── Precomputed options ── */

const GENDER_OPTIONS = Object.entries(PFS_GENDER_LABELS).map(([code, label]) => ({
  value: code,
  label,
}));

const COLOR_OPTIONS = PFS_COLORS.map((c) => ({ value: c, label: c }));
const COMPOSITION_OPTIONS = PFS_COMPOSITIONS.map((c) => ({ value: c, label: c }));
const COUNTRY_OPTIONS = PFS_COUNTRIES.map((c) => ({ value: c, label: c }));

/* ── Season format: PE20XX (Printemps/Été) or AH20XX (Automne/Hiver) ── */
function generateSeasonOptions(): { value: string; label: string }[] {
  const options: { value: string; label: string }[] = [];
  const currentYear = new Date().getFullYear();
  for (let y = currentYear - 2; y <= currentYear + 3; y++) {
    options.push({ value: `PE${y}`, label: `PE${y} — Printemps/Été ${y}` });
    options.push({ value: `AH${y}`, label: `AH${y} — Automne/Hiver ${y}` });
  }
  return options;
}
const SEASON_OPTIONS = generateSeasonOptions();

/* ── Props ── */

interface CategoryMappingProps {
  entityType: "category";
  pfsGender?: string | null;
  pfsFamilyName?: string | null;
  pfsCategoryName?: string | null;
  onPfsGenderChange: (gender: string | null) => void;
  onPfsFamilyNameChange: (familyName: string | null) => void;
  onPfsCategoryNameChange: (categoryName: string | null) => void;
}

interface RefMappingProps {
  entityType: "color" | "composition" | "country" | "season";
  pfsRef?: string | null;
  onPfsRefChange: (ref: string | null) => void;
}

interface NoopMappingProps {
  entityType: "size" | "subcategory" | "tag";
  pfsRef?: string | null;
  onPfsRefChange?: (ref: string | null) => void;
}

type Props = CategoryMappingProps | RefMappingProps | NoopMappingProps;

export default function MarketplaceMappingSection(props: Props) {
  switch (props.entityType) {
    case "category":
      return <CategoryMapping {...props} />;
    case "color":
      return <RefMapping label="Couleur PFS" options={COLOR_OPTIONS} searchable pfsRef={props.pfsRef} onPfsRefChange={props.onPfsRefChange} placeholder="Sélectionner une couleur" />;
    case "composition":
      return <RefMapping label="Matière PFS" options={COMPOSITION_OPTIONS} searchable pfsRef={props.pfsRef} onPfsRefChange={props.onPfsRefChange} placeholder="Sélectionner une matière" />;
    case "country":
      return <RefMapping label="Pays PFS" options={COUNTRY_OPTIONS} searchable pfsRef={props.pfsRef} onPfsRefChange={props.onPfsRefChange} placeholder="Sélectionner un pays" />;
    case "season":
      return <RefMapping label="Saison PFS" options={SEASON_OPTIONS} pfsRef={props.pfsRef} onPfsRefChange={props.onPfsRefChange} placeholder="Sélectionner une saison" />;
    default:
      return null;
  }
}

/* ── Category: Genre + Famille cascade ── */

function CategoryMapping({ pfsGender, pfsFamilyName, pfsCategoryName, onPfsGenderChange, onPfsFamilyNameChange, onPfsCategoryNameChange }: CategoryMappingProps) {
  const genderLabel = pfsGender ? PFS_GENDER_LABELS[pfsGender] ?? "" : "";

  const familyOptions = useMemo(() => {
    if (!genderLabel) return [];
    const families = PFS_FAMILIES_BY_GENDER[genderLabel] ?? [];
    return families.map((f) => ({ value: f, label: f.replace(/_/g, " ") }));
  }, [genderLabel]);

  const categoryOptions = useMemo(() => {
    if (!pfsFamilyName) return [];
    const subcats = PFS_SUBCATEGORIES_BY_FAMILY[pfsFamilyName] ?? [];
    return subcats.map((c) => ({ value: c, label: c }));
  }, [pfsFamilyName]);

  function handleGenderChange(value: string) {
    onPfsGenderChange(value || null);
    onPfsFamilyNameChange(null);
    onPfsCategoryNameChange(null);
  }

  function handleFamilyChange(value: string) {
    onPfsFamilyNameChange(value || null);
    onPfsCategoryNameChange(null);
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-text-secondary mb-1.5 font-body">
          Genre PFS
        </label>
        <CustomSelect
          value={pfsGender ?? ""}
          onChange={(v) => handleGenderChange(v)}
          options={GENDER_OPTIONS}
          placeholder="Sélectionner un genre"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-text-secondary mb-1.5 font-body">
          Famille PFS
        </label>
        <CustomSelect
          value={pfsFamilyName ?? ""}
          onChange={(v) => handleFamilyChange(v)}
          options={familyOptions}
          placeholder={genderLabel ? "Sélectionner une famille" : "Choisir un genre d'abord"}
          disabled={!genderLabel}
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-text-secondary mb-1.5 font-body">
          Catégorie PFS
        </label>
        <CustomSelect
          value={pfsCategoryName ?? ""}
          onChange={(v) => onPfsCategoryNameChange(v || null)}
          options={categoryOptions}
          placeholder={pfsFamilyName ? "Sélectionner une catégorie" : "Choisir une famille d'abord"}
          disabled={!pfsFamilyName}
          searchable
        />
      </div>
      {pfsGender && pfsFamilyName && pfsCategoryName && (
        <p className="text-[11px] text-green-600 font-body">
          Mapping complet
        </p>
      )}
    </div>
  );
}

/* ── Single-ref mapping (color, composition, country, season) ── */

function RefMapping({
  label,
  options,
  searchable,
  pfsRef,
  onPfsRefChange,
  placeholder,
}: {
  label: string;
  options: { value: string; label: string }[];
  searchable?: boolean;
  pfsRef?: string | null;
  onPfsRefChange: (ref: string | null) => void;
  placeholder: string;
}) {
  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-text-secondary mb-1.5 font-body">
          {label}
        </label>
        <CustomSelect
          value={pfsRef ?? ""}
          onChange={(v) => onPfsRefChange(v || null)}
          options={options}
          placeholder={placeholder}
          searchable={searchable}
        />
      </div>
      {pfsRef && (
        <p className="text-[11px] text-green-600 font-body">
          Mapping complet
        </p>
      )}
    </div>
  );
}
