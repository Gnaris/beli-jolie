"use client";

import { useState, useEffect, useCallback } from "react";
import { updateColorPfsRef } from "@/app/actions/admin/colors";
import { updateCategoryPfsId } from "@/app/actions/admin/categories";
import { updateCompositionPfsRef } from "@/app/actions/admin/compositions";
import { updateManufacturingCountryPfsRef } from "@/app/actions/admin/manufacturing-countries";
import { updateSeasonPfsRef } from "@/app/actions/admin/seasons";

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
  pfsSeasonRef: string | null;
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
}

type Tab = "colors" | "categories" | "compositions" | "countries" | "seasons";

export default function PfsMappingClient({ colors: initialColors, categories: initialCategories, compositions: initialCompositions, countries: initialCountries, seasons: initialSeasons }: Props) {
  const [tab, setTab] = useState<Tab>("colors");
  const [colors, setColors] = useState(initialColors);
  const [categories, setCategories] = useState(initialCategories);
  const [compositions, setCompositions] = useState(initialCompositions);
  const [countries, setCountries] = useState(initialCountries);
  const [seasons, setSeasons] = useState(initialSeasons);

  const [pfsColors, setPfsColors] = useState<PfsColor[]>([]);
  const [pfsCategories, setPfsCategories] = useState<PfsCategory[]>([]);
  const [pfsCompositions, setPfsCompositions] = useState<PfsComposition[]>([]);
  const [pfsCountries, setPfsCountries] = useState<PfsCountry[]>([]);
  const [pfsCollections, setPfsCollections] = useState<PfsCollection[]>([]);
  const [pfsFamilies, setPfsFamilies] = useState<PfsFamily[]>([]);
  const [pfsGenders, setPfsGenders] = useState<PfsGender[]>([]);
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

  const handleSaveSeason = useCallback(async (seasonId: string, pfsRef: string | null) => {
    setSaving(seasonId);
    try {
      await updateSeasonPfsRef(seasonId, pfsRef || null);
      setSeasons((prev) => prev.map((s) => (s.id === seasonId ? { ...s, pfsSeasonRef: pfsRef } : s)));
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erreur");
    }
    setSaving(null);
  }, []);

  const tabs: { key: Tab; label: string; count: number; mapped: number }[] = [
    { key: "colors", label: "Couleurs", count: colors.length, mapped: colors.filter((c) => c.pfsColorRef).length },
    { key: "categories", label: "Catégories", count: categories.length, mapped: categories.filter((c) => c.pfsCategoryId).length },
    { key: "compositions", label: "Compositions", count: compositions.length, mapped: compositions.filter((c) => c.pfsCompositionRef).length },
    { key: "countries", label: "Pays", count: countries.length, mapped: countries.filter((c) => c.pfsCountryRef).length },
    { key: "seasons", label: "Saisons", count: seasons.length, mapped: seasons.filter((s) => s.pfsSeasonRef).length },
  ];

  // Compute used PFS refs to prevent duplicates (a PFS ref can only be linked to ONE BJ entity)
  const usedColorRefs = new Set(colors.filter((c) => c.pfsColorRef).map((c) => c.pfsColorRef!));
  const usedCategoryIds = new Set(categories.filter((c) => c.pfsCategoryId).map((c) => c.pfsCategoryId!));
  const usedCompositionRefs = new Set(compositions.filter((c) => c.pfsCompositionRef).map((c) => c.pfsCompositionRef!));
  const usedCountryRefs = new Set(countries.filter((c) => c.pfsCountryRef).map((c) => c.pfsCountryRef!));
  const usedSeasonRefs = new Set(seasons.filter((s) => s.pfsSeasonRef).map((s) => s.pfsSeasonRef!));

  const filteredColors = colors.filter((c) => c.name.toLowerCase().includes(search.toLowerCase()));
  const filteredCategories = categories.filter((c) => c.name.toLowerCase().includes(search.toLowerCase()));
  const filteredCompositions = compositions.filter((c) => c.name.toLowerCase().includes(search.toLowerCase()));
  const filteredCountries = countries.filter((c) => c.name.toLowerCase().includes(search.toLowerCase()));
  const filteredSeasons = seasons.filter((s) => s.name.toLowerCase().includes(search.toLowerCase()));

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
                <th className="text-left p-3">Couleur BJ</th>
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
                    <select
                      value={color.pfsColorRef ?? ""}
                      onChange={(e) => handleSaveColor(color.id, e.target.value || null)}
                      disabled={saving === color.id}
                      className="field-input py-1.5 text-sm max-w-[280px]"
                    >
                      <option value="">— Non lié —</option>
                      {pfsColors.map((pc) => {
                        const taken = usedColorRefs.has(pc.reference) && color.pfsColorRef !== pc.reference;
                        return (
                          <option key={pc.reference} value={pc.reference} disabled={taken}>
                            {pc.labels?.fr ?? pc.reference} ({pc.reference}){taken ? " ✗ déjà lié" : ""}
                          </option>
                        );
                      })}
                    </select>
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
                <th className="text-left p-3">Catégorie BJ</th>
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
                      <select
                        value={filter.gender}
                        onChange={(e) => {
                          const gender = e.target.value;
                          setCatFilters((prev) => ({
                            ...prev,
                            [cat.id]: { gender, familyId: "" },
                          }));
                        }}
                        disabled={saving === cat.id}
                        className="field-input py-1.5 text-sm w-full min-w-[130px]"
                      >
                        <option value="">— Genre —</option>
                        {availableGenders.map((g) => (
                          <option key={g} value={g}>
                            {getGenderLabel(g)}
                          </option>
                        ))}
                      </select>
                    </td>
                    {/* Famille dropdown — filter only, doesn't change mapping */}
                    <td className="p-3">
                      <select
                        value={filter.familyId}
                        onChange={(e) => {
                          const familyId = e.target.value;
                          setCatFilters((prev) => ({
                            ...prev,
                            [cat.id]: { ...prev[cat.id], familyId },
                          }));
                        }}
                        disabled={saving === cat.id || !filter.gender}
                        className="field-input py-1.5 text-sm w-full min-w-[180px]"
                      >
                        <option value="">— Toutes —</option>
                        {availableFamilies.map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.labels?.fr ?? f.id}
                          </option>
                        ))}
                      </select>
                    </td>
                    {/* Catégorie PFS dropdown — filtered */}
                    <td className="p-3">
                      <select
                        value={cat.pfsCategoryId ?? ""}
                        onChange={(e) => handleSaveCategory(cat.id, e.target.value || null)}
                        disabled={saving === cat.id || !filter.gender}
                        className="field-input py-1.5 text-sm w-full min-w-[220px]"
                      >
                        <option value="">— Catégorie —</option>
                        {availableCategoriesForRow.map((pc) => {
                          const taken = usedCategoryIds.has(pc.id) && cat.pfsCategoryId !== pc.id;
                          return (
                            <option key={pc.id} value={pc.id} disabled={taken}>
                              {pc.labels?.fr ?? pc.id}{taken ? " ✗ déjà liée" : ""}
                            </option>
                          );
                        })}
                      </select>
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
                <th className="text-left p-3">Composition BJ</th>
                <th className="text-left p-3">Composition PFS</th>
                <th className="text-left p-3 w-20">Statut</th>
              </tr>
            </thead>
            <tbody>
              {filteredCompositions.map((comp) => (
                <tr key={comp.id} className="table-row">
                  <td className="p-3 font-medium">{comp.name}</td>
                  <td className="p-3">
                    <select
                      value={comp.pfsCompositionRef ?? ""}
                      onChange={(e) => handleSaveComposition(comp.id, e.target.value || null)}
                      disabled={saving === comp.id}
                      className="field-input py-1.5 text-sm max-w-[350px]"
                    >
                      <option value="">— Non liée —</option>
                      {pfsCompositions.map((pc) => {
                        const taken = usedCompositionRefs.has(pc.reference) && comp.pfsCompositionRef !== pc.reference;
                        return (
                          <option key={pc.reference} value={pc.reference} disabled={taken}>
                            {pc.labels?.fr ?? pc.reference} ({pc.reference}){taken ? " ✗ déjà liée" : ""}
                          </option>
                        );
                      })}
                    </select>
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
                <th className="text-left p-3">Pays BJ</th>
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
                    <select
                      value={country.pfsCountryRef ?? ""}
                      onChange={(e) => handleSaveCountry(country.id, e.target.value || null)}
                      disabled={saving === country.id}
                      className="field-input py-1.5 text-sm max-w-[350px]"
                    >
                      <option value="">— Non lié —</option>
                      {pfsCountries.map((pc) => {
                        const taken = usedCountryRefs.has(pc.reference) && country.pfsCountryRef !== pc.reference;
                        return (
                          <option key={pc.reference} value={pc.reference} disabled={taken}>
                            {pc.labels?.fr ?? pc.reference} ({pc.reference}){taken ? " ✗ déjà lié" : ""}
                          </option>
                        );
                      })}
                    </select>
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
                <th className="text-left p-3">Saison BJ</th>
                <th className="text-left p-3">Collection PFS</th>
                <th className="text-left p-3 w-20">Statut</th>
              </tr>
            </thead>
            <tbody>
              {filteredSeasons.map((season) => (
                <tr key={season.id} className="table-row">
                  <td className="p-3 font-medium">{season.name}</td>
                  <td className="p-3">
                    <select
                      value={season.pfsSeasonRef ?? ""}
                      onChange={(e) => handleSaveSeason(season.id, e.target.value || null)}
                      disabled={saving === season.id}
                      className="field-input py-1.5 text-sm max-w-[350px]"
                    >
                      <option value="">— Non liée —</option>
                      {pfsCollections.map((pc) => {
                        const taken = usedSeasonRefs.has(pc.reference) && season.pfsSeasonRef !== pc.reference;
                        return (
                          <option key={pc.reference} value={pc.reference} disabled={taken}>
                            {pc.labels?.fr ?? pc.reference} ({pc.reference}){taken ? " ✗ déjà liée" : ""}
                          </option>
                        );
                      })}
                    </select>
                  </td>
                  <td className="p-3">
                    {saving === season.id ? (
                      <span className="text-text-secondary text-xs">...</span>
                    ) : season.pfsSeasonRef ? (
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

      {/* Summary */}
      <div className="flex flex-wrap gap-4 text-sm text-text-secondary">
        <span>Couleurs liées : {colors.filter((c) => c.pfsColorRef).length}/{colors.length}</span>
        <span>Catégories liées : {categories.filter((c) => c.pfsCategoryId).length}/{categories.length}</span>
        <span>Compositions liées : {compositions.filter((c) => c.pfsCompositionRef).length}/{compositions.length}</span>
        <span>Pays liés : {countries.filter((c) => c.pfsCountryRef).length}/{countries.length}</span>
        <span>Saisons liées : {seasons.filter((s) => s.pfsSeasonRef).length}/{seasons.length}</span>
      </div>
    </div>
  );
}
