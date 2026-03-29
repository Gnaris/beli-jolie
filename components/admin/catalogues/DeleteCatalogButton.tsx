"use client";

import { useState, useTransition } from "react";
import { deleteCatalog } from "@/app/actions/admin/catalogs";
import { useLoadingOverlay } from "@/components/ui/LoadingOverlay";

interface Props {
  id: string;
  title: string;
}

export default function DeleteCatalogButton({ id, title }: Props) {
  const [confirm, setConfirm] = useState(false);
  const [isPending, startTransition] = useTransition();
  const { showLoading, hideLoading } = useLoadingOverlay();

  if (confirm) {
    return (
      <div className="flex items-center gap-1">
        <button
          onClick={() => { showLoading(); startTransition(async () => { try { await deleteCatalog(id); } finally { hideLoading(); } }); }}
          disabled={isPending}
          className="text-xs px-2 py-1 rounded bg-[#EF4444] text-white hover:bg-[#DC2626] transition-colors disabled:opacity-50"
        >
          {isPending ? "…" : "Confirmer"}
        </button>
        <button
          onClick={() => setConfirm(false)}
          className="text-xs px-2 py-1 rounded bg-[#F3F4F6] text-[#6B7280] hover:bg-[#E5E5E5] transition-colors"
        >
          Annuler
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => setConfirm(true)}
      title={`Supprimer "${title}"`}
      className="w-8 h-8 flex items-center justify-center rounded-lg border border-border hover:bg-[#FEF2F2] hover:border-[#FCA5A5] hover:text-[#EF4444] transition-colors text-[#6B7280]"
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
          d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
      </svg>
    </button>
  );
}
