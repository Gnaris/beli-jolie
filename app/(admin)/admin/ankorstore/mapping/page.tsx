"use client";

import { useState, useEffect } from "react";
import { useToast } from "@/components/ui/Toast";
import CustomSelect from "@/components/ui/CustomSelect";
import type { SelectOption } from "@/components/ui/CustomSelect";
import { saveAnkorstoreMapping, deleteAnkorstoreMapping } from "@/app/actions/admin/ankorstore-sync";

interface Mapping {
  id: string;
  type: string;
  akValue: string;
  akName: string;
  bjEntityId: string;
  bjName: string;
}

interface Category {
  id: string;
  name: string;
}

export default function AnkorstoreMappingPage() {
  const toast = useToast();
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/admin/ankorstore-sync/mapping-data")
      .then((r) => r.json())
      .then((data) => {
        setMappings(data.mappings || []);
        setCategories(data.categories || []);
      })
      .finally(() => setLoading(false));
  }, []);

  const categoryOptions: SelectOption[] = categories.map((c) => ({
    value: c.id,
    label: c.name,
  }));

  async function handleSave(akValue: string, akName: string, categoryId: string) {
    const category = categories.find((c) => c.id === categoryId);
    if (!category) return;

    const result = await saveAnkorstoreMapping({
      akValue,
      akName,
      bjEntityId: categoryId,
      bjName: category.name,
    });

    if (result.success) {
      toast.success("Mapping sauvegard\u00e9");
      const res = await fetch("/api/admin/ankorstore-sync/mapping-data");
      const data = await res.json();
      setMappings(data.mappings || []);
    } else {
      toast.error("Erreur", result.error);
    }
  }

  async function handleDelete(akValue: string) {
    const result = await deleteAnkorstoreMapping(akValue);
    if (result.success) {
      setMappings((prev) => prev.filter((m) => m.akValue !== akValue));
      toast.success("Mapping supprim\u00e9");
    }
  }

  if (loading) {
    return (
      <div className="space-y-6 animate-fadeIn">
        <h1 className="page-title">Mapping Ankorstore</h1>
        <div className="text-text-secondary">Chargement...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fadeIn">
      <h1 className="page-title">Mapping Ankorstore &mdash; Cat&eacute;gories</h1>
      <p className="text-sm text-text-secondary">
        Associez chaque type de produit Ankorstore (productTypeId) &agrave; une cat&eacute;gorie de votre catalogue.
      </p>

      <div className="bg-bg-primary border border-border rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-bg-secondary">
              <th className="text-left p-4 font-medium text-text-secondary">Type AK (ID)</th>
              <th className="text-left p-4 font-medium text-text-secondary">Nom AK</th>
              <th className="text-left p-4 font-medium text-text-secondary">Cat&eacute;gorie BJ</th>
              <th className="text-right p-4 font-medium text-text-secondary">Actions</th>
            </tr>
          </thead>
          <tbody>
            {mappings.map((m) => (
              <tr key={m.akValue} className={`border-b border-border ${!m.bjEntityId ? "bg-amber-50/50" : ""}`}>
                <td className="p-4 font-mono text-xs">{m.akValue}</td>
                <td className="p-4">{m.akName}</td>
                <td className="p-4">
                  <CustomSelect
                    value={m.bjEntityId}
                    onChange={(val) => handleSave(m.akValue, m.akName, val)}
                    options={categoryOptions}
                    size="sm"
                    searchable
                  />
                </td>
                <td className="p-4 text-right">
                  <button onClick={() => handleDelete(m.akValue)} className="text-red-500 hover:text-red-700 text-xs">
                    Supprimer
                  </button>
                </td>
              </tr>
            ))}
            {mappings.length === 0 && (
              <tr>
                <td colSpan={4} className="p-8 text-center text-text-secondary">
                  Aucun mapping configur&eacute;. Lancez une analyse pour d&eacute;tecter les types de produits.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
