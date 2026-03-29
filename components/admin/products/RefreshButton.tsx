"use client";

import { useRouter } from "next/navigation";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { usePfsRefresh } from "@/components/admin/pfs/PfsRefreshContext";
import { refreshProduct } from "@/app/actions/admin/products";
import { useState } from "react";

interface Props {
  href: string;
  productId?: string;
  productName?: string;
  productReference?: string;
  hasPfsConfig?: boolean;
}

export default function RefreshButton({ href, productId, productName, productReference, hasPfsConfig }: Props) {
  const router = useRouter();
  const { confirm } = useConfirm();
  const pfsRefresh = usePfsRefresh();
  const [refreshing, setRefreshing] = useState(false);
  const pfsRefreshing = productId ? pfsRefresh?.isRefreshing(productId) : false;

  async function handleClick() {
    const message = hasPfsConfig
      ? "Le produit sera remis en \"Nouveauté\" avec la date du jour.\nSur PFS, le produit sera recréé comme nouveau."
      : "Le produit sera remis en \"Nouveauté\" avec la date du jour.";

    const ok = await confirm({
      type: "warning",
      title: "Rafraîchir ce produit ?",
      message,
      confirmLabel: "Rafraîchir",
    });
    if (!ok) return;

    setRefreshing(true);

    // Refresh createdAt locally
    if (productId) {
      try { await refreshProduct(productId); } catch { /* ignore */ }
    }

    // Enqueue PFS refresh
    if (hasPfsConfig && pfsRefresh && productId && productName && productReference) {
      pfsRefresh.enqueue(productId, productName, productReference);
    }

    router.push(href);
    router.refresh();
    setRefreshing(false);
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={refreshing || pfsRefreshing}
      className={`inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-text-secondary bg-bg-primary border border-border rounded-lg hover:border-bg-dark hover:text-text-primary transition-colors font-body ${
        refreshing || pfsRefreshing ? "opacity-50 cursor-wait" : ""
      }`}
      title="Rafraîchir (remettre en Nouveauté)"
    >
      <svg className={`w-4 h-4 ${refreshing || pfsRefreshing ? "animate-spin" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M20.015 4.356v4.992" />
      </svg>
      Rafraîchir
    </button>
  );
}
