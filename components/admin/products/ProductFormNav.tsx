"use client";

import { useState } from "react";
import type { ChecklistInput } from "./CompletenessChecklist";
import { computeChecklist } from "./CompletenessChecklist";

export type ProductFormSectionKey =
  | "general"
  | "cat"
  | "dim"
  | "comp"
  | "tags"
  | "var"
  | "img"
  | "map"
  | "assoc"
  | "note";

export type ProductFormSectionGroup =
  | "Base"
  | "Catalogue"
  | "Diffusion"
  | "Interne";

interface SectionDef {
  key: ProductFormSectionKey;
  group: ProductFormSectionGroup;
  label: string;
  hint: string;
  icon: string;
  /** Keys from CompletenessChecklist that "live" in this section */
  checklistKeys: string[];
  /** Anchor id rendered in ProductForm */
  anchor: string;
}

const SECTIONS: SectionDef[] = [
  { key: "general", group: "Base", label: "Général", hint: "Nom, référence, description", icon: "📝", checklistKeys: ["reference", "name", "description"], anchor: "section-general" },
  { key: "cat", group: "Base", label: "Catégorie", hint: "Classement, pays, saison", icon: "📂", checklistKeys: ["category"], anchor: "section-cat" },
  { key: "dim", group: "Base", label: "Dimensions", hint: "L, l, H, poids", icon: "📏", checklistKeys: [], anchor: "section-dim" },
  { key: "comp", group: "Base", label: "Composition", hint: "Matières et %", icon: "⚗️", checklistKeys: ["composition"], anchor: "section-comp" },
  { key: "tags", group: "Base", label: "Mots-clés", hint: "Tags de recherche", icon: "🏷️", checklistKeys: [], anchor: "section-tags" },
  { key: "var", group: "Catalogue", label: "Variantes", hint: "Couleurs, tailles, prix, stock", icon: "🎨", checklistKeys: ["variants", "prices", "weights", "stocks", "sizes"], anchor: "section-var" },
  { key: "img", group: "Catalogue", label: "Photos", hint: "5 photos par couleur", icon: "📷", checklistKeys: ["images"], anchor: "section-img" },
  { key: "map", group: "Catalogue", label: "Mapping PFS", hint: "Correspondance couleurs", icon: "🔗", checklistKeys: [], anchor: "section-map" },
  { key: "assoc", group: "Diffusion", label: "Produits associés", hint: "Similaires + ensemble", icon: "🧩", checklistKeys: [], anchor: "section-assoc" },
  { key: "note", group: "Interne", label: "Note", hint: "Visible admin uniquement", icon: "📌", checklistKeys: [], anchor: "section-note" },
];

const GROUP_ORDER: ProductFormSectionGroup[] = ["Base", "Catalogue", "Diffusion", "Interne"];

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
  productStatus?: "OFFLINE" | "ONLINE" | "ARCHIVED" | "SYNCING";
  hasUnsavedChanges?: boolean;
  mode?: "create" | "edit";
  activeSection?: ProductFormSectionKey;
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
    useState<ProductFormSectionKey>("general");
  const activeKey = activeSection ?? internalKey;
  const progress = computeSectionsProgress(checklistInput);

  function handleClick(key: ProductFormSectionKey) {
    if (onSectionChange) {
      onSectionChange(key);
    } else {
      setInternalKey(key);
    }
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
      className="hidden xl:block xl:sticky xl:top-4 xl:self-start xl:max-h-[calc(100vh-2rem)] xl:overflow-y-auto bg-bg-primary border border-border rounded-2xl p-3 shadow-[0_1px_4px_rgba(0,0,0,0.06)]"
    >
      {GROUP_ORDER.map((groupName) => {
        const sectionsInGroup = SECTIONS.filter((s) => s.group === groupName);
        return (
          <div key={groupName} className="mb-4 last:mb-0">
            <p className="text-[10px] font-heading font-bold uppercase tracking-[0.12em] text-text-muted mb-1.5 px-2 pt-1">
              {groupName}
            </p>
            <ul className="space-y-0.5">
              {sectionsInGroup.map((sec) => {
                const p = progress[sec.key];
                const isActive = sec.key === activeKey;
                return (
                  <li key={sec.key}>
                    <button
                      type="button"
                      onClick={() => handleClick(sec.key)}
                      aria-current={isActive ? "true" : undefined}
                      data-testid={`nav-${sec.key}`}
                      className={`group relative w-full text-left px-2.5 py-2 rounded-lg transition-colors flex items-center gap-2.5 ${
                        isActive
                          ? "bg-bg-dark text-text-inverse"
                          : "hover:bg-bg-secondary text-text-primary"
                      }`}
                    >
                      <span className="text-[15px] leading-none shrink-0" aria-hidden>
                        {sec.icon}
                      </span>
                      <span className="flex-1 min-w-0">
                        <span
                          className={`block text-[13px] font-semibold font-body leading-tight ${
                            isActive ? "text-text-inverse" : "text-text-primary"
                          }`}
                        >
                          {sec.label}
                        </span>
                      </span>
                      <SectionDot progress={p} isActive={isActive} />
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}

      <div className="mt-3 pt-3 border-t border-border space-y-2">
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
  if (!progress.hasItems) {
    return (
      <span
        aria-hidden
        className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${
          isActive ? "bg-text-inverse/60" : "bg-border-dark"
        }`}
      />
    );
  }
  if (progress.isFull) {
    return (
      <svg
        aria-hidden
        className={`w-3.5 h-3.5 shrink-0 ${
          isActive ? "text-emerald-300" : "text-emerald-600"
        }`}
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={3}
          d="M5 13l4 4L19 7"
        />
      </svg>
    );
  }
  return (
    <span
      aria-hidden
      className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${
        isActive ? "bg-[#FCA5A5]" : "bg-[#EF4444]"
      }`}
    />
  );
}
