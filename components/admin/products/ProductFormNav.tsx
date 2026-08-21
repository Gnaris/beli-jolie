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
  | "mp-config"
  | "assoc"
  | "note";

export type ProductFormSectionGroup =
  | "Base"
  | "Catalogue"
  | "Marketplace"
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
  { key: "map", group: "Marketplace", label: "Mapping Marketplaces", hint: "PFS, Ankor, eFashion, Faire", icon: "🔗", checklistKeys: [], anchor: "section-map" },
  { key: "mp-config", group: "Marketplace", label: "Configuration Marketplace", hint: "Activer/désactiver par marketplace", icon: "⚙️", checklistKeys: [], anchor: "section-mp-config" },
  { key: "assoc", group: "Diffusion", label: "Produits associés", hint: "Similaires + ensemble", icon: "🧩", checklistKeys: [], anchor: "section-assoc" },
  { key: "note", group: "Interne", label: "Note", hint: "Visible admin uniquement", icon: "📌", checklistKeys: [], anchor: "section-note" },
];

const GROUP_ORDER: ProductFormSectionGroup[] = ["Base", "Catalogue", "Marketplace", "Diffusion", "Interne"];

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
  hasUnsavedChanges?: boolean;
  activeSection?: ProductFormSectionKey;
  onSectionChange?: (key: ProductFormSectionKey) => void;
}

export default function ProductFormNav({
  checklistInput,
  hasUnsavedChanges,
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

  const orderedSections = GROUP_ORDER.flatMap((g) =>
    SECTIONS.filter((s) => s.group === g),
  );

  return (
    <nav
      aria-label="Sections du formulaire produit"
      data-testid="product-form-nav"
      className="hidden md:block sticky top-2 z-10 bg-bg-primary border border-border rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.06)]"
    >
      <div className="flex flex-wrap items-center gap-y-1 px-3 py-2">
        {orderedSections.map((sec, idx) => {
          const p = progress[sec.key];
          const isActive = sec.key === activeKey;
          return (
            <div key={sec.key} className="flex items-center">
              {idx > 0 && (
                <span
                  aria-hidden
                  className="w-px h-5 bg-border mx-1"
                  data-testid="nav-section-separator"
                />
              )}
              <button
                type="button"
                onClick={() => handleClick(sec.key)}
                aria-current={isActive ? "true" : undefined}
                data-testid={`nav-${sec.key}`}
                title={sec.hint}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full transition-colors font-body ${
                  isActive
                    ? "bg-bg-dark text-text-inverse text-[13px] font-semibold"
                    : "hover:bg-bg-secondary text-text-primary text-[13px] font-medium"
                }`}
              >
                <span className="text-[14px] leading-none shrink-0" aria-hidden>
                  {sec.icon}
                </span>
                <span className="whitespace-nowrap">{sec.label}</span>
                <SectionDot progress={p} isActive={isActive} />
              </button>
            </div>
          );
        })}

        {hasUnsavedChanges && (
          <div className="flex items-center ml-auto pl-2">
            <span
              data-testid="nav-unsaved"
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold font-body bg-[#FFF7ED] text-[#C2410C] border border-[#FED7AA] whitespace-nowrap"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-[#EA580C] animate-pulse" />
              Modifications non enregistrées
            </span>
          </div>
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
