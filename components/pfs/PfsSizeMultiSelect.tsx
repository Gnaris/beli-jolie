/**
 * Stub — the PFS in-form size mapping UI was removed. Marketplaces are now
 * populated via manual Excel upload. This component is retained as a no-op
 * to keep legacy references compiling.
 */
"use client";

export interface PfsSizeMultiSelectProps {
  value?: string[];
  onChange?: (next: string[]) => void;
  placeholder?: string;
  pfsSizes?: { reference: string; label: string }[];
  selected?: Set<string> | string[];
  onToggle?: (ref: string) => void;
  disabled?: boolean;
  className?: string;
}

export default function PfsSizeMultiSelect(_props: PfsSizeMultiSelectProps) {
  return null;
}
