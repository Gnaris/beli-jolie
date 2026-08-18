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
import CardPreview3D, { type CardBrand, type NumberStatus } from "@/components/panier/CardPreview3D";
import { isBillingComplete, findAddressMatchingBilling } from "@/lib/shipping-billing-match";

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
  siret: string | null;
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
  /** Plafond HT du prix transporteur au-delà duquel la livraison n'est plus offerte. */
  freeShippingMaxPrice?: number | null;
}

interface Carrier {
  id: string;
  name: string;
  price: number;
  delay: string;
  logo?: string;
  /**
   * Signature HMAC serveur (anti-fraude carrierPrice — audit checkout §8).
   * Repassée telle quelle à /api/payments/create-intent.
   */
  sig?: string;
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
  // unitPrice en BDD = prix total déjà calculé (UNIT = prix unité, PACK = prix total du pack)
  const base = Number(v.unitPrice);
  const discountPercent = v.product.discountPercent != null ? Number(v.product.discountPercent) : null;
  if (!discountPercent || discountPercent <= 0) return base;
  return Math.max(0, base * (1 - discountPercent / 100));
}

// Renvoie le prix unitaire avec la meilleure remise (produit manuel OU promo
// AUTO ciblant l'item). Si aucune info promo n'est fournie, on retombe sur le
// legacy computeUnitPrice (discountPercent uniquement).
function pickItemUnitPrice(
  itemId: string,
  variant: VariantData,
  promoMap: Record<string, { finalUnitPrice: number }>,
): number {
  const info = promoMap[itemId];
  if (info) return info.finalUnitPrice;
  return computeUnitPrice(variant);
}

// Meilleure remise livraison entre free perso + promos AUTO SHIPPING.
function pickShippingPrice(
  carrierPrice: number,
  isFree: boolean,
  shippingPromos: {
    id: string;
    name: string;
    discountKind: "PERCENTAGE" | "FIXED_AMOUNT" | "FREE_SHIPPING";
    discountValue: number;
  }[],
): { finalPrice: number; savedAmount: number; promotionName: string | null } {
  if (carrierPrice <= 0) return { finalPrice: 0, savedAmount: 0, promotionName: null };
  const candidates: Array<{ saved: number; promoName: string | null }> = [];
  if (isFree) candidates.push({ saved: carrierPrice, promoName: null });
  for (const p of shippingPromos) {
    let saved = 0;
    if (p.discountKind === "PERCENTAGE") saved = Math.max(0, carrierPrice * (p.discountValue / 100));
    else if (p.discountKind === "FIXED_AMOUNT") saved = Math.min(p.discountValue, carrierPrice);
    else saved = carrierPrice; // FREE_SHIPPING legacy
    if (saved > 0) candidates.push({ saved, promoName: p.name });
  }
  if (candidates.length === 0) return { finalPrice: carrierPrice, savedAmount: 0, promotionName: null };
  candidates.sort((a, b) => b.saved - a.saved);
  const best = candidates[0]!;
  return {
    finalPrice: Math.max(0, carrierPrice - best.saved),
    savedAmount: best.saved,
    promotionName: best.promoName,
  };
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
// Hero banner "maquette" — remplacement visuel de la barre progression
// Affiche en haut de chaque étape : eyebrow "ÉTAPE N SUR 4" + gros titre + sous-titre
// ─────────────────────────────────────────────

function StepHero({ eyebrow, title, subtitle, accent = "slate" }: {
  eyebrow: string;
  title: string;
  subtitle?: string;
  accent?: "slate" | "emerald" | "sky" | "violet";
}) {
  const accentText = accent === "emerald"
    ? "text-emerald-700"
    : accent === "sky"
      ? "text-sky-700"
      : accent === "violet"
        ? "text-violet-700"
        : "text-text-muted";
  return (
    <div className="mb-6 md:mb-8">
      <div className={`text-[11px] uppercase tracking-[0.22em] font-semibold ${accentText} mb-2`}>
        {eyebrow}
      </div>
      <h1 className="font-heading text-3xl md:text-4xl font-bold text-text-primary leading-tight">
        {title}
      </h1>
      {subtitle && (
        <p className="text-sm text-text-secondary font-body mt-2 max-w-xl">
          {subtitle}
        </p>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// Trajet SVG — carte immersive Livraison
// ─────────────────────────────────────────────

function DeliveryTrajectMap({ destCity, destZip }: { destCity: string; destZip: string }) {
  const t = useTranslations("checkout");
  return (
    <div className="mb-6">
      <div className="rounded-2xl overflow-hidden relative h-56 border border-border bg-white shadow-sm">
        <div className="absolute inset-0 opacity-50" style={{
          backgroundImage: "linear-gradient(rgba(24,24,27,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(24,24,27,0.08) 1px, transparent 1px)",
          backgroundSize: "30px 30px",
        }} />
        <svg className="absolute inset-0 w-full h-full" viewBox="0 0 500 220" preserveAspectRatio="none" aria-hidden="true">
          <path d="M 60 60 Q 200 40, 240 130 T 440 170" stroke="#18181b" strokeWidth="2.5" fill="none" strokeDasharray="8 4" />
          <circle cx="60" cy="60" r="6" fill="#18181b" />
          <circle cx="60" cy="60" r="12" fill="#18181b" opacity="0.15" />
          <circle cx="440" cy="170" r="6" fill="#18181b" />
          <circle cx="440" cy="170" r="12" fill="#18181b" opacity="0.15">
            <animate attributeName="r" values="8;16;8" dur="2s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.3;0.05;0.3" dur="2s" repeatCount="indefinite" />
          </circle>
        </svg>
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-3xl" aria-hidden="true">🚚</div>
      </div>
      {/* Bande adresses Départ / Arrivée sous le plan */}
      <div className="bg-white border border-border border-t-0 rounded-b-2xl -mt-1 grid grid-cols-2 gap-6 p-4">
        <div className="flex items-start gap-3">
          <div className="flex flex-col items-center gap-1 pt-1">
            <div className="w-3 h-3 rounded-full bg-text-primary" />
            <div className="w-px h-6 bg-border" />
          </div>
          <div className="flex-1">
            <div className="text-[10px] uppercase tracking-widest text-text-muted font-semibold">{t("mapDeparture")}</div>
            <div className="text-sm text-text-primary font-semibold">{t("mapWarehouse")}</div>
            <div className="text-[11px] text-text-muted">75008 Paris</div>
          </div>
        </div>
        <div className="flex items-start gap-3">
          <div className="flex flex-col items-center gap-1 pt-1">
            <div className="w-3 h-3 rounded-full bg-text-primary ring-2 ring-bg-tertiary animate-pulse" />
            <div className="w-px h-6 bg-border" />
          </div>
          <div className="flex-1">
            <div className="text-[10px] uppercase tracking-widest text-text-muted font-semibold">{t("mapArrival")}</div>
            <div className="text-sm text-text-primary font-semibold">{destCity}</div>
            <div className="text-[11px] text-text-muted">{destZip} {destCity}</div>
          </div>
        </div>
      </div>
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
      <button
        type="button"
        onClick={() => setIsDefault(!isDefault)}
        className="w-full text-left flex items-center gap-2 text-sm font-body text-text-primary"
      >
        <span
          aria-hidden="true"
          className={`w-5 h-5 rounded-md border-2 shrink-0 flex items-center justify-center transition-colors ${
            isDefault ? "border-text-primary bg-text-primary" : "border-text-muted bg-white"
          }`}
        >
          {isDefault && (
            <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" strokeWidth="3.5" viewBox="0 0 24 24">
              <polyline points="20 6 9 17 4 12" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </span>
        {t("defineAsDefault")}
      </button>
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
// Logos transporteurs (URL renvoyée par Easy-Express, fallback emoji si absente)
// ─────────────────────────────────────────────

function CarrierLogoBox({ name, logoUrl, size = "md" }: { name: string; logoUrl?: string; size?: "md" | "sm" | "lg" }) {
  const dims = size === "sm" ? "w-14 h-9" : size === "lg" ? "w-20 h-14" : "w-16 h-10";
  if (logoUrl && logoUrl.length > 0) {
    return (
      <div className={`${dims} rounded-lg border border-border p-1 shrink-0 flex items-center justify-center overflow-hidden bg-white`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logoUrl} alt={name} className="max-w-full max-h-full object-contain" />
      </div>
    );
  }
  return (
    <div className={`${dims} rounded-lg bg-bg-tertiary border border-border flex items-center justify-center text-lg shrink-0`} aria-hidden="true">
      📦
    </div>
  );
}

// ─────────────────────────────────────────────
// Rail stepper vertical (Phase 2A refonte)
// ─────────────────────────────────────────────

function CheckoutRailStepper({
  wizardStep,
  onNavigate,
  canGoStep2,
}: {
  wizardStep: 1 | 2;
  onNavigate: (step: 1 | 2) => void;
  canGoStep2: boolean;
}) {
  const tCart = useTranslations("cart");
  const rail = [
    { key: "cart" as const, label: tCart("stepCart"), state: "done" as const },
    {
      key: "info" as const,
      label: tCart("stepInfo"),
      state: wizardStep === 1 ? "active" : "done" as "active" | "done" | "todo",
      onClick: () => onNavigate(1),
      clickable: true,
    },
    {
      key: "payment" as const,
      label: tCart("stepPayment"),
      state: wizardStep === 2 ? "active" : "todo" as "active" | "todo",
      onClick: () => canGoStep2 && onNavigate(2),
      clickable: canGoStep2,
    },
  ];

  return (
    <div className="bg-bg-dark rounded-3xl h-full flex flex-col items-center py-10 px-4 min-h-[560px] sticky top-24 shadow-sm">
      {/* Logo brand en haut */}
      <div className="w-11 h-11 rounded-xl bg-white text-bg-dark flex items-center justify-center font-heading font-bold text-lg mb-10">
        B
      </div>

      {/* Rail des étapes : cercle + ligne + cercle + ligne + ... */}
      <div className="flex flex-col items-center">
        {rail.map((step, i) => {
          const isActive = step.state === "active";
          const isDone = step.state === "done";
          const isLast = i === rail.length - 1;
          const clickable = "onClick" in step && step.clickable;

          const dotClass = isActive
            ? "bg-white text-bg-dark shadow-[0_0_0_5px_rgba(255,255,255,0.15)] ring-1 ring-white/30"
            : isDone
              ? "bg-white/90 text-bg-dark"
              : "bg-white/[0.04] border border-dashed border-white/25 text-white/45";

          const labelClass = isActive
            ? "text-white font-semibold"
            : isDone
              ? "text-white/80"
              : "text-white/35";

          const linkColor = isDone ? "bg-white/40" : "bg-white/10";

          const dotInner = isDone ? (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          ) : (i + 1);

          return (
            <div key={step.key} className="flex flex-col items-center">
              {/* Cercle numéroté */}
              {clickable ? (
                <button
                  type="button"
                  onClick={(step as { onClick?: () => void }).onClick}
                  className={`w-10 h-10 rounded-full flex items-center justify-center font-heading text-sm font-bold transition-all ${dotClass} ${!isActive ? "hover:bg-white/95 hover:text-bg-dark cursor-pointer" : ""}`}
                  aria-current={isActive ? "step" : undefined}
                  aria-label={step.label}
                >
                  {dotInner}
                </button>
              ) : (
                <div
                  className={`w-10 h-10 rounded-full flex items-center justify-center font-heading text-sm font-bold ${dotClass}`}
                  aria-hidden="true"
                >
                  {dotInner}
                </div>
              )}

              {/* Label sous le cercle */}
              <div className={`mt-2.5 text-[10px] uppercase tracking-wider text-center leading-snug ${labelClass}`}>
                {step.label}
              </div>

              {/* Ligne de connexion vers étape suivante (élément séparé, dans le flow) */}
              {!isLast && (
                <div className={`w-px h-10 my-3 ${linkColor}`} aria-hidden="true" />
              )}
            </div>
          );
        })}
      </div>

      {/* SSL footer */}
      <div className="mt-auto pt-6 text-[9px] text-white/40 tracking-widest flex items-center gap-1.5">
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
        </svg>
        SSL
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Carte transporteur
// ─────────────────────────────────────────────

function CarrierCard({
  carrier, tvaRate, selected, onClick, freeShipping = false,
}: {
  carrier: Carrier; tvaRate: number; selected: boolean; onClick: () => void;
  /** Livraison offerte à la cliente : masque le prix, affiche « Offerte » en vert. */
  freeShipping?: boolean;
}) {
  const t = useTranslations("checkout");
  const priceTTC = carrier.price * (1 + tvaRate);
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left border-2 rounded-2xl p-5 flex items-center gap-4 transition-all ${
        selected
          ? "border-text-primary bg-bg-secondary shadow-[0_0_0_2px_rgba(26,26,26,0.12)]"
          : "border-border bg-bg-primary hover:border-text-muted hover:bg-bg-secondary/40"
      }`}
    >
      <span
        aria-hidden="true"
        className={`w-5 h-5 rounded-full border-2 shrink-0 flex items-center justify-center transition-colors ${
          selected ? "border-text-primary bg-text-primary" : "border-text-muted bg-white"
        }`}
      >
        {selected && (
          <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" strokeWidth="3.5" viewBox="0 0 24 24">
            <polyline points="20 6 9 17 4 12" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
      <CarrierLogoBox name={carrier.name} logoUrl={carrier.logo} size="lg" />
      <div className="flex-1 min-w-0">
        <p className="text-base font-heading font-semibold text-text-primary truncate">
          {carrier.name}
        </p>
        <p className="text-sm text-text-secondary font-body mt-0.5">
          {carrier.delay}
        </p>
      </div>
      <div className="shrink-0 text-right">
        {freeShipping ? (
          <p className="font-heading font-bold text-lg text-success tabular-nums">
            {t("offered")}
          </p>
        ) : (
          <>
            <p className="font-heading font-bold text-lg text-text-primary tabular-nums">
              {carrier.price === 0 ? t("free") : `${carrier.price.toFixed(2)} €`}
            </p>
            {carrier.price > 0 && tvaRate > 0 && (
              <p className="text-[11px] text-text-muted font-body mt-0.5">
                {priceTTC.toFixed(2)} € TTC
              </p>
            )}
          </>
        )}
      </div>
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
  const [numberStatus, setNumberStatus] = useState<NumberStatus>("empty");

  const allReady = ready.number && ready.expiry && ready.cvc;

  // Cast Stripe's brand string to our CardBrand union. Stripe returns things like
  // "visa" / "mastercard" / "amex" / "discover" / "diners" / "jcb" / "unionpay" / "unknown".
  const previewBrand: CardBrand = ((): CardBrand => {
    const b = cardBrand as CardBrand;
    if (["visa", "mastercard", "amex", "discover", "diners", "jcb", "unionpay"].includes(b)) return b;
    return "unknown";
  })();

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
      {/* Aperçu 3D de la carte — Stripe ne nous transmet PAS le numéro/nom/expiration
          (sandbox PCI). On affiche donc la marque + un statut visuel (vide/en cours/complet)
          et on retourne la carte quand le CVC est focus. Nom & expiration restent vides. */}
      <div className="flex justify-center mb-2 motion-reduce:animate-none">
        <CardPreview3D
          brand={previewBrand}
          numberStatus={numberStatus}
          holderName=""
          expMonth=""
          expYear=""
          cvcFocused={focused === "cvc"}
        />
      </div>

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
              onChange={(e) => {
                setCardBrand(e.brand ?? "unknown");
                setNumberStatus(e.empty ? "empty" : e.complete ? "complete" : "partial");
              }}
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
  promoInfoByItemId = {},
  shippingPromos = [],
  pickupInfo = null,
  mergeCandidates = [],
  hideStepper = false,
  onBackToCart,
  onWizardStepChange,
}: {
  cart: CartData;
  addresses: Address[];
  user: UserInfo;
  clientDiscount?: ClientDiscount;
  promoInfoByItemId?: Record<string, {
    finalUnitPrice: number;
    savedPerUnit: number;
    displayPercent: number;
    promotionName: string | null;
    source: "none" | "product" | "promotion";
  }>;
  shippingPromos?: {
    id: string;
    name: string;
    discountKind: "PERCENTAGE" | "FIXED_AMOUNT" | "FREE_SHIPPING";
    discountValue: number;
  }[];
  /** Adresse boutique + horaires — affichés dans le mode « retrait en boutique ». */
  pickupInfo?: {
    store: {
      name:       string;
      address:    string;
      city:       string;
      postalCode: string;
      country:    string;
      phone:      string;
    };
    schedule: { day: string; hours: string }[];
  } | null;
  /** Commandes du client en préparation (PENDING) qu'il peut choisir de fusionner. */
  mergeCandidates?: {
    id:               string;
    orderNumber:      string;
    createdAtIso:     string;
    totalTTC:         number;
    carrierName:      string;
    carrierPrice:     number;
    itemsCount:       number;
    shipAddressShort: string;
  }[];
  /** Masque le fil d'étapes interne (utilisé quand le wrapper l'affiche). */
  hideStepper?: boolean;
  /** Callback pour revenir à l'étape « Panier » du wizard parent. */
  onBackToCart?: () => void;
  /** Notifie le wrapper du changement d'étape interne (1 = infos, 2 = paiement). */
  onWizardStepChange?: (step: 1 | 2) => void;
}) {
  const router = useRouter();
  const t = useTranslations("checkout");
  const tCommon = useTranslations("common");
  const tCart = useTranslations("cart");
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
    siret:     user.siret ?? "",
    vatNumber: user.vatNumber ?? "",
    address1:  user.addressStreet     ?? "",
    address2:  user.addressComplement ?? "",
    zipCode:   user.addressZip        ?? "",
    city:      user.addressCity       ?? "",
    country:   user.addressCountry    ?? "FR",
  });
  // Formulaire facturation : caché au centre (il est maintenant dans le panneau droite pour matcher la maquette).
  // La vue "fiche vérifiée" reste au centre uniquement.
  const [editingInfo, setEditingInfo] = useState(false);

  // Par défaut, on propose la livraison à l'adresse de facturation (case cochée)
  // dès que la facturation est complète. Si une adresse de livraison existante
  // correspond déjà mot pour mot à la facturation, on la sélectionne directement
  // pour éviter une création inutile en BDD.
  const billingComplete = isBillingComplete(user);
  const initialMatchingBillingAddrId = findAddressMatchingBilling(user, initialAddresses)?.id ?? null;

  // Pré-cochée si une adresse de livraison existante correspond déjà à la
  // facturation (cas zéro friction). Sinon la case reste visible mais décochée,
  // pour ne pas créer une adresse miroir dans le dos de l'utilisatrice.
  const [sameAsBilling, setSameAsBilling] = useState(!!initialMatchingBillingAddrId);
  const [billingError, setBillingError] = useState("");
  // Mémorise l'id de l'adresse "miroir" de la facturation (créée ou trouvée),
  // pour ne PAS la recréer à chaque coche/décoche.
  const [billingMirrorAddrId, setBillingMirrorAddrId] = useState<string | null>(initialMatchingBillingAddrId);
  // Adresse sélectionnée AVANT la coche, pour pouvoir y revenir à la décoche.
  const [previousAddrId, setPreviousAddrId] = useState<string | null>(null);

  // Adresses
  const [addresses, setAddresses]   = useState<Address[]>(initialAddresses);
  const [selectedAddrId, setSelectedAddrId] = useState<string | null>(
    initialMatchingBillingAddrId
      ?? initialAddresses.find((a) => a.isDefault)?.id
      ?? initialAddresses[0]?.id
      ?? null
  );
  // Le formulaire de création d'adresse ne s'ouvre PAS automatiquement quand
  // la facturation est complète : on laisse la case « même adresse » visible.
  const [showAddressForm, setShowAddressForm] = useState(
    initialAddresses.length === 0 && !billingComplete
  );
  // null = création nouvelle adresse, sinon = édition de l'adresse avec cet id
  const [editingAddrId, setEditingAddrId] = useState<string | null>(null);
  const selectedAddr = addresses.find((a) => a.id === selectedAddrId) ?? null;

  // Mode de livraison : "delivery" (par défaut), "pickup" (retrait boutique) ou "private" (transporteur du client)
  const [deliveryMode, setDeliveryMode] = useState<"delivery" | "pickup" | "private" | "merge">("delivery");
  // ID de la commande parente sélectionnée pour la fusion (mode "merge").
  const [selectedMergeOrderId, setSelectedMergeOrderId] = useState<string | null>(null);
  const selectedMergeOrder = mergeCandidates.find((o) => o.id === selectedMergeOrderId) ?? null;

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
      : deliveryMode === "merge"
        // Fusion : le port est celui de la commande parente (déjà payé). On
        // n'ajoute rien côté nouvelle commande — le supplément éventuel sera
        // ajusté par l'admin. `id` sentinelle pour distinguer côté serveur.
        ? { id: "merge_into_order", name: selectedMergeOrder ? `Fusion #${selectedMergeOrder.orderNumber}` : t("modeMerge"), price: 0, delay: "" }
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
    (s, item) => s + pickItemUnitPrice(item.id, item.variant, promoInfoByItemId) * item.quantity, 0
  );

  // Remise commerciale client
  const clientDiscountAmt = (() => {
    if (!clientDiscount?.discountType || !clientDiscount.discountValue) return 0;
    if (clientDiscount.discountType === "PERCENT")
      return Math.min(subtotalHT, subtotalHT * (clientDiscount.discountValue / 100));
    return Math.min(subtotalHT, clientDiscount.discountValue);
  })();
  const subtotalAfterDiscount = subtotalHT - clientDiscountAmt;

  // selectedCarrier.price est le prix HT renvoyé par /api/carriers (Easy-Express c.price)
  const _rawCarrierPrice = selectedCarrier?.price ?? 0;
  // Livraison offerte active seulement si le prix transporteur ≤ plafond
  // configuré (ou pas de plafond). Miroir de la logique serveur.
  const _clientFreeShippingActive = !!clientDiscount?.freeShipping
    && (clientDiscount.freeShippingMaxPrice == null || _rawCarrierPrice <= clientDiscount.freeShippingMaxPrice);
  const _shippingResolved = pickShippingPrice(_rawCarrierPrice, _clientFreeShippingActive, shippingPromos);
  const effectiveCarrierPrice = _shippingResolved.finalPrice;
  const shippingPromoName = _shippingResolved.promotionName;
  // TVA appliquée aussi sur les frais de port (art. 267 CGI).
  // Arrondi vers le bas au centime pour rester aligné avec le logiciel de
  // facturation externe (et Stripe, qui charge lui aussi le floor du total).
  const floor2 = (n: number) => Math.floor(n * 100) / 100;
  const tvaProducts = floor2(subtotalAfterDiscount * tvaRate);
  const tvaShipping = floor2(effectiveCarrierPrice * tvaRate);
  const tvaAmount = floor2((subtotalAfterDiscount + effectiveCarrierPrice) * tvaRate);
  const totalTTC  = floor2((subtotalAfterDiscount + effectiveCarrierPrice) * (1 + tvaRate));

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

  // En mode "merge", pas besoin d'adresse de livraison (l'admin réutilisera
  // celle de la commande parente au moment de la fusion), mais on passe
  // techniquement une adresse existante à placeOrder pour respecter le
  // contrat actuel — on prend la première disponible en fallback.
  const mergeComplete = deliveryMode !== "merge" || !!selectedMergeOrderId;
  const effectiveAddr = deliveryMode === "merge"
    ? (selectedAddr ?? addresses[0] ?? null)
    : selectedAddr;
  const addressComplete = deliveryMode === "merge" ? !!effectiveAddr : !!selectedAddr;
  const canProceed = addressComplete && !!selectedCarrier && privateCarrierComplete && mergeComplete;

  // Reset Stripe + carriers quand le mode de livraison change
  function handleDeliveryModeChange(mode: "delivery" | "pickup" | "private" | "merge") {
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
      // On envoie le PRIX BRUT du transporteur (`_rawCarrierPrice`) — la remise
      // livraison (user perso + promo AUTO) est ré-appliquée côté serveur dans
      // computeOrderPricing. Sinon la remise serait comptée deux fois.
      // Signature transporteur : anti-fraude carrierPrice (audit checkout §8).
      const carrierApiObj = carriers.find((c) => c.id === selectedCarrier!.id);
      const res = await fetch("/api/payments/create-intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          addressId:     selectedAddr!.id,
          carrierId:     selectedCarrier!.id,
          carrierName:   selectedCarrier!.name,
          carrierPrice:  _rawCarrierPrice,
          transactionId: transactionId || undefined,
          carrierSig:    carrierApiObj?.sig,
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

  // Réinitialiser Stripe si l'adresse, le transporteur ou le mode de livraison
  // change. On ANNULE aussi le PaymentIntent côté Stripe (audit checkout §10),
  // sinon il reste en `requires_payment_method` indéfiniment — pollution et
  // risque de re-paiement fantôme (retour navigateur, onglet dupliqué). Le
  // fetch est fire-and-forget : la route /api/payments/cancel-intent est
  // idempotente et retourne 200 même si le PI est déjà consommé.
  useEffect(() => {
    if (paymentIntentId) {
      const abandoned = paymentIntentId;
      fetch("/api/payments/cancel-intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentIntentId: abandoned }),
        keepalive: true,
      }).catch(() => {
        /* silencieux : cron orphan-payment-intents rattrape */
      });
    }
    setClientSecret(null);
    setPaymentIntentId(null);
    setStripeError("");
  }, [selectedAddrId, selectedCarrierId, deliveryMode, privateMode, privateCarrierEmail, privateCarrierPhone, bordereauPath]);

  // Idem à la fermeture d'onglet / navigation : on tente une annulation du PI
  // avec `sendBeacon` (survit à la fermeture, contrairement à fetch normal).
  useEffect(() => {
    if (!paymentIntentId) return;
    const piToCancel = paymentIntentId;
    const handler = () => {
      try {
        const blob = new Blob([JSON.stringify({ paymentIntentId: piToCancel })], {
          type: "application/json",
        });
        navigator.sendBeacon?.("/api/payments/cancel-intent", blob);
      } catch {
        /* silencieux */
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [paymentIntentId]);

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
          addressId:             (effectiveAddr ?? selectedAddr!).id,
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
          // Fusion : on transmet l'id de la commande parente pour tracer
          // l'intention côté serveur (l'admin regroupera manuellement).
          ...(deliveryMode === "merge" && selectedMergeOrderId
            ? { mergeIntoOrderId: selectedMergeOrderId }
            : {}),
        });
        if (result.success) {
          // router.replace (pas push) : le retour navigateur depuis la page
          // succès ne doit pas ramener sur /panier/commande avec un état
          // obsolète — audit checkout §15.
          router.replace(`/commandes/${result.orderId}?success=1`);
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
  // Adresse de livraison : non requise en mode "merge" (héritée de la commande parente).
  const section2Complete = deliveryMode === "merge" ? true : !!selectedAddr;
  const section3Complete = !!selectedCarrier && privateCarrierComplete && mergeComplete;

  // ── Wizard 2 étapes ────────────────────────────────────────────────────────
  // Étape 1 = Vos informations (facturation + adresse livraison + transporteur)
  // Étape 2 = Paiement (méthode + Stripe si carte)
  const [wizardStep, setWizardStep] = useState<1 | 2>(1);
  const paymentMethod = "card";
  // Drawer récapitulatif (mobile). Sur desktop la colonne reste visible en sticky.
  const [summaryDrawerOpen, setSummaryDrawerOpen] = useState(false);

  // Étape 1 OK = facturation + adresse livraison + transporteur/mode complet
  const step1Ready = section1Complete && section2Complete && section3Complete;

  // Vérif serveur du panier : rejoue les mêmes contrôles que /api/payments/
  // create-intent (produit ONLINE + stock suffisant). Utilisé au mount de la
  // page checkout ET avant chaque bascule d'étape. En cas d'erreur : on stocke
  // le détail en sessionStorage et on renvoie sur /panier qui l'affichera.
  async function revalidateCartOrRedirect(): Promise<boolean> {
    try {
      const res = await fetch("/api/cart/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (res.ok && data.ok) return true;
      if (typeof window !== "undefined") {
        try {
          window.sessionStorage.setItem(
            "cart_validation_errors",
            JSON.stringify(data.errors ?? []),
          );
        } catch {
          /* quota, mode privé, etc. — sur /panier le toast générique tombera */
        }
      }
      router.replace("/panier");
      return false;
    } catch {
      // Réseau HS : on laisse passer plutôt que bloquer le tunnel — le check
      // atomique côté serveur (create-intent + placeOrder) attrapera le cas.
      return true;
    }
  }

  // Contrôle à l'entrée de /panier/commande (protège navigation directe, back).
  useEffect(() => {
    void revalidateCartOrRedirect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function goToStep(target: 1 | 2) {
    if (target === wizardStep) return;
    if (target > wizardStep && !step1Ready) return;
    // Avant de passer à l'étape 2 (paiement), on re-valide : le panier a pu
    // rester ouvert plusieurs minutes le temps de saisir l'adresse.
    if (target > wizardStep) {
      const ok = await revalidateCartOrRedirect();
      if (!ok) return;
    }
    setWizardStep(target);
    onWizardStepChange?.(target);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const itemCount = cart.items.reduce((s, i) => s + i.quantity, 0);

  function renderPrivateCarrierSubOptions(idSuffix: string) {
    if (deliveryMode !== "private") return null;
    return (
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

        {/* Adresse expéditeur à recopier sur le bordereau */}
        {pickupInfo?.store && (
          <div className="bg-bg-primary border border-border rounded-xl p-4">
            <p className="text-[10px] uppercase tracking-widest text-text-muted font-semibold mb-2">
              {t("privateSenderAddressLabel")}
            </p>
            <p className="text-sm font-body font-semibold text-text-primary">{pickupInfo.store.name}</p>
            <p className="text-xs text-text-secondary font-body mt-0.5">{pickupInfo.store.address}</p>
            <p className="text-xs text-text-secondary font-body">{pickupInfo.store.postalCode} {pickupInfo.store.city} — {pickupInfo.store.country}</p>
            {pickupInfo.store.phone && (
              <p className="text-xs text-text-secondary font-body mt-1">{t("phone")} : {pickupInfo.store.phone}</p>
            )}
          </div>
        )}

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
            <span
              aria-hidden="true"
              className={`w-5 h-5 rounded-full border-2 shrink-0 flex items-center justify-center transition-colors ${
                privateMode === "contact" ? "border-text-primary bg-text-primary" : "border-text-muted bg-white"
              }`}
            >
              {privateMode === "contact" && (
                <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" strokeWidth="3.5" viewBox="0 0 24 24">
                  <polyline points="20 6 9 17 4 12" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </span>
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
            <span
              aria-hidden="true"
              className={`w-5 h-5 rounded-full border-2 shrink-0 flex items-center justify-center transition-colors ${
                privateMode === "bordereau" ? "border-text-primary bg-text-primary" : "border-text-muted bg-white"
              }`}
            >
              {privateMode === "bordereau" && (
                <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" strokeWidth="3.5" viewBox="0 0 24 24">
                  <polyline points="20 6 9 17 4 12" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </span>
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
                id={`pc-email${idSuffix}`}
                label={t("carrierEmail")}
                value={privateCarrierEmail}
                onChange={setPrivateCarrierEmail}
                type="email"
                placeholder="contact@transporteur.com"
                required
              />
              <FieldInput
                id={`pc-phone${idSuffix}`}
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
    );
  }

  return (
    <div className="max-w-[1680px] mx-auto py-6 md:py-8 px-2 sm:px-4">
      {/* Layout enveloppant : rail dark (124px) | contenu centre (1fr) | panneau actions droite (460px pour donner de l'air aux cards transporteurs) */}
      <div className={`grid grid-cols-1 ${hideStepper ? "lg:grid-cols-[1fr_460px]" : "lg:grid-cols-[124px_1fr_460px]"} gap-4 lg:gap-6 items-start`}>

        {/* Rail vertical dark (desktop uniquement) */}
        {!hideStepper && (
          <aside className="hidden lg:block">
            <CheckoutRailStepper
              wizardStep={wizardStep}
              onNavigate={goToStep}
              canGoStep2={step1Ready}
            />
          </aside>
        )}

        <div className="min-w-0">
      {/* Barre de progression mobile fine (masquée desktop, rail à la place) */}
      <div className={`lg:hidden mb-6 ${hideStepper ? "hidden" : ""}`}>
        <div className="flex items-center justify-between text-[10px] uppercase tracking-widest mb-2">
          <span className="text-text-primary font-semibold">
            {wizardStep === 1 ? tCart("stepInfo") : t("securePayment")}
          </span>
          <span className="text-text-muted">{tCart("stepIndicator", { current: wizardStep + 1, total: 3 })}</span>
        </div>
        <div className="flex gap-1" role="progressbar" aria-valuenow={wizardStep + 1} aria-valuemin={1} aria-valuemax={3}>
          {/* Panier toujours done + 2 étapes wizard */}
          {[0, 1, 2].map((i) => (
            <button
              key={i}
              type="button"
              disabled={i === 0 || (i > 1 && !step1Ready)}
              onClick={() => i >= 1 && goToStep(i as 1 | 2)}
              className={`flex-1 h-1 rounded transition-colors ${
                i < wizardStep + 1
                  ? i === wizardStep
                    ? "bg-bg-dark"
                    : "bg-text-secondary"
                  : "bg-border"
              } disabled:cursor-not-allowed`}
              aria-label={`${i + 1} / 3`}
            />
          ))}
        </div>
      </div>

      {/* En-tête : titre + bouton panier flottant (mobile) */}
      <div className="flex items-end justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="font-heading text-2xl md:text-3xl font-bold text-text-primary">
            {t("finalize")}
          </h1>
          <p className="text-sm font-body text-text-secondary mt-1">
            {t("finalizeDesc")}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/panier"
            className="hidden md:inline-flex items-center gap-1.5 text-sm font-body text-text-muted hover:text-text-primary transition-colors group">
            <svg className="w-4 h-4 transition-transform group-hover:-translate-x-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
            </svg>
            {t("backToCart")}
          </Link>
          {/* Bouton panier — visible < lg (colonne récap masquée) */}
          <button
            type="button"
            onClick={() => setSummaryDrawerOpen(true)}
            className="lg:hidden inline-flex items-center gap-2 px-4 h-11 rounded-full bg-bg-dark text-white text-sm font-body font-semibold hover:opacity-90 transition-opacity"
            aria-label={t("summaryTitle")}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
            <span>{t("summaryTitle")}</span>
            {canProceed && (
              <span className="ml-1 px-2 py-0.5 rounded-full bg-white text-text-primary text-[11px] font-mono">
                {totalTTC.toFixed(2)} €
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Contenu wizard prend maintenant toute la largeur (le panneau actions est déplacé dans le 3e aside externe) */}
      <div className="space-y-6">

          {/* ── ÉTAPE 1 · Hero unique — Vos informations ── */}
          {wizardStep === 1 && (
            <StepHero
              eyebrow={tCart("stepIndicator", { current: 2, total: 3 }) + " · " + tCart("stepInfo")}
              title={t("whoBillingTitle")}
              subtitle={t("whoBillingSubtitle")}
              accent="sky"
            />
          )}

          {/* ── ÉTAPE 1 · Facturation (fusionnée) ── */}
          <section className={`bg-bg-primary border border-border rounded-2xl overflow-hidden shadow-sm ${wizardStep === 1 ? "" : "hidden"}`}>
            <SectionHeader step={2} title={t("billingTitle")} complete={section1Complete}>
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
              <div className="p-5 space-y-5">
                {/* En-tête fiche client : avatar initiales + raison sociale */}
                <div className="flex items-start gap-4">
                  <div className="w-14 h-14 rounded-xl bg-bg-tertiary border border-border flex items-center justify-center font-heading font-bold text-lg text-text-primary shrink-0">
                    {(billingInfo.firstName?.[0] ?? "").toUpperCase()}{(billingInfo.lastName?.[0] ?? "").toUpperCase() || "•"}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-heading text-lg font-bold text-text-primary truncate">
                      {billingInfo.company || `${billingInfo.firstName} ${billingInfo.lastName}`}
                    </div>
                    <div className="text-xs text-text-muted flex items-center gap-2 mt-0.5">
                      <span className="inline-flex items-center gap-1 text-success">
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={3} viewBox="0 0 24 24" aria-hidden="true">
                          <polyline points="20 6 9 17 4 12" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                        {t("proAccountVerified")}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Grille de badges vérifiés (SIRET / TVA / KBIS / Compte) */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  <VerifiedBadge label={t("billingSiret")} value={billingInfo.siret || "—"} mono verified={!!billingInfo.siret} />
                  <VerifiedBadge label={t("vatNumberShort")} value={billingInfo.vatNumber || t("vatNone")} mono verified={!!billingInfo.vatNumber} />
                  <VerifiedBadge label={t("kbisLabel")} value={t("kbisReceived")} verified />
                  <VerifiedBadge label={t("accountLabel")} value={t("accountApproved")} verified />
                </div>

                {/* Contact + Adresse */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 pt-1 border-t border-border">
                  <div className="pt-4">
                    <p className="text-[10px] font-semibold text-text-muted uppercase tracking-widest font-body mb-2">{t("contact")}</p>
                    <p className="text-sm text-text-primary font-body font-medium">
                      {billingInfo.firstName} {billingInfo.lastName}
                    </p>
                    {billingInfo.email && (
                      <p className="text-xs text-text-secondary font-body">{billingInfo.email}</p>
                    )}
                    {billingInfo.phone && (
                      <p className="text-xs text-text-secondary font-body">{billingInfo.phone}</p>
                    )}
                  </div>
                  <div className="pt-4">
                    <p className="text-[10px] font-semibold text-text-muted uppercase tracking-widest font-body mb-2">{t("addressLabelShort")}</p>
                    {billingInfo.address1 ? (
                      <>
                        <p className="text-sm text-text-primary font-body">
                          {billingInfo.address1}{billingInfo.address2 ? `, ${billingInfo.address2}` : ""}
                        </p>
                        <p className="text-xs text-text-secondary font-body">
                          {billingInfo.zipCode} {billingInfo.city}, {countryOptions.find((c) => c.code === billingInfo.country)?.label ?? billingInfo.country}
                        </p>
                      </>
                    ) : (
                      <p className="text-sm text-text-muted font-body italic">{t("noBillingAddress")}</p>
                    )}
                  </div>
                </div>

                {/* Note info : facture téléchargeable */}
                <div className="flex items-start gap-3 p-4 bg-bg-secondary border-l-4 border-text-primary rounded-lg">
                  <div className="w-8 h-8 rounded-full bg-bg-primary border border-border flex items-center justify-center shrink-0 text-text-primary" aria-hidden="true">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-text-primary font-body">{t("invoiceHowTitle")}</p>
                    <p className="text-xs text-text-secondary font-body leading-relaxed mt-0.5">{t("invoiceHowDesc")}</p>
                  </div>
                </div>
              </div>
            )}
          </section>

          {/* ── ÉTAPE 1 · Carte trajet (optionnelle, sous les blocs facturation/livraison) ── */}
          {wizardStep === 1 && selectedAddr && (
            <DeliveryTrajectMap destCity={selectedAddr.city} destZip={selectedAddr.zipCode} />
          )}

          {/* ── ÉTAPE 1 · Livraison → adresse (refonte maquette : eyebrow + grille 2 col + bouton ajouter) ── */}
          <section className={wizardStep === 1 ? "" : "hidden"}>
            <div className="mb-3 flex items-baseline justify-between">
              <span className="text-[11px] uppercase tracking-[0.2em] text-text-muted font-semibold">
                {t("savedAddressesEyebrow")}
              </span>
              {section2Complete && (
                <span className="text-[10px] text-success uppercase tracking-widest font-semibold flex items-center gap-1">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  {t("selected")}
                </span>
              )}
            </div>
            <div className="space-y-3">
              {/* Option: meme adresse que facturation — TOUJOURS visible en haut
                  du bloc, même si la facturation n'est pas encore renseignée
                  (case désactivée + message d'explication dans ce cas).
                  Cocher la case ferme automatiquement le formulaire d'ajout
                  d'adresse de livraison (handleSameAsBilling). */}
              {(() => {
                const billingReady = !!(billingInfo.address1 && billingInfo.zipCode && billingInfo.city);
                return (
                  <button
                    type="button"
                    disabled={!billingReady}
                    onClick={() => handleSameAsBilling(!sameAsBilling)}
                    className={`w-full text-left flex items-start gap-3 p-4 border-2 rounded-xl text-sm font-body transition-all ${
                      !billingReady
                        ? "border-dashed border-border bg-bg-secondary/50 cursor-not-allowed opacity-70"
                        : sameAsBilling
                          ? "border-text-primary bg-bg-secondary shadow-[0_0_0_2px_rgba(26,26,26,0.08)]"
                          : "border-dashed border-border-dark bg-bg-primary hover:bg-bg-secondary hover:border-text-muted"
                    }`}
                  >
                    {/* Checkbox custom */}
                    <span
                      aria-hidden="true"
                      className={`w-5 h-5 rounded-md border-2 shrink-0 mt-0.5 flex items-center justify-center transition-colors ${
                        sameAsBilling
                          ? "border-text-primary bg-text-primary"
                          : billingReady
                            ? "border-text-muted bg-white"
                            : "border-border bg-bg-tertiary"
                      }`}
                    >
                      {sameAsBilling && (
                        <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" strokeWidth="3.5" viewBox="0 0 24 24">
                          <polyline points="20 6 9 17 4 12" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </span>
                    <div className="min-w-0">
                      <p className="font-semibold text-text-primary">{t("billToBilling")}</p>
                      {billingReady ? (
                        <p className="text-xs text-text-secondary mt-0.5">
                          {billingInfo.address1}{billingInfo.address2 ? `, ${billingInfo.address2}` : ""} — {billingInfo.zipCode} {billingInfo.city}
                        </p>
                      ) : (
                        <p className="text-xs text-text-muted mt-0.5 italic">{t("billToBillingNeedsBilling")}</p>
                      )}
                    </div>
                  </button>
                );
              })()}

              {/* Liste adresses existantes — grille 2 colonnes desktop pour matcher la maquette */}
              {!showAddressForm && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {addresses.map((addr) => (
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
                      <span
                        aria-hidden="true"
                        className={`w-5 h-5 rounded-full border-2 mt-0.5 shrink-0 flex items-center justify-center transition-colors ${
                          selectedAddrId === addr.id ? "border-text-primary bg-text-primary" : "border-text-muted bg-white"
                        }`}
                      >
                        {selectedAddrId === addr.id && (
                          <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" strokeWidth="3.5" viewBox="0 0 24 24">
                            <polyline points="20 6 9 17 4 12" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </span>
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
              </div>
              )}

              {/* Bouton "Ajouter une nouvelle adresse" (comme dans la maquette) */}
              {!showAddressForm && (
                <button
                  type="button"
                  onClick={() => { setEditingAddrId(null); setShowAddressForm(true); }}
                  className="w-full py-3 rounded-xl border border-dashed border-border-dark bg-bg-primary text-sm text-text-secondary hover:border-text-primary hover:text-text-primary transition-colors flex items-center justify-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.5v15m7.5-7.5h-15" />
                  </svg>
                  {t("newAddress")}
                </button>
              )}

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

          {/* ── ÉTAPE 1 · Livraison → mode + transporteur (mobile uniquement, desktop dans panneau droite) ── */}
          <section className={`bg-bg-primary border border-border rounded-2xl overflow-hidden shadow-sm lg:hidden ${wizardStep === 1 ? "" : "hidden"}`}>
            <SectionHeader step={1} title={t("deliveryModeTitle")} complete={section3Complete} />
            <div className="p-5 space-y-4">
              {/* Choix livraison / retrait / transporteur privé / fusion */}
              <div className={`grid grid-cols-1 sm:grid-cols-2 ${mergeCandidates.length > 0 ? "lg:grid-cols-4" : "lg:grid-cols-3"} gap-3`}>
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

                {mergeCandidates.length > 0 && (
                  <button
                    type="button"
                    onClick={() => handleDeliveryModeChange("merge")}
                    className={`flex flex-col items-center gap-2 p-4 border rounded-xl transition-all ${
                      deliveryMode === "merge"
                        ? "border-text-primary bg-bg-secondary shadow-[0_0_0_2px_rgba(26,26,26,0.12)]"
                        : "border-border bg-bg-primary hover:border-text-muted"
                    }`}
                  >
                    <svg className="w-6 h-6 text-text-primary" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                    </svg>
                    <span className="text-sm font-body font-semibold text-text-primary text-center leading-tight">
                      {t("modeMerge")}
                    </span>
                  </button>
                )}
              </div>

              {/* Fusion — liste des commandes candidates */}
              {deliveryMode === "merge" && (
                <div className="space-y-3">
                  <div className="rounded-xl bg-info/10 border border-info/20 px-4 py-3 text-sm font-body text-info">
                    {t("mergeInfoBanner")}
                  </div>
                  {mergeCandidates.map((o) => {
                    const isSelected = selectedMergeOrderId === o.id;
                    return (
                      <button
                        key={o.id}
                        type="button"
                        onClick={() => setSelectedMergeOrderId(o.id)}
                        className={`w-full text-left p-4 border rounded-xl transition-all ${
                          isSelected
                            ? "border-text-primary bg-bg-secondary shadow-[0_0_0_2px_rgba(26,26,26,0.12)]"
                            : "border-border bg-bg-primary hover:border-text-muted"
                        }`}
                      >
                        <div className="flex items-baseline justify-between gap-3 flex-wrap">
                          <span className="font-body font-semibold text-sm text-text-primary">
                            {t("mergeOrderLabel", { number: o.orderNumber })}
                          </span>
                          <span className="text-xs text-text-secondary font-body tabular-nums">{o.totalTTC.toFixed(2)} € TTC</span>
                        </div>
                        <p className="text-xs text-text-secondary font-body mt-1">
                          {new Date(o.createdAtIso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}
                          {" · "}{o.itemsCount} {o.itemsCount > 1 ? tCart("linesOrdered_plural") : tCart("linesOrdered")}
                        </p>
                        <p className="text-xs text-text-muted font-body mt-0.5">
                          {t("mergeDeliveryPrevue")} : {o.carrierName} → {o.shipAddressShort}
                        </p>
                      </button>
                    );
                  })}
                  <p className="text-xs text-text-muted font-body">
                    {t("mergeExplainer")}
                  </p>
                </div>
              )}

              {/* Retrait en boutique — adresse + horaires + bandeau "Gratuit" */}
              {deliveryMode === "pickup" && (
                <div className="space-y-3">
                  <div className="bg-bg-secondary border border-border rounded-2xl p-5">
                    <div className="flex items-start gap-4">
                      <div className="w-10 h-10 rounded-xl bg-bg-primary border border-border flex items-center justify-center shrink-0">
                        <svg className="w-5 h-5 text-text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
                        </svg>
                      </div>
                      <div className="flex-1 min-w-0">
                        {pickupInfo?.store ? (
                          <>
                            <p className="text-sm font-body font-semibold text-text-primary">
                              {pickupInfo.store.name}
                            </p>
                            <p className="text-xs text-text-secondary font-body mt-1">
                              {[pickupInfo.store.address, `${pickupInfo.store.postalCode} ${pickupInfo.store.city}`.trim(), pickupInfo.store.country]
                                .filter((s) => s && s.trim().length > 0)
                                .join(" · ")}
                            </p>
                            {pickupInfo.store.phone && (
                              <p className="text-xs text-text-secondary font-body mt-0.5">{pickupInfo.store.phone}</p>
                            )}
                            {pickupInfo.schedule && pickupInfo.schedule.length > 0 && (
                              <div className="mt-3 pt-3 border-t border-border">
                                <p className="text-[10px] uppercase tracking-widest text-text-muted font-semibold mb-2">
                                  {t("pickupOpeningHours")}
                                </p>
                                <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-xs font-body">
                                  {pickupInfo.schedule.map((d) => (
                                    <li key={d.day} className="flex justify-between gap-3">
                                      <span className="text-text-secondary">{d.day}</span>
                                      <span className={`font-medium ${d.hours === "Fermé" ? "text-text-muted" : "text-text-primary"}`}>{d.hours}</span>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            <p className="text-xs text-text-secondary font-body mt-3">
                              {t("pickupFreeDesc")}
                            </p>
                          </>
                        ) : (
                          <>
                            <p className="text-sm font-body font-semibold text-text-primary">{t("pickupFreeTitle")}</p>
                            <p className="text-xs text-text-secondary font-body mt-1">{t("pickupFreeDesc")}</p>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-sm font-body text-success bg-success/10 border border-success/20 rounded-xl px-4 py-3">
                    <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                    <span>{t("pickupNoShippingFees")}</span>
                  </div>
                </div>
              )}

              {/* Transporteur privé — sous-options (mobile, cf. panneau droit desktop) */}
              {renderPrivateCarrierSubOptions("")}

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

                  {carriers.map((carrier) => {
                    const carrierEligibleFree = !!clientDiscount?.freeShipping
                      && (clientDiscount.freeShippingMaxPrice == null
                          || carrier.price <= clientDiscount.freeShippingMaxPrice);
                    return (
                      <CarrierCard
                        key={carrier.id}
                        carrier={carrier}
                        tvaRate={tvaRate}
                        selected={selectedCarrierId === carrier.id}
                        onClick={() => setSelectedCarrierId(carrier.id)}
                        freeShipping={carrierEligibleFree}
                      />
                    );
                  })}
                </div>
              )}
            </div>
          </section>

          {/* ── ÉTAPE 2 · Hero Paiement ── */}
          {wizardStep === 2 && (
            <StepHero
              eyebrow={tCart("stepIndicator", { current: 3, total: 3 }) + " · " + tCart("stepPayment")}
              title={`${totalTTC.toFixed(2)} € TTC`}
              subtitle={t("lastStepPaySecurely")}
              accent="violet"
            />
          )}

          {/* ── ÉTAPE 2 · Paiement ── */}
          {wizardStep === 2 && (
            <section className="bg-bg-primary border border-border rounded-2xl overflow-hidden shadow-sm">
              <SectionHeader step={1} title={t("securePayment")} complete={false} />
              <div className="p-5 space-y-5">
                {/* Bloc paiement carte (Stripe) */}
                {paymentMethod === "card" && (
                  <div className="space-y-4">
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

                    {canProceed && !clientSecret && !stripeLoading && (
                      <button
                        type="button"
                        onClick={handleInitiatePayment}
                        disabled={!cgvAccepted}
                        className="btn-primary w-full justify-center h-12 disabled:opacity-50 disabled:cursor-not-allowed"
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
                )}
              </div>
            </section>
          )}

          {/* Barre de nav Retour/Suivant supprimée : les boutons sont uniquement dans le panneau droite (matche maquette v7). Version mobile en bas de page ci-dessous. */}
          <div className="lg:hidden flex items-center justify-between gap-3 pt-2">
            <button
              type="button"
              onClick={() => (wizardStep === 1 ? (onBackToCart ? onBackToCart() : router.push("/panier")) : goToStep(1))}
              className="btn-ghost h-11 px-4 text-sm"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
              {wizardStep === 1 ? t("backToCart") : tCommon("previous")}
            </button>
            {wizardStep < 2 && (
              <button
                type="button"
                onClick={() => goToStep(2)}
                disabled={!step1Ready}
                className="btn-primary h-11 px-6 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {tCommon("next")}
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </button>
            )}
          </div>
        </div>{/* /space-y-6 : fin contenu wizard */}

        </div>{/* /min-w-0 : fin contenu à droite du rail */}

        {/* ── Panneau actions à droite (desktop uniquement) — 380px ── */}
        <aside className="hidden lg:block">
          <div className="sticky top-24 space-y-4">

            {/* ÉTAPE 1 — Vos informations : panneau transporteurs + récap + boutons */}
            {wizardStep === 1 && (
              <div className="bg-bg-primary border border-border rounded-2xl shadow-sm overflow-hidden">
                <div className="px-5 pt-5">
                  <div className="text-[11px] uppercase tracking-widest text-text-muted mb-1">
                    {tCart("stepIndicator", { current: 2, total: 3 })}
                  </div>
                  <div className="font-heading text-xl font-bold text-text-primary mb-1">
                    {t("deliveryModeTitle")}
                  </div>
                  <div className="text-xs text-text-muted flex items-center gap-2 mb-4">
                    <span className="text-[10px] uppercase tracking-widest bg-bg-tertiary text-text-secondary px-2 py-0.5 rounded-full font-semibold">Easy-Express</span>
                    <span>{t("carriersRealTime")}</span>
                  </div>
                </div>

                {/* Liste unifiée : transporteurs Easy-Express + Autres options (matche maquette v7) */}
                <div className="px-5 pb-4 space-y-2 max-h-[48vh] overflow-y-auto">
                  {/* Transporteurs Easy-Express */}
                  {!selectedAddr && (
                    <p className="text-xs text-text-muted font-body text-center py-6">
                      {t("selectAddressFirst")}
                    </p>
                  )}
                  {selectedAddr && carriersLoading && (
                    <div className="flex items-center justify-center py-8 gap-2 text-text-muted">
                      <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                      <span className="text-xs">{t("carriersLoadingShort")}</span>
                    </div>
                  )}
                  {selectedAddr && !carriersLoading && carriersError && (
                    <div className="bg-[#FEE2E2] border border-[#FECACA] text-[#DC2626] px-3 py-2 text-xs rounded-lg">
                      {carriersError}
                    </div>
                  )}
                  {selectedAddr && !carriersLoading && !carriersError && carriers.length === 0 && (
                    <div className={`text-xs font-body text-center py-3 ${noCarrierConfigured ? "bg-[#FEF3C7] border border-[#FDE68A] text-[#92400E] px-3 rounded-lg" : "text-text-muted"}`}>
                      {noCarrierConfigured ? t("noCarriersConfigured") : t("noCarriersAvailable")}
                    </div>
                  )}
                  {carriers.map((carrier) => {
                    const carrierEligibleFree = !!clientDiscount?.freeShipping
                      && (clientDiscount.freeShippingMaxPrice == null
                          || carrier.price <= clientDiscount.freeShippingMaxPrice);
                    return (
                      <CarrierCard
                        key={carrier.id}
                        carrier={carrier}
                        tvaRate={tvaRate}
                        selected={deliveryMode === "delivery" && selectedCarrierId === carrier.id}
                        onClick={() => {
                          if (deliveryMode !== "delivery") handleDeliveryModeChange("delivery");
                          setSelectedCarrierId(carrier.id);
                        }}
                        freeShipping={carrierEligibleFree}
                      />
                    );
                  })}
                </div>
              </div>
            )}

            {/* ÉTAPE 1 · Carte séparée "Autres options" (Retrait + Mon transporteur) */}
            {wizardStep === 1 && (
              <div className="bg-bg-primary border border-border rounded-2xl shadow-sm overflow-hidden">
                <div className="px-5 pt-4 pb-2">
                  <div className="text-[10px] uppercase tracking-widest text-text-muted font-semibold">
                    {t("otherOptions")}
                  </div>
                </div>
                <div className="px-5 pb-5 space-y-2">
                  <button
                    type="button"
                    onClick={() => handleDeliveryModeChange("pickup")}
                    className={`w-full text-left border rounded-xl p-4 flex items-center gap-4 transition-all ${
                      deliveryMode === "pickup"
                        ? "border-text-primary bg-bg-secondary shadow-[0_0_0_2px_rgba(26,26,26,0.12)]"
                        : "border-border bg-bg-primary hover:border-text-muted"
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className={`w-5 h-5 rounded-full border-2 shrink-0 flex items-center justify-center transition-colors ${
                        deliveryMode === "pickup" ? "border-text-primary bg-text-primary" : "border-text-muted bg-white"
                      }`}
                    >
                      {deliveryMode === "pickup" && (
                        <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" strokeWidth="3.5" viewBox="0 0 24 24">
                          <polyline points="20 6 9 17 4 12" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </span>
                    <div className="w-11 h-9 rounded-lg bg-bg-tertiary border border-border flex items-center justify-center text-base shrink-0" aria-hidden="true">🏪</div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-body font-semibold text-text-primary">{t("modePickup")}</p>
                      <p className="text-xs text-text-secondary font-body mt-0.5">{t("pickupFreeDesc")}</p>
                    </div>
                    <span className="font-heading font-semibold text-sm text-success shrink-0">{t("free")}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeliveryModeChange("private")}
                    className={`w-full text-left border rounded-xl p-4 flex items-center gap-4 transition-all ${
                      deliveryMode === "private"
                        ? "border-text-primary bg-bg-secondary shadow-[0_0_0_2px_rgba(26,26,26,0.12)]"
                        : "border-border bg-bg-primary hover:border-text-muted"
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className={`w-5 h-5 rounded-full border-2 shrink-0 flex items-center justify-center transition-colors ${
                        deliveryMode === "private" ? "border-text-primary bg-text-primary" : "border-text-muted bg-white"
                      }`}
                    >
                      {deliveryMode === "private" && (
                        <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" strokeWidth="3.5" viewBox="0 0 24 24">
                          <polyline points="20 6 9 17 4 12" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </span>
                    <div className="w-11 h-9 rounded-lg bg-bg-tertiary border border-border flex items-center justify-center text-base shrink-0" aria-hidden="true">📦</div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-body font-semibold text-text-primary">{t("modePrivate")}</p>
                      <p className="text-xs text-text-secondary font-body mt-0.5">{t("privateSelfDesc")}</p>
                    </div>
                    <span className="text-xs text-text-muted shrink-0">{t("yourCharge")}</span>
                  </button>

                  {/* Sous-options transporteur privé (contact ou bordereau) — panneau droit desktop */}
                  {renderPrivateCarrierSubOptions("-desktop")}
                </div>
              </div>
            )}

            {/* ÉTAPE 1 · Carte finale : Récap prix + Total TTC + Boutons (en bas) */}
            {wizardStep === 1 && (
              <div className="bg-bg-primary border border-border rounded-2xl shadow-sm overflow-hidden">
                <div className="px-5 py-4 space-y-1.5 text-sm">
                  <div className="flex justify-between text-text-secondary">
                    <span>{t("subtotalHT")}</span>
                    <span className="tabular-nums">{subtotalHT.toFixed(2)} €</span>
                  </div>
                  {selectedCarrier && (
                    <div className="flex justify-between text-text-secondary">
                      <span>{t("shippingHT")}</span>
                      <span className="tabular-nums">{effectiveCarrierPrice === 0 ? t("free") : `${effectiveCarrierPrice.toFixed(2)} €`}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-text-secondary">
                    <span>{t("tvaProducts")} <span className="text-xs text-text-muted">({tvaLabel})</span></span>
                    <span className="tabular-nums">{selectedAddr ? `${tvaAmount.toFixed(2)} €` : "—"}</span>
                  </div>
                </div>
                <div className="px-5 py-4 border-t border-border">
                  <div className="flex items-baseline justify-between mb-4">
                    <span className="text-[11px] uppercase tracking-widest text-text-muted">{t("totalTTC")}</span>
                    <span className="font-heading text-2xl font-bold text-text-primary tabular-nums">{totalTTC.toFixed(2)} €</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => goToStep(2)}
                    disabled={!step1Ready}
                    className="btn-primary w-full justify-center h-11 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {tCommon("next")}
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                  </button>
                  <button
                    type="button"
                    onClick={() => (onBackToCart ? onBackToCart() : router.push("/panier"))}
                    className="w-full mt-2 py-2 text-xs text-text-muted hover:text-text-primary transition-colors"
                  >
                    ← {t("backToCart")}
                  </button>
                </div>
              </div>
            )}

            {/* ÉTAPE 2 : SummaryPanel + Bouton payer */}
            {wizardStep === 2 && (
              <SummaryPanel
                cart={cart}
                computeUnitPrice={(it) => pickItemUnitPrice(it.id, it.variant, promoInfoByItemId)}
                subtotalHT={subtotalHT}
                clientDiscountAmt={clientDiscountAmt}
                clientDiscount={clientDiscount}
                subtotalAfterDiscount={subtotalAfterDiscount}
                tvaRate={tvaRate}
                tvaLabel={tvaLabel}
                tvaProducts={tvaProducts}
                tvaShipping={tvaShipping}
                carrierPriceHT={effectiveCarrierPrice}
                selectedAddr={selectedAddr}
                deliveryMode={deliveryMode}
                selectedCarrier={selectedCarrier}
                canProceed={canProceed}
                totalTTC={totalTTC}
              />
            )}
            {/* ÉTAPE 2 · Actions : rappel "Total à payer" + retour vers l'étape 1 */}
            {wizardStep === 2 && (
              <div className="bg-bg-primary border border-border rounded-2xl shadow-sm p-5">
                <div className="text-[11px] uppercase tracking-widest text-text-muted mb-2">
                  {t("totalToPay")}
                </div>
                <div className="font-heading text-3xl font-bold text-text-primary tabular-nums mb-3">
                  {totalTTC.toFixed(2)} <span className="text-lg text-text-muted">€ TTC</span>
                </div>
                <p className="text-[11px] text-text-muted mb-4">
                  {t("useCentralFormToPay")}
                </p>
                <button
                  type="button"
                  onClick={() => goToStep(1)}
                  className="w-full py-2 text-xs text-text-muted hover:text-text-primary transition-colors"
                >
                  ← {tCommon("previous")}
                </button>
              </div>
            )}
          </div>
        </aside>

      </div>{/* /grid rail+contenu+actions */}

      {/* ── Drawer récapitulatif (mobile / tablette) ── */}
      {summaryDrawerOpen && (
        <div
          className="fixed inset-0 z-40 lg:hidden bg-bg-dark/40 backdrop-blur-sm transition-opacity"
          onClick={() => setSummaryDrawerOpen(false)}
          aria-hidden
        />
      )}
      <aside
        className={`fixed top-0 right-0 h-full w-full max-w-md bg-bg-primary shadow-2xl z-50 lg:hidden flex flex-col transition-transform duration-300 motion-reduce:transition-none ${
          summaryDrawerOpen ? "translate-x-0" : "translate-x-full"
        }`}
        aria-hidden={!summaryDrawerOpen}
      >
        <div className="bg-bg-dark text-white p-5 flex items-start justify-between">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-text-muted mb-1">
              {t("summaryTitle")}
            </div>
            <div className="font-heading text-lg font-semibold">
              {tCart("categoryItemsCount", { count: itemCount })}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setSummaryDrawerOpen(false)}
            className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 grid place-items-center"
            aria-label={tCommon("close")}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          <SummaryPanel
            cart={cart}
            computeUnitPrice={(it) => pickItemUnitPrice(it.id, it.variant, promoInfoByItemId)}
            subtotalHT={subtotalHT}
            clientDiscountAmt={clientDiscountAmt}
            clientDiscount={clientDiscount}
            subtotalAfterDiscount={subtotalAfterDiscount}
            tvaRate={tvaRate}
            tvaLabel={tvaLabel}
            tvaProducts={tvaProducts}
            tvaShipping={tvaShipping}
            carrierPriceHT={effectiveCarrierPrice}
            selectedAddr={selectedAddr}
            deliveryMode={deliveryMode}
            selectedCarrier={selectedCarrier}
            canProceed={canProceed}
            totalTTC={totalTTC}
            embedded
          />
        </div>
      </aside>
    </div>
  );
}

// ─────────────────────────────────────────────
// Summary panel — collapsible on mobile, sticky on desktop
// ─────────────────────────────────────────────

function SummaryPanel({
  cart, computeUnitPrice: computePrice, subtotalHT, clientDiscountAmt, clientDiscount,
  subtotalAfterDiscount, tvaLabel, tvaProducts, tvaShipping, carrierPriceHT,
  selectedAddr, deliveryMode,
  selectedCarrier, canProceed, totalTTC,
  embedded = false,
}: {
  cart: CartData;
  computeUnitPrice: (item: CartItemData) => number;
  subtotalHT: number;
  clientDiscountAmt: number;
  clientDiscount?: ClientDiscount;
  subtotalAfterDiscount: number;
  tvaRate: number;
  tvaLabel: string;
  tvaProducts: number;
  tvaShipping: number;
  carrierPriceHT: number;
  selectedAddr: Address | null;
  deliveryMode: "delivery" | "pickup" | "private" | "merge";
  selectedCarrier: Carrier | { id: string; name: string; price: number; delay: string } | null;
  canProceed: boolean;
  totalTTC: number;
  /** true = affiché dans le drawer mobile (pas de wrapper sticky, pas de header). */
  embedded?: boolean;
}) {
  const t = useTranslations("checkout");

  const wrapperClass = embedded
    ? ""
    : "bg-bg-primary border border-border rounded-2xl shadow-sm overflow-hidden sticky top-24";

  return (
    <div className={wrapperClass}>
      {!embedded && (
        <div className="w-full px-5 py-4 border-b border-border bg-bg-secondary/50 flex items-center justify-between">
          <h3 className="font-heading text-sm font-semibold text-text-primary">
            {t("summaryTitle")}
          </h3>
        </div>
      )}

      <div>
            {/* Articles */}
            <div className="px-5 py-4 space-y-2 border-b border-border">
              {cart.items.map((item) => {
                const price     = computePrice(item);
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

              {/* Frais de port HT */}
              {(() => {
                // Livraison offerte active seulement si prix transporteur ≤ plafond
                // (miroir strict de la logique serveur).
                const rawCarrierPriceForFree = selectedCarrier?.price ?? 0;
                const freeShippingActive = !!clientDiscount?.freeShipping
                  && (clientDiscount.freeShippingMaxPrice == null
                      || rawCarrierPriceForFree <= clientDiscount.freeShippingMaxPrice);
                return (
                  <div className="flex justify-between text-text-secondary">
                    <span>
                      {deliveryMode === "pickup"
                        ? t("modePickup")
                        : deliveryMode === "private"
                          ? t("modePrivate")
                          : t("shippingHT")}
                    </span>
                    <span className={`font-medium ${
                      (deliveryMode === "pickup" || deliveryMode === "private" || (freeShippingActive && selectedCarrier))
                        ? "text-accent-dark"
                        : "text-text-primary"
                    }`}>
                      {deliveryMode === "pickup" || deliveryMode === "private"
                        ? t("free")
                        : selectedCarrier
                          ? (freeShippingActive
                              ? t("offered")
                              : carrierPriceHT === 0 ? t("free") : `${carrierPriceHT.toFixed(2)} €`)
                          : "—"}
                    </span>
                  </div>
                );
              })()}

              {/* TVA sur articles */}
              <div className="flex justify-between text-text-secondary">
                <span>{t("tvaProducts")} <span className="text-xs text-text-muted">({tvaLabel})</span></span>
                <span className="font-medium text-text-primary">
                  {selectedAddr ? `${tvaProducts.toFixed(2)} €` : "—"}
                </span>
              </div>

              {/* TVA sur port — masquée quand le port est offert ou nul (cap freeShipping inclus via carrierPriceHT). */}
              {selectedAddr && (deliveryMode === "delivery") && selectedCarrier && carrierPriceHT > 0 && (
                <div className="flex justify-between text-text-secondary">
                  <span>{t("tvaShipping")} <span className="text-xs text-text-muted">({tvaLabel})</span></span>
                  <span className="font-medium text-text-primary">{tvaShipping.toFixed(2)} €</span>
                </div>
              )}

              <div className="border-t border-border pt-3 flex justify-between items-center mt-2">
                <span className="font-semibold text-text-primary">{t("totalTTC")}</span>
                <span className="font-heading font-semibold text-lg text-text-primary">
                  {canProceed ? `${totalTTC.toFixed(2)} €` : "—"}
                </span>
              </div>
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

// Badge vérifié pour la fiche client (Phase 2B)
function VerifiedBadge({ label, value, mono = false, verified = false }: { label: string; value: string; mono?: boolean; verified?: boolean }) {
  return (
    <div className="p-3 rounded-lg bg-bg-tertiary border border-border">
      <div className="flex items-center gap-1.5 mb-1">
        {verified ? (
          <span className="w-4 h-4 rounded-full bg-success flex items-center justify-center shrink-0" aria-label="Vérifié">
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" className="text-white" aria-hidden="true">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </span>
        ) : (
          <span className="w-4 h-4 rounded-full border border-border-dark shrink-0" aria-hidden="true" />
        )}
        <span className="text-[10px] uppercase tracking-widest text-text-muted font-semibold">{label}</span>
      </div>
      <div className={`text-text-primary truncate ${mono ? "font-mono text-[11px]" : "text-xs font-medium"}`}>{value}</div>
    </div>
  );
}
