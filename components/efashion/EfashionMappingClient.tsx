"use client";

import { useState, useEffect, useCallback } from "react";
import CustomSelect from "@/components/ui/CustomSelect";
import { useToast } from "@/components/ui/Toast";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

interface BjCategory {
  id: string;
  name: string;
}

interface BjColor {
  id: string;
  name: string;
  hex: string | null;
  patternImage: string | null;
}

interface BjComposition {
  id: string;
  name: string;
}

interface EfashionMappingRecord {
  id: string;
  type: string;
  efashionName: string;
  efashionId: number | null;
  bjEntityId: string;
  bjName: string;
  createdAt: string;
}

type Tab = "categories" | "colors" | "compositions";

// ─────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────

export default function EfashionMappingClient() {
  const toast = useToast();
  const [tab, setTab] = useState<Tab>("categories");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const [categories, setCategories] = useState<BjCategory[]>([]);
  const [colors, setColors] = useState<BjColor[]>([]);
  const [compositions, setCompositions] = useState<BjComposition[]>([]);
  const [mappings, setMappings] = useState<EfashionMappingRecord[]>([]);

  // ── Fetch data ──
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/efashion-sync/mapping-data");
      const data = await res.json();
      setCategories(data.categories ?? []);
      setColors(data.colors ?? []);
      setCompositions(data.compositions ?? []);
      setMappings(data.mappings ?? []);
    } catch {
      toast.error("Erreur de chargement des mappings");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // ── Update mapping ──
  const updateMapping = async (mapping: EfashionMappingRecord, newBjEntityId: string) => {
    const key = `${mapping.type}-${mapping.efashionName}`;
    setSaving(key);
    try {
      // Find the entity name
      let bjName = "";
      if (mapping.type === "category") {
        bjName = categories.find((c) => c.id === newBjEntityId)?.name || "";
      } else if (mapping.type === "color") {
        bjName = colors.find((c) => c.id === newBjEntityId)?.name || "";
      } else if (mapping.type === "composition") {
        bjName = compositions.find((c) => c.id === newBjEntityId)?.name || "";
      }

      const res = await fetch("/api/admin/efashion-sync/create-entities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mappings: [{
            type: mapping.type,
            efashionName: mapping.efashionName,
            efashionId: mapping.efashionId,
            bjEntityId: newBjEntityId,
            bjName,
          }],
        }),
      });

      if (res.ok) {
        toast.success("Mapping mis à jour");
        // Update local state
        setMappings((prev) =>
          prev.map((m) =>
            m.id === mapping.id
              ? { ...m, bjEntityId: newBjEntityId, bjName }
              : m,
          ),
        );
      } else {
        const data = await res.json();
        toast.error(data.error || "Erreur");
      }
    } catch {
      toast.error("Erreur réseau");
    } finally {
      setSaving(null);
    }
  };

  // ── Filter mappings by tab and search ──
  const filteredMappings = mappings.filter((m) => {
    if (m.type !== tab.slice(0, -1)) return false; // "categories" → "category"
    if (!search) return true;
    const term = search.toLowerCase();
    return m.efashionName.toLowerCase().includes(term) || m.bjName.toLowerCase().includes(term);
  });

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: "categories", label: "Catégories", count: mappings.filter((m) => m.type === "category").length },
    { key: "colors", label: "Couleurs", count: mappings.filter((m) => m.type === "color").length },
    { key: "compositions", label: "Compositions", count: mappings.filter((m) => m.type === "composition").length },
  ];

  // ── Entity options for each tab ──
  const getOptions = () => {
    if (tab === "categories") return categories.map((c) => ({ value: c.id, label: c.name }));
    if (tab === "colors") return colors.map((c) => ({ value: c.id, label: c.name }));
    if (tab === "compositions") return compositions.map((c) => ({ value: c.id, label: c.name }));
    return [];
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="w-8 h-8 border-2 border-border border-t-text-primary rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-text-primary font-heading">
          Mappings eFashion
        </h2>
        <p className="text-sm text-text-secondary font-body mt-1">
          Associez les entités eFashion à vos entités boutique existantes.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => { setTab(t.key); setSearch(""); }}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              tab === t.key
                ? "border-text-primary text-text-primary"
                : "border-transparent text-text-secondary hover:text-text-primary"
            }`}
          >
            {t.label}
            <span className="badge badge-neutral text-[10px]">{t.count}</span>
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative max-w-xs">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher..."
          className="field-input pl-9 text-sm w-full"
        />
      </div>

      {/* Mappings list */}
      {filteredMappings.length === 0 ? (
        <p className="text-sm text-text-secondary py-8 text-center">Aucun mapping trouvé.</p>
      ) : (
        <div className="space-y-2">
          {filteredMappings.map((mapping) => (
            <div
              key={mapping.id}
              className="flex items-center gap-3 p-3 bg-bg-primary border border-border rounded-xl"
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-text-primary truncate">{mapping.efashionName}</p>
                {mapping.efashionId && (
                  <p className="text-[10px] text-text-muted font-mono">ID: {mapping.efashionId}</p>
                )}
              </div>

              <svg className="w-4 h-4 text-text-muted shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
              </svg>

              <div className="w-64">
                <CustomSelect
                  value={mapping.bjEntityId}
                  onChange={(val) => {
                    if (val && val !== mapping.bjEntityId) {
                      updateMapping(mapping, val);
                    }
                  }}
                  options={getOptions()}
                  placeholder="Sélectionner..."
                  disabled={saving === `${mapping.type}-${mapping.efashionName}`}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
