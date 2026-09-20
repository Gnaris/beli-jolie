"use client";

import { TENANT_PREVIEW_COOKIE, type TenantSlug } from "@/lib/tenant-preview-shared";

/**
 * Bouton flottant dev-only pour basculer d'une boutique à l'autre en local.
 * Pose un cookie `bj_home_preview` (30j) lu côté serveur par
 * `lib/tenant-preview.ts::getEffectiveTenantSlug()`, qui prime sur le tenant
 * résolu par le middleware. Permet de visualiser en local BJ vs Issyma sans
 * changer de domaine, sur toutes les pages.
 *
 * Visible uniquement quand `NODE_ENV !== "production"` (garde côté layout).
 * Aucun impact SEO / UX visiteur en prod.
 */
export default function TenantDevSwitcher({ current }: { current: TenantSlug }) {
  const setPreview = (choice: TenantSlug) => {
    document.cookie = `${TENANT_PREVIEW_COOKIE}=${choice}; path=/; max-age=${60 * 60 * 24 * 30}; SameSite=Lax`;
    window.location.reload();
  };

  const clearPreview = () => {
    document.cookie = `${TENANT_PREVIEW_COOKIE}=; path=/; max-age=0; SameSite=Lax`;
    window.location.reload();
  };

  const btn = (choice: TenantSlug, label: string) => {
    const active = current === choice;
    return (
      <button
        type="button"
        onClick={() => setPreview(choice)}
        className={`px-3 py-1 rounded-full text-xs font-medium transition ${
          active
            ? "bg-white text-slate-900 shadow-sm"
            : "text-slate-300 hover:text-white hover:bg-slate-700/60"
        }`}
      >
        {label}
      </button>
    );
  };

  return (
    <div
      className="fixed bottom-4 left-4 z-[9999] flex items-center gap-1 rounded-full border border-slate-700 bg-slate-900/95 px-2 py-1.5 shadow-lg backdrop-blur"
      role="group"
      aria-label="Prévisualisation boutique (dev only)"
    >
      <span className="px-2 text-[10px] uppercase tracking-[0.18em] text-slate-500">
        Boutique
      </span>
      {btn("beliandjolie", "Beli & Jolie")}
      {btn("issyma", "Issyma")}
      <button
        type="button"
        onClick={clearPreview}
        className="ml-1 px-2 py-1 text-xs text-slate-500 hover:text-slate-300"
        title="Retour au tenant courant"
      >
        ×
      </button>
    </div>
  );
}
