"use client";

import { useState, useEffect, useCallback } from "react";
import { updateColorPfsRef, updateProductColorPfsRef } from "@/app/actions/admin/colors";
import { updateCategoryPfsId } from "@/app/actions/admin/categories";
import { updateCompositionPfsRef } from "@/app/actions/admin/compositions";
import { updateManufacturingCountryPfsRef } from "@/app/actions/admin/manufacturing-countries";
import { updateSeasonPfsRefs } from "@/app/actions/admin/seasons";
import { toggleSizePfsMapping } from "@/app/actions/admin/sizes";
import CustomSelect from "@/components/ui/CustomSelect";
import PfsSizeMultiSelect from "@/components/pfs/PfsSizeMultiSelect";

interface BjColor {
  id: string;
  name: string;
  hex: string | null;
  patternImage: string | null;
  pfsColorRef: string | null;
}

interface BjCategory {
  id: string;
  name: string;
  pfsCategoryId: string | null;
  pfsGender: string | null;
  pfsFamilyId: string | null;
}

interface BjComposition {
  id: string;
  name: string;
  pfsCompositionRef: string | null;
}

interface BjCountry {
  id: string;
  name: string;
  isoCode: string | null;
  pfsCountryRef: string | null;
}

interface BjSeason {
  id: string;
  name: string;
  pfsRefs: string[];
}

interface BjSize {
  id: string;
  name: string;
  pfsMappings: { pfsSizeRef: string }[];
  categories: { category: { name: string } }[];
}

interface BjMultiColorVariant {
  id: string;
  pfsColorRef: string | null;
  color: { id: string; name: string; hex: string | null; patternImage: string | null; pfsColorRef: string | null };
  subColors: { color: { id: string; name: string; hex: string | null; patternImage: string | null }; position: number }[];
  product: { id: string; name: string; reference: string };
}

interface PfsSize {
  reference: string; // TU, XS, S, M, L, XL, 52, T36, 85A...
}

interface PfsColor {
  reference: string;
  value: string;
  image: string | null;
  labels: Record<string, string>;
}

interface PfsCategory {
  id: string;
  family: { id: string };
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
  reference: string; // ISO code
  labels: Record<string, string>;
  preview: string | null; // flag SVG
}

interface PfsCollection {
  id: string;
  reference: string; // PE2026, AH2025...
  labels: Record<string, string>;
}

interface Props {
  colors: BjColor[];
  categories: BjCategory[];
  compositions: BjComposition[];
  countries: BjCountry[];
  seasons: BjSeason[];
  sizes: BjSize[];
  multiColorVariants: BjMultiColorVariant[];
}

type Tab = "colors" | "categories" | "compositions" | "countries" | "seasons" | "sizes" | "combinations";

export default function PfsMappingClient({ colors: initialColors, categories: initialCategories, compositions: initialCompositions, countries: initialCountries, seasons: initialSeasons, sizes: initialSizes, multiColorVariants: initialMultiColorVariants }: Props) {
  const [tab, setTab] = useState<Tab>("colors");
  const [colors, setColors] = useState(initialColors);
  const [categories, setCategories] = useState(initialCategories);
  const [compositions, setCompositions] = useState(initialCompositions);
  const [countries, setCountries] = useState(initialCountries);
  const [seasons, setSeasons] = useState(initialSeasons);
  const [sizes, setSizes] = useState(initialSizes);
  const [multiColorVariants, setMultiColorVariants] = useState(initialMultiColorVariants);

  const [pfsColors, setPfsColors] = useState<PfsColor[]>([]);
  const [pfsCategories, setPfsCategories] = useState<PfsCategory[]>([]);
  const [pfsCompositions, setPfsCompositions] = useState<PfsComposition[]>([]);
  const [pfsCountries, setPfsCountries] = useState<PfsCountry[]>([]);
  const [pfsCollections, setPfsCollections] = useState<PfsCollection[]>([]);
  const [pfsFamilies, setPfsFamilies] = useState<PfsFamily[]>([]);
  const [pfsGenders, setPfsGenders] = useState<PfsGender[]>([]);
  const [pfsSizes, setPfsSizes] = useState<PfsSize[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  // Per-row filter state for category mapping: catId → { gender, familyId }
  const [catFilters, setCatFilters] = useState<Record<string, { gender: string; familyId: string }>>({});

  // Fetch PFS attributes
  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/pfs-sync/attributes")
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        setPfsColors(data.colors ?? []);
        setPfsCategories(data.categories ?? []);
        setPfsCompositions(data.compositions ?? []);
        setPfsCountries(data.countries ?? []);
        setPfsCollections(data.collections ?? []);
        setPfsFamilies(data.families ?? []);
        setPfsGenders(data.genders ?? []);
        setPfsSizes(data.sizes ?? []);
        setError(null);
      })
      .catch((err) => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // Helper: safely extract family ID from a PFS category (family can be string or {id})
  const getFamilyIdFromPfsCat = useCallback((pfsCat: PfsCategory): string => {
    if (!pfsCat.family) return "";
    if (typeof pfsCat.family === "string") return pfsCat.family;
    return pfsCat.family.id ?? "";
  }, []);

  // Initialize catFilters from already-mapped categories (only once when PFS data loads)
  const [catFiltersInitialized, setCatFiltersInitialized] = useState(false);
  useEffect(() => {
    if (pfsCategories.length === 0 || catFiltersInitialized) return;
    const initial: Record<string, { gender: string; familyId: string }> = {};
    for (const cat of categories) {
      if (cat.pfsCategoryId) {
        const pfsCat = pfsCategories.find((c) => c.id === cat.pfsCategoryId);
        if (pfsCat) {
          initial[cat.id] = { gender: pfsCat.gender, familyId: getFamilyIdFromPfsCat(pfsCat) };
        } else if (cat.pfsGender) {
          initial[cat.id] = { gender: cat.pfsGender, familyId: cat.pfsFamilyId || "" };
        }
      }
    }
    setCatFilters(initial);
    setCatFiltersInitialized(true);
  }, [pfsCategories, categories, catFiltersInitialized, getFamilyIdFromPfsCat]);

  // Helper: get family label
  const getFamilyLabel = useCallback((familyId: string) => {
    const fam = pfsFamilies.find((f) => f.id === familyId);
    return fam?.labels?.fr ?? familyId;
  }, [pfsFamilies]);

  // Helper: get gender label
  const getGenderLabel = useCallback((genderRef: string) => {
    const g = pfsGenders.find((g) => g.reference === genderRef);
    return g?.labels?.fr ?? genderRef;
  }, [pfsGenders]);

  const handleSaveColor = useCallback(async (colorId: string, pfsRef: string | null) => {
    setSaving(colorId);
    try {
      await updateColorPfsRef(colorId, pfsRef || null);
      setColors((prev) => prev.map((c) => (c.id === colorId ? { ...c, pfsColorRef: pfsRef } : c)));
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erreur");
    }
    setSaving(null);
  }, []);

  const handleSaveCategory = useCallback(async (catId: string, pfsCatId: string | null) => {
    setSaving(catId);
    try {
      // Find the selected PFS category to extract gender + familyId
      const pfsCat = pfsCatId ? pfsCategories.find((c) => c.id === pfsCatId) : null;
      const pfsGender = pfsCat?.gender || null;
      const pfsFamilyId = pfsCat ? (typeof pfsCat.family === "string" ? pfsCat.family : pfsCat.family?.id) || null : null;
      await updateCategoryPfsId(catId, pfsCatId || null, pfsGender, pfsFamilyId);
      setCategories((prev) => prev.map((c) => (c.id === catId ? { ...c, pfsCategoryId: pfsCatId, pfsGender, pfsFamilyId } : c)));
      // Keep filter state in sync when a PFS category is selected
      if (pfsCat) {
        const famId = typeof pfsCat.family === "string" ? pfsCat.family : pfsCat.family?.id ?? "";
        setCatFilters((prev) => ({
          ...prev,
          [catId]: { gender: pfsCat.gender, familyId: famId },
        }));
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erreur");
    }
    setSaving(null);
  }, [pfsCategories]);

  const handleSaveComposition = useCallback(async (compId: string, pfsRef: string | null) => {
    setSaving(compId);
    try {
      await updateCompositionPfsRef(compId, pfsRef || null);
      setCompositions((prev) => prev.map((c) => (c.id === compId ? { ...c, pfsCompositionRef: pfsRef } : c)));
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erreur");
    }
    setSaving(null);
  }, []);

  const handleSaveCountry = useCallback(async (countryId: string, pfsRef: string | null) => {
    setSaving(countryId);
    try {
      await updateManufacturingCountryPfsRef(countryId, pfsRef || null);
      setCountries((prev) => prev.map((c) => (c.id === countryId ? { ...c, pfsCountryRef: pfsRef } : c)));
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erreur");
    }
    setSaving(null);
  }, []);

  const handleSaveSeason = useCallback(async (seasonId: string, pfsRefs: string[]) => {
    setSaving(seasonId);
    try {
      await updateSeasonPfsRefs(seasonId, pfsRefs);
      setSeasons((prev) => prev.map((s) => (s.id === seasonId ? { ...s, pfsRefs } : s)));
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erreur");
    }
    setSaving(null);
  }, []);

  const handleToggleSizeMapping = useCallback(async (sizeId: string, pfsSizeRef: string) => {
    setSaving(sizeId);
    try {
      const updatedRefs = await toggleSizePfsMapping(sizeId, pfsSizeRef);
      setSizes((prev) => prev.map((s) =>
        s.id === sizeId
          ? { ...s, pfsMappings: updatedRefs.map((ref) => ({ pfsSizeRef: ref })) }
          : s
      ));
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erreur");
    }
    setSaving(null);
  }, []);

  const handleSaveMultiColorRef = useCallback(async (productColorId: string, pfsRef: string | null) => {
    setSaving(productColorId);
    try {
      await updateProductColorPfsRef(productColorId, pfsRef || null);
      setMultiColorVariants((prev) => prev.map((v) => (v.id === productColorId ? { ...v, pfsColorRef: pfsRef } : v)));
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erreur");
    }
    setSaving(null);
  }, []);

  // Auto-map sizes: if Boutique size name matches a PFS size reference exactly and has no mappings yet
  const [sizeAutoMapDone, setSizeAutoMapDone] = useState(false);
  useEffect(() => {
    if (pfsSizes.length === 0 || sizeAutoMapDone) return;
    const pfsRefSet = new Set(pfsSizes.map((s) => s.reference));
    const toAutoMap = sizes.filter((s) => s.pfsMappings.length === 0 && pfsRefSet.has(s.name));
    if (toAutoMap.length > 0) {
      for (const s of toAutoMap) {
        handleToggleSizeMapping(s.id, s.name);
      }
    }
    setSizeAutoMapDone(true);
  }, [pfsSizes, sizes, sizeAutoMapDone, handleToggleSizeMapping]);

  const tabs: { key: Tab; label: string; count: number; mapped: number }[] = [
    { key: "colors", label: "Couleurs", count: colors.length, mapped: colors.filter((c) => c.pfsColorRef).length },
    { key: "categories", label: "Catégories", count: categories.length, mapped: categories.filter((c) => c.pfsCategoryId).length },
    { key: "compositions", label: "Compositions", count: compositions.length, mapped: compositions.filter((c) => c.pfsCompositionRef).length },
    { key: "countries", label: "Pays", count: countries.length, mapped: countries.filter((c) => c.pfsCountryRef).length },
    { key: "seasons", label: "Saisons", count: seasons.length, mapped: seasons.filter((s) => s.pfsRefs.length > 0).length },
    { key: "sizes", label: "Tailles", count: sizes.length, mapped: sizes.filter((s) => s.pfsMappings.length > 0).length },
    ...(multiColorVariants.length > 0 ? [{ key: "combinations" as const, label: "Combinaisons", count: multiColorVariants.length, mapped: multiColorVariants.filter((v) => v.pfsColorRef).length }] : []),
  ];

  // Compute used PFS refs to prevent duplicates (a PFS ref can only be linked to ONE Boutique entity)
  const usedColorRefs = new Set(colors.filter((c) => c.pfsColorRef).map((c) => c.pfsColorRef!));
  const usedCategoryIds = new Set(categories.filter((c) => c.pfsCategoryId).map((c) => c.pfsCategoryId!));
  const usedCompositionRefs = new Set(compositions.filter((c) => c.pfsCompositionRef).map((c) => c.pfsCompositionRef!));
  const usedCountryRefs = new Set(countries.filter((c) => c.pfsCountryRef).map((c) => c.pfsCountryRef!));
  const usedSeasonRefs = new Set(seasons.flatMap((s) => s.pfsRefs));

  const filteredColors = colors.filter((c) => c.name.toLowerCase().includes(search.toLowerCase()));
  const filteredCategories = categories.filter((c) => c.name.toLowerCase().includes(search.toLowerCase()));
  const filteredCompositions = compositions.filter((c) => c.name.toLowerCase().includes(search.toLowerCase()));
  const filteredCountries = countries.filter((c) => c.name.toLowerCase().includes(search.toLowerCase()));
  const filteredSeasons = seasons.filter((s) => s.name.toLowerCase().includes(search.toLowerCase()));
  const filteredSizes = sizes.filter((s) => s.name.toLowerCase().includes(search.toLowerCase()));
  const filteredMultiColor = multiColorVariants.filter((v) => {
    const q = search.toLowerCase();
    const colorNames = [v.color.name, ...v.subColors.map((sc) => sc.color.name)].join(" ").toLowerCase();
    return colorNames.includes(q) || v.product.name.toLowerCase().includes(q) || v.product.reference.toLowerCase().includes(q);
  });

  if (loading) {
    return (
      <div className="card p-12 text-center">
        <div className="animate-spin h-8 w-8 border-2 border-text-primary border-t-transparent rounded-full mx-auto mb-3" />
        <p className="text-text-secondary">Chargement des attributs PFS...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card p-8 text-center">
        <p className="text-red-500 mb-2">Erreur de connexion PFS</p>
        <p className="text-text-secondary text-sm">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Tabs */}
      <div className="flex gap-2 border-b border-border pb-2 overflow-x-auto flex-nowrap">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => { setTab(t.key); setSearch(""); }}
            className={`px-4 py-2 rounded-t-lg text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
              tab === t.key
                ? "bg-bg-primary text-text-primary border border-b-0 border-border"
                : "text-text-secondary hover:text-text-primary"
            }`}
          >
            {t.label}
            <span className="ml-2 text-xs">
              <span className="text-green-500">{t.mapped}</span>
              <span className="text-text-secondary">/{t.count}</span>
            </span>
          </button>
        ))}
      </div>

      {/* Search */}
      <input
        type="text"
        placeholder="Rechercher..."
        aria-label="Rechercher dans les mappings"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="field-input w-full max-w-sm"
      />

      {/* Color mapping */}
      {tab === "colors" && (
        <div className="card overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="table-header">
                <th className="text-left p-3">Couleur Boutique</th>
                <th className="text-left p-3">Aperçu</th>
                <th className="text-left p-3">Couleur PFS</th>
                <th className="text-left p-3 w-20">Statut</th>
              </tr>
            </thead>
            <tbody>
              {filteredColors.map((color) => (
                <tr key={color.id} className="table-row">
                  <td className="p-3 font-medium">{color.name}</td>
                  <td className="p-3">
                    {color.patternImage ? (
                      <div className="w-6 h-6 rounded-full bg-cover bg-center border" style={{ backgroundImage: `url(${color.patternImage})` }} />
                    ) : color.hex ? (
                      <div className="w-6 h-6 rounded-full border" style={{ backgroundColor: color.hex }} />
                    ) : (
                      <span className="text-text-secondary text-xs">—</span>
                    )}
                  </td>
                  <td className="p-3">
                    <CustomSelect
                      value={color.pfsColorRef ?? ""}
                      onChange={(val) => handleSaveColor(color.id, val || null)}
                      disabled={saving === color.id}
                      size="sm"
                      searchable
                      className="max-w-[280px]"
                      aria-label={`Couleur PFS pour ${color.name}`}
                      options={[
                        { value: "", label: "— Non lié —" },
                        ...pfsColors.map((pc) => {
                          const taken = usedColorRefs.has(pc.reference) && color.pfsColorRef !== pc.reference;
                          return {
                            value: pc.reference,
                            label: `${pc.labels?.fr ?? pc.reference} (${pc.reference})${taken ? " ✗ déjà lié" : ""}`,
                            disabled: taken,
                          };
                        }),
                      ]}
                    />
                  </td>
                  <td className="p-3">
                    {saving === color.id ? (
                      <span className="text-text-secondary text-xs">...</span>
                    ) : color.pfsColorRef ? (
                      <span className="badge badge-success">Lié</span>
                    ) : (
                      <span className="badge badge-neutral">Non lié</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Category mapping — hierarchical: Genre → Famille → Catégorie */}
      {tab === "categories" && (
        <div className="card overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="table-header">
                <th className="text-left p-3">Catégorie Boutique</th>
                <th className="text-left p-3">Genre PFS</th>
                <th className="text-left p-3">Famille PFS</th>
                <th className="text-left p-3">Catégorie PFS</th>
                <th className="text-left p-3 w-20">Statut</th>
              </tr>
            </thead>
            <tbody>
              {filteredCategories.map((cat) => {
                const filter = catFilters[cat.id] ?? { gender: "", familyId: "" };
                // Available genders from PFS data
                const availableGenders = [...new Set(pfsCategories.map((c) => c.gender))].sort();
                // Families for the selected gender
                const availableFamilies = filter.gender
                  ? pfsFamilies.filter((f) => f.gender === filter.gender)
                  : [];
                // Categories for the selected gender + family
                const availableCategoriesForRow = filter.gender
                  ? pfsCategories.filter((c) => {
                      if (c.gender !== filter.gender) return false;
                      if (!filter.familyId) return true;
                      const famId = typeof c.family === "string" ? c.family : c.family?.id;
                      return famId === filter.familyId;
                    })
                  : [];

                return (
                  <tr key={cat.id} className="table-row align-top">
                    <td className="p-3 font-medium">{cat.name}</td>
                    {/* Genre dropdown — filter only, doesn't change mapping */}
                    <td className="p-3">
                      <CustomSelect
                        value={filter.gender}
                        onChange={(gender) => setCatFilters((prev) => ({
                          ...prev,
                          [cat.id]: { gender, familyId: "" },
                        }))}
                        disabled={saving === cat.id}
                        size="sm"
                        searchable
                        className="w-full min-w-[130px]"
                        aria-label="Filtrer par genre"
                        options={[
                          { value: "", label: "— Genre —" },
                          ...availableGenders.map((g) => ({ value: g, label: getGenderLabel(g) })),
                        ]}
                      />
                    </td>
                    {/* Famille dropdown — filter only, doesn't change mapping */}
                    <td className="p-3">
                      <CustomSelect
                        value={filter.familyId}
                        onChange={(familyId) => setCatFilters((prev) => ({
                          ...prev,
                          [cat.id]: { ...prev[cat.id], familyId },
                        }))}
                        disabled={saving === cat.id || !filter.gender}
                        size="sm"
                        searchable
                        className="w-full min-w-[180px]"
                        aria-label="Filtrer par famille"
                        options={[
                          { value: "", label: "— Toutes —" },
                          ...availableFamilies.map((f) => ({ value: f.id, label: f.labels?.fr ?? f.id })),
                        ]}
                      />
                    </td>
                    {/* Catégorie PFS dropdown — filtered */}
                    <td className="p-3">
                      <CustomSelect
                        value={cat.pfsCategoryId ?? ""}
                        onChange={(val) => handleSaveCategory(cat.id, val || null)}
                        disabled={saving === cat.id || !filter.gender}
                        size="sm"
                        searchable
                        className="w-full min-w-[220px]"
                        aria-label={`Catégorie PFS pour ${cat.name}`}
                        options={[
                          { value: "", label: "— Catégorie —" },
                          ...availableCategoriesForRow.map((pc) => {
                            const taken = usedCategoryIds.has(pc.id) && cat.pfsCategoryId !== pc.id;
                            return {
                              value: pc.id,
                              label: `${pc.labels?.fr ?? pc.id}${taken ? " ✗ déjà liée" : ""}`,
                              disabled: taken,
                            };
                          }),
                        ]}
                      />
                    </td>
                    <td className="p-3">
                      {saving === cat.id ? (
                        <span className="text-text-secondary text-xs">...</span>
                      ) : cat.pfsCategoryId ? (
                        <span className="badge badge-success">Liée</span>
                      ) : (
                        <span className="badge badge-neutral">Non liée</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Composition mapping */}
      {tab === "compositions" && (
        <div className="card overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="table-header">
                <th className="text-left p-3">Composition Boutique</th>
                <th className="text-left p-3">Composition PFS</th>
                <th className="text-left p-3 w-20">Statut</th>
              </tr>
            </thead>
            <tbody>
              {filteredCompositions.map((comp) => (
                <tr key={comp.id} className="table-row">
                  <td className="p-3 font-medium">{comp.name}</td>
                  <td className="p-3">
                    <CustomSelect
                      value={comp.pfsCompositionRef ?? ""}
                      onChange={(val) => handleSaveComposition(comp.id, val || null)}
                      disabled={saving === comp.id}
                      size="sm"
                      searchable
                      className="max-w-[350px]"
                      aria-label={`Composition PFS pour ${comp.name}`}
                      options={[
                        { value: "", label: "— Non liée —" },
                        ...pfsCompositions.map((pc) => {
                          const taken = usedCompositionRefs.has(pc.reference) && comp.pfsCompositionRef !== pc.reference;
                          return {
                            value: pc.reference,
                            label: `${pc.labels?.fr ?? pc.reference} (${pc.reference})${taken ? " ✗ déjà liée" : ""}`,
                            disabled: taken,
                          };
                        }),
                      ]}
                    />
                  </td>
                  <td className="p-3">
                    {saving === comp.id ? (
                      <span className="text-text-secondary text-xs">...</span>
                    ) : comp.pfsCompositionRef ? (
                      <span className="badge badge-success">Liée</span>
                    ) : (
                      <span className="badge badge-neutral">Non liée</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Country mapping */}
      {tab === "countries" && (
        <div className="card overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="table-header">
                <th className="text-left p-3">Pays Boutique</th>
                <th className="text-left p-3">Code ISO</th>
                <th className="text-left p-3">Pays PFS</th>
                <th className="text-left p-3 w-20">Statut</th>
              </tr>
            </thead>
            <tbody>
              {filteredCountries.map((country) => (
                <tr key={country.id} className="table-row">
                  <td className="p-3 font-medium">{country.name}</td>
                  <td className="p-3">
                    {country.isoCode ? (
                      <span className="badge badge-info">{country.isoCode}</span>
                    ) : (
                      <span className="text-text-secondary text-xs">—</span>
                    )}
                  </td>
                  <td className="p-3">
                    <CustomSelect
                      value={country.pfsCountryRef ?? ""}
                      onChange={(val) => handleSaveCountry(country.id, val || null)}
                      disabled={saving === country.id}
                      size="sm"
                      searchable
                      className="max-w-[350px]"
                      aria-label={`Pays PFS pour ${country.name}`}
                      options={[
                        { value: "", label: "— Non lié —" },
                        ...pfsCountries.map((pc) => {
                          const taken = usedCountryRefs.has(pc.reference) && country.pfsCountryRef !== pc.reference;
                          return {
                            value: pc.reference,
                            label: `${pc.labels?.fr ?? pc.reference} (${pc.reference})${taken ? " ✗ déjà lié" : ""}`,
                            disabled: taken,
                          };
                        }),
                      ]}
                    />
                  </td>
                  <td className="p-3">
                    {saving === country.id ? (
                      <span className="text-text-secondary text-xs">...</span>
                    ) : country.pfsCountryRef ? (
                      <span className="badge badge-success">Lié</span>
                    ) : (
                      <span className="badge badge-neutral">Non lié</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Season mapping */}
      {tab === "seasons" && (
        <div className="card overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="table-header">
                <th className="text-left p-3">Saison Boutique</th>
                <th className="text-left p-3">Collection PFS</th>
                <th className="text-left p-3 w-20">Statut</th>
              </tr>
            </thead>
            <tbody>
              {filteredSeasons.map((season) => (
                <tr key={season.id} className="table-row">
                  <td className="p-3 font-medium">{season.name}</td>
                  <td className="p-3">
                    <div className="max-w-[350px] space-y-1.5">
                      {/* Selected refs as removable chips */}
                      {season.pfsRefs.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {season.pfsRefs.map((ref) => {
                            const col = pfsCollections.find((c) => c.reference === ref);
                            return (
                              <span key={ref} className="inline-flex items-center gap-1 badge badge-purple text-[10px] pr-0.5">
                                {col ? `${col.labels?.fr ?? ref} (${ref})` : ref}
                                <button
                                  type="button"
                                  disabled={saving === season.id}
                                  onClick={() => handleSaveSeason(season.id, season.pfsRefs.filter((r) => r !== ref))}
                                  className="ml-0.5 p-0.5 rounded-full hover:bg-purple-200 transition-colors disabled:opacity-50"
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
                      {/* Dropdown to add */}
                      <CustomSelect
                        value=""
                        onChange={(val) => {
                          if (val && !season.pfsRefs.includes(val)) {
                            handleSaveSeason(season.id, [...season.pfsRefs, val]);
                          }
                        }}
                        disabled={saving === season.id}
                        size="sm"
                        searchable
                        className="w-full"
                        aria-label={`Ajouter une collection PFS pour ${season.name}`}
                        options={[
                          { value: "", label: season.pfsRefs.length > 0 ? "— Ajouter —" : "— Non liée —" },
                          ...pfsCollections
                            .filter((pc) => !season.pfsRefs.includes(pc.reference))
                            .map((pc) => {
                              const taken = usedSeasonRefs.has(pc.reference) && !season.pfsRefs.includes(pc.reference);
                              return {
                                value: pc.reference,
                                label: `${pc.labels?.fr ?? pc.reference} (${pc.reference})${taken ? " ✗ déjà liée" : ""}`,
                                disabled: taken,
                              };
                            }),
                        ]}
                      />
                    </div>
                  </td>
                  <td className="p-3">
                    {saving === season.id ? (
                      <span className="text-text-secondary text-xs">...</span>
                    ) : season.pfsRefs.length > 0 ? (
                      <span className="badge badge-success">Liée ({season.pfsRefs.length})</span>
                    ) : (
                      <span className="badge badge-neutral">Non liée</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Size mapping — dropdown multi-select with grouped PFS sizes */}
      {tab === "sizes" && (
        <div className="card overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="table-header">
                <th className="text-left p-3">Taille Boutique</th>
                <th className="text-left p-3">Catégories Boutique</th>
                <th className="text-left p-3">Tailles PFS liées</th>
                <th className="text-left p-3 w-24">Statut</th>
              </tr>
            </thead>
            <tbody>
              {filteredSizes.length === 0 && (
                <tr>
                  <td colSpan={4} className="p-8 text-center text-sm text-text-secondary">
                    Aucune taille trouvée
                  </td>
                </tr>
              )}
              {filteredSizes.map((bjSize) => {
                const isSaving = saving === bjSize.id;
                const cats = bjSize.categories.map((c) => c.category.name).join(", ");
                const mappedRefs = new Set(bjSize.pfsMappings.map((m) => m.pfsSizeRef));

                return (
                  <tr key={bjSize.id} className="table-row">
                    <td className="p-3 font-semibold text-sm font-heading">
                      {bjSize.name}
                    </td>
                    <td className="p-3 text-xs text-text-secondary font-body">
                      {cats || <span className="opacity-40">—</span>}
                    </td>
                    <td className="p-3">
                      <PfsSizeMultiSelect
                        pfsSizes={pfsSizes}
                        selected={mappedRefs}
                        onToggle={(ref) => handleToggleSizeMapping(bjSize.id, ref)}
                        disabled={isSaving}
                        className="min-w-[220px] max-w-[320px]"
                      />
                    </td>
                    <td className="p-3">
                      {isSaving ? (
                        <span className="text-text-secondary text-xs">...</span>
                      ) : mappedRefs.size > 0 ? (
                        <span className="badge badge-success">{mappedRefs.size} PFS</span>
                      ) : (
                        <span className="badge badge-neutral">Non liée</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Multi-color combinations mapping */}
      {tab === "combinations" && (
        <div className="space-y-3">
          <p className="text-sm text-text-secondary">
            Les variantes avec plusieurs couleurs doivent être liées à une couleur PFS unique pour la synchronisation.
            Ce mapping est prioritaire sur le mapping individuel de chaque couleur.
          </p>
          <div className="card overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="table-header">
                  <th className="text-left p-3">Produit</th>
                  <th className="text-left p-3">Combinaison</th>
                  <th className="text-left p-3">Couleur PFS</th>
                  <th className="text-left p-3 w-20">Statut</th>
                </tr>
              </thead>
              <tbody>
                {filteredMultiColor.length === 0 && (
                  <tr>
                    <td colSpan={4} className="p-8 text-center text-sm text-text-secondary">
                      Aucune combinaison multi-couleur trouvée
                    </td>
                  </tr>
                )}
                {filteredMultiColor.map((variant) => {
                  const allColors = [variant.color, ...variant.subColors.map((sc) => sc.color)];
                  const comboLabel = allColors.map((c) => c.name).join(" + ");
                  const effectiveRef = variant.pfsColorRef || variant.color.pfsColorRef;

                  return (
                    <tr key={variant.id} className="table-row">
                      <td className="p-3">
                        <div className="text-sm font-medium">{variant.product.name}</div>
                        <div className="text-xs text-text-secondary">{variant.product.reference}</div>
                      </td>
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <div className="flex -space-x-1">
                            {allColors.map((c, i) => (
                              <div key={i} title={c.name}>
                                {c.patternImage ? (
                                  <div className="w-6 h-6 rounded-full bg-cover bg-center border-2 border-bg-primary" style={{ backgroundImage: `url(${c.patternImage})` }} />
                                ) : c.hex ? (
                                  <div className="w-6 h-6 rounded-full border-2 border-bg-primary" style={{ backgroundColor: c.hex }} />
                                ) : (
                                  <div className="w-6 h-6 rounded-full border-2 border-bg-primary bg-bg-secondary" />
                                )}
                              </div>
                            ))}
                          </div>
                          <span className="text-sm">{comboLabel}</span>
                        </div>
                      </td>
                      <td className="p-3">
                        <CustomSelect
                          value={variant.pfsColorRef ?? ""}
                          onChange={(val) => handleSaveMultiColorRef(variant.id, val || null)}
                          disabled={saving === variant.id}
                          size="sm"
                          searchable
                          className="max-w-[280px]"
                          aria-label={`Couleur PFS pour ${comboLabel}`}
                          options={[
                            { value: "", label: effectiveRef ? `— Hérité : ${effectiveRef} —` : "— Non lié —" },
                            ...pfsColors.map((pc) => ({
                              value: pc.reference,
                              label: `${pc.labels?.fr ?? pc.reference} (${pc.reference})`,
                            })),
                          ]}
                        />
                      </td>
                      <td className="p-3">
                        {saving === variant.id ? (
                          <span className="text-text-secondary text-xs">...</span>
                        ) : variant.pfsColorRef ? (
                          <span className="badge badge-success">Override</span>
                        ) : effectiveRef ? (
                          <span className="badge badge-info">Hérité</span>
                        ) : (
                          <span className="badge badge-warning">Non lié</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Summary */}
      <div className="flex flex-wrap gap-4 text-sm text-text-secondary">
        <span>Couleurs liées : {colors.filter((c) => c.pfsColorRef).length}/{colors.length}</span>
        <span>Catégories liées : {categories.filter((c) => c.pfsCategoryId).length}/{categories.length}</span>
        <span>Compositions liées : {compositions.filter((c) => c.pfsCompositionRef).length}/{compositions.length}</span>
        <span>Pays liés : {countries.filter((c) => c.pfsCountryRef).length}/{countries.length}</span>
        <span>Saisons liées : {seasons.filter((s) => s.pfsRefs.length > 0).length}/{seasons.length}</span>
        <span>Tailles liées : {sizes.filter((s) => s.pfsMappings.length > 0).length}/{sizes.length}</span>
        {multiColorVariants.length > 0 && (
          <span>Combinaisons liées : {multiColorVariants.filter((v) => v.pfsColorRef || v.color.pfsColorRef).length}/{multiColorVariants.length}</span>
        )}
      </div>
    </div>
  );
}
