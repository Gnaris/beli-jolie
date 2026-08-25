"use client";
import { useTransition } from "react";
import { enableAdminPreview } from "@/app/actions/admin/preview-mode";
import { useLoadingOverlay } from "@/components/ui/LoadingOverlay";

export default function AdminClientModeButton({ compact = false }: { compact?: boolean }) {
  const [pending, startTransition] = useTransition();
  const { showLoading, hideLoading } = useLoadingOverlay();

  function handleClick() {
    showLoading();
    startTransition(async () => {
      try {
        await enableAdminPreview();
        // Full reload obligatoire : le soft nav RSC après un redirect() serveur
        // resservait parfois le cache Router du domaine BJ sur issyma.fr → la
        // home Beli & Jolie s'affichait alors qu'on cliquait Mode client sur
        // Issyma. window.location résout "/" sur le host courant, symétrique
        // à disableAdminPreview.
        window.location.href = "/";
      } finally {
        hideLoading();
      }
    });
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending}
      title={compact ? (pending ? "Activation..." : "Mode client") : undefined}
      className={
        compact
          ? "w-full flex items-center justify-center px-3 py-2.5 text-zinc-600 hover:text-zinc-900 hover:bg-zinc-50 rounded-lg transition-colors"
          : "w-full flex items-center gap-3 px-3 py-2.5 text-sm font-body text-zinc-600 hover:text-zinc-900 hover:bg-zinc-50 rounded-lg transition-colors group"
      }
    >
      <svg className={`${compact ? "w-5 h-5" : "w-4 h-4"} shrink-0`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
      {!compact && (pending ? "Activation..." : "Mode client")}
    </button>
  );
}
