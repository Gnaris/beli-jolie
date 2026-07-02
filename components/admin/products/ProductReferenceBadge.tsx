"use client";

import { useState } from "react";
import { useToast } from "@/components/ui/Toast";

export function ProductReferenceBadge({ reference }: { reference: string }) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(reference);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Impossible de copier la référence");
    }
  }

  return (
    <span className="inline-flex items-center gap-1 font-mono text-[11px] bg-bg-tertiary pl-2.5 pr-1 py-1 rounded-md text-text-secondary border border-border-light font-semibold">
      <span>{reference}</span>
      <button
        type="button"
        onClick={handleCopy}
        title={copied ? "Référence copiée" : "Copier la référence"}
        aria-label={copied ? "Référence copiée" : "Copier la référence"}
        className="inline-flex items-center justify-center w-5 h-5 rounded text-text-muted hover:bg-bg-primary hover:text-text-primary transition-colors"
      >
        {copied ? (
          <svg className="w-3 h-3 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
          </svg>
        ) : (
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
        )}
      </button>
    </span>
  );
}
