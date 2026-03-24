"use client";

import { useState, useEffect } from "react";
import PfsMappingClient from "./PfsMappingClient";

interface Color {
  id: string;
  name: string;
  hex: string | null;
  patternImage: string | null;
  pfsColorRef: string | null;
}

interface Category {
  id: string;
  name: string;
  pfsCategoryId: string | null;
  pfsGender: string | null;
  pfsFamilyId: string | null;
}

interface Composition {
  id: string;
  name: string;
  pfsCompositionRef: string | null;
}

interface Country {
  id: string;
  name: string;
  isoCode: string | null;
  pfsCountryRef: string | null;
}

interface Season {
  id: string;
  name: string;
  pfsSeasonRef: string | null;
}

interface Size {
  id: string;
  name: string;
  pfsMappings: { pfsSizeRef: string }[];
  categories: { category: { name: string } }[];
}

interface MappingData {
  colors: Color[];
  categories: Category[];
  compositions: Composition[];
  countries: Country[];
  seasons: Season[];
  sizes: Size[];
}

export default function PfsMappingTab() {
  const [data, setData] = useState<MappingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/pfs-sync/mapping-data")
      .then((r) => {
        if (!r.ok) throw new Error("Erreur serveur");
        return r.json();
      })
      .then((d: MappingData) => {
        setData(d);
        setLoading(false);
      })
      .catch(() => {
        setError("Impossible de charger les données de mapping");
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="flex items-center gap-3 text-text-secondary text-sm">
          <svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Chargement du mapping…
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-[#EF4444]/5 border border-[#EF4444]/20 text-[#EF4444] px-4 py-3 rounded-xl text-sm">
        {error}
      </div>
    );
  }

  if (!data) return null;

  return (
    <PfsMappingClient
      colors={data.colors}
      categories={data.categories}
      compositions={data.compositions}
      countries={data.countries}
      seasons={data.seasons}
      sizes={data.sizes}
    />
  );
}
