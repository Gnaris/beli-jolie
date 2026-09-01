"use client";

import { useState, useTransition, useMemo, useEffect } from "react";
import Image from "next/image";
import {
  modifyOrderItems,
  addCompensationItemsBulk,
  removeCompensationItem,
  revertAllOrderItemModifications,
  setOrderItemLineDiscount,
} from "@/app/actions/admin/orders";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { getTotalUnits } from "@/lib/order-item-display";
import { roundCent } from "@/lib/money";

/* ================================================================== */
/*  Types                                                              */
/* ================================================================== */

export interface OrderItemView {
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
  lineDiscountType: "percent" | "fixed" | null;
  lineDiscountValue: number | null;
  lineDiscountAmt: number | null;
}

export interface OrderModification {
  orderItemId: string;
  originalQuantity: number;
  newQuantity: number;
  originalUnitPrice: number | null;
  newUnitPrice: number | null;
  reason: "OUT_OF_STOCK" | "CLIENT_REQUEST" | "COMMERCIAL_GESTURE";
  priceDifference: number;
  createdAt: string;
}

export interface OrderTotals {
  /** HT items DÉJÀ après remise commerciale + promo (= subtotalAfterDiscount du checkout). */
  currentSubtotalHT: number;
  /** Snapshot immuable du HT payé (idem currentSubtotalHT au moment du paiement). */
  paidSubtotalHT: number;
  /** Snapshot du HT BRUT (prix catalogue × qty, avant toute réduction). */
  subtotalBrutHT: number;
  /** Montant € de la remise commerciale client. */
  clientDiscountAmt: number;
  /** Montant € de la promotion AUTO (par item). */
  promoAutoDiscount: number;
  /** Montant € économisé via code promo. */
  promoDiscount: number;
  /** Code promo appliqué (pour affichage). */
  promoCode: string | null;
  carrierName: string;
  carrierPrice: number; // effectif (après remises)
  carrierBasePrice: number; // brut (fallback = carrierPrice pour commandes historiques)
  carrierPromoDiscount: number;
  carrierClientDiscount: number;
  tvaRate: number;
  /** TTC courant en BDD (mis à jour par recomputeOrderTotals à chaque modif). */
  currentTotalTTC: number;
  /** TTC payé sur Stripe. */
  paidTotalTTC: number;
  paymentStatus: string;
  /** Snapshot des promotions appliquées, persistant même si la promo est supprimée. */
  appliedPromotions: Array<{
    id: string;
    name: string;
    kind: "AUTO" | "CODE";
    scope: string;
    discountKind: string;
    discountValue: number;
    amountSaved: number;
  }>;
}

export interface ColorInfo {
  hex: string | null;
  patternImage: string | null;
}

interface Props {
  orderId: string;
  readOnly: boolean;
  items: OrderItemView[];
  modifications: OrderModification[];
  totals: OrderTotals;
  colorMap: Record<string, ColorInfo>;
}

/* ================================================================== */
/*  Helpers                                                            */
/* ================================================================== */

const fmt = (n: number) => n.toFixed(2).replace(".", ",") + " €";


function parseSizes(sizesJson: string | null): Array<{ name: string; quantity: number }> | null {
  if (!sizesJson) return null;
  try {
    const arr = JSON.parse(sizesJson);
    if (!Array.isArray(arr)) return null;
    return arr.filter((s) => s && typeof s.name === "string");
  } catch {
    return null;
  }
}

function sizeLabel(item: OrderItemView): string {
  const parsed = parseSizes(item.sizesJson);
  if (parsed && parsed.length > 0) {
    return parsed.map((s) => `${s.name} × ${s.quantity}`).join(" · ");
  }
  if (item.saleType === "PACK" && item.packQty) {
    return `Pack × ${item.packQty}`;
  }
  return item.size?.trim() || "TU";
}

/**
 * Nombre d'unités physiques que contient 1 « qté » de la ligne.
 * - PACK × N → N unités par qté
 * - PACK avec composition (sizesJson) → somme des tailles par qté
 * - UNIT → 1 par qté
 */
function perUnitFactor(item: OrderItemView): number {
  const parsed = parseSizes(item.sizesJson);
  if (parsed && parsed.length > 0) {
    return parsed.reduce((s, x) => s + (x.quantity || 0), 0) || 1;
  }
  if (item.saleType === "PACK" && item.packQty) {
    return item.packQty;
  }
  return 1;
}

/* ================================================================== */
/*  Composant principal                                                */
/* ================================================================== */

export default function OrderContent({
  orderId,
  readOnly,
  items,
  modifications,
  totals,
  colorMap,
}: Props) {
  const toast = useToast();
  const { confirm } = useConfirm();
  const [pending, startTransition] = useTransition();

  const [mode, setMode] = useState<"view" | "edit">("view");
  const [edits, setEdits] = useState<Record<string, { qty: number; price: number }>>({});
  const [showAdd, setShowAdd] = useState(false);
  const [zoomImage, setZoomImage] = useState<{ src: string; alt: string } | null>(null);

  const modMap = useMemo(
    () => new Map(modifications.map((m) => [m.orderItemId, m])),
    [modifications],
  );

  // Regroupement produit → sous-groupes par couleur (pour zebra doux)
  const groups = useMemo(() => {
    const productMap = new Map<
      string,
      { name: string; ref: string; subgroups: Map<string, OrderItemView[]> }
    >();
    for (const it of items) {
      const pKey = it.productRef || it.id;
      let p = productMap.get(pKey);
      if (!p) {
        p = { name: it.productName, ref: it.productRef, subgroups: new Map() };
        productMap.set(pKey, p);
      }
      const cKey = it.colorName || "—";
      const arr = p.subgroups.get(cKey) ?? [];
      arr.push(it);
      p.subgroups.set(cKey, arr);
    }
    return Array.from(productMap.values()).map((p) => ({
      name: p.name,
      ref: p.ref,
      colorGroups: Array.from(p.subgroups.entries()).map(([colorName, its]) => ({
        colorName,
        items: its,
      })),
    }));
  }, [items]);

  function enterEdit() {
    const init: typeof edits = {};
    items.forEach((it) => {
      init[it.id] = { qty: it.quantity, price: it.unitPrice };
    });
    setEdits(init);
    setShowAdd(false);
    setMode("edit");
  }

  function exitEdit() {
    setEdits({});
    setShowAdd(false);
    setMode("view");
  }

  function updateEdit(itemId: string, field: "qty" | "price", value: number) {
    setEdits((prev) => ({
      ...prev,
      [itemId]: { ...prev[itemId], [field]: value },
    }));
  }

  async function handleSave() {
    const changed = items
      .filter((it) => {
        const e = edits[it.id];
        if (!e) return false;
        return e.qty !== it.quantity || Math.abs(e.price - it.unitPrice) > 0.0001;
      })
      .map((it) => ({
        orderItemId: it.id,
        newQuantity: edits[it.id].qty,
        newUnitPrice: edits[it.id].price,
        reason: "OUT_OF_STOCK" as const,
      }));

    if (changed.length === 0) {
      exitEdit();
      return;
    }

    startTransition(async () => {
      const res = await modifyOrderItems(orderId, changed);
      if (res.success) {
        toast.success("Modifications enregistrées.");
        exitEdit();
      } else {
        toast.error(res.error ?? "Erreur");
      }
    });
  }

  async function handleRemoveOne(itemId: string, name: string, isCompensation: boolean) {
    const ok = await confirm({
      title: "Retirer l'article",
      message: `Retirer « ${name} » de la commande ?`,
      confirmLabel: "Retirer",
      cancelLabel: "Annuler",
    });
    if (!ok) return;

    startTransition(async () => {
      let res;
      if (isCompensation) {
        res = await removeCompensationItem(orderId, itemId);
      } else {
        res = await modifyOrderItems(orderId, [
          { orderItemId: itemId, newQuantity: 0, newUnitPrice: undefined, reason: "OUT_OF_STOCK" },
        ]);
      }
      if (res.success) {
        toast.success(`« ${name} » retiré.`);
      } else {
        toast.error(res.error ?? "Erreur");
      }
    });
  }

  async function handleRevertAll() {
    const ok = await confirm({
      title: "Rétablir la commande d'origine",
      message: "Toutes les modifications sur les articles seront annulées. Continuer ?",
      confirmLabel: "Tout rétablir",
      cancelLabel: "Annuler",
    });
    if (!ok) return;

    startTransition(async () => {
      const res = await revertAllOrderItemModifications(orderId);
      if (res.success) {
        toast.success("Modifications annulées.");
        exitEdit();
      } else {
        toast.error(res.error ?? "Erreur");
      }
    });
  }

  // Aperçu du sous-total HT NET (mode édition) — inclut la remise ligne persistée.
  // item.unitPrice EST DÉJÀ le prix après remise commerciale + promo (snapshot checkout).
  const previewSubtotalHT = useMemo(() => {
    if (mode !== "edit") return totals.currentSubtotalHT;
    let s = 0;
    items.forEach((it) => {
      const q = it.isCompensation ? it.quantity : edits[it.id]?.qty ?? it.quantity;
      const p = it.isCompensation ? it.unitPrice : edits[it.id]?.price ?? it.unitPrice;
      const lineDisc = Number(it.lineDiscountAmt ?? 0);
      s += Math.max(0, q * p - lineDisc);
    });
    return s;
  }, [mode, edits, items, totals.currentSubtotalHT]);

  // Compteurs affichés en résumé
  const totalUnits = items
    .filter((i) => (mode === "edit" ? (edits[i.id]?.qty ?? i.quantity) > 0 : i.quantity > 0))
    .reduce((s, i) => {
      if (mode === "edit") {
        const q = edits[i.id]?.qty ?? i.quantity;
        const perUnit = getTotalUnits(i) / Math.max(1, i.quantity);
        return s + Math.round(q * perUnit);
      }
      return s + getTotalUnits(i);
    }, 0);

  const totalModels = new Set(
    items
      .filter((i) => (mode === "edit" ? (edits[i.id]?.qty ?? i.quantity) > 0 : i.quantity > 0))
      .map((i) => i.productRef),
  ).size;

  // ── Résumé financier ──────────────────────────────────────────────
  // subHTNet = HT NET COURANT (après remise + promotion + remises ligne).
  // Le brut « ancien » = snapshot subtotalBrutHT (figé au paiement).
  // Le brut « nouveau » = somme actuelle des lineTotal (recomposée live pour
  // refléter les articles rompus / ajoutés depuis).
  const subHTNet = previewSubtotalHT;
  const clientDiscount = totals.clientDiscountAmt;
  const promoDisc = totals.promoDiscount;
  const promoAuto = totals.promoAutoDiscount;
  const promoTotal = promoAuto + promoDisc;
  const subHTGross = totals.subtotalBrutHT;
  const carrier = totals.carrierPrice;

  // Brut recomposé live à partir des items présents (nouveau brut).
  // - Mode view : somme des lineTotal actuels.
  // - Mode edit : intègre les changements en cours avant enregistrement.
  const currentBrutHT = useMemo(() => {
    let s = 0;
    items.forEach((it) => {
      if (mode === "edit") {
        const q = it.isCompensation ? it.quantity : edits[it.id]?.qty ?? it.quantity;
        const p = it.isCompensation ? it.unitPrice : edits[it.id]?.price ?? it.unitPrice;
        s += q * p;
      } else {
        s += Number(it.lineTotal);
      }
    });
    return roundCent(s);
  }, [items, mode, edits]);

  // TVA détaillée (indicative). Peut différer d'1 cent du calcul global.
  const tvaProducts = roundCent(subHTNet * totals.tvaRate);
  const tvaShipping = roundCent(carrier * totals.tvaRate);

  // Total TTC — règle Sage : TVA sur base taxable arrondie, puis TTC = addition simple.
  // Recalcul systématique côté client pour rester aligné avec la facture Sage,
  // même sur les commandes dont la BDD contient encore un totalTTC calculé
  // avec l'ancien arrondi (floorMoney) — la prochaine modif re-persistera.
  const currentTvaAmount = roundCent((subHTNet + carrier) * totals.tvaRate);
  const totalTTC = roundCent(subHTNet + carrier + currentTvaAmount);

  // ── Détection d'une modification post-paiement pour l'affichage ancien→nouveau ──
  // Vaut true dès qu'il y a eu au moins une modif (rupture ou compensation),
  // ou une différence entre brut payé et brut actuel.
  const hasBeenModified =
    modifications.length > 0 ||
    items.some((i) => i.isCompensation) ||
    Math.abs(subHTGross - currentBrutHT) > 0.005;

  // Snapshots de l'état payé (reconstruits depuis les champs figés en BDD).
  const paidBrutHT = subHTGross;
  const paidNetHT = totals.paidSubtotalHT;
  const paidClientDiscount = roundCent(paidBrutHT - paidNetHT);
  const paidTvaAmount = roundCent((paidNetHT + carrier) * totals.tvaRate);

  const paidTTC = totals.paidTotalTTC;
  const credit = Math.max(0, roundCent(paidTTC - totalTTC));
  const overshoot = Math.max(0, subHTNet - totals.paidSubtotalHT);
  const hasOvershoot = overshoot > 0.01;

  const editBorder = mode === "edit" ? "border-2 border-amber-400 ring-4 ring-amber-100/60" : "border border-slate-200";

  return (
    <>
    <section className={`bg-white ${editBorder} rounded-2xl overflow-hidden transition-shadow`}>
      {/* Bandeau vertical amber en mode édition, sur toute la hauteur de la carte */}
      {mode === "edit" && (
        <div className="h-1.5 bg-gradient-to-r from-amber-400 via-amber-500 to-amber-400" />
      )}

      {/* Header carte */}
      <div className={`px-5 sm:px-6 py-4 border-b flex items-center justify-between flex-wrap gap-3 ${mode === "edit" ? "bg-amber-50/70 border-amber-200" : "border-slate-100"}`}>
        <div className="flex items-center gap-3">
          <div className="w-1 h-8 bg-sky-500 rounded-full" />
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-sky-700">
              Contenu de la commande
            </p>
            <h2 className="font-heading text-lg font-semibold text-slate-900">Articles commandés</h2>
          </div>
        </div>

        {!readOnly && (
          <div className="flex flex-wrap gap-2">
            {mode === "view" ? (
              <button
                onClick={enterEdit}
                className="inline-flex items-center gap-2 bg-slate-900 text-white text-sm font-medium px-4 py-2 rounded-xl hover:bg-slate-800"
              >
                <PencilIcon /> Modifier la commande
              </button>
            ) : (
              <>
                <button
                  onClick={exitEdit}
                  disabled={pending}
                  className="inline-flex items-center gap-2 bg-white border border-slate-200 text-sm px-4 py-2 rounded-xl hover:bg-slate-50 disabled:opacity-40"
                >
                  Annuler
                </button>
                <button
                  onClick={handleSave}
                  disabled={pending}
                  className="inline-flex items-center gap-2 bg-emerald-600 text-white text-sm font-medium px-4 py-2 rounded-xl hover:bg-emerald-700 disabled:opacity-40"
                >
                  {pending ? "Enregistrement…" : "Enregistrer les modifications"}
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Bandeaux */}
      {mode === "edit" && (
        <div className="px-5 sm:px-6 py-3 bg-amber-50 border-b border-amber-200 text-amber-900 text-xs flex items-center gap-2">
          <span aria-hidden>✏️</span>
          <span>
            Mode édition — ajustez les quantités, les prix, ou ajoutez un article. Vous ne pouvez pas dépasser le
            montant payé par le client.
          </span>
        </div>
      )}

      {hasOvershoot && mode === "edit" && (
        <div className="px-5 sm:px-6 py-3 bg-rose-50 border-b border-rose-200 text-rose-800 text-xs flex items-start gap-2">
          <span aria-hidden>⚠️</span>
          <span>
            Le sous-total HT ({fmt(subHTNet)}) dépasse le HT payé ({fmt(totals.paidSubtotalHT)}). Baissez les quantités ou
            les prix de <b>{fmt(overshoot)}</b> avant d'enregistrer.
          </span>
        </div>
      )}

      {mode === "edit" && (
        <div className="px-5 sm:px-6 py-3 border-b border-amber-200 bg-amber-50/60 flex items-center justify-between gap-3 flex-wrap">
          <p className="text-xs text-slate-600">
            Budget disponible : <b className="text-slate-900 tabular-nums">{fmt(Math.max(0, totals.paidSubtotalHT - subHTNet))}</b>
          </p>
          <button
            onClick={() => setShowAdd(true)}
            className="inline-flex items-center gap-2 bg-slate-900 text-white text-sm font-medium px-4 py-2 rounded-xl hover:bg-slate-800"
          >
            <PlusIcon /> Ajouter un article
          </button>
        </div>
      )}

      {showAdd && (
        <AddProductModal
          orderId={orderId}
          headroom={Math.max(0, totals.paidSubtotalHT - subHTNet)}
          onClose={() => setShowAdd(false)}
        />
      )}

      {/* ─────────── Tableau desktop ─────────── */}
      {items.length === 0 ? (
        <div className="px-5 sm:px-6 py-10 text-center text-sm text-slate-500 italic">
          Aucun article dans cette commande.
        </div>
      ) : (
        <div className="hidden lg:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
              <tr>
                <th className="text-left px-4 py-3 w-16">Image</th>
                <th className="text-left px-2 py-3 w-24">Référence</th>
                <th className="text-left px-2 py-3 w-40">Couleur</th>
                <th className="text-left px-2 py-3 w-28">Taille</th>
                <th className="text-center px-2 py-3 w-28">Qté</th>
                <th className="text-center px-2 py-3 w-24">Qté totale</th>
                <th className="text-right px-2 py-3 w-28">Prix</th>
                <th className="text-right px-2 py-3 w-28">Prix total HT</th>
                <th className="text-right px-2 py-3 w-24">Remise</th>
                <th className="text-right px-2 py-3 w-28">Total HT</th>
                <th className="text-right px-4 py-3 w-28">Total TTC</th>
                {!readOnly && mode === "edit" && <th className="w-10" />}
              </tr>
            </thead>
            <tbody>
              {groups.map((g, gi) => (
                <ProductGroupRows
                  key={g.ref + "-" + gi}
                  orderId={orderId}
                  group={g}
                  gi={gi}
                  modMap={modMap}
                  mode={mode}
                  edits={edits}
                  onEdit={updateEdit}
                  onRemove={handleRemoveOne}
                  pending={pending}
                  readOnly={readOnly}
                  tvaRate={totals.tvaRate}
                  colorMap={colorMap}
                  onZoomImage={setZoomImage}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ─────────── Cartes mobile / tablette ─────────── */}
      {items.length > 0 && (
        <div className="lg:hidden">
          {groups.map((g, gi) => (
            <div key={g.ref + "-m-" + gi} className="border-b border-slate-100 last:border-b-0">
              <div className="px-4 py-2 bg-gradient-to-r from-sky-50/70 to-transparent border-l-4 border-sky-400">
                <p className="text-sm font-semibold text-slate-900">{g.name}</p>
                <p className="text-[11px] text-slate-500 font-mono">{g.ref}</p>
              </div>
              {g.colorGroups.map((cg, ci) =>
                cg.items.map((item) => (
                  <MobileItemCard
                    key={item.id}
                    orderId={orderId}
                    item={item}
                    mod={modMap.get(item.id)}
                    mode={mode}
                    edit={edits[item.id]}
                    onEdit={updateEdit}
                    onRemove={handleRemoveOne}
                    pending={pending}
                    readOnly={readOnly}
                    tvaRate={totals.tvaRate}
                    color={colorMap[cg.colorName]}
                    zebra={ci % 2 === 1}
                    onZoomImage={setZoomImage}
                  />
                )),
              )}
            </div>
          ))}
        </div>
      )}

      {mode === "edit" && modifications.length > 0 && (
        <div className="px-5 sm:px-6 py-3 border-t border-slate-100 bg-slate-50/60 flex justify-end">
          <button
            onClick={handleRevertAll}
            disabled={pending}
            className="text-xs text-rose-700 hover:text-rose-900 underline underline-offset-2 disabled:opacity-40"
          >
            Rétablir la commande d'origine
          </button>
        </div>
      )}
    </section>

    {/* ═══════════════════════════════════════════════════════════════ */}
    {/*  BLOC 2 : RÉSUMÉ DE LA COMMANDE (carte séparée)                  */}
    {/* ═══════════════════════════════════════════════════════════════ */}
    <section className="bg-white border border-slate-200 rounded-2xl overflow-hidden mt-6">
      <div className="px-5 sm:px-6 py-4 border-b border-slate-100 flex items-center gap-3">
        <div className="w-1 h-8 bg-slate-900 rounded-full" />
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
            Totaux
          </p>
          <h2 className="font-heading text-lg font-semibold text-slate-900">Résumé de la commande</h2>
        </div>
      </div>

      <div className="px-5 sm:px-6 py-5 bg-slate-50/60">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
          <SummaryTile label="Modèles" value={totalModels.toString()} />
          <SummaryTile label="Quantité totale" value={totalUnits.toString()} />
          <SummaryTile label="Total HT" value={fmt(subHTNet)} />
          <SummaryTile label="Total TTC" value={fmt(totalTTC)} accent="sky" />
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 space-y-4 text-sm">
          {/* ═════ BLOC 1 : Promotion ═════ */}
          <div className="space-y-2">
            <SummaryLine
              label="Sous-total produits HT"
              value={fmt(currentBrutHT)}
              oldValue={hasBeenModified ? fmt(paidBrutHT) : undefined}
            />

            {promoTotal > 0 && (
              <SummaryLine
                label="Promotions"
                value={`− ${fmt(promoTotal)}`}
                valueColor="text-emerald-700"
              />
            )}

            {totals.appliedPromotions.length > 0 && (
              <div className="pl-4 py-1 space-y-1 border-l-2 border-emerald-200 ml-1">
                {totals.appliedPromotions.map((p) => (
                  <div key={p.id} className="flex justify-between items-center text-xs text-slate-600">
                    <span className="inline-flex items-center gap-2">
                      <span
                        className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-semibold uppercase tracking-wider ${
                          p.kind === "CODE" ? "bg-sky-100 text-sky-700" : "bg-emerald-100 text-emerald-700"
                        }`}
                      >
                        {p.kind === "CODE" ? "Code" : "Auto"}
                      </span>
                      <span>{p.name}</span>
                      {p.discountKind === "PERCENTAGE" && (
                        <span className="text-slate-400">(− {p.discountValue}%)</span>
                      )}
                    </span>
                    <span className="tabular-nums text-emerald-700 font-medium">
                      − {fmt(p.amountSaved)}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {promoTotal > 0 && (
              <SummaryLine
                label="Total après promotion"
                value={fmt(roundCent(currentBrutHT - promoTotal))}
                oldValue={hasBeenModified ? fmt(roundCent(paidBrutHT - promoTotal)) : undefined}
                bold
                separatorTop
              />
            )}
          </div>

          {/* ═════ BLOC 2 : Remise commerciale client (base = total après promotion) ═════ */}
          {clientDiscount > 0 && (
            <div className="space-y-2 pt-3 border-t border-dashed border-slate-200">
              <SummaryLine
                label="Remise commerciale client"
                value={`− ${fmt(clientDiscount)}`}
                oldValue={hasBeenModified ? `− ${fmt(paidClientDiscount)}` : undefined}
                valueColor="text-emerald-700"
              />
              <SummaryLine
                label="Total après remise commerciale"
                value={fmt(subHTNet)}
                oldValue={hasBeenModified ? fmt(paidNetHT) : undefined}
                bold
                separatorTop
              />
            </div>
          )}

          {/* ═════ Frais de port (2 blocs) + TVA + TTC ═════ */}
          <div className="space-y-4 pt-3 border-t border-slate-100">
            {/* Livraison — bloc 1 promo */}
            <div className="space-y-2">
              <SummaryLine
                label={`Frais de port${totals.carrierName ? ` (${totals.carrierName})` : ""}`}
                value={totals.carrierBasePrice === 0 ? "Gratuit" : fmt(totals.carrierBasePrice)}
              />
              {totals.carrierPromoDiscount > 0 && (
                <>
                  <SummaryLine
                    label="Promotion livraison"
                    value={`− ${fmt(totals.carrierPromoDiscount)}`}
                    valueColor="text-emerald-700"
                  />
                  <SummaryLine
                    label="Livraison après promotion"
                    value={fmt(
                      Math.floor((totals.carrierBasePrice - totals.carrierPromoDiscount) * 100) / 100,
                    )}
                    bold
                    separatorTop
                  />
                </>
              )}
            </div>

            {/* Livraison — bloc 2 remise commerciale */}
            {totals.carrierClientDiscount > 0 && (
              <div className="space-y-2 pt-3 border-t border-dashed border-slate-200">
                <SummaryLine
                  label="Remise commerciale livraison"
                  value={
                    totals.carrierPrice === 0
                      ? "Offerte"
                      : `− ${fmt(totals.carrierClientDiscount)}`
                  }
                  valueColor="text-emerald-700"
                />
                <SummaryLine
                  label="Livraison après remise commerciale"
                  value={totals.carrierPrice === 0 ? "Gratuit" : fmt(totals.carrierPrice)}
                  bold
                  separatorTop
                />
              </div>
            )}

            <SummaryLine
              label={`TVA produits (${totals.tvaRate === 0 ? "0 % — exonéré" : `${Math.round(totals.tvaRate * 100)} %`})`}
              value={fmt(tvaProducts)}
              oldValue={
                hasBeenModified
                  ? fmt(roundCent(paidNetHT * totals.tvaRate))
                  : undefined
              }
            />
            <SummaryLine
              label={`TVA frais de port (${totals.tvaRate === 0 ? "0 % — exonéré" : `${Math.round(totals.tvaRate * 100)} %`})`}
              value={fmt(tvaShipping)}
            />

            <div className="flex justify-between items-baseline gap-3 border-t-2 border-slate-900 pt-3 mt-2">
              <span className="font-heading text-base font-semibold text-slate-900">Prix total TTC</span>
              <span className="text-right inline-flex items-baseline gap-2 flex-wrap justify-end">
                {hasBeenModified && Math.abs(paidTTC - totalTTC) > 0.005 && (
                  <span className="text-slate-400 line-through decoration-slate-400/70 text-sm font-normal tabular-nums">
                    {fmt(paidTTC)}
                  </span>
                )}
                <span className="font-heading text-2xl font-bold text-slate-900 tabular-nums">{fmt(totalTTC)}</span>
              </span>
            </div>
          </div>

          <div className="pt-3 mt-2 border-t border-dashed border-slate-200 flex justify-between text-xs text-slate-500">
            <span>
              Payé par le client (Stripe · {totals.paymentStatus === "paid" ? "encaissé" : totals.paymentStatus})
            </span>
            <span className="tabular-nums">{fmt(paidTTC)}</span>
          </div>

          {credit > 0.01 && (
            <div className="flex justify-between items-center text-sm text-rose-800 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
              <span className="font-semibold">Avoir à rembourser</span>
              <span className="font-bold tabular-nums">{fmt(credit)}</span>
            </div>
          )}
        </div>
      </div>
    </section>

    {zoomImage && (
      <ImageZoomOverlay src={zoomImage.src} alt={zoomImage.alt} onClose={() => setZoomImage(null)} />
    )}
  </>
  );
}

/* ================================================================== */
/*  Overlay de zoom image                                              */
/* ================================================================== */

function ImageZoomOverlay({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 sm:p-8"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-slate-900/85 backdrop-blur-sm" />
      <button
        onClick={onClose}
        aria-label="Fermer l'aperçu"
        className="absolute top-4 right-4 z-10 w-10 h-10 rounded-full bg-white/90 hover:bg-white text-slate-900 text-xl flex items-center justify-center shadow-lg"
      >
        ✕
      </button>
      <div className="relative max-w-[90vw] max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt}
          className="max-w-[90vw] max-h-[90vh] object-contain rounded-xl shadow-2xl"
        />
        <p className="mt-3 text-center text-white/80 text-sm">{alt}</p>
      </div>
    </div>
  );
}

/* ================================================================== */
/*  Groupe produit : header + lignes variantes                          */
/* ================================================================== */

function ProductGroupRows({
  orderId,
  group,
  gi,
  modMap,
  mode,
  edits,
  onEdit,
  onRemove,
  pending,
  readOnly,
  tvaRate,
  colorMap,
  onZoomImage,
}: {
  orderId: string;
  group: {
    name: string;
    ref: string;
    colorGroups: Array<{ colorName: string; items: OrderItemView[] }>;
  };
  gi: number;
  modMap: Map<string, OrderModification>;
  mode: "view" | "edit";
  edits: Record<string, { qty: number; price: number }>;
  onEdit: (id: string, field: "qty" | "price", v: number) => void;
  onRemove: (id: string, name: string, isCompensation: boolean) => void;
  pending: boolean;
  readOnly: boolean;
  tvaRate: number;
  colorMap: Record<string, ColorInfo>;
  onZoomImage: (img: { src: string; alt: string }) => void;
}) {
  const colspan = !readOnly && mode === "edit" ? 12 : 11;
  const totalVariants = group.colorGroups.reduce((s, cg) => s + cg.items.length, 0);
  return (
    <>
      {/* Ligne header produit — bandeau bleu */}
      <tr>
        <td
          colSpan={colspan}
          className={`px-4 py-2 border-t ${gi === 0 ? "border-slate-100" : "border-slate-200"} bg-gradient-to-r from-sky-50/70 via-sky-50/20 to-transparent`}
        >
          <div className="flex items-center gap-3 pl-2 border-l-4 border-sky-400 -ml-2">
            <span className="font-heading text-sm font-semibold text-slate-900">{group.name}</span>
            <span className="text-[11px] text-slate-500 font-mono">{group.ref}</span>
            <span className="text-[11px] text-slate-400">
              · {totalVariants} variante{totalVariants > 1 ? "s" : ""}
            </span>
          </div>
        </td>
      </tr>

      {/* Sous-groupes couleur : zebra alterné par sous-groupe */}
      {group.colorGroups.map((cg, ci) =>
        cg.items.map((item) => (
          <VariantRow
            key={item.id}
            orderId={orderId}
            item={item}
            mod={modMap.get(item.id)}
            mode={mode}
            edit={edits[item.id]}
            onEdit={onEdit}
            onRemove={onRemove}
            pending={pending}
            readOnly={readOnly}
            tvaRate={tvaRate}
            color={colorMap[cg.colorName]}
            zebra={ci % 2 === 1}
            productRef={group.ref}
            onZoomImage={onZoomImage}
          />
        )),
      )}
    </>
  );
}

/* ================================================================== */
/*  Ligne variante (desktop tableau)                                    */
/* ================================================================== */

function VariantRow({
  orderId,
  item,
  mod,
  mode,
  edit,
  onEdit,
  onRemove,
  pending,
  readOnly,
  tvaRate,
  color,
  zebra,
  productRef,
  onZoomImage,
}: {
  orderId: string;
  item: OrderItemView;
  mod: OrderModification | undefined;
  mode: "view" | "edit";
  edit: { qty: number; price: number } | undefined;
  onEdit: (id: string, field: "qty" | "price", v: number) => void;
  onRemove: (id: string, name: string, isCompensation: boolean) => void;
  pending: boolean;
  readOnly: boolean;
  tvaRate: number;
  color: ColorInfo | undefined;
  zebra: boolean;
  productRef: string;
  onZoomImage: (img: { src: string; alt: string }) => void;
}) {
  const qty = mode === "edit" ? edit?.qty ?? item.quantity : item.quantity;
  const price = mode === "edit" ? edit?.price ?? item.unitPrice : item.unitPrice;

  // Remise ligne persistée (n'a AUCUN lien avec l'ajustement de prix)
  const discountAmt = Number(item.lineDiscountAmt ?? 0);

  const priceTotalHT = qty * price;
  const totalHT = Math.max(0, priceTotalHT - discountAmt);
  // Sage : TVA arrondie séparément puis TTC = HT + TVA.
  const lineTva = roundCent(totalHT * tvaRate);
  const totalTTC = roundCent(totalHT + lineTva);

  const isRemoved = qty === 0;
  const perUnit = perUnitFactor(item);
  const qtyTotal = qty * perUnit;

  const qtyChanged = !!mod && mod.originalQuantity !== mod.newQuantity;
  const priceChanged = !!mod && mod.newUnitPrice !== null && mod.originalUnitPrice !== null;

  const rowBg = item.isCompensation
    ? "bg-emerald-50/40"
    : mod
    ? "bg-amber-50/40"
    : zebra
    ? "bg-slate-50/60"
    : "";

  return (
    <tr className={`border-t border-slate-100 ${rowBg} ${isRemoved && mode === "view" ? "opacity-60" : ""}`}>
      {/* Image cliquable = zoom */}
      <td className="px-4 py-3 pl-8">
        {item.imagePath ? (
          <button
            type="button"
            onClick={() =>
              onZoomImage({ src: item.imagePath!, alt: `${item.productName} — ${item.colorName}` })
            }
            title="Agrandir l'image"
            className="w-12 h-12 rounded-lg bg-slate-100 overflow-hidden border border-slate-200 hover:ring-2 hover:ring-sky-300 focus:outline-none focus:ring-2 focus:ring-sky-400 transition"
          >
            <Image
              src={item.imagePath}
              alt={item.productName}
              width={48}
              height={48}
              className="w-full h-full object-cover"
            />
          </button>
        ) : (
          <div className="w-12 h-12 rounded-lg bg-slate-100 flex items-center justify-center text-slate-300 text-xs">
            —
          </div>
        )}
      </td>

      {/* Référence produit */}
      <td className="px-2 py-3">
        <span className="text-xs font-mono text-slate-600">{productRef}</span>
      </td>

      {/* Couleur : pastille + nom + badge Ajouté (compensation) */}
      <td className="px-2 py-3">
        <div className="flex items-center gap-2 flex-wrap">
          <ColorSwatch color={color} />
          <span className="text-sm text-slate-900">{item.colorName || "—"}</span>
          {item.isCompensation && <Chip variant="success">Ajouté</Chip>}
        </div>
      </td>

      {/* Taille */}
      <td className="px-2 py-3 text-sm text-slate-700">{sizeLabel(item)}</td>

      {/* Qté (avec barré + flèche + badge Qté ajustée / Retiré si modif) */}
      <td className="px-2 py-3 text-center">
        {mode === "edit" ? (
          <QtyStepper
            value={qty}
            max={item.isCompensation ? 9999 : mod ? mod.originalQuantity : item.quantity}
            onChange={(v) => onEdit(item.id, "qty", v)}
            disabled={pending}
          />
        ) : qtyChanged ? (
          <div className="flex flex-col items-center gap-1">
            <span className="inline-flex items-center gap-1.5 tabular-nums">
              <span className="line-through text-slate-400">{mod!.originalQuantity}</span>
              <span className="text-slate-400">→</span>
              <span className={`font-semibold ${mod!.newQuantity === 0 ? "text-rose-600" : "text-slate-900"}`}>
                {mod!.newQuantity}
              </span>
            </span>
            {mod!.newQuantity === 0 ? (
              <Chip variant="danger">Retiré</Chip>
            ) : (
              <Chip variant="warning">Qté ajustée</Chip>
            )}
          </div>
        ) : (
          <span className="tabular-nums font-medium text-slate-900">{qty}</span>
        )}
      </td>

      {/* Qté totale (unités physiques) */}
      <td className="px-2 py-3 text-center">
        <span className="inline-flex items-center gap-1 tabular-nums font-semibold text-slate-900">
          {qtyTotal}
          {perUnit > 1 && (
            <span className="text-[10px] font-normal text-slate-400">({qty}×{perUnit})</span>
          )}
        </span>
      </td>

      {/* Prix unitaire (avec badge Prix ajusté si modif) */}
      <td className="px-2 py-3 text-right">
        {mode === "edit" ? (
          <PriceInput
            value={price}
            max={item.isCompensation ? 99999 : mod?.originalUnitPrice ?? item.unitPrice}
            onChange={(v) => onEdit(item.id, "price", v)}
            disabled={pending}
          />
        ) : priceChanged ? (
          <div className="flex flex-col items-end gap-1">
            <span className="inline-flex items-center gap-1 tabular-nums">
              <span className="line-through text-slate-400 text-xs">{fmt(mod!.originalUnitPrice!)}</span>
              <span className="text-slate-400">→</span>
              <span className="font-semibold text-slate-900">{fmt(mod!.newUnitPrice!)}</span>
            </span>
            <Chip variant="info">Prix ajusté</Chip>
          </div>
        ) : (
          <span className="tabular-nums text-slate-700">{fmt(price)}</span>
        )}
      </td>

      {/* Prix total HT (avant remise ligne) */}
      <td className="px-2 py-3 text-right tabular-nums text-slate-700">{fmt(priceTotalHT)}</td>

      {/* Remise ligne — éditable en mode édition */}
      <td className="px-2 py-3">
        <DiscountCell
          orderId={orderId}
          orderItemId={item.id}
          type={item.lineDiscountType}
          value={item.lineDiscountValue}
          amount={discountAmt}
          editable={mode === "edit"}
        />
      </td>

      {/* Total HT (après remise) */}
      <td className="px-2 py-3 text-right tabular-nums font-medium text-slate-900">{fmt(totalHT)}</td>

      {/* Total TTC */}
      <td className="px-4 py-3 text-right tabular-nums font-semibold text-slate-900">{fmt(totalTTC)}</td>

      {/* Bouton retirer (mode édition) */}
      {!readOnly && mode === "edit" && (
        <td className="pr-3">
          <button
            onClick={() => onRemove(item.id, `${item.productName} — ${item.colorName}`, item.isCompensation)}
            disabled={pending}
            title="Retirer la ligne"
            className="w-8 h-8 rounded-lg text-rose-600 hover:bg-rose-50 disabled:opacity-40"
          >
            🗑
          </button>
        </td>
      )}
    </tr>
  );
}

/* ================================================================== */
/*  Pastille couleur (hex ou patternImage)                              */
/* ================================================================== */

function DiscountCell({
  orderId,
  orderItemId,
  type,
  value,
  amount,
  editable,
}: {
  orderId: string;
  orderItemId: string;
  type: "percent" | "fixed" | null;
  value: number | null;
  amount: number;
  editable: boolean;
}) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [localType, setLocalType] = useState<"percent" | "fixed">(type ?? "fixed");
  const [localValue, setLocalValue] = useState<string>(value ? String(value) : "");

  async function apply() {
    const num = parseFloat(localValue.replace(",", "."));
    const payload =
      isNaN(num) || num <= 0
        ? ({ type: null, value: null } as const)
        : ({ type: localType, value: num } as const);

    startTransition(async () => {
      const r = await setOrderItemLineDiscount(orderId, orderItemId, payload);
      if (r.success) {
        setOpen(false);
      } else {
        toast.error(r.error ?? "Erreur");
      }
    });
  }

  // Vue lecture seule
  if (!editable) {
    if (amount > 0) {
      return (
        <div className="text-right tabular-nums text-emerald-700 font-medium">
          − {fmt(amount)}
          {type === "percent" && value ? (
            <span className="block text-[10px] text-slate-400 font-normal">({value}%)</span>
          ) : null}
        </div>
      );
    }
    return <div className="text-right tabular-nums text-slate-400">—</div>;
  }

  // Mode édition
  if (!open) {
    return (
      <div className="text-right">
        <button
          onClick={() => setOpen(true)}
          className={`inline-flex flex-col items-end px-2 py-1 rounded-lg border ${
            amount > 0
              ? "border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
              : "border-dashed border-slate-300 text-slate-500 hover:bg-slate-50"
          }`}
        >
          <span className="text-xs tabular-nums font-medium">
            {amount > 0 ? `− ${fmt(amount)}` : "+ Remise"}
          </span>
          {amount > 0 && type === "percent" && value ? (
            <span className="text-[10px] text-slate-500">({value}%)</span>
          ) : null}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="inline-flex items-center rounded-lg border border-slate-200 overflow-hidden bg-white">
        <button
          type="button"
          onClick={() => setLocalType("fixed")}
          className={`px-2 py-1 text-xs ${localType === "fixed" ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-50"}`}
        >
          €
        </button>
        <button
          type="button"
          onClick={() => setLocalType("percent")}
          className={`px-2 py-1 text-xs border-l border-slate-200 ${localType === "percent" ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-50"}`}
        >
          %
        </button>
        <input
          type="number"
          min={0}
          step="0.01"
          value={localValue}
          onChange={(e) => setLocalValue(e.target.value)}
          placeholder="0"
          className="w-16 h-7 px-1.5 text-right border-l border-slate-200 tabular-nums text-xs focus:outline-none"
          autoFocus
        />
      </div>
      <div className="flex gap-1">
        <button
          onClick={() => {
            setOpen(false);
            setLocalValue(value ? String(value) : "");
            setLocalType(type ?? "fixed");
          }}
          className="px-2 py-1 rounded text-[11px] text-slate-500 hover:bg-slate-100"
        >
          Annuler
        </button>
        <button
          onClick={apply}
          disabled={pending}
          className="px-2 py-1 rounded text-[11px] bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40"
        >
          {pending ? "…" : "OK"}
        </button>
      </div>
    </div>
  );
}

function ColorSwatch({ color }: { color: ColorInfo | undefined }) {
  if (color?.patternImage) {
    return (
      <div
        className="w-5 h-5 rounded-full border border-slate-200 shrink-0"
        style={{ backgroundImage: `url(${color.patternImage})`, backgroundSize: "cover", backgroundPosition: "center" }}
      />
    );
  }
  if (color?.hex) {
    return (
      <div
        className="w-5 h-5 rounded-full border border-slate-200 shrink-0"
        style={{ backgroundColor: color.hex }}
      />
    );
  }
  return (
    <div className="w-5 h-5 rounded-full border border-dashed border-slate-300 bg-slate-50 shrink-0" title="Couleur inconnue" />
  );
}

/* ================================================================== */
/*  Carte article (mobile)                                              */
/* ================================================================== */

function MobileItemCard({
  orderId,
  item,
  mod,
  mode,
  edit,
  onEdit,
  onRemove,
  pending,
  readOnly,
  tvaRate,
  color,
  zebra,
  onZoomImage,
}: {
  orderId: string;
  item: OrderItemView;
  mod: OrderModification | undefined;
  mode: "view" | "edit";
  edit: { qty: number; price: number } | undefined;
  onEdit: (id: string, field: "qty" | "price", v: number) => void;
  onRemove: (id: string, name: string, isCompensation: boolean) => void;
  pending: boolean;
  readOnly: boolean;
  tvaRate: number;
  color: ColorInfo | undefined;
  zebra: boolean;
  onZoomImage: (img: { src: string; alt: string }) => void;
}) {
  const qty = mode === "edit" ? edit?.qty ?? item.quantity : item.quantity;
  const price = mode === "edit" ? edit?.price ?? item.unitPrice : item.unitPrice;
  const discountAmt = Number(item.lineDiscountAmt ?? 0);
  const priceTotalHT = qty * price;
  const totalHT = Math.max(0, priceTotalHT - discountAmt);
  // Sage : TVA arrondie séparément puis TTC = HT + TVA.
  const lineTva = roundCent(totalHT * tvaRate);
  const totalTTC = roundCent(totalHT + lineTva);
  const perUnit = perUnitFactor(item);
  const qtyTotal = qty * perUnit;
  const qtyChanged = !!mod && mod.originalQuantity !== mod.newQuantity;
  const priceChanged = !!mod && mod.newUnitPrice !== null && mod.originalUnitPrice !== null;

  const cardBg = item.isCompensation
    ? "bg-emerald-50/40"
    : mod
    ? "bg-amber-50/40"
    : zebra
    ? "bg-slate-50/60"
    : "";

  return (
    <div
      className={`px-4 py-3 flex gap-3 border-b border-slate-100 last:border-b-0 ${cardBg}`}
    >
      {item.imagePath ? (
        <button
          type="button"
          onClick={() => onZoomImage({ src: item.imagePath!, alt: `${item.productName} — ${item.colorName}` })}
          title="Agrandir l'image"
          className="w-14 h-14 rounded-lg bg-slate-100 overflow-hidden border border-slate-200 shrink-0 hover:ring-2 hover:ring-sky-300 focus:outline-none focus:ring-2 focus:ring-sky-400 transition"
        >
          <Image src={item.imagePath} alt={item.productName} width={56} height={56} className="w-full h-full object-cover" />
        </button>
      ) : (
        <div className="w-14 h-14 rounded-lg bg-slate-100 flex items-center justify-center text-slate-300 text-xs shrink-0">—</div>
      )}
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <ColorSwatch color={color} />
          <span className="text-sm font-medium text-slate-900">{item.colorName}</span>
          <Chip>{sizeLabel(item)}</Chip>
          {item.isCompensation && <Chip variant="success">Ajouté</Chip>}
        </div>

        {mode === "view" ? (
          <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
            <span className="text-slate-500">Qté</span>
            <span className="text-right tabular-nums text-slate-900 font-medium">
              {qtyChanged ? (
                <span className="inline-flex items-center gap-1">
                  <span className="line-through text-slate-400">{mod!.originalQuantity}</span>
                  <span className="text-slate-400">→</span>
                  <span className={mod!.newQuantity === 0 ? "text-rose-600" : ""}>{mod!.newQuantity}</span>
                  {mod!.newQuantity === 0 ? (
                    <Chip variant="danger">Retiré</Chip>
                  ) : (
                    <Chip variant="warning">Ajustée</Chip>
                  )}
                </span>
              ) : (
                qty
              )}
            </span>
            <span className="text-slate-500">Qté totale</span>
            <span className="text-right tabular-nums text-slate-900 font-semibold">
              {qtyTotal}
              {perUnit > 1 && <span className="text-slate-400 font-normal"> ({qty}×{perUnit})</span>}
            </span>
            <span className="text-slate-500">Prix</span>
            <span className="text-right tabular-nums text-slate-700">
              {priceChanged ? (
                <span className="inline-flex items-center gap-1">
                  <span className="line-through text-slate-400">{fmt(mod!.originalUnitPrice!)}</span>
                  <span className="text-slate-400">→</span>
                  <span className="font-medium text-slate-900">{fmt(mod!.newUnitPrice!)}</span>
                  <Chip variant="info">Ajusté</Chip>
                </span>
              ) : (
                fmt(price)
              )}
            </span>
            <span className="text-slate-500">Prix total HT</span>
            <span className="text-right tabular-nums text-slate-700">{fmt(priceTotalHT)}</span>
            <span className="text-slate-500">Remise</span>
            <span className="text-right">
              <DiscountCell
                orderId={orderId}
                orderItemId={item.id}
                type={item.lineDiscountType}
                value={item.lineDiscountValue}
                amount={discountAmt}
                editable={false}
              />
            </span>
            <span className="text-slate-500">Total HT</span>
            <span className="text-right tabular-nums text-slate-900 font-medium">{fmt(totalHT)}</span>
            <span className="text-slate-500">Total TTC</span>
            <span className="text-right tabular-nums text-slate-900 font-semibold">{fmt(totalTTC)}</span>
          </div>
        ) : (
          <div className="mt-2 space-y-2">
            <div className="flex items-center gap-2">
              <QtyStepper
                value={qty}
                max={item.isCompensation ? 9999 : mod ? mod.originalQuantity : item.quantity}
                onChange={(v) => onEdit(item.id, "qty", v)}
                disabled={pending}
              />
              <span className="text-slate-300">×</span>
              <PriceInput
                value={price}
                max={item.isCompensation ? 99999 : mod?.originalUnitPrice ?? item.unitPrice}
                onChange={(v) => onEdit(item.id, "price", v)}
                disabled={pending}
              />
              {!readOnly && (
                <button
                  onClick={() => onRemove(item.id, `${item.productName} — ${item.colorName}`, item.isCompensation)}
                  disabled={pending}
                  className="ml-auto w-8 h-8 rounded-lg text-rose-600 hover:bg-rose-50"
                >
                  🗑
                </button>
              )}
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Remise</span>
              <DiscountCell
                orderId={orderId}
                orderItemId={item.id}
                type={item.lineDiscountType}
                value={item.lineDiscountValue}
                amount={discountAmt}
                editable={true}
              />
            </div>
            <div className="text-right text-xs">
              <span className="text-slate-500">Total TTC : </span>
              <span className="font-semibold text-slate-900 tabular-nums">{fmt(totalTTC)}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ================================================================== */
/*  Contrôles élémentaires                                             */
/* ================================================================== */

function QtyStepper({
  value,
  max,
  onChange,
  disabled,
}: {
  value: number;
  max: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="inline-flex items-center">
      <button
        type="button"
        onClick={() => onChange(Math.max(0, value - 1))}
        disabled={disabled || value <= 0}
        className="w-8 h-8 rounded-l-lg bg-slate-100 hover:bg-slate-200 text-slate-700 disabled:opacity-40"
      >
        −
      </button>
      <input
        type="number"
        min={0}
        max={max}
        value={value}
        onChange={(e) => {
          const n = Math.max(0, Math.min(max, parseInt(e.target.value) || 0));
          onChange(n);
        }}
        disabled={disabled}
        className="w-12 h-8 text-center border-y border-slate-200 tabular-nums text-sm focus:outline-none"
      />
      <button
        type="button"
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={disabled || value >= max}
        className="w-8 h-8 rounded-r-lg bg-slate-100 hover:bg-slate-200 text-slate-700 disabled:opacity-40"
      >
        +
      </button>
    </div>
  );
}

function PriceInput({
  value,
  max,
  onChange,
  disabled,
}: {
  value: number;
  max: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="relative inline-block">
      <input
        type="number"
        step="0.01"
        min={0}
        max={max}
        value={value}
        onChange={(e) => {
          const n = Math.max(0, Math.min(max, parseFloat(e.target.value) || 0));
          onChange(n);
        }}
        disabled={disabled}
        className="w-24 h-8 pl-2 pr-6 rounded-lg border border-slate-200 tabular-nums text-sm focus:outline-none focus:ring-2 focus:ring-sky-200"
      />
      <span className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 text-xs">€</span>
    </div>
  );
}

function Chip({ children, variant = "neutral" }: { children: React.ReactNode; variant?: "neutral" | "info" | "success" | "warning" | "danger" }) {
  const cls: Record<string, string> = {
    neutral: "bg-slate-100 text-slate-600",
    info: "bg-sky-100 text-sky-700",
    success: "bg-emerald-100 text-emerald-700",
    warning: "bg-amber-100 text-amber-800",
    danger: "bg-rose-100 text-rose-700",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${cls[variant]}`}>
      {children}
    </span>
  );
}

function SummaryTile({
  label,
  value,
  accent = "slate",
}: {
  label: string;
  value: string;
  accent?: "slate" | "sky";
}) {
  const cls =
    accent === "sky"
      ? "bg-sky-50 border-sky-200 text-sky-800"
      : "bg-white border-slate-200 text-slate-900";
  return (
    <div className={`border rounded-xl p-3 ${cls}`}>
      <p className="text-[10px] uppercase tracking-wider font-semibold opacity-70">{label}</p>
      <p className="font-heading text-2xl font-bold tabular-nums mt-0.5">{value}</p>
    </div>
  );
}

function SummaryLine({
  label,
  value,
  oldValue,
  bold,
  separatorTop,
  valueColor,
}: {
  label: string;
  value: string;
  /** Ancien montant payé, affiché barré avant le nouveau si différent. */
  oldValue?: string;
  bold?: boolean;
  separatorTop?: boolean;
  valueColor?: string;
}) {
  const showOld = oldValue && oldValue !== value;
  return (
    <div
      className={`flex justify-between items-baseline gap-3 ${separatorTop ? "border-t border-slate-100 pt-2 mt-1" : ""} ${
        bold ? "text-slate-900 font-medium" : "text-slate-600"
      }`}
    >
      <span>{label}</span>
      <span className="tabular-nums text-right inline-flex items-baseline gap-2 flex-wrap justify-end">
        {showOld && (
          <span className="text-slate-400 line-through decoration-slate-400/70 text-xs font-normal">
            {oldValue}
          </span>
        )}
        <span className={`${valueColor ?? "text-slate-900"} font-medium`}>{value}</span>
      </span>
    </div>
  );
}

function PencilIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487z" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
    </svg>
  );
}

/* ================================================================== */
/*  Barre d'ajout d'un produit (identique à v1)                         */
/* ================================================================== */

interface SearchVariant {
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
  sizes: Array<{ id: string; name: string; maxQuantity: number; pricePerUnit: number | null }>;
}

interface SearchResult {
  id: string;
  reference: string;
  name: string;
  category: string | null;
  variants: SearchVariant[];
}

function AddProductModal({
  orderId,
  headroom,
  onClose,
}: {
  orderId: string;
  headroom: number;
  onClose: () => void;
}) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();

  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [product, setProduct] = useState<SearchResult | null>(null);

  // Config par variante : { qty, price }. Une variante est « à ajouter » dès qty > 0.
  const [configs, setConfigs] = useState<Record<string, { qty: number; price: number }>>({});

  // Escape ferme la modale
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Initialise configs quand un produit est chargé (qté à 0 par défaut, prix pré-rempli)
  function loadProduct(p: SearchResult) {
    const init: typeof configs = {};
    for (const v of p.variants) {
      init[v.id] = { qty: 0, price: v.unitPrice };
    }
    setConfigs(init);
    setProduct(p);
  }

  async function runSearch() {
    if (query.trim().length < 1) return;
    setSearching(true);
    setSearched(true);
    setProduct(null);
    setConfigs({});
    try {
      const r = await fetch(`/api/admin/orders/product-search?q=${encodeURIComponent(query.trim())}`);
      const j = await r.json();
      const products: SearchResult[] = j.products ?? [];
      // Recherche exacte : 0 ou 1 résultat. Auto-redirection si trouvé.
      if (products.length > 0) {
        loadProduct(products[0]);
      }
    } catch {
      // silence
    } finally {
      setSearching(false);
    }
  }

  function resetToSearch() {
    setProduct(null);
    setConfigs({});
    setQuery("");
    setSearched(false);
  }

  function updateConfig(variantId: string, field: "qty" | "price", value: number) {
    setConfigs((prev) => ({
      ...prev,
      [variantId]: { ...prev[variantId], [field]: value },
    }));
  }

  // Une variante est « à ajouter » dès que sa quantité > 0.
  const selectedVariants = useMemo(() => {
    if (!product) return [];
    return product.variants
      .filter((v) => (configs[v.id]?.qty ?? 0) > 0)
      .map((v) => {
        const cfg = configs[v.id]!;
        return { variant: v, qty: cfg.qty, price: cfg.price, lineTotal: cfg.qty * cfg.price };
      });
  }, [product, configs]);

  const grandTotal = selectedVariants.reduce((s, x) => s + x.lineTotal, 0);
  const overBudget = grandTotal > headroom + 0.01;

  function handleAddBulk() {
    if (!product || selectedVariants.length === 0) {
      toast.error("Mettez une quantité sur au moins une variante.");
      return;
    }
    if (overBudget) {
      toast.error("Le total dépasse le budget disponible.");
      return;
    }

    const inputs = selectedVariants.map(({ variant, qty, price }) => {
      const sizesJson =
        variant.saleType === "PACK" && variant.sizes.length > 0
          ? JSON.stringify(variant.sizes.map((s) => ({ name: s.name, quantity: s.maxQuantity })))
          : undefined;
      return {
        productColorId: variant.id,
        quantity: qty,
        unitPrice: price,
        sizesJson,
      };
    });

    startTransition(async () => {
      const r = await addCompensationItemsBulk(orderId, inputs);
      if (r.success) {
        toast.success(
          `${r.addedCount ?? inputs.length} article${(r.addedCount ?? inputs.length) > 1 ? "s" : ""} ajouté${(r.addedCount ?? inputs.length) > 1 ? "s" : ""}.`,
        );
        onClose();
      } else {
        toast.error(r.error ?? "Erreur lors de l'ajout groupé.");
      }
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-6" role="dialog" aria-modal="true">
      {/* Backdrop */}
      <button
        aria-label="Fermer"
        onClick={onClose}
        className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
      />

      {/* Modal */}
      <div className="relative w-full max-w-4xl max-h-[90vh] bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        {/* Header sticky */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between gap-3 shrink-0">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              Ajouter à la commande
            </p>
            <h3 className="font-heading text-lg font-semibold text-slate-900">
              {product ? `${product.name}` : "Rechercher un produit"}
              {product && (
                <span className="ml-2 text-xs font-mono text-slate-500">{product.reference}</span>
              )}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 text-lg leading-none"
          >
            ✕
          </button>
        </div>

        {/* Budget */}
        <div className="px-6 py-2.5 border-b border-slate-100 bg-slate-50/60 text-xs text-slate-600 shrink-0 flex items-center justify-between gap-3 flex-wrap">
          <span>
            Budget disponible : <b className="text-slate-900 tabular-nums">{fmt(headroom)}</b>
          </span>
          {product && selectedVariants.length > 0 && (
            <span>
              Sélection : <b className="text-slate-900 tabular-nums">{fmt(grandTotal)}</b> ·{" "}
              <span className={overBudget ? "text-rose-700 font-semibold" : "text-emerald-700 font-semibold"}>
                {overBudget ? "dépasse le budget" : `reste ${fmt(headroom - grandTotal)}`}
              </span>
            </span>
          )}
        </div>

        {/* Corps scrollable */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Étape 1 : recherche produit */}
          {!product && (
            <div className="space-y-4">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <input
                    autoFocus
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        runSearch();
                      }
                    }}
                    placeholder="Référence exacte du produit (ex : A1720)"
                    className="w-full pl-11 pr-4 py-3 rounded-xl border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-sky-200"
                  />
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 text-lg">🔍</span>
                </div>
                <button
                  onClick={runSearch}
                  disabled={searching || query.trim().length < 1}
                  className="inline-flex items-center gap-2 bg-slate-900 text-white text-sm font-medium px-5 py-3 rounded-xl hover:bg-slate-800 disabled:opacity-40"
                >
                  {searching ? "Recherche…" : "Rechercher"}
                </button>
              </div>

              <p className="text-[11px] text-slate-500">
                Cherche la <b>référence exacte</b>. Aucun résultat par préfixe ou nom partiel.
              </p>

              {!searched && !searching && (
                <p className="text-sm text-slate-500 italic text-center py-8">
                  Saisissez la référence exacte du produit puis cliquez sur <b>Rechercher</b>.
                </p>
              )}

              {searched && !searching && !product && (
                <p className="text-sm text-slate-500 italic text-center py-8">
                  Aucun produit avec la référence « {query.trim()} ».
                </p>
              )}
            </div>
          )}

          {/* Étape 2 : toutes les variantes affichées, qté 0 par défaut, ajout dès qté > 0 */}
          {product && (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <button
                  onClick={resetToSearch}
                  className="text-xs text-sky-700 hover:underline inline-flex items-center gap-1"
                >
                  ← Autre produit
                </button>
                <p className="text-[11px] text-slate-500 italic">
                  Mettez une quantité sur les variantes à ajouter (0 = ignorée).
                </p>
              </div>

              <div className="rounded-2xl border border-slate-200 divide-y divide-slate-100">
                {product.variants.map((v) => {
                  const cfg = configs[v.id];
                  if (!cfg) return null;
                  const perPack =
                    v.saleType === "PACK"
                      ? v.sizes.reduce((s, x) => s + x.maxQuantity, 0) || v.packQuantity || 1
                      : 1;
                  const isActive = cfg.qty > 0;
                  const lineTotal = cfg.qty * cfg.price;
                  const compoText =
                    v.saleType === "PACK" && v.sizes.length > 0
                      ? v.sizes.map((s) => `${s.name} × ${s.maxQuantity}`).join(" · ")
                      : null;

                  return (
                    <div
                      key={v.id}
                      className={`flex flex-col sm:flex-row sm:items-center gap-3 p-3 sm:p-4 transition ${
                        isActive ? "bg-sky-50/50" : ""
                      }`}
                    >
                      {/* Image */}
                      <div className="w-14 h-14 rounded-lg bg-slate-100 overflow-hidden shrink-0 border border-slate-200">
                        {v.image && (
                          <Image src={v.image} alt={v.colorName} width={56} height={56} className="w-full h-full object-cover" />
                        )}
                      </div>

                      {/* Couleur + infos */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <ColorSwatch color={{ hex: v.colorHex, patternImage: v.colorPattern }} />
                          <span className="text-sm font-medium text-slate-900">{v.colorName}</span>
                          {v.isPrimary && <Chip variant="info">Principale</Chip>}
                          {v.saleType === "PACK" ? (
                            <Chip variant="info">Paquet × {v.packQuantity}</Chip>
                          ) : (
                            <Chip>Unité</Chip>
                          )}
                        </div>
                        <p className="text-[11px] text-slate-500 mt-1">
                          Stock : <b>{v.stock}</b>
                          {compoText && (
                            <>
                              {" · "}
                              <span className="text-slate-400">Compo : {compoText}</span>
                            </>
                          )}
                        </p>
                      </div>

                      {/* Qté (0 par défaut) + Prix + Total */}
                      <div className="flex items-center gap-2 shrink-0">
                        <div className="flex flex-col items-end">
                          <span className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
                            {v.saleType === "PACK" ? "Nb paquet" : "Qté"}
                          </span>
                          <input
                            type="number"
                            min={0}
                            value={cfg.qty}
                            onChange={(e) => updateConfig(v.id, "qty", Math.max(0, parseInt(e.target.value) || 0))}
                            className="w-16 mt-1 px-2 py-1.5 rounded-lg border border-slate-200 text-sm tabular-nums text-center focus:outline-none focus:ring-2 focus:ring-sky-200"
                          />
                        </div>
                        <div className="flex flex-col items-end">
                          <span className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Prix €</span>
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            value={cfg.price}
                            onChange={(e) => updateConfig(v.id, "price", Math.max(0, parseFloat(e.target.value) || 0))}
                            className="w-20 mt-1 px-2 py-1.5 rounded-lg border border-slate-200 text-sm tabular-nums text-right focus:outline-none focus:ring-2 focus:ring-sky-200"
                          />
                        </div>
                        <div className="flex flex-col items-end w-24">
                          <span className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Total</span>
                          <span
                            className={`mt-1 text-sm tabular-nums font-semibold ${isActive ? "text-slate-900" : "text-slate-400"}`}
                          >
                            {fmt(lineTotal)}
                          </span>
                          {v.saleType === "PACK" && isActive && (
                            <span className="text-[10px] text-slate-400">
                              soit {cfg.qty * perPack} unités
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {overBudget && (
                <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
                  La sélection ({fmt(grandTotal)}) dépasse le budget disponible ({fmt(headroom)}).
                </p>
              )}
            </div>
          )}
        </div>

        {/* Footer sticky : bouton d'ajout groupé */}
        {product && (
          <div className="px-6 py-4 border-t border-slate-100 bg-white flex items-center justify-end gap-2 shrink-0">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-slate-200 text-sm text-slate-700 hover:bg-slate-50"
            >
              Annuler
            </button>
            <button
              onClick={handleAddBulk}
              disabled={pending || selectedVariants.length === 0 || overBudget}
              className="inline-flex items-center gap-2 bg-slate-900 text-white text-sm font-medium px-5 py-2 rounded-xl hover:bg-slate-800 disabled:opacity-40"
            >
              {pending
                ? "Ajout…"
                : selectedVariants.length === 0
                ? "Aucune variante sélectionnée"
                : `Ajouter ${selectedVariants.length} variante${selectedVariants.length > 1 ? "s" : ""}`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
