"use client";

import { useState } from "react";

type TabKey = "dashboard" | "cart" | "marketing" | "orders";

interface Props {
  cartCount: number;
  ordersCount: number;
  dashboardPanel: React.ReactNode;
  cartPanel: React.ReactNode;
  marketingPanel: React.ReactNode;
  ordersPanel: React.ReactNode;
}

export default function ClientDetailTabs({
  cartCount,
  ordersCount,
  dashboardPanel,
  cartPanel,
  marketingPanel,
  ordersPanel,
}: Props) {
  const [active, setActive] = useState<TabKey>("dashboard");

  const tabs: { key: TabKey; label: string; count?: number; countActive?: boolean }[] = [
    { key: "dashboard", label: "Tableau de bord" },
    { key: "cart",      label: "Panier",         count: cartCount,   countActive: cartCount > 0 },
    { key: "marketing", label: "Marketing" },
    { key: "orders",    label: "Commandes",      count: ordersCount },
  ];

  return (
    <div>
      {/* Onglets */}
      <div className="border-b border-border mb-6 sm:mb-8">
        <div className="flex items-center gap-6 sm:gap-8 overflow-x-auto no-scrollbar">
          {tabs.map((t) => {
            const isActive = active === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setActive(t.key)}
                className={`relative py-3 shrink-0 text-sm transition-colors ${
                  isActive
                    ? "text-text-primary font-semibold"
                    : "text-text-muted hover:text-text-primary font-medium"
                }`}
              >
                <span className="inline-flex items-center gap-2">
                  {t.label}
                  {typeof t.count === "number" && (
                    <span
                      className={`inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 text-[10px] font-semibold rounded-full ${
                        t.countActive
                          ? "bg-text-primary text-text-inverse"
                          : "bg-bg-tertiary text-text-secondary border border-border"
                      }`}
                    >
                      {t.count}
                    </span>
                  )}
                </span>
                {isActive && (
                  <span className="absolute left-0 right-0 -bottom-px h-0.5 bg-text-primary rounded-full" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Panels — on rend tous les enfants et on cache les inactifs pour préserver leur state.
          (React Server Components peuvent être passés en children à un client component.) */}
      <div className={active === "dashboard" ? "block" : "hidden"}>{dashboardPanel}</div>
      <div className={active === "cart"      ? "block" : "hidden"}>{cartPanel}</div>
      <div className={active === "marketing" ? "block" : "hidden"}>{marketingPanel}</div>
      <div className={active === "orders"    ? "block" : "hidden"}>{ordersPanel}</div>
    </div>
  );
}
