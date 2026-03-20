"use client";

import { useState, useTransition, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { saveShippingAddress, deleteShippingAddress } from "@/app/actions/client/cart";
import { placeOrder } from "@/app/actions/client/order";
import CustomSelect from "@/components/ui/CustomSelect";

// ─────────────────────────────────────────────
// Stripe
// ─────────────────────────────────────────────

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!);

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

interface VariantData {
  id: string;
  productId: string;
  colorId: string;
  saleType: "UNIT" | "PACK";
  packQuantity: number | null;
  size: string | null;
  discountType: "PERCENT" | "AMOUNT" | null;
  discountValue: number | null;
  unitPrice: number;
  weight: number;
  color: { name: string };
  subColors?: { color: { name: string } }[];
  product: { id: string; name: string; reference: string; category: { name: string } };
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

const EU_COUNTRIES = new Set([
  "AT","BE","BG","CY","CZ","DE","DK","EE","ES","FI","FR",
  "GR","HR","HU","IE","IT","LT","LU","LV","MT","NL","PL",
  "PT","RO","SE","SI","SK",
]);

/** Code postaux DOM-TOM français */
function isDOMTOM(zipCode: string, country: string): boolean {
  if (country !== "FR") return false;
  const prefix = parseInt(zipCode.slice(0, 3));
  return prefix >= 971 && prefix <= 989;
}

function computeTvaRate(address: Address, vatNumber: string | null): number {
  if (!address) return 0.20;
  const { country, zipCode } = address;
  if (country === "FR") {
    if (isDOMTOM(zipCode, country)) return 0; // DOM-TOM
    return 0.20; // France métropolitaine
  }
  if (EU_COUNTRIES.has(country)) {
    if (vatNumber && vatNumber.trim()) return 0; // Autoliquidation
    return 0.20; // EU sans n° TVA
  }
  return 0; // Export hors UE
}

function getTvaLabel(rate: number, address: Address | null, vatNumber: string | null): string {
  if (!address) return "Calculée après saisie de l'adresse";
  if (rate === 0) {
    if (!address) return "—";
    if (address.country === "FR" && isDOMTOM(address.zipCode, address.country))
      return "0% (DOM-TOM)";
    if (!EU_COUNTRIES.has(address.country))
      return "0% (exportation hors UE)";
    if (vatNumber)
      return "0% (autoliquidation — n° TVA fourni)";
  }
  return `${(rate * 100).toFixed(0)}%`;
}

// ─────────────────────────────────────────────
// Calcul prix
// ─────────────────────────────────────────────

function computeUnitPrice(v: VariantData): number {
  const base = v.saleType === "UNIT" ? v.unitPrice : v.unitPrice * (v.packQuantity ?? 1);
  if (!v.discountType || !v.discountValue) return base;
  if (v.discountType === "PERCENT") return Math.max(0, base * (1 - v.discountValue / 100));
  return Math.max(0, base - v.discountValue);
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
      <label htmlFor={id} className="block text-sm font-[family-name:var(--font-roboto)] font-medium text-text-primary mb-1.5">
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
        <label htmlFor="addr-country" className="block text-sm font-[family-name:var(--font-roboto)] font-medium text-text-primary mb-1.5">
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
      <label className="flex items-center gap-2 text-sm font-[family-name:var(--font-roboto)] text-text-primary cursor-pointer">
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
        <p className="text-sm font-[family-name:var(--font-roboto)] font-semibold text-text-primary">
          {carrier.name}
        </p>
        <p className="text-xs text-text-secondary font-[family-name:var(--font-roboto)] mt-0.5">
          {carrier.delay}
        </p>
      </div>
      <p className="font-[family-name:var(--font-poppins)] font-semibold text-sm text-text-primary shrink-0">
        {carrier.price === 0 ? "Gratuit" : `${carrier.price.toFixed(2)} €`}
      </p>
    </button>
  );
}

// ─────────────────────────────────────────────
// Formulaire paiement Stripe
// ─────────────────────────────────────────────

function StripePaymentForm({
  onSuccess,
  onProcessing,
  onError,
  disabled,
}: {
  onSuccess: (paymentIntentId: string) => void;
  onProcessing: (paymentIntentId: string) => void;
  onError: (msg: string) => void;
  disabled: boolean;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [processing, setProcessing] = useState(false);
  const [ready, setReady] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements || processing || disabled) return;

    setProcessing(true);
    onError("");

    const result = await stripe.confirmPayment({
      elements,
      redirect: "if_required",
    });

    console.log("[Stripe] confirmPayment result:", JSON.stringify({
      error: result.error?.message,
      status: result.paymentIntent?.status,
      id: result.paymentIntent?.id,
    }));

    const { error, paymentIntent } = result;

    if (error) {
      onError(error.message ?? "Erreur lors du paiement.");
      setProcessing(false);
    } else if (paymentIntent && paymentIntent.status === "succeeded") {
      onSuccess(paymentIntent.id);
    } else if (paymentIntent && (paymentIntent.status === "processing" || paymentIntent.status === "requires_action")) {
      // Virement bancaire : "requires_action" = coordonnées bancaires affichées
      // ou "processing" = virement en cours de traitement
      onProcessing(paymentIntent.id);
    } else {
      onError("Le paiement n'a pas abouti. Veuillez réessayer.");
      setProcessing(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <PaymentElement
        onReady={() => setReady(true)}
        options={{
          layout: "tabs",
        }}
      />
      <button
        type="submit"
        disabled={!stripe || !elements || processing || !ready || disabled}
        className="btn-primary w-full justify-center disabled:opacity-40 disabled:cursor-not-allowed hover:-translate-y-0.5 hover:shadow-lg transition-all duration-200"
      >
        {processing ? (
          <>
            <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Paiement en cours…
          </>
        ) : (
          <>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5z" />
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
  const [orderError, setOrderError] = useState("");

  // Stripe
  const [clientSecret, setClientSecret]       = useState<string | null>(null);
  const [paymentIntentId, setPaymentIntentId] = useState<string | null>(null);
  const [stripeLoading, setStripeLoading]     = useState(false);
  const [stripeError, setStripeError]         = useState("");

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
  const [carriersLoading, setCarriersLoading]     = useState(false);
  const [carriersError, setCarriersError]         = useState("");
  const selectedCarrier = deliveryMode === "pickup"
    ? { id: "pickup_store", name: "Retrait en boutique", price: 0, delay: "" }
    : (carriers.find((c) => c.id === selectedCarrierId) ?? null);

  // TVA
  const vatNumber = user.vatNumber;
  const tvaRate   = selectedAddr ? computeTvaRate(selectedAddr, vatNumber) : 0;
  const tvaLabel  = getTvaLabel(tvaRate, selectedAddr, vatNumber);

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
        else { setTransactionId(data.transactionId ?? ""); setCarriers(data.carriers ?? []); }
      })
      .catch((err) => { if (err.name !== "AbortError") setCarriersError("Impossible de charger les transporteurs."); })
      .finally(() => setCarriersLoading(false));

    return () => controller.abort();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAddrId]);

  // Sauvegarder une nouvelle adresse
  function handleSaveAddress(data: typeof EMPTY_ADDR & { isDefault: boolean }) {
    startTransition(async () => {
      const saved = await saveShippingAddress({ ...data, label: `${data.city} — ${data.address1}`.slice(0, 50) });
      setAddresses((prev) => {
        const updated = data.isDefault
          ? prev.map((a) => ({ ...a, isDefault: false }))
          : prev;
        return [...updated, saved as Address];
      });
      setSelectedAddrId((saved as Address).id);
      setShowAddressForm(false);
    });
  }

  function handleSameAsBilling(checked: boolean) {
    setSameAsBilling(checked);
    if (checked && billingInfo.address1 && billingInfo.zipCode && billingInfo.city) {
      startTransition(async () => {
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
      });
    }
  }

  function handleDeleteAddress(addrId: string) {
    startTransition(async () => {
      await deleteShippingAddress(addrId);
      setAddresses((prev) => prev.filter((a) => a.id !== addrId));
      if (selectedAddrId === addrId) {
        setSelectedAddrId(null);
        setCarriers([]);
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
        body: JSON.stringify({
          addressId:    selectedAddr!.id,
          carrierId:    selectedCarrier!.id,
          carrierName:  selectedCarrier!.name,
          carrierPrice: effectiveCarrierPrice,
          tvaRate,
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
    startTransition(async () => {
      const result = await placeOrder({
        addressId:             selectedAddr!.id,
        carrierId:             selectedCarrier!.id,
        transactionId,
        carrierName:           selectedCarrier!.name,
        carrierPrice:          effectiveCarrierPrice,
        tvaRate,
        stripePaymentIntentId: piId,
      });
      if (result.success) {
        router.push(`/commandes/${result.orderId}?success=1`);
      } else {
        setOrderError(result.error);
      }
    });
  }

  // Virement bancaire initié (processing) → créer la commande en attente de virement
  function handlePaymentProcessing(piId: string) {
    setOrderError("");
    startTransition(async () => {
      try {
        const result = await placeOrder({
          addressId:             selectedAddr!.id,
          carrierId:             selectedCarrier!.id,
          transactionId,
          carrierName:           selectedCarrier!.name,
          carrierPrice:          effectiveCarrierPrice,
          tvaRate,
          stripePaymentIntentId: piId,
        });
        if (result.success) {
          // Rediriger immédiatement vers la page commande avec un paramètre
          // pour éviter que le revalidatePath ne nous redirige vers /panier
          router.push(`/commandes/${result.orderId}?awaiting_transfer=1`);
        } else {
          setOrderError(result.error);
        }
      } catch (err) {
        console.error("[Checkout] placeOrder exception:", err);
        setOrderError("Erreur inattendue lors de la création de la commande.");
      }
    });
  }

  return (
    <div className="container-site py-10 md:py-14">
      {/* En-tête */}
      <div className="mb-8">
        <Link href="/panier" className="text-xs font-[family-name:var(--font-roboto)] text-text-secondary hover:text-text-primary flex items-center gap-1 mb-4 transition-colors">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
          </svg>
          Retour au panier
        </Link>
        <p className="text-xs font-[family-name:var(--font-roboto)] font-medium tracking-[0.2em] uppercase text-text-muted mb-1">
          Commande
        </p>
        <h1 className="font-[family-name:var(--font-poppins)] text-2xl md:text-3xl font-semibold text-text-primary">
          Finaliser la commande
        </h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-8">

        {/* ── Colonne principale ─────────────────── */}
        <div className="lg:col-span-2 space-y-6">

          {/* ── 1. Informations client + adresse de facturation ── */}
          <section className="bg-bg-primary border border-border rounded-2xl overflow-hidden shadow-card">
            <div className="px-5 py-3.5 border-b border-border bg-bg-secondary flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-bg-dark text-text-inverse text-xs font-bold flex items-center justify-center shrink-0">1</span>
                <h2 className="font-[family-name:var(--font-poppins)] text-sm font-semibold text-text-primary uppercase tracking-wide">
                  Informations client
                </h2>
              </div>
              <button type="button" onClick={() => setEditingInfo((v) => !v)}
                className="text-xs font-[family-name:var(--font-roboto)] text-text-secondary hover:text-text-primary transition-colors">
                {editingInfo ? "Fermer" : "Modifier"}
              </button>
            </div>

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
                  <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider font-[family-name:var(--font-roboto)] mb-3">Adresse de facturation</p>
                  <div className="space-y-4">
                    <FieldInput id="bi-a1" label="Adresse" value={billingInfo.address1} onChange={(v) => setBillingInfo((p) => ({ ...p, address1: v }))} placeholder="12 rue des Fleurs" required />
                    <FieldInput id="bi-a2" label="Complement" value={billingInfo.address2} onChange={(v) => setBillingInfo((p) => ({ ...p, address2: v }))} optional placeholder="Bat. A, porte 3" />
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <FieldInput id="bi-zip" label="Code postal" value={billingInfo.zipCode} onChange={(v) => setBillingInfo((p) => ({ ...p, zipCode: v }))} required />
                      <FieldInput id="bi-city" label="Ville" value={billingInfo.city} onChange={(v) => setBillingInfo((p) => ({ ...p, city: v }))} required />
                    </div>
                    <div>
                      <label htmlFor="bi-country" className="block text-sm font-[family-name:var(--font-roboto)] font-medium text-text-primary mb-1.5">Pays</label>
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
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm font-[family-name:var(--font-roboto)]">
                  <InfoLine label="Societe"   value={billingInfo.company} />
                  <InfoLine label="Contact"   value={`${billingInfo.firstName} ${billingInfo.lastName}`} />
                  <InfoLine label="Email"     value={billingInfo.email} />
                  <InfoLine label="Telephone" value={billingInfo.phone} />
                  <InfoLine label="SIRET"     value={user.siret} mono />
                  {vatNumber && <InfoLine label="N° TVA" value={vatNumber} mono />}
                </div>
                {billingInfo.address1 && (
                  <div className="border-t border-border pt-3">
                    <p className="text-xs font-semibold text-text-muted uppercase tracking-wider font-[family-name:var(--font-roboto)] mb-1">Adresse de facturation</p>
                    <p className="text-sm text-text-primary font-[family-name:var(--font-roboto)]">
                      {billingInfo.address1}{billingInfo.address2 ? `, ${billingInfo.address2}` : ""}
                    </p>
                    <p className="text-sm text-text-secondary font-[family-name:var(--font-roboto)]">
                      {billingInfo.zipCode} {billingInfo.city}, {EU_COUNTRY_OPTIONS.find((c) => c.code === billingInfo.country)?.label ?? billingInfo.country}
                    </p>
                  </div>
                )}
              </div>
            )}
          </section>

          {/* ── 2. Adresse de livraison ── */}
          <section className="bg-bg-primary border border-border rounded-2xl overflow-hidden shadow-card">
            <div className="px-5 py-3.5 border-b border-border bg-bg-secondary flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-bg-dark text-text-inverse text-xs font-bold flex items-center justify-center shrink-0">2</span>
                <h2 className="font-[family-name:var(--font-poppins)] text-sm font-semibold text-text-primary uppercase tracking-wide">
                  Adresse de livraison
                </h2>
              </div>
              {!showAddressForm && (
                <button type="button" onClick={() => setShowAddressForm(true)}
                  className="text-xs font-[family-name:var(--font-roboto)] text-text-secondary hover:text-text-primary transition-colors flex items-center gap-1">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.5v15m7.5-7.5h-15" />
                  </svg>
                  Nouvelle adresse
                </button>
              )}
            </div>
            <div className="p-5 space-y-3">
              {/* Option: meme adresse que facturation */}
              {billingInfo.address1 && billingInfo.zipCode && billingInfo.city && (
                <label className="flex items-center gap-2.5 p-3 border border-border rounded-xl text-sm font-[family-name:var(--font-roboto)] text-text-primary cursor-pointer hover:bg-bg-secondary transition-colors">
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
                        <p className="text-sm font-[family-name:var(--font-roboto)] font-semibold text-text-primary">
                          {addr.firstName} {addr.lastName}
                          {addr.isDefault && (
                            <span className="ml-2 text-[10px] font-normal bg-bg-secondary text-text-secondary px-1.5 py-0.5 rounded-full">
                              Par defaut
                            </span>
                          )}
                        </p>
                        {addr.company && (
                          <p className="text-xs text-text-secondary font-[family-name:var(--font-roboto)] mt-0.5">{addr.company}</p>
                        )}
                        <p className="text-xs text-text-muted font-[family-name:var(--font-roboto)]">
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
                      className="text-[11px] text-text-muted hover:text-error font-[family-name:var(--font-roboto)] transition-colors flex items-center gap-1"
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
                <p className="text-sm text-text-muted font-[family-name:var(--font-roboto)] text-center py-4">
                  Aucune adresse enregistrée.
                </p>
              )}
            </div>
          </section>

          {/* ── 3. Mode de livraison ── */}
          <section className="bg-bg-primary border border-border rounded-2xl overflow-hidden shadow-card">
            <div className="px-5 py-3.5 border-b border-border bg-bg-secondary flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-bg-dark text-text-inverse text-xs font-bold flex items-center justify-center shrink-0">3</span>
              <h2 className="font-[family-name:var(--font-poppins)] text-sm font-semibold text-text-primary uppercase tracking-wide">
                Mode de livraison
              </h2>
            </div>
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
                  <span className="text-sm font-[family-name:var(--font-roboto)] font-semibold text-text-primary">
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
                  <span className="text-sm font-[family-name:var(--font-roboto)] font-semibold text-text-primary">
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
                      <p className="text-sm font-[family-name:var(--font-roboto)] font-semibold text-text-primary">
                        Retrait gratuit en boutique
                      </p>
                      <p className="text-xs text-text-secondary font-[family-name:var(--font-roboto)] mt-1">
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
                    <p className="text-sm text-text-muted font-[family-name:var(--font-roboto)] text-center py-3">
                      Sélectionnez une adresse de livraison pour voir les transporteurs disponibles.
                    </p>
                  )}

                  {selectedAddr && carriersLoading && (
                    <div className="flex items-center justify-center py-8 gap-3 text-text-muted">
                      <svg className="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      <span className="text-sm font-[family-name:var(--font-roboto)]">Chargement des transporteurs…</span>
                    </div>
                  )}

                  {selectedAddr && !carriersLoading && carriersError && (
                    <div className="bg-[#FEE2E2] border border-[#FECACA] text-[#DC2626] px-4 py-3 text-sm rounded-lg font-[family-name:var(--font-roboto)]">
                      {carriersError}
                    </div>
                  )}

                  {selectedAddr && !carriersLoading && !carriersError && carriers.length === 0 && (
                    <p className="text-sm text-text-muted font-[family-name:var(--font-roboto)] text-center py-3">
                      Aucun transporteur disponible pour cette adresse.
                    </p>
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
          <div className="bg-bg-primary border border-border rounded-2xl shadow-card overflow-hidden sticky top-24">
            <div className="px-5 py-3.5 border-b border-border bg-bg-secondary">
              <h3 className="font-[family-name:var(--font-poppins)] text-sm font-semibold text-text-primary uppercase tracking-wide">
                Récapitulatif
              </h3>
            </div>

            {/* Articles */}
            <div className="px-5 py-4 space-y-2 border-b border-border">
              {cart.items.map((item) => {
                const price     = computeUnitPrice(item.variant);
                const lineTotal = price * item.quantity;
                return (
                  <div key={item.id} className="flex items-start gap-2 text-xs font-[family-name:var(--font-roboto)]">
                    <div className="w-8 h-8 rounded-lg overflow-hidden bg-bg-secondary shrink-0">
                      {item.variantImages[0]?.path ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={item.variantImages[0]!.path}
                          alt={item.variant.product.name}
                          className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full bg-bg-secondary" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-text-primary font-medium line-clamp-1">{item.variant.product.name}</p>
                      <p className="text-text-muted">
                        {item.variant.subColors?.length ? [item.variant.color.name, ...item.variant.subColors.map(sc => sc.color.name)].join("/") : item.variant.color.name}
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
            <div className="px-5 py-4 space-y-2 text-sm font-[family-name:var(--font-roboto)]">
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
                <span className="font-[family-name:var(--font-poppins)] font-semibold text-lg text-text-primary">
                  {canProceed ? `${totalTTC.toFixed(2)} €` : "—"}
                </span>
              </div>
            </div>

            {/* Paiement Stripe */}
            <div className="px-5 pb-5 space-y-3">
              {(orderError || stripeError) && (
                <div className="bg-[#FEE2E2] border border-[#FECACA] text-[#DC2626] text-xs font-[family-name:var(--font-roboto)] px-3 py-2 rounded-lg">
                  {orderError || stripeError}
                </div>
              )}

              {!canProceed && (
                <p className="text-xs text-text-muted font-[family-name:var(--font-roboto)] text-center py-2">
                  Sélectionnez une adresse et un transporteur pour procéder au paiement.
                </p>
              )}

              {/* Bouton pour lancer le paiement — visible tant que le formulaire Stripe n'est pas affiché */}
              {canProceed && !clientSecret && !stripeLoading && (
                <button
                  type="button"
                  onClick={handleInitiatePayment}
                  className="btn-primary w-full justify-center"
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
                  <span className="text-xs font-[family-name:var(--font-roboto)]">Préparation du paiement…</span>
                </div>
              )}

              {canProceed && clientSecret && (
                <>
                  <div className="border-t border-border pt-3">
                    <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider font-[family-name:var(--font-roboto)] mb-3">
                      Paiement sécurisé
                    </p>
                  </div>
                  <Elements
                    stripe={stripePromise}
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
                      onProcessing={handlePaymentProcessing}
                      onError={setStripeError}
                      disabled={isPending}
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
                  <span className="text-xs font-[family-name:var(--font-roboto)]">Création de la commande…</span>
                </div>
              )}

              <div className="flex items-center justify-center gap-1.5 pt-1">
                <svg className="w-3.5 h-3.5 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                </svg>
                <p className="text-xs text-text-muted font-[family-name:var(--font-roboto)]">
                  Paiement sécurisé par Stripe
                </p>
              </div>
            </div>
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
