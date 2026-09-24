import Link from "next/link";

type OrderSummary = {
  id: string;
  orderNumber: string;
  createdAt: string;
  totalTTC: number;
  status: "PENDING" | "SHIPPED" | "CANCELLED";
};

export type ClaimItemView = {
  id: string;
  reportedQuantity: number;
  orderItem: {
    id: string;
    productName: string;
    productRef: string;
    colorName: string;
    imagePath: string | null;
    saleType: string;
    packQty: number | null;
    size: string | null;
    sizesJson: string | null;
    quantity: number;
  };
  pricing: {
    originalUnitPrice: number;
    paidUnitPrice: number;
    discountUnitAmt: number;
    discountUnitPct: number;
    refundableAmount: number;
  };
};

/**
 * Récap « Commande concernée » + tableau « Articles signalés » d'une demande
 * service client de type ORDER_RELATED. Utilisé côté admin et côté client
 * (miroir en lecture). Le lien vers la fiche commande diffère selon le rôle.
 *
 * Colonnes prix (par ligne signalée) :
 *   – Prix départ : prix unitaire catalogue avant toute remise
 *   – Remise : montant + pourcentage cumulés (produit + auto-promo + client + code)
 *   – Prix payé : montant réellement payé par unité après TOUTES remises
 *   – Total remboursable = Prix payé × Qté signalée
 * Un total global remboursable est affiché en bas du tableau.
 */
export default function ClaimOrderItemsPanel({
  role,
  order,
  items,
}: {
  role: "admin" | "client";
  order: OrderSummary;
  items: ClaimItemView[];
}) {
  const orderHref = role === "admin" ? `/admin/commandes/${order.id}` : `/commandes/${order.id}`;
  const dateFmt = new Date(order.createdAt).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const totalReported = items.reduce((s, it) => s + it.reportedQuantity, 0);
  const totalRefundable = items.reduce((s, it) => s + it.pricing.refundableAmount, 0);

  return (
    <section className="rounded-2xl border border-border bg-bg-primary overflow-hidden shadow-sm">
      {/* Commande concernée */}
      <div className="px-5 py-4 sm:px-6 sm:py-5 flex items-center justify-between gap-4 flex-wrap border-b border-border">
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-text-primary">
            <span
              className="w-[3px] h-[14px] rounded-[3px]"
              style={{ background: "linear-gradient(180deg, #52525B, #18181B)" }}
            />
            Commande concernée
          </span>
        </div>
        <Link
          href={orderHref}
          className="inline-flex items-center gap-2 rounded-xl border border-border bg-white px-3.5 py-2 text-sm font-semibold text-text-primary hover:bg-bg-secondary transition-colors"
        >
          <span className="font-mono">{order.orderNumber}</span>
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.25 8.25L21 12m0 0l-3.75 3.75M21 12H3" />
          </svg>
        </Link>
      </div>

      <div className="px-5 py-3 sm:px-6 sm:py-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm border-b border-border bg-bg-secondary">
        <Meta label="Date" value={dateFmt} />
        <Meta label="Montant TTC" value={`${order.totalTTC.toFixed(2)} €`} mono />
        <Meta label="Statut" value={statusLabel(order.status)} />
        <Meta label="Total signalé" value={`${totalReported} article${totalReported > 1 ? "s" : ""}`} strong />
      </div>

      {/* Articles signalés */}
      <div className="px-5 pt-4 sm:px-6 sm:pt-5">
        <span className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-text-primary">
          <span
            className="w-[3px] h-[14px] rounded-[3px]"
            style={{ background: "linear-gradient(180deg, #F59E0B, #B45309)" }}
          />
          Articles signalés
        </span>
      </div>

      {/* Table desktop */}
      <div className="hidden md:block px-5 sm:px-6 py-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left py-2.5 pr-3 text-[11px] font-semibold uppercase tracking-wider text-text-muted">Article</th>
              <th className="text-left py-2.5 pr-3 text-[11px] font-semibold uppercase tracking-wider text-text-muted">Couleur / Taille</th>
              <th className="text-center py-2.5 px-2 text-[11px] font-semibold uppercase tracking-wider text-text-muted">Qté cmd</th>
              <th className="text-center py-2.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-amber-800 bg-amber-50/50">Qté signalée</th>
              <th className="text-right py-2.5 px-2 text-[11px] font-semibold uppercase tracking-wider text-text-muted">Prix départ</th>
              <th className="text-right py-2.5 px-2 text-[11px] font-semibold uppercase tracking-wider text-emerald-700">Remise</th>
              <th className="text-right py-2.5 px-2 text-[11px] font-semibold uppercase tracking-wider text-text-primary">Prix payé</th>
              <th className="text-right py-2.5 pl-3 text-[11px] font-semibold uppercase tracking-wider text-text-primary">Remboursable</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {items.map((ci) => (
              <tr key={ci.id}>
                <td className="py-3 pr-3">
                  <div className="flex items-center gap-3">
                    {ci.orderItem.imagePath ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={ci.orderItem.imagePath} alt="" className="w-12 h-12 rounded-lg object-cover border border-border shrink-0" />
                    ) : (
                      <div className="w-12 h-12 rounded-lg bg-bg-secondary shrink-0" />
                    )}
                    <div className="min-w-0">
                      <p className="font-semibold text-text-primary text-sm line-clamp-2">{ci.orderItem.productName}</p>
                      <p className="text-[11px] text-text-muted font-mono mt-0.5">{ci.orderItem.productRef}</p>
                    </div>
                  </div>
                </td>
                <td className="py-3 pr-3 text-sm text-text-secondary">
                  <span>{ci.orderItem.colorName || "—"}</span>
                  <SizeLine sizesJson={ci.orderItem.sizesJson} legacySize={ci.orderItem.size} />
                </td>
                <td className="py-3 px-2 text-center font-semibold text-text-primary tabular-nums">{ci.orderItem.quantity}</td>
                <td className="py-3 px-3 text-center bg-amber-50/40">
                  <span className="inline-flex items-center justify-center min-w-[3rem] px-3 py-1 rounded-lg bg-amber-100 text-amber-900 font-bold text-base tabular-nums">
                    {ci.reportedQuantity}
                  </span>
                </td>
                <td className="py-3 px-2 text-right text-text-secondary tabular-nums">
                  {ci.pricing.originalUnitPrice > ci.pricing.paidUnitPrice ? (
                    <span className="line-through text-text-muted">{ci.pricing.originalUnitPrice.toFixed(2)} €</span>
                  ) : (
                    <span>{ci.pricing.originalUnitPrice.toFixed(2)} €</span>
                  )}
                </td>
                <td className="py-3 px-2 text-right tabular-nums">
                  {ci.pricing.discountUnitAmt > 0.005 ? (
                    <div className="text-emerald-700">
                      <div className="font-semibold">−{ci.pricing.discountUnitAmt.toFixed(2)} €</div>
                      <div className="text-[11px]">−{ci.pricing.discountUnitPct.toFixed(1)} %</div>
                    </div>
                  ) : (
                    <span className="text-text-muted">—</span>
                  )}
                </td>
                <td className="py-3 px-2 text-right font-bold text-text-primary tabular-nums">
                  {ci.pricing.paidUnitPrice.toFixed(2)} €
                </td>
                <td className="py-3 pl-3 text-right font-bold text-text-primary tabular-nums">
                  {ci.pricing.refundableAmount.toFixed(2)} €
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-border">
              <td colSpan={7} className="py-3 pr-3 text-right text-sm font-semibold uppercase tracking-wider text-text-muted">
                Total remboursable estimé
              </td>
              <td className="py-3 pl-3 text-right font-heading font-bold text-lg text-text-primary tabular-nums">
                {totalRefundable.toFixed(2)} €
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Cards mobile */}
      <div className="md:hidden divide-y divide-border">
        {items.map((ci) => (
          <div key={ci.id} className="px-5 py-4 space-y-3">
            <div className="flex items-start gap-3">
              {ci.orderItem.imagePath ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={ci.orderItem.imagePath} alt="" className="w-14 h-14 rounded-lg object-cover border border-border shrink-0" />
              ) : (
                <div className="w-14 h-14 rounded-lg bg-bg-secondary shrink-0" />
              )}
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-text-primary text-sm line-clamp-2">{ci.orderItem.productName}</p>
                <p className="text-[11px] text-text-muted font-mono mt-0.5">{ci.orderItem.productRef}</p>
                <p className="text-xs text-text-secondary mt-1">
                  {ci.orderItem.colorName || "—"}
                  <SizeLine sizesJson={ci.orderItem.sizesJson} legacySize={ci.orderItem.size} inline />
                </p>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-text-muted">
                Commandé : <strong className="text-text-primary">{ci.orderItem.quantity}</strong>
              </span>
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-amber-100 text-amber-900 font-bold text-sm">
                Signalé × {ci.reportedQuantity}
              </span>
            </div>

            <div className="rounded-xl bg-bg-secondary p-3 space-y-1.5 text-sm">
              <div className="flex justify-between text-text-secondary">
                <span>Prix départ</span>
                <span className={ci.pricing.discountUnitAmt > 0.005 ? "line-through text-text-muted tabular-nums" : "tabular-nums"}>
                  {ci.pricing.originalUnitPrice.toFixed(2)} €
                </span>
              </div>
              {ci.pricing.discountUnitAmt > 0.005 && (
                <div className="flex justify-between text-emerald-700 font-semibold">
                  <span>Remise (−{ci.pricing.discountUnitPct.toFixed(1)} %)</span>
                  <span className="tabular-nums">−{ci.pricing.discountUnitAmt.toFixed(2)} €</span>
                </div>
              )}
              <div className="flex justify-between font-bold text-text-primary pt-1 border-t border-border">
                <span>Prix payé unitaire</span>
                <span className="tabular-nums">{ci.pricing.paidUnitPrice.toFixed(2)} €</span>
              </div>
              <div className="flex justify-between font-bold text-text-primary">
                <span>Remboursable</span>
                <span className="tabular-nums">{ci.pricing.refundableAmount.toFixed(2)} €</span>
              </div>
            </div>
          </div>
        ))}

        <div className="px-5 py-4 flex items-center justify-between gap-3 bg-bg-secondary">
          <span className="text-sm font-semibold uppercase tracking-wider text-text-muted">Total remboursable estimé</span>
          <span className="font-heading font-bold text-lg text-text-primary tabular-nums">{totalRefundable.toFixed(2)} €</span>
        </div>
      </div>
    </section>
  );
}

function Meta({ label, value, mono, strong }: { label: string; value: string; mono?: boolean; strong?: boolean }) {
  return (
    <div>
      <p className="text-[10.5px] font-semibold uppercase tracking-wider text-text-muted">{label}</p>
      <p className={`mt-0.5 text-text-primary ${mono ? "font-mono" : ""} ${strong ? "font-bold" : ""}`}>{value}</p>
    </div>
  );
}

function statusLabel(status: OrderSummary["status"]): string {
  if (status === "SHIPPED") return "Expédiée";
  if (status === "PENDING") return "En cours";
  return "Annulée";
}

function SizeLine({ sizesJson, legacySize, inline }: { sizesJson: string | null; legacySize: string | null; inline?: boolean }) {
  const parsed = parseSizes(sizesJson);
  if (parsed.length > 0) {
    const txt = parsed.map((s) => `${s.name} × ${s.quantity}`).join(", ");
    return inline ? <> · {txt}</> : <> · {txt}</>;
  }
  if (legacySize) return inline ? <> · {legacySize}</> : <> · {legacySize}</>;
  return null;
}

function parseSizes(json: string | null): { name: string; quantity: number }[] {
  if (!json) return [];
  try {
    const arr = JSON.parse(json) as { name: string; quantity: number }[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}
