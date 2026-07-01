"use client";

import { useState } from "react";
import type { ChecklistInput } from "./CompletenessChecklist";
import { computeChecklist } from "./CompletenessChecklist";

export type ProductFormSectionKey =
  | "overview"
  | "info"
  | "details"
  | "variants"
  | "links";

interface SectionDef {
  key: ProductFormSectionKey;
  label: string;
  hint: string;
  /** Keys from CompletenessChecklist that "live" in this section */
  checklistKeys: string[];
  /** Anchor id rendered in ProductForm */
  anchor: string;
}

const SECTIONS: SectionDef[] = [
  {
    key: "overview",
    label: "Vue d'ensemble",
    hint: "État du produit",
    checklistKeys: [],
    anchor: "section-overview",
  },
  {
    key: "info",
    label: "Fiche produit",
    hint: "Nom, catégorie, description",
    checklistKeys: ["reference", "name", "description", "category"],
    anchor: "section-info",
  },
  {
    key: "details",
    label: "Détails",
    hint: "Composition, dimensions",
    checklistKeys: ["composition"],
    anchor: "section-details",
  },
  {
    key: "variants",
    label: "Variantes & images",
    hint: "Couleurs, tailles, prix, photos",
    checklistKeys: [
      "variants",
      "prices",
      "weights",
      "stocks",
      "sizes",
      "images",
    ],
    anchor: "section-variants",
  },
  {
    key: "links",
    label: "Produits associés",
    hint: "Similaires + Ensemble",
    checklistKeys: [],
    anchor: "section-links",
  },
];

interface SectionProgress {
  total: number;
  done: number;
  isFull: boolean;
  hasItems: boolean;
}

function computeSectionsProgress(
  input: ChecklistInput
): Record<ProductFormSectionKey, SectionProgress> {
  const items = computeChecklist(input);
  const byKey = new Map(items.map((i) => [i.key, i]));

  const result = {} as Record<ProductFormSectionKey, SectionProgress>;
  for (const sec of SECTIONS) {
    const present = sec.checklistKeys
      .map((k) => byKey.get(k))
      .filter((it): it is NonNullable<typeof it> => Boolean(it));
    const total = present.length;
    const done = present.filter((it) => it.done).length;
    result[sec.key] = {
      total,
      done,
      isFull: total > 0 && done === total,
      hasItems: total > 0,
    };
  }
  return result;
}

export { computeSectionsProgress, SECTIONS };

interface ProductFormNavProps {
  checklistInput: ChecklistInput;
  /** Currently saved status — drives the "publish" hint at the bottom */
  productStatus?: "OFFLINE" | "ONLINE" | "ARCHIVED" | "SYNCING";
  /** True if user has dirty changes (edit mode) */
  hasUnsavedChanges?: boolean;
  /** "create" or "edit" */
  mode?: "create" | "edit";
  /** Section actuellement affichée dans le formulaire (mode onglets) */
  activeSection?: ProductFormSectionKey;
  /** Callback appelé quand l'utilisatrice change de section */
  onSectionChange?: (key: ProductFormSectionKey) => void;
}

export default function ProductFormNav({
  checklistInput,
  productStatus,
  hasUnsavedChanges,
  mode,
  activeSection,
  onSectionChange,
}: ProductFormNavProps) {
  const [internalKey, setInternalKey] =
    useState<ProductFormSectionKey>("overview");
  const activeKey = activeSection ?? internalKey;
  const progress = computeSectionsProgress(checklistInput);

  function handleClick(_anchor: string, key: ProductFormSectionKey) {
    if (onSectionChange) {
      onSectionChange(key);
    } else {
      setInternalKey(key);
    }
    // Retour tout en haut pour que le panneau soit visible
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const overallStatusLabel = (() => {
    if (productStatus === "ARCHIVED") return "Archivé";
    if (productStatus === "ONLINE") return "En ligne";
    if (productStatus === "SYNCING") return "Publication en cours";
    return mode === "create" ? "Nouveau brouillon" : "Hors ligne";
  })();

  const overallStatusTone = (() => {
    if (productStatus === "ONLINE") return "online";
    if (productStatus === "ARCHIVED") return "archived";
    if (productStatus === "SYNCING") return "syncing";
    return "offline";
  })();

  return (
    <nav
      aria-label="Sections du formulaire produit"
      data-testid="product-form-nav"
      className="hidden xl:block xl:sticky xl:top-4 xl:self-start xl:max-h-[calc(100vh-2rem)] xl:overflow-y-auto bg-bg-primary border border-border rounded-2xl p-4 shadow-[0_1px_4px_rgba(0,0,0,0.06)]"
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-text-muted font-heading mb-3 px-1">
        Sections du produit
      </p>

      <ul className="space-y-1">
        {SECTIONS.map((sec) => {
          const p = progress[sec.key];
          const isActive = sec.key === activeKey;
          return (
            <li key={sec.key}>
              <button
                type="button"
                onClick={() => handleClick(sec.anchor, sec.key)}
                aria-current={isActive ? "true" : undefined}
                data-testid={`nav-${sec.key}`}
                className={`group relative w-full text-left px-3 py-2.5 rounded-lg transition-colors flex items-start gap-2.5 ${
                  isActive
                    ? "bg-bg-dark text-text-inverse"
                    : "hover:bg-bg-secondary text-text-primary"
                }`}
              >
                <SectionDot
                  progress={p}
                  isActive={isActive}
                />
                <span className="flex-1 min-w-0">
                  <span
                    className={`block text-sm font-semibold font-body ${
                      isActive ? "text-text-inverse" : "text-text-primary"
                    }`}
                  >
                    {sec.label}
                  </span>
                  <span
                    className={`block text-[11px] font-body mt-0.5 ${
                      isActive
                        ? "text-text-inverse/70"
                        : "text-text-muted"
                    }`}
                  >
                    {sec.hint}
                  </span>
                  {p.hasItems && (
                    <span
                      className={`block text-[10px] font-body mt-0.5 ${
                        isActive
                          ? "text-text-inverse/80"
                          : p.isFull
                            ? "text-emerald-600"
                            : "text-[#EF4444]"
                      }`}
                    >
                      {p.done} / {p.total} renseigné{p.total > 1 ? "s" : ""}
                    </span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <div className="mt-4 pt-4 border-t border-border space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-text-muted font-heading px-1">
          État
        </p>
        <span
          data-testid="nav-status"
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold font-body w-full justify-center ${
            overallStatusTone === "online"
              ? "bg-[#DCFCE7] text-[#15803D] border border-[#BBF7D0]"
              : overallStatusTone === "archived"
                ? "bg-[#F3F4F6] text-[#4B5563] border border-[#E5E7EB]"
                : overallStatusTone === "syncing"
                  ? "bg-[#FFF7ED] text-[#C2410C] border border-[#FED7AA]"
                  : "bg-[#F3E8FF] text-[#7C3AED] border border-[#DDD6FE]"
          }`}
        >
          {overallStatusTone === "syncing" && (
            <svg
              className="w-3 h-3 animate-spin"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
          )}
          {overallStatusLabel}
        </span>
        {hasUnsavedChanges && (
          <p
            data-testid="nav-unsaved"
            className="text-[10px] text-[#C2410C] font-body text-center"
          >
            Modifications non enregistrées
          </p>
        )}
      </div>
    </nav>
  );
}

function SectionDot({
  progress,
  isActive,
}: {
  progress: SectionProgress;
  isActive: boolean;
}) {
  // No checklist items in this section — neutral dot
  if (!progress.hasItems) {
    return (
      <span
        aria-hidden
        className={`mt-1 inline-block w-2.5 h-2.5 rounded-full shrink-0 ${
          isActive ? "bg-text-inverse/80" : "bg-[#9CA3AF]"
        }`}
      />
    );
  }
  if (progress.isFull) {
    return (
      <svg
        aria-hidden
        className={`w-4 h-4 shrink-0 mt-0.5 ${
          isActive ? "text-emerald-300" : "text-emerald-600"
        }`}
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2.5}
          d="M5 13l4 4L19 7"
        />
      </svg>
    );
  }
  return (
    <span
      aria-hidden
      className={`mt-1 inline-block w-2.5 h-2.5 rounded-full shrink-0 ${
        isActive ? "bg-[#FCA5A5]" : "bg-[#EF4444]"
      }`}
    />
  );
}
