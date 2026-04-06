"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { togglePromotion } from "@/app/actions/admin/promotions";
import { useToast } from "@/components/ui/Toast";
import type { getPromotions } from "@/app/actions/admin/promotions";

type Promotion = Awaited<ReturnType<typeof getPromotions>>[number];

const DISCOUNT_LABELS: Record<string, string> = {
  PERCENTAGE: "%",
  FIXED_AMOUNT: "EUR",
  FREE_SHIPPING: "Livraison gratuite",
};

export default function PromotionsList({ promotions }: { promotions: Promotion[] }) {
  const [filter, setFilter] = useState<"all" | "active" | "expired">("all");
  const [isPending, startTransition] = useTransition();
  const toast = useToast();

  const now = new Date();
  const filtered = promotions.filter((p) => {
    if (filter === "active") return p.isActive && (!p.endsAt || new Date(p.endsAt) > now);
    if (filter === "expired") return !p.isActive || (p.endsAt && new Date(p.endsAt) < now);
    return true;
  });

  function handleToggle(id: string) {
    startTransition(async () => {
      const result = await togglePromotion(id);
      if (result.success) toast.success("Statut mis a jour");
      else toast.error(result.error || "Erreur");
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-1 bg-bg-secondary rounded-lg p-1 w-fit">
        {(["all", "active", "expired"] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-3 py-1.5 text-sm font-body rounded-md transition-colors ${
              filter === f ? "bg-bg-primary text-text-primary shadow-sm" : "text-text-muted hover:text-text-primary"
            }`}>
            {f === "all" ? "Toutes" : f === "active" ? "Actives" : "Expirees"}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="bg-bg-primary border border-border rounded-2xl p-8 text-center">
          <p className="text-text-muted font-body">Aucune promotion.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((promo) => (
            <div key={promo.id} className="bg-bg-primary border border-border rounded-2xl p-4 flex items-center justify-between gap-4">
              <Link href={`/admin/promotions/${promo.id}`} className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-heading font-semibold text-text-primary">{promo.name}</span>
                  <span className={`badge ${promo.type === "CODE" ? "badge-info" : "badge-purple"}`}>
                    {promo.type === "CODE" ? "Code" : "Auto"}
                  </span>
                  {promo.code && <span className="text-xs font-mono text-text-muted bg-bg-secondary px-2 py-0.5 rounded">{promo.code}</span>}
                </div>
                <p className="text-sm text-text-muted font-body mt-1">
                  {promo.discountKind === "FREE_SHIPPING"
                    ? "Livraison gratuite"
                    : `${Number(promo.discountValue)}${DISCOUNT_LABELS[promo.discountKind] || ""}`}
                  {promo.minOrderAmount && ` — min ${Number(promo.minOrderAmount)}EUR`}
                  {" — "}{promo._count.usages} utilisation{promo._count.usages !== 1 ? "s" : ""}
                  {promo.maxUses && ` / ${promo.maxUses}`}
                </p>
              </Link>
              <button onClick={() => handleToggle(promo.id)} disabled={isPending}
                className={`px-3 py-1.5 text-xs font-body rounded-lg transition-colors ${
                  promo.isActive
                    ? "bg-[#22C55E]/10 text-[#22C55E] hover:bg-[#22C55E]/20"
                    : "bg-bg-secondary text-text-muted hover:bg-border"
                }`}>
                {promo.isActive ? "Actif" : "Inactif"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
