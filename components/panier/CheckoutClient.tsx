"use client";

import { useState, useTransition, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { saveShippingAddress } from "@/app/actions/client/cart";
import { placeOrder } from "@/app/actions/client/order";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

interface SaleOptionData {
  id: string;
  saleType: "UNIT" | "PACK";
  packQuantity: number | null;
  size: string | null;
  discountType: "PERCENT" | "AMOUNT" | null;
  discountValue: number | null;
  productColor: {
    unitPrice: number;
    weight: number;
    color: { name: string };
    images: { path: string }[];
    product: { id: string; name: string; reference: string; category: { name: string } };
  };
}

interface CartItemData {
  id: string;
  quantity: number;
  saleOption: SaleOptionData;
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

function computeUnitPrice(opt: SaleOptionData): number {
  const { unitPrice } = opt.productColor;
  const base = opt.saleType === "UNIT" ? unitPrice : unitPrice * (opt.packQuantity ?? 1);
  if (!opt.discountType || !opt.discountValue) return base;
  if (opt.discountType === "PERCENT") return Math.max(0, base * (1 - opt.discountValue / 100));
  return Math.max(0, base - opt.discountValue);
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
      <label htmlFor={id} className="block text-sm font-[family-name:var(--font-roboto)] font-medium text-[#1A1A1A] mb-1.5">
        {label}{optional && <span className="text-[#999999] font-normal ml-1">(optionnel)</span>}
        {required && <span className="text-[#1A1A1A] ml-0.5">*</span>}
      </label>
      <input
        id={id} type={type} value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder} required={required}
        className="w-full bg-white border border-[#E5E5E5] rounded-lg px-4 py-2.5 text-sm font-[family-name:var(--font-roboto)] text-[#1A1A1A] placeholder:text-[#999999] focus:outline-none focus:border-[#1A1A1A] focus:shadow-[0_0_0_2px_rgba(26,26,26,0.08)] transition-all"
      />
    </div>
  );
}

// ─────────────────────────────────────────────
// Formulaire d'adresse
// ─────────────────────────────────────────────

const EMPTY_ADDR = {
  label: "", firstName: "", lastName: "", company: "",
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
      <FieldInput id="label" label="Libellé" value={f.label} onChange={set("label")} placeholder="Boutique principale" required />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <FieldInput id="addr-fn" label="Prénom" value={f.firstName} onChange={set("firstName")} required />
        <FieldInput id="addr-ln" label="Nom" value={f.lastName} onChange={set("lastName")} required />
      </div>
      <FieldInput id="addr-co" label="Société" value={f.company} onChange={set("company")} optional />
      <FieldInput id="addr-a1" label="Adresse" value={f.address1} onChange={set("address1")} placeholder="12 rue des Fleurs" required />
      <FieldInput id="addr-a2" label="Complément" value={f.address2} onChange={set("address2")} optional placeholder="Bât. A, porte 3" />
      <div className="grid grid-cols-2 gap-4">
        <FieldInput id="addr-zip" label="Code postal" value={f.zipCode} onChange={set("zipCode")} required />
        <FieldInput id="addr-city" label="Ville" value={f.city} onChange={set("city")} required />
      </div>
      <div>
        <label htmlFor="addr-country" className="block text-sm font-[family-name:var(--font-roboto)] font-medium text-[#1A1A1A] mb-1.5">
          Pays <span className="text-[#1A1A1A]">*</span>
        </label>
        <select
          id="addr-country" value={f.country}
          onChange={(e) => set("country")(e.target.value)}
          className="w-full bg-white border border-[#E5E5E5] rounded-lg px-4 py-2.5 text-sm font-[family-name:var(--font-roboto)] text-[#1A1A1A] focus:outline-none focus:border-[#1A1A1A] focus:shadow-[0_0_0_2px_rgba(26,26,26,0.08)] transition-all"
        >
          {EU_COUNTRY_OPTIONS.map((c) => (
            <option key={c.code} value={c.code}>{c.label}</option>
          ))}
        </select>
      </div>
      <FieldInput id="addr-phone" label="Téléphone" value={f.phone} onChange={set("phone")} type="tel" optional placeholder="0612345678" />
      <label className="flex items-center gap-2 text-sm font-[family-name:var(--font-roboto)] text-[#1A1A1A] cursor-pointer">
        <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)}
          className="accent-[#1A1A1A] w-4 h-4" />
        Définir comme adresse par défaut
      </label>
      <div className="flex gap-3 pt-1">
        <button type="submit" disabled={isSaving}
          className="btn-primary flex-1 justify-center disabled:opacity-60">
          {isSaving ? "Enregistrement…" : "Enregistrer l'adresse"}
        </button>
        <button type="button" onClick={onCancel}
          className="btn-outline px-4 py-2 text-sm">
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
          ? "border-[#1A1A1A] bg-[#F5F5F5] shadow-[0_0_0_2px_rgba(26,26,26,0.15)]"
          : "border-[#E5E5E5] bg-white hover:border-[#555555]"
      }`}
    >
      <div className={`w-5 h-5 rounded-full border-2 shrink-0 flex items-center justify-center ${
        selected ? "border-[#1A1A1A]" : "border-[#999999]"
      }`}>
        {selected && <div className="w-2.5 h-2.5 rounded-full bg-[#1A1A1A]" />}
      </div>
      <div className="flex-1">
        <p className="text-sm font-[family-name:var(--font-roboto)] font-semibold text-[#1A1A1A]">
          {carrier.name}
        </p>
        <p className="text-xs text-[#555555] font-[family-name:var(--font-roboto)] mt-0.5">
          {carrier.delay}
        </p>
      </div>
      <p className="font-[family-name:var(--font-poppins)] font-semibold text-sm text-[#1A1A1A] shrink-0">
        {carrier.price === 0 ? "Gratuit" : `${carrier.price.toFixed(2)} €`}
      </p>
    </button>
  );
}

// ─────────────────────────────────────────────
// Page principale
// ─────────────────────────────────────────────

export default function CheckoutClient({
  cart,
  addresses: initialAddresses,
  user,
}: {
  cart: CartData;
  addresses: Address[];
  user: UserInfo;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [orderResult, setOrderResult] = useState<{ orderNumber: string; orderId: string } | null>(null);
  const [orderError, setOrderError]   = useState("");

  // Adresses
  const [addresses, setAddresses]   = useState<Address[]>(initialAddresses);
  const [selectedAddrId, setSelectedAddrId] = useState<string | null>(
    initialAddresses.find((a) => a.isDefault)?.id ?? initialAddresses[0]?.id ?? null
  );
  const [showAddressForm, setShowAddressForm] = useState(initialAddresses.length === 0);
  const selectedAddr = addresses.find((a) => a.id === selectedAddrId) ?? null;

  // Transporteurs
  const [carriers, setCarriers]         = useState<Carrier[]>([]);
  const [transactionId, setTransactionId] = useState<string>("");
  const [selectedCarrierId, setSelectedCarrierId] = useState<string | null>(null);
  const [carriersLoading, setCarriersLoading]     = useState(false);
  const [carriersError, setCarriersError]         = useState("");
  const selectedCarrier = carriers.find((c) => c.id === selectedCarrierId) ?? null;

  // TVA
  const vatNumber = user.vatNumber;
  const tvaRate   = selectedAddr ? computeTvaRate(selectedAddr, vatNumber) : 0;
  const tvaLabel  = getTvaLabel(tvaRate, selectedAddr, vatNumber);

  // Totaux
  const subtotalHT = cart.items.reduce(
    (s, item) => s + computeUnitPrice(item.saleOption) * item.quantity, 0
  );
  const shippingCost = selectedCarrier?.price ?? 0;
  const tvaAmount    = subtotalHT * tvaRate;
  const totalTTC     = subtotalHT + tvaAmount + shippingCost;

  // Poids total (pour Easy-Express)
  const totalWeightKg = cart.items.reduce((s, item) => {
    const units = item.saleOption.saleType === "PACK"
      ? (item.saleOption.packQuantity ?? 1) * item.quantity
      : item.quantity;
    return s + item.saleOption.productColor.weight * units;
  }, 0);

  // Charger les transporteurs quand l'adresse change
  useEffect(() => {
    if (!selectedAddr) { setCarriers([]); return; }

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
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) { setCarriersError(data.error); setCarriers([]); }
        else { setTransactionId(data.transactionId ?? ""); setCarriers(data.carriers ?? []); }
      })
      .catch(() => setCarriersError("Impossible de charger les transporteurs."))
      .finally(() => setCarriersLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAddrId]);

  // Sauvegarder une nouvelle adresse
  function handleSaveAddress(data: typeof EMPTY_ADDR & { isDefault: boolean }) {
    startTransition(async () => {
      const saved = await saveShippingAddress(data);
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

  const canProceed = !!selectedAddr && !!selectedCarrier;

  function handlePlaceOrder() {
    if (!canProceed) return;
    setOrderError("");
    startTransition(async () => {
      const result = await placeOrder({
        addressId:     selectedAddr!.id,
        carrierId:     selectedCarrier!.id,
        transactionId,
        carrierName:   selectedCarrier!.name,
        carrierPrice:  selectedCarrier!.price,
        tvaRate,
      });
      if (result.success) {
        setOrderResult({ orderNumber: result.orderNumber, orderId: result.orderId });
        router.refresh();
      } else {
        setOrderError(result.error);
      }
    });
  }

  // ── Écran de confirmation ─────────────────────────────────────────────────
  if (orderResult) {
    return (
      <div className="container-site py-14 flex items-center justify-center min-h-[60vh]">
        <div className="max-w-lg w-full bg-white border border-[#E5E5E5] rounded-2xl p-10 shadow-card text-center space-y-5">
          <div className="w-16 h-16 bg-[#F5F5F5] rounded-full flex items-center justify-center mx-auto">
            <svg className="w-8 h-8 text-[#555555]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <div>
            <h1 className="font-[family-name:var(--font-poppins)] text-2xl font-semibold text-[#1A1A1A]">
              Commande validée !
            </h1>
            <p className="mt-2 text-sm font-[family-name:var(--font-roboto)] text-[#555555]">
              Votre commande <span className="font-semibold text-[#1A1A1A]">{orderResult.orderNumber}</span> a bien été enregistrée.
            </p>
            <p className="mt-1 text-sm font-[family-name:var(--font-roboto)] text-[#999999]">
              Un récapitulatif PDF a été envoyé à notre équipe. Vous serez contacté pour la suite.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
            <Link href="/produits" className="btn-outline px-6 py-2.5 text-sm justify-center">
              Continuer mes achats
            </Link>
            <Link href="/espace-pro" className="btn-primary justify-center">
              Mon espace pro
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container-site py-10 md:py-14">
      {/* En-tête */}
      <div className="mb-8">
        <Link href="/panier" className="text-xs font-[family-name:var(--font-roboto)] text-[#555555] hover:text-[#333333] flex items-center gap-1 mb-4 transition-colors">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
          </svg>
          Retour au panier
        </Link>
        <p className="text-xs font-[family-name:var(--font-roboto)] font-medium tracking-[0.2em] uppercase text-[#1A1A1A] mb-1">
          Commande
        </p>
        <h1 className="font-[family-name:var(--font-poppins)] text-2xl md:text-3xl font-semibold text-[#1A1A1A]">
          Finaliser la commande
        </h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

        {/* ── Colonne principale ─────────────────── */}
        <div className="lg:col-span-2 space-y-6">

          {/* ── 1. Informations client ── */}
          <section className="bg-white border border-[#E5E5E5] rounded-2xl overflow-hidden shadow-card">
            <div className="px-5 py-3.5 border-b border-[#E5E5E5] bg-[#F5F5F5] flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-[#1A1A1A] text-white text-xs font-bold flex items-center justify-center shrink-0">1</span>
              <h2 className="font-[family-name:var(--font-poppins)] text-sm font-semibold text-[#1A1A1A] uppercase tracking-wide">
                Informations client
              </h2>
            </div>
            <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm font-[family-name:var(--font-roboto)]">
              <InfoLine label="Société"   value={user.company} />
              <InfoLine label="Contact"   value={`${user.firstName} ${user.lastName}`} />
              <InfoLine label="Email"     value={user.email} />
              <InfoLine label="Téléphone" value={user.phone} />
              <InfoLine label="SIRET"     value={user.siret} mono />
              {vatNumber && <InfoLine label="N° TVA" value={vatNumber} mono />}
            </div>
          </section>

          {/* ── 2. Adresse de livraison ── */}
          <section className="bg-white border border-[#E5E5E5] rounded-2xl overflow-hidden shadow-card">
            <div className="px-5 py-3.5 border-b border-[#E5E5E5] bg-[#F5F5F5] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-[#1A1A1A] text-white text-xs font-bold flex items-center justify-center shrink-0">2</span>
                <h2 className="font-[family-name:var(--font-poppins)] text-sm font-semibold text-[#1A1A1A] uppercase tracking-wide">
                  Adresse de livraison
                </h2>
              </div>
              {!showAddressForm && (
                <button type="button" onClick={() => setShowAddressForm(true)}
                  className="text-xs font-[family-name:var(--font-roboto)] text-[#555555] hover:text-[#333333] transition-colors flex items-center gap-1">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.5v15m7.5-7.5h-15" />
                  </svg>
                  Nouvelle adresse
                </button>
              )}
            </div>
            <div className="p-5 space-y-3">
              {/* Liste adresses existantes */}
              {!showAddressForm && addresses.map((addr) => (
                <button
                  key={addr.id}
                  type="button"
                  onClick={() => setSelectedAddrId(addr.id)}
                  className={`w-full text-left border rounded-xl p-4 transition-all ${
                    selectedAddrId === addr.id
                      ? "border-[#1A1A1A] bg-[#F5F5F5] shadow-[0_0_0_2px_rgba(26,26,26,0.1)]"
                      : "border-[#E5E5E5] bg-white hover:border-[#555555]"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className={`w-4 h-4 rounded-full border-2 mt-0.5 shrink-0 flex items-center justify-center ${
                      selectedAddrId === addr.id ? "border-[#1A1A1A]" : "border-[#999999]"
                    }`}>
                      {selectedAddrId === addr.id && (
                        <div className="w-2 h-2 rounded-full bg-[#1A1A1A]" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-[family-name:var(--font-roboto)] font-semibold text-[#1A1A1A]">
                        {addr.label}
                        {addr.isDefault && (
                          <span className="ml-2 text-[10px] font-normal bg-[#F5F5F5] text-[#333333] px-1.5 py-0.5 rounded-full">
                            Par défaut
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-[#555555] font-[family-name:var(--font-roboto)] mt-0.5">
                        {addr.firstName} {addr.lastName}{addr.company ? ` · ${addr.company}` : ""}
                      </p>
                      <p className="text-xs text-[#999999] font-[family-name:var(--font-roboto)]">
                        {addr.address1}{addr.address2 ? `, ${addr.address2}` : ""} — {addr.zipCode} {addr.city}, {addr.country}
                      </p>
                    </div>
                  </div>
                </button>
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
                <p className="text-sm text-[#999999] font-[family-name:var(--font-roboto)] text-center py-4">
                  Aucune adresse enregistrée.
                </p>
              )}
            </div>
          </section>

          {/* ── 3. Mode de livraison ── */}
          <section className="bg-white border border-[#E5E5E5] rounded-2xl overflow-hidden shadow-card">
            <div className="px-5 py-3.5 border-b border-[#E5E5E5] bg-[#F5F5F5] flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-[#1A1A1A] text-white text-xs font-bold flex items-center justify-center shrink-0">3</span>
              <h2 className="font-[family-name:var(--font-poppins)] text-sm font-semibold text-[#1A1A1A] uppercase tracking-wide">
                Mode de livraison
              </h2>
            </div>
            <div className="p-5 space-y-3">
              {!selectedAddr && (
                <p className="text-sm text-[#999999] font-[family-name:var(--font-roboto)] text-center py-3">
                  Sélectionnez une adresse de livraison pour voir les transporteurs disponibles.
                </p>
              )}

              {selectedAddr && carriersLoading && (
                <div className="flex items-center justify-center py-8 gap-3 text-[#999999]">
                  <svg className="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  <span className="text-sm font-[family-name:var(--font-roboto)]">Chargement des transporteurs…</span>
                </div>
              )}

              {selectedAddr && !carriersLoading && carriersError && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 text-sm rounded-lg font-[family-name:var(--font-roboto)]">
                  {carriersError}
                </div>
              )}

              {selectedAddr && !carriersLoading && !carriersError && carriers.length === 0 && (
                <p className="text-sm text-[#999999] font-[family-name:var(--font-roboto)] text-center py-3">
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
          </section>
        </div>

        {/* ── Récapitulatif ───────────────────────── */}
        <div>
          <div className="bg-white border border-[#E5E5E5] rounded-2xl shadow-card overflow-hidden sticky top-24">
            <div className="px-5 py-3.5 border-b border-[#E5E5E5] bg-[#F5F5F5]">
              <h3 className="font-[family-name:var(--font-poppins)] text-sm font-semibold text-[#1A1A1A] uppercase tracking-wide">
                Récapitulatif
              </h3>
            </div>

            {/* Articles */}
            <div className="px-5 py-4 space-y-2 border-b border-[#E5E5E5]">
              {cart.items.map((item) => {
                const price     = computeUnitPrice(item.saleOption);
                const lineTotal = price * item.quantity;
                return (
                  <div key={item.id} className="flex items-start gap-2 text-xs font-[family-name:var(--font-roboto)]">
                    <div className="w-8 h-8 rounded-lg overflow-hidden bg-[#F5F5F5] shrink-0">
                      {item.saleOption.productColor.images[0]?.path ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={item.saleOption.productColor.images[0].path}
                          alt={item.saleOption.productColor.product.name}
                          className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full bg-[#F5F5F5]" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[#1A1A1A] font-medium line-clamp-1">{item.saleOption.productColor.product.name}</p>
                      <p className="text-[#999999]">
                        {item.saleOption.productColor.color.name}
                        {item.saleOption.saleType === "PACK" ? ` · ×${item.saleOption.packQuantity}` : ""}
                        {" "}× {item.quantity}
                      </p>
                    </div>
                    <span className="text-[#1A1A1A] font-semibold shrink-0">{lineTotal.toFixed(2)} €</span>
                  </div>
                );
              })}
            </div>

            {/* Totaux */}
            <div className="px-5 py-4 space-y-2 text-sm font-[family-name:var(--font-roboto)]">
              <div className="flex justify-between text-[#555555]">
                <span>Sous-total HT</span>
                <span className="font-medium text-[#1A1A1A]">{subtotalHT.toFixed(2)} €</span>
              </div>
              <div className="flex justify-between text-[#555555]">
                <span>TVA <span className="text-xs text-[#999999]">({tvaLabel})</span></span>
                <span className="font-medium text-[#1A1A1A]">
                  {selectedAddr ? `${tvaAmount.toFixed(2)} €` : "—"}
                </span>
              </div>
              <div className="flex justify-between text-[#555555]">
                <span>Livraison</span>
                <span className="font-medium text-[#1A1A1A]">
                  {selectedCarrier
                    ? selectedCarrier.price === 0 ? "Gratuit" : `${selectedCarrier.price.toFixed(2)} €`
                    : "—"}
                </span>
              </div>

              <div className="border-t border-[#E5E5E5] pt-3 flex justify-between items-center mt-2">
                <span className="font-semibold text-[#1A1A1A]">Total TTC</span>
                <span className="font-[family-name:var(--font-poppins)] font-semibold text-lg text-[#1A1A1A]">
                  {canProceed ? `${totalTTC.toFixed(2)} €` : "—"}
                </span>
              </div>
            </div>

            {/* Bouton validation commande */}
            <div className="px-5 pb-5 space-y-3">
              {orderError && (
                <div className="bg-red-50 border border-red-200 text-red-700 text-xs font-[family-name:var(--font-roboto)] px-3 py-2 rounded-lg">
                  {orderError}
                </div>
              )}
              <button
                type="button"
                disabled={!canProceed || isPending}
                onClick={handlePlaceOrder}
                className="btn-primary w-full justify-center disabled:opacity-40 disabled:cursor-not-allowed"
                title={canProceed ? undefined : "Sélectionnez une adresse et un transporteur"}
              >
                {isPending ? (
                  <>
                    <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Validation en cours…
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                        d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    Valider la commande
                  </>
                )}
              </button>
              <p className="text-xs text-[#999999] font-[family-name:var(--font-roboto)] text-center">
                Paiement par virement — notre équipe vous contactera
              </p>
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
      <span className="text-xs font-semibold text-[#999999] uppercase tracking-wider">{label}</span>
      <span className={`text-[#1A1A1A] ${mono ? "font-mono text-xs" : "text-sm"}`}>{value}</span>
    </div>
  );
}

