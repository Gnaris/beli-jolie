"use client";

import { useState, useTransition, useEffect, useMemo } from "react";
import Image from "@/components/ui/SmartImage";
import { Link, useRouter } from "@/i18n/navigation";
import { useTranslations, useLocale } from "next-intl";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, useStripe, useElements, CardNumberElement, CardExpiryElement, CardCvcElement } from "@stripe/react-stripe-js";
import { saveShippingAddress, deleteShippingAddress } from "@/app/actions/client/cart";
import { placeOrder } from "@/app/actions/client/order";
import { updateBillingInfo } from "@/app/actions/client/billing";
import { uploadBordereau } from "@/app/actions/client/upload-bordereau";
import { useLoadingOverlay } from "@/components/ui/LoadingOverlay";
import CustomSelect from "@/components/ui/CustomSelect";

const COUNTRY_CODES = [
  "FR", "BE", "LU", "CH", "DE", "ES", "IT", "NL", "PT", "AT",
  "PL", "SE", "DK", "FI", "IE", "CZ", "RO", "HU", "GR",
  "US", "GB", "CA", "AU", "JP",
];

function useCountryOptions() {
  const locale = useLocale();
  return useMemo(() => {
    const dn = new Intl.DisplayNames([locale], { type: "region" });
    return COUNTRY_CODES.map((code) => ({ code, label: dn.of(code) ?? code }));
  }, [locale]);
}

// ─────────────────────────────────────────────
// Stripe (clé publique chargée dynamiquement depuis la DB)
// ─────────────────────────────────────────────

let _stripePromise: ReturnType<typeof loadStripe> | null = null;

function getStripePromise() {
  if (!_stripePromise) {
    _stripePromise = fetch("/api/payments/stripe-key")
      .then((r) => r.json())
      .then((data) => {
        if (data.publishableKey) {
          return loadStripe(data.publishableKey);
        }
        return null;
      })
      .catch(() => null);
  }
  return _stripePromise;
}

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

interface VariantData {
  id: string;
  productId: string;
  colorId: string;
  saleType: "UNIT" | "PACK";
  packQuantity: number | null;
  sizes: { name: string; quantity: number }[];
  unitPrice: number;
  weight: number;
  color: { name: string };
  product: { id: string; name: string; reference: string; discountPercent?: number | null; category: { name: string } };
}

interface CartItemData {
  id: string;
  quantity: number;
  variant: VariantData;
  variantImages: { path: string }[];
}

interface CartData {
  id: string;
  items: CartItemData[];
}

interface Address {
  id: string;
  label: string;
  firstName: string;
  lastName: string;
  company: string | null;
  address1: string;
  address2: string | null;
  zipCode: string;
  city: string;
  country: string;
  phone: string | null;
  isDefault: boolean;
}

interface UserInfo {
  firstName: string;
  lastName: string;
  company: string;
  email: string;
  phone: string;
  siret: string;
  vatNumber: string | null;
  vatExempt: boolean;
  addressStreet:     string | null;
  addressComplement: string | null;
  addressZip:        string | null;
  addressCity:       string | null;
  addressCountry:    string | null;
}

interface ClientDiscount {
  discountType:  "PERCENT" | "AMOUNT" | null;
  discountValue: number | null;
  freeShipping:  boolean;
}

interface Carrier {
  id: string;
  name: string;
  price: number;
  delay: string;
  logo?: string;
}

// ─────────────────────────────────────────────
// Constantes TVA
// ─────────────────────────────────────────────

import { resolveVatRate, isDomTom, isEuNonFrance, EU_COUNTRIES } from "@/lib/vat";

type TvaT = (key: string) => string;

function getTvaLabel(rate: number, address: Address | null, isPickup: boolean, vatExempt: boolean, t: TvaT): string {
  if (!address) {
    if (isPickup) return "20 %";
    return t("tvaCalculatedAfter");
  }
  const country = address.country;
  if (rate === 0) {
    if (isDomTom(country)) return t("tvaDomTom");
    if (isEuNonFrance(country) && vatExempt) return t("tvaReverseCharge");
    if (!EU_COUNTRIES.has(country)) return t("tvaExportNonEu");
  }
  if (rate > 0 && isEuNonFrance(country) && !vatExempt) {
    return t("tvaPendingValidation");
  }
  return `${(rate * 100).toFixed(0)} %`;
}

// ─────────────────────────────────────────────
// Calcul prix
// ─────────────────────────────────────────────

function computeUnitPrice(v: VariantData): number {
  const price = Number(v.unitPrice);
  const base = v.saleType === "UNIT" ? price : price * (v.packQuantity ?? 1);
  const discountPercent = v.product.discountPercent != null ? Number(v.product.discountPercent) : null;
  if (!discountPercent || discountPercent <= 0) return base;
  return Math.max(0, base * (1 - discountPercent / 100));
}

// ─────────────────────────────────────────────
// Stepper
// ─────────────────────────────────────────────

function CheckoutStepper({ currentStep }: { currentStep: number }) {
  const t = useTranslations("cart");
  const steps = [
    { label: t("stepCart"), href: "/panier" },
    { label: t("stepCheckout"), href: "/panier/commande" },
    { label: t("stepConfirmation"), href: null },
  ];

  return (
    <nav className="flex items-center justify-center gap-0 mb-8 md:mb-10">
      {steps.map((step, i) => {
        const isActive = i === currentStep;
        const isDone = i < currentStep;
        return (
          <div key={step.label} className="flex items-center">
            {i > 0 && (
              <div className={`w-8 sm:w-14 h-px mx-1 sm:mx-2 transition-colors ${isDone ? "bg-bg-dark" : "bg-border"}`} />
            )}
            <div className="flex items-center gap-2">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold font-body transition-all shrink-0 ${
                isActive
                  ? "bg-bg-dark text-white"
                  : isDone
                    ? "bg-bg-dark text-white"
                    : "bg-bg-tertiary text-text-muted"
              }`}>
                {isDone ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : (
                  i + 1
                )}
              </div>
              {step.href && (isDone || isActive) ? (
                <Link href={step.href} className={`text-sm font-body font-medium transition-colors hidden sm:block ${
                  isActive ? "text-text-primary" : "text-text-secondary hover:text-text-primary"
                }`}>
                  {step.label}
                </Link>
              ) : (
                <span className={`text-sm font-body font-medium hidden sm:block ${
                  isActive ? "text-text-primary" : "text-text-muted"
                }`}>
                  {step.label}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </nav>
  );
}

// ─────────────────────────────────────────────
// Section header with completion indicator
// ─────────────────────────────────────────────

function SectionHeader({ step, title, complete, children }: {
  step: number;
  title: string;
  complete: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="px-5 py-3.5 border-b border-border bg-bg-secondary/60 flex items-center justify-between">
      <div className="flex items-center gap-2.5">
        <div className={`w-7 h-7 rounded-full text-xs font-bold flex items-center justify-center shrink-0 transition-colors ${
          complete
            ? "bg-success text-white"
            : "bg-bg-dark text-text-inverse"
        }`}>
          {complete ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          ) : step}
        </div>
        <h2 className="font-heading text-sm font-semibold text-text-primary uppercase tracking-wide">
          {title}
        </h2>
      </div>
      {children}
    </div>
  );
}

// ─────────────────────────────────────────────
// Composants petits
// ─────────────────────────────────────────────

function FieldInput({
  id, label, value, onChange, type = "text", placeholder, required = false, optional = false,
}: {
  id: string; label: string; value: string; onChange: (v: string) => void;
  type?: string; placeholder?: string; required?: boolean; optional?: boolean;
}) {
  const t = useTranslations("checkout");
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-body font-medium text-text-primary mb-1.5">
        {label}{optional && <span className="text-text-muted font-normal ml-1">{t("fieldOptional")}</span>}
        {required && <span className="text-text-primary ml-0.5">*</span>}
      </label>
      <input
        id={id} type={type} value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder} required={required}
        className="field-input w-full"
      />
    </div>
  );
}

// ─────────────────────────────────────────────
// Formulaire d'adresse
// ─────────────────────────────────────────────

const EMPTY_ADDR = {
  firstName: "", lastName: "", company: "",
  address1: "", address2: "", zipCode: "", city: "", country: "FR", phone: "",
};

function AddressForm({
  initial,
  initialIsDefault = false,
  isEditing = false,
  onSave,
  onCancel,
  isSaving,
}: {
  initial?: Partial<typeof EMPTY_ADDR>;
  initialIsDefault?: boolean;
  isEditing?: boolean;
  onSave: (data: typeof EMPTY_ADDR & { isDefault: boolean }) => void;
  onCancel: () => void;
  isSaving: boolean;
}) {
  const t = useTranslations("checkout");
  const tCommon = useTranslations("common");
  const countryOptions = useCountryOptions();
  const [f, setF] = useState({ ...EMPTY_ADDR, ...initial });
  const [isDefault, setIsDefault] = useState(initialIsDefault);

  const set = (k: keyof typeof EMPTY_ADDR) => (v: string) => setF((p) => ({ ...p, [k]: v }));

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSave({ ...f, isDefault });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <FieldInput id="addr-fn" label={t("addressFirstName")} value={f.firstName} onChange={set("firstName")} required />
        <FieldInput id="addr-ln" label={t("addressLastName")} value={f.lastName} onChange={set("lastName")} required />
      </div>
      <FieldInput id="addr-co" label={t("addressCompany")} value={f.company} onChange={set("company")} optional />
      <FieldInput id="addr-a1" label={t("addressLine1")} value={f.address1} onChange={set("address1")} placeholder={t("addressLine1Placeholder")} required />
      <FieldInput id="addr-a2" label={t("addressLine2")} value={f.address2} onChange={set("address2")} optional placeholder={t("addressLine2Placeholder")} />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <FieldInput id="addr-zip" label={t("addressZipCode")} value={f.zipCode} onChange={set("zipCode")} required />
        <FieldInput id="addr-city" label={t("addressCity")} value={f.city} onChange={set("city")} required />
      </div>
      <div>
        <label htmlFor="addr-country" className="block text-sm font-body font-medium text-text-primary mb-1.5">
          {t("addressCountry")} <span className="text-text-primary">*</span>
        </label>
        <CustomSelect
          id="addr-country"
          value={f.country}
          onChange={(v) => set("country")(v)}
          options={countryOptions.map((c) => ({ value: c.code, label: c.label }))}
        />
      </div>
      <FieldInput id="addr-phone" label={t("addressPhone")} value={f.phone} onChange={set("phone")} type="tel" optional placeholder={t("phonePlaceholder")} />
      <label className="flex items-center gap-2 text-sm font-body text-text-primary cursor-pointer">
        <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)}
          className="accent-text-primary w-4 h-4" />
        {t("defineAsDefault")}
      </label>
      <div className="flex gap-3 pt-1">
        <button type="submit" disabled={isSaving}
          className="btn-primary flex-1 justify-center disabled:opacity-60">
          {isSaving ? t("saving") : isEditing ? t("updateAddressBtn") : t("saveAddressBtn")}
        </button>
        <button type="button" onClick={onCancel}
          className="btn-secondary px-4 py-2 text-sm">
          {tCommon("cancel")}
        </button>
      </div>
    </form>
  );
}

// ─────────────────────────────────────────────
// Carte transporteur
// ─────────────────────────────────────────────

function CarrierCard({
  carrier, selected, onClick,
}: {
  carrier: Carrier; selected: boolean; onClick: () => void;
}) {
  const t = useTranslations("checkout");
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left border rounded-xl p-4 flex items-center gap-4 transition-all ${
        selected
          ? "border-text-primary bg-bg-secondary shadow-[0_0_0_2px_rgba(26,26,26,0.12)]"
          : "border-border bg-bg-primary hover:border-text-muted"
      }`}
    >
      <div className={`w-5 h-5 rounded-full border-2 shrink-0 flex items-center justify-center ${
        selected ? "border-text-primary" : "border-text-muted"
      }`}>
        {selected && <div className="w-2.5 h-2.5 rounded-full bg-text-primary" />}
      </div>
      <div className="flex-1">
        <p className="text-sm font-body font-semibold text-text-primary">
          {carrier.name}
        </p>
        <p className="text-xs text-text-secondary font-body mt-0.5">
          {carrier.delay}
        </p>
      </div>
      <p className="font-heading font-semibold text-sm text-text-primary shrink-0">
        {carrier.price === 0 ? t("free") : `${carrier.price.toFixed(2)} €`}
      </p>
    </button>
  );
}

// ─────────────────────────────────────────────
// Formulaire paiement Stripe
// ─────────────────────────────────────────────

const cardElementStyle = {
  style: {
    base: {
      fontSize: "15px",
      fontFamily: "var(--font-roboto), system-ui, sans-serif",
      color: "#1A1A1A",
      "::placeholder": { color: "#A3A3A3" },
      fontSmoothing: "antialiased",
    },
    invalid: {
      color: "#DC2626",
      iconColor: "#DC2626",
    },
  },
};

function StripePaymentForm({
  onSuccess,
  onError,
  disabled,
  clientSecret,
}: {
  onSuccess: (paymentIntentId: string) => void;
  onError: (msg: string) => void;
  disabled: boolean;
  clientSecret: string;
}) {
  const t = useTranslations("checkout");
  const stripe = useStripe();
  const elements = useElements();
  const [processing, setProcessing] = useState(false);
  const [ready, setReady] = useState({ number: false, expiry: false, cvc: false });
  const [focused, setFocused] = useState<string | null>(null);
  const [cardBrand, setCardBrand] = useState<string>("unknown");

  const allReady = ready.number && ready.expiry && ready.cvc;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements || processing || disabled) return;

    setProcessing(true);
    onError("");

    const cardElement = elements.getElement(CardNumberElement);
    if (!cardElement) {
      onError(t("paymentInitError"));
      setProcessing(false);
      return;
    }

    const { error, paymentIntent } = await stripe.confirmCardPayment(
      clientSecret,
      { payment_method: { card: cardElement } }
    );

    if (error) {
      onError(error.message ?? t("paymentError"));
      setProcessing(false);
    } else if (paymentIntent && paymentIntent.status === "succeeded") {
      onSuccess(paymentIntent.id);
    } else {
      onError(t("paymentNotCompleted"));
      setProcessing(false);
    }
  }

  const brandIcons: Record<string, React.ReactNode> = {
    visa: (
      <svg className="h-5" viewBox="0 0 48 16" fill="none">
        <path d="M17.4 1L11.6 15H8L5.1 4C4.9 3.2 4.8 2.9 4.1 2.5C3 1.9 1.3 1.3 0 1L0.1 0.5H5.8C6.5 0.5 7.1 1 7.3 1.8L8.7 9.3L12.8 0.5H16.4L17.4 1ZM33.2 10.4C33.2 6.7 28 6.5 28 4.8C28 4.3 28.5 3.7 29.5 3.6C31 3.5 32.5 3.8 33.3 4.3L33.8 1.3C33 1 31.8 0.5 30.3 0.5C26.9 0.5 24.5 2.3 24.5 5C24.5 7 26.3 8.1 27.6 8.8C29 9.5 29.4 9.9 29.4 10.5C29.4 11.4 28.3 11.7 27.3 11.7C25.7 11.7 24.7 11.4 23.8 10.9L23.3 14C24.3 14.4 26 14.8 27.7 14.8C31.4 14.8 33.2 13 33.2 10.4ZM42.6 15H46L43 0.5H40C39.4 0.5 38.8 0.8 38.6 1.5L33.5 15H37.1L37.8 13H42.2L42.6 15ZM38.8 10.2L40.6 5L41.6 10.2H38.8ZM23 0.5L20.2 15H16.8L19.6 0.5H23Z" fill="#1A1F71" />
      </svg>
    ),
    mastercard: (
      <svg className="h-5" viewBox="0 0 38 24" fill="none">
        <circle cx="14" cy="12" r="10" fill="#EB001B" opacity="0.9" />
        <circle cx="24" cy="12" r="10" fill="#F79E1B" opacity="0.9" />
        <path d="M19 4.6A10 10 0 0 1 23 12a10 10 0 0 1-4 7.4A10 10 0 0 1 15 12a10 10 0 0 1 4-7.4Z" fill="#FF5F00" />
      </svg>
    ),
    amex: (
      <svg className="h-5" viewBox="0 0 40 16" fill="none">
        <rect width="40" height="16" rx="2" fill="#006FCF" />
        <text x="20" y="11" textAnchor="middle" fill="white" fontSize="7" fontWeight="bold" fontFamily="sans-serif">AMEX</text>
      </svg>
    ),
    unknown: (
      <svg className="w-5 h-5 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5z" />
      </svg>
    ),
  };

  const fieldBaseClass = "bg-bg-primary rounded-xl px-4 py-3 border transition-all duration-200";
  const fieldFocusClass = "border-bg-dark ring-2 ring-bg-dark/10 bg-white";
  const fieldIdleClass = "border-border hover:border-border-dark";

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Card fields — clean light design */}
      <div className="space-y-3">
        {/* Card number */}
        <div>
          <label className="flex items-center justify-between mb-2">
            <span className="text-[0.8rem] font-medium text-text-secondary font-body">{t("cardNumber")}</span>
            <div className="flex items-center gap-1.5">
              {/* Brand logos always visible, active one highlighted */}
              <span className={`transition-opacity duration-200 ${cardBrand === "visa" ? "opacity-100" : "opacity-30"}`}>
                {brandIcons.visa}
              </span>
              <span className={`transition-opacity duration-200 ${cardBrand === "mastercard" ? "opacity-100" : "opacity-30"}`}>
                {brandIcons.mastercard}
              </span>
              <span className={`transition-opacity duration-200 ${cardBrand === "amex" ? "opacity-100" : "opacity-30"}`}>
                {brandIcons.amex}
              </span>
            </div>
          </label>
          <div className={`${fieldBaseClass} ${focused === "number" ? fieldFocusClass : fieldIdleClass}`}>
            <CardNumberElement
              options={{
                ...cardElementStyle,
                showIcon: false,
                disableLink: true,
              }}
              onReady={() => setReady((r) => ({ ...r, number: true }))}
              onFocus={() => setFocused("number")}
              onBlur={() => setFocused(null)}
              onChange={(e) => setCardBrand(e.brand ?? "unknown")}
            />
          </div>
        </div>

        {/* Expiry + CVC row */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[0.8rem] font-medium text-text-secondary font-body mb-2 block">
              {t("expiryDate")}
            </label>
            <div className={`${fieldBaseClass} ${focused === "expiry" ? fieldFocusClass : fieldIdleClass}`}>
              <CardExpiryElement
                options={cardElementStyle}
                onReady={() => setReady((r) => ({ ...r, expiry: true }))}
                onFocus={() => setFocused("expiry")}
                onBlur={() => setFocused(null)}
              />
            </div>
          </div>
          <div>
            <label className="flex items-center gap-1.5 text-[0.8rem] font-medium text-text-secondary font-body mb-2">
              CVC
              <span className="group relative cursor-help">
                <svg className="w-3.5 h-3.5 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M12 18h.01" />
                </svg>
                <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2.5 py-1.5 bg-bg-dark text-white text-[10px] rounded-lg whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none font-body">
                  {t("cvcTooltip")}
                </span>
              </span>
            </label>
            <div className={`${fieldBaseClass} ${focused === "cvc" ? fieldFocusClass : fieldIdleClass}`}>
              <CardCvcElement
                options={cardElementStyle}
                onReady={() => setReady((r) => ({ ...r, cvc: true }))}
                onFocus={() => setFocused("cvc")}
                onBlur={() => setFocused(null)}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Security badge */}
      <div className="flex items-center justify-center gap-2 py-1">
        <svg className="w-3.5 h-3.5 text-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
        </svg>
        <span className="text-[11px] text-text-muted font-body">{t("paymentSecureLong")}</span>
      </div>

      {/* Submit button */}
      <button
        type="submit"
        disabled={!stripe || !elements || processing || !allReady || disabled}
        className="btn-primary w-full justify-center disabled:opacity-40 disabled:cursor-not-allowed h-12 text-sm"
      >
        {processing ? (
          <>
            <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            {t("paymentInProgress")}
          </>
        ) : (
          <>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
            </svg>
            {t("confirmAndPay")}
          </>
        )}
      </button>
    </form>
  );
}

// ─────────────────────────────────────────────
// Page principale
// ─────────────────────────────────────────────

export default function CheckoutClient({
  cart,
  addresses: initialAddresses,
  user,
  clientDiscount,
}: {
  cart: CartData;
  addresses: Address[];
  user: UserInfo;
  clientDiscount?: ClientDiscount;
}) {
  const router = useRouter();
  const t = useTranslations("checkout");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const countryOptions = useCountryOptions();
  const [isPending, startTransition] = useTransition();
  const { showLoading, hideLoading } = useLoadingOverlay();
  const [orderError, setOrderError] = useState("");

  // Stripe
  const [clientSecret, setClientSecret]       = useState<string | null>(null);
  const [paymentIntentId, setPaymentIntentId] = useState<string | null>(null);
  const [stripeLoading, setStripeLoading]     = useState(false);
  const [stripeError, setStripeError]         = useState("");
  const [cgvAccepted, setCgvAccepted]         = useState(false);

  // Adresse de facturation (modifiable depuis le checkout, persistée sur le compte au save)
  const [billingInfo, setBillingInfo] = useState({
    firstName: user.firstName,
    lastName:  user.lastName,
    company:   user.company,
    email:     user.email,
    phone:     user.phone,
    siret:     user.siret,
    vatNumber: user.vatNumber ?? "",
    address1:  user.addressStreet     ?? "",
    address2:  user.addressComplement ?? "",
    zipCode:   user.addressZip        ?? "",
    city:      user.addressCity       ?? "",
    country:   user.addressCountry    ?? "FR",
  });
  const [editingInfo, setEditingInfo] = useState(false);
  const [sameAsBilling, setSameAsBilling] = useState(false);
  const [billingError, setBillingError] = useState("");
  // Mémorise l'id de l'adresse "miroir" de la facturation (créée ou trouvée),
  // pour ne PAS la recréer à chaque coche/décoche.
  const [billingMirrorAddrId, setBillingMirrorAddrId] = useState<string | null>(null);
  // Adresse sélectionnée AVANT la coche, pour pouvoir y revenir à la décoche.
  const [previousAddrId, setPreviousAddrId] = useState<string | null>(null);

  // Adresses
  const [addresses, setAddresses]   = useState<Address[]>(initialAddresses);
  const [selectedAddrId, setSelectedAddrId] = useState<string | null>(
    initialAddresses.find((a) => a.isDefault)?.id ?? initialAddresses[0]?.id ?? null
  );
  const [showAddressForm, setShowAddressForm] = useState(initialAddresses.length === 0);
  // null = création nouvelle adresse, sinon = édition de l'adresse avec cet id
  const [editingAddrId, setEditingAddrId] = useState<string | null>(null);
  const selectedAddr = addresses.find((a) => a.id === selectedAddrId) ?? null;

  // Mode de livraison : "delivery" (par défaut), "pickup" (retrait boutique) ou "private" (transporteur du client)
  const [deliveryMode, setDeliveryMode] = useState<"delivery" | "pickup" | "private">("delivery");

  // Transporteur privé : sous-mode + champs
  const [privateMode, setPrivateMode] = useState<"contact" | "bordereau">("contact");
  const [privateCarrierEmail,    setPrivateCarrierEmail]    = useState("");
  const [privateCarrierPhone,    setPrivateCarrierPhone]    = useState("");
  const [bordereauPath,          setBordereauPath]          = useState<string | null>(null);
  const [bordereauName,          setBordereauName]          = useState<string>("");
  const [bordereauUploading,     setBordereauUploading]     = useState(false);
  const [bordereauError,         setBordereauError]         = useState("");

  // Transporteurs
  const [carriers, setCarriers]         = useState<Carrier[]>([]);
  const [transactionId, setTransactionId] = useState<string>("");
  const [selectedCarrierId, setSelectedCarrierId] = useState<string | null>(null);
  const [carriersLoading, setCarriersLoading]     = useState(!!selectedAddrId);
  const [carriersError, setCarriersError]         = useState("");
  const [noCarrierConfigured, setNoCarrierConfigured] = useState(false);
  const [parcelCount, setParcelCount]             = useState<number>(0);
  const selectedCarrier = deliveryMode === "pickup"
    ? { id: "pickup_store", name: t("modePickup"), price: 0, delay: "" }
    : deliveryMode === "private"
      ? { id: "private_carrier", name: t("modePrivate"), price: 0, delay: "" }
      : (carriers.find((c) => c.id === selectedCarrierId) ?? null);

  // TVA — règles unifiées (lib/vat) :
  // France → 20 %, DOM-TOM → 0 %,
  // UE hors France + admin a validé l'exonération → 0 % sinon 20 %, hors UE → 0 %.
  // Le retrait en boutique n'écrase plus l'exonération B2B intracom validée.
  // Le transporteur privé est traité comme une livraison classique (TVA selon adresse).
  const isPickup = deliveryMode === "pickup";
  const tvaRate = resolveVatRate({
    countryCode: selectedAddr?.country ?? null,
    isPickup,
    vatExempt: user.vatExempt,
  });
  const tvaLabel = getTvaLabel(tvaRate, selectedAddr, isPickup, user.vatExempt, t);

  // Totaux
  const subtotalHT = cart.items.reduce(
    (s, item) => s + computeUnitPrice(item.variant) * item.quantity, 0
  );

  // Remise commerciale client
  const clientDiscountAmt = (() => {
    if (!clientDiscount?.discountType || !clientDiscount.discountValue) return 0;
    if (clientDiscount.discountType === "PERCENT")
      return Math.min(subtotalHT, subtotalHT * (clientDiscount.discountValue / 100));
    return Math.min(subtotalHT, clientDiscount.discountValue);
  })();
  const subtotalAfterDiscount = subtotalHT - clientDiscountAmt;

  const effectiveCarrierPrice = clientDiscount?.freeShipping ? 0 : (selectedCarrier?.price ?? 0);
  const tvaAmount = subtotalAfterDiscount * tvaRate;
  const totalTTC  = subtotalAfterDiscount + tvaAmount + effectiveCarrierPrice;

  // Poids total (pour Easy-Express)
  const totalWeightKg = cart.items.reduce((s, item) => {
    const units = item.variant.saleType === "PACK"
      ? (item.variant.packQuantity ?? 1) * item.quantity
      : item.quantity;
    return s + item.variant.weight * units;
  }, 0);

  // Charger les transporteurs quand l'adresse change
  useEffect(() => {
    if (!selectedAddr) { setCarriers([]); return; }

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
        zipCode:    selectedAddr.zipCode,
        country:    selectedAddr.country,
        weightKg:   totalWeightKg,
        subtotalHT,
      }),
      signal: controller.signal,
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) { setCarriersError(data.error); setCarriers([]); }
        else {
          setTransactionId(data.transactionId ?? "");
          setCarriers(data.carriers ?? []);
          setParcelCount(typeof data.parcelCount === "number" ? data.parcelCount : 0);
          if (data.noCarrierConfigured) setNoCarrierConfigured(true);
        }
      })
      .catch((err) => { if (err.name !== "AbortError") setCarriersError(t("carriersFetchError")); })
      .finally(() => setCarriersLoading(false));

    return () => controller.abort();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAddrId]);

  // Sauvegarder une nouvelle adresse
  function handleSaveAddress(data: typeof EMPTY_ADDR & { isDefault: boolean }) {
    showLoading();
    startTransition(async () => {
      try {
        const saved = await saveShippingAddress({ ...data, label: `${data.city} — ${data.address1}`.slice(0, 50) });
        setAddresses((prev) => {
          const updated = data.isDefault
            ? prev.map((a) => ({ ...a, isDefault: false }))
            : prev;
          return [...updated, saved as Address];
        });
        setSelectedAddrId((saved as Address).id);
        setShowAddressForm(false);
      } finally {
        hideLoading();
      }
    });
  }

  // Compare deux adresses sur les champs significatifs (insensible à la casse + espaces).
  function addrMatchesBilling(a: Address): boolean {
    const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
    return (
      norm(a.address1) === norm(billingInfo.address1) &&
      norm(a.address2) === norm(billingInfo.address2) &&
      norm(a.zipCode)  === norm(billingInfo.zipCode)  &&
      norm(a.city)     === norm(billingInfo.city)     &&
      norm(a.country)  === norm(billingInfo.country)
    );
  }

  function handleSameAsBilling(checked: boolean) {
    setSameAsBilling(checked);

    // Décoche : revenir à l'adresse précédente, ne RIEN supprimer en BDD.
    if (!checked) {
      if (previousAddrId && addresses.some((a) => a.id === previousAddrId)) {
        setSelectedAddrId(previousAddrId);
      }
      return;
    }

    if (!billingInfo.address1 || !billingInfo.zipCode || !billingInfo.city) return;

    // Mémorise la sélection en cours pour pouvoir y revenir à la décoche.
    setPreviousAddrId(selectedAddrId);

    // 1) On a déjà créé/réutilisé une adresse miroir pendant cette session
    //    et elle existe toujours → on la re-sélectionne, pas de doublon.
    if (billingMirrorAddrId) {
      const stillThere = addresses.find((a) => a.id === billingMirrorAddrId);
      if (stillThere && addrMatchesBilling(stillThere)) {
        setSelectedAddrId(billingMirrorAddrId);
        setShowAddressForm(false);
        return;
      }
    }

    // 2) Une adresse existante correspond exactement à la facturation
    //    → on l'utilise, pas de création.
    const existing = addresses.find(addrMatchesBilling);
    if (existing) {
      setBillingMirrorAddrId(existing.id);
      setSelectedAddrId(existing.id);
      setShowAddressForm(false);
      return;
    }

    // 3) Aucune adresse existante ne correspond → on en crée une seule fois.
    showLoading();
    startTransition(async () => {
      try {
        const saved = await saveShippingAddress({
          label: `${t("billingTitle")} — ${billingInfo.city}`,
          firstName: billingInfo.firstName,
          lastName:  billingInfo.lastName,
          company:   billingInfo.company,
          address1:  billingInfo.address1,
          address2:  billingInfo.address2,
          zipCode:   billingInfo.zipCode,
          city:      billingInfo.city,
          country:   billingInfo.country,
          phone:     billingInfo.phone,
          isDefault: false,
        });
        setAddresses((prev) => [...prev, saved as Address]);
        setBillingMirrorAddrId((saved as Address).id);
        setSelectedAddrId((saved as Address).id);
        setShowAddressForm(false);
      } finally {
        hideLoading();
      }
    });
  }

  function handleDeleteAddress(addrId: string) {
    showLoading();
    startTransition(async () => {
      try {
        await deleteShippingAddress(addrId);
        setAddresses((prev) => prev.filter((a) => a.id !== addrId));
        if (selectedAddrId === addrId) {
          setSelectedAddrId(null);
          setCarriers([]);
        }
      } finally {
        hideLoading();
      }
    });
  }

  // Pour le transporteur privé : il faut soit (email + téléphone) soit un bordereau
  const privateCarrierComplete = deliveryMode === "private"
    ? (privateMode === "contact"
        ? privateCarrierEmail.trim().length > 0 && privateCarrierPhone.trim().length > 0
        : !!bordereauPath)
    : true;

  const canProceed = !!selectedAddr && !!selectedCarrier && privateCarrierComplete;

  // Reset Stripe + carriers quand le mode de livraison change
  function handleDeliveryModeChange(mode: "delivery" | "pickup" | "private") {
    setDeliveryMode(mode);
    setSelectedCarrierId(null);
    setClientSecret(null);
    setPaymentIntentId(null);
    setStripeError("");
  }

  // ── Upload bordereau (Transporteur Privé) ─────────────────────────────────
  async function handleBordereauUpload(file: File) {
    setBordereauError("");
    setBordereauUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const result = await uploadBordereau(formData);
      if (result.success) {
        setBordereauPath(result.path);
        setBordereauName(file.name);
      } else {
        setBordereauError(result.error);
      }
    } catch {
      setBordereauError(t("uploadBordereauError"));
    } finally {
      setBordereauUploading(false);
    }
  }

  // ── Sauvegarde de la facturation (persistée sur le compte) ────────────────
  function handleSaveBilling() {
    setBillingError("");
    showLoading();
    startTransition(async () => {
      try {
        const result = await updateBillingInfo({
          firstName:         billingInfo.firstName,
          lastName:          billingInfo.lastName,
          company:           billingInfo.company,
          phone:             billingInfo.phone,
          vatNumber:         billingInfo.vatNumber,
          addressStreet:     billingInfo.address1,
          addressComplement: billingInfo.address2,
          addressZip:        billingInfo.zipCode,
          addressCity:       billingInfo.city,
          addressCountry:    billingInfo.country,
        });
        if (result.success) {
          setEditingInfo(false);
        } else {
          setBillingError(result.error);
        }
      } finally {
        hideLoading();
      }
    });
  }

  // ── Édition d'une adresse de livraison existante ──────────────────────────
  function handleEditAddress(addr: Address) {
    setEditingAddrId(addr.id);
    setShowAddressForm(true);
  }

  function handleUpdateAddress(data: typeof EMPTY_ADDR & { isDefault: boolean }) {
    if (!editingAddrId) return;
    showLoading();
    startTransition(async () => {
      try {
        const updated = await saveShippingAddress({
          id:        editingAddrId,
          label:     `${data.city} — ${data.address1}`.slice(0, 50),
          firstName: data.firstName,
          lastName:  data.lastName,
          company:   data.company,
          address1:  data.address1,
          address2:  data.address2,
          zipCode:   data.zipCode,
          city:      data.city,
          country:   data.country,
          phone:     data.phone,
          isDefault: data.isDefault,
        });
        setAddresses((prev) => {
          const next = data.isDefault
            ? prev.map((a) => ({ ...a, isDefault: false }))
            : prev;
          return next.map((a) => (a.id === editingAddrId ? (updated as Address) : a));
        });
        setEditingAddrId(null);
        setShowAddressForm(false);
      } finally {
        hideLoading();
      }
    });
  }

  // Créer le Payment Intent Stripe uniquement quand le client clique "Procéder au paiement"
  async function handleInitiatePayment() {
    if (!canProceed || clientSecret) return;
    setStripeLoading(true);
    setStripeError("");
    try {
      const res = await fetch("/api/payments/create-intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // tvaRate n'est plus envoyé : le serveur le recalcule depuis l'adresse
        // de livraison + le mode (livraison/retrait) + le flag vatExempt admin.
        body: JSON.stringify({
          addressId:    selectedAddr!.id,
          carrierId:    selectedCarrier!.id,
          carrierName:  selectedCarrier!.name,
          carrierPrice: effectiveCarrierPrice,
        }),
      });
      const data = await res.json();
      if (data.error) {
        setStripeError(data.error);
      } else {
        setClientSecret(data.clientSecret);
        setPaymentIntentId(data.paymentIntentId);
      }
    } catch {
      setStripeError(t("paymentInitFailed"));
    } finally {
      setStripeLoading(false);
    }
  }

  // Réinitialiser Stripe si l'adresse, le transporteur ou le mode de livraison change
  useEffect(() => {
    setClientSecret(null);
    setPaymentIntentId(null);
    setStripeError("");
  }, [selectedAddrId, selectedCarrierId, deliveryMode, privateMode, privateCarrierEmail, privateCarrierPhone, bordereauPath]);

  // Si la facturation change après qu'on ait coché « même adresse », l'adresse
  // miroir n'est plus à jour → on décoche pour éviter un envoi sur la mauvaise
  // adresse, et on oublie la référence pour qu'un futur coche refasse le calcul.
  useEffect(() => {
    if (!sameAsBilling) return;
    if (!billingMirrorAddrId) return;
    const mirror = addresses.find((a) => a.id === billingMirrorAddrId);
    if (!mirror || !addrMatchesBilling(mirror)) {
      setSameAsBilling(false);
      setBillingMirrorAddrId(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [billingInfo.address1, billingInfo.address2, billingInfo.zipCode, billingInfo.city, billingInfo.country]);

  // Après paiement Stripe réussi (carte) → créer la commande et rediriger
  function handlePaymentSuccess(piId: string) {
    setOrderError("");
    showLoading();
    startTransition(async () => {
      try {
        const result = await placeOrder({
          addressId:             selectedAddr!.id,
          carrierId:             selectedCarrier!.id,
          transactionId,
          carrierName:           selectedCarrier!.name,
          carrierPrice:          effectiveCarrierPrice,
          stripePaymentIntentId: piId,
          cgvAcceptedAt:         new Date().toISOString(),
          // Transporteur privé : on envoie soit email/tel soit le bordereau
          ...(deliveryMode === "private"
            ? privateMode === "contact"
              ? {
                  privateCarrierEmail: privateCarrierEmail.trim(),
                  privateCarrierPhone: privateCarrierPhone.trim(),
                }
              : { privateCarrierBordereau: bordereauPath ?? undefined }
            : {}),
        });
        if (result.success) {
          router.push(`/commandes/${result.orderId}?success=1`);
        } else {
          setOrderError(result.error);
        }
      } finally {
        hideLoading();
      }
    });
  }

  // Indicateurs de complétion pour les sections
  const section1Complete = !!(billingInfo.firstName && billingInfo.lastName && billingInfo.email);
  const section2Complete = !!selectedAddr;
  const section3Complete = !!selectedCarrier && privateCarrierComplete;

  return (
    <div className="container-site py-10 md:py-14">
      {/* Stepper */}
      <CheckoutStepper currentStep={1} />

      {/* En-tête */}
      <div className="flex items-end justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="font-heading text-2xl md:text-3xl font-bold text-text-primary">
            {t("finalize")}
          </h1>
          <p className="text-sm font-body text-text-secondary mt-1">
            {t("finalizeDesc")}
          </p>
        </div>
        <Link href="/panier"
          className="inline-flex items-center gap-1.5 text-sm font-body text-text-muted hover:text-text-primary transition-colors group">
          <svg className="w-4 h-4 transition-transform group-hover:-translate-x-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
          </svg>
          {t("backToCart")}
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-8 items-start">

        {/* ── Colonne principale ─────────────────── */}
        <div className="lg:col-span-2 space-y-6">

          {/* ── 1. Adresse de facturation ── */}
          <section className="bg-bg-primary border border-border rounded-2xl overflow-hidden shadow-sm">
            <SectionHeader step={1} title={t("billingTitle")} complete={section1Complete}>
              <button type="button" onClick={() => setEditingInfo((v) => !v)}
                className="text-xs font-body text-text-secondary hover:text-text-primary transition-colors">
                {editingInfo ? t("close") : t("edit")}
              </button>
            </SectionHeader>

            {editingInfo ? (
              <div className="p-5 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <FieldInput id="bi-fn" label={t("addressFirstName")} value={billingInfo.firstName} onChange={(v) => setBillingInfo((p) => ({ ...p, firstName: v }))} required />
                  <FieldInput id="bi-ln" label={t("addressLastName")} value={billingInfo.lastName} onChange={(v) => setBillingInfo((p) => ({ ...p, lastName: v }))} required />
                </div>
                <FieldInput id="bi-co" label={t("addressCompany")} value={billingInfo.company} onChange={(v) => setBillingInfo((p) => ({ ...p, company: v }))} required />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <FieldInput id="bi-email" label={t("billingEmail")} value={billingInfo.email} onChange={(v) => setBillingInfo((p) => ({ ...p, email: v }))} type="email" required />
                  <FieldInput id="bi-phone" label={t("addressPhone")} value={billingInfo.phone} onChange={(v) => setBillingInfo((p) => ({ ...p, phone: v }))} type="tel" required />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-body font-medium text-text-primary mb-1.5">{t("billingSiret")}</label>
                    <input
                      type="text"
                      value={billingInfo.siret}
                      readOnly
                      className="field-input w-full bg-bg-secondary text-text-muted cursor-not-allowed"
                    />
                  </div>
                  <FieldInput
                    id="bi-vat"
                    label={t("vatNumber")}
                    value={billingInfo.vatNumber}
                    onChange={(v) => setBillingInfo((p) => ({ ...p, vatNumber: v.toUpperCase() }))}
                    optional
                    placeholder={t("vatPlaceholder")}
                  />
                </div>
                <div className="border-t border-border pt-4 mt-2">
                  <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider font-body mb-3">{t("addressLabelShort")}</p>
                  <div className="space-y-4">
                    <FieldInput id="bi-a1" label={t("addressLine1")} value={billingInfo.address1} onChange={(v) => setBillingInfo((p) => ({ ...p, address1: v }))} placeholder={t("addressLine1Placeholder")} />
                    <FieldInput id="bi-a2" label={t("addressLine2")} value={billingInfo.address2} onChange={(v) => setBillingInfo((p) => ({ ...p, address2: v }))} optional placeholder={t("addressLine2Placeholder")} />
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <FieldInput id="bi-zip" label={t("addressZipCode")} value={billingInfo.zipCode} onChange={(v) => setBillingInfo((p) => ({ ...p, zipCode: v }))} />
                      <FieldInput id="bi-city" label={t("addressCity")} value={billingInfo.city} onChange={(v) => setBillingInfo((p) => ({ ...p, city: v }))} />
                    </div>
                    <div>
                      <label htmlFor="bi-country" className="block text-sm font-body font-medium text-text-primary mb-1.5">{t("addressCountry")}</label>
                      <CustomSelect
                        id="bi-country"
                        value={billingInfo.country}
                        onChange={(v) => setBillingInfo((p) => ({ ...p, country: v }))}
                        options={countryOptions.map((c) => ({ value: c.code, label: c.label }))}
                      />
                    </div>
                  </div>
                </div>
                {billingError && (
                  <div className="bg-[#FEE2E2] border border-[#FECACA] text-[#DC2626] text-xs font-body px-3 py-2 rounded-lg">
                    {billingError}
                  </div>
                )}
                <div className="flex gap-3">
                  <button type="button" onClick={handleSaveBilling} disabled={isPending} className="btn-primary text-sm disabled:opacity-60">
                    {isPending ? t("saving") : t("save")}
                  </button>
                  <button type="button" onClick={() => { setEditingInfo(false); setBillingError(""); }} className="btn-secondary text-sm">
                    {tCommon("cancel")}
                  </button>
                </div>
              </div>
            ) : (
              <div className="p-5 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm font-body">
                  <InfoLine label={t("addressCompany")} value={billingInfo.company} />
                  <InfoLine label={t("contact")}        value={`${billingInfo.firstName} ${billingInfo.lastName}`} />
                  <InfoLine label={t("billingEmail")}   value={billingInfo.email} />
                  <InfoLine label={t("addressPhone")}   value={billingInfo.phone} />
                  <InfoLine label={t("billingSiret")}   value={billingInfo.siret} mono />
                  <InfoLine label={t("vatNumberShort")} value={billingInfo.vatNumber || "—"} mono />
                </div>
                <div className="border-t border-border pt-3">
                  <p className="text-xs font-semibold text-text-muted uppercase tracking-wider font-body mb-1">{t("addressLabelShort")}</p>
                  {billingInfo.address1 ? (
                    <>
                      <p className="text-sm text-text-primary font-body">
                        {billingInfo.address1}{billingInfo.address2 ? `, ${billingInfo.address2}` : ""}
                      </p>
                      <p className="text-sm text-text-secondary font-body">
                        {billingInfo.zipCode} {billingInfo.city}, {countryOptions.find((c) => c.code === billingInfo.country)?.label ?? billingInfo.country}
                      </p>
                    </>
                  ) : (
                    <p className="text-sm text-text-muted font-body italic">{t("noBillingAddress")}</p>
                  )}
                </div>
              </div>
            )}
          </section>

          {/* ── 2. Adresse de livraison ── */}
          <section className="bg-bg-primary border border-border rounded-2xl overflow-hidden shadow-sm">
            <SectionHeader step={2} title={t("shippingAddressTitle")} complete={section2Complete}>
              {!showAddressForm && (
                <button type="button" onClick={() => { setEditingAddrId(null); setShowAddressForm(true); }}
                  className="text-xs font-body text-text-secondary hover:text-text-primary transition-colors flex items-center gap-1.5">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.5v15m7.5-7.5h-15" />
                  </svg>
                  {t("newAddress")}
                </button>
              )}
            </SectionHeader>
            <div className="p-5 space-y-3">
              {/* Option: meme adresse que facturation — mise en avant */}
              {billingInfo.address1 && billingInfo.zipCode && billingInfo.city && !showAddressForm && (
                <label className={`flex items-start gap-3 p-4 border-2 rounded-xl text-sm font-body cursor-pointer transition-all ${
                  sameAsBilling
                    ? "border-text-primary bg-bg-secondary shadow-[0_0_0_2px_rgba(26,26,26,0.08)]"
                    : "border-dashed border-border-dark bg-bg-primary hover:bg-bg-secondary hover:border-text-muted"
                }`}>
                  <input
                    type="checkbox"
                    checked={sameAsBilling}
                    onChange={(e) => handleSameAsBilling(e.target.checked)}
                    className="accent-text-primary w-4 h-4 mt-0.5 shrink-0"
                  />
                  <div className="min-w-0">
                    <p className="font-semibold text-text-primary">
                      {t("billToBilling")}
                    </p>
                    <p className="text-xs text-text-secondary mt-0.5">
                      {billingInfo.address1}{billingInfo.address2 ? `, ${billingInfo.address2}` : ""} — {billingInfo.zipCode} {billingInfo.city}
                    </p>
                  </div>
                </label>
              )}

              {/* Liste adresses existantes */}
              {!showAddressForm && addresses.map((addr) => (
                <div key={addr.id} className={`border rounded-xl p-4 transition-all ${
                  selectedAddrId === addr.id
                    ? "border-text-primary bg-bg-secondary shadow-[0_0_0_2px_rgba(26,26,26,0.1)]"
                    : "border-border bg-bg-primary hover:border-text-muted"
                }`}>
                  <button
                    type="button"
                    onClick={() => setSelectedAddrId(addr.id)}
                    className="w-full text-left"
                  >
                    <div className="flex items-start gap-3">
                      <div className={`w-4 h-4 rounded-full border-2 mt-0.5 shrink-0 flex items-center justify-center ${
                        selectedAddrId === addr.id ? "border-text-primary" : "border-text-muted"
                      }`}>
                        {selectedAddrId === addr.id && (
                          <div className="w-2 h-2 rounded-full bg-text-primary" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-body font-semibold text-text-primary">
                          {addr.firstName} {addr.lastName}
                          {addr.isDefault && (
                            <span className="ml-2 text-[10px] font-normal bg-bg-secondary text-text-secondary px-1.5 py-0.5 rounded-full">
                              {t("defaultBadge")}
                            </span>
                          )}
                        </p>
                        {addr.company && (
                          <p className="text-xs text-text-secondary font-body mt-0.5">{addr.company}</p>
                        )}
                        <p className="text-xs text-text-muted font-body">
                          {addr.address1}{addr.address2 ? `, ${addr.address2}` : ""} — {addr.zipCode} {addr.city}, {addr.country}
                        </p>
                      </div>
                    </div>
                  </button>
                  <div className="flex justify-end mt-2 gap-3">
                    <button
                      type="button"
                      onClick={() => handleEditAddress(addr)}
                      disabled={isPending}
                      className="text-[11px] text-text-muted hover:text-text-primary font-body transition-colors flex items-center gap-1"
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
                      </svg>
                      {t("edit")}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteAddress(addr.id)}
                      disabled={isPending}
                      className="text-[11px] text-text-muted hover:text-error font-body transition-colors flex items-center gap-1"
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                      </svg>
                      {t("delete")}
                    </button>
                  </div>
                </div>
              ))}

              {/* Formulaire nouvelle adresse OU édition d'une existante */}
              {showAddressForm && (
                editingAddrId ? (
                  (() => {
                    const editing = addresses.find((a) => a.id === editingAddrId);
                    if (!editing) return null;
                    return (
                      <>
                        <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider font-body">
                          {t("editAddressTitle")}
                        </p>
                        <AddressForm
                          isEditing
                          initial={{
                            firstName: editing.firstName,
                            lastName:  editing.lastName,
                            company:   editing.company ?? "",
                            address1:  editing.address1,
                            address2:  editing.address2 ?? "",
                            zipCode:   editing.zipCode,
                            city:      editing.city,
                            country:   editing.country,
                            phone:     editing.phone ?? "",
                          }}
                          initialIsDefault={editing.isDefault}
                          onSave={handleUpdateAddress}
                          onCancel={() => { setShowAddressForm(false); setEditingAddrId(null); }}
                          isSaving={isPending}
                        />
                      </>
                    );
                  })()
                ) : (
                  <AddressForm
                    onSave={handleSaveAddress}
                    onCancel={() => setShowAddressForm(false)}
                    isSaving={isPending}
                  />
                )
              )}

              {addresses.length === 0 && !showAddressForm && (
                <p className="text-sm text-text-muted font-body text-center py-4">
                  {t("noAddress")}
                </p>
              )}
            </div>
          </section>

          {/* ── 3. Mode de livraison ── */}
          <section className="bg-bg-primary border border-border rounded-2xl overflow-hidden shadow-sm">
            <SectionHeader step={3} title={t("deliveryModeTitle")} complete={section3Complete} />
            <div className="p-5 space-y-4">
              {/* Choix livraison / retrait / transporteur privé */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <button
                  type="button"
                  onClick={() => handleDeliveryModeChange("delivery")}
                  className={`flex flex-col items-center gap-2 p-4 border rounded-xl transition-all ${
                    deliveryMode === "delivery"
                      ? "border-text-primary bg-bg-secondary shadow-[0_0_0_2px_rgba(26,26,26,0.12)]"
                      : "border-border bg-bg-primary hover:border-text-muted"
                  }`}
                >
                  <svg className="w-6 h-6 text-text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                      d="M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0H21M3.375 14.25h3.75L8.25 9.75H3.375m0 4.5V5.625c0-.621.504-1.125 1.125-1.125h9.75c.621 0 1.125.504 1.125 1.125v4.125m-13.5 4.5h13.5m0 0l1.125-4.5h2.25c.621 0 1.125.504 1.125 1.125v3.375" />
                  </svg>
                  <span className="text-sm font-body font-semibold text-text-primary">
                    {t("modeDelivery")}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => handleDeliveryModeChange("pickup")}
                  className={`flex flex-col items-center gap-2 p-4 border rounded-xl transition-all ${
                    deliveryMode === "pickup"
                      ? "border-text-primary bg-bg-secondary shadow-[0_0_0_2px_rgba(26,26,26,0.12)]"
                      : "border-border bg-bg-primary hover:border-text-muted"
                  }`}
                >
                  <svg className="w-6 h-6 text-text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                      d="M13.5 21v-7.5a.75.75 0 01.75-.75h3a.75.75 0 01.75.75V21m-4.5 0H2.36m11.14 0H18m0 0h3.64m-1.39 0V9.349m-16.5 11.65V9.35m0 0a3.001 3.001 0 003.75-.615A2.993 2.993 0 009.75 9.75c.896 0 1.7-.393 2.25-1.016a2.993 2.993 0 002.25 1.016c.896 0 1.7-.393 2.25-1.016A3.001 3.001 0 0021 9.349m-18 0a2.999 2.999 0 00.97-1.599L5.03 3.75h13.94l1.06 4A2.999 2.999 0 003 9.349" />
                  </svg>
                  <span className="text-sm font-body font-semibold text-text-primary">
                    {t("modePickup")}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => handleDeliveryModeChange("private")}
                  className={`flex flex-col items-center gap-2 p-4 border rounded-xl transition-all ${
                    deliveryMode === "private"
                      ? "border-text-primary bg-bg-secondary shadow-[0_0_0_2px_rgba(26,26,26,0.12)]"
                      : "border-border bg-bg-primary hover:border-text-muted"
                  }`}
                >
                  <svg className="w-6 h-6 text-text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                      d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0V12a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 12V5.25" />
                  </svg>
                  <span className="text-sm font-body font-semibold text-text-primary">
                    {t("modePrivate")}
                  </span>
                </button>
              </div>

              {/* Retrait en boutique — info */}
              {deliveryMode === "pickup" && (
                <div className="bg-bg-secondary border border-border rounded-xl p-4">
                  <div className="flex items-start gap-3">
                    <svg className="w-5 h-5 text-accent-dark shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                        d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                        d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
                    </svg>
                    <div>
                      <p className="text-sm font-body font-semibold text-text-primary">
                        {t("pickupFreeTitle")}
                      </p>
                      <p className="text-xs text-text-secondary font-body mt-1">
                        {t("pickupFreeDesc")}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Transporteur privé — sous-options */}
              {deliveryMode === "private" && (
                <div className="space-y-3">
                  <div className="bg-bg-secondary border border-border rounded-xl p-4">
                    <div className="flex items-start gap-3">
                      <svg className="w-5 h-5 text-accent-dark shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
                      </svg>
                      <div>
                        <p className="text-sm font-body font-semibold text-text-primary">
                          {t("privateSelfTitle")}
                        </p>
                        <p className="text-xs text-text-secondary font-body mt-1">
                          {t("privateSelfDesc")}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Switch entre les 2 sous-modes */}
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setPrivateMode("contact")}
                      className={`flex items-center gap-2 p-3 border rounded-xl transition-all text-sm font-body ${
                        privateMode === "contact"
                          ? "border-text-primary bg-bg-secondary shadow-[0_0_0_2px_rgba(26,26,26,0.08)] font-semibold text-text-primary"
                          : "border-border bg-bg-primary hover:border-text-muted text-text-secondary"
                      }`}
                    >
                      <div className={`w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center ${
                        privateMode === "contact" ? "border-text-primary" : "border-text-muted"
                      }`}>
                        {privateMode === "contact" && <div className="w-2 h-2 rounded-full bg-text-primary" />}
                      </div>
                      {t("privateContactMode")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setPrivateMode("bordereau")}
                      className={`flex items-center gap-2 p-3 border rounded-xl transition-all text-sm font-body ${
                        privateMode === "bordereau"
                          ? "border-text-primary bg-bg-secondary shadow-[0_0_0_2px_rgba(26,26,26,0.08)] font-semibold text-text-primary"
                          : "border-border bg-bg-primary hover:border-text-muted text-text-secondary"
                      }`}
                    >
                      <div className={`w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center ${
                        privateMode === "bordereau" ? "border-text-primary" : "border-text-muted"
                      }`}>
                        {privateMode === "bordereau" && <div className="w-2 h-2 rounded-full bg-text-primary" />}
                      </div>
                      {t("privateBordereauMode")}
                    </button>
                  </div>

                  {/* Mode contact : email + téléphone */}
                  {privateMode === "contact" && (
                    <div className="space-y-4 border border-border rounded-xl p-4 bg-bg-primary">
                      <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider font-body">
                        {t("carrierContactTitle")}
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <FieldInput
                          id="pc-email"
                          label={t("carrierEmail")}
                          value={privateCarrierEmail}
                          onChange={setPrivateCarrierEmail}
                          type="email"
                          placeholder="contact@transporteur.com"
                          required
                        />
                        <FieldInput
                          id="pc-phone"
                          label={t("carrierPhone")}
                          value={privateCarrierPhone}
                          onChange={setPrivateCarrierPhone}
                          type="tel"
                          placeholder={t("phonePlaceholder")}
                          required
                        />
                      </div>
                      <p className="text-xs text-text-muted font-body">
                        {t("carrierContactNotice")}
                      </p>
                    </div>
                  )}

                  {/* Mode bordereau : upload fichier */}
                  {privateMode === "bordereau" && (
                    <div className="space-y-3 border border-border rounded-xl p-4 bg-bg-primary">
                      <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider font-body">
                        {t("bordereauTitle")}
                      </p>
                      {bordereauPath ? (
                        <div className="flex items-center justify-between gap-3 p-3 bg-bg-secondary border border-border rounded-lg">
                          <div className="flex items-center gap-2 min-w-0">
                            <svg className="w-5 h-5 text-success shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            <p className="text-sm font-body text-text-primary truncate">
                              {bordereauName || t("bordereauSaved")}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => { setBordereauPath(null); setBordereauName(""); setBordereauError(""); }}
                            className="text-xs text-text-muted hover:text-error font-body transition-colors shrink-0"
                          >
                            {t("replace")}
                          </button>
                        </div>
                      ) : (
                        <label className={`flex flex-col items-center justify-center gap-2 p-6 border-2 border-dashed rounded-xl cursor-pointer transition-all ${
                          bordereauUploading
                            ? "border-text-muted bg-bg-secondary"
                            : "border-border-dark bg-bg-secondary/40 hover:bg-bg-secondary hover:border-text-muted"
                        }`}>
                          <input
                            type="file"
                            accept="application/pdf,image/jpeg,image/jpg,image/png"
                            disabled={bordereauUploading}
                            className="hidden"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) handleBordereauUpload(file);
                              e.target.value = "";
                            }}
                          />
                          {bordereauUploading ? (
                            <>
                              <svg className="animate-spin w-5 h-5 text-text-muted" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                              </svg>
                              <span className="text-sm font-body text-text-muted">{t("uploadingBordereau")}</span>
                            </>
                          ) : (
                            <>
                              <svg className="w-6 h-6 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                              </svg>
                              <span className="text-sm font-body font-medium text-text-primary">
                                {t("uploadDrop")}
                              </span>
                              <span className="text-xs text-text-muted font-body">
                                {t("uploadFormatsBordereau")}
                              </span>
                            </>
                          )}
                        </label>
                      )}
                      {bordereauError && (
                        <p className="text-xs text-error font-body">{bordereauError}</p>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Transporteurs (mode livraison uniquement) */}
              {deliveryMode === "delivery" && (
                <div className="space-y-3">
                  {!selectedAddr && (
                    <p className="text-sm text-text-muted font-body text-center py-3">
                      {t("selectAddressFirst")}
                    </p>
                  )}

                  {selectedAddr && carriersLoading && (
                    <div className="flex items-center justify-center py-8 gap-3 text-text-muted">
                      <svg className="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      <span className="text-sm font-body">{t("carriersLoadingShort")}</span>
                    </div>
                  )}

                  {selectedAddr && !carriersLoading && carriersError && (
                    <div className="bg-[#FEE2E2] border border-[#FECACA] text-[#DC2626] px-4 py-3 text-sm rounded-lg font-body">
                      {carriersError}
                    </div>
                  )}

                  {selectedAddr && !carriersLoading && !carriersError && carriers.length === 0 && (
                    <div className={`text-sm font-body text-center py-3 ${noCarrierConfigured ? "bg-[#FEF3C7] border border-[#FDE68A] text-[#92400E] px-4 rounded-lg" : "text-text-muted"}`}>
                      {noCarrierConfigured
                        ? t("noCarriersConfigured")
                        : t("noCarriersAvailable")}
                    </div>
                  )}

                  {selectedAddr && !carriersLoading && !carriersError && carriers.length > 0 && parcelCount > 1 && (
                    <div className="flex items-center gap-3 bg-bg-secondary border border-border rounded-lg px-4 py-3 text-sm font-body text-text-secondary">
                      <svg className="w-5 h-5 shrink-0 text-text-primary" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="m3.27 6.96 8.73 5.04 8.73-5.04M12 22V12" />
                      </svg>
                      <span>
                        {t("multipleParcelsInfo", { count: parcelCount, weight: totalWeightKg.toFixed(1) })}
                      </span>
                    </div>
                  )}

                  {carriers.map((carrier) => (
                    <CarrierCard
                      key={carrier.id}
                      carrier={carrier}
                      selected={selectedCarrierId === carrier.id}
                      onClick={() => setSelectedCarrierId(carrier.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>

        {/* ── Récapitulatif ───────────────────────── */}
        <div>
          <SummaryPanel
            cart={cart}
            computeUnitPrice={computeUnitPrice}
            subtotalHT={subtotalHT}
            clientDiscountAmt={clientDiscountAmt}
            clientDiscount={clientDiscount}
            subtotalAfterDiscount={subtotalAfterDiscount}
            tvaRate={tvaRate}
            tvaLabel={tvaLabel}
            tvaAmount={tvaAmount}
            selectedAddr={selectedAddr}
            deliveryMode={deliveryMode}
            selectedCarrier={selectedCarrier}
            canProceed={canProceed}
            totalTTC={totalTTC}
            orderError={orderError}
            stripeError={stripeError}
            cgvAccepted={cgvAccepted}
            setCgvAccepted={setCgvAccepted}
            clientSecret={clientSecret}
            stripeLoading={stripeLoading}
            handleInitiatePayment={handleInitiatePayment}
            handlePaymentSuccess={handlePaymentSuccess}
            setStripeError={setStripeError}
            isPending={isPending}
          />
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Summary panel — collapsible on mobile, sticky on desktop
// ─────────────────────────────────────────────

function SummaryPanel({
  cart, computeUnitPrice: computePrice, subtotalHT, clientDiscountAmt, clientDiscount,
  subtotalAfterDiscount, tvaLabel, tvaAmount, selectedAddr, deliveryMode,
  selectedCarrier, canProceed, totalTTC, orderError, stripeError, cgvAccepted,
  setCgvAccepted, clientSecret, stripeLoading, handleInitiatePayment,
  handlePaymentSuccess, setStripeError, isPending,
}: {
  cart: CartData;
  computeUnitPrice: (v: VariantData) => number;
  subtotalHT: number;
  clientDiscountAmt: number;
  clientDiscount?: ClientDiscount;
  subtotalAfterDiscount: number;
  tvaRate: number;
  tvaLabel: string;
  tvaAmount: number;
  selectedAddr: Address | null;
  deliveryMode: "delivery" | "pickup" | "private";
  selectedCarrier: Carrier | { id: string; name: string; price: number; delay: string } | null;
  canProceed: boolean;
  totalTTC: number;
  orderError: string;
  stripeError: string;
  cgvAccepted: boolean;
  setCgvAccepted: (v: boolean) => void;
  clientSecret: string | null;
  stripeLoading: boolean;
  handleInitiatePayment: () => void;
  handlePaymentSuccess: (piId: string) => void;
  setStripeError: (v: string) => void;
  isPending: boolean;
}) {
  const t = useTranslations("checkout");
  const tCart = useTranslations("cart");
  const locale = useLocale();
  const [mobileOpen, setMobileOpen] = useState(true);
  const itemCount = cart.items.reduce((s, i) => s + i.quantity, 0);

  return (
    <div className="bg-bg-primary border border-border rounded-2xl shadow-sm overflow-hidden sticky top-24">
      {/* Header — clickable on mobile to toggle */}
      <button
        type="button"
        onClick={() => setMobileOpen((v) => !v)}
        className="w-full px-5 py-4 border-b border-border-light bg-bg-secondary/50 flex items-center justify-between lg:cursor-default"
      >
        <h3 className="font-heading text-sm font-semibold text-text-primary">
          {t("summaryTitle")}
        </h3>
        <div className="flex items-center gap-2">
          <span className="text-xs font-body text-text-muted lg:hidden">
            {tCart("categoryItemsCount", { count: itemCount })} {canProceed ? `— ${totalTTC.toFixed(2)} \u20AC` : ""}
          </span>
          <svg className={`w-4 h-4 text-text-muted transition-transform lg:hidden ${mobileOpen ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      <div className={`${mobileOpen ? "block" : "hidden"} lg:block`}>

            {/* Articles */}
            <div className="px-5 py-4 space-y-2 border-b border-border">
              {cart.items.map((item) => {
                const price     = computePrice(item.variant);
                const lineTotal = price * item.quantity;
                return (
                  <div key={item.id} className="flex items-start gap-2 text-xs font-body">
                    <div className="w-8 h-8 rounded-lg overflow-hidden bg-bg-secondary shrink-0">
                      {item.variantImages[0]?.path ? (
                        <Image src={item.variantImages[0]!.path}
                          alt={item.variant.product.name}
                          width={80} height={80} unoptimized
                          className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full bg-bg-secondary" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-text-primary font-medium line-clamp-1">{item.variant.product.name}</p>
                      <p className="text-text-muted">
                        {item.variant.color.name}
                        {item.variant.saleType === "PACK" ? ` · ×${item.variant.packQuantity}` : ""}
                        {" "}× {item.quantity}
                      </p>
                    </div>
                    <span className="text-text-primary font-semibold shrink-0">{lineTotal.toFixed(2)} €</span>
                  </div>
                );
              })}
            </div>

            {/* Totaux */}
            <div className="px-5 py-4 space-y-2 text-sm font-body">
              <div className="flex justify-between text-text-secondary">
                <span>{t("subtotalHT")}</span>
                <span className="font-medium text-text-primary">{subtotalHT.toFixed(2)} €</span>
              </div>

              {/* Remise commerciale */}
              {clientDiscountAmt > 0 && (
                <div className="flex justify-between text-accent-dark">
                  <span className="flex items-center gap-1">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M17 17h.01M7 17h.01M17 7h.01M3 12h18M12 3v18" />
                    </svg>
                    {t("discount")}{clientDiscount?.discountType === "PERCENT" && clientDiscount.discountValue
                      ? ` (${clientDiscount.discountValue}%)`
                      : ""}
                  </span>
                  <span className="font-medium">-{clientDiscountAmt.toFixed(2)} €</span>
                </div>
              )}

              {clientDiscountAmt > 0 && (
                <div className="flex justify-between text-text-secondary">
                  <span>{t("subtotalAfterDiscount")}</span>
                  <span className="font-medium text-text-primary">{subtotalAfterDiscount.toFixed(2)} €</span>
                </div>
              )}

              <div className="flex justify-between text-text-secondary">
                <span>{t("tva")} <span className="text-xs text-text-muted">({tvaLabel})</span></span>
                <span className="font-medium text-text-primary">
                  {selectedAddr ? `${tvaAmount.toFixed(2)} €` : "—"}
                </span>
              </div>
              <div className="flex justify-between text-text-secondary">
                <span>
                  {deliveryMode === "pickup"
                    ? t("modePickup")
                    : deliveryMode === "private"
                      ? t("modePrivate")
                      : t("shippingMode")}
                </span>
                <span className={`font-medium ${
                  (deliveryMode === "pickup" || deliveryMode === "private" || (clientDiscount?.freeShipping && selectedCarrier))
                    ? "text-accent-dark"
                    : "text-text-primary"
                }`}>
                  {deliveryMode === "pickup" || deliveryMode === "private"
                    ? t("free")
                    : selectedCarrier
                      ? (clientDiscount?.freeShipping
                          ? t("offered")
                          : selectedCarrier.price === 0 ? t("free") : `${selectedCarrier.price.toFixed(2)} €`)
                      : "—"}
                </span>
              </div>

              <div className="border-t border-border pt-3 flex justify-between items-center mt-2">
                <span className="font-semibold text-text-primary">{t("totalTTC")}</span>
                <span className="font-heading font-semibold text-lg text-text-primary">
                  {canProceed ? `${totalTTC.toFixed(2)} €` : "—"}
                </span>
              </div>
            </div>

            {/* Paiement Stripe */}
            <div className="px-5 pb-5 space-y-3">
              {(orderError || stripeError) && (
                <div className="bg-[#FEE2E2] border border-[#FECACA] text-[#DC2626] text-xs font-body px-3 py-2 rounded-lg">
                  {orderError || stripeError}
                </div>
              )}

              {!canProceed && (
                <p className="text-xs text-text-muted font-body text-center py-2">
                  {t("selectAddressCarrierForPayment")}
                </p>
              )}

              {/* CGV acceptance checkbox */}
              {canProceed && !clientSecret && (
                <label className="flex items-start gap-2.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={cgvAccepted}
                    onChange={(e) => setCgvAccepted(e.target.checked)}
                    className="checkbox-custom mt-0.5 shrink-0"
                  />
                  <span className="text-xs text-text-secondary font-body leading-relaxed">
                    {t("cgvAcceptanceBefore")}
                    <Link href="/cgv" target="_blank" className="text-accent underline hover:text-accent-dark">
                      {t("cgvLinkLabel")}
                    </Link>
                    {t("cgvAcceptanceMiddle")}
                    <Link href="/confidentialite" target="_blank" className="text-accent underline hover:text-accent-dark">
                      {t("privacyLinkLabel")}
                    </Link>
                    {t("cgvAcceptanceAfter")}
                  </span>
                </label>
              )}

              {/* Bouton pour lancer le paiement — visible tant que le formulaire Stripe n'est pas affiché */}
              {canProceed && !clientSecret && !stripeLoading && (
                <button
                  type="button"
                  onClick={handleInitiatePayment}
                  disabled={!cgvAccepted}
                  className="btn-primary w-full justify-center disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                      d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5z" />
                  </svg>
                  {t("proceedToPayment")} — {totalTTC.toFixed(2)} €
                </button>
              )}

              {canProceed && stripeLoading && (
                <div className="flex items-center justify-center py-4 gap-2 text-text-muted">
                  <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  <span className="text-xs font-body">{t("preparingPayment")}</span>
                </div>
              )}

              {canProceed && clientSecret && (
                <>
                  <div className="border-t border-border pt-3">
                    <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider font-body mb-3">
                      {t("securePayment")}
                    </p>
                  </div>
                  <Elements
                    stripe={getStripePromise()}
                    options={{
                      clientSecret,
                      appearance: {
                        theme: "stripe",
                        variables: {
                          colorPrimary: "#1A1A1A",
                          colorBackground: "#FFFFFF",
                          colorText: "#1A1A1A",
                          colorDanger: "#DC2626",
                          fontFamily: "var(--font-roboto), system-ui, sans-serif",
                          borderRadius: "8px",
                        },
                      },
                      locale: locale === "fr" ? "fr" : "en",
                    }}
                  >
                    <StripePaymentForm
                      onSuccess={handlePaymentSuccess}
                      onError={setStripeError}
                      disabled={isPending}
                      clientSecret={clientSecret}
                    />
                  </Elements>
                </>
              )}

              {isPending && (
                <div className="flex items-center justify-center py-2 gap-2 text-text-muted">
                  <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  <span className="text-xs font-body">{t("creatingOrder")}</span>
                </div>
              )}

            </div>
          </div>
        </div>
    );
}

// ─────────────────────────────────────────────
// Mini composant ligne info
// ─────────────────────────────────────────────

function InfoLine({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">{label}</span>
      <span className={`text-text-primary ${mono ? "font-mono text-xs" : "text-sm"}`}>{value}</span>
    </div>
  );
}
