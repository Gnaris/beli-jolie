"use client";

import { useRouter } from "next/navigation";
import { useConfirm } from "@/components/ui/ConfirmDialog";

export default function RefreshButton({ href }: { href: string }) {
  const router = useRouter();
  const { confirm } = useConfirm();

  async function handleClick() {
    const ok = await confirm({
      type: "warning",
      title: "Rafraîchir la page ?",
      message: "Les modifications non enregistrées seront perdues.",
      confirmLabel: "Rafraîchir",
    });
    if (ok) {
      router.push(href);
      router.refresh();
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-text-secondary bg-bg-primary border border-border rounded-lg hover:border-bg-dark hover:text-text-primary transition-colors font-body"
      title="Rafraîchir la page"
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M20.015 4.356v4.992" />
      </svg>
      Rafraîchir
    </button>
  );
}
