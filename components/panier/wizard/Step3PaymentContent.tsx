"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements,
} from "@stripe/react-stripe-js";
import { validatePromoCodeForCart } from "@/app/actions/client/promo-code";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { reportPaymentError, normalizeStripeError } from "@/lib/report-payment-error";
import type { WizardCart, WizardCarrier, DeliveryMode, WizardMergeCandidate } from "./types";

/** Extrait `pi_XXX` d'un client secret `pi_XXX_secret_YYY` (pour la télémétrie). */
function extractPaymentIntentId(clientSecret: string): string | undefined {
  const m = clientSecret.match(/^(pi_[^_]+)_secret_/);
  return m ? m[1] : undefined;
}

/**
 * Étape 3 — Paiement. Récap adresses + code promo + carte bancaire (Stripe
 * Elements) + CGV. UI refaite pour matcher la maquette (cards ardoise,
 * layout aéré).
 */
export default function Step3PaymentContent({
  cart,
  clientSecret,
  stripePublishableKey,
  stripeLoading,
  stripeError,
  onPaymentSuccess,
  onPaymentError,
  onBackToStep2,
  billingSummary,
  shippingSummary,
  cgvAccepted,
  onCgvChange,
  acceptReplacementContact,
  onAcceptReplacementChange,
  promoCode,
  onPromoCodeChange,
  promoApplied,
  onPromoApplied,
  onPromoCleared,
  totalAmountCents,
  totalTTC,
  orderError,
  isCreatingOrder,
  deliveryMode,
  selectedCarrier,
  selectedMergeOrder,
  subtotalHT,
  shippingHT,
  paymentMode,
  onPaymentModeChange,
  bankTransfer,
  onBankTransferSubmit,
}: {
  cart: WizardCart;
  clientSecret: string | null;
  stripePublishableKey: string | null;
  stripeLoading: boolean;
  stripeError: string;
  onPaymentSuccess: (paymentIntentId: string) => void;
  onPaymentError: (msg: string) => void;
  onBackToStep2: () => void;
  billingSummary: { name: string; address: string };
  shippingSummary: { title: string; description: string };
  cgvAccepted: boolean;
  onCgvChange: (v: boolean) => void;
  acceptReplacementContact: boolean;
  onAcceptReplacementChange: (v: boolean) => void;
  promoCode: string;
  onPromoCodeChange: (v: string) => void;
  promoApplied: { code: string; name: string; totalSaved: number } | null;
  onPromoApplied: (r: { code: string; name: string; totalSaved: number } | null) => void;
  onPromoCleared: () => void;
  totalAmountCents: number;
  totalTTC: number;
  orderError: string;
  isCreatingOrder: boolean;
  deliveryMode: DeliveryMode;
  selectedCarrier: WizardCarrier | null;
  selectedMergeOrder: WizardMergeCandidate | null;
  subtotalHT: number;
  shippingHT: number;
  paymentMode: "card" | "bank_transfer" | null;
  onPaymentModeChange: (mode: "card" | "bank_transfer") => void;
  bankTransfer: { enabled: boolean; holder: string; ibanDisplay: string };
  onBankTransferSubmit: () => void;
}) {
  const t = useTranslations("checkout");
  const tCommon = useTranslations("common");
  const { confirm } = useConfirm();
  const [promoBusy, setPromoBusy] = useState(false);
  const [promoError, setPromoError] = useState("");

  // Ouvre la modale d'engagement avant de créer la commande virement. Précise
  // à la cliente qu'elle recevra les coordonnées immédiatement après.
  async function handleBankTransferClick() {
    const ok = await confirm({
      title: t("bankTransferConfirmTitle"),
      message: t("bankTransferConfirmMessage", { amount: totalTTC.toFixed(2) }),
      confirmLabel: t("bankTransferConfirmYes"),
      cancelLabel: tCommon("cancel"),
    });
    if (ok) onBankTransferSubmit();
  }

  const [stripePromise, setStripePromise] = useState<Promise<Stripe | null> | null>(null);
  useEffect(() => {
    if (stripePublishableKey && !stripePromise) {
      setStripePromise(loadStripe(stripePublishableKey));
    }
  }, [stripePublishableKey, stripePromise]);

  async function handleApplyPromo() {
    setPromoError("");
    if (!promoCode.trim()) return;
    setPromoBusy(true);
    try {
      const res = await validatePromoCodeForCart(promoCode.trim(), {
        carrierPrice: shippingHT,
        isFreeShipping: false,
        shippingSavedAmount: 0,
      });
      if (res.success) {
        onPromoApplied({
          code: res.result.code,
          name: res.result.name ?? res.result.code,
          totalSaved: res.result.totalSaved,
        });
      } else {
        setPromoError(res.error ?? t("promoInvalid"));
        onPromoApplied(null);
      }
    } catch {
      setPromoError(t("promoInvalid"));
    } finally {
      setPromoBusy(false);
    }
  }

  // CGV + consentement remplacement — bloc partagé entre Carte (rendu dans
  // StripeCardForm juste avant le bouton Payer) et Virement (rendu dans le
  // bloc virement juste avant le bouton Confirmer). Une seule source de
  // vérité pour cgvAccepted et acceptReplacementContact.
  const consentNode = (
    <div className="space-y-3">
      <label className="flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={acceptReplacementContact}
          onChange={(e) => onAcceptReplacementChange(e.target.checked)}
          className="mt-1"
        />
        <span className="text-sm text-slate-600">
          {t("replacementAccept")}
        </span>
      </label>
      <label className="flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={cgvAccepted}
          onChange={(e) => onCgvChange(e.target.checked)}
          className="mt-1"
        />
        <span className="text-sm text-slate-600">
          {t("cgvAccept")}{" "}
          <a href="/mentions-legales" target="_blank" className="underline hover:text-slate-900">
            {t("cgvLink")}
          </a>
          .
        </span>
      </label>
    </div>
  );

  return (
    <div className="space-y-5">
      {/* Récap facturation + livraison */}
      <section className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5 md:p-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 text-sm">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold mb-1">
              {t("billedTo")}
            </div>
            <div className="font-semibold text-slate-900">{billingSummary.name}</div>
            <div className="text-xs text-slate-600 mt-1">{billingSummary.address}</div>
            <button
              type="button"
              onClick={onBackToStep2}
              className="mt-2 text-xs text-slate-500 hover:text-slate-900"
            >
              {tCommon("edit")}
            </button>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold mb-1">
              {t("shippedTo")}
            </div>
            <div className="font-semibold text-slate-900">{shippingSummary.title}</div>
            <div className="text-xs text-slate-600 mt-1">{shippingSummary.description}</div>
            <button
              type="button"
              onClick={onBackToStep2}
              className="mt-2 text-xs text-slate-500 hover:text-slate-900"
            >
              {tCommon("edit")}
            </button>
          </div>
        </div>
      </section>

      {/* Code promo */}
      <section className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5 md:p-6">
        <div className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold mb-2">
          {t("promoCode")}
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            value={promoCode}
            onChange={(e) => onPromoCodeChange(e.target.value)}
            placeholder="Ex : ETE2026"
            disabled={!!promoApplied}
            className="flex-1 px-3 py-2.5 border border-slate-200 rounded-xl text-sm bg-white focus:outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10 disabled:bg-slate-50 disabled:text-slate-500"
          />
          {promoApplied ? (
            <button
              type="button"
              onClick={() => {
                onPromoApplied(null);
                onPromoCleared();
                onPromoCodeChange("");
              }}
              className="px-4 py-2 rounded-xl border border-slate-300 text-slate-700 text-sm font-semibold hover:bg-slate-50"
            >
              {tCommon("remove")}
            </button>
          ) : (
            <button
              type="button"
              onClick={handleApplyPromo}
              disabled={!promoCode.trim() || promoBusy}
              className="px-4 py-2 rounded-xl bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800 disabled:opacity-50"
            >
              {promoBusy ? tCommon("saving") : t("promoApply")}
            </button>
          )}
        </div>
        {promoApplied && (
          <div className="mt-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm px-3 py-2 flex items-center justify-between gap-2">
            <span>
              <span className="font-semibold">{promoApplied.code}</span> · {t("promoAppliedDesc", { amount: promoApplied.totalSaved.toFixed(2) })}
            </span>
          </div>
        )}
        {promoError && (
          <p className="mt-2 text-xs text-red-600">{promoError}</p>
        )}
      </section>

      {/* Choix carte / virement — 2 gros radios exposés d'entrée */}
      <section className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5 md:p-6">
        <div className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold mb-3">
          {t("paymentTitle")}
        </div>
        <div className={`grid gap-2.5 ${bankTransfer.enabled ? "sm:grid-cols-2" : "sm:grid-cols-1"}`}>
          <label
            className={`flex items-start gap-3 p-4 rounded-xl border cursor-pointer transition-all ${
              paymentMode === "card"
                ? "border-slate-900 bg-slate-50 ring-1 ring-slate-900/10"
                : "border-slate-200 hover:border-slate-300 hover:bg-slate-50/50"
            }`}
          >
            <input
              type="radio"
              name="payment-mode"
              value="card"
              checked={paymentMode === "card"}
              onChange={() => onPaymentModeChange("card")}
              className="mt-1"
            />
            <div className="flex-1">
              <div className="font-semibold text-sm text-slate-900">{t("paymentCard")}</div>
              <p className="text-xs text-slate-500 mt-0.5">{t("paymentCardInfo")}</p>
            </div>
          </label>
          {bankTransfer.enabled && (
            <label
              className={`flex items-start gap-3 p-4 rounded-xl border cursor-pointer transition-all ${
                paymentMode === "bank_transfer"
                  ? "border-slate-900 bg-slate-50 ring-1 ring-slate-900/10"
                  : "border-slate-200 hover:border-slate-300 hover:bg-slate-50/50"
              }`}
            >
              <input
                type="radio"
                name="payment-mode"
                value="bank_transfer"
                checked={paymentMode === "bank_transfer"}
                onChange={() => onPaymentModeChange("bank_transfer")}
                className="mt-1"
              />
              <div className="flex-1">
                <div className="font-semibold text-sm text-slate-900">{t("paymentTransfer")}</div>
                <p className="text-xs text-slate-500 mt-0.5">{t("paymentTransferInfo")}</p>
              </div>
            </label>
          )}
        </div>
      </section>

      {/* Bloc Carte : Stripe PaymentElement (accordéon interne des méthodes Stripe) */}
      {paymentMode === "card" && (
        <section className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5 md:p-6">
          <div className="mb-5">
            <div className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold mb-1">
              {t("securePayment")}
            </div>
            <h2 className="font-heading text-lg md:text-xl font-semibold text-slate-900">
              {t("securePayment")}
            </h2>
            <p className="text-xs text-slate-500 mt-1 flex items-center gap-1">
              🔒 {t("stripeInfo")}
            </p>
          </div>

          {stripeLoading && (
            <p className="text-sm text-slate-500 text-center py-8">{t("preparingPayment")}</p>
          )}

          {stripeError && (
            <div className="rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm p-4">
              {stripeError}
            </div>
          )}

          {clientSecret && stripePromise && !stripeError && (
            <Elements
              stripe={stripePromise}
              options={{ clientSecret, appearance: { theme: "stripe" } }}
            >
              <StripeCardForm
                clientSecret={clientSecret}
                onSuccess={onPaymentSuccess}
                onError={onPaymentError}
                disabled={!cgvAccepted || isCreatingOrder}
                totalAmountCents={totalAmountCents}
                consentBlock={consentNode}
              />
            </Elements>
          )}

          {orderError && (
            <div className="mt-4 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm p-4">
              {orderError}
            </div>
          )}
        </section>
      )}

      {/* Bloc Virement bancaire */}
      {paymentMode === "bank_transfer" && bankTransfer.enabled && (
        <section className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5 md:p-6">
          <div className="mb-5">
            <div className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold mb-1">
              {t("paymentTransfer")}
            </div>
            <h2 className="font-heading text-lg md:text-xl font-semibold text-slate-900">
              {t("bankTransferChosenTitle")}
            </h2>
            <p className="text-sm text-slate-600 mt-2">
              {t("bankTransferChosenDesc")}
            </p>
          </div>

          <div className="rounded-xl bg-slate-50 border border-slate-200 p-4 flex items-start gap-3">
            <svg className="w-5 h-5 text-slate-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-xs text-slate-600 leading-relaxed">
              {t("bankTransferDetailsAfter")}
            </p>
          </div>

          <div className="mt-5">{consentNode}</div>

          <button
            type="button"
            onClick={handleBankTransferClick}
            disabled={!cgvAccepted || isCreatingOrder}
            className="w-full mt-4 h-12 rounded-xl bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {isCreatingOrder ? t("preparingPayment") : t("confirmBankTransferOrder")}
          </button>

          {orderError && (
            <div className="mt-4 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm p-4">
              {orderError}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Formulaire Stripe unifié — PaymentElement expose carte + Apple Pay
   + Google Pay dans un même bloc (selon device/navigateur).
   ───────────────────────────────────────────────────────────── */
function StripeCardForm({
  clientSecret,
  onSuccess,
  onError,
  disabled,
  totalAmountCents,
  consentBlock,
}: {
  clientSecret: string;
  onSuccess: (piId: string) => void;
  onError: (msg: string) => void;
  disabled: boolean;
  totalAmountCents: number;
  consentBlock: React.ReactNode;
}) {
  const t = useTranslations("checkout");
  const locale = useLocale();
  const stripe = useStripe();
  const elements = useElements();
  const [processing, setProcessing] = useState(false);
  const [ready, setReady] = useState(false);
  const paymentIntentId = extractPaymentIntentId(clientSecret);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements || processing || disabled) return;
    setProcessing(true);
    onError("");
    // return_url : nécessaire pour PayPal (redirect vers paypal.com puis retour).
    // Pour la carte, redirect:"if_required" court-circuite et on n'y va jamais
    // (sauf 3DS). La page /panier/retour-paiement appelle
    // finalizeOrderFromPaymentIntent qui recrée la commande depuis metadata.
    const returnUrl = `${window.location.origin}/${locale}/panier/retour-paiement`;
    const { error, paymentIntent } = await stripe.confirmPayment({
      elements,
      redirect: "if_required",
      confirmParams: {
        return_url: returnUrl,
      },
    });
    if (error) {
      reportPaymentError({
        stage: "confirm",
        source: "checkout",
        paymentIntentId,
        amountCents: totalAmountCents,
        stripeError: normalizeStripeError(error),
      });
      onError(error.message ?? t("paymentError"));
      setProcessing(false);
    } else if (paymentIntent && paymentIntent.status === "succeeded") {
      onSuccess(paymentIntent.id);
    } else {
      reportPaymentError({
        stage: "confirm",
        source: "checkout",
        paymentIntentId,
        amountCents: totalAmountCents,
        stripeError: {
          code: "not_succeeded",
          message: `PI status ${paymentIntent?.status ?? "unknown"} après confirmPayment`,
          paymentMethodType:
            typeof paymentIntent?.payment_method === "object"
              ? paymentIntent?.payment_method?.type
              : undefined,
        },
      });
      onError(t("paymentNotCompleted"));
      setProcessing(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <PaymentElement
        onReady={() => setReady(true)}
        onLoadError={(event) => {
          // Le PaymentElement n'a pas pu s'initialiser : combinaison de méthodes
          // incompatible avec le contexte (pays/devise/montant) — c'est le cas
          // qui affiche « Veuillez réessayer plus tard » sans laisser de trace.
          reportPaymentError({
            stage: "load",
            source: "checkout",
            paymentIntentId,
            amountCents: totalAmountCents,
            stripeError: normalizeStripeError(event.error),
          });
        }}
        options={{
          // Accordion : mieux qu'onglets quand on a 4-5 méthodes visibles à la
          // fois (carte + PayPal + Billie + Bancontact + iDEAL selon toggles).
          layout: { type: "accordion", defaultCollapsed: false, radios: true, spacedAccordionItems: true },
          // Masque Link (compte 1-clic Stripe) — Apple Pay et Google Pay
          // restent affichés (wallets natifs).
          wallets: { applePay: "auto", googlePay: "auto", link: "never" },
        }}
      />
      {consentBlock}
      <button
        type="submit"
        disabled={disabled || !ready || processing}
        className="w-full h-12 rounded-xl bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
      >
        {processing ? (
          t("preparingPayment")
        ) : (
          <>
            🔒 {t("payAmount", { amount: (totalAmountCents / 100).toFixed(2) })}
          </>
        )}
      </button>
    </form>
  );
}
