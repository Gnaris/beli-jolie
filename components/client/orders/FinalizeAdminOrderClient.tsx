"use client";

/**
 * Finalisation client d'une commande créée par l'admin (isAdminDraft=true).
 * Étapes dans un seul écran :
 *   1. Items (résumé, non modifiable)
 *   2. Adresse de livraison (pré-remplie, modifiable)
 *   3. Transporteur : clic « Chercher les transporteurs disponibles » →
 *      POST /api/carriers → liste des options avec prix
 *   4. Mode de paiement : Virement bancaire OU Carte bancaire (Stripe)
 *   5. Submit → finalizeAdminOrder
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { finalizeAdminOrder, type FinalizePaymentMode } from "@/app/actions/client/finalize-admin-order";

interface Item {
  productName: string;
  productRef: string;
  colorName: string;
  imagePath: string | null;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  sizesJson: string | null;
  saleType: string;
  packQty: number | null;
}

interface SerializedOrder {
  id: string;
  orderNumber: string;
  tvaRate: number;
  subtotalHT: number;
  totalWeightKg: number;
  items: Item[];
  initialShip: {
    firstName: string;
    lastName: string;
    company: string | null;
    address1: string;
    address2: string | null;
    zipCode: string;
    city: string;
    country: string;
  };
}

interface CarrierQuote {
  id: string;
  name: string;
  priceTtc: number;
}

interface CarriersResponse {
  transactionId?: string;
  carriers?: Array<{ id?: string; name?: string; priceTtc?: number; price?: number } | Record<string, unknown>>;
  noCarrierConfigured?: boolean;
  error?: string;
}

interface Props {
  order: SerializedOrder;
  bankTransferEnabled: boolean;
  stripeConfigured: boolean;
}

function fmtEuros(n: number): string {
  return n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

export default function FinalizeAdminOrderClient({ order, bankTransferEnabled, stripeConfigured }: Props) {
  const router = useRouter();
  const toast = useToast();
  const [isPending, startTransition] = useTransition();

  const [ship, setShip] = useState(order.initialShip);
  const [carriers, setCarriers] = useState<CarrierQuote[]>([]);
  const [carrierId, setCarrierId] = useState<string>("");
  const [loadingCarriers, setLoadingCarriers] = useState(false);
  const [paymentMode, setPaymentMode] = useState<FinalizePaymentMode>("BANK_TRANSFER");

  const selectedCarrier = carriers.find((c) => c.id === carrierId) ?? null;
  const carrierPrice = selectedCarrier?.priceTtc ?? 0;
  const tvaAmount = Math.round((order.subtotalHT + carrierPrice) * order.tvaRate * 100) / 100;
  const totalTTC = Math.round((order.subtotalHT + carrierPrice + tvaAmount) * 100) / 100;

  async function fetchCarriers() {
    if (!ship.zipCode || !ship.city || !ship.country) {
      toast.error("Renseignez d'abord code postal, ville et pays.");
      return;
    }
    setLoadingCarriers(true);
    setCarriers([]);
    setCarrierId("");
    try {
      const resp = await fetch("/api/carriers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          zipCode: ship.zipCode,
          country: ship.country,
          weightKg: Math.max(0.1, order.totalWeightKg),
          subtotalHT: order.subtotalHT,
        }),
      });
      const data: CarriersResponse = await resp.json();
      if (!resp.ok) {
        toast.error(data.error ?? "Impossible d'obtenir les transporteurs.");
        return;
      }
      if (data.noCarrierConfigured) {
        toast.error("Aucun transporteur configuré pour cette adresse.");
        return;
      }
      const list: CarrierQuote[] = (data.carriers ?? []).map((c, i) => {
        const row = c as Record<string, unknown>;
        return {
          id: String(row.id ?? row.carrierId ?? row.code ?? `c${i}`),
          name: String(row.name ?? row.carrierName ?? "Transporteur"),
          priceTtc: Number(row.priceTtc ?? row.price ?? 0),
        };
      });
      // On trie par prix croissant
      list.sort((a, b) => a.priceTtc - b.priceTtc);
      setCarriers(list);
      if (list.length > 0) setCarrierId(list[0].id);
    } catch (err) {
      toast.error("Erreur réseau — réessayez.");
      void err;
    } finally {
      setLoadingCarriers(false);
    }
  }

  function handleSubmit() {
    if (!selectedCarrier) {
      toast.error("Choisissez un transporteur avant de payer.");
      return;
    }
    if (paymentMode === "STRIPE_LINK" && !stripeConfigured) {
      toast.error("Le paiement par carte n'est pas disponible.");
      return;
    }
    if (paymentMode === "BANK_TRANSFER" && !bankTransferEnabled) {
      toast.error("Le virement bancaire n'est pas disponible pour cette boutique.");
      return;
    }
    startTransition(async () => {
      const res = await finalizeAdminOrder({
        orderId: order.id,
        shipFirstName: ship.firstName,
        shipLastName: ship.lastName,
        shipCompany: ship.company,
        shipAddress1: ship.address1,
        shipAddress2: ship.address2,
        shipZipCode: ship.zipCode,
        shipCity: ship.city,
        shipCountry: ship.country,
        carrierId: selectedCarrier.id,
        carrierName: selectedCarrier.name,
        carrierPrice: selectedCarrier.priceTtc,
        paymentMode,
      });
      if (!res.success) {
        toast.error("Finalisation impossible", res.error);
        return;
      }
      toast.success("Commande finalisée !");
      if (res.mode === "STRIPE_LINK") {
        window.location.href = res.checkoutUrl;
      } else {
        router.push(`/commandes/${order.id}`);
      }
    });
  }

  return (
    <div className="space-y-6">
      {/* Items (read-only) */}
      <section className="bg-bg-primary border border-border rounded-2xl shadow-sm p-6 md:p-7">
        <h2 className="font-heading text-lg font-semibold text-text-primary mb-4">Articles de la commande</h2>
        <ul className="divide-y divide-border">
          {order.items.map((it, idx) => (
            <li key={idx} className="py-3 flex items-center gap-3">
              {it.imagePath ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/uploads/${it.imagePath}`} alt={it.productName} className="w-14 h-14 rounded-lg object-cover border border-border" />
              ) : (
                <div className="w-14 h-14 rounded-lg bg-bg-tertiary border border-border" />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-body font-semibold text-text-primary truncate">{it.productName}</p>
                <p className="text-xs text-text-muted font-body">
                  <span className="font-mono">{it.productRef}</span>
                  {it.colorName && <> · {it.colorName}</>}
                  <> · {it.quantity} × {fmtEuros(it.unitPrice)}</>
                </p>
              </div>
              <div className="text-sm font-heading font-bold text-text-primary tabular-nums">
                {fmtEuros(it.lineTotal)}
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* Adresse */}
      <section className="bg-bg-primary border border-border rounded-2xl shadow-sm p-6 md:p-7">
        <h2 className="font-heading text-lg font-semibold text-text-primary mb-4">Adresse de livraison</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="text-xs text-text-muted uppercase tracking-wide">Prénom</span>
            <input className="field-input w-full mt-1" value={ship.firstName} onChange={(e) => setShip({ ...ship, firstName: e.target.value })} />
          </label>
          <label className="block">
            <span className="text-xs text-text-muted uppercase tracking-wide">Nom</span>
            <input className="field-input w-full mt-1" value={ship.lastName} onChange={(e) => setShip({ ...ship, lastName: e.target.value })} />
          </label>
          <label className="block sm:col-span-2">
            <span className="text-xs text-text-muted uppercase tracking-wide">Société (optionnel)</span>
            <input className="field-input w-full mt-1" value={ship.company ?? ""} onChange={(e) => setShip({ ...ship, company: e.target.value })} />
          </label>
          <label className="block sm:col-span-2">
            <span className="text-xs text-text-muted uppercase tracking-wide">Adresse</span>
            <input className="field-input w-full mt-1" value={ship.address1} onChange={(e) => setShip({ ...ship, address1: e.target.value })} />
          </label>
          <label className="block sm:col-span-2">
            <span className="text-xs text-text-muted uppercase tracking-wide">Complément (optionnel)</span>
            <input className="field-input w-full mt-1" value={ship.address2 ?? ""} onChange={(e) => setShip({ ...ship, address2: e.target.value })} />
          </label>
          <label className="block">
            <span className="text-xs text-text-muted uppercase tracking-wide">Code postal</span>
            <input className="field-input w-full mt-1" value={ship.zipCode} onChange={(e) => setShip({ ...ship, zipCode: e.target.value })} />
          </label>
          <label className="block">
            <span className="text-xs text-text-muted uppercase tracking-wide">Ville</span>
            <input className="field-input w-full mt-1" value={ship.city} onChange={(e) => setShip({ ...ship, city: e.target.value })} />
          </label>
          <label className="block">
            <span className="text-xs text-text-muted uppercase tracking-wide">Pays (code ISO 2 lettres)</span>
            <input className="field-input w-full mt-1 uppercase" maxLength={2} value={ship.country} onChange={(e) => setShip({ ...ship, country: e.target.value.toUpperCase() })} />
          </label>
        </div>
      </section>

      {/* Transporteur */}
      <section className="bg-bg-primary border border-border rounded-2xl shadow-sm p-6 md:p-7">
        <h2 className="font-heading text-lg font-semibold text-text-primary mb-4">Mode de livraison</h2>
        <button
          type="button"
          onClick={fetchCarriers}
          disabled={loadingCarriers}
          className="btn-secondary px-4 py-2 text-sm disabled:opacity-50"
        >
          {loadingCarriers ? "Recherche…" : carriers.length > 0 ? "Rafraîchir les transporteurs" : "Chercher les transporteurs disponibles"}
        </button>
        {carriers.length > 0 && (
          <ul className="mt-4 space-y-2">
            {carriers.map((c) => (
              <li key={c.id}>
                <label className="flex items-center gap-3 border border-border rounded-xl p-3 cursor-pointer hover:bg-bg-secondary transition-colors">
                  <input
                    type="radio"
                    name="carrier"
                    checked={carrierId === c.id}
                    onChange={() => setCarrierId(c.id)}
                    className="shrink-0"
                  />
                  <span className="text-sm font-body text-text-primary flex-1">{c.name}</span>
                  <span className="text-sm font-heading font-bold text-text-primary tabular-nums">{fmtEuros(c.priceTtc)}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Paiement */}
      <section className="bg-bg-primary border border-border rounded-2xl shadow-sm p-6 md:p-7">
        <h2 className="font-heading text-lg font-semibold text-text-primary mb-4">Mode de paiement</h2>
        <div className="space-y-3">
          {bankTransferEnabled && (
            <label className="flex items-center gap-3 border border-border rounded-xl p-4 cursor-pointer hover:bg-bg-secondary transition-colors">
              <input type="radio" name="paymentMode" checked={paymentMode === "BANK_TRANSFER"} onChange={() => setPaymentMode("BANK_TRANSFER")} />
              <div>
                <p className="text-sm font-body font-semibold text-text-primary">Virement bancaire</p>
                <p className="text-xs text-text-muted font-body">Vous recevrez l'IBAN après validation. Les articles restent réservés.</p>
              </div>
            </label>
          )}
          {stripeConfigured && (
            <label className="flex items-center gap-3 border border-border rounded-xl p-4 cursor-pointer hover:bg-bg-secondary transition-colors">
              <input type="radio" name="paymentMode" checked={paymentMode === "STRIPE_LINK"} onChange={() => setPaymentMode("STRIPE_LINK")} />
              <div>
                <p className="text-sm font-body font-semibold text-text-primary">Carte bancaire</p>
                <p className="text-xs text-text-muted font-body">Paiement sécurisé Stripe — vous serez redirigée.</p>
              </div>
            </label>
          )}
          {!bankTransferEnabled && !stripeConfigured && (
            <p className="text-sm text-red-700 font-body">Aucun mode de paiement n'est configuré. Contactez-nous.</p>
          )}
        </div>
      </section>

      {/* Récap + submit */}
      <section className="bg-slate-900 text-white rounded-2xl p-6 md:p-7">
        <div className="grid gap-2 text-sm">
          <div className="flex justify-between"><span className="opacity-70">Sous-total HT</span><span className="tabular-nums">{fmtEuros(order.subtotalHT)}</span></div>
          <div className="flex justify-between"><span className="opacity-70">Transport TTC</span><span className="tabular-nums">{fmtEuros(carrierPrice)}</span></div>
          <div className="flex justify-between"><span className="opacity-70">TVA ({(order.tvaRate * 100).toFixed(0)} %)</span><span className="tabular-nums">{fmtEuros(tvaAmount)}</span></div>
          <div className="h-px bg-white/10 my-2" />
          <div className="flex justify-between text-lg font-heading font-bold"><span>Total TTC</span><span className="tabular-nums">{fmtEuros(totalTTC)}</span></div>
        </div>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={isPending || !selectedCarrier}
          className="mt-5 w-full inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-white text-slate-900 text-sm font-bold hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {isPending ? "Finalisation…" : paymentMode === "STRIPE_LINK" ? "Payer par carte" : "Confirmer et obtenir l'IBAN"}
        </button>
      </section>
    </div>
  );
}
