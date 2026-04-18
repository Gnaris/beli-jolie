/**
 * Stub left after the removal of the PFS/Ankorstore in-form mapping UI.
 * Marketplaces are now populated via manual Excel upload (lib/marketplace-excel).
 * This module exposes no-op implementations so legacy UI code that references
 * it keeps compiling.
 */
"use client";

export type MappableEntityType =
  | "color"
  | "size"
  | "composition"
  | "country"
  | "season"
  | "category"
  | "subcategory"
  | "tag";

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

export default function MarketplaceMappingSection(_props: Record<string, unknown>) {
  return null;
}
