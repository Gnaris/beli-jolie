"use client";

import { useState } from "react";
import Link from "next/link";
import ImportProductsTab from "@/components/admin/products/import/ImportProductsTab";
import ImportImagesTab from "@/components/admin/products/import/ImportImagesTab";

type Tab = "products" | "images";

export default function ImporterPage() {
  const [activeTab, setActiveTab] = useState<Tab>("products");

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link
          href="/admin/produits"
          className="text-[#666] hover:text-[#1A1A1A] transition-colors text-sm"
        >
          ← Retour aux produits
        </Link>
      </div>

      <div>
        <h1 className="page-title">Importation en masse</h1>
        <p className="page-subtitle font-[family-name:var(--font-roboto)]">
          Importez vos produits via JSON ou Excel, puis associez les images
        </p>
      </div>

      {/* Tabs */}
      <div className="border-b border-[#E5E5E5]">
        <div className="flex gap-0">
          <button
            onClick={() => setActiveTab("products")}
            className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === "products"
                ? "border-[#1A1A1A] text-[#1A1A1A]"
                : "border-transparent text-[#666] hover:text-[#1A1A1A]"
            }`}
          >
            <span className="mr-2">📦</span>
            Données produits
          </button>
          <button
            onClick={() => setActiveTab("images")}
            className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === "images"
                ? "border-[#1A1A1A] text-[#1A1A1A]"
                : "border-transparent text-[#666] hover:text-[#1A1A1A]"
            }`}
          >
            <span className="mr-2">🖼️</span>
            Images produits
          </button>
        </div>
      </div>

      {/* Tab content */}
      <div>
        {activeTab === "products" ? <ImportProductsTab /> : <ImportImagesTab />}
      </div>
    </div>
  );
}
