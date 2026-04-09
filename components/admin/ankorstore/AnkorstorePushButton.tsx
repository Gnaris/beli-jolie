"use client";

import { useState, useTransition } from "react";
import { useToast } from "@/components/ui/Toast";
import { pushSingleProductToAnkorstore } from "@/app/actions/admin/ankorstore";

interface Props {
  productId: string;
  ankorsProductId: string | null;
}

export default function AnkorstorePushButton({ productId, ankorsProductId }: Props) {
  const toast = useToast();
  const [isPushing, startPush] = useTransition();
  const [lastStatus, setLastStatus] = useState<"idle" | "success" | "error">("idle");

  function handlePush() {
    startPush(async () => {
      const result = await pushSingleProductToAnkorstore(productId);
      if (result.success) {
        setLastStatus("success");
        toast.success("Ankorstore", "Produit pousse avec succes.");
      } else {
        setLastStatus("error");
        toast.error("Ankorstore", result.error ?? "Echec du push.");
      }
    });
  }

  return (
    <button
      type="button"
      onClick={handlePush}
      disabled={isPushing}
      className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium font-body border rounded-lg transition-colors disabled:opacity-50"
      style={{
        borderColor: lastStatus === "success" ? "#22c55e" : lastStatus === "error" ? "#ef4444" : undefined,
        color: lastStatus === "success" ? "#22c55e" : lastStatus === "error" ? "#ef4444" : undefined,
      }}
      title={ankorsProductId ? `Lie a Ankorstore (${ankorsProductId.slice(0, 8)}...)` : "Pousser vers Ankorstore"}
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
      </svg>
      {isPushing ? "Push..." : "Ankorstore"}
      {ankorsProductId && lastStatus === "idle" && (
        <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
      )}
    </button>
  );
}
