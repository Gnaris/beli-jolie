import Link from "next/link";

interface UsersSidebarNavProps {
  currentTab: "inscrits" | "fiches";
  registeredCount: number;
  cardsCount: number;
  /**
   * Chemin de base des tabs (ex. "/admin/clients").
   */
  basePath: string;
}

const NAV_ICONS = {
  inscrits: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  fiches: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  ),
};

/**
 * Nav horizontale en 2 colonnes en haut de la page /admin/clients.
 * Chaque onglet occupe la moitié de la largeur ; le contenu (tableau) prend
 * toute la largeur en dessous.
 */
export default function UsersSidebarNav({
  currentTab,
  registeredCount,
  cardsCount,
  basePath,
}: UsersSidebarNavProps) {
  const items = [
    {
      key: "inscrits" as const,
      label: "Clients inscrits",
      count: registeredCount,
      href: basePath,
      icon: NAV_ICONS.inscrits,
    },
    {
      key: "fiches" as const,
      label: "Mes fiches clients",
      count: cardsCount,
      href: `${basePath}?tab=fiches`,
      icon: NAV_ICONS.fiches,
    },
  ];

  return (
    <nav className="grid grid-cols-2 gap-2 bg-bg-primary border border-border rounded-xl shadow-sm p-1.5">
      {items.map((item) => {
        const active = currentTab === item.key;
        const base = active
          ? "bg-gradient-to-br from-slate-900 to-slate-800 text-white border-slate-900 shadow-[0_3px_8px_rgba(15,23,42,0.15)] font-semibold"
          : "border-transparent text-text-secondary hover:bg-bg-secondary hover:text-text-primary";
        return (
          <Link
            key={item.key}
            href={item.href}
            prefetch={false}
            className={`flex items-center justify-center gap-2.5 px-4 py-2.5 rounded-lg text-[13.5px] font-body font-medium text-center transition border ${base}`}
          >
            <span className={`shrink-0 ${active ? "text-white" : "text-text-muted"}`}>
              {item.icon}
            </span>
            <span className="truncate">{item.label}</span>
            <span
              className={`inline-flex items-center justify-center min-w-[24px] h-5 px-1.5 rounded-full text-[11px] font-semibold tabular-nums ${
                active
                  ? "bg-white/20 text-white"
                  : "bg-bg-tertiary text-text-secondary"
              }`}
            >
              {item.count}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
