"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClaim } from "@/app/actions/client/claims";
import { useToast } from "@/components/ui/Toast";

const REASONS = [
  { value: "DEFECTIVE", label: "Defectueux" },
  { value: "WRONG_ITEM", label: "Mauvais article" },
  { value: "MISSING", label: "Manquant" },
  { value: "DAMAGED", label: "Endommage" },
  { value: "OTHER", label: "Autre" },
];

interface Order {
  id: string;
  orderNumber: string;
  items: { id: string; productName: string; quantity: number }[];
}

export default function ClaimForm({ orders, preselectedOrderId }: { orders: Order[]; preselectedOrderId?: string }) {
  const [type, setType] = useState<"ORDER_CLAIM" | "GENERAL">(preselectedOrderId ? "ORDER_CLAIM" : "GENERAL");
  const [orderId, setOrderId] = useState(preselectedOrderId || "");
  const [description, setDescription] = useState("");
  const [selectedItems, setSelectedItems] = useState<Record<string, { quantity: number; reason: string; reasonDetail: string }>>({});
  const [isPending, startTransition] = useTransition();
  const { addToast } = useToast();
  const router = useRouter();

  const selectedOrder = orders.find((o) => o.id === orderId);

  function toggleItem(itemId: string) {
    setSelectedItems((prev) => {
      if (prev[itemId]) {
        const next = { ...prev };
        delete next[itemId];
        return next;
      }
      return { ...prev, [itemId]: { quantity: 1, reason: "DEFECTIVE", reasonDetail: "" } };
    });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!description.trim()) return;

    const items = type === "ORDER_CLAIM"
      ? Object.entries(selectedItems).map(([orderItemId, data]) => ({
          orderItemId,
          quantity: data.quantity,
          reason: data.reason,
          reasonDetail: data.reasonDetail || undefined,
        }))
      : undefined;

    startTransition(async () => {
      const result = await createClaim({
        type,
        orderId: type === "ORDER_CLAIM" ? orderId : undefined,
        description,
        items: items && items.length > 0 ? items : undefined,
      });

      if (result.success && result.claimId) {
        addToast("Reclamation creee", "success");
        router.push(`/espace-pro/reclamations/${result.claimId}`);
      } else {
        addToast(result.error || "Erreur", "error");
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Type */}
      <div className="bg-bg-primary border border-border rounded-2xl p-6 space-y-4">
        <h3 className="font-heading font-bold text-text-primary">Type de reclamation</h3>
        <div className="flex gap-3">
          {(["ORDER_CLAIM", "GENERAL"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => { setType(t); if (t === "GENERAL") { setOrderId(""); setSelectedItems({}); } }}
              className={`px-4 py-2 text-sm font-body rounded-lg transition-colors ${
                type === t
                  ? "bg-[#1A1A1A] text-white"
                  : "bg-bg-secondary text-text-muted hover:text-text-primary"
              }`}
            >
              {t === "ORDER_CLAIM" ? "Liee a une commande" : "Generale"}
            </button>
          ))}
        </div>
      </div>

      {/* Order selection */}
      {type === "ORDER_CLAIM" && (
        <div className="bg-bg-primary border border-border rounded-2xl p-6 space-y-4">
          <h3 className="font-heading font-bold text-text-primary">Commande concernee</h3>
          <select
            value={orderId}
            onChange={(e) => { setOrderId(e.target.value); setSelectedItems({}); }}
            className="w-full border border-border bg-bg-primary px-3 py-2 text-sm rounded-lg text-text-primary font-body"
          >
            <option value="">Selectionnez une commande</option>
            {orders.map((o) => (
              <option key={o.id} value={o.id}>{o.orderNumber}</option>
            ))}
          </select>

          {selectedOrder && (
            <div className="space-y-2">
              <p className="text-xs uppercase tracking-wider text-text-muted font-semibold font-body">Articles concernes</p>
              {selectedOrder.items.map((item) => (
                <label key={item.id} className="flex items-start gap-3 p-3 border border-border rounded-lg cursor-pointer hover:bg-bg-secondary/50">
                  <input
                    type="checkbox"
                    checked={!!selectedItems[item.id]}
                    onChange={() => toggleItem(item.id)}
                    className="mt-1"
                  />
                  <div className="flex-1">
                    <p className="text-sm font-body text-text-primary">{item.productName}</p>
                    <p className="text-xs text-text-muted font-body">Qte: {item.quantity}</p>
                    {selectedItems[item.id] && (
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <select
                          value={selectedItems[item.id].reason}
                          onChange={(e) => setSelectedItems((prev) => ({
                            ...prev,
                            [item.id]: { ...prev[item.id], reason: e.target.value },
                          }))}
                          className="border border-border bg-bg-primary px-2 py-1 text-xs rounded font-body text-text-primary"
                        >
                          {REASONS.map((r) => (
                            <option key={r.value} value={r.value}>{r.label}</option>
                          ))}
                        </select>
                        <input
                          type="number"
                          min={1}
                          max={item.quantity}
                          value={selectedItems[item.id].quantity}
                          onChange={(e) => setSelectedItems((prev) => ({
                            ...prev,
                            [item.id]: { ...prev[item.id], quantity: parseInt(e.target.value) || 1 },
                          }))}
                          className="border border-border bg-bg-primary px-2 py-1 text-xs rounded font-body text-text-primary"
                          placeholder="Qte"
                        />
                      </div>
                    )}
                  </div>
                </label>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Description */}
      <div className="bg-bg-primary border border-border rounded-2xl p-6 space-y-4">
        <h3 className="font-heading font-bold text-text-primary">Description</h3>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Decrivez votre probleme en detail..."
          rows={5}
          className="w-full border border-border bg-bg-primary px-3 py-2 text-sm rounded-lg text-text-primary font-body resize-none focus:outline-none focus:border-[#1A1A1A]"
        />
      </div>

      <button
        type="submit"
        disabled={!description.trim() || (type === "ORDER_CLAIM" && !orderId) || isPending}
        className="w-full px-4 py-3 text-sm font-body bg-[#1A1A1A] text-white rounded-xl hover:bg-[#333] disabled:opacity-40 transition-colors"
      >
        {isPending ? "Envoi en cours..." : "Envoyer la reclamation"}
      </button>
    </form>
  );
}
