"use client";

import { useState } from "react";
import Link from "next/link";
import ImportProductsTab from "@/components/admin/products/import/ImportProductsTab";
import ImportImagesTab from "@/components/admin/products/import/ImportImagesTab";

type Tab = "products" | "images";

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
          Importez vos produits via JSON ou Excel, puis associez les images
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
        </div>
      </div>

      {/* Tab content */}
      <div>
        {activeTab === "products" ? <ImportProductsTab /> : <ImportImagesTab />}
      </div>

      {/* Marketplaces */}
      <div className="mt-10">
        <h2 className="text-lg font-semibold text-text-primary font-heading mb-1">
          Marketplaces
        </h2>
        <p className="text-sm text-text-muted font-body mb-4">
          Synchronisez vos produits avec les plateformes externes
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Paris Fashion Shop */}
          {hasPfsConfig ? (
            <Link
              href="/admin/pfs"
              className="bg-bg-primary border border-border rounded-2xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)] hover:border-bg-dark transition-colors group"
            >
              <div className="flex items-center gap-3 mb-2">
                <div className="w-9 h-9 rounded-lg bg-bg-secondary flex items-center justify-center group-hover:bg-bg-dark/5 transition-colors">
                  <svg className="w-5 h-5 text-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
                  </svg>
                </div>
                <span className="font-medium text-sm text-text-primary font-body">Paris Fashion Shop</span>
              </div>
              <p className="text-xs text-text-muted font-body">Sync bidirectionnelle PFS</p>
            </Link>
          ) : (
            <div className="bg-bg-primary border border-border rounded-2xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)] opacity-60 cursor-not-allowed">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-9 h-9 rounded-lg bg-bg-secondary flex items-center justify-center">
                  <svg className="w-5 h-5 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
                  </svg>
                </div>
                <span className="font-medium text-sm text-text-muted font-body">Paris Fashion Shop</span>
                <span className="badge badge-neutral text-[10px] ml-auto">Non activé</span>
              </div>
              <p className="text-xs text-text-muted font-body">Sync bidirectionnelle PFS</p>
            </div>
          )}

          {/* Efashion Paris */}
          <div className="bg-bg-primary border border-border rounded-2xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)] opacity-60 cursor-not-allowed">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-9 h-9 rounded-lg bg-bg-secondary flex items-center justify-center">
                <svg className="w-5 h-5 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13.5 21v-7.5a.75.75 0 01.75-.75h3a.75.75 0 01.75.75V21m-4.5 0H2.36m11.14 0H18m0 0h3.64m-1.39 0V9.349m-16.5 11.65V9.35m0 0a3.001 3.001 0 003.75-.615A2.993 2.993 0 009.75 9.75c.896 0 1.7-.393 2.25-1.016a2.993 2.993 0 002.25 1.016c.896 0 1.7-.393 2.25-1.016a3.001 3.001 0 003.75.614m-16.5 0a3.004 3.004 0 01-.621-4.72L4.318 3.44A1.5 1.5 0 015.378 3h13.243a1.5 1.5 0 011.06.44l1.19 1.189a3 3 0 01-.621 4.72m-13.5 8.65h3.75a.75.75 0 00.75-.75V13.5a.75.75 0 00-.75-.75H6.75a.75.75 0 00-.75.75v3.75c0 .415.336.75.75.75z" />
                </svg>
              </div>
              <span className="font-medium text-sm text-text-muted font-body">Efashion Paris</span>
              <span className="badge badge-neutral text-[10px] ml-auto">Bientôt</span>
            </div>
            <p className="text-xs text-text-muted font-body">Import depuis Efashion</p>
          </div>

          {/* Ankorstore */}
          <div className="bg-bg-primary border border-border rounded-2xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)] opacity-60 cursor-not-allowed">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-9 h-9 rounded-lg bg-bg-secondary flex items-center justify-center">
                <svg className="w-5 h-5 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13.5 21v-7.5a.75.75 0 01.75-.75h3a.75.75 0 01.75.75V21m-4.5 0H2.36m11.14 0H18m0 0h3.64m-1.39 0V9.349m-16.5 11.65V9.35m0 0a3.001 3.001 0 003.75-.615A2.993 2.993 0 009.75 9.75c.896 0 1.7-.393 2.25-1.016a2.993 2.993 0 002.25 1.016c.896 0 1.7-.393 2.25-1.016a3.001 3.001 0 003.75.614m-16.5 0a3.004 3.004 0 01-.621-4.72L4.318 3.44A1.5 1.5 0 015.378 3h13.243a1.5 1.5 0 011.06.44l1.19 1.189a3 3 0 01-.621 4.72m-13.5 8.65h3.75a.75.75 0 00.75-.75V13.5a.75.75 0 00-.75-.75H6.75a.75.75 0 00-.75.75v3.75c0 .415.336.75.75.75z" />
                </svg>
              </div>
              <span className="font-medium text-sm text-text-muted font-body">Ankorstore</span>
              <span className="badge badge-neutral text-[10px] ml-auto">Bientôt</span>
            </div>
            <p className="text-xs text-text-muted font-body">Import depuis Ankorstore</p>
          </div>

          {/* Microstore */}
          <div className="bg-bg-primary border border-border rounded-2xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)] opacity-60 cursor-not-allowed">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-9 h-9 rounded-lg bg-bg-secondary flex items-center justify-center">
                <svg className="w-5 h-5 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13.5 21v-7.5a.75.75 0 01.75-.75h3a.75.75 0 01.75.75V21m-4.5 0H2.36m11.14 0H18m0 0h3.64m-1.39 0V9.349m-16.5 11.65V9.35m0 0a3.001 3.001 0 003.75-.615A2.993 2.993 0 009.75 9.75c.896 0 1.7-.393 2.25-1.016a2.993 2.993 0 002.25 1.016c.896 0 1.7-.393 2.25-1.016a3.001 3.001 0 003.75.614m-16.5 0a3.004 3.004 0 01-.621-4.72L4.318 3.44A1.5 1.5 0 015.378 3h13.243a1.5 1.5 0 011.06.44l1.19 1.189a3 3 0 01-.621 4.72m-13.5 8.65h3.75a.75.75 0 00.75-.75V13.5a.75.75 0 00-.75-.75H6.75a.75.75 0 00-.75.75v3.75c0 .415.336.75.75.75z" />
                </svg>
              </div>
              <span className="font-medium text-sm text-text-muted font-body">Microstore</span>
              <span className="badge badge-neutral text-[10px] ml-auto">Bientôt</span>
            </div>
            <p className="text-xs text-text-muted font-body">Import depuis Microstore</p>
          </div>
        </div>
      </div>
    </div>
  );
}
