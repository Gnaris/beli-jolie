"use client";

/**
 * Bouton flottant dev-only pour basculer la home entre les layouts des tenants.
 * Pose un cookie `bj_home_preview` (30j) lu par `app/[locale]/page.tsx` en
 * priorité sur le tenant courant — utile pour visualiser en local la home
 * Issyma sans changer de domaine.
 *
 * Rendu conditionné à `NODE_ENV !== "production"` côté page.tsx : ce composant
 * n'existe jamais en prod, aucun impact SEO / UX visiteur.
 */
export default function HomeLayoutDevSwitcher({
  current,
}: {
  current: "beliandjolie" | "issyma";
}) {
  const setPreview = (choice: "beliandjolie" | "issyma") => {
    document.cookie = `bj_home_preview=${choice}; path=/; max-age=${60 * 60 * 24 * 30}; SameSite=Lax`;
    window.location.reload();
  };

  const clearPreview = () => {
    document.cookie = "bj_home_preview=; path=/; max-age=0; SameSite=Lax";
    window.location.reload();
  };

  const btn = (choice: "beliandjolie" | "issyma", label: string) => {
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
      aria-label="Prévisualisation home (dev only)"
    >
      <span className="px-2 text-[10px] uppercase tracking-[0.18em] text-slate-500">
        Home
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
