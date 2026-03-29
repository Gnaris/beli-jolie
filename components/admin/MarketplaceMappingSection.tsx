"use client";

import { useState, useEffect, useMemo } from "react";
import CustomSelect from "@/components/ui/CustomSelect";

/* ─────────────────────────────────────────────
   PFS types (matching API response)
   ───────────────────────────────────────────── */

interface PfsColor {
  reference: string;
  value: string;
  image: string | null;
  labels: Record<string, string>;
}

interface PfsCategory {
  id: string;
  family: { id: string } | string;
  labels: Record<string, string>;
  gender: string;
}

interface PfsFamily {
  id: string;
  labels: Record<string, string>;
  gender: string;
}

interface PfsGender {
  reference: string;
  labels: Record<string, string>;
}

interface PfsComposition {
  id: string;
  reference: string;
  labels: Record<string, string>;
}

interface PfsCountry {
  reference: string;
  labels: Record<string, string>;
  preview: string | null;
}

interface PfsCollection {
  id: string;
  reference: string;
  labels: Record<string, string>;
}

interface PfsSize {
  reference: string;
}

interface PfsData {
  colors: PfsColor[];
  categories: PfsCategory[];
  compositions: PfsComposition[];
  countries: PfsCountry[];
  collections: PfsCollection[];
  families: PfsFamily[];
  genders: PfsGender[];
  sizes: PfsSize[];
  pfsDisabled?: boolean;
}

/* ─────────────────────────────────────────────
   Shared PFS data cache (module-level singleton)
   ───────────────────────────────────────────── */

let pfsCache: PfsData | null = null;
let pfsFetchPromise: Promise<PfsData> | null = null;

async function fetchPfsData(): Promise<PfsData> {
  if (pfsCache) return pfsCache;
  if (pfsFetchPromise) return pfsFetchPromise;

  pfsFetchPromise = (async () => {
    try {
      const r = await fetch("/api/admin/pfs-sync/attributes");
      if (!r.ok) {
        let detail: string;
        try {
          const body = await r.json();
          detail = body.error || `HTTP ${r.status}`;
        } catch {
          detail = `HTTP ${r.status}`;
        }
        throw new Error(detail);
      }
      const data: PfsData = await r.json();
      // Don't cache disabled response — allow refetch after toggle ON
      if (data.pfsDisabled) {
        pfsFetchPromise = null;
      } else {
        pfsCache = data;
      }
      return data;
    } catch (err) {
      pfsFetchPromise = null; // allow retry on failure
      throw err;
    }
  })();

  return pfsFetchPromise;
}

/** Clear the module-level cache (useful if PFS attributes may have changed). */
export function clearPfsCache() {
  pfsCache = null;
  pfsFetchPromise = null;
}

/* ─────────────────────────────────────────────
   Hook: fetch PFS data on mount, with retry
   ───────────────────────────────────────────── */

export function usePfsAttributes() {
  const [data, setData] = useState<PfsData | null>(pfsCache);
  const [loading, setLoading] = useState(!pfsCache);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    if (pfsCache) {
      setData(pfsCache);
      setLoading(false);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchPfsData()
      .then((d) => { if (!cancelled) { setData(d); setError(null); } })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [retryCount]);

  function retry() {
    clearPfsCache();
    setRetryCount((c) => c + 1);
  }

  return { data, loading, error, retry };
}

/* ─────────────────────────────────────────────
   Supported entity types for mapping
   ───────────────────────────────────────────── */

export type MappableEntityType = "color" | "category" | "composition" | "country" | "season";

/* ─────────────────────────────────────────────
   Props
   ───────────────────────────────────────────── */

interface BaseProps {
  entityType: MappableEntityType;
}

interface SimpleProps extends BaseProps {
  entityType: "color" | "composition" | "country";
  pfsRef: string;
  onPfsRefChange: (ref: string) => void;
}

interface SeasonProps extends BaseProps {
  entityType: "season";
  pfsRefs: string[];
  onPfsRefsChange: (refs: string[]) => void;
  /** Refs already linked to other seasons — shown strikethrough + disabled */
  usedPfsRefs?: string[];
}

interface CategoryProps extends BaseProps {
  entityType: "category";
  pfsCategoryId: string;
  onPfsCategoryChange: (catId: string, gender: string | null, familyId: string | null) => void;
}

type MarketplaceMappingSectionProps = SimpleProps | CategoryProps | SeasonProps;

/* ─────────────────────────────────────────────
   Component
   ───────────────────────────────────────────── */

export default function MarketplaceMappingSection(props: MarketplaceMappingSectionProps) {
  const { data: pfsData, loading, error, retry } = usePfsAttributes();

  // Category filter state
  const [catGender, setCatGender] = useState("");
  const [catFamilyId, setCatFamilyId] = useState("");

  // Auto-resolve gender/family when pfsCategoryId is pre-filled (e.g., from PFS sync quick-create)
  const pfsCategoryIdProp = props.entityType === "category" ? (props as CategoryProps).pfsCategoryId : "";
  useEffect(() => {
    if (props.entityType === "category" && pfsData && pfsCategoryIdProp) {
      const matched = pfsData.categories.find(c => c.id === pfsCategoryIdProp);
      if (matched) {
        setCatGender(matched.gender);
        const famId = typeof matched.family === "string" ? matched.family : matched.family?.id;
        if (famId) setCatFamilyId(famId);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pfsData, pfsCategoryIdProp]);

  /* ── Loading / error states ── */

  if (loading) {
    return (
      <div className="border border-border rounded-xl p-4">
        <div className="flex items-center gap-2 text-text-secondary text-sm font-body">
          <div className="animate-spin h-4 w-4 border-2 border-text-secondary border-t-transparent rounded-full shrink-0" />
          Chargement des marketplaces…
        </div>
      </div>
    );
  }

  // PFS disabled via toggle → hide mapping entirely
  if (pfsData?.pfsDisabled) return null;

  if (error || !pfsData) {
    return (
      <div className="border border-dashed border-border rounded-xl p-4 space-y-2">
        <p className="text-xs font-medium text-red-500 font-body">
          Correspondance marketplace non disponible
        </p>
        {error && (
          <p className="text-[11px] text-text-muted font-body break-all">
            {error}
          </p>
        )}
        <button
          type="button"
          onClick={retry}
          className="text-xs text-text-secondary hover:text-text-primary underline font-body transition-colors"
        >
          Réessayer
        </button>
      </div>
    );
  }

  return (
    <div className="border border-border rounded-xl overflow-hidden">
      {/* Section header */}
      <div className="px-4 py-2.5 bg-bg-secondary border-b border-border flex items-center justify-between">
        <p className="text-xs font-semibold text-text-secondary font-body uppercase tracking-wider">
          Correspondances Marketplaces
        </p>
        <span className="text-[10px] text-text-muted font-semibold font-body">Optionnel</span>
      </div>

      <div className="p-4 space-y-3">
        {/* PFS marketplace */}
        <MarketplaceBlock label="Paris Fashion Shop">
          <PfsMapping {...props} pfsData={pfsData} catGender={catGender} setCatGender={setCatGender} catFamilyId={catFamilyId} setCatFamilyId={setCatFamilyId} />
        </MarketplaceBlock>

        {/* Future marketplaces will be added here as additional <MarketplaceBlock> entries */}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   Marketplace block wrapper (reusable)
   ───────────────────────────────────────────── */

function MarketplaceBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium text-text-primary font-body mb-2 flex items-center gap-1.5">
        <span className="w-2 h-2 rounded-full bg-purple-500 inline-block shrink-0" />
        {label}
      </p>
      {children}
    </div>
  );
}

/* ─────────────────────────────────────────────
   PFS Mapping (per entity type)
   ───────────────────────────────────────────── */

function PfsMapping({
  pfsData,
  catGender,
  setCatGender,
  catFamilyId,
  setCatFamilyId,
  ...props
}: MarketplaceMappingSectionProps & {
  pfsData: PfsData;
  catGender: string;
  setCatGender: (v: string) => void;
  catFamilyId: string;
  setCatFamilyId: (v: string) => void;
}) {
  const { entityType } = props;

  /* ── Color ── */
  if (entityType === "color") {
    const { pfsRef, onPfsRefChange } = props as SimpleProps;
    return (
      <CustomSelect
        value={pfsRef}
        onChange={(val) => onPfsRefChange(val)}
        size="sm"
        searchable
        className="w-full"
        aria-label="Couleur PFS"
        options={[
          { value: "", label: "— Sélectionner —" },
          ...pfsData.colors.map((pc) => ({
            value: pc.reference,
            label: `${pc.labels?.fr ?? pc.reference} (${pc.reference})`,
          })),
        ]}
      />
    );
  }

  /* ── Category (gender → family → category) ── */
  if (entityType === "category") {
    const { pfsCategoryId, onPfsCategoryChange } = props as CategoryProps;
    return <PfsCategoryMapping pfsData={pfsData} pfsCategoryId={pfsCategoryId} onPfsCategoryChange={onPfsCategoryChange} catGender={catGender} setCatGender={setCatGender} catFamilyId={catFamilyId} setCatFamilyId={setCatFamilyId} />;
  }

  /* ── Composition ── */
  if (entityType === "composition") {
    const { pfsRef, onPfsRefChange } = props as SimpleProps;
    return (
      <CustomSelect
        value={pfsRef}
        onChange={(val) => onPfsRefChange(val)}
        size="sm"
        searchable
        className="w-full"
        aria-label="Composition PFS"
        options={[
          { value: "", label: "— Sélectionner —" },
          ...pfsData.compositions.map((pc) => ({
            value: pc.reference,
            label: `${pc.labels?.fr ?? pc.reference} (${pc.reference})`,
          })),
        ]}
      />
    );
  }

  /* ── Country ── */
  if (entityType === "country") {
    const { pfsRef, onPfsRefChange } = props as SimpleProps;
    return (
      <CustomSelect
        value={pfsRef}
        onChange={(val) => onPfsRefChange(val)}
        size="sm"
        searchable
        className="w-full"
        aria-label="Pays PFS"
        options={[
          { value: "", label: "— Sélectionner —" },
          ...pfsData.countries.map((pc) => ({
            value: pc.reference,
            label: `${pc.labels?.fr ?? pc.reference} (${pc.reference})`,
          })),
        ]}
      />
    );
  }

  /* ── Season (multi-select) ── */
  if (entityType === "season") {
    const { pfsRefs, onPfsRefsChange, usedPfsRefs } = props as SeasonProps;
    const usedByOthers = new Set(usedPfsRefs ?? []);
    const available = pfsData.collections.filter((pc) => !pfsRefs.includes(pc.reference));
    return (
      <div className="space-y-2">
        {/* Selected refs as removable chips */}
        {pfsRefs.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {pfsRefs.map((ref) => {
              const col = pfsData.collections.find((c) => c.reference === ref);
              const label = col ? `${col.labels?.fr ?? col.reference} (${col.reference})` : ref;
              return (
                <span key={ref} className="inline-flex items-center gap-1 badge badge-purple text-[10px] pr-0.5">
                  {label}
                  <button
                    type="button"
                    onClick={() => onPfsRefsChange(pfsRefs.filter((r) => r !== ref))}
                    className="ml-0.5 p-0.5 rounded-full hover:bg-purple-200 transition-colors"
                    aria-label={`Retirer ${ref}`}
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </span>
              );
            })}
          </div>
        )}
        {/* Dropdown to add more */}
        <CustomSelect
          value=""
          onChange={(val) => {
            if (val && !pfsRefs.includes(val)) {
              onPfsRefsChange([...pfsRefs, val]);
            }
          }}
          size="sm"
          searchable
          className="w-full"
          aria-label="Ajouter une collection PFS"
          options={[
            { value: "", label: pfsRefs.length > 0 ? "— Ajouter une correspondance —" : "— Sélectionner —" },
            ...available.map((pc) => {
              const taken = usedByOthers.has(pc.reference);
              return {
                value: pc.reference,
                label: `${pc.labels?.fr ?? pc.reference} (${pc.reference})`,
                disabled: taken,
                className: taken ? "line-through" : undefined,
              };
            }),
          ]}
        />
      </div>
    );
  }

  return null;
}

/* ─────────────────────────────────────────────
   PFS Category mapping (3 cascading dropdowns)
   ───────────────────────────────────────────── */

function PfsCategoryMapping({
  pfsData,
  pfsCategoryId,
  onPfsCategoryChange,
  catGender,
  setCatGender,
  catFamilyId,
  setCatFamilyId,
}: {
  pfsData: PfsData;
  pfsCategoryId: string;
  onPfsCategoryChange: (catId: string, gender: string | null, familyId: string | null) => void;
  catGender: string;
  setCatGender: (v: string) => void;
  catFamilyId: string;
  setCatFamilyId: (v: string) => void;
}) {
  const availableGenders = useMemo(
    () => [...new Set(pfsData.categories.map((c) => c.gender))].sort(),
    [pfsData.categories]
  );

  const availableFamilies = useMemo(
    () => (catGender ? pfsData.families.filter((f) => f.gender === catGender) : []),
    [pfsData.families, catGender]
  );

  const availableCategories = useMemo(() => {
    if (!catGender) return [];
    return pfsData.categories.filter((c) => {
      if (c.gender !== catGender) return false;
      if (!catFamilyId) return true;
      const famId = typeof c.family === "string" ? c.family : c.family?.id;
      return famId === catFamilyId;
    });
  }, [pfsData.categories, catGender, catFamilyId]);

  const getGenderLabel = (ref: string) => {
    const g = pfsData.genders.find((g) => g.reference === ref);
    return g?.labels?.fr ?? ref;
  };

  return (
    <div className="space-y-2">
      {/* Gender */}
      <CustomSelect
        value={catGender}
        onChange={(gender) => {
          setCatGender(gender);
          setCatFamilyId("");
          onPfsCategoryChange("", null, null);
        }}
        size="sm"
        searchable
        className="w-full"
        aria-label="Genre PFS"
        options={[
          { value: "", label: "— Genre —" },
          ...availableGenders.map((g) => ({ value: g, label: getGenderLabel(g) })),
        ]}
      />
      {/* Family */}
      <CustomSelect
        value={catFamilyId}
        onChange={(familyId) => {
          setCatFamilyId(familyId);
          onPfsCategoryChange("", null, null);
        }}
        disabled={!catGender}
        size="sm"
        searchable
        className="w-full"
        aria-label="Famille PFS"
        options={[
          { value: "", label: "— Famille (toutes) —" },
          ...availableFamilies.map((f) => ({ value: f.id, label: f.labels?.fr ?? f.id })),
        ]}
      />
      {/* Category */}
      <CustomSelect
        value={pfsCategoryId}
        onChange={(val) => {
          const pfsCat = val ? pfsData.categories.find((c) => c.id === val) : null;
          const gender = pfsCat?.gender || null;
          const familyId = pfsCat
            ? (typeof pfsCat.family === "string" ? pfsCat.family : pfsCat.family?.id) || null
            : null;
          onPfsCategoryChange(val, gender, familyId);
        }}
        disabled={!catGender}
        size="sm"
        searchable
        className="w-full"
        aria-label="Catégorie PFS"
        options={[
          { value: "", label: "— Catégorie PFS —" },
          ...availableCategories.map((pc) => ({
            value: pc.id,
            label: pc.labels?.fr ?? pc.id,
          })),
        ]}
      />
    </div>
  );
}
