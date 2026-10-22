"use client";

import { useState, useTransition, useMemo, useEffect } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
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
import { translateSizeName } from "@/lib/size-i18n";
import {
  downloadImageWithOverlays,
  formatPriceEuros,
  type OverlayFormat,
} from "@/lib/download-image-overlays";
import { getImageSrc } from "@/lib/image-utils";
import {
  usePersistedOverlayToggles,
  OverlayToggles,
} from "@/components/admin/products/DownloadOverlayToggles";
import ReferenceBadgePreview from "@/components/admin/products/ReferenceBadgePreview";

function slugForFile(input: string): string {
  return (
    input
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "photo"
  );
}

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
  /** Remise commerciale OFFERTE sur modification (en HT). */
  commercialGiftHT?: number;
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

/** Un paiement de la commande (initial ou complément). */
export interface OrderPaymentUI {
  id: string;
  kind: "INITIAL" | "SUPPLEMENT";
  method: "CARD" | "STRIPE_LINK" | "BANK_TRANSFER" | "PAY_ON_PICKUP" | "CREDIT" | "COMMERCIAL_GIFT";
  status: "PENDING" | "PAID" | "CANCELLED";
  amount: number;
  stripeCheckoutUrl: string | null;
  /** ISO strings pour sérialisation serveur → client. */
  stripeExpiresAt: string | null;
  paidAt: string | null;
  createdAt: string;
  note: string | null;
}

interface Props {
  orderId: string;
  readOnly: boolean;
  items: OrderItemView[];
  modifications: OrderModification[];
  totals: OrderTotals;
  colorMap: Record<string, ColorInfo>;
  /** Historique des paiements (initial + compléments). */
  payments?: OrderPaymentUI[];
  /**
   * Coordonnées de virement de la boutique (null si virement désactivé) —
   * requis pour afficher l'IBAN sous la ligne « Reste à régler » quand la
   * cliente a choisi virement.
   */
  bankInfo?: { holder: string; iban: string; reference: string } | null;
  /**
   * Mapping ref → URL cliquable de la fiche produit. Fourni par la page
   * (client → /{locale}/produits/{handle}, admin → /admin/produits/ref/{ref}).
   * Si absent, la ref reste affichée en texte simple.
   */
  productLinks?: Record<string, string>;
}

/* ================================================================== */
/*  Helpers                                                            */
/* ================================================================== */

const fmt = (n: number) => n.toFixed(2).replace(".", ",") + " €";


/**
 * Rend la référence produit — cliquable (lien vers la fiche produit ou vers
 * la page « supprimé » selon le contexte) quand `productLinks[ref]` est
 * fourni par la page parent, sinon en texte simple.
 */
function ProductRefLabel({
  refValue,
  productLinks,
  className,
}: {
  refValue: string;
  productLinks: Record<string, string> | undefined;
  className: string;
}) {
  const href = productLinks?.[refValue];
  if (href) {
    return (
      <a
        href={href}
        className={`${className} hover:text-sky-600 hover:underline underline-offset-2 transition-colors`}
        title="Voir la fiche produit"
      >
        {refValue}
      </a>
    );
  }
  return <span className={className}>{refValue}</span>;
}

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

function sizeLabel(
  item: OrderItemView,
  translateSize?: (name: string) => string,
): string {
  const translate = translateSize ?? ((s: string) => s);
  const parsed = parseSizes(item.sizesJson);
  if (parsed && parsed.length > 0) {
    return parsed.map((s) => `${translate(s.name)} × ${s.quantity}`).join(" · ");
  }
  if (item.saleType === "PACK" && item.packQty) {
    return `Pack × ${item.packQty}`;
  }
  return translate(item.size?.trim() || "TU");
}

function makeSizeTranslator(t: (k: string) => string): (name: string) => string {
  const oneSizeLabel = t("sizeOneSize");
  return (name: string) => translateSizeName(name, oneSizeLabel);
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
  payments,
  bankInfo,
  productLinks,
}: Props) {
  const toast = useToast();
  const { confirm } = useConfirm();
  const [pending, startTransition] = useTransition();
  const t = useTranslations("orderContent");

  const paymentsList = payments ?? [];

  const [mode, setMode] = useState<"view" | "edit">("view");
  const [edits, setEdits] = useState<Record<string, { qty: number; price: number }>>({});
  const [showAdd, setShowAdd] = useState(false);
  const [giftPending, setGiftPending] = useState(false);
  const [zoomImage, setZoomImage] = useState<{
    src: string;
    alt: string;
    priceEuros: number | null;
    baseName: string;
    reference: string | null;
  } | null>(null);

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
    const compensationCount = items.filter((i) => i.isCompensation).length;
    let alsoRemoveCompensations = compensationCount > 0;

    const ok = await confirm({
      title: "Rétablir la commande d'origine",
      message:
        compensationCount > 0
          ? "Les ajustements de quantité et de prix seront annulés. Choisissez si les articles ajoutés doivent eux aussi être retirés."
          : "Toutes les modifications sur les articles seront annulées. Continuer ?",
      confirmLabel: "Tout rétablir",
      cancelLabel: "Annuler",
      checkbox:
        compensationCount > 0
          ? {
              label: `Retirer aussi les ${compensationCount} article${compensationCount > 1 ? "s" : ""} ajouté${compensationCount > 1 ? "s" : ""}`,
              defaultChecked: true,
              onChange: (checked) => {
                alsoRemoveCompensations = checked;
              },
            }
          : undefined,
    });
    if (!ok) return;

    startTransition(async () => {
      const res = await revertAllOrderItemModifications(orderId, { alsoRemoveCompensations });
      if (res.success) {
        toast.success("Modifications annulées.");
        exitEdit();
      } else {
        toast.error(res.error ?? "Erreur");
      }
    });
  }

  // Portion ITEMS du code promo (snapshot checkout) à déduire du HT en direct.
  // Si le code portait sur la livraison (scope SHIPPING), la remise est déjà
  // incluse dans `carrierPrice` ; sinon on prend `promoDiscount` (= itemsSaved).
  // Fallback historique sans snapshot : on applique `promoDiscount` tel quel.
  const promoItemsDiscount = useMemo(() => {
    const total = Number(totals.promoDiscount ?? 0);
    if (!(total > 0)) return 0;
    const codeEntry = totals.appliedPromotions?.find((p) => p.kind === "CODE");
    if (codeEntry && codeEntry.scope === "SHIPPING") return 0;
    return total;
  }, [totals.promoDiscount, totals.appliedPromotions]);

  // Aperçu du sous-total HT NET (mode édition) — inclut la remise ligne persistée.
  // item.unitPrice EST DÉJÀ le prix après promotions AUTO (snapshot checkout) ;
  // les remises globales (commerciale client, code promo items, dépassement
  // offert) sont déduites ici en direct depuis les champs figés sur la commande.
  // On ne lit PLUS totals.currentSubtotalHT (BDD potentiellement figée sous
  // l'ancien Math.floor → 1 ct de moins que le calcul Sage). Le recalcul
  // arrondi Sage (roundCent) reproduit exactement la facture Sage 50.
  const previewSubtotalHT = useMemo(() => {
    let discountable = 0;
    let compensation = 0;
    items.forEach((it) => {
      const q = it.isCompensation
        ? it.quantity
        : mode === "edit"
          ? edits[it.id]?.qty ?? it.quantity
          : it.quantity;
      const p = it.isCompensation
        ? it.unitPrice
        : mode === "edit"
          ? edits[it.id]?.price ?? it.unitPrice
          : it.unitPrice;
      const lineDisc = Number(it.lineDiscountAmt ?? 0);
      const lineHT = Math.max(0, q * p - lineDisc);
      if (it.isCompensation) compensation += lineHT;
      else discountable += lineHT;
    });
    // Remise commerciale : on garde le montant persisté (déjà recomputé par
    // le serveur à la dernière modif) plutôt que de le recalculer ici — évite
    // de re-diverger si la config de remise change entre-temps.
    const discountableRounded = roundCent(discountable);
    const compensationRounded = roundCent(compensation);
    const netAfterDiscount = Math.max(
      0,
      roundCent(discountableRounded - Number(totals.clientDiscountAmt)),
    );
    // Code promo items (snapshot figé) — clampé pour ne jamais rendre le net négatif.
    const netAfterPromoCode = Math.max(
      0,
      roundCent(netAfterDiscount - Math.min(netAfterDiscount, promoItemsDiscount)),
    );
    const beforeGift = roundCent(netAfterPromoCode + compensationRounded);
    // Dépassement offert (champ dédié) — vient en déduction supplémentaire
    // pour aligner le total sur l'encaissé après ajout d'articles.
    const giftHT = Math.max(0, Number(totals.commercialGiftHT ?? 0));
    return Math.max(0, roundCent(beforeGift - giftHT));
  }, [mode, edits, items, totals.clientDiscountAmt, totals.commercialGiftHT, promoItemsDiscount]);

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
  // On s'appuie uniquement sur les traces explicites (OrderItemModification
  // ou lignes isCompensation). On NE compare PAS le brut payé au brut recomposé
  // live : après la migration arrondi Sage (2026-09-01), les vieilles commandes
  // ont un subtotalBrutHT figé sous Math.floor qui peut différer d'1 ct du
  // même calcul en roundCent — faux positif visuel.
  const hasBeenModified =
    modifications.length > 0 ||
    items.some((i) => i.isCompensation);

  // Snapshots de l'état payé (reconstruits depuis les champs figés en BDD).
  const paidBrutHT = subHTGross;
  const paidNetHT = totals.paidSubtotalHT;
  const paidClientDiscount = roundCent(paidBrutHT - paidNetHT);
  const paidTvaAmount = roundCent((paidNetHT + carrier) * totals.tvaRate);

  const paidTTC = totals.paidTotalTTC;
  const credit = Math.max(0, roundCent(paidTTC - totalTTC));
  const remainingToPay = Math.max(0, roundCent(totalTTC - paidTTC));

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
              {t("orderContentEyebrow")}
            </p>
            <h2 className="font-heading text-lg font-semibold text-slate-900">{t("orderedItems")}</h2>
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
            Mode édition — ajustez les quantités, les prix, ou ajoutez un article. Un bloc en bas récapitule
            le reste à régler ou l'avoir à rembourser.
          </span>
        </div>
      )}

      {mode === "edit" && (
        <div className="px-5 sm:px-6 py-3 border-b border-amber-200 bg-amber-50/60 flex items-center justify-between gap-3 flex-wrap">
          <p className="text-xs text-slate-600">
            {remainingToPay > 0.01 ? (
              <>
                Reste à régler : <b className="text-rose-700 tabular-nums">{fmt(remainingToPay)}</b>
              </>
            ) : credit > 0.01 ? (
              <>
                Avoir à rembourser : <b className="text-emerald-700 tabular-nums">{fmt(credit)}</b>
              </>
            ) : (
              <>Total aligné sur le montant payé.</>
            )}
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
                <th className="text-left px-4 py-3 w-16">{t("thImage")}</th>
                <th className="text-left px-2 py-3 w-24">{t("thRef")}</th>
                <th className="text-left px-2 py-3 w-40">{t("thColor")}</th>
                <th className="text-left px-2 py-3 w-28">{t("thSize")}</th>
                <th className="text-center px-2 py-3 w-28">{t("thQty")}</th>
                <th className="text-right px-2 py-3 w-28">{t("thUnitPrice")}</th>
                <th className="text-right px-2 py-3 w-28">{t("thTotalHT")}</th>
                <th className="text-right px-2 py-3 w-24">{t("thDiscount")}</th>
                <th className="text-right px-2 py-3 w-28">{t("thTotalRow")}</th>
                <th className="text-right px-4 py-3 w-28">{t("thTotalTTC")}</th>
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
                  productLinks={productLinks}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ─────────── Cartes mobile / tablette ─────────── */}
      {items.length > 0 && (
        <div className="lg:hidden">
          {groups.map((g, gi) => {
            const groupQty = g.colorGroups.reduce((s, cg) => {
              for (const it of cg.items) {
                const q = mode === "edit" ? edits[it.id]?.qty ?? it.quantity : it.quantity;
                s += q;
              }
              return s;
            }, 0);
            return (
            <div key={g.ref + "-m-" + gi} className="border-b border-slate-100 last:border-b-0">
              <div className="px-4 py-3 bg-gradient-to-r from-sky-50/70 to-transparent border-l-4 border-sky-400">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <p className="font-heading text-base font-semibold text-slate-900">{g.name}</p>
                  <p className="text-xs text-slate-500 font-mono">
                    <ProductRefLabel refValue={g.ref} productLinks={productLinks} className="text-slate-500" />
                  </p>
                  <span className="ml-auto inline-flex items-center gap-1.5 bg-white border border-sky-200 rounded-full px-2.5 py-0.5 text-xs font-semibold text-sky-800 tabular-nums">
                    Qté totale {groupQty}
                  </span>
                </div>
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
          );
          })}
        </div>
      )}

      {mode === "edit" && (modifications.length > 0 || items.some((i) => i.isCompensation)) && (
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
            {t("totalsEyebrow")}
          </p>
          <h2 className="font-heading text-lg font-semibold text-slate-900">{t("orderSummary")}</h2>
        </div>
      </div>

      <div className="px-5 sm:px-6 py-5 bg-slate-50/60">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
          <SummaryTile label={t("tileModels")} value={totalModels.toString()} />
          <SummaryTile label={t("tileTotalQty")} value={totalUnits.toString()} />
          <SummaryTile label={t("tileTotalHT")} value={fmt(subHTNet)} />
          <SummaryTile label={t("tileTotalTTC")} value={fmt(totalTTC)} accent="sky" />
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 space-y-4 text-sm">
          {/* ═════ BLOC 1 : Promotion ═════ */}
          <div className="space-y-2">
            <SummaryLine
              label={t("productsSubtotalHT")}
              value={fmt(currentBrutHT)}
              oldValue={hasBeenModified ? fmt(paidBrutHT) : undefined}
            />

            {promoTotal > 0 && (
              <SummaryLine
                label={t("promotions")}
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
                        {p.kind === "CODE" ? t("badgeCode") : t("badgeAuto")}
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
                label={t("totalAfterPromo")}
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
                label={t("clientDiscount")}
                value={`− ${fmt(clientDiscount)}`}
                oldValue={hasBeenModified ? `− ${fmt(paidClientDiscount)}` : undefined}
                valueColor="text-emerald-700"
              />
              <SummaryLine
                label={t("totalAfterClientDiscount")}
                value={fmt(subHTNet)}
                oldValue={hasBeenModified ? fmt(paidNetHT) : undefined}
                bold
                separatorTop
              />
            </div>
          )}

          {/* ═════ BLOC 3 : Remise commerciale OFFERTE sur modification ═════ */}
          {Number(totals.commercialGiftHT ?? 0) > 0 && (
            <div className="space-y-2 pt-3 border-t border-dashed border-slate-200">
              <CommercialGiftLine
                orderId={orderId}
                giftHT={Number(totals.commercialGiftHT)}
                readOnly={readOnly}
              />
            </div>
          )}

          {/* ═════ Frais de port (2 blocs) + TVA + TTC ═════ */}
          <div className="space-y-4 pt-3 border-t border-slate-100">
            {/* Livraison — bloc 1 promo */}
            <div className="space-y-2">
              <SummaryLine
                label={`${t("shippingLine")}${totals.carrierName ? ` (${totals.carrierName})` : ""}`}
                value={totals.carrierBasePrice === 0 ? t("shippingFree") : fmt(totals.carrierBasePrice)}
              />
              {totals.carrierPromoDiscount > 0 && (
                <>
                  <SummaryLine
                    label={t("shippingPromo")}
                    value={`− ${fmt(totals.carrierPromoDiscount)}`}
                    valueColor="text-emerald-700"
                  />
                  <SummaryLine
                    label={t("shippingAfterPromo")}
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
                  label={t("shippingClientDiscount")}
                  value={
                    totals.carrierPrice === 0
                      ? t("shippingOffered")
                      : `− ${fmt(totals.carrierClientDiscount)}`
                  }
                  valueColor="text-emerald-700"
                />
                <SummaryLine
                  label={t("shippingAfterClient")}
                  value={totals.carrierPrice === 0 ? t("shippingFree") : fmt(totals.carrierPrice)}
                  bold
                  separatorTop
                />
              </div>
            )}

            <SummaryLine
              label={t("vatProducts", {
                rate: totals.tvaRate === 0 ? t("vatExempt") : `${Math.round(totals.tvaRate * 100)} %`,
              })}
              value={fmt(tvaProducts)}
              oldValue={
                hasBeenModified
                  ? fmt(roundCent(paidNetHT * totals.tvaRate))
                  : undefined
              }
            />
            <SummaryLine
              label={t("vatShipping", {
                rate: totals.tvaRate === 0 ? t("vatExempt") : `${Math.round(totals.tvaRate * 100)} %`,
              })}
              value={fmt(tvaShipping)}
            />

            <div className="flex justify-between items-baseline gap-3 border-t-2 border-slate-900 pt-3 mt-2">
              <span className="font-heading text-base font-semibold text-slate-900">{t("totalTTC")}</span>
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

          {credit > 0.01 && (
            <div className="flex justify-between items-center text-sm text-rose-800 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
              <span className="font-semibold">{t("creditToRefund")}</span>
              <span className="font-bold tabular-nums">{fmt(credit)}</span>
            </div>
          )}

          {remainingToPay > 0.01 && (
            <RemainingToPayBlock
              orderId={orderId}
              remainingToPay={remainingToPay}
              tvaRate={totals.tvaRate}
              readOnly={readOnly}
              giftPending={giftPending}
              setGiftPending={setGiftPending}
              bankInfo={bankInfo ?? null}
              pendingSupplement={(() => {
                const found = paymentsList.find(
                  (p) => p.kind === "SUPPLEMENT" && p.status === "PENDING",
                );
                return found
                  ? {
                      method: found.method,
                      stripeCheckoutUrl: found.stripeCheckoutUrl,
                    }
                  : null;
              })()}
            />
          )}
        </div>
      </div>
    </section>

    {paymentsList.filter((p) => p.status !== "CANCELLED").length > 0 && (
      <PaymentHistoryStripeCard
        orderId={orderId}
        payments={paymentsList}
        paidTTC={paidTTC}
        readOnly={readOnly}
      />
    )}

    {zoomImage && (
      <ImageZoomOverlay
        src={zoomImage.src}
        alt={zoomImage.alt}
        priceEuros={zoomImage.priceEuros}
        baseName={zoomImage.baseName}
        reference={zoomImage.reference}
        onClose={() => setZoomImage(null)}
      />
    )}
  </>
  );
}

/* ================================================================== */
/*  Historique des paiements (initial + compléments)                   */
/* ================================================================== */

const PAYMENT_METHOD_LABELS: Record<OrderPaymentUI["method"], string> = {
  CARD: "Carte bancaire",
  STRIPE_LINK: "Lien de paiement",
  BANK_TRANSFER: "Virement bancaire",
  PAY_ON_PICKUP: "Au retrait",
  CREDIT: "Avoir",
  COMMERCIAL_GIFT: "Dépassement offert",
};

const PAYMENT_STATUS_CFG: Record<
  OrderPaymentUI["status"],
  { label: string; className: string }
> = {
  PAID: { label: "Encaissé", className: "bg-emerald-100 text-emerald-800" },
  PENDING: { label: "En attente", className: "bg-amber-100 text-amber-800" },
  CANCELLED: { label: "Annulé", className: "bg-slate-100 text-slate-500" },
};

function formatDateTime(iso: string | null): string | null {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleString("fr-FR", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return null;
  }
}

/**
 * Carte dédiée affichant l'historique Stripe/virement d'une commande : chaque
 * paiement en ligne avec date, méthode, statut et montant ; en bas, le total
 * cumulé des encaissements. Les paiements CANCELLED sont masqués.
 */
function PaymentHistoryStripeCard({
  orderId,
  payments,
  paidTTC,
  readOnly,
}: {
  orderId: string;
  payments: OrderPaymentUI[];
  paidTTC: number;
  readOnly: boolean;
}) {
  // Masque les paiements annulés + les remises commerciales offertes (celles-ci
  // apparaissent déjà en ligne dédiée dans le récap commande et ne sont pas
  // des encaissements client).
  const visible = payments.filter(
    (p) => p.status !== "CANCELLED" && p.method !== "COMMERCIAL_GIFT",
  );
  if (visible.length === 0) return null;

  return (
    <section className="bg-white border border-slate-200 rounded-2xl overflow-hidden mt-6">
      <div className="px-5 sm:px-6 py-4 border-b border-slate-100 flex items-center gap-3">
        <div className="w-1 h-8 bg-indigo-500 rounded-full" />
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-indigo-700">
            Paiements
          </p>
          <h2 className="font-heading text-lg font-semibold text-slate-900">
            Historique Paiement
          </h2>
        </div>
      </div>

      <ul className="divide-y divide-slate-100">
        {visible.map((p) => (
          <li key={p.id} className="px-5 sm:px-6 py-3">
            <PaymentRow payment={p} readOnly={readOnly} orderId={orderId} />
          </li>
        ))}
      </ul>

      <div className="px-5 sm:px-6 py-4 border-t border-slate-200 bg-slate-50/60 flex items-center justify-between">
        <span className="text-xs uppercase tracking-wider font-semibold text-slate-600">
          Total encaissé par le client
        </span>
        <span className="font-heading text-xl font-bold text-slate-900 tabular-nums">
          {fmt(paidTTC)}
        </span>
      </div>
    </section>
  );
}

function PaymentRow({
  payment,
  readOnly,
  orderId,
}: {
  payment: OrderPaymentUI;
  readOnly: boolean;
  orderId: string;
}) {
  const toast = useToast();
  const { confirm } = useConfirm();
  const [pending, startTransition] = useTransition();

  const dateLabel = formatDateTime(payment.paidAt) ?? formatDateTime(payment.createdAt);
  const kindLabel = payment.kind === "INITIAL" ? "Paiement initial" : "Complément";
  const statusCfg = PAYMENT_STATUS_CFG[payment.status];
  const methodLabel = PAYMENT_METHOD_LABELS[payment.method];
  const isPendingTransfer =
    payment.status === "PENDING" && payment.method === "BANK_TRANSFER";
  const isPendingLink = payment.status === "PENDING" && payment.method === "STRIPE_LINK";

  async function handleMarkPaid() {
    if (readOnly) return;
    const ok = await confirm({
      type: "info",
      title: "Marquer ce virement comme reçu ?",
      message: `Le montant de ${fmt(payment.amount)} sera considéré comme encaissé.`,
      confirmLabel: "Confirmer la réception",
      cancelLabel: "Annuler",
    });
    if (!ok) return;
    startTransition(async () => {
      const { markOrderPaymentReceived } = await import(
        "@/app/actions/admin/order-supplement"
      );
      const res = await markOrderPaymentReceived(orderId, payment.id);
      if (res.success) toast.success("Paiement marqué reçu.");
      else toast.error(res.error ?? "Erreur");
    });
  }

  async function handleCancel() {
    if (readOnly) return;
    const ok = await confirm({
      type: "warning",
      title: "Annuler ce paiement en attente ?",
      message:
        payment.method === "STRIPE_LINK"
          ? "Le lien de paiement sera désactivé pour la cliente."
          : "Le virement attendu sera marqué comme annulé.",
      confirmLabel: "Annuler le paiement",
      cancelLabel: "Garder",
    });
    if (!ok) return;
    startTransition(async () => {
      const { cancelOrderPayment } = await import(
        "@/app/actions/admin/order-supplement"
      );
      const res = await cancelOrderPayment(orderId, payment.id);
      if (res.success) toast.success("Paiement annulé.");
      else toast.error(res.error ?? "Erreur");
    });
  }

  return (
    <div
      className={`flex items-center justify-between gap-3 text-xs rounded-lg px-3 py-2 border ${
        payment.status === "CANCELLED"
          ? "bg-slate-50/60 border-slate-200 opacity-70"
          : "bg-white border-slate-200"
      }`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-slate-800">{methodLabel}</span>
          <span
            className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${statusCfg.className}`}
          >
            {statusCfg.label}
          </span>
          <span className="text-[10px] text-slate-400">· {kindLabel}</span>
        </div>
        <div className="text-[11px] text-slate-500 mt-0.5">
          {dateLabel ?? "—"}
          {payment.note ? ` · ${payment.note}` : ""}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span
          className={`font-semibold tabular-nums ${
            payment.status === "CANCELLED"
              ? "text-slate-400 line-through"
              : "text-slate-900"
          }`}
        >
          {fmt(payment.amount)}
        </span>
        {!readOnly && isPendingTransfer && (
          <button
            type="button"
            onClick={handleMarkPaid}
            disabled={pending}
            className="bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-medium px-2.5 py-1 rounded-lg disabled:opacity-40"
          >
            Marquer reçu
          </button>
        )}
        {!readOnly && (isPendingTransfer || isPendingLink) && (
          <button
            type="button"
            onClick={handleCancel}
            disabled={pending}
            className="text-rose-700 hover:text-rose-900 text-[11px] underline underline-offset-2 disabled:opacity-40"
          >
            Annuler
          </button>
        )}
      </div>
    </div>
  );
}

/* ================================================================== */
/*  Ligne « Remise commerciale sur modification » (dans le résumé)      */
/* ================================================================== */

function CommercialGiftLine({
  orderId,
  giftHT,
  readOnly,
}: {
  orderId: string;
  giftHT: number;
  readOnly: boolean;
}) {
  const toast = useToast();
  const router = useRouter();
  const { confirm } = useConfirm();
  const [pending, startTransition] = useTransition();

  async function handleCancel() {
    const ok = await confirm({
      type: "warning",
      title: "Annuler le dépassement offert ?",
      message: `Les ${fmt(giftHT)} HT seront remis dans le total de la commande. La cliente pourra à nouveau régler cette différence.`,
      confirmLabel: "Annuler l'offre",
      cancelLabel: "Garder l'offre",
    });
    if (!ok) return;
    startTransition(async () => {
      const { cancelOvershootDiscount } = await import(
        "@/app/actions/admin/order-supplement"
      );
      const res = await cancelOvershootDiscount(orderId);
      if (res.success) {
        toast.success("Dépassement offert annulé.");
        router.refresh();
      } else {
        toast.error(res.error ?? "Erreur");
      }
    });
  }

  return (
    <div className="flex items-baseline justify-between gap-3 text-slate-600">
      <div className="flex items-center gap-2 flex-wrap">
        <span>Dépassement offert</span>
        {!readOnly && (
          <button
            type="button"
            onClick={handleCancel}
            disabled={pending}
            className="text-[10px] text-rose-700 hover:text-rose-900 underline underline-offset-2 disabled:opacity-40"
          >
            {pending ? "Annulation…" : "Annuler l'offre"}
          </button>
        )}
      </div>
      <span className="tabular-nums font-medium text-emerald-700">
        − {fmt(giftHT)}
      </span>
    </div>
  );
}

/* ================================================================== */
/*  Bloc « Reste à régler » (dans le résumé commande)                   */
/* ================================================================== */

function RemainingToPayBlock({
  orderId,
  remainingToPay,
  tvaRate,
  readOnly,
  giftPending,
  setGiftPending,
  bankInfo,
  pendingSupplement,
}: {
  orderId: string;
  remainingToPay: number;
  tvaRate: number;
  readOnly: boolean;
  giftPending: boolean;
  setGiftPending: (v: boolean) => void;
  bankInfo: { holder: string; iban: string; reference: string } | null;
  pendingSupplement: {
    method: OrderPaymentUI["method"];
    stripeCheckoutUrl: string | null;
  } | null;
}) {
  const toast = useToast();
  const router = useRouter();
  const { confirm } = useConfirm();
  const [choosing, setChoosing] = useState<"STRIPE_LINK" | "BANK_TRANSFER" | null>(null);
  const [pending, startTransition] = useTransition();
  const [stripeCheckout, setStripeCheckout] = useState<{
    clientSecret: string;
    publishableKey: string;
    amountLabel: string;
  } | null>(null);
  const [CheckoutModal, setCheckoutModal] = useState<null | React.ComponentType<{
    clientSecret: string;
    publishableKey: string;
    amountLabel: string;
    onClose: () => void;
  }>>(null);

  function pickMethod(method: "STRIPE_LINK" | "BANK_TRANSFER") {
    setChoosing(method);
    startTransition(async () => {
      const { requestSupplementPayment } = await import(
        "@/app/actions/client/order-supplement"
      );
      const res = await requestSupplementPayment(orderId, method);
      setChoosing(null);
      if (!res.success) {
        toast.error(res.error ?? "Erreur");
        return;
      }
      if (method === "STRIPE_LINK" && res.clientSecret && res.publishableKey) {
        // Charge dynamiquement le composant <SupplementCheckoutModal /> (évite
        // d'embarquer @stripe/stripe-js dans le bundle initial si la cliente
        // n'ouvre jamais le paiement).
        const mod = await import(
          "@/components/client/orders/SupplementCheckoutModal"
        );
        setCheckoutModal(() => mod.default);
        setStripeCheckout({
          clientSecret: res.clientSecret,
          publishableKey: res.publishableKey,
          amountLabel: fmt(remainingToPay),
        });
      } else if (method === "BANK_TRANSFER") {
        toast.success("Mode enregistré. Les coordonnées de virement sont affichées.");
        router.refresh();
      }
    });
  }

  async function changeMethod() {
    const ok = await confirm({
      type: "info",
      title: "Changer de mode de règlement ?",
      message: "L'option actuelle sera annulée. Vous pourrez en choisir une autre.",
      confirmLabel: "Changer",
      cancelLabel: "Garder",
    });
    if (!ok) return;
    startTransition(async () => {
      const { cancelMySupplementPayment } = await import(
        "@/app/actions/client/order-supplement"
      );
      const res = await cancelMySupplementPayment(orderId);
      if (res.success) router.refresh();
      else toast.error(res.error ?? "Erreur");
    });
  }

  // Décomposition HT / TVA / TTC pour l'affichage.
  const amountTTC = remainingToPay;
  const amountHT = roundCent(amountTTC / (1 + (tvaRate ?? 0)));
  const ratePct = Math.round((tvaRate ?? 0) * 100);
  const vatLabel = tvaRate === 0 ? "exonéré" : `${ratePct}%`;
  const amountStr = `${fmt(amountTTC)} TTC`;
  const amountHint = `${fmt(amountHT)} HT · TVA ${vatLabel}`;
  const showClientChoices = readOnly;

  return (
    <div className="text-sm text-sky-900 bg-sky-50 border border-sky-200 rounded-lg px-3 py-2">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex flex-col">
          <span className="font-semibold">Reste à régler</span>
          <span className="text-[10px] text-sky-700 font-normal tabular-nums">
            {amountHint}
          </span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-bold tabular-nums">{amountStr}</span>

          {/* Côté cliente (readOnly) : 2 boutons directs — un clic « Par carte »
              ouvre le checkout embedded dans une modale (comme le panier). */}
          {showClientChoices && (!pendingSupplement || pendingSupplement.method === "STRIPE_LINK") && (
            <>
              <button
                type="button"
                onClick={() => pickMethod("STRIPE_LINK")}
                disabled={pending}
                className="bg-slate-900 hover:bg-black text-white text-xs font-medium px-3 py-1.5 rounded-lg shrink-0 disabled:opacity-40"
              >
                {choosing === "STRIPE_LINK" ? "Préparation…" : "Par carte"}
              </button>
              <button
                type="button"
                onClick={() => pickMethod("BANK_TRANSFER")}
                disabled={pending}
                className="bg-white border border-slate-300 hover:border-slate-400 text-slate-900 text-xs font-medium px-3 py-1.5 rounded-lg shrink-0 disabled:opacity-40"
              >
                {choosing === "BANK_TRANSFER" ? "Enregistrement…" : "Par virement"}
              </button>
            </>
          )}

          {showClientChoices &&
            pendingSupplement &&
            pendingSupplement.method === "BANK_TRANSFER" && (
              <button
                type="button"
                onClick={changeMethod}
                disabled={pending}
                className="text-[11px] text-slate-600 underline underline-offset-2 hover:text-slate-900"
              >
                Changer pour une carte
              </button>
            )}

          {/* Côté admin : bouton « Offrir » */}
          {!readOnly && (
            <button
              type="button"
              disabled={giftPending}
              onClick={async () => {
                const ok = await confirm({
                  type: "info",
                  title: "Offrir ce dépassement ?",
                  message: `Le dépassement de ${amountStr} sera absorbé par la boutique : la cliente ne devra plus rien régler.`,
                  confirmLabel: "Offrir le dépassement",
                  cancelLabel: "Annuler",
                });
                if (!ok) return;
                setGiftPending(true);
                try {
                  const { applyOvershootAsDiscount } = await import(
                    "@/app/actions/admin/order-supplement"
                  );
                  const res = await applyOvershootAsDiscount(orderId);
                  if (res.success) {
                    toast.success("Dépassement offert.");
                    router.refresh();
                  } else {
                    toast.error(res.error ?? "Erreur");
                  }
                } finally {
                  setGiftPending(false);
                }
              }}
              className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium px-3 py-1.5 rounded-lg shrink-0 disabled:opacity-40"
            >
              Offrir ce dépassement
            </button>
          )}
        </div>
      </div>

      {/* Coordonnées IBAN affichées directement sous la ligne si virement choisi */}
      {showClientChoices &&
        pendingSupplement &&
        pendingSupplement.method === "BANK_TRANSFER" && (
          <div className="mt-3 bg-white border border-sky-200 rounded-lg p-3 text-slate-800 text-xs space-y-1">
            {bankInfo ? (
              <>
                <p>
                  <span className="text-slate-500">Titulaire :</span>{" "}
                  <b>{bankInfo.holder}</b>
                </p>
                <p>
                  <span className="text-slate-500">IBAN :</span>{" "}
                  <span className="font-mono tracking-widest break-all">
                    {bankInfo.iban}
                  </span>
                </p>
                <p>
                  <span className="text-slate-500">Référence à indiquer :</span>{" "}
                  <span className="font-mono">Complément {bankInfo.reference}</span>
                </p>
                <p>
                  <span className="text-slate-500">Montant exact :</span>{" "}
                  <b className="tabular-nums">{amountStr}</b>
                </p>
              </>
            ) : (
              <p className="text-rose-700">
                Coordonnées IBAN indisponibles. Contactez la boutique.
              </p>
            )}
          </div>
        )}

      {/* Modale paiement intégré (Stripe EmbeddedCheckout) */}
      {stripeCheckout && CheckoutModal && (
        <CheckoutModal
          clientSecret={stripeCheckout.clientSecret}
          publishableKey={stripeCheckout.publishableKey}
          amountLabel={stripeCheckout.amountLabel}
          onClose={() => setStripeCheckout(null)}
        />
      )}
    </div>
  );
}

/* ================================================================== */
/*  Overlay de zoom image                                              */
/* ================================================================== */

function ImageZoomOverlay({
  src,
  alt,
  priceEuros,
  baseName,
  reference,
  onClose,
}: {
  src: string;
  alt: string;
  priceEuros: number | null;
  baseName: string;
  reference: string | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const toggles = usePersistedOverlayToggles();
  const [busyFormat, setBusyFormat] = useState<OverlayFormat | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const trimmedRef = typeof reference === "string" ? reference.trim() : "";
  const effectivePrice = toggles.showPrice ? priceEuros : null;
  const effectiveReference = toggles.showReference && trimmedRef.length > 0 ? trimmedRef : null;
  const showStamp = toggles.showOutOfStock;
  const hasPrice =
    effectivePrice !== null &&
    effectivePrice !== undefined &&
    Number.isFinite(effectivePrice);
  const hasReference = effectiveReference !== null;

  async function handleDownload(format: OverlayFormat) {
    if (busyFormat) return;
    setBusyFormat(format);
    try {
      await downloadImageWithOverlays(src, baseName, format, {
        priceEuros: effectivePrice,
        outOfStock: showStamp,
        reference: effectiveReference,
      });
    } catch {
      toast.error(
        "Téléchargement impossible",
        "Impossible de convertir cette image dans ce format.",
      );
    } finally {
      setBusyFormat(null);
    }
  }

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
        {showStamp && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden rounded-xl">
            <span
              className="font-black uppercase tracking-wider"
              style={{
                color: "#DC2626",
                fontSize: "clamp(14px, 3.5vw, 36px)",
                transform: "rotate(-25deg)",
                opacity: 0.55,
                WebkitTextStroke: "1px rgba(255,255,255,0.9)",
                textShadow: "0 1px 2px rgba(0,0,0,0.25)",
                whiteSpace: "nowrap",
              }}
            >
              Rupture de stock
            </span>
          </div>
        )}
        {hasPrice && (
          <span
            className="pointer-events-none absolute bottom-3 right-3 rounded-full bg-slate-900/90 px-3 py-1.5 text-sm font-bold text-white shadow-lg"
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            {formatPriceEuros(effectivePrice as number)}
          </span>
        )}
        {hasReference && (
          <ReferenceBadgePreview reference={effectiveReference as string} size="zoom" />
        )}
        <p className="mt-3 text-center text-white/80 text-sm">{alt}</p>
      </div>
      <div
        className="absolute left-4 bottom-4 sm:bottom-6 w-[min(320px,calc(100vw-2rem))] space-y-2"
        onClick={(e) => e.stopPropagation()}
      >
        <OverlayToggles
          variant="dark"
          showPrice={toggles.showPrice}
          showOutOfStock={toggles.showOutOfStock}
          showReference={toggles.showReference}
          onChangePrice={toggles.setShowPrice}
          onChangeOutOfStock={toggles.setShowOutOfStock}
          onChangeReference={toggles.setShowReference}
          priceEuros={priceEuros}
          reference={trimmedRef || null}
        />
        <div className="flex items-center gap-2">
          {(["webp", "png", "jpeg"] as OverlayFormat[]).map((f) => (
            <button
              key={f}
              type="button"
              disabled={!!busyFormat}
              onClick={() => handleDownload(f)}
              className="flex-1 rounded-xl bg-white/10 hover:bg-white/20 border border-white/15 px-3 py-2 text-xs font-bold text-white font-body backdrop-blur-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              title={`Télécharger en ${f.toUpperCase()}`}
            >
              {busyFormat === f ? (
                <span className="inline-flex items-center justify-center gap-1">
                  <svg className="w-3.5 h-3.5 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <circle cx="12" cy="12" r="10" strokeWidth={4} opacity="0.25" />
                    <path strokeWidth={4} d="M12 2a10 10 0 0110 10" />
                  </svg>
                  …
                </span>
              ) : (
                f.toUpperCase()
              )}
            </button>
          ))}
        </div>
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
  productLinks,
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
  onZoomImage: (img: { src: string; alt: string; priceEuros: number | null; baseName: string; reference: string | null }) => void;
  productLinks: Record<string, string> | undefined;
}) {
  const colspan = !readOnly && mode === "edit" ? 11 : 10;
  const totalVariants = group.colorGroups.reduce((s, cg) => s + cg.items.length, 0);
  const groupQty = group.colorGroups.reduce((s, cg) => {
    for (const it of cg.items) {
      const q = mode === "edit" ? edits[it.id]?.qty ?? it.quantity : it.quantity;
      s += q;
    }
    return s;
  }, 0);
  return (
    <>
      {/* Ligne header produit — bandeau bleu */}
      <tr>
        <td
          colSpan={colspan}
          className={`px-4 py-3 border-t ${gi === 0 ? "border-slate-100" : "border-slate-200"} bg-gradient-to-r from-sky-50/70 via-sky-50/20 to-transparent`}
        >
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pl-2 border-l-4 border-sky-400 -ml-2">
            <span className="font-heading text-base font-semibold text-slate-900">{group.name}</span>
            <ProductRefLabel refValue={group.ref} productLinks={productLinks} className="text-xs text-slate-500 font-mono" />
            <span className="text-xs text-slate-400">
              · {totalVariants} variante{totalVariants > 1 ? "s" : ""}
            </span>
            <span className="ml-auto inline-flex items-center gap-1.5 bg-white border border-sky-200 rounded-full px-2.5 py-0.5 text-xs font-semibold text-sky-800 tabular-nums">
              Qté totale {groupQty}
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
            productLinks={productLinks}
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
  productLinks,
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
  onZoomImage: (img: { src: string; alt: string; priceEuros: number | null; baseName: string; reference: string | null }) => void;
  productLinks: Record<string, string> | undefined;
}) {
  const t = useTranslations("orderContent");
  const translateSize = makeSizeTranslator(t);
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
              onZoomImage({
                src: item.imagePath!,
                alt: `${item.productName} — ${item.colorName}`,
                priceEuros: Number.isFinite(item.unitPrice) ? item.unitPrice : null,
                baseName: `${slugForFile(item.productRef || item.productName)}-${slugForFile(item.colorName || "")}`,
                reference: item.productRef || null,
              })
            }
            title="Agrandir l'image"
            className="w-12 h-12 rounded-lg bg-slate-100 overflow-hidden border border-slate-200 hover:ring-2 hover:ring-sky-300 focus:outline-none focus:ring-2 focus:ring-sky-400 transition"
          >
            <Image
              src={item.imagePath}
              alt={item.productName}
              width={48}
              height={48}
              unoptimized
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
        <ProductRefLabel refValue={productRef} productLinks={productLinks} className="text-xs font-mono text-slate-600" />
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
      <td className="px-2 py-3 text-sm text-slate-700">{sizeLabel(item, translateSize)}</td>

      {/* Qté (avec barré + flèche + badge Qté ajustée / Retiré si modif) */}
      <td className="px-2 py-3 text-center">
        {mode === "edit" ? (
          <QtyStepper
            value={qty}
            max={9999}
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

      {/* Prix unitaire (avec badge Prix ajusté si modif) + TTC discret dessous */}
      <td className="px-2 py-3 text-right">
        {mode === "edit" ? (
          <PriceInput
            value={price}
            max={99999}
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
            <UnitPriceTTCHint ht={price} tvaRate={tvaRate} />
            <Chip variant="info">Prix ajusté</Chip>
          </div>
        ) : (
          <div className="flex flex-col items-end">
            <span className="tabular-nums text-slate-700">{fmt(price)}</span>
            <UnitPriceTTCHint ht={price} tvaRate={tvaRate} />
          </div>
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
  onZoomImage: (img: { src: string; alt: string; priceEuros: number | null; baseName: string; reference: string | null }) => void;
}) {
  const t = useTranslations("orderContent");
  const qty = mode === "edit" ? edit?.qty ?? item.quantity : item.quantity;
  const price = mode === "edit" ? edit?.price ?? item.unitPrice : item.unitPrice;
  const discountAmt = Number(item.lineDiscountAmt ?? 0);
  const priceTotalHT = qty * price;
  const totalHT = Math.max(0, priceTotalHT - discountAmt);
  // Sage : TVA arrondie séparément puis TTC = HT + TVA.
  const lineTva = roundCent(totalHT * tvaRate);
  const totalTTC = roundCent(totalHT + lineTva);
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
          onClick={() => onZoomImage({
            src: item.imagePath!,
            alt: `${item.productName} — ${item.colorName}`,
            priceEuros: Number.isFinite(item.unitPrice) ? item.unitPrice : null,
            baseName: `${slugForFile(item.productRef || item.productName)}-${slugForFile(item.colorName || "")}`,
            reference: item.productRef || null,
          })}
          title="Agrandir l'image"
          className="w-14 h-14 rounded-lg bg-slate-100 overflow-hidden border border-slate-200 shrink-0 hover:ring-2 hover:ring-sky-300 focus:outline-none focus:ring-2 focus:ring-sky-400 transition"
        >
          <Image src={getImageSrc(item.imagePath, "thumb")} alt={item.productName} width={56} height={56} unoptimized className="w-full h-full object-cover" />
        </button>
      ) : (
        <div className="w-14 h-14 rounded-lg bg-slate-100 flex items-center justify-center text-slate-300 text-xs shrink-0">—</div>
      )}
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <ColorSwatch color={color} />
          <span className="text-sm font-medium text-slate-900">{item.colorName}</span>
          <Chip>{sizeLabel(item, makeSizeTranslator(t))}</Chip>
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
              <span className="block">
                <UnitPriceTTCHint ht={price} tvaRate={tvaRate} />
              </span>
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
            <span className="text-slate-500">{t("tileTotalHT")}</span>
            <span className="text-right tabular-nums text-slate-900 font-medium">{fmt(totalHT)}</span>
            <span className="text-slate-500">{t("tileTotalTTC")}</span>
            <span className="text-right tabular-nums text-slate-900 font-semibold">{fmt(totalTTC)}</span>
          </div>
        ) : (
          <div className="mt-2 space-y-2">
            <div className="flex items-center gap-2">
              <QtyStepper
                value={qty}
                max={9999}
                onChange={(v) => onEdit(item.id, "qty", v)}
                disabled={pending}
              />
              <span className="text-slate-300">×</span>
              <PriceInput
                value={price}
                max={99999}
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
              <span className="text-slate-500">{t("tileTotalTTC")} : </span>
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

/**
 * Affiche discrètement, sous le prix unitaire HT, le prix unitaire TTC et le
 * taux de TVA entre parenthèses (ou « exonéré » si taux = 0).
 */
function UnitPriceTTCHint({ ht, tvaRate }: { ht: number; tvaRate: number }) {
  const ttc = roundCent(ht * (1 + (tvaRate ?? 0)));
  const ratePct = Math.round((tvaRate ?? 0) * 100);
  const label = tvaRate === 0 ? "exonéré" : `${ratePct}%`;
  return (
    <span className="block text-[10px] text-slate-400 font-normal tabular-nums leading-tight">
      {fmt(ttc)} TTC ({label})
    </span>
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
  onClose,
}: {
  orderId: string;
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

  function handleAddBulk() {
    if (!product || selectedVariants.length === 0) {
      toast.error("Mettez une quantité sur au moins une variante.");
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

        {/* Résumé sélection */}
        {product && selectedVariants.length > 0 && (
          <div className="px-6 py-2.5 border-b border-slate-100 bg-slate-50/60 text-xs text-slate-600 shrink-0 flex items-center justify-end gap-3 flex-wrap">
            <span>
              Sélection : <b className="text-slate-900 tabular-nums">{fmt(grandTotal)}</b>
            </span>
          </div>
        )}

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
              disabled={pending || selectedVariants.length === 0}
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
