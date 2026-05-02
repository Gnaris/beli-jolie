"use client";

import { useEffect, useMemo, useState } from "react";
import CustomSelect from "@/components/ui/CustomSelect";
import {
  PFS_GENDER_LABELS,
  PFS_FAMILIES_BY_GENDER,
  PFS_SUBCATEGORIES_BY_FAMILY,
  PFS_COLORS,
  PFS_COMPOSITIONS,
  PFS_COUNTRIES,
} from "@/lib/marketplace-excel/pfs-taxonomy";
import { fetchPfsColorOptions } from "@/app/actions/admin/colors";
import {
  fetchPfsMappingOptions,
  type PfsMappingOptions,
} from "@/app/actions/admin/pfs-annexes";

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

/* ── Static fallbacks (used on first render and if PFS API is down) ── */

const STATIC_GENDER_OPTIONS = Object.entries(PFS_GENDER_LABELS).map(
  ([code, label]) => ({ value: code, label }),
);
const STATIC_COLOR_OPTIONS = PFS_COLORS.map((c) => ({ value: c, label: c }));
const STATIC_COMPOSITION_OPTIONS = PFS_COMPOSITIONS.map((c) => ({ value: c, label: c }));
const STATIC_COUNTRY_OPTIONS = PFS_COUNTRIES.map((c) => ({ value: c, label: c }));

/* ── Process-level cache so every mapping instance shares one fetch ── */

let liveColorOptionsCache: { value: string; label: string }[] | null = null;
let liveColorOptionsPromise: Promise<{ value: string; label: string }[]> | null = null;

function useLivePfsColorOptions() {
  const [options, setOptions] = useState<{ value: string; label: string }[]>(
    liveColorOptionsCache ?? STATIC_COLOR_OPTIONS,
  );
  useEffect(() => {
    if (liveColorOptionsCache) return;
    if (!liveColorOptionsPromise) {
      liveColorOptionsPromise = fetchPfsColorOptions()
        .then((rows) => {
          const mapped = rows.map((r) => ({ value: r.value, label: r.label }));
          liveColorOptionsCache = mapped;
          return mapped;
        })
        .catch(() => STATIC_COLOR_OPTIONS);
    }
    let cancelled = false;
    liveColorOptionsPromise.then((rows) => {
      if (!cancelled) setOptions(rows);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return options;
}

let liveAnnexesCache: PfsMappingOptions | null = null;
let liveAnnexesPromise: Promise<PfsMappingOptions> | null = null;

function useLivePfsAnnexes(): PfsMappingOptions | null {
  const [data, setData] = useState<PfsMappingOptions | null>(liveAnnexesCache);
  useEffect(() => {
    if (liveAnnexesCache) return;
    if (!liveAnnexesPromise) {
      liveAnnexesPromise = fetchPfsMappingOptions()
        .then((res) => {
          liveAnnexesCache = res;
          return res;
        })
        .catch(() => {
          const fallback: PfsMappingOptions = {
            genders: STATIC_GENDER_OPTIONS,
            families: [],
            categories: [],
            compositions: STATIC_COMPOSITION_OPTIONS,
            countries: STATIC_COUNTRY_OPTIONS,
            seasons: [],
          };
          return fallback;
        });
    }
    let cancelled = false;
    liveAnnexesPromise.then((res) => {
      if (!cancelled) setData(res);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return data;
}

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
      return <ColorMapping pfsRef={props.pfsRef} onPfsRefChange={props.onPfsRefChange} />;
    case "composition":
      return <CompositionMapping pfsRef={props.pfsRef} onPfsRefChange={props.onPfsRefChange} />;
    case "country":
      return <CountryMapping pfsRef={props.pfsRef} onPfsRefChange={props.onPfsRefChange} />;
    case "season":
      return <SeasonMapping pfsRef={props.pfsRef} onPfsRefChange={props.onPfsRefChange} />;
    default:
      return null;
  }
}

/* ── Category: Genre + Famille + Catégorie cascade (live PFS) ── */

function CategoryMapping({
  pfsGender,
  pfsFamilyName,
  pfsCategoryName,
  onPfsGenderChange,
  onPfsFamilyNameChange,
  onPfsCategoryNameChange,
}: CategoryMappingProps) {
  const annexes = useLivePfsAnnexes();

  const genderOptions = useMemo(() => {
    if (annexes && annexes.genders.length > 0) return annexes.genders;
    return STATIC_GENDER_OPTIONS;
  }, [annexes]);

  const familyOptions = useMemo(() => {
    if (!pfsGender) return [];
    if (annexes && annexes.families.length > 0) {
      return annexes.families
        .filter((f) => f.gender === pfsGender)
        .map((f) => ({ value: f.family, label: f.family.replace(/_/g, " ") }));
    }
    const genderLabel = PFS_GENDER_LABELS[pfsGender] ?? "";
    const families = PFS_FAMILIES_BY_GENDER[genderLabel] ?? [];
    return families.map((f) => ({ value: f, label: f.replace(/_/g, " ") }));
  }, [pfsGender, annexes]);

  const categoryOptions = useMemo(() => {
    if (!pfsFamilyName) return [];
    if (annexes && annexes.categories.length > 0) {
      return annexes.categories
        .filter((c) => (!pfsGender || c.gender === pfsGender) && c.family === pfsFamilyName)
        .map((c) => ({ value: c.category, label: c.category }));
    }
    const subcats = PFS_SUBCATEGORIES_BY_FAMILY[pfsFamilyName] ?? [];
    return subcats.map((c) => ({ value: c, label: c }));
  }, [pfsFamilyName, pfsGender, annexes]);

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
          options={genderOptions}
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
          placeholder={pfsGender ? "Sélectionner une famille" : "Choisir un genre d'abord"}
          disabled={!pfsGender}
          searchable
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

/* ── Color mapping: live-fetched from the PFS API ── */

function ColorMapping({
  pfsRef,
  onPfsRefChange,
}: {
  pfsRef?: string | null;
  onPfsRefChange: (ref: string | null) => void;
}) {
  const options = useLivePfsColorOptions();
  return (
    <RefMapping
      label="Couleur PFS"
      options={options}
      searchable
      pfsRef={pfsRef}
      onPfsRefChange={onPfsRefChange}
      placeholder="Sélectionner une couleur"
    />
  );
}

/* ── Composition mapping: live-fetched from PFS ── */

function CompositionMapping({
  pfsRef,
  onPfsRefChange,
}: {
  pfsRef?: string | null;
  onPfsRefChange: (ref: string | null) => void;
}) {
  const annexes = useLivePfsAnnexes();
  const options =
    annexes && annexes.compositions.length > 0 ? annexes.compositions : STATIC_COMPOSITION_OPTIONS;
  return (
    <RefMapping
      label="Matière PFS"
      options={options}
      searchable
      pfsRef={pfsRef}
      onPfsRefChange={onPfsRefChange}
      placeholder="Sélectionner une matière"
    />
  );
}

/* ── Country mapping: live-fetched from PFS ── */

function CountryMapping({
  pfsRef,
  onPfsRefChange,
}: {
  pfsRef?: string | null;
  onPfsRefChange: (ref: string | null) => void;
}) {
  const annexes = useLivePfsAnnexes();
  const options =
    annexes && annexes.countries.length > 0 ? annexes.countries : STATIC_COUNTRY_OPTIONS;
  return (
    <RefMapping
      label="Pays PFS"
      options={options}
      searchable
      pfsRef={pfsRef}
      onPfsRefChange={onPfsRefChange}
      placeholder="Sélectionner un pays"
    />
  );
}

/* ── Season mapping: live-fetched from PFS (collections) ── */

function SeasonMapping({
  pfsRef,
  onPfsRefChange,
}: {
  pfsRef?: string | null;
  onPfsRefChange: (ref: string | null) => void;
}) {
  const annexes = useLivePfsAnnexes();
  const options = annexes ? annexes.seasons : [];
  return (
    <RefMapping
      label="Saison PFS"
      options={options}
      searchable
      pfsRef={pfsRef}
      onPfsRefChange={onPfsRefChange}
      placeholder={
        annexes === null
          ? "Chargement des saisons…"
          : options.length === 0
            ? "Aucune saison disponible chez PFS"
            : "Sélectionner une saison"
      }
    />
  );
}

/* ── Single-ref mapping primitive ── */

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
