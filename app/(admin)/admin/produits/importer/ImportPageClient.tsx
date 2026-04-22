"use client";

import { useState } from "react";
import Link from "next/link";
import ImportProductsTab from "@/components/admin/products/import/ImportProductsTab";
import ImportImagesTab from "@/components/admin/products/import/ImportImagesTab";
import ImportPfsClient from "@/app/(admin)/admin/produits/importer-pfs/ImportPfsClient";

type Tab = "products" | "images" | "pfs";

export default function ImportPageClient({ hasPfsConfig }: { hasPfsConfig: boolean }) {
  const [activeTab, setActiveTab] = useState<Tab>("products");

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Header */}
      <div className="flex items-center justify-between">
        <Link
          href="/admin/produits"
          className="text-[#666] hover:text-text-primary transition-colors text-sm"
        >
          ← Retour aux produits
        </Link>
        <Link
          href="/admin/produits/importer/historique"
          className="flex items-center gap-2 text-sm text-[#666] hover:text-text-primary transition-colors border border-border rounded-lg px-3 py-1.5 hover:border-bg-dark"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Historique des imports
        </Link>
      </div>

      <div>
        <h1 className="page-title">Importation en masse</h1>
        <p className="page-subtitle font-body">
          Importez vos produits via fichier ou depuis une plateforme externe
        </p>
      </div>

      {/* Tabs */}
      <div className="border-b border-border">
        <div className="flex gap-0">
          <button
            onClick={() => setActiveTab("products")}
            className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === "products"
                ? "border-[#1A1A1A] text-text-primary"
                : "border-transparent text-[#666] hover:text-text-primary"
            }`}
          >
            <span className="mr-2">📦</span>
            Données produits
          </button>
          <button
            onClick={() => setActiveTab("images")}
            className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === "images"
                ? "border-[#1A1A1A] text-text-primary"
                : "border-transparent text-[#666] hover:text-text-primary"
            }`}
          >
            <span className="mr-2">🖼️</span>
            Images produits
          </button>
          {hasPfsConfig && (
            <button
              onClick={() => setActiveTab("pfs")}
              className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === "pfs"
                  ? "border-[#1A1A1A] text-text-primary"
                  : "border-transparent text-[#666] hover:text-text-primary"
              }`}
            >
              <span className="mr-2">🔄</span>
              Paris Fashion Shop
            </button>
          )}
        </div>
      </div>

      {/* Tab content */}
      <div>
        {activeTab === "products" && <ImportProductsTab />}
        {activeTab === "images" && <ImportImagesTab />}
        {activeTab === "pfs" && <ImportPfsClient embedded />}
      </div>
    </div>
  );
}
