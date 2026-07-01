"use client";
import { useState } from "react";
import type { ChecklistInput } from "./CompletenessChecklist";
import { SECTIONS, computeSectionsProgress, ProductFormSectionKey } from "./ProductFormNav";

interface Props {
  checklistInput: ChecklistInput;
  activeSection: ProductFormSectionKey;
  onSectionChange: (key: ProductFormSectionKey) => void;
}

export default function ProductFormSectionPicker({
  checklistInput,
  activeSection,
  onSectionChange,
}: Props) {
  const [open, setOpen] = useState(false);
  const progress = computeSectionsProgress(checklistInput);
  const current = SECTIONS.find((s) => s.key === activeSection) ?? SECTIONS[0];

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="xl:hidden w-full flex items-center gap-3 px-4 py-3 bg-bg-primary border border-border rounded-xl shadow-card text-left"
      >
        <span className="w-8 h-8 rounded-lg bg-bg-dark text-text-inverse inline-flex items-center justify-center font-heading font-bold text-sm">
          {SECTIONS.findIndex((s) => s.key === activeSection) + 1}
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-[10px] font-semibold tracking-[0.12em] uppercase text-text-muted font-body">
            Section actuelle
          </span>
          <span className="block font-heading font-semibold text-text-primary text-[14px] truncate">
            {current.label}
          </span>
        </span>
        <svg className="w-4 h-4 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div
          className="xl:hidden fixed inset-0 z-[60] flex items-center justify-center p-4"
          onClick={() => setOpen(false)}
        >
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
          <div
            className="relative w-full max-w-[360px] max-h-[80vh] overflow-y-auto bg-bg-primary rounded-2xl shadow-modal border border-border p-3"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-text-muted font-body px-2 py-2">
              Sections du produit
            </p>
            <ul className="space-y-1">
              {SECTIONS.map((sec, idx) => {
                const p = progress[sec.key];
                const isActive = sec.key === activeSection;
                return (
                  <li key={sec.key}>
                    <button
                      type="button"
                      onClick={() => {
                        onSectionChange(sec.key);
                        setOpen(false);
                      }}
                      className={`w-full text-left px-3 py-2.5 rounded-lg flex items-center gap-3 transition-colors ${
                        isActive
                          ? "bg-bg-dark text-text-inverse"
                          : "hover:bg-bg-secondary text-text-primary"
                      }`}
                    >
                      <span
                        className={`w-7 h-7 rounded-md inline-flex items-center justify-center font-heading font-bold text-[12px] shrink-0 ${
                          isActive
                            ? "bg-text-inverse/15 text-text-inverse"
                            : "bg-bg-tertiary text-text-secondary"
                        }`}
                      >
                        {idx + 1}
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block font-heading font-semibold text-[13.5px]">
                          {sec.label}
                        </span>
                        <span
                          className={`block text-[11px] font-body mt-0.5 ${
                            isActive ? "text-text-inverse/70" : "text-text-muted"
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
          </div>
        </div>
      )}
    </>
  );
}
