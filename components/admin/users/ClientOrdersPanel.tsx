"use client";

import Link from "next/link";

interface OrderItem {
  id: string;
  productName: string;
  productRef: string;
  colorName: string | null;
  saleType: string;
  packQty: number | null;
  sizesJson: string | null;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
  imagePath: string | null;
}

interface Order {
  id: string;
  orderNumber: string;
  status: string;
  createdAt: string;
  itemCount: number;
  subtotalHT: number;
  tvaAmount: number;
  totalTTC: number;
  carrierName: string | null;
  carrierPrice: number;
  clientDiscountAmt: number;
  clientDiscountType: string | null;
  clientDiscountValue: number | null;
  clientFreeShipping: boolean;
  shipFirstName: string;
  shipLastName: string;
  shipCompany: string | null;
  shipAddress1: string;
  shipAddress2: string | null;
  shipZipCode: string;
  shipCity: string;
  shipCountry: string;
  items: OrderItem[];
}

const STATUS_CONFIG: Record<string, { label: string; badge: string }> = {
  PENDING:   { label: "Nouveau",  badge: "badge badge-warning" },
  VALIDATED: { label: "Validée",  badge: "badge badge-info"    },
  SHIPPED:   { label: "Expédiée", badge: "badge badge-success" },
  CANCELLED: { label: "Annulée",  badge: "badge badge-error"   },
};

export default function ClientOrdersPanel({ orders }: { orders: Order[] }) {
  const totalSpent = orders
    .filter((o) => o.status !== "CANCELLED")
    .reduce((s, o) => s + o.totalTTC, 0);

  return (
    <div className="card overflow-hidden">
      <div className="px-4 sm:px-5 py-3 sm:py-4 border-b border-border bg-bg-secondary flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <span className="w-8 h-8 rounded-lg bg-bg-tertiary flex items-center justify-center text-text-primary shrink-0">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.6}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z" />
              <line x1="3" y1="6" x2="21" y2="6" strokeLinecap="round" />
            </svg>
          </span>
          <h3 className="font-heading text-sm font-semibold text-text-primary truncate">Historique des commandes</h3>
        </div>
        <span className="badge badge-neutral text-[11px] shrink-0">
          {orders.length} cmd{orders.length > 1 ? "s" : ""}
          {totalSpent > 0 && ` · ${totalSpent.toFixed(2)} €`}
        </span>
      </div>

      {orders.length === 0 ? (
        <div className="p-8 text-center">
          <div className="w-12 h-12 rounded-full bg-bg-tertiary flex items-center justify-center mx-auto mb-3">
            <svg className="w-5 h-5 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.6}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z" />
            </svg>
          </div>
          <p className="text-sm text-text-muted">Aucune commande</p>
        </div>
      ) : (
        <>
          <div>
            {orders.map((order) => {
              const sCfg = STATUS_CONFIG[order.status] ?? STATUS_CONFIG.PENDING;
              const cancelled = order.status === "CANCELLED";
              return (
                <Link
                  key={order.id}
                  href={`/admin/commandes/${order.id}`}
                  className="w-full flex items-center gap-3 px-4 sm:px-5 py-3 border-b border-border-light last:border-0 hover:bg-bg-secondary/60 transition-colors text-left"
                >
                  <span className="w-9 h-9 rounded-lg bg-bg-tertiary flex items-center justify-center text-text-primary shrink-0">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.6}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z" />
                    </svg>
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-text-primary truncate">{order.orderNumber}</p>
                      <span className={`${sCfg.badge} text-[10px]`}>{sCfg.label}</span>
                    </div>
                    <p className="text-[11px] text-text-muted truncate">
                      {new Date(order.createdAt).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "2-digit" })}
                      {" · "}
                      {order.itemCount} article{order.itemCount > 1 ? "s" : ""}
                    </p>
                  </div>
                  <span className={`text-sm font-semibold tabular-nums text-right whitespace-nowrap shrink-0 ${cancelled ? "text-text-muted line-through" : "text-text-primary"}`}>
                    {order.totalTTC.toFixed(2)} €
                  </span>
                  <svg className="w-4 h-4 text-text-muted shrink-0 hidden sm:block" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </Link>
              );
            })}
          </div>
          <div className="border-t border-border p-4 bg-bg-secondary flex items-center justify-between">
            <span className="text-sm text-text-secondary">Total dépensé (hors annulations)</span>
            <span className="font-heading text-lg font-bold text-text-primary tabular-nums">{totalSpent.toFixed(2)} €</span>
          </div>
        </>
      )}
    </div>
  );
}
