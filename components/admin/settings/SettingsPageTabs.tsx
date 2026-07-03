"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";

const TABS = [
  { key: "general",      label: "Général",       icon: "M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.28z M15 12a3 3 0 11-6 0 3 3 0 016 0z" },
  { key: "societe",      label: "Société",       icon: "M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21" },
  { key: "catalogue",    label: "Catalogue",     icon: "M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" },
  { key: "carrousels",   label: "Carrousels",    icon: "M4 6h16v12H4zM8 6v12M16 6v12" },
  { key: "stock",        label: "Stock",         icon: "M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" },
  { key: "horaires",     label: "Horaires",      icon: "M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" },
  { key: "maintenance",  label: "Maintenance",   icon: "M12 9v3.75m0 3.75h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" },
  { key: "livraison",    label: "Livraison",     icon: "M1 3h15v13H1zM16 8h4l3 4v4h-7zM5.5 21a2.5 2.5 0 100-5 2.5 2.5 0 000 5zM18.5 21a2.5 2.5 0 100-5 2.5 2.5 0 000 5z" },
  { key: "marketplaces", label: "Marketplaces",  icon: "M3 21h18M5 21V7l7-4 7 4v14M9 9v.01M9 12v.01M9 15v.01M15 9v.01M15 12v.01M15 15v.01" },
  { key: "traduction",   label: "Traduction",    icon: "M4 5h7M9 3v2M4 9c0 5 4 8 8 8M9 9c-2 4 0 8 4 8M14 5l6 14M17 15h6" },
  { key: "seo",          label: "Référencement", icon: "M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

const GROUPS: { label: string; keys: TabKey[] }[] = [
  { label: "Site",         keys: ["general", "societe", "catalogue", "carrousels", "stock", "horaires", "maintenance"] },
  { label: "Intégrations", keys: ["livraison", "marketplaces", "traduction"] },
  { label: "Référencement", keys: ["seo"] },
];

const TAB_MAP = new Map(TABS.map((t) => [t.key, t]));

interface Props {
  activeTab: string;
  variant?: "desktop" | "mobile";
  /** Badges à côté d'onglets — ex. { marketplaces: "2/4" } */
  badges?: Partial<Record<TabKey, string>>;
}

export default function SettingsPageTabs({ activeTab, variant = "desktop", badges }: Props) {
  const router = useRouter();

  const handleTabChange = useCallback((tabKey: string) => {
    const params = new URLSearchParams();
    if (tabKey !== "general") params.set("tab", tabKey);
    const qs = params.toString();
    router.push(`/admin/parametres${qs ? `?${qs}` : ""}`, { scroll: false });
  }, [router]);

  if (variant === "mobile") {
    return (
      <div className="flex items-center gap-2 overflow-x-auto pb-2 -mx-1 px-1 scrollbar-none">
        {TABS.map((tab) => {
          const isActive = activeTab === tab.key;
          const badge = badges?.[tab.key];
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => handleTabChange(tab.key)}
              className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-[13px] font-body font-medium whitespace-nowrap min-h-[40px] cursor-pointer border transition-all ${
                isActive
                  ? "bg-gradient-to-br from-text-primary to-text-secondary text-white border-text-primary shadow-md"
                  : "bg-bg-primary text-text-secondary border-border hover:border-border-strong hover:text-text-primary"
              }`}
            >
              <span className={`inline-flex items-center justify-center w-6 h-6 rounded-lg ${
                isActive ? "bg-white/12" : "bg-bg-secondary border border-border"
              }`}>
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                  <path d={tab.icon} />
                </svg>
              </span>
              {tab.label}
              {badge && (
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                  isActive ? "bg-white/20 text-white" : "bg-amber-100 text-amber-800"
                }`}>{badge}</span>
              )}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <nav className="bg-bg-primary border border-border rounded-2xl p-2 shadow-sm">
      {GROUPS.map((group, gi) => (
        <div key={group.label}>
          <div
            className={`text-[10px] font-body font-bold uppercase tracking-[0.18em] text-text-muted px-3.5 pb-1.5 flex items-center gap-2 ${gi === 0 ? "pt-1" : "pt-4"}`}
          >
            <span className="w-[3px] h-3 rounded-full bg-gradient-to-b from-text-secondary to-text-primary" />
            {group.label}
          </div>
          <div className="flex flex-col gap-1">
            {group.keys.map((key) => {
              const tab = TAB_MAP.get(key);
              if (!tab) return null;
              const isActive = activeTab === tab.key;
              const badge = badges?.[key];
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => handleTabChange(tab.key)}
                  className={`group relative flex items-center gap-2.5 px-2.5 py-2 text-[13px] font-body rounded-xl text-left cursor-pointer border transition-all ${
                    isActive
                      ? "bg-gradient-to-br from-text-primary to-text-secondary text-white font-semibold border-text-primary shadow-md"
                      : "bg-transparent text-text-secondary border-transparent hover:bg-bg-secondary hover:text-text-primary"
                  }`}
                >
                  <span className={`inline-flex items-center justify-center w-7 h-7 rounded-lg shrink-0 ${
                    isActive
                      ? "bg-white/12 border border-white/14 text-white"
                      : "bg-bg-secondary border border-border text-text-secondary group-hover:border-border-strong"
                  }`}>
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                      <path d={tab.icon} />
                    </svg>
                  </span>
                  <span className="truncate">{tab.label}</span>
                  {badge && (
                    <span className={`ml-auto text-[10px] px-1.5 py-0.5 rounded font-bold ${
                      isActive ? "bg-white/20 text-white" : "bg-amber-100 text-amber-800"
                    }`}>{badge}</span>
                  )}
                  {isActive && (
                    <svg className="ml-auto w-3.5 h-3.5 opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
                      <path d="m9 18 6-6-6-6"/>
                    </svg>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}
