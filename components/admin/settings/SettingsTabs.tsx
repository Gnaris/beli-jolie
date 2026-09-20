"use client";

import { useState, type ReactNode } from "react";

export interface SettingsTab {
  key: string;
  label: string;
  count?: number; // Badge chiffré (ex. « 4 » pour 4 photos)
  content: ReactNode;
}

interface Props {
  tabs: SettingsTab[];
  initialKey?: string;
}

/**
 * Onglets horizontaux pour segmenter une modale Paramètres en plusieurs zones
 * (ex. Vitrine → Général / Accueil / Qui sommes-nous).
 * Style aligné avec le reste du dashboard admin (rounded-full, hover, actif =
 * bg-bg-primary avec ombre douce).
 */
export default function SettingsTabs({ tabs, initialKey }: Props) {
  const [active, setActive] = useState<string>(initialKey ?? tabs[0]?.key ?? "");
  const activeTab = tabs.find((t) => t.key === active) ?? tabs[0];
  if (!activeTab) return null;

  // Classes marqueur `settings-tabs*` : servent d'ancre à un override dark
  // dédié dans globals.css. Le SettingsModal est monté via `createPortal` sur
  // `document.body` (hors du wrapper `#admin-theme-wrapper`) : sans marqueurs
  // dédiés, dans certains contextes de cascade, l'onglet actif retombait sur
  // ses valeurs light (fond blanc + texte clair invisible — screenshot du
  // 2026-09-20). Voir bloc « SettingsTabs — dark mode » de globals.css.
  return (
    <div className="settings-tabs">
      <div className="settings-tabs__bar mb-6 inline-flex items-center gap-1 rounded-full bg-bg-secondary border border-border p-1">
        {tabs.map((t) => {
          const isActive = t.key === activeTab.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setActive(t.key)}
              className={`settings-tabs__tab ${isActive ? "settings-tabs__tab--active" : ""} inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-body font-semibold transition ${
                isActive
                  ? "bg-bg-primary text-text-primary shadow-sm"
                  : "text-text-muted hover:text-text-primary"
              }`}
            >
              {t.label}
              {typeof t.count === "number" && (
                <span
                  className={`inline-flex items-center justify-center min-w-[20px] h-[20px] px-1.5 rounded-full text-[10px] font-bold tabular-nums ${
                    isActive ? "bg-text-primary text-bg-primary" : "bg-bg-tertiary text-text-secondary"
                  }`}
                >
                  {t.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div>{activeTab.content}</div>
    </div>
  );
}
