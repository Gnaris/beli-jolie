"use client";

import { useState, useTransition, useEffect } from "react";
import Image from "next/image";
import { Link, useRouter } from "@/i18n/navigation";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, useStripe, useElements, CardNumberElement, CardExpiryElement, CardCvcElement } from "@stripe/react-stripe-js";
import { saveShippingAddress, deleteShippingAddress } from "@/app/actions/client/cart";
import { placeOrder } from "@/app/actions/client/order";
import { useLoadingOverlay } from "@/components/ui/LoadingOverlay";
import CustomSelect from "@/components/ui/CustomSelect";

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

function getTvaLabel(rate: number, address: Address | null, isPickup: boolean, vatExempt: boolean): string {
  if (!address) {
    // Pas d'adresse renseignée : seul le retrait permet de fixer un taux (20 % FR).
    if (isPickup) return "20 %";
    return "Calculée après sélection de l'adresse";
  }
  const country = address.country;
  if (rate === 0) {
    if (isDomTom(country)) return "0 % (DOM-TOM)";
    if (isEuNonFrance(country) && vatExempt) return "0 % (auto-liquidation — TVA validée)";
    if (!EU_COUNTRIES.has(country)) return "0 % (exportation hors UE)";
  }
  if (rate > 0 && isEuNonFrance(country) && !vatExempt) {
    return "20 % (TVA non encore validée par notre équipe)";
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
  const steps = [
    { label: "Panier", href: "/panier" },
    { label: "Commande", href: "/panier/commande" },
    { label: "Confirmation", href: null },
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

const EU_COUNTRY_OPTIONS = [
  { code: "FR", label: "France" },
  { code: "BE", label: "Belgique" },
  { code: "LU", label: "Luxembourg" },
  { code: "CH", label: "Suisse" },
  { code: "DE", label: "Allemagne" },
  { code: "ES", label: "Espagne" },
  { code: "IT", label: "Italie" },
  { code: "NL", label: "Pays-Bas" },
  { code: "PT", label: "Portugal" },
  { code: "AT", label: "Autriche" },
  { code: "PL", label: "Pologne" },
  { code: "SE", label: "Suède" },
  { code: "DK", label: "Danemark" },
  { code: "FI", label: "Finlande" },
  { code: "IE", label: "Irlande" },
  { code: "CZ", label: "République tchèque" },
  { code: "RO", label: "Roumanie" },
  { code: "HU", label: "Hongrie" },
  { code: "GR", label: "Grèce" },
  { code: "US", label: "États-Unis" },
  { code: "GB", label: "Royaume-Uni" },
  { code: "CA", label: "Canada" },
  { code: "AU", label: "Australie" },
  { code: "JP", label: "Japon" },
];

function FieldInput({
  id, label, value, onChange, type = "text", placeholder, required = false, optional = false,
}: {
  id: string; label: string; value: string; onChange: (v: string) => void;
  type?: string; placeholder?: string; required?: boolean; optional?: boolean;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-body font-medium text-text-primary mb-1.5">
        {label}{optional && <span className="text-text-muted font-normal ml-1">(optionnel)</span>}
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
  onSave,
  onCancel,
  isSaving,
}: {
  initial?: Partial<typeof EMPTY_ADDR>;
  onSave: (data: typeof EMPTY_ADDR & { isDefault: boolean }) => void;
  onCancel: () => void;
  isSaving: boolean;
}) {
  const [f, setF] = useState({ ...EMPTY_ADDR, ...initial });
  const [isDefault, setIsDefault] = useState(false);

  const set = (k: keyof typeof EMPTY_ADDR) => (v: string) => setF((p) => ({ ...p, [k]: v }));

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSave({ ...f, isDefault });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <FieldInput id="addr-fn" label="Prénom" value={f.firstName} onChange={set("firstName")} required />
        <FieldInput id="addr-ln" label="Nom" value={f.lastName} onChange={set("lastName")} required />
      </div>
      <FieldInput id="addr-co" label="Société" value={f.company} onChange={set("company")} optional />
      <FieldInput id="addr-a1" label="Adresse" value={f.address1} onChange={set("address1")} placeholder="12 rue des Fleurs" required />
      <FieldInput id="addr-a2" label="Complément" value={f.address2} onChange={set("address2")} optional placeholder="Bât. A, porte 3" />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <FieldInput id="addr-zip" label="Code postal" value={f.zipCode} onChange={set("zipCode")} required />
        <FieldInput id="addr-city" label="Ville" value={f.city} onChange={set("city")} required />
      </div>
      <div>
        <label htmlFor="addr-country" className="block text-sm font-body font-medium text-text-primary mb-1.5">
          Pays <span className="text-text-primary">*</span>
        </label>
        <CustomSelect
          id="addr-country"
          value={f.country}
          onChange={(v) => set("country")(v)}
          options={EU_COUNTRY_OPTIONS.map((c) => ({ value: c.code, label: c.label }))}
        />
      </div>
      <FieldInput id="addr-phone" label="Téléphone" value={f.phone} onChange={set("phone")} type="tel" optional placeholder="0612345678" />
      <label className="flex items-center gap-2 text-sm font-body text-text-primary cursor-pointer">
        <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)}
          className="accent-text-primary w-4 h-4" />
        Définir comme adresse par défaut
      </label>
      <div className="flex gap-3 pt-1">
        <button type="submit" disabled={isSaving}
          className="btn-primary flex-1 justify-center disabled:opacity-60">
          {isSaving ? "Enregistrement…" : "Enregistrer l'adresse"}
        </button>
        <button type="button" onClick={onCancel}
          className="btn-secondary px-4 py-2 text-sm">
          Annuler
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
        {carrier.price === 0 ? "Gratuit" : `${carrier.price.toFixed(2)} €`}
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
      onError("Erreur d'initialisation du formulaire de paiement.");
      setProcessing(false);
      return;
    }

    const { error, paymentIntent } = await stripe.confirmCardPayment(
      clientSecret,
      { payment_method: { card: cardElement } }
    );

    if (error) {
      onError(error.message ?? "Erreur lors du paiement.");
      setProcessing(false);
    } else if (paymentIntent && paymentIntent.status === "succeeded") {
      onSuccess(paymentIntent.id);
    } else {
      onError("Le paiement n'a pas abouti. Veuillez réessayer.");
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
            <span className="text-[0.8rem] font-medium text-text-secondary font-body">Numéro de carte</span>
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
              Date d&apos;expiration
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
                  3 chiffres au dos de la carte
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
        <span className="text-[11px] text-text-muted font-body">Paiement sécurisé — chiffrement SSL 256 bits</span>
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
            Paiement en cours…
          </>
        ) : (
          <>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
            </svg>
            Confirmer et payer
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
  const [isPending, startTransition] = useTransition();
  const { showLoading, hideLoading } = useLoadingOverlay();
  const [orderError, setOrderError] = useState("");

  // Stripe
  const [clientSecret, setClientSecret]       = useState<string | null>(null);
  const [paymentIntentId, setPaymentIntentId] = useState<string | null>(null);
  const [stripeLoading, setStripeLoading]     = useState(false);
  const [stripeError, setStripeError]         = useState("");
  const [cgvAccepted, setCgvAccepted]         = useState(false);

  // Infos client editables (adresse de facturation)
  const [billingInfo, setBillingInfo] = useState({
    firstName: user.firstName,
    lastName:  user.lastName,
    company:   user.company,
    email:     user.email,
    phone:     user.phone,
    address1:  "",
    address2:  "",
    zipCode:   "",
    city:      "",
    country:   "FR",
  });
  const [editingInfo, setEditingInfo] = useState(false);
  const [sameAsBilling, setSameAsBilling] = useState(false);

  // Adresses
  const [addresses, setAddresses]   = useState<Address[]>(initialAddresses);
  const [selectedAddrId, setSelectedAddrId] = useState<string | null>(
    initialAddresses.find((a) => a.isDefault)?.id ?? initialAddresses[0]?.id ?? null
  );
  const [showAddressForm, setShowAddressForm] = useState(initialAddresses.length === 0);
  const selectedAddr = addresses.find((a) => a.id === selectedAddrId) ?? null;

  // Mode de livraison : "delivery" (par défaut) ou "pickup"
  const [deliveryMode, setDeliveryMode] = useState<"delivery" | "pickup">("delivery");

  // Transporteurs
  const [carriers, setCarriers]         = useState<Carrier[]>([]);
  const [transactionId, setTransactionId] = useState<string>("");
  const [selectedCarrierId, setSelectedCarrierId] = useState<string | null>(null);
  const [carriersLoading, setCarriersLoading]     = useState(!!selectedAddrId);
  const [carriersError, setCarriersError]         = useState("");
  const [noCarrierConfigured, setNoCarrierConfigured] = useState(false);
  const selectedCarrier = deliveryMode === "pickup"
    ? { id: "pickup_store", name: "Retrait en boutique", price: 0, delay: "" }
    : (carriers.find((c) => c.id === selectedCarrierId) ?? null);

  // TVA — règles unifiées (lib/vat) :
  // France → 20 %, DOM-TOM → 0 %,
  // UE hors France + admin a validé l'exonération → 0 % sinon 20 %, hors UE → 0 %.
  // Le retrait en boutique n'écrase plus l'exonération B2B intracom validée.
  const isPickup = deliveryMode === "pickup";
  const tvaRate = resolveVatRate({
    countryCode: selectedAddr?.country ?? null,
    isPickup,
    vatExempt: user.vatExempt,
  });
  const tvaLabel = getTvaLabel(tvaRate, selectedAddr, isPickup, user.vatExempt);

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
          if (data.noCarrierConfigured) setNoCarrierConfigured(true);
        }
      })
      .catch((err) => { if (err.name !== "AbortError") setCarriersError("Impossible de charger les transporteurs."); })
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

  function handleSameAsBilling(checked: boolean) {
    setSameAsBilling(checked);
    if (checked && billingInfo.address1 && billingInfo.zipCode && billingInfo.city) {
      showLoading();
      startTransition(async () => {
        try {
          const saved = await saveShippingAddress({
            label: `Facturation — ${billingInfo.city}`,
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
          setSelectedAddrId((saved as Address).id);
          setShowAddressForm(false);
        } finally {
          hideLoading();
        }
      });
    }
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

  const canProceed = !!selectedAddr && !!selectedCarrier;

  // Reset Stripe + carriers quand le mode de livraison change
  function handleDeliveryModeChange(mode: "delivery" | "pickup") {
    setDeliveryMode(mode);
    setSelectedCarrierId(null);
    setClientSecret(null);
    setPaymentIntentId(null);
    setStripeError("");
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
      setStripeError("Impossible d'initialiser le paiement.");
    } finally {
      setStripeLoading(false);
    }
  }

  // Réinitialiser Stripe si l'adresse, le transporteur ou le mode de livraison change
  useEffect(() => {
    setClientSecret(null);
    setPaymentIntentId(null);
    setStripeError("");
  }, [selectedAddrId, selectedCarrierId, deliveryMode]);

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
  const section3Complete = !!selectedCarrier;

  return (
    <div className="container-site py-10 md:py-14">
      {/* Stepper */}
      <CheckoutStepper currentStep={1} />

      {/* En-tête */}
      <div className="flex items-end justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="font-heading text-2xl md:text-3xl font-bold text-text-primary">
            Finaliser la commande
          </h1>
          <p className="text-sm font-body text-text-secondary mt-1">
            Vérifiez vos informations et choisissez votre mode de livraison.
          </p>
        </div>
        <Link href="/panier"
          className="inline-flex items-center gap-1.5 text-sm font-body text-text-muted hover:text-text-primary transition-colors group">
          <svg className="w-4 h-4 transition-transform group-hover:-translate-x-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
          </svg>
          Retour au panier
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-8 items-start">

        {/* ── Colonne principale ─────────────────── */}
        <div className="lg:col-span-2 space-y-6">

          {/* ── 1. Informations client + adresse de facturation ── */}
          <section className="bg-bg-primary border border-border rounded-2xl overflow-hidden shadow-sm">
            <SectionHeader step={1} title="Informations client" complete={section1Complete}>
              <button type="button" onClick={() => setEditingInfo((v) => !v)}
                className="text-xs font-body text-text-secondary hover:text-text-primary transition-colors">
                {editingInfo ? "Fermer" : "Modifier"}
              </button>
            </SectionHeader>

            {editingInfo ? (
              <div className="p-5 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <FieldInput id="bi-fn" label="Prenom" value={billingInfo.firstName} onChange={(v) => setBillingInfo((p) => ({ ...p, firstName: v }))} required />
                  <FieldInput id="bi-ln" label="Nom" value={billingInfo.lastName} onChange={(v) => setBillingInfo((p) => ({ ...p, lastName: v }))} required />
                </div>
                <FieldInput id="bi-co" label="Societe" value={billingInfo.company} onChange={(v) => setBillingInfo((p) => ({ ...p, company: v }))} />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <FieldInput id="bi-email" label="Email" value={billingInfo.email} onChange={(v) => setBillingInfo((p) => ({ ...p, email: v }))} type="email" />
                  <FieldInput id="bi-phone" label="Telephone" value={billingInfo.phone} onChange={(v) => setBillingInfo((p) => ({ ...p, phone: v }))} type="tel" />
                </div>
                <div className="border-t border-border pt-4 mt-2">
                  <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider font-body mb-3">Adresse de facturation</p>
                  <div className="space-y-4">
                    <FieldInput id="bi-a1" label="Adresse" value={billingInfo.address1} onChange={(v) => setBillingInfo((p) => ({ ...p, address1: v }))} placeholder="12 rue des Fleurs" required />
                    <FieldInput id="bi-a2" label="Complement" value={billingInfo.address2} onChange={(v) => setBillingInfo((p) => ({ ...p, address2: v }))} optional placeholder="Bat. A, porte 3" />
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <FieldInput id="bi-zip" label="Code postal" value={billingInfo.zipCode} onChange={(v) => setBillingInfo((p) => ({ ...p, zipCode: v }))} required />
                      <FieldInput id="bi-city" label="Ville" value={billingInfo.city} onChange={(v) => setBillingInfo((p) => ({ ...p, city: v }))} required />
                    </div>
                    <div>
                      <label htmlFor="bi-country" className="block text-sm font-body font-medium text-text-primary mb-1.5">Pays</label>
                      <CustomSelect
                        id="bi-country"
                        value={billingInfo.country}
                        onChange={(v) => setBillingInfo((p) => ({ ...p, country: v }))}
                        options={EU_COUNTRY_OPTIONS.map((c) => ({ value: c.code, label: c.label }))}
                      />
                    </div>
                  </div>
                </div>
                <button type="button" onClick={() => setEditingInfo(false)} className="btn-primary text-sm">
                  Enregistrer
                </button>
              </div>
            ) : (
              <div className="p-5 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm font-body">
                  <InfoLine label="Societe"   value={billingInfo.company} />
                  <InfoLine label="Contact"   value={`${billingInfo.firstName} ${billingInfo.lastName}`} />
                  <InfoLine label="Email"     value={billingInfo.email} />
                  <InfoLine label="Telephone" value={billingInfo.phone} />
                  <InfoLine label="SIRET"     value={user.siret} mono />
                  {user.vatNumber && <InfoLine label="N° TVA" value={user.vatNumber} mono />}
                </div>
                {billingInfo.address1 && (
                  <div className="border-t border-border pt-3">
                    <p className="text-xs font-semibold text-text-muted uppercase tracking-wider font-body mb-1">Adresse de facturation</p>
                    <p className="text-sm text-text-primary font-body">
                      {billingInfo.address1}{billingInfo.address2 ? `, ${billingInfo.address2}` : ""}
                    </p>
                    <p className="text-sm text-text-secondary font-body">
                      {billingInfo.zipCode} {billingInfo.city}, {EU_COUNTRY_OPTIONS.find((c) => c.code === billingInfo.country)?.label ?? billingInfo.country}
                    </p>
                  </div>
                )}
              </div>
            )}
          </section>

          {/* ── 2. Adresse de livraison ── */}
          <section className="bg-bg-primary border border-border rounded-2xl overflow-hidden shadow-sm">
            <SectionHeader step={2} title="Adresse de livraison" complete={section2Complete}>
              {!showAddressForm && (
                <button type="button" onClick={() => setShowAddressForm(true)}
                  className="text-xs font-body text-text-secondary hover:text-text-primary transition-colors flex items-center gap-1.5">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.5v15m7.5-7.5h-15" />
                  </svg>
                  Nouvelle adresse
                </button>
              )}
            </SectionHeader>
            <div className="p-5 space-y-3">
              {/* Option: meme adresse que facturation */}
              {billingInfo.address1 && billingInfo.zipCode && billingInfo.city && (
                <label className="flex items-center gap-2.5 p-3 border border-border rounded-xl text-sm font-body text-text-primary cursor-pointer hover:bg-bg-secondary transition-colors">
                  <input
                    type="checkbox"
                    checked={sameAsBilling}
                    onChange={(e) => handleSameAsBilling(e.target.checked)}
                    className="accent-text-primary w-4 h-4"
                  />
                  Utiliser l&apos;adresse de facturation comme adresse de livraison
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
                              Par defaut
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
                  <div className="flex justify-end mt-2">
                    <button
                      type="button"
                      onClick={() => handleDeleteAddress(addr.id)}
                      disabled={isPending}
                      className="text-[11px] text-text-muted hover:text-error font-body transition-colors flex items-center gap-1"
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                      </svg>
                      Supprimer
                    </button>
                  </div>
                </div>
              ))}

              {/* Formulaire nouvelle adresse */}
              {showAddressForm && (
                <AddressForm
                  onSave={handleSaveAddress}
                  onCancel={() => setShowAddressForm(false)}
                  isSaving={isPending}
                />
              )}

              {addresses.length === 0 && !showAddressForm && (
                <p className="text-sm text-text-muted font-body text-center py-4">
                  Aucune adresse enregistrée.
                </p>
              )}
            </div>
          </section>

          {/* ── 3. Mode de livraison ── */}
          <section className="bg-bg-primary border border-border rounded-2xl overflow-hidden shadow-sm">
            <SectionHeader step={3} title="Mode de livraison" complete={section3Complete} />
            <div className="p-5 space-y-4">
              {/* Choix livraison / retrait */}
              <div className="grid grid-cols-2 gap-3">
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
                    Livraison
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
                    Retrait en boutique
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
                        Retrait gratuit en boutique
                      </p>
                      <p className="text-xs text-text-secondary font-body mt-1">
                        Vous serez notifié par email lorsque votre commande sera prête à retirer.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Transporteurs (mode livraison uniquement) */}
              {deliveryMode === "delivery" && (
                <div className="space-y-3">
                  {!selectedAddr && (
                    <p className="text-sm text-text-muted font-body text-center py-3">
                      Sélectionnez une adresse de livraison pour voir les transporteurs disponibles.
                    </p>
                  )}

                  {selectedAddr && carriersLoading && (
                    <div className="flex items-center justify-center py-8 gap-3 text-text-muted">
                      <svg className="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      <span className="text-sm font-body">Chargement des transporteurs…</span>
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
                        ? "Aucun transporteur disponible, veuillez contacter le personnel du site."
                        : "Aucun transporteur disponible pour cette adresse."}
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
  subtotalAfterDiscount, tvaRate, tvaLabel, tvaAmount, selectedAddr, deliveryMode,
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
  deliveryMode: "delivery" | "pickup";
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
          Récapitulatif
        </h3>
        <div className="flex items-center gap-2">
          <span className="text-xs font-body text-text-muted lg:hidden">
            {itemCount} article{itemCount !== 1 ? "s" : ""} {canProceed ? `— ${totalTTC.toFixed(2)} \u20AC` : ""}
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
                <span>Sous-total HT</span>
                <span className="font-medium text-text-primary">{subtotalHT.toFixed(2)} €</span>
              </div>

              {/* Remise commerciale */}
              {clientDiscountAmt > 0 && (
                <div className="flex justify-between text-accent-dark">
                  <span className="flex items-center gap-1">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M17 17h.01M7 17h.01M17 7h.01M3 12h18M12 3v18" />
                    </svg>
                    Remise{clientDiscount?.discountType === "PERCENT" && clientDiscount.discountValue
                      ? ` (${clientDiscount.discountValue}%)`
                      : ""}
                  </span>
                  <span className="font-medium">-{clientDiscountAmt.toFixed(2)} €</span>
                </div>
              )}

              {clientDiscountAmt > 0 && (
                <div className="flex justify-between text-text-secondary">
                  <span>Sous-total après remise</span>
                  <span className="font-medium text-text-primary">{subtotalAfterDiscount.toFixed(2)} €</span>
                </div>
              )}

              <div className="flex justify-between text-text-secondary">
                <span>TVA <span className="text-xs text-text-muted">({tvaLabel})</span></span>
                <span className="font-medium text-text-primary">
                  {selectedAddr ? `${tvaAmount.toFixed(2)} €` : "—"}
                </span>
              </div>
              <div className="flex justify-between text-text-secondary">
                <span>{deliveryMode === "pickup" ? "Retrait en boutique" : "Livraison"}</span>
                <span className={`font-medium ${
                  (deliveryMode === "pickup" || (clientDiscount?.freeShipping && selectedCarrier))
                    ? "text-accent-dark"
                    : "text-text-primary"
                }`}>
                  {deliveryMode === "pickup"
                    ? "Gratuit"
                    : selectedCarrier
                      ? (clientDiscount?.freeShipping
                          ? "Offerte"
                          : selectedCarrier.price === 0 ? "Gratuit" : `${selectedCarrier.price.toFixed(2)} €`)
                      : "—"}
                </span>
              </div>

              <div className="border-t border-border pt-3 flex justify-between items-center mt-2">
                <span className="font-semibold text-text-primary">Total TTC</span>
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
                  Sélectionnez une adresse et un transporteur pour procéder au paiement.
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
                    J&apos;ai lu et j&apos;accepte les{" "}
                    <Link href="/cgv" target="_blank" className="text-accent underline hover:text-accent-dark">
                      Conditions Générales de Vente
                    </Link>{" "}
                    et la{" "}
                    <Link href="/confidentialite" target="_blank" className="text-accent underline hover:text-accent-dark">
                      Politique de confidentialité
                    </Link>.
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
                  Procéder au paiement — {totalTTC.toFixed(2)} €
                </button>
              )}

              {canProceed && stripeLoading && (
                <div className="flex items-center justify-center py-4 gap-2 text-text-muted">
                  <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  <span className="text-xs font-body">Préparation du paiement…</span>
                </div>
              )}

              {canProceed && clientSecret && (
                <>
                  <div className="border-t border-border pt-3">
                    <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider font-body mb-3">
                      Paiement sécurisé
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
                      locale: "fr",
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
                  <span className="text-xs font-body">Création de la commande…</span>
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
