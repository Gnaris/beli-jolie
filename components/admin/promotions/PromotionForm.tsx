"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createPromotion, updatePromotion } from "@/app/actions/admin/promotions";
import { useToast } from "@/components/ui/Toast";

interface PromotionData {
  id?: string;
  name: string;
  type: "CODE" | "AUTO";
  code: string;
  discountKind: "PERCENTAGE" | "FIXED_AMOUNT" | "FREE_SHIPPING";
  discountValue: string;
  minOrderAmount: string;
  maxUses: string;
  maxUsesPerUser: string;
  firstOrderOnly: boolean;
  appliesToAll: boolean;
  startsAt: string;
  endsAt: string;
}

const DEFAULT_DATA: PromotionData = {
  name: "", type: "CODE", code: "", discountKind: "PERCENTAGE",
  discountValue: "", minOrderAmount: "", maxUses: "", maxUsesPerUser: "",
  firstOrderOnly: false, appliesToAll: true,
  startsAt: new Date().toISOString().slice(0, 16),
  endsAt: "",
};

export default function PromotionForm({ initial }: { initial?: Partial<PromotionData> & { id?: string } }) {
  const [data, setData] = useState<PromotionData>({ ...DEFAULT_DATA, ...initial });
  const [isPending, startTransition] = useTransition();
  const toast = useToast();
  const router = useRouter();

  function update<K extends keyof PromotionData>(key: K, value: PromotionData[K]) {
    setData((prev) => ({ ...prev, [key]: value }));
  }

  function generateCode() {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let code = "";
    for (let i = 0; i < 8; i++) code += chars[Math.floor(Math.random() * chars.length)];
    update("code", code);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const input = {
      name: data.name,
      type: data.type,
      code: data.type === "CODE" ? data.code : undefined,
      discountKind: data.discountKind,
      discountValue: parseFloat(data.discountValue) || 0,
      minOrderAmount: data.minOrderAmount ? parseFloat(data.minOrderAmount) : undefined,
      maxUses: data.maxUses ? parseInt(data.maxUses) : undefined,
      maxUsesPerUser: data.maxUsesPerUser ? parseInt(data.maxUsesPerUser) : undefined,
      firstOrderOnly: data.firstOrderOnly,
      appliesToAll: data.appliesToAll,
      startsAt: data.startsAt,
      endsAt: data.endsAt || undefined,
    };

    startTransition(async () => {
      const result = data.id
        ? await updatePromotion(data.id, input)
        : await createPromotion(input);

      if (result.success) {
        toast.success(data.id ? "Promotion mise a jour" : "Promotion creee");
        router.push("/admin/promotions");
      } else {
        toast.error(result.error || "Erreur");
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-w-2xl">
      <div className="bg-bg-primary border border-border rounded-2xl p-6 space-y-4 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
        <h3 className="font-heading font-bold text-text-primary">Informations</h3>

        <div>
          <label className="text-xs uppercase tracking-wider text-text-muted font-semibold font-body block mb-1">Nom</label>
          <input type="text" value={data.name} onChange={(e) => update("name", e.target.value)}
            className="w-full border border-border bg-bg-primary px-3 py-2 text-sm rounded-lg text-text-primary font-body" />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs uppercase tracking-wider text-text-muted font-semibold font-body block mb-1">Type</label>
            <div className="flex gap-2">
              {(["CODE", "AUTO"] as const).map((t) => (
                <button key={t} type="button" onClick={() => update("type", t)}
                  className={`px-4 py-2 text-sm font-body rounded-lg ${data.type === t ? "bg-[#1A1A1A] text-white" : "bg-bg-secondary text-text-muted"}`}>
                  {t === "CODE" ? "Code promo" : "Automatique"}
                </button>
              ))}
            </div>
          </div>

          {data.type === "CODE" && (
            <div>
              <label className="text-xs uppercase tracking-wider text-text-muted font-semibold font-body block mb-1">Code</label>
              <div className="flex gap-2">
                <input type="text" value={data.code} onChange={(e) => update("code", e.target.value.toUpperCase())}
                  className="flex-1 border border-border bg-bg-primary px-3 py-2 text-sm rounded-lg text-text-primary font-body font-mono" />
                <button type="button" onClick={generateCode}
                  className="px-3 py-2 text-xs font-body bg-bg-secondary text-text-muted rounded-lg hover:bg-border">
                  Generer
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="bg-bg-primary border border-border rounded-2xl p-6 space-y-4 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
        <h3 className="font-heading font-bold text-text-primary">Remise</h3>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs uppercase tracking-wider text-text-muted font-semibold font-body block mb-1">Type de remise</label>
            <div className="flex gap-1">
              {(["PERCENTAGE", "FIXED_AMOUNT", "FREE_SHIPPING"] as const).map((dk) => (
                <button key={dk} type="button" onClick={() => update("discountKind", dk)}
                  className={`px-3 py-1.5 text-xs font-body rounded-md ${data.discountKind === dk ? "bg-[#1A1A1A] text-white" : "bg-bg-secondary text-text-muted"}`}>
                  {dk === "PERCENTAGE" ? "%" : dk === "FIXED_AMOUNT" ? "EUR" : "Livraison"}
                </button>
              ))}
            </div>
          </div>

          {data.discountKind !== "FREE_SHIPPING" && (
            <div>
              <label className="text-xs uppercase tracking-wider text-text-muted font-semibold font-body block mb-1">Valeur</label>
              <input type="number" min="0" step="0.01" value={data.discountValue} onChange={(e) => update("discountValue", e.target.value)}
                className="w-full border border-border bg-bg-primary px-3 py-2 text-sm rounded-lg text-text-primary font-body" />
            </div>
          )}
        </div>

        <div>
          <label className="text-xs uppercase tracking-wider text-text-muted font-semibold font-body block mb-1">Commande minimum (EUR HT)</label>
          <input type="number" min="0" step="0.01" value={data.minOrderAmount} onChange={(e) => update("minOrderAmount", e.target.value)}
            placeholder="Optionnel" className="w-full border border-border bg-bg-primary px-3 py-2 text-sm rounded-lg text-text-primary font-body" />
        </div>
      </div>

      <div className="bg-bg-primary border border-border rounded-2xl p-6 space-y-4 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
        <h3 className="font-heading font-bold text-text-primary">Restrictions</h3>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs uppercase tracking-wider text-text-muted font-semibold font-body block mb-1">Max utilisations</label>
            <input type="number" min="0" value={data.maxUses} onChange={(e) => update("maxUses", e.target.value)}
              placeholder="Illimite" className="w-full border border-border bg-bg-primary px-3 py-2 text-sm rounded-lg text-text-primary font-body" />
          </div>
          <div>
            <label className="text-xs uppercase tracking-wider text-text-muted font-semibold font-body block mb-1">Max par client</label>
            <input type="number" min="0" value={data.maxUsesPerUser} onChange={(e) => update("maxUsesPerUser", e.target.value)}
              placeholder="Illimite" className="w-full border border-border bg-bg-primary px-3 py-2 text-sm rounded-lg text-text-primary font-body" />
          </div>
        </div>

        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={data.firstOrderOnly} onChange={(e) => update("firstOrderOnly", e.target.checked)} />
          <span className="text-sm font-body text-text-primary">Premiere commande uniquement</span>
        </label>

        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={data.appliesToAll} onChange={(e) => update("appliesToAll", e.target.checked)} />
          <span className="text-sm font-body text-text-primary">S&apos;applique a tous les produits</span>
        </label>
      </div>

      <div className="bg-bg-primary border border-border rounded-2xl p-6 space-y-4 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
        <h3 className="font-heading font-bold text-text-primary">Dates</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs uppercase tracking-wider text-text-muted font-semibold font-body block mb-1">Debut</label>
            <input type="datetime-local" value={data.startsAt} onChange={(e) => update("startsAt", e.target.value)}
              className="w-full border border-border bg-bg-primary px-3 py-2 text-sm rounded-lg text-text-primary font-body" />
          </div>
          <div>
            <label className="text-xs uppercase tracking-wider text-text-muted font-semibold font-body block mb-1">Fin (optionnel)</label>
            <input type="datetime-local" value={data.endsAt} onChange={(e) => update("endsAt", e.target.value)}
              className="w-full border border-border bg-bg-primary px-3 py-2 text-sm rounded-lg text-text-primary font-body" />
          </div>
        </div>
      </div>

      <button type="submit" disabled={!data.name.trim() || isPending}
        className="w-full px-4 py-3 text-sm font-body bg-[#1A1A1A] text-white rounded-xl hover:bg-[#333] disabled:opacity-40 transition-colors">
        {isPending ? "..." : data.id ? "Mettre a jour" : "Creer la promotion"}
      </button>
    </form>
  );
}
