"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { placeOrder } from "@/app/actions/client/order";
import { placeBankTransferOrder } from "@/app/actions/client/bank-transfer-order";
import { placePaymentLinkOrder } from "@/app/actions/client/payment-link-order";
import { placeCreditOnlyOrder } from "@/app/actions/client/credit-only-order";
import { getSerializedCartForWizard } from "@/app/actions/client/cart";
import { computeCartCheckoutPricing } from "@/app/actions/client/cart-pricing";
import { resolveVatRate } from "@/lib/vat";
import type { CartValidationError } from "@/lib/cart-validation";
import { computeShippingCascade } from "@/lib/shipping-cascade";
import WizardStepper from "./wizard/WizardStepper";
import SummaryPanel from "./wizard/SummaryPanel";
import Step1CartContent from "./wizard/Step1CartContent";
import Step2DeliveryContent from "./wizard/Step2DeliveryContent";
import Step3PaymentContent from "./wizard/Step3PaymentContent";
import type {
  WizardStep,
  DeliveryMode,
  PrivateSubMode,
  WizardCart,
  WizardAddress,
  WizardCarrier,
  WizardBillingInfo,
  WizardUser,
  WizardClientDiscount,
  WizardShippingPromo,
  WizardPromoInfo,
  WizardPickupInfo,
  WizardMergeCandidate,
  WizardProductsMeta,
} from "./wizard/types";

interface Props {
  cart: WizardCart | null;
  productsMeta: WizardProductsMeta;
  addresses: WizardAddress[];
  user: WizardUser;
  clientDiscount: WizardClientDiscount;
  shippingPromos: WizardShippingPromo[];
  promoInfoByItemId: Record<string, WizardPromoInfo>;
  /** Trace cascade panier calculée serveur (promos + remise client, sans livraison). */
  cartCascade: {
    subtotalBrutHT: number;
    subtotalHT: number;
    clientDiscountAmt: number;
    subtotalAfterDiscount: number;
    discountTrace: Array<{
      label: string;
      kind: "product" | "promo" | "client";
      percent?: number;
      amount: number;
      subtotalAfter: number;
    }>;
  } | null;
  pickupInfo: WizardPickupInfo | null;
  mergeCandidates: WizardMergeCandidate[];
  minOrderHT: number;
  stripeReady: boolean;
  stripePublishableKey: string | null;
  /** Config virement bancaire du tenant. `enabled=false` → option cachée au checkout. */
  bankTransfer: {
    enabled: boolean;
    holder: string;
    /** IBAN déjà formatté "FR76 3000 …" pour affichage direct. */
    ibanDisplay: string;
  };
  /** Solde total d'avoir disponible pour la cliente (0 = pas de crédit). */
  availableCredit: number;
}

/**
 * Wizard unifié /panier (3 étapes en une seule URL).
 * Gère tout l'état partagé, les appels API (transporteurs, PaymentIntent,
 * placeOrder) et l'orchestration des sous-composants d'étape.
 */
export default function CartWizardClient({
  cart: initialCart,
  productsMeta: initialProductsMeta,
  addresses: initialAddresses,
  user,
  clientDiscount,
  shippingPromos,
  promoInfoByItemId,
  cartCascade,
  pickupInfo,
  mergeCandidates,
  minOrderHT,
  stripeReady,
  stripePublishableKey,
  bankTransfer,
  availableCredit,
}: Props) {
  const router = useRouter();
  const t = useTranslations("checkout");
  const locale = useLocale();
  const tCart = useTranslations("cart");
  const tCommon = useTranslations("common");

  // ── Étape courante
  const [currentStep, setCurrentStep] = useState<WizardStep>(1);

  // ── Erreurs de validation du panier (rupture stock / produit offline).
  //    Peuplées au clic « Procéder au paiement » (étape 2 → étape 3) via
  //    /api/cart/validate. En cas d'erreurs on renvoie sur l'étape 1 où
  //    chaque ligne fautive s'affiche en rouge avec le message adapté.
  const [validationErrors, setValidationErrors] = useState<CartValidationError[]>([]);
  const [isValidating, setIsValidating] = useState(false);

  // ── Cart local (rafraîchi après mutations)
  const [cart, setCart] = useState<WizardCart | null>(initialCart);
  const [productsMeta, setProductsMeta] = useState<WizardProductsMeta>(initialProductsMeta);

  async function refreshCart() {
    // On appelle un wrapper 100 % sérialisable (pas de Decimal Prisma dans la
    // charge utile). Le passage direct du retour de `getCartWithProductVariants`
    // à un composant client provoque une erreur React sur les Decimal.
    const { cart: fresh, productsMeta: freshMeta } = await getSerializedCartForWizard();
    setCart(fresh);
    setProductsMeta(freshMeta);
  }

  // ── Facturation (édition inline)
  const [billingInfo, setBillingInfo] = useState<WizardBillingInfo>({
    firstName: user.firstName,
    lastName:  user.lastName,
    company:   user.company,
    email:     user.email,
    phone:     user.phone,
    siret:     user.siret ?? "",
    vatNumber: user.vatNumber ?? "",
    address1:  user.addressStreet     ?? "",
    address2:  user.addressComplement ?? "",
    zipCode:   user.addressZip        ?? "",
    city:      user.addressCity       ?? "",
    country:   user.addressCountry    ?? "FR",
  });

  // ── Adresses de livraison
  const [addresses, setAddresses] = useState<WizardAddress[]>(initialAddresses);
  const [selectedAddrId, setSelectedAddrId] = useState<string | null>(
    initialAddresses.find((a) => a.isDefault)?.id ?? initialAddresses[0]?.id ?? null,
  );
  const selectedAddr = addresses.find((a) => a.id === selectedAddrId) ?? null;

  // ── Mode de livraison
  const [deliveryMode, setDeliveryMode] = useState<DeliveryMode>("delivery");
  const [selectedMergeOrderId, setSelectedMergeOrderId] = useState<string | null>(null);
  const selectedMergeOrder = mergeCandidates.find((o) => o.id === selectedMergeOrderId) ?? null;

  // ── Transporteur privé
  const [privateMode, setPrivateMode] = useState<PrivateSubMode>("contact");
  const [privateCarrierEmail, setPrivateCarrierEmail] = useState("");
  const [privateCarrierPhone, setPrivateCarrierPhone] = useState("");
  const [bordereauPath, setBordereauPath] = useState<string | null>(null);
  const [bordereauName, setBordereauName] = useState<string>("");
  const [bordereauUploading, setBordereauUploading] = useState(false);

  async function handleBordereauUpload(file: File) {
    setBordereauUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/client/private-carrier-bordereau", {
        method: "POST",
        body:   fd,
      });
      const data = await res.json();
      if (res.ok && data.path) {
        setBordereauPath(data.path);
        setBordereauName(file.name);
      }
    } finally {
      setBordereauUploading(false);
    }
  }
  function handleBordereauClear() {
    setBordereauPath(null);
    setBordereauName("");
  }

  // ── Transporteurs Easy-Express (chargés dès qu'une adresse est sélectionnée)
  const [carriers, setCarriers] = useState<WizardCarrier[]>([]);
  const [carriersLoading, setCarriersLoading] = useState(false);
  const [carriersError, setCarriersError] = useState("");
  const [noCarrierConfigured, setNoCarrierConfigured] = useState(false);
  const [selectedCarrierId, setSelectedCarrierId] = useState<string | null>(null);
  const [transactionId, setTransactionId] = useState<string>("");

  const totalWeightKg = useMemo(() => {
    if (!cart) return 0;
    return cart.items.reduce((s, item) => {
      const units = item.variant.saleType === "PACK" && item.variant.packQuantity
        ? item.variant.packQuantity * item.quantity
        : item.quantity;
      return s + item.variant.weight * units;
    }, 0);
  }, [cart]);

  const subtotalHT = useMemo(() => {
    if (!cart) return 0;
    return cart.items.reduce((s, item) => {
      const price = promoInfoByItemId[item.id]?.finalUnitPrice ?? item.variant.unitPrice;
      return s + price * item.quantity;
    }, 0);
  }, [cart, promoInfoByItemId]);

  useEffect(() => {
    if (!selectedAddr || deliveryMode !== "delivery") {
      setCarriers([]);
      setCarriersError("");
      setNoCarrierConfigured(false);
      return;
    }
    const controller = new AbortController();
    setCarriersLoading(true);
    setCarriersError("");
    setNoCarrierConfigured(false);
    setSelectedCarrierId(null);
    setTransactionId("");

    fetch("/api/carriers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        zipCode:  selectedAddr.zipCode,
        country:  selectedAddr.country,
        weightKg: totalWeightKg,
        subtotalHT,
      }),
      signal: controller.signal,
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          setCarriersError(data.error);
          setCarriers([]);
          if (data.noCarrierConfigured) setNoCarrierConfigured(true);
        } else {
          setTransactionId(data.transactionId ?? "");
          // On garde le `sig` renvoyé par /api/carriers pour le repasser à
          // create-intent (anti-fraude carrierPrice).
          setCarriers(
            (data.carriers ?? []).map((c: WizardCarrier & { sig?: string }) => ({
              id:      c.id,
              name:    c.name,
              price:   c.price,
              delay:   c.delay,
              logoUrl: c.logoUrl,
              sig:     c.sig,
            })),
          );
          if (data.noCarrierConfigured) setNoCarrierConfigured(true);
        }
      })
      .catch((err) => {
        if ((err as Error).name !== "AbortError") setCarriersError(t("carriersFetchError"));
      })
      .finally(() => setCarriersLoading(false));

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAddrId, deliveryMode]);

  // ── Carrier "virtuel" selon le mode
  const selectedCarrier: WizardCarrier | null =
    deliveryMode === "pickup"
      ? { id: "pickup_store", name: t("modePickup"), price: 0, delay: "" }
      : deliveryMode === "private"
        ? { id: "private_carrier", name: t("modePrivate"), price: 0, delay: "" }
        : deliveryMode === "merge"
          ? selectedMergeOrder
            ? {
                id:    "merge_into_order",
                name:  `${t("modeMerge")} · #${selectedMergeOrder.orderNumber}`,
                price: 0,
                delay: "",
              }
            : null
          : (carriers.find((c) => c.id === selectedCarrierId) ?? null);

  // ── Calculs TVA + totaux
  const isPickup = deliveryMode === "pickup";
  const tvaRate = resolveVatRate({
    countryCode: selectedAddr?.country ?? null,
    isPickup,
    vatExempt:   user.vatExempt,
  });
  const tvaLabel = `${Math.round(tvaRate * 100)} %`;

  // Remise commerciale client — pour PERCENT on floor le sous-total après
  // remise d'abord puis on dérive la remise (aligné lib/order-pricing.ts).
  // Reconstruit exactement ce que le serveur stockera en BDD ; évite qu'un
  // floor prématuré sur la remise laisse 1 ct de trop dans le sous-total.
  const { clientDiscountAmt, subtotalAfterDiscount } = useMemo(() => {
    const floor2 = (n: number) => Math.floor(n * 100) / 100;
    if (!clientDiscount.discountType || !clientDiscount.discountValue) {
      return { clientDiscountAmt: 0, subtotalAfterDiscount: floor2(subtotalHT) };
    }
    if (clientDiscount.discountType === "PERCENT") {
      const after = Math.max(0, floor2(subtotalHT * (1 - clientDiscount.discountValue / 100)));
      return { clientDiscountAmt: Math.max(0, floor2(subtotalHT - after)), subtotalAfterDiscount: after };
    }
    const amt = Math.min(subtotalHT, clientDiscount.discountValue);
    return { clientDiscountAmt: amt, subtotalAfterDiscount: Math.max(0, floor2(subtotalHT - amt)) };
  }, [clientDiscount, subtotalHT]);

  // Livraison — moteur cascade avec respect du flag `stackable` :
  //   - Cluster stackable = promos SHIPPING stackable + remise commerciale client
  //   - Meilleure non-cumulable = seule la promo SHIPPING non-stackable gagnante
  //   - Résultat final = MAX (gain cluster, gain meilleure non-cumulable)
  const rawCarrierPrice = selectedCarrier?.price ?? 0;
  const freeShippingActive =
    clientDiscount.freeShipping &&
    (clientDiscount.freeShippingMaxPrice == null || rawCarrierPrice <= clientDiscount.freeShippingMaxPrice);

  const shippingCalc = useMemo(() => {
    return computeShippingCascade({
      carrierPrice: rawCarrierPrice,
      shippingPromos,
      freeShippingActive,
      clientShippingDiscountType: clientDiscount.shippingDiscountType,
      clientShippingDiscountValue: clientDiscount.shippingDiscountValue,
    });
  }, [
    rawCarrierPrice, shippingPromos, freeShippingActive,
    clientDiscount.shippingDiscountType, clientDiscount.shippingDiscountValue,
  ]);
  const effectiveCarrierPrice = shippingCalc.finalPrice;
  const autoShippingSaved = shippingCalc.totalSaved;

  // Avoir / crédit — montant que la cliente veut utiliser (0 = pas utilisé).
  // Le serveur clamp toujours à min(solde réel, totalTTC).
  const [creditToApply, setCreditToApply] = useState<number>(0);

  // Code promo saisi (étape 3)
  const [promoCode, setPromoCode] = useState("");
  const [promoApplied, setPromoApplied] = useState<{
    code: string;
    name: string;
    totalSaved: number;
    /** Économie portée sur les produits (impacte le sous-total HT). */
    itemsSaved: number;
    /** Économie portée sur les frais de port. */
    shippingSaved: number;
    /** Type de remise (PERCENTAGE / FIXED_AMOUNT) — affiché à côté du code. */
    discountKind?: string;
    /** Valeur brute (10 pour −10 %, 5 pour 5 € fixe). */
    discountValue?: number;
  } | null>(null);
  const promoAmount = promoApplied?.totalSaved ?? 0;

  // ── Pricing SERVEUR (source unique de vérité, strictement identique au checkout Stripe) ──
  // TOUS les affichages TVA/TTC utilisent les valeurs serveur → aucune divergence possible
  // entre le récap panier, ce que Stripe encaisse, et la commande stockée en BDD.
  const [serverPricing, setServerPricing] = useState<{
    subtotalAfterDiscount: number;
    effectiveCarrierPrice: number;
    tvaOnCart: number;
    tvaOnShipping: number;
    tvaAmount: number;
    totalTTC: number;
    creditApplied: number;
    amountDue: number;
    amountDueCents: number;
    codeError?: string;
  } | null>(null);
  const carrierIdForPricing = selectedCarrier?.id ?? (isPickup ? "pickup_store" : "");
  const carrierPriceForPricing = selectedCarrier?.price ?? 0;
  const addrCountryForPricing = selectedAddr?.country ?? "FR";

  useEffect(() => {
    // Ne calculer qu'à partir de l'étape 2 (livraison choisie).
    if (currentStep < 2 || !carrierIdForPricing) {
      setServerPricing(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const r = await computeCartCheckoutPricing({
        carrierId: carrierIdForPricing,
        carrierPrice: carrierPriceForPricing,
        addressCountry: addrCountryForPricing,
        promoCode: promoApplied?.code ?? null,
        creditToApply,
      });
      if (cancelled) return;
      if (r.success) {
        setServerPricing({
          subtotalAfterDiscount: r.subtotalAfterDiscount,
          effectiveCarrierPrice: r.effectiveCarrierPrice,
          tvaOnCart: r.tvaOnCart,
          tvaOnShipping: r.tvaOnShipping,
          tvaAmount: r.tvaAmount,
          totalTTC: r.totalTTC,
          creditApplied: r.creditApplied,
          amountDue: r.amountDue,
          amountDueCents: r.amountDueCents,
          codeError: r.codeError,
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentStep, carrierIdForPricing, carrierPriceForPricing, addrCountryForPricing, promoApplied?.code, creditToApply, cart]);

  // Fallback local (formules serveur identiques) si serveur pas encore répondu — étape 1 seulement.
  const floor2 = (n: number) => Math.floor(n * 100) / 100;
  const finalItemsHT = Math.max(0, floor2(subtotalAfterDiscount - promoAmount));
  const totalBaseHT = finalItemsHT + effectiveCarrierPrice;
  const tvaAmountLocal = floor2(totalBaseHT * tvaRate);
  const totalTTCLocal = floor2(totalBaseHT + totalBaseHT * tvaRate);
  const tvaAmount = serverPricing?.tvaAmount ?? tvaAmountLocal;
  const totalTTC = serverPricing?.totalTTC ?? totalTTCLocal;
  // Crédit appliqué — priorité serveur ; sinon on clamp localement.
  const creditApplied = serverPricing?.creditApplied
    ?? Math.min(availableCredit, totalTTC, Math.max(0, creditToApply));
  const amountDue = serverPricing?.amountDue
    ?? Math.max(0, floor2(totalTTC - creditApplied));
  const amountDueCents = serverPricing?.amountDueCents ?? Math.round(amountDue * 100);
  // Si l'avoir couvre toute la commande, on passe en paiement "credit only"
  // (skip Stripe, skip virement).
  const isCoveredByCredit = amountDueCents === 0 && creditApplied > 0;

  // ── Stripe PaymentIntent (créé à l'entrée en étape 3)
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [paymentIntentId, setPaymentIntentId] = useState<string | null>(null);
  const [stripeLoading, setStripeLoading] = useState(false);
  const [stripeError, setStripeError] = useState("");
  const paymentIntentAmountRef = useRef<number>(0);

  // Choix carte / virement à l'étape 3 (null = pas encore choisi → ni PI ni UI
  // affichés, la cliente doit d'abord picker un mode). Refonte 2026-09-18.
  const [paymentMode, setPaymentMode] = useState<"card" | "bank_transfer" | null>(null);

  // Consentement remplacement rupture stock — décoché par défaut (opt-in explicite).
  // Déclaré avant le useEffect create-intent pour que la valeur soit dans metadata PI.
  const [acceptReplacementContact, setAcceptReplacementContact] = useState(false);

  useEffect(() => {
    // On ne crée le PaymentIntent Stripe qu'à partir du moment où la cliente a
    // sélectionné « Carte bancaire ». Le virement passe par placeBankTransferOrder
    // directement (aucun PI nécessaire).
    if (currentStep !== 3 || !stripeReady || !selectedCarrier || paymentMode !== "card") return;
    // Si le crédit couvre 100 % du panier, on ne crée pas de PaymentIntent
    // (la commande sera enregistrée en direct via placeCreditOnlyOrder).
    if (isCoveredByCredit) return;
    const amountCents = amountDueCents;
    if (amountCents <= 0) return;
    // Ne pas re-créer si le montant n'a pas changé (évite les re-fetches en cascade)
    if (clientSecret && paymentIntentAmountRef.current === amountCents) return;

    let cancelled = false;
    setStripeLoading(true);
    setStripeError("");
    // Fallback address pour mode merge (l'admin réutilisera celle de la parente).
    const addrForIntent = deliveryMode === "merge"
      ? (selectedAddr ?? addresses[0])
      : selectedAddr;
    // Retrait boutique / transporteur privé : pas d'adresse de livraison
    // requise. Le serveur retombera sur l'adresse société du User. En livraison
    // classique / merge, une adresse reste obligatoire.
    const canSkipAddress = deliveryMode === "pickup" || deliveryMode === "private";
    if (!addrForIntent && !canSkipAddress) {
      setStripeError(t("noAddress"));
      setStripeLoading(false);
      return;
    }
    // On envoie le PRIX BRUT du transporteur (celui signé par /api/carriers).
    // Le serveur applique lui-même la remise free-shipping et les promos AUTO.
    fetch("/api/payments/create-intent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        addressId:            addrForIntent?.id,
        deliveryMode,
        carrierId:            selectedCarrier.id,
        transactionId:        transactionId || undefined,
        carrierName:          selectedCarrier.name,
        carrierPrice:         rawCarrierPrice,
        carrierSig:           selectedCarrier.sig,
        promoCode:            promoApplied?.code ?? "",
        // Champs stockés en metadata PI pour permettre à
        // `finalizeOrderFromPaymentIntent` de reconstituer placeOrder au
        // retour PayPal (voir app/actions/client/order.ts).
        ...(deliveryMode === "private"
          ? privateMode === "contact"
            ? {
                privateCarrierEmail: privateCarrierEmail.trim(),
                privateCarrierPhone: privateCarrierPhone.trim(),
              }
            : { privateCarrierBordereau: bordereauPath ?? undefined }
          : {}),
        ...(deliveryMode === "merge" && selectedMergeOrderId
          ? { mergeIntoOrderId: selectedMergeOrderId }
          : {}),
        acceptReplacementContact,
        creditToApply,
      }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data.error) {
          setStripeError(data.error);
          return;
        }
        setClientSecret(data.clientSecret);
        setPaymentIntentId(data.paymentIntentId);
        paymentIntentAmountRef.current = amountCents;
      })
      .catch(() => {
        if (!cancelled) setStripeError(t("paymentInitError"));
      })
      .finally(() => {
        if (!cancelled) setStripeLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    currentStep,
    stripeReady,
    selectedCarrier?.id,
    effectiveCarrierPrice,
    promoApplied?.code,
    paymentMode,
    // Ces états entrent dans le metadata du PI (reconstruction post-redirect
    // PayPal) — s'ils bougent, il faut re-créer le PI pour qu'il embarque la
    // bonne valeur.
    deliveryMode,
    privateMode,
    privateCarrierEmail,
    privateCarrierPhone,
    bordereauPath,
    selectedMergeOrderId,
    acceptReplacementContact,
    // Le montant d'avoir change le montant à payer → il faut un nouveau PI.
    creditToApply,
    isCoveredByCredit,
  ]);

  // ── CGV + placeOrder
  const [cgvAccepted, setCgvAccepted] = useState(false);
  const [orderError, setOrderError] = useState("");
  const [isCreatingOrder, setIsCreatingOrder] = useState(false);

  async function handleBankTransferSubmit() {
    setOrderError("");
    setIsCreatingOrder(true);
    try {
      const effectiveAddr = deliveryMode === "merge"
        ? (selectedAddr ?? addresses[0] ?? null)
        : selectedAddr;
      // En retrait/privé, addressId est facultatif : le serveur retombera sur
      // l'adresse société. Les autres modes exigent une adresse enregistrée.
      const canSkipAddress = deliveryMode === "pickup" || deliveryMode === "private";
      if (!effectiveAddr && !canSkipAddress) {
        setOrderError(t("noAddress"));
        setIsCreatingOrder(false);
        return;
      }
      if (!selectedCarrier) {
        setOrderError(t("noCarriersAvailable"));
        setIsCreatingOrder(false);
        return;
      }
      const result = await placeBankTransferOrder({
        addressId:    effectiveAddr?.id,
        deliveryMode,
        carrierId:    selectedCarrier.id,
        transactionId,
        carrierSig:   selectedCarrier.sig ?? "",
        carrierName:  selectedCarrier.name,
        carrierPrice: rawCarrierPrice,
        cgvAcceptedAt: new Date().toISOString(),
        acceptReplacementContact,
        ...(deliveryMode === "private"
          ? privateMode === "contact"
            ? {
                privateCarrierEmail: privateCarrierEmail.trim(),
                privateCarrierPhone: privateCarrierPhone.trim(),
              }
            : { privateCarrierBordereau: bordereauPath ?? undefined }
          : {}),
        ...(deliveryMode === "merge" && selectedMergeOrderId
          ? { mergeIntoOrderId: selectedMergeOrderId }
          : {}),
        ...(promoApplied ? { promoCode: promoApplied.code } : {}),
        creditToApply,
      });
      if (result.success) {
        router.replace(`/commandes/${result.orderId}`);
      } else {
        setOrderError(result.error);
        setIsCreatingOrder(false);
      }
    } catch (err) {
      setOrderError((err as Error).message);
      setIsCreatingOrder(false);
    }
  }

  /**
   * Commande 100 % payée par avoir (crédit couvre tout le TTC).
   * Skip Stripe et virement, marque directement la commande "paid".
   */
  async function handleCreditOnlySubmit() {
    setOrderError("");
    setIsCreatingOrder(true);
    try {
      const effectiveAddr = deliveryMode === "merge"
        ? (selectedAddr ?? addresses[0] ?? null)
        : selectedAddr;
      const canSkipAddress = deliveryMode === "pickup" || deliveryMode === "private";
      if (!effectiveAddr && !canSkipAddress) {
        setOrderError(t("noAddress"));
        setIsCreatingOrder(false);
        return;
      }
      if (!selectedCarrier) {
        setOrderError(t("noCarriersAvailable"));
        setIsCreatingOrder(false);
        return;
      }
      const result = await placeCreditOnlyOrder({
        addressId:    effectiveAddr?.id,
        deliveryMode,
        carrierId:    selectedCarrier.id,
        transactionId,
        carrierSig:   selectedCarrier.sig ?? "",
        carrierName:  selectedCarrier.name,
        carrierPrice: rawCarrierPrice,
        cgvAcceptedAt: new Date().toISOString(),
        acceptReplacementContact,
        creditToApply,
        ...(deliveryMode === "private"
          ? privateMode === "contact"
            ? {
                privateCarrierEmail: privateCarrierEmail.trim(),
                privateCarrierPhone: privateCarrierPhone.trim(),
              }
            : { privateCarrierBordereau: bordereauPath ?? undefined }
          : {}),
        ...(deliveryMode === "merge" && selectedMergeOrderId
          ? { mergeIntoOrderId: selectedMergeOrderId }
          : {}),
        ...(promoApplied ? { promoCode: promoApplied.code } : {}),
      });
      if (result.success) {
        router.replace(`/commandes/${result.orderId}`);
      } else {
        setOrderError(result.error);
        setIsCreatingOrder(false);
      }
    } catch (err) {
      setOrderError((err as Error).message);
      setIsCreatingOrder(false);
    }
  }

  /**
   * Fallback appelé quand le PaymentElement Stripe embarqué est bloqué par
   * le navigateur du client. On crée la commande immédiatement (comme un
   * virement) mais avec paymentMode=STRIPE_LINK, on génère la Checkout Session
   * hébergée, et on redirige vers la page commande où le lien reste affiché
   * tant que le paiement n'est pas passé.
   */
  async function handleRequestPaymentLink(): Promise<
    | { success: true; orderId: string; url: string }
    | { success: false; error: string }
  > {
    const effectiveAddr = deliveryMode === "merge"
      ? (selectedAddr ?? addresses[0] ?? null)
      : selectedAddr;
    const canSkipAddress = deliveryMode === "pickup" || deliveryMode === "private";
    if (!effectiveAddr && !canSkipAddress) {
      return { success: false, error: t("noAddress") };
    }
    if (!selectedCarrier) {
      return { success: false, error: t("noCarriersAvailable") };
    }
    const result = await placePaymentLinkOrder({
      addressId:    effectiveAddr?.id,
      deliveryMode,
      carrierId:    selectedCarrier.id,
      transactionId,
      carrierSig:   selectedCarrier.sig ?? "",
      carrierName:  selectedCarrier.name,
      carrierPrice: rawCarrierPrice,
      cgvAcceptedAt: new Date().toISOString(),
      acceptReplacementContact,
      locale: locale === "en" ? "en" : "fr",
      creditToApply,
      ...(deliveryMode === "private"
        ? privateMode === "contact"
          ? {
              privateCarrierEmail: privateCarrierEmail.trim(),
              privateCarrierPhone: privateCarrierPhone.trim(),
            }
          : { privateCarrierBordereau: bordereauPath ?? undefined }
        : {}),
      ...(deliveryMode === "merge" && selectedMergeOrderId
        ? { mergeIntoOrderId: selectedMergeOrderId }
        : {}),
      ...(promoApplied ? { promoCode: promoApplied.code } : {}),
    });
    if (result.success) {
      return { success: true, orderId: result.orderId, url: result.checkoutUrl };
    }
    return { success: false, error: result.error };
  }

  async function handlePaymentSuccess(piId: string) {
    setOrderError("");
    setIsCreatingOrder(true);
    try {
      // Fallback address pour mode "merge" (l'admin réajustera)
      const effectiveAddr = deliveryMode === "merge"
        ? (selectedAddr ?? addresses[0] ?? null)
        : selectedAddr;
      // Retrait/privé : le serveur retombera sur l'adresse société si aucune
      // adresse enregistrée. Livraison / merge : reste obligatoire.
      const canSkipAddress = deliveryMode === "pickup" || deliveryMode === "private";
      if (!effectiveAddr && !canSkipAddress) {
        setOrderError(t("noAddress"));
        setIsCreatingOrder(false);
        return;
      }
      if (!selectedCarrier) {
        setOrderError(t("noCarriersAvailable"));
        setIsCreatingOrder(false);
        return;
      }
      const result = await placeOrder({
        addressId:             effectiveAddr?.id,
        deliveryMode,
        carrierId:             selectedCarrier.id,
        transactionId,
        carrierName:           selectedCarrier.name,
        // Prix brut (signé). placeOrder ré-applique free-shipping et promos.
        carrierPrice:          rawCarrierPrice,
        stripePaymentIntentId: piId,
        cgvAcceptedAt:         new Date().toISOString(),
        acceptReplacementContact,
        creditToApply,
        ...(deliveryMode === "private"
          ? privateMode === "contact"
            ? {
                privateCarrierEmail: privateCarrierEmail.trim(),
                privateCarrierPhone: privateCarrierPhone.trim(),
              }
            : { privateCarrierBordereau: bordereauPath ?? undefined }
          : {}),
        ...(deliveryMode === "merge" && selectedMergeOrderId
          ? { mergeIntoOrderId: selectedMergeOrderId }
          : {}),
        ...(promoApplied ? { promoCode: promoApplied.code } : {}),
      });
      if (result.success) {
        router.replace(`/commandes/${result.orderId}`);
      } else {
        setOrderError(result.error);
        setIsCreatingOrder(false);
      }
    } catch (err) {
      setOrderError((err as Error).message);
      setIsCreatingOrder(false);
    }
  }

  // ── Complétudes pour la nav des étapes
  // Étape 1 : panier non vide. Le minimum d'achat est vérifié UNIQUEMENT à
  // l'étape 2 → 3 (car il ne s'applique pas au mode « merge »).
  const step1Ready = !!cart && cart.items.length > 0;
  // Le panier lui-même atteint-il le minimum ? Indépendant du mode choisi.
  const cartReachesMin = minOrderHT <= 0 || subtotalHT >= minOrderHT;
  const hasMergeCandidates = mergeCandidates.length > 0;
  // Le panier est sous le minimum mais des commandes en cours existent :
  // le seul chemin possible est de fusionner avec une commande existante.
  const mustMergeToProceed = !cartReachesMin && hasMergeCandidates;

  // Minimum d'achat : ignoré pour le mode « merge » (l'admin ajoutera à la
  // commande parente, qui elle a déjà passé le seuil).
  const minOrderReached = deliveryMode === "merge" || cartReachesMin;

  const step2Ready = useMemo(() => {
    if (!step1Ready) return false;
    if (!minOrderReached) return false;
    if (deliveryMode === "delivery") return !!selectedAddr && !!selectedCarrierId;
    if (deliveryMode === "pickup") return true;
    if (deliveryMode === "private") {
      return privateMode === "contact"
        ? privateCarrierEmail.trim().length > 0 && privateCarrierPhone.trim().length > 0
        : !!bordereauPath;
    }
    if (deliveryMode === "merge") return !!selectedMergeOrderId;
    return false;
  }, [
    step1Ready, minOrderReached, deliveryMode, selectedAddr, selectedCarrierId,
    privateMode, privateCarrierEmail, privateCarrierPhone, bordereauPath, selectedMergeOrderId,
  ]);

  // Passage étape 1 → 2 : bloqué si le panier est sous le minimum SANS
  // commande fusionnable (aucun chemin possible). Autorisé si le panier
  // atteint le minimum, ou si le client a une commande à laquelle ajouter.
  const canGoToStep2 = step1Ready && (cartReachesMin || hasMergeCandidates);
  const canGoToStep3 = step2Ready;

  function goToStep(s: WizardStep) {
    if (s === currentStep) return;
    if (s > currentStep) {
      if (s === 2 && !canGoToStep2) return;
      if (s === 3 && !canGoToStep3) return;
    }
    // Sous le minimum + une commande à laquelle ajouter : on force le mode
    // « merge » dès l'arrivée à l'étape 2 (le seul mode possible dans ce cas).
    // La cliente n'a rien à comprendre : la tuile est déjà cochée pour elle.
    if (s === 2 && mustMergeToProceed && deliveryMode !== "merge") {
      setDeliveryMode("merge");
    }
    // Le passage à l'étape 3 (paiement) passe par handleValidateAndGoToPayment
    // pour lancer la vérif serveur du panier. On laisse toutefois goToStep
    // gérer les retours arrière (3→2, 3→1).
    setCurrentStep(s);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /**
   * Étape 2 → Étape 3 : vérification serveur du panier (produits ONLINE,
   * variantes activées, stock suffisant) via /api/cart/validate. Si erreurs,
   * on renvoie l'utilisatrice sur l'étape 1 avec les erreurs affichées ligne
   * par ligne.
   */
  async function handleValidateAndGoToPayment() {
    if (!canGoToStep3) return;
    setIsValidating(true);
    try {
      const res = await fetch("/api/cart/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        // Panier OK → on nettoie les erreurs et on passe à l'étape paiement.
        setValidationErrors([]);
        setCurrentStep(3);
        if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
      } else {
        // Erreurs → retour à l'étape 1, affichage inline sous chaque variante.
        setValidationErrors(data.errors ?? []);
        await refreshCart();
        setCurrentStep(1);
        if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
      }
    } catch {
      // Réseau HS → on laisse quand même passer (le contrôle atomique côté
      // create-intent + placeOrder rattrapera si vraiment un souci persiste).
      setCurrentStep(3);
      if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
    } finally {
      setIsValidating(false);
    }
  }

  // ── Panier vide → écran dédié
  if (!cart || cart.items.length === 0) {
    return (
      <div className="container-site py-14">
        <div className="max-w-md mx-auto bg-white border border-slate-200 rounded-2xl shadow-sm p-10 text-center">
          <div className="text-4xl mb-3">🛒</div>
          <h1 className="font-heading text-xl font-semibold text-slate-900 mb-2">
            {tCart("empty")}
          </h1>
          <p className="text-sm text-slate-500 mb-8">{tCart("emptyDesc")}</p>
          <a
            href="/fr/produits"
            className="inline-flex items-center justify-center h-11 px-6 rounded-xl bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800"
          >
            {tCart("viewCatalogue")}
          </a>
        </div>
      </div>
    );
  }

  // Libellé enrichi pour la remise commerciale : montre "10 %" si le type est
  // PERCENT, sinon simple "Remise commerciale".
  const clientDiscountLabel =
    clientDiscount.discountType === "PERCENT" && clientDiscount.discountValue
      ? `${tCart("summaryClientDiscount")} ${clientDiscount.discountValue} %`
      : tCart("summaryClientDiscount");

  // Décomposition TVA panier vs livraison pour affichage cascade — override serveur si dispo.
  const tvaOnCart = serverPricing?.tvaOnCart ?? floor2(finalItemsHT * tvaRate);
  const tvaOnShipping = serverPricing?.tvaOnShipping ?? floor2(effectiveCarrierPrice * tvaRate);

  // Trace cascade livraison (dérivée du même calcul que effectiveCarrierPrice).
  const shippingTraceLocal = useMemo(() => {
    if (deliveryMode !== "delivery" || rawCarrierPrice <= 0) return [];
    return shippingCalc.trace;
  }, [deliveryMode, rawCarrierPrice, shippingCalc]);

  // ── Récap sticky partagé
  const summaryProps = {
    cart,
    promoInfoByItemId,
    currentStep,
    cartCascade,
    cartFallbackSubtotal: subtotalHT,
    shippingTrace: shippingTraceLocal,
    effectiveCarrierPrice,
    carrierBasePrice: rawCarrierPrice,
    shippingLabelOverride: null as string | null,
    tvaLabel,
    tvaOnCart,
    tvaOnShipping,
    totalTTC,
    creditApplied,
    deliveryMode,
    selectedCarrier,
    selectedMergeOrder,
    promoApplied,
  };

  return (
    <div className="min-h-screen bg-slate-50 overflow-x-hidden">
      <div className="max-w-[1440px] mx-auto px-4 sm:px-5 md:px-6 py-6 md:py-10">
        <div className="mb-6 md:mb-8">
          <div className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold mb-1">
            {tCart("cartTitle")}
          </div>
          <h1 className="font-heading text-2xl md:text-3xl font-bold text-slate-900 mb-6">
            {tCart("finalizeOrder")}
          </h1>
          <WizardStepper
            currentStep={currentStep}
            onGoTo={goToStep}
            canGoStep2={canGoToStep2}
            canGoStep3={canGoToStep3}
          />
        </div>

        <div className="grid gap-6 md:gap-8 lg:grid-cols-[minmax(0,1fr)_380px] items-start">
          {/* Colonne gauche — contenu de l'étape */}
          <div className="min-w-0">
            {currentStep === 1 && (
              <Step1CartContent
                cart={cart}
                productsMeta={productsMeta}
                onCartMutated={refreshCart}
                validationErrors={validationErrors}
                onClearErrors={() => setValidationErrors([])}
                promoInfoByItemId={promoInfoByItemId}
                clientDiscount={
                  clientDiscount.discountType && clientDiscount.discountValue != null
                    ? {
                        type: clientDiscount.discountType,
                        value: Number(clientDiscount.discountValue),
                      }
                    : null
                }
                minOrderHT={minOrderHT}
                subtotalHT={subtotalHT}
                hasMergeCandidates={hasMergeCandidates}
              />
            )}

            {currentStep === 2 && (
              <Step2DeliveryContent
                billingInfo={billingInfo}
                onBillingChange={setBillingInfo}
                addresses={addresses}
                onAddressesChange={setAddresses}
                selectedAddrId={selectedAddrId}
                onSelectedAddrChange={setSelectedAddrId}
                deliveryMode={deliveryMode}
                onDeliveryModeChange={setDeliveryMode}
                carriers={carriers}
                carriersLoading={carriersLoading}
                carriersError={carriersError}
                noCarrierConfigured={noCarrierConfigured}
                selectedCarrierId={selectedCarrierId}
                onSelectedCarrierChange={setSelectedCarrierId}
                privateMode={privateMode}
                onPrivateModeChange={setPrivateMode}
                privateCarrierEmail={privateCarrierEmail}
                onPrivateCarrierEmailChange={setPrivateCarrierEmail}
                privateCarrierPhone={privateCarrierPhone}
                onPrivateCarrierPhoneChange={setPrivateCarrierPhone}
                bordereauName={bordereauName}
                bordereauUploading={bordereauUploading}
                onBordereauUpload={handleBordereauUpload}
                onBordereauClear={handleBordereauClear}
                selectedMergeOrderId={selectedMergeOrderId}
                onSelectedMergeOrderChange={setSelectedMergeOrderId}
                pickupInfo={pickupInfo}
                mergeCandidates={mergeCandidates}
                clientDiscount={clientDiscount}
                shippingPromos={shippingPromos}
                minOrderHT={minOrderHT}
                subtotalHT={subtotalHT}
                mustMergeToProceed={mustMergeToProceed}
              />
            )}

            {currentStep === 3 && (
              <Step3PaymentContent
                cart={cart}
                clientSecret={clientSecret}
                stripePublishableKey={stripePublishableKey}
                stripeLoading={stripeLoading}
                stripeError={stripeError}
                onPaymentSuccess={handlePaymentSuccess}
                onPaymentError={setStripeError}
                onBackToStep2={() => goToStep(2)}
                paymentMode={paymentMode}
                onPaymentModeChange={setPaymentMode}
                bankTransfer={bankTransfer}
                onBankTransferSubmit={handleBankTransferSubmit}
                onRequestPaymentLink={handleRequestPaymentLink}
                billingSummary={{
                  name:    `${billingInfo.company || `${billingInfo.firstName} ${billingInfo.lastName}`}`,
                  address: [
                    billingInfo.address1,
                    `${billingInfo.zipCode} ${billingInfo.city}`.trim(),
                    billingInfo.country,
                  ]
                    .filter((s) => s && s.trim().length > 0)
                    .join(" · "),
                }}
                shippingSummary={{
                  title: deliveryMode === "pickup"
                    ? t("modePickup")
                    : deliveryMode === "private"
                      ? t("modePrivate")
                      : deliveryMode === "merge"
                        ? selectedMergeOrder
                          ? `${t("modeMerge")} · #${selectedMergeOrder.orderNumber}`
                          : t("modeMerge")
                        : selectedCarrier?.name ?? "",
                  description: selectedAddr
                    ? `${selectedAddr.address1}, ${selectedAddr.zipCode} ${selectedAddr.city}`
                    : "",
                }}
                cgvAccepted={cgvAccepted}
                onCgvChange={setCgvAccepted}
                acceptReplacementContact={acceptReplacementContact}
                onAcceptReplacementChange={setAcceptReplacementContact}
                promoCode={promoCode}
                onPromoCodeChange={setPromoCode}
                promoApplied={promoApplied}
                onPromoApplied={setPromoApplied}
                onPromoCleared={() => setPromoApplied(null)}
                totalAmountCents={amountDueCents}
                totalTTC={totalTTC}
                orderError={orderError}
                isCreatingOrder={isCreatingOrder}
                deliveryMode={deliveryMode}
                selectedCarrier={selectedCarrier}
                selectedMergeOrder={selectedMergeOrder}
                subtotalHT={subtotalHT}
                shippingHT={effectiveCarrierPrice}
                availableCredit={availableCredit}
                creditToApply={creditApplied}
                onCreditToApplyChange={setCreditToApply}
                isCoveredByCredit={isCoveredByCredit}
                onCreditOnlySubmit={handleCreditOnlySubmit}
              />
            )}
          </div>

          {/* Colonne droite — récap sticky */}
          <SummaryPanel
            {...summaryProps}
            /* À l'étape 3 en mode carte, le bouton Payer est déjà dans le
               formulaire Stripe → on masque le doublon dans le récap. Idem
               pour le mode virement (bouton "Confirmer" dans le bloc virement). */
            hideCta={currentStep === 3}
            ctaLabel={
              currentStep === 1
                ? t("proceedToPayment")
                : currentStep === 2
                  ? t("proceedToPayment")
                  : t("payAmount", { amount: amountDue.toFixed(2) })
            }
            ctaDisabled={
              currentStep === 1
                ? !canGoToStep2
                : currentStep === 2
                  ? !canGoToStep3 || isValidating
                  : isCoveredByCredit
                    ? !cgvAccepted || isCreatingOrder
                    : paymentMode === "bank_transfer"
                      ? !cgvAccepted || isCreatingOrder
                      : !cgvAccepted || !clientSecret || isCreatingOrder || paymentMode !== "card"
            }
            onCta={() => {
              if (currentStep === 1) goToStep(2);
              else if (currentStep === 2) void handleValidateAndGoToPayment();
              else if (isCoveredByCredit) {
                void handleCreditOnlySubmit();
              } else if (paymentMode === "bank_transfer") {
                void handleBankTransferSubmit();
              } else {
                // L'étape 3 (mode carte) : le CTA du récap sert de raccourci
                // pour lancer le paiement Stripe (accordéon des méthodes).
                const submitBtn = document.querySelector<HTMLButtonElement>(
                  'form button[type="submit"]',
                );
                submitBtn?.click();
              }
            }}
            backLabel={currentStep > 1 ? tCommon("previous") : undefined}
            onBack={currentStep > 1 ? () => goToStep((currentStep - 1) as WizardStep) : undefined}
            helperNote={
              // Sur l'étape 2, si le minimum n'est pas atteint et qu'on n'est
              // pas en mode « merge » (qui l'ignore), on rappelle l'écart dans
              // le récap. Le bandeau principal est affiché dans le corps de
              // l'étape 2 via Step2DeliveryContent.
              currentStep === 2 && !minOrderReached
                ? `${tCart("summaryMinOrder")} ${minOrderHT.toFixed(2)} €`
                : null
            }
          />
        </div>
      </div>
    </div>
  );
}
