"use client";

import { useState, useRef, useEffect, type ReactNode } from "react";

const TAB_ORDER = ["produits", "categories", "couleurs", "compositions", "pays", "saisons", "tailles", "mots-cles"];

const TABS_META = [
  { key: "produits", label: "Produits", icon: "M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" },
  { key: "categories", label: "Catégories", icon: "M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z M6 6h.008v.008H6V6z" },
  { key: "couleurs", label: "Couleurs", icon: "M4.098 19.902a3.75 3.75 0 005.304 0l6.401-6.402M6.75 21A3.75 3.75 0 013 17.25V4.125C3 3.504 3.504 3 4.125 3h5.25c.621 0 1.125.504 1.125 1.125v4.072M6.75 21a3.75 3.75 0 003.75-3.75V8.197M6.75 21h13.125c.621 0 1.125-.504 1.125-1.125v-5.25c0-.621-.504-1.125-1.125-1.125h-4.072M10.5 8.197l2.88-2.88c.438-.439 1.15-.439 1.59 0l3.712 3.713c.44.44.44 1.152 0 1.59l-2.879 2.88M6.75 17.25h.008v.008H6.75v-.008z" },
  { key: "compositions", label: "Compositions", icon: "M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23-.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5" },
  { key: "pays", label: "Pays de fabrication", icon: "M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418" },
  { key: "saisons", label: "Saisons", icon: "M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" },
  { key: "tailles", label: "Tailles", icon: "M3 7.5L7.5 3m0 0L12 7.5M7.5 3v13.5m13.5 0L16.5 21m0 0L12 16.5m4.5 4.5V7.5" },
  { key: "mots-cles", label: "Mots clés", icon: "M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3zM6 6h.008v.008H6V6z" },
];

interface TabDef {
  key: string;
  content: ReactNode;
}

interface Props {
  initialTab: string;
  tabs: TabDef[];
  warnings?: Record<string, number>;
}

export default function AdminProductsTabsWrapper({ initialTab, tabs, warnings = {} }: Props) {
  const [activeTab, setActiveTab] = useState(initialTab);
  const prevTabRef = useRef(activeTab);
  const [direction, setDirection] = useState<"left" | "right" | null>(null);
  const [animCounter, setAnimCounter] = useState(0);

  const handleTabChange = (tabKey: string) => {
    if (tabKey === activeTab) return;
    setActiveTab(tabKey);

    // Update URL without triggering server navigation
    const params = new URLSearchParams();
    if (tabKey !== "produits") params.set("tab", tabKey);
    const qs = params.toString();
    window.history.replaceState(null, "", `/admin/produits${qs ? `?${qs}` : ""}`);
  };

  useEffect(() => {
    if (prevTabRef.current !== activeTab) {
      const prevIdx = TAB_ORDER.indexOf(prevTabRef.current);
      const nextIdx = TAB_ORDER.indexOf(activeTab);
      setDirection(nextIdx > prevIdx ? "left" : "right");
      setAnimCounter((c) => c + 1);
      prevTabRef.current = activeTab;
    }
  }, [activeTab]);

  const animClass =
    direction === "left"
      ? "animate-[slide-in-right_0.3s_ease-out]"
      : direction === "right"
        ? "animate-[slide-in-left_0.3s_ease-out]"
        : "";

  return (
    <>
      {/* Tab bar */}
      <div className="border-b border-border">
        <div className="flex items-center gap-1 overflow-x-auto pb-1 -mb-px scrollbar-none">
          {TABS_META.map((tab) => {
            const isActive = activeTab === tab.key;
            const warningCount = warnings[tab.key] ?? 0;
            return (
              <button
                key={tab.key}
                onClick={() => handleTabChange(tab.key)}
                className={`flex items-center gap-2 px-3.5 py-2.5 text-sm font-body rounded-t-lg border-b-2 transition-colors whitespace-nowrap ${
                  isActive
                    ? "border-text-primary text-text-primary bg-bg-primary font-medium"
                    : "border-transparent text-text-muted hover:text-text-secondary hover:bg-bg-secondary/50"
                }`}
              >
                <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={tab.icon} />
                </svg>
                {tab.label}
                {warningCount > 0 && (
                  <span className="flex items-center gap-1 text-[11px] bg-amber-100 text-amber-700 border border-amber-200 rounded-full px-1.5 py-0.5 font-medium leading-none">
                    {warningCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab content with slide animation */}
      <div className="overflow-hidden">
        {tabs.map((tab) => {
          const isActive = tab.key === activeTab;
          if (!isActive) {
            return <div key={tab.key} className="hidden">{tab.content}</div>;
          }
          return (
            <div key={`${tab.key}-${animCounter}`} className={animClass}>
              {tab.content}
            </div>
          );
        })}
      </div>
    </>
  );
}
