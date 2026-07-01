"use client";
import { SECTIONS, ProductFormSectionKey } from "./ProductFormNav";

interface Props {
  activeSection: ProductFormSectionKey;
  onSectionChange: (key: ProductFormSectionKey) => void;
}

/** Navigation Précédent / Suivant en bas de chaque section (design Ardoise). */
export function SectionNavFooter({ activeSection, onSectionChange }: Props) {
  const idx = SECTIONS.findIndex((s) => s.key === activeSection);
  const prev = idx > 0 ? SECTIONS[idx - 1] : null;
  const next = idx < SECTIONS.length - 1 ? SECTIONS[idx + 1] : null;

  return (
    <div className="flex items-center justify-between gap-3 flex-wrap pt-5 mt-6 border-t border-dashed border-border">
      {prev ? (
        <button
          type="button"
          onClick={() => onSectionChange(prev.key)}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-body font-medium text-text-secondary hover:text-text-primary hover:bg-bg-secondary transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          <span className="flex flex-col items-start leading-tight">
            <span className="text-[10px] font-heading font-bold uppercase tracking-[0.12em] text-text-muted">
              Précédent
            </span>
            <span>{prev.label}</span>
          </span>
        </button>
      ) : (
        <span />
      )}

      {next ? (
        <button
          type="button"
          onClick={() => onSectionChange(next.key)}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-body font-semibold bg-bg-dark text-text-inverse hover:bg-black transition-colors"
        >
          <span className="flex flex-col items-end leading-tight">
            <span className="text-[10px] font-heading font-bold uppercase tracking-[0.12em] text-text-inverse/70">
              Suivant
            </span>
            <span>{next.label}</span>
          </span>
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>
      ) : (
        <span />
      )}
    </div>
  );
}
