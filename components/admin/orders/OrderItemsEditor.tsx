"use client";

import { useState, useTransition } from "react";
import { modifyOrderItems, revertOrderItemModification, revertAllOrderItemModifications } from "@/app/actions/admin/orders";
import CustomSelect from "@/components/ui/CustomSelect";
import OrderItemImage from "@/components/ui/OrderItemImage";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface OrderItemForEdit {
  id: string;
  productName: string;
  productRef: string;
  colorName: string;
  imagePath: string | null;
  saleType: string;
  packQty: number | null;
  size: string | null;
  sizesJson: string | null;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
}

interface Modification {
  orderItemId: string;
  originalQuantity: number;
  newQuantity: number;
  reason: "OUT_OF_STOCK" | "CLIENT_REQUEST";
  priceDifference: number;
  productName: string;
  productRef: string;
  colorName: string;
  imagePath: string | null;
  unitPrice: number;
}

interface Props {
  orderId: string;
  items: OrderItemForEdit[];
  existingModifications: Modification[];
}

const fmt = (n: number) => n.toFixed(2).replace(".", ",") + " €";

const REASON_OPTIONS = [
  { value: "OUT_OF_STOCK", label: "Rupture de stock" },
  { value: "CLIENT_REQUEST", label: "À la demande du client" },
];

const REASON_LABELS: Record<string, string> = {
  OUT_OF_STOCK: "Rupture de stock",
  CLIENT_REQUEST: "À la demande du client",
};

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function OrderItemsEditor({ orderId, items, existingModifications }: Props) {
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const toast = useToast();
  const { confirm } = useConfirm();

  // Edit state: map of itemId -> { newQuantity, reason }
  const [edits, setEdits] = useState<
    Record<string, { newQuantity: number; reason: "OUT_OF_STOCK" | "CLIENT_REQUEST" }>
  >({});

  const modMap = new Map(existingModifications.map((m) => [m.orderItemId, m]));
  const totalCredit = existingModifications.reduce((sum, m) => sum + m.priceDifference, 0);

  function startEditing() {
    setEditing(true);
    setEdits({});
  }

  function cancelEditing() {
    setEditing(false);
    setEdits({});
  }

  function updateEdit(itemId: string, field: "newQuantity" | "reason", value: number | string) {
    setEdits((prev) => {
      const item = items.find((i) => i.id === itemId)!;
      const mod = modMap.get(itemId);
      const existing = prev[itemId] ?? {
        newQuantity: item.quantity,
        reason: mod?.reason ?? "OUT_OF_STOCK",
      };
      return {
        ...prev,
        [itemId]: {
          ...existing,
          [field]: value,
        },
      };
    });
  }

  function handleSave() {
    const modifications = Object.entries(edits)
      .filter(([itemId, edit]) => {
        const item = items.find((i) => i.id === itemId)!;
        return edit.newQuantity !== item.quantity;
      })
      .map(([itemId, edit]) => ({
        orderItemId: itemId,
        newQuantity: edit.newQuantity,
        reason: edit.reason,
      }));

    if (modifications.length === 0) {
      setEditing(false);
      return;
    }

    startTransition(async () => {
      const result = await modifyOrderItems(orderId, modifications);
      if (result.success) {
        toast.success("Articles modifiés avec succès.");
        setEditing(false);
        setEdits({});
      } else {
        toast.error(result.error ?? "Erreur");
      }
    });
  }

  async function handleRevertOne(orderItemId: string, productName: string) {
    const ok = await confirm({
      title: "Annuler la modification",
      message: `Rétablir la quantité originale pour "${productName}" ?`,
      confirmLabel: "Rétablir",
      cancelLabel: "Annuler",
    });
    if (!ok) return;

    startTransition(async () => {
      const result = await revertOrderItemModification(orderId, orderItemId);
      if (result.success) {
        toast.success(`"${productName}" rétabli.`);
      } else {
        toast.error(result.error ?? "Erreur");
      }
    });
  }

  async function handleRevertAll() {
    const ok = await confirm({
      title: "Annuler toutes les modifications",
      message: "Rétablir les quantités originales pour tous les articles modifiés ?",
      confirmLabel: "Tout rétablir",
      cancelLabel: "Annuler",
    });
    if (!ok) return;

    startTransition(async () => {
      const result = await revertAllOrderItemModifications(orderId);
      if (result.success) {
        toast.success("Toutes les modifications ont été annulées.");
      } else {
        toast.error(result.error ?? "Erreur");
      }
    });
  }

  return (
    <div className="space-y-6">
      {/* Credit note banner */}
      {totalCredit > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-5 py-4 flex items-center gap-3">
          <svg className="w-5 h-5 text-red-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
          <div>
            <p className="text-sm font-semibold text-red-700">
              Avoir obligatoire : {fmt(totalCredit)}
            </p>
            <p className="text-xs text-red-600 mt-0.5">
              Des articles ont été modifiés. Un avoir doit être émis pour ce montant.
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* ── Articles Commandés ── */}
        <section className="card overflow-hidden">
          <div className="px-5 py-3.5 border-b border-border table-header flex items-center justify-between">
            <h2 className="font-heading text-sm font-semibold text-text-primary uppercase tracking-wide">
              Articles commandés ({items.length})
            </h2>
            {!editing ? (
              <button
                onClick={startEditing}
                className="btn-secondary text-xs px-3 py-1.5"
              >
                Modifier les articles
              </button>
            ) : (
              <div className="flex gap-2">
                <button
                  onClick={cancelEditing}
                  disabled={pending}
                  className="btn-secondary text-xs px-3 py-1.5"
                >
                  Annuler
                </button>
                <button
                  onClick={handleSave}
                  disabled={pending}
                  className="btn-primary text-xs px-3 py-1.5"
                >
                  {pending ? "Enregistrement…" : "Valider"}
                </button>
              </div>
            )}
          </div>

          <div className="divide-y divide-border-light">
            {items.map((item) => {
              const mod = modMap.get(item.id);
              const edit = edits[item.id];

              return (
                <div key={item.id} className="flex gap-4 px-5 py-4">
                  <OrderItemImage src={item.imagePath} alt={item.productName} sizeClass="w-12 h-12 sm:w-16 sm:h-16" />

                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-text-primary font-body">
                      {item.productName}
                    </p>
                    <p className="text-xs font-mono text-text-muted mt-0.5">{item.productRef}</p>

                    <div className="flex flex-wrap gap-1.5 mt-1">
                      <span className="badge badge-neutral">{item.colorName}</span>
                      {item.saleType === "PACK" && (
                        <span className="badge badge-neutral">Paquet ×{item.packQty}</span>
                      )}
                      {renderSizes(item)}

                      {/* Modification badge (non-edit mode) */}
                      {!editing && mod && (
                        mod.newQuantity === 0 ? (
                          <span className="badge badge-error">Rupture de stock</span>
                        ) : (
                          <span className="badge badge-warning">Stock modifié</span>
                        )
                      )}
                    </div>

                    {/* Modification reason (non-edit mode) */}
                    {!editing && mod && (
                      <p className="text-xs text-text-muted mt-1 italic">
                        Raison : {REASON_LABELS[mod.reason]}
                      </p>
                    )}

                    {/* Edit controls */}
                    {editing && (
                      <div className="flex items-center gap-3 mt-2">
                        <div className="flex items-center gap-1.5">
                          <label className="text-xs text-text-muted">Qté :</label>
                          <input
                            type="number"
                            min={0}
                            max={mod ? mod.originalQuantity - 1 : item.quantity - 1}
                            value={edit?.newQuantity ?? item.quantity}
                            onChange={(e) =>
                              updateEdit(item.id, "newQuantity", Math.max(0, parseInt(e.target.value) || 0))
                            }
                            className="w-16 px-2 py-1 text-xs border border-border rounded-lg text-center"
                          />
                        </div>
                        {edit && edit.newQuantity !== item.quantity && (
                          <CustomSelect
                            value={edit.reason}
                            onChange={(v) => updateEdit(item.id, "reason", v)}
                            options={REASON_OPTIONS}
                            size="sm"
                            className="w-48"
                          />
                        )}
                      </div>
                    )}
                  </div>

                  <div className="text-right shrink-0">
                    <p className="text-sm font-semibold text-text-primary font-heading">
                      {fmt(editing && edit ? edit.newQuantity * item.unitPrice : item.lineTotal)}
                    </p>
                    <p className="text-xs text-text-muted font-body mt-0.5">
                      {editing && edit ? edit.newQuantity : item.quantity} × {fmt(item.unitPrice)}
                    </p>
                    {!editing && mod && (
                      <p className="text-xs text-red-500 font-body mt-0.5 line-through">
                        {mod.originalQuantity} × {fmt(item.unitPrice)}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* ── Articles Modifiés (filtre) ── */}
        {existingModifications.length > 0 && (
          <section className="card overflow-hidden h-fit">
            <div className="px-5 py-3.5 border-b border-border table-header flex items-center justify-between">
              <h2 className="font-heading text-sm font-semibold text-text-primary uppercase tracking-wide">
                Articles modifiés ({existingModifications.length})
              </h2>
              <button
                onClick={handleRevertAll}
                disabled={pending}
                className="btn-secondary text-xs px-3 py-1.5 text-red-600 border-red-200 hover:bg-red-50"
              >
                {pending ? "…" : "Tout rétablir"}
              </button>
            </div>

            <div className="divide-y divide-border-light">
              {existingModifications.map((mod) => (
                <div key={mod.orderItemId} className="px-5 py-4 space-y-2">
                  <div className="flex gap-3 items-start">
                    <OrderItemImage src={mod.imagePath} alt={mod.productName} sizeClass="w-10 h-10" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-text-primary font-body">{mod.productName}</p>
                      <p className="text-xs font-mono text-text-muted">{mod.productRef}</p>
                    </div>
                    {mod.newQuantity === 0 ? (
                      <span className="badge badge-error text-xs">Rupture</span>
                    ) : (
                      <span className="badge badge-warning text-xs">Modifié</span>
                    )}
                  </div>

                  <div className="flex items-center gap-3 text-xs">
                    <div className="flex items-center gap-1.5">
                      <span className="text-text-muted">Avant :</span>
                      <span className="font-semibold text-text-primary">{mod.originalQuantity} unité(s)</span>
                    </div>
                    <svg className="w-4 h-4 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                    </svg>
                    <div className="flex items-center gap-1.5">
                      <span className="text-text-muted">Après :</span>
                      <span className={`font-semibold ${mod.newQuantity === 0 ? "text-red-600" : "text-amber-600"}`}>
                        {mod.newQuantity} unité(s)
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-xs">
                    <span className="text-text-muted italic">
                      {REASON_LABELS[mod.reason]}
                    </span>
                    <div className="flex items-center gap-3">
                      <span className="text-red-600 font-semibold">
                        -{fmt(mod.priceDifference)}
                      </span>
                      <button
                        onClick={() => handleRevertOne(mod.orderItemId, mod.productName)}
                        disabled={pending}
                        className="text-blue-600 hover:text-blue-800 font-medium underline underline-offset-2"
                      >
                        Rétablir
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Total credit */}
            <div className="px-5 py-3 border-t border-border bg-red-50">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-red-700">Avoir total</span>
                <span className="text-sm font-heading font-semibold text-red-700">{fmt(totalCredit)}</span>
              </div>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function renderSizes(item: { sizesJson: string | null; size: string | null }) {
  if (item.sizesJson) {
    try {
      const sizes: { name: string; quantity: number }[] = JSON.parse(item.sizesJson);
      if (sizes.length > 0)
        return (
          <span className="badge badge-neutral">
            {sizes.map((s) => `${s.name}×${s.quantity}`).join(", ")}
          </span>
        );
    } catch { /* ignore */ }
  }
  if (item.size)
    return <span className="badge badge-neutral">Taille {item.size}</span>;
  return null;
}
