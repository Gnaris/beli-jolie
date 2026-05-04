"use client";

import { useState } from "react";
import { useRefreshMarketplaceDialog } from "@/components/admin/products/useRefreshMarketplaceDialog";

export function ProductEditRefreshButton({
  productId,
  reference,
  productName,
  firstImage,
}: {
  productId: string;
  reference: string;
  productName: string;
  firstImage?: string | null;
}) {
  const [pending, setPending] = useState(false);
  const { refreshSingle } = useRefreshMarketplaceDialog();

  return (
    <button
      type="button"
      onClick={async () => {
        if (pending) return;
        setPending(true);
        try {
          await refreshSingle({ productId, reference, productName, firstImage });
        } finally {
          setPending(false);
        }
      }}
      disabled={pending}
      className="inline-flex items-center gap-2 px-3.5 py-2 text-[13px] font-medium text-text-secondary bg-bg-primary border border-border rounded-none hover:border-border-dark hover:text-text-primary transition-all font-body shadow-sm disabled:opacity-50 disabled:cursor-wait"
      title="Rafraîchir (boutique + marketplaces)"
    >
      <svg
        className={`w-4 h-4 ${pending ? "animate-spin" : ""}`}
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M20.015 4.356v4.992"
        />
      </svg>
      Rafraîchir
    </button>
  );
}
