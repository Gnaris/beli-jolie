"use client";

import { useState, useTransition, useMemo, useEffect, useCallback } from "react";
import Image from "next/image";
import {
  modifyOrderItems,
  revertOrderItemModification,
  revertAllOrderItemModifications,
  addCompensationItem,
  removeCompensationItem,
  confirmOrderModifications,
} from "@/app/actions/admin/orders";
import CustomSelect from "@/components/ui/CustomSelect";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { getTotalUnits, filterOrderItemsByQuery } from "@/lib/order-item-display";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface OrderItemForEdit {
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
  isCompensation: boolean;
  variantSnapshot?: string | null;
}

export interface Modification {
  orderItemId: string;
  originalQuantity: number;
  newQuantity: number;
  originalUnitPrice: number | null;
  newUnitPrice: number | null;
  reason: "OUT_OF_STOCK" | "CLIENT_REQUEST" | "COMMERCIAL_GESTURE";
  priceDifference: number;
  createdAt: string;
  productName: string;
  productRef: string;
  colorName: string;
  imagePath: string | null;
  unitPrice: number;
}

interface Props {
  orderId: string;
  paidAmount: number;
  paidSubtotalHT: number;
  currentSubtotalHT: number;
  items: OrderItemForEdit[];
  existingModifications: Modification[];
  readOnly?: boolean;
  clientNotifiedAt: string | null;
  hasUnconfirmedChanges: boolean;
}

interface ProductSearchVariant {
  id: string;
  colorName: string;
  colorHex: string | null;
  colorPattern: string | null;
  saleType: string;
  packQuantity: number | null;
  isPrimary: boolean;
  unitPrice: number;
  stock: number;
  image: string | null;
  sizes: Array<{
    id: string;
    name: string;
    maxQuantity: number;
    pricePerUnit: number | null;
  }>;
}

interface ProductSearchResult {
  id: string;
  reference: string;
  name: string;
  category: string | null;
  variants: ProductSearchVariant[];
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const REASON_OPTIONS = [
  { value: "OUT_OF_STOCK", label: "Rupture de stock" },
  { value: "CLIENT_REQUEST", label: "À la demande du client" },
  { value: "COMMERCIAL_GESTURE", label: "Geste commercial" },
];

const REASON_LABELS: Record<string, string> = {
  OUT_OF_STOCK: "Rupture de stock",
  CLIENT_REQUEST: "À la demande du client",
  COMMERCIAL_GESTURE: "Geste commercial",
};

const fmt = (n: number) => n.toFixed(2).replace(".", ",") + " €";

/* ------------------------------------------------------------------ */
/*  Composant principal                                                */
/* ------------------------------------------------------------------ */

export default function OrderItemsEditor({
  orderId,
  paidAmount,
  paidSubtotalHT,
  currentSubtotalHT,
  items,
  existingModifications,
  readOnly = false,
  clientNotifiedAt,
  hasUnconfirmedChanges,
}: Props) {
  const orderedItems = items.filter((i) => !i.isCompensation);
  const compensationItems = items.filter((i) => i.isCompensation);

  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [zoomedImage, setZoomedImage] = useState<string | null>(null);
  const toast = useToast();
  const { confirm } = useConfirm();

  const [edits, setEdits] = useState<
    Record<
      string,
      {
        newQuantity: number;
        newUnitPrice: number;
        reason: "OUT_OF_STOCK" | "CLIENT_REQUEST" | "COMMERCIAL_GESTURE";
      }
    >
  >({});

  const modMap = useMemo(
    () => new Map(existingModifications.map((m) => [m.orderItemId, m])),
    [existingModifications],
  );

  function startEditing() {
    // Pré-remplir avec les valeurs actuelles
    const initial: typeof edits = {};
    orderedItems.forEach((item) => {
      const mod = modMap.get(item.id);
      initial[item.id] = {
        newQuantity: item.quantity,
        newUnitPrice: item.unitPrice,
        reason: mod?.reason ?? "OUT_OF_STOCK",
      };
    });
    setEdits(initial);
    setEditing(true);
  }

  function cancelEditing() {
    setEditing(false);
    setEdits({});
  }

  function updateEdit(itemId: string, field: "newQuantity" | "newUnitPrice" | "reason", value: number | string) {
    setEdits((prev) => ({
      ...prev,
      [itemId]: {
        ...prev[itemId],
        [field]: value,
      },
    }));
  }

  function handleSave() {
    const modifications = Object.entries(edits)
      .filter(([itemId, edit]) => {
        const item = orderedItems.find((i) => i.id === itemId);
        if (!item) return false;
        const qtyChanged = edit.newQuantity !== item.quantity;
        const priceChanged = edit.newUnitPrice !== item.unitPrice;
        return qtyChanged || priceChanged;
      })
      .map(([itemId, edit]) => ({
        orderItemId: itemId,
        newQuantity: edit.newQuantity,
        newUnitPrice: edit.newUnitPrice,
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
      message: `Rétablir les valeurs originales pour "${productName}" ?`,
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
      message: "Rétablir les valeurs originales pour tous les articles modifiés ?",
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

  async function handleConfirmAll() {
    const ok = await confirm({
      title: "Confirmer les modifications",
      message: "Un email récapitulatif va être envoyé au client avec toutes les modifications et ajouts de cette commande. Continuer ?",
      confirmLabel: "Confirmer et notifier le client",
      cancelLabel: "Annuler",
    });
    if (!ok) return;

    startTransition(async () => {
      const result = await confirmOrderModifications(orderId);
      if (result.success) {
        toast.success("Modifications confirmées, email envoyé au client.");
      } else {
        toast.error(result.error ?? "Erreur");
      }
    });
  }

  async function handleRemoveCompensation(orderItemId: string, productName: string) {
    const ok = await confirm({
      title: "Retirer l'article ajouté",
      message: `Retirer "${productName}" de la commande ?`,
      confirmLabel: "Retirer",
      cancelLabel: "Annuler",
    });
    if (!ok) return;

    startTransition(async () => {
      const result = await removeCompensationItem(orderId, orderItemId);
      if (result.success) {
        toast.success("Article retiré.");
      } else {
        toast.error(result.error ?? "Erreur");
      }
    });
  }

  // Calcul en direct du nouveau total pour affichage préliminaire
  const previewTotal = useMemo(() => {
    if (!editing) return null;
    let subtotalHT = 0;
    orderedItems.forEach((item) => {
      const edit = edits[item.id];
      const qty = edit?.newQuantity ?? item.quantity;
      const price = edit?.newUnitPrice ?? item.unitPrice;
      subtotalHT += qty * price;
    });
    compensationItems.forEach((item) => {
      subtotalHT += item.quantity * item.unitPrice;
    });
    return subtotalHT;
  }, [editing, edits, orderedItems, compensationItems]);

  // Total des ajustements
  const totalCredit = existingModifications.reduce((sum, m) => sum + m.priceDifference, 0);
  const totalCompensation = compensationItems.reduce((sum, i) => sum + i.lineTotal, 0);
  const orderedTotalHT = orderedItems.reduce((sum, i) => sum + i.lineTotal, 0);
  const finalOrderedItems = orderedItems.filter((i) => i.quantity > 0);
  const totalUnits = [...orderedItems, ...compensationItems].reduce((s, i) => s + getTotalUnits(i), 0);
  const totalModels = new Set(
    [...orderedItems, ...compensationItems].filter((i) => i.quantity > 0).map((i) => i.productRef),
  ).size;

  const overshoot = currentSubtotalHT - paidSubtotalHT;
  const hasOvershoot = overshoot > 0.01;
  const hasChanges = existingModifications.length > 0 || compensationItems.length > 0;

  return (
    <div className="space-y-6">
      {/* Bannière : dépassement HT */}
      {hasOvershoot && !readOnly && (
        <div className="rounded-xl border border-error/40 bg-error/5 p-4 flex items-start gap-3">
          <svg className="w-6 h-6 text-error shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
          <div className="flex-1">
            <p className="font-semibold text-error text-sm">
              Attention : le sous-total HT dépasse le montant payé
            </p>
            <p className="text-xs text-error mt-1">
              Sous-total HT actuel : <b>{fmt(currentSubtotalHT)}</b> · HT payé par le client : <b>{fmt(paidSubtotalHT)}</b> · Dépassement : <b>{fmt(overshoot)}</b>.
              Retirez ou ajustez des articles avant de confirmer.
            </p>
          </div>
        </div>
      )}

      {/* Bannière : email envoyé */}
      {clientNotifiedAt && !readOnly && !hasOvershoot && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 flex items-center gap-2 text-xs text-blue-800">
          <svg className="w-4 h-4 text-blue-700" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
          <span>
            Email récapitulatif envoyé au client le{" "}
            <b>
              {new Date(clientNotifiedAt).toLocaleDateString("fr-FR")} à {new Date(clientNotifiedAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
            </b>
          </span>
        </div>
      )}

      {/* ═══ 3 COLONNES ═══ */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-stretch">
        <OrderedItemsColumn
          items={orderedItems}
          modMap={modMap}
          editing={editing}
          edits={edits}
          onUpdateEdit={updateEdit}
          onStartEditing={startEditing}
          onCancelEditing={cancelEditing}
          onSave={handleSave}
          pending={pending}
          readOnly={readOnly}
          paidAmount={paidAmount}
          previewTotal={previewTotal}
        />

        <AddedItemsColumn
          orderId={orderId}
          items={compensationItems}
          paidAmount={paidAmount}
          currentTotal={orderedTotalHT + totalCompensation}
          creditDue={totalCredit}
          readOnly={readOnly}
          onRemove={handleRemoveCompensation}
          pending={pending}
        />

        <AdjustedItemsColumn
          modifications={existingModifications}
          onRevertOne={handleRevertOne}
          onRevertAll={handleRevertAll}
          pending={pending}
          readOnly={readOnly}
        />
      </div>

      {/* ═══ SECTION 4 : Résumé de la commande ═══ */}
      <SummarySection
        orderedItems={finalOrderedItems}
        compensationItems={compensationItems}
        totalUnits={totalUnits}
        totalModels={totalModels}
        orderId={orderId}
        onZoomImage={(src) => setZoomedImage(src)}
      />

      {/* Modal image plein écran */}
      {zoomedImage && <ImageModal src={zoomedImage} onClose={() => setZoomedImage(null)} />}

      {/* ═══ Bouton final : Confirmer les modifications ═══ */}
      {!readOnly && hasChanges && hasUnconfirmedChanges && (
        <div className="card p-6 flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="flex-1">
            <p className="text-sm font-semibold text-text-primary">
              {hasOvershoot
                ? "Le sous-total HT dépasse encore le montant payé."
                : "Prêt à confirmer les modifications ?"}
            </p>
            <p className="text-xs text-text-muted mt-1">
              {hasOvershoot
                ? `Retirez ou ajustez des articles pour ramener le HT à ${fmt(paidSubtotalHT)} ou moins avant de confirmer.`
                : "Un email récapitulatif sera envoyé au client avec toutes les modifications et les articles ajoutés."}
            </p>
          </div>
          <button
            onClick={handleConfirmAll}
            disabled={pending || hasOvershoot}
            className="btn-primary text-sm px-5 py-2.5 disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
          >
            {pending ? "Confirmation…" : "Confirmer les modifications"}
          </button>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Colonne 1 : Articles commandés                                     */
/* ------------------------------------------------------------------ */

function OrderedItemsColumn({
  items,
  modMap,
  editing,
  edits,
  onUpdateEdit,
  onStartEditing,
  onCancelEditing,
  onSave,
  pending,
  readOnly,
  paidAmount,
  previewTotal,
}: {
  items: OrderItemForEdit[];
  modMap: Map<string, Modification>;
  editing: boolean;
  edits: Record<string, { newQuantity: number; newUnitPrice: number; reason: string }>;
  onUpdateEdit: (itemId: string, field: "newQuantity" | "newUnitPrice" | "reason", value: number | string) => void;
  onStartEditing: () => void;
  onCancelEditing: () => void;
  onSave: () => void;
  pending: boolean;
  readOnly: boolean;
  paidAmount: number;
  previewTotal: number | null;
}) {
  const totalUnits = items.reduce((s, i) => s + getTotalUnits(i), 0);
  const totalModels = items.filter((i) => i.quantity > 0).length;
  const [search, setSearch] = useState("");

  // Réinitialiser la recherche quand on sort du mode édition
  useEffect(() => {
    if (!editing) setSearch("");
  }, [editing]);

  const filteredItems = useMemo(() => filterOrderItemsByQuery(items, search), [items, search]);

  // paidAmount et previewTotal sont utilisés au niveau parent (bannière globale)
  void paidAmount;
  void previewTotal;

  return (
    <section className="card overflow-hidden flex flex-col lg:h-[680px]">
      <div className="px-4 py-3 border-b border-border flex items-center gap-3 bg-bg-secondary/30 shrink-0">
        <div className="w-[3px] h-6 bg-text-primary rounded-sm shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted">Section 1</p>
          <h2 className="text-base font-semibold text-text-primary">Articles commandés</h2>
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            <span className="badge badge-neutral">{totalModels} modèles</span>
            <span className="badge badge-neutral">{totalUnits} unités</span>
          </div>
        </div>
        {!readOnly && !editing && (
          <button onClick={onStartEditing} className="btn-secondary text-xs px-3 py-1.5 shrink-0">
            Modifier
          </button>
        )}
        {editing && (
          <div className="flex gap-1.5 shrink-0">
            <button onClick={onCancelEditing} disabled={pending} className="btn-secondary text-xs px-2 py-1.5">
              Annuler
            </button>
            <button onClick={onSave} disabled={pending} className="btn-primary text-xs px-2.5 py-1.5">
              {pending ? "…" : "Confirmer"}
            </button>
          </div>
        )}
      </div>

      {editing && (
        <div className="px-4 py-3 border-b border-border bg-blue-50/40 shrink-0">
          <label className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted">
            Rechercher par référence ou nom
          </label>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Ex : BR-JO-DOR-BL-1250…"
            className="w-full mt-1 px-3 py-2 border border-border rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-border-light">
        {filteredItems.length === 0 && search.trim() && (
          <div className="px-4 py-10 text-center text-xs text-text-muted italic">
            Aucun article ne correspond à « {search} ».
          </div>
        )}
        {filteredItems.map((item) => {
          const mod = modMap.get(item.id);
          const edit = edits[item.id];
          const currentQty = edit?.newQuantity ?? item.quantity;
          const currentPrice = edit?.newUnitPrice ?? item.unitPrice;
          const originalQty = mod?.originalQuantity ?? item.quantity;
          const originalPrice = mod?.originalUnitPrice ?? item.unitPrice;

          return (
            <div key={item.id} className={`px-4 py-3.5 flex gap-3 ${mod ? "bg-warning/5" : ""}`}>
              <ItemThumb src={item.imagePath} alt={item.productName} />
              <div className="flex-1 min-w-0">
                <p className={`text-[13px] font-semibold text-text-primary leading-snug ${currentQty === 0 ? "line-through text-text-muted" : ""}`}>
                  {item.productName}
                </p>
                <p className="text-[10px] font-mono text-text-muted mt-0.5 truncate">{item.productRef}</p>
                <div className="flex flex-wrap gap-1 mt-1.5">
                  <span className="badge badge-neutral">{item.colorName}</span>
                  {item.saleType === "PACK" && item.packQty && (
                    <span className="badge badge-neutral">Paquet ×{item.packQty}</span>
                  )}
                  {mod && !editing && (
                    <>
                      {mod.originalQuantity !== mod.newQuantity && (
                        <span className="badge badge-warning">Qté ajustée</span>
                      )}
                      {mod.newUnitPrice !== null && (
                        <span className="badge badge-info">Prix ajusté</span>
                      )}
                      {mod.newQuantity === 0 && (
                        <span className="badge badge-error">Rupture</span>
                      )}
                    </>
                  )}
                </div>

                {!editing && (
                  <p className="text-[13px] font-semibold text-text-primary mt-1.5 tabular-nums">
                    {fmt(currentQty * currentPrice)}
                    {" "}
                    <span className="text-[10px] text-text-muted font-normal">
                      · {currentQty} × {fmt(currentPrice)}
                    </span>
                  </p>
                )}

                {mod && !editing && (
                  <p className="text-[10px] text-text-muted mt-1 italic">
                    {REASON_LABELS[mod.reason]}
                  </p>
                )}

                {editing && (
                  <div className="mt-2 space-y-1.5">
                    <div className="grid grid-cols-2 gap-1.5">
                      <div>
                        <label className="text-[9px] font-semibold text-text-muted uppercase">Qté (max {originalQty})</label>
                        <input
                          type="number"
                          min={0}
                          max={originalQty}
                          value={currentQty}
                          onChange={(e) => onUpdateEdit(item.id, "newQuantity", Math.max(0, parseInt(e.target.value) || 0))}
                          className="w-full text-center border border-border rounded px-2 py-1 text-xs mt-0.5"
                        />
                      </div>
                      <div>
                        <label className="text-[9px] font-semibold text-text-muted uppercase">Prix unit. €</label>
                        <input
                          type="number"
                          step="0.01"
                          min={0}
                          max={originalPrice}
                          value={currentPrice}
                          onChange={(e) => onUpdateEdit(item.id, "newUnitPrice", parseFloat(e.target.value) || 0)}
                          className="w-full text-right border border-border rounded px-2 py-1 text-xs mt-0.5"
                        />
                      </div>
                    </div>
                    {(currentQty !== item.quantity || currentPrice !== item.unitPrice) && (
                      <CustomSelect
                        value={edit?.reason ?? "OUT_OF_STOCK"}
                        onChange={(v) => onUpdateEdit(item.id, "reason", v)}
                        options={REASON_OPTIONS}
                        size="sm"
                      />
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Colonne 2 : Articles ajoutés                                       */
/* ------------------------------------------------------------------ */

function AddedItemsColumn({
  orderId,
  items,
  paidAmount,
  currentTotal,
  creditDue,
  readOnly,
  onRemove,
  pending,
}: {
  orderId: string;
  items: OrderItemForEdit[];
  paidAmount: number;
  currentTotal: number;
  creditDue: number;
  readOnly: boolean;
  onRemove: (id: string, name: string) => void;
  pending: boolean;
}) {
  const [showAddPanel, setShowAddPanel] = useState(false);
  const totalAdded = items.reduce((s, i) => s + i.lineTotal, 0);

  return (
    <section className="card overflow-hidden flex flex-col lg:h-[680px]">
      <div className="px-4 py-3 border-b border-border flex items-center gap-3 bg-bg-secondary/30 shrink-0">
        <div className="w-[3px] h-6 bg-success rounded-sm shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-success">Section 2</p>
          <h2 className="text-base font-semibold text-text-primary">Articles ajoutés</h2>
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            <span className="badge badge-neutral">{items.length} ligne{items.length > 1 ? "s" : ""}</span>
            <span className="badge badge-neutral">{items.reduce((s, i) => s + getTotalUnits(i), 0)} unités</span>
          </div>
        </div>
        {!readOnly && (
          <button onClick={() => setShowAddPanel(!showAddPanel)} className="btn-primary text-xs px-3 py-1.5 shrink-0">
            {showAddPanel ? "Fermer" : "Ajouter"}
          </button>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {showAddPanel && !readOnly && (
          <AddCompensationPanel
            orderId={orderId}
            paidAmount={paidAmount}
            currentTotal={currentTotal}
            creditDue={creditDue}
            onDone={() => setShowAddPanel(false)}
          />
        )}

        {items.length === 0 ? (
          <div className="px-4 py-10 text-center text-xs text-text-muted italic h-full flex items-center justify-center">
            Aucun article ajouté pour l&apos;instant.
          </div>
        ) : (
          <div className="divide-y divide-border-light">
            {items.map((item) => (
              <div key={item.id} className="px-4 py-3.5 flex gap-3 bg-success/5">
                <ItemThumb src={item.imagePath} alt={item.productName} />
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold text-text-primary leading-snug">{item.productName}</p>
                  <p className="text-[10px] font-mono text-text-muted mt-0.5 truncate">{item.productRef}</p>
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    <span className="badge badge-neutral">{item.colorName}</span>
                    <span className="badge badge-success">Compensation</span>
                  </div>
                  <p className="text-[13px] font-semibold text-success mt-1.5 tabular-nums">
                    + {fmt(item.lineTotal)}{" "}
                    <span className="text-[10px] text-text-muted font-normal">
                      {item.saleType === "PACK" && item.packQty
                        ? `· ${item.quantity} paquet${item.quantity > 1 ? "s" : ""} × ${fmt(item.unitPrice)} = ${getTotalUnits(item)} unités`
                        : `· ${item.quantity} × ${fmt(item.unitPrice)}`}
                    </span>
                  </p>
                  {!readOnly && (
                    <div className="flex gap-2 mt-1">
                      <button
                        onClick={() => onRemove(item.id, item.productName)}
                        disabled={pending}
                        className="text-[11px] font-semibold text-error underline underline-offset-2"
                      >
                        Retirer
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="px-4 py-3 border-t-2 border-success/30 flex items-center justify-between bg-success/5 shrink-0">
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-success">
          Total ajouts
        </span>
        <span className="text-base font-semibold text-success tabular-nums">
          + {fmt(totalAdded)}
        </span>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Panneau d'ajout d'article                                          */
/* ------------------------------------------------------------------ */

function AddCompensationPanel({
  orderId,
  paidAmount,
  currentTotal,
  creditDue,
  onDone,
}: {
  orderId: string;
  paidAmount: number;
  currentTotal: number;
  creditDue: number;
  onDone: () => void;
}) {
  const [query, setQuery] = useState("");
  const [products, setProducts] = useState<ProductSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<ProductSearchResult | null>(null);
  const [selectedVariant, setSelectedVariant] = useState<ProductSearchVariant | null>(null);
  const [reason, setReason] = useState<"OUT_OF_STOCK" | "CLIENT_REQUEST" | "COMMERCIAL_GESTURE">("COMMERCIAL_GESTURE");
  const [pending, startTransition] = useTransition();
  const toast = useToast();

  // Configuration de la variante sélectionnée
  const [qty, setQty] = useState(1);
  const [price, setPrice] = useState(0);
  // Tailles sélectionnées : { sizeName: quantity }
  const [sizesChosen, setSizesChosen] = useState<Record<string, number>>({});

  // ─── Recherche produit ───
  useEffect(() => {
    if (query.length < 1 || selectedProduct) {
      setProducts([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/admin/orders/product-search?q=${encodeURIComponent(query)}`);
        const data = await res.json();
        if (!cancelled) setProducts(data.products || []);
      } catch {
        if (!cancelled) setProducts([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, selectedProduct]);

  function pickProduct(p: ProductSearchResult) {
    setSelectedProduct(p);
    setSelectedVariant(null);
    setSizesChosen({});
    setProducts([]);
  }

  function pickVariant(v: ProductSearchVariant) {
    setSelectedVariant(v);
    setPrice(v.unitPrice);
    // Pour UNIT sans taille : qté = 1 par défaut
    // Pour UNIT avec tailles : sélection à faire
    // Pour PACK : qté = 1 pack (qté totale calculée via sizesChosen)
    if (v.saleType === "PACK") {
      setQty(1);
      // Pré-remplir les tailles du pack
      const initial: Record<string, number> = {};
      v.sizes.forEach((s) => {
        initial[s.name] = s.maxQuantity;
      });
      setSizesChosen(initial);
    } else {
      setQty(1);
      setSizesChosen({});
    }
  }

  function resetSelection() {
    setSelectedProduct(null);
    setSelectedVariant(null);
    setSizesChosen({});
    setQuery("");
    setQty(1);
    setPrice(0);
  }

  function backToVariants() {
    setSelectedVariant(null);
    setSizesChosen({});
    setQty(1);
    setPrice(0);
  }

  // Calcul du total selon le mode
  const totalUnits = useMemo(() => {
    if (!selectedVariant) return 0;
    if (selectedVariant.saleType === "PACK") {
      // qty = nombre de packs
      return qty;
    }
    // UNIT : seul cas où on utilise sizesChosen = plusieurs tailles distinctes
    if (selectedVariant.sizes.length > 1) {
      return Object.values(sizesChosen).reduce((s, n) => s + n, 0);
    }
    return qty;
  }, [selectedVariant, qty, sizesChosen]);

  const addPreview = totalUnits * price;
  const remaining = creditDue - addPreview;

  function handleAdd() {
    if (!selectedVariant) {
      toast.error("Sélectionnez une variante.");
      return;
    }
    if (totalUnits <= 0) {
      toast.error("Quantité invalide.");
      return;
    }
    if (price < 0) {
      toast.error("Prix invalide.");
      return;
    }

    // Construction du sizesJson si des tailles sont choisies
    const sizes = Object.entries(sizesChosen)
      .filter(([, n]) => n > 0)
      .map(([name, quantity]) => ({ name, quantity }));
    const sizesJson = sizes.length > 0 ? JSON.stringify(sizes) : undefined;

    startTransition(async () => {
      const result = await addCompensationItem(orderId, {
        productColorId: selectedVariant.id,
        quantity: selectedVariant.saleType === "PACK" ? qty : totalUnits,
        unitPrice: price,
        reason,
        sizesJson,
      });
      if (result.success) {
        toast.success("Article ajouté à la commande.");
        onDone();
      } else {
        toast.error(result.error ?? "Erreur");
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // ÉCRAN 3 : Variante sélectionnée — configuration (qté / prix / taille)
  // ═══════════════════════════════════════════════════════════════
  if (selectedProduct && selectedVariant) {
    return (
      <div className="p-4 bg-success/5 border-b border-border space-y-3">
        {/* Header résumé */}
        <BudgetSummary creditDue={creditDue} remaining={remaining} />

        {/* Fil d'ariane */}
        <div className="flex items-center gap-1.5 text-[11px] text-text-muted">
          <button onClick={resetSelection} className="hover:text-text-primary underline underline-offset-2">
            Recherche
          </button>
          <span>›</span>
          <button onClick={backToVariants} className="hover:text-text-primary underline underline-offset-2">
            {selectedProduct.reference}
          </button>
          <span>›</span>
          <span className="text-text-primary font-semibold">{selectedVariant.colorName}</span>
        </div>

        {/* Récap variante */}
        <div className="flex gap-3 items-start p-3 bg-white border border-border rounded-lg">
          <div className="w-16 h-16 rounded bg-bg-secondary shrink-0 overflow-hidden border border-border">
            {selectedVariant.image && (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={selectedVariant.image} alt={selectedProduct.name} className="w-full h-full object-cover" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-text-primary truncate">{selectedProduct.name}</p>
            <p className="text-[10px] font-mono text-text-muted mt-0.5">{selectedProduct.reference}</p>
            <div className="flex flex-wrap gap-1 mt-1.5">
              <VariantColorChip variant={selectedVariant} />
              {selectedVariant.saleType === "PACK" ? (
                <span className="badge badge-info">Paquet ×{selectedVariant.packQuantity}</span>
              ) : (
                <span className="badge badge-neutral">Unité</span>
              )}
              <span className={`badge ${selectedVariant.stock > 20 ? "badge-success" : selectedVariant.stock > 0 ? "badge-warning" : "badge-error"}`}>
                Stock {selectedVariant.stock}
              </span>
            </div>
          </div>
          <button onClick={backToVariants} className="text-[10px] text-blue-600 hover:underline shrink-0">
            Changer
          </button>
        </div>

        {/* Tailles : uniquement si PACK (composition) ou UNIT avec plusieurs tailles */}
        {(selectedVariant.saleType === "PACK" || selectedVariant.sizes.length > 1) && (
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted mb-1.5">
              {selectedVariant.saleType === "PACK" ? "Composition du paquet" : "Choisir la taille"}
            </p>
            <div className="grid grid-cols-2 gap-1.5">
              {selectedVariant.sizes.map((size) => (
                <div key={size.id} className="flex items-center gap-2 p-2 bg-white border border-border rounded">
                  <span className="text-xs font-semibold text-text-primary flex-1">Taille {size.name}</span>
                  <input
                    type="number"
                    min={0}
                    max={selectedVariant.saleType === "PACK" ? size.maxQuantity * 10 : size.maxQuantity * 100}
                    value={sizesChosen[size.name] ?? 0}
                    onChange={(e) => setSizesChosen((prev) => ({ ...prev, [size.name]: Math.max(0, parseInt(e.target.value) || 0) }))}
                    className="w-14 text-center px-1 py-1 border border-border rounded text-xs"
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Qté + Prix */}
        <div className="grid grid-cols-2 gap-2">
          {(selectedVariant.saleType === "PACK" || selectedVariant.sizes.length <= 1) && (
            <div>
              <label className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted">
                {selectedVariant.saleType === "PACK" ? "Nb paquets" : "Quantité"}
              </label>
              <input
                type="number"
                min={1}
                value={qty}
                onChange={(e) => setQty(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-full mt-1 px-2 py-1 text-center border border-border rounded text-xs"
              />
            </div>
          )}
          <div className={selectedVariant.saleType === "PACK" || selectedVariant.sizes.length <= 1 ? "" : "col-span-2"}>
            <label className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted">Prix unitaire €</label>
            <input
              type="number"
              step="0.01"
              min={0}
              value={price}
              onChange={(e) => setPrice(Math.max(0, parseFloat(e.target.value) || 0))}
              className="w-full mt-1 px-2 py-1 text-right border border-border rounded text-xs"
            />
          </div>
        </div>

        {/* Raison */}
        <div>
          <label className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted">Raison</label>
          <CustomSelect
            value={reason}
            onChange={(v) => setReason(v as never)}
            options={REASON_OPTIONS}
            size="sm"
            className="mt-1"
          />
        </div>

        {/* Récap ajout */}
        <div className="p-2.5 bg-white border border-border rounded-lg flex items-center justify-between text-xs">
          <span className="text-text-muted">
            Cet ajout · {totalUnits} unité{totalUnits > 1 ? "s" : ""}
          </span>
          <span className="font-semibold text-text-primary tabular-nums">{fmt(addPreview)}</span>
        </div>

        {/* Rappel plafond */}
        <div className="p-2.5 rounded-lg bg-white border border-border text-[10px] text-text-muted leading-relaxed">
          <span className="font-semibold text-text-primary">Rappel :</span> le total des ajouts ne peut jamais dépasser le montant payé par le client ({fmt(paidAmount)}).
        </div>

        {/* Actions */}
        <div className="flex gap-1.5 pt-1">
          <button
            onClick={handleAdd}
            disabled={pending || totalUnits <= 0}
            className="btn-primary flex-1 text-xs disabled:opacity-50"
          >
            {pending ? "Ajout…" : "Ajouter à la commande"}
          </button>
          <button onClick={onDone} className="btn-secondary text-xs px-3">
            ✕
          </button>
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════
  // ÉCRAN 2 : Produit sélectionné — liste des variantes détaillées
  // ═══════════════════════════════════════════════════════════════
  if (selectedProduct) {
    return (
      <div className="p-4 bg-success/5 border-b border-border space-y-3">
        <BudgetSummary creditDue={creditDue} remaining={0} />

        <div className="flex items-center justify-between">
          <div>
            <button onClick={resetSelection} className="text-[11px] text-blue-600 hover:underline">
              ← Retour à la recherche
            </button>
            <p className="text-sm font-semibold text-text-primary mt-1">{selectedProduct.name}</p>
            <p className="text-[10px] font-mono text-text-muted">
              {selectedProduct.reference}
              {selectedProduct.category && <> · {selectedProduct.category}</>}
            </p>
          </div>
          <span className="badge badge-neutral">{selectedProduct.variants.length} variante{selectedProduct.variants.length > 1 ? "s" : ""}</span>
        </div>

        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted">
          Choisir une variante
        </p>

        <div className="space-y-1.5 max-h-96 overflow-y-auto -mx-1 px-1">
          {selectedProduct.variants.map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => pickVariant(v)}
              className="w-full flex gap-3 p-2.5 bg-white border border-border rounded-lg hover:border-text-primary hover:shadow-sm transition text-left"
            >
              <div className="w-14 h-14 rounded bg-bg-secondary shrink-0 overflow-hidden border border-border">
                {v.image && (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={v.image} alt={v.colorName} className="w-full h-full object-cover" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <VariantColorChip variant={v} />
                  <p className="text-xs font-semibold text-text-primary">{v.colorName}</p>
                  {v.isPrimary && <span className="badge badge-info">Principale</span>}
                </div>
                <div className="flex flex-wrap gap-1 mt-1">
                  {v.saleType === "PACK" ? (
                    <span className="badge badge-info">Paquet ×{v.packQuantity}</span>
                  ) : (
                    <span className="badge badge-neutral">Unité</span>
                  )}
                  {v.sizes.length > 0 && (
                    <span className="badge badge-neutral">
                      {v.sizes.length} taille{v.sizes.length > 1 ? "s" : ""} : {v.sizes.map((s) => s.name).join(", ")}
                    </span>
                  )}
                </div>
              </div>
              <div className="text-right shrink-0">
                <p className="text-sm font-semibold text-text-primary tabular-nums">{fmt(v.unitPrice)}</p>
                <p className={`text-[10px] font-semibold ${v.stock > 20 ? "text-success" : v.stock > 0 ? "text-warning" : "text-error"}`}>
                  Stock {v.stock}
                </p>
              </div>
            </button>
          ))}
        </div>

        <button onClick={onDone} className="btn-secondary w-full text-xs">
          Fermer
        </button>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════
  // ÉCRAN 1 : Recherche produit par référence ou nom
  // ═══════════════════════════════════════════════════════════════
  return (
    <div className="p-4 bg-success/5 border-b border-border space-y-3">
      <BudgetSummary creditDue={creditDue} remaining={0} />

      <div>
        <label className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted">
          Tapez la référence ou le nom du produit
        </label>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Ex : BR-JO-DOR-BL-1250, bracelet doré…"
          autoFocus
          className="w-full mt-1 px-3 py-2 border border-border rounded-md text-sm"
        />
        {searching && <p className="text-[10px] text-text-muted mt-1">Recherche…</p>}
      </div>

      {products.length > 0 && (
        <div className="space-y-1.5 max-h-80 overflow-y-auto -mx-1 px-1">
          {products.map((p) => {
            const priceMin = Math.min(...p.variants.map((v) => v.unitPrice));
            const priceMax = Math.max(...p.variants.map((v) => v.unitPrice));
            const totalStock = p.variants.reduce((s, v) => s + v.stock, 0);
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => pickProduct(p)}
                className="w-full flex gap-3 p-2.5 bg-white border border-border rounded-lg hover:border-text-primary hover:shadow-sm transition text-left"
              >
                <div className="w-12 h-12 rounded bg-bg-secondary shrink-0 overflow-hidden border border-border">
                  {p.variants[0]?.image && (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={p.variants[0].image} alt={p.name} className="w-full h-full object-cover" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-text-primary truncate">{p.name}</p>
                  <p className="text-[10px] font-mono text-text-muted mt-0.5">
                    {p.reference}
                    {p.category && <> · {p.category}</>}
                  </p>
                  <div className="flex flex-wrap gap-1 mt-1">
                    <span className="badge badge-neutral">{p.variants.length} variante{p.variants.length > 1 ? "s" : ""}</span>
                    <span className="badge badge-neutral">Stock total {totalStock}</span>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xs font-semibold text-text-primary tabular-nums">
                    {priceMin === priceMax ? fmt(priceMin) : `${fmt(priceMin)} → ${fmt(priceMax)}`}
                  </p>
                  <p className="text-[10px] text-text-muted mt-0.5">Voir variantes ›</p>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {!searching && query.length >= 1 && products.length === 0 && (
        <div className="text-center py-6 text-xs text-text-muted italic">Aucun produit trouvé.</div>
      )}

      <button onClick={onDone} className="btn-secondary w-full text-xs">
        Fermer
      </button>
    </div>
  );
}

function BudgetSummary({ creditDue, remaining }: { creditDue: number; remaining: number }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <div className="p-2.5 rounded-lg bg-white border border-border">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted">À compenser</p>
        <p className="text-sm font-semibold text-text-primary mt-0.5 tabular-nums">{fmt(creditDue)}</p>
      </div>
      <div className="p-2.5 rounded-lg bg-success/10 border border-success/30">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-success">Restera à faire</p>
        <p className="text-sm font-semibold text-success mt-0.5 tabular-nums">{fmt(Math.max(0, remaining))}</p>
      </div>
    </div>
  );
}

function VariantColorChip({ variant }: { variant: ProductSearchVariant }) {
  if (variant.colorPattern) {
    return (
      <div
        className="w-4 h-4 rounded-full border border-border shrink-0"
        style={{ backgroundImage: `url(${variant.colorPattern})`, backgroundSize: "cover" }}
      />
    );
  }
  if (variant.colorHex) {
    return (
      <div
        className="w-4 h-4 rounded-full border border-border shrink-0"
        style={{ backgroundColor: variant.colorHex }}
      />
    );
  }
  return null;
}

/* ------------------------------------------------------------------ */
/*  Colonne 3 : Articles ajustés                                       */
/* ------------------------------------------------------------------ */

function AdjustedItemsColumn({
  modifications,
  onRevertOne,
  onRevertAll,
  pending,
  readOnly,
}: {
  modifications: Modification[];
  onRevertOne: (id: string, name: string) => void;
  onRevertAll: () => void;
  pending: boolean;
  readOnly: boolean;
}) {
  const [showHistory, setShowHistory] = useState(false);
  const totalCredit = modifications.reduce((s, m) => s + m.priceDifference, 0);
  const totalUnitsRemoved = modifications.reduce(
    (s, m) => s + Math.max(0, m.originalQuantity - m.newQuantity),
    0,
  );

  return (
    <section className="card overflow-hidden flex flex-col lg:h-[680px]">
      <div className="px-4 py-3 border-b border-border flex items-center gap-3 bg-bg-secondary/30 shrink-0">
        <div className="w-[3px] h-6 bg-error rounded-sm shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-error">Section 3</p>
          <h2 className="text-base font-semibold text-text-primary">Articles ajustés</h2>
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            <span className="badge badge-neutral">{modifications.length} ligne{modifications.length > 1 ? "s" : ""}</span>
            <span className="badge badge-neutral">{totalUnitsRemoved} unités retirées</span>
          </div>
        </div>
        {modifications.length > 0 && !readOnly && (
          <button onClick={onRevertAll} disabled={pending} className="btn-secondary text-xs px-2.5 py-1.5 text-error shrink-0">
            Rétablir tout
          </button>
        )}
      </div>

      {modifications.length === 0 ? (
        <div className="flex-1 min-h-0 flex items-center justify-center px-4 py-10 text-center text-xs text-text-muted italic">
          Aucun article ajusté pour l&apos;instant.
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-border-light">
          {modifications.map((mod) => {
            const qtyChanged = mod.originalQuantity !== mod.newQuantity;
            const priceChanged = mod.newUnitPrice !== null && mod.originalUnitPrice !== null;
            return (
              <div key={mod.orderItemId} className="px-4 py-3.5">
                <div className="flex items-start gap-2.5">
                  <ItemThumb src={mod.imagePath} alt={mod.productName} size="sm" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold text-text-primary leading-snug">{mod.productName}</p>
                    <p className="text-[10px] font-mono text-text-muted truncate">{mod.productRef}</p>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {qtyChanged && mod.newQuantity === 0 && (
                        <span className="badge badge-error">Retirée</span>
                      )}
                      {qtyChanged && mod.newQuantity > 0 && (
                        <span className="badge badge-warning">Qté ajustée</span>
                      )}
                      {priceChanged && (
                        <span className="badge badge-info">Prix ajusté</span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="mt-2 grid grid-cols-2 gap-1.5 text-[11px]">
                  <div className="p-1.5 rounded bg-bg-secondary border border-border">
                    <p className="text-[9px] uppercase font-semibold text-text-muted">Quantité</p>
                    {qtyChanged ? (
                      <p className="tabular-nums mt-0.5">
                        <span className="line-through text-text-muted">{mod.originalQuantity}</span>{" "}
                        → <span className={`font-bold ${mod.newQuantity === 0 ? "text-error" : ""}`}>{mod.newQuantity}</span>
                      </p>
                    ) : (
                      <p className="tabular-nums mt-0.5 font-bold">
                        {mod.newQuantity}{" "}
                        <span className="text-[9px] text-text-muted font-normal">inchangé</span>
                      </p>
                    )}
                  </div>
                  <div className="p-1.5 rounded bg-bg-secondary border border-border">
                    <p className="text-[9px] uppercase font-semibold text-text-muted">Prix unit.</p>
                    {priceChanged ? (
                      <p className="tabular-nums mt-0.5">
                        <span className="line-through text-text-muted">{fmt(mod.originalUnitPrice!)}</span>{" "}
                        → <span className="font-bold">{fmt(mod.newUnitPrice!)}</span>
                      </p>
                    ) : (
                      <p className="tabular-nums mt-0.5 font-bold">
                        {fmt(mod.unitPrice)}{" "}
                        <span className="text-[9px] text-text-muted font-normal">inchangé</span>
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-between mt-2">
                  <p className="text-[10px] text-text-muted italic">{REASON_LABELS[mod.reason]}</p>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-semibold text-error tabular-nums">
                      − {fmt(mod.priceDifference)}
                    </span>
                    {!readOnly && (
                      <button
                        onClick={() => onRevertOne(mod.orderItemId, mod.productName)}
                        disabled={pending}
                        className="text-[11px] font-semibold text-blue-600 underline underline-offset-2"
                      >
                        Rétablir
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {modifications.length > 0 && (
        <>
          <div className="px-4 py-3 border-t-2 border-error/30 flex items-center justify-between bg-error/5 shrink-0">
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-error">
              Total ajustements
            </span>
            <span className="text-base font-semibold text-error tabular-nums">− {fmt(totalCredit)}</span>
          </div>

          <div className="border-t border-border shrink-0 max-h-56 overflow-y-auto">
            <button
              onClick={() => setShowHistory(!showHistory)}
              className="w-full flex items-center gap-2 px-4 py-2 text-xs text-text-muted hover:bg-bg-secondary/50 transition sticky top-0 bg-bg-primary z-10"
            >
              <span>Historique des modifications</span>
              <span className="badge badge-neutral">{modifications.length}</span>
              <span className="ml-auto">{showHistory ? "▲" : "▼"}</span>
            </button>
            {showHistory && (
              <ol className="p-4 pt-2 space-y-2 text-[11px] bg-bg-secondary/30">
                {[...modifications]
                  .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
                  .map((mod) => (
                    <li key={mod.orderItemId} className="flex gap-2 items-start">
                      <span className="font-mono text-text-muted shrink-0 text-[10px]">
                        {new Date(mod.createdAt).toLocaleDateString("fr-FR", {
                          day: "2-digit",
                          month: "2-digit",
                        })}{" "}
                        {new Date(mod.createdAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                      </span>
                      <span className="flex-1">
                        <b>{mod.productName}</b> — {REASON_LABELS[mod.reason]}{" "}
                        <span className="text-error font-semibold">− {fmt(mod.priceDifference)}</span>
                      </span>
                    </li>
                  ))}
              </ol>
            )}
          </div>
        </>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Section 4 : Résumé de la commande (liste finale)                   */
/* ------------------------------------------------------------------ */

function SummarySection({
  orderedItems,
  compensationItems,
  totalUnits,
  totalModels,
  orderId,
  onZoomImage,
}: {
  orderedItems: OrderItemForEdit[];
  compensationItems: OrderItemForEdit[];
  totalUnits: number;
  totalModels: number;
  orderId: string;
  onZoomImage: (src: string) => void;
}) {
  const allItems = [...orderedItems, ...compensationItems];
  const [search, setSearch] = useState("");

  const filteredItems = useMemo(() => filterOrderItemsByQuery(allItems, search), [allItems, search]);

  return (
    <section className="card overflow-hidden">
      <div className="px-4 sm:px-5 py-3.5 border-b border-border flex items-center gap-3 flex-wrap bg-bg-secondary/30">
        <div className="w-[3px] h-6 bg-text-primary rounded-sm shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted">Section 4 — Ce que le client va recevoir</p>
          <h2 className="text-lg font-semibold text-text-primary">Résumé de la commande</h2>
        </div>
        <span className="badge badge-neutral">{totalUnits} unités</span>
        <span className="badge badge-neutral">{totalModels} modèles</span>
        <a
          href={`/api/admin/commandes/${orderId}/pdf?noPrices=1`}
          target="_blank"
          className="btn-secondary text-xs px-3 py-1.5 shrink-0"
        >
          Bon de préparation
        </a>
      </div>

      <div className="px-4 sm:px-5 py-3 border-b border-border bg-blue-50/40">
        <label className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted">
          Rechercher par référence ou nom
        </label>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Ex : BR-JO-DOR-BL-1250…"
          className="w-full mt-1 px-3 py-2 border border-border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
        />
      </div>

      {allItems.length === 0 ? (
        <div className="px-5 py-10 text-center text-sm text-text-muted italic">
          Aucun article à envoyer.
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="px-5 py-10 text-center text-sm text-text-muted italic">
          Aucun article ne correspond à « {search} ».
        </div>
      ) : (
        <div className="max-h-[640px] overflow-y-auto divide-y divide-border-light">
          {filteredItems.map((item) => (
            <div
              key={item.id}
              className={`px-4 sm:px-5 py-4 flex flex-wrap sm:flex-nowrap gap-3 sm:gap-4 items-center ${item.isCompensation ? "bg-success/5" : ""}`}
            >
              <ItemThumb
                src={item.imagePath}
                alt={item.productName}
                size="lg"
                onClick={item.imagePath ? () => onZoomImage(item.imagePath!) : undefined}
              />
              <div className="flex-1 min-w-[10rem]">
                <p className="text-base font-semibold text-text-primary leading-snug">{item.productName}</p>
                <p className="text-[11px] font-mono text-text-muted mt-1 break-all">
                  {item.productRef} · {item.colorName}
                  {item.isCompensation && <span className="badge badge-success ml-2">Ajouté</span>}
                </p>
              </div>
              <div className="flex items-center justify-between w-full sm:w-auto sm:justify-end gap-4 sm:gap-6">
                <p className="text-sm text-text-secondary tabular-nums text-left sm:text-right whitespace-nowrap sm:w-24">
                  {getTotalUnits(item)} unités
                  {item.saleType === "PACK" && item.packQty && (
                    <span className="block text-[10px] text-text-muted">
                      {item.quantity} × ×{item.packQty}
                    </span>
                  )}
                </p>
                <p className={`text-lg font-semibold tabular-nums text-right whitespace-nowrap sm:w-28 ${item.isCompensation ? "text-success" : ""}`}>
                  {item.isCompensation ? "+ " : ""}{fmt(item.lineTotal)}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Vignette produit                                                   */
/* ------------------------------------------------------------------ */

function ItemThumb({
  src,
  alt,
  size = "md",
  onClick,
}: {
  src: string | null;
  alt: string;
  size?: "sm" | "md" | "lg";
  onClick?: () => void;
}) {
  const dim = size === "sm" ? 44 : size === "lg" ? 88 : 56;
  const commonClass = "rounded-md bg-bg-secondary shrink-0 overflow-hidden border border-border";

  const inner = src ? (
    <Image src={src} alt={alt} width={dim} height={dim} className="w-full h-full object-cover transition group-hover:scale-105" />
  ) : (
    <div className="w-full h-full flex items-center justify-center text-text-muted text-[9px]">img</div>
  );

  if (onClick && src) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`${commonClass} group cursor-zoom-in`}
        style={{ width: dim, height: dim }}
        aria-label={`Agrandir l'image de ${alt}`}
      >
        {inner}
      </button>
    );
  }

  return (
    <div className={commonClass} style={{ width: dim, height: dim }}>
      {inner}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Modal image plein écran                                            */
/* ------------------------------------------------------------------ */

function ImageModal({ src, onClose }: { src: string; onClose: () => void }) {
  const handleClose = useCallback(() => onClose(), [onClose]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", handler);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", handler);
      document.body.style.overflow = prevOverflow;
    };
  }, [handleClose]);

  return (
    <div
      onClick={handleClose}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/85 p-4 sm:p-6"
      role="dialog"
      aria-modal="true"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative max-w-[95vw] max-h-[95vh] rounded-2xl overflow-hidden bg-white shadow-2xl"
      >
        <button
          type="button"
          onClick={handleClose}
          className="absolute top-3 right-3 w-10 h-10 rounded-full bg-white/95 shadow-md flex items-center justify-center text-2xl font-bold text-text-primary hover:bg-white focus:outline-none focus:ring-2 focus:ring-blue-400 z-10"
          aria-label="Fermer"
        >
          ×
        </button>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt=""
          className="block max-w-[95vw] max-h-[95vh] object-contain"
        />
      </div>
    </div>
  );
}
