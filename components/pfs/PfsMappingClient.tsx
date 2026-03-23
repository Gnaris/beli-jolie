"use client";

import { useState, useEffect, useCallback } from "react";
import { updateColorPfsRef } from "@/app/actions/admin/colors";
import { updateCategoryPfsId } from "@/app/actions/admin/categories";
import { updateCompositionPfsRef } from "@/app/actions/admin/compositions";

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
}

interface BjComposition {
  id: string;
  name: string;
  pfsCompositionRef: string | null;
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

interface PfsComposition {
  id: string;
  reference: string;
  labels: Record<string, string>;
}

interface Props {
  colors: BjColor[];
  categories: BjCategory[];
  compositions: BjComposition[];
}

type Tab = "colors" | "categories" | "compositions";

export default function PfsMappingClient({ colors: initialColors, categories: initialCategories, compositions: initialCompositions }: Props) {
  const [tab, setTab] = useState<Tab>("colors");
  const [colors, setColors] = useState(initialColors);
  const [categories, setCategories] = useState(initialCategories);
  const [compositions, setCompositions] = useState(initialCompositions);

  const [pfsColors, setPfsColors] = useState<PfsColor[]>([]);
  const [pfsCategories, setPfsCategories] = useState<PfsCategory[]>([]);
  const [pfsCompositions, setPfsCompositions] = useState<PfsComposition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [search, setSearch] = useState("");

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
        setError(null);
      })
      .catch((err) => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

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
      await updateCategoryPfsId(catId, pfsCatId || null);
      setCategories((prev) => prev.map((c) => (c.id === catId ? { ...c, pfsCategoryId: pfsCatId } : c)));
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erreur");
    }
    setSaving(null);
  }, []);

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

  const tabs: { key: Tab; label: string; count: number; mapped: number }[] = [
    { key: "colors", label: "Couleurs", count: colors.length, mapped: colors.filter((c) => c.pfsColorRef).length },
    { key: "categories", label: "Catégories", count: categories.length, mapped: categories.filter((c) => c.pfsCategoryId).length },
    { key: "compositions", label: "Compositions", count: compositions.length, mapped: compositions.filter((c) => c.pfsCompositionRef).length },
  ];

  // Compute used PFS refs to prevent duplicates (a PFS ref can only be linked to ONE BJ entity)
  const usedColorRefs = new Set(colors.filter((c) => c.pfsColorRef).map((c) => c.pfsColorRef!));
  const usedCategoryIds = new Set(categories.filter((c) => c.pfsCategoryId).map((c) => c.pfsCategoryId!));
  const usedCompositionRefs = new Set(compositions.filter((c) => c.pfsCompositionRef).map((c) => c.pfsCompositionRef!));

  const filteredColors = colors.filter((c) => c.name.toLowerCase().includes(search.toLowerCase()));
  const filteredCategories = categories.filter((c) => c.name.toLowerCase().includes(search.toLowerCase()));
  const filteredCompositions = compositions.filter((c) => c.name.toLowerCase().includes(search.toLowerCase()));

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
      <div className="flex gap-2 border-b border-border pb-2">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => { setTab(t.key); setSearch(""); }}
            className={`px-4 py-2 rounded-t-lg text-sm font-medium transition-colors ${
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
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="field-input w-full max-w-sm"
      />

      {/* Color mapping */}
      {tab === "colors" && (
        <div className="card overflow-hidden">
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

      {/* Category mapping */}
      {tab === "categories" && (
        <div className="card overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="table-header">
                <th className="text-left p-3">Catégorie BJ</th>
                <th className="text-left p-3">Catégorie PFS</th>
                <th className="text-left p-3 w-20">Statut</th>
              </tr>
            </thead>
            <tbody>
              {filteredCategories.map((cat) => (
                <tr key={cat.id} className="table-row">
                  <td className="p-3 font-medium">{cat.name}</td>
                  <td className="p-3">
                    <select
                      value={cat.pfsCategoryId ?? ""}
                      onChange={(e) => handleSaveCategory(cat.id, e.target.value || null)}
                      disabled={saving === cat.id}
                      className="field-input py-1.5 text-sm max-w-[350px]"
                    >
                      <option value="">— Non liée —</option>
                      {pfsCategories.map((pc) => {
                        const taken = usedCategoryIds.has(pc.id) && cat.pfsCategoryId !== pc.id;
                        return (
                          <option key={pc.id} value={pc.id} disabled={taken}>
                            {pc.labels?.fr ?? pc.id} ({pc.gender}){taken ? " ✗ déjà liée" : ""}
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
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Composition mapping */}
      {tab === "compositions" && (
        <div className="card overflow-hidden">
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

      {/* Summary */}
      <div className="flex gap-4 text-sm text-text-secondary">
        <span>Couleurs liées : {colors.filter((c) => c.pfsColorRef).length}/{colors.length}</span>
        <span>Catégories liées : {categories.filter((c) => c.pfsCategoryId).length}/{categories.length}</span>
        <span>Compositions liées : {compositions.filter((c) => c.pfsCompositionRef).length}/{compositions.length}</span>
      </div>
    </div>
  );
}
