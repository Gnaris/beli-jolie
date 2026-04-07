"use client";

import { useState } from "react";
import Link from "next/link";
import ReorderButton from "./ReorderButton";
import CancelOrderButton from "@/components/client/CancelOrderButton";

interface OrderItem {
  productName: string;
  colorName: string | null;
  quantity: number;
  saleType: string;
  packQty: number | null;
  size: string | null;
  sizesJson: string | null;
}

interface SerializedOrder {
  id: string;
  orderNumber: string;
  status: string;
  createdAt: string;
  totalTTC: number;
  tvaRate: number;
  carrierName: string;
  carrierPrice: number;
  shipCity: string;
  shipCountry: string;
  eeTrackingId: string | null;
  trackingUrl: string | null;
  totalItems: number;
  items: OrderItem[];
}

interface Props {
  orders: SerializedOrder[];
  statusLabels: Record<string, string>;
  statusConfig: Record<string, { badgeClass: string }>;
  translations: {
    orderNumber: string;
    date: string;
    status: string;
    items: string;
    items_plural: string;
    carrier: string;
    totalTTC: string;
    details: string;
    free: string;
    tvaExempt: string;
    sizeOption: string;
    actions: string;
  };
}

export default function OrdersTableClient({ orders, statusLabels, statusConfig, translations: t }: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString("fr-FR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  }

  function formatItemSummary(item: OrderItem) {
    let label = item.productName;
    if (item.colorName) label += ` — ${item.colorName}`;
    if (item.saleType === "PACK" && item.packQty) label += ` ×${item.packQty}`;
    if (item.sizesJson) {
      try {
        const sizes: { name: string; quantity: number }[] = JSON.parse(item.sizesJson);
        if (sizes.length > 0) label += ` (${sizes.map(s => `${s.name}×${s.quantity}`).join(", ")})`;
      } catch { /* ignore */ }
    } else if (item.size) {
      label += ` (T. ${item.size})`;
    }
    return label;
  }

  return (
    <div className="bg-bg-primary border border-border rounded-2xl overflow-hidden shadow-sm">
      {/* Desktop table */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm font-body">
          <thead>
            <tr className="border-b border-border bg-bg-secondary/50">
              <th className="text-left px-4 py-3 font-medium text-text-secondary text-xs">{t.orderNumber}</th>
              <th className="text-left px-4 py-3 font-medium text-text-secondary text-xs">{t.date}</th>
              <th className="text-left px-4 py-3 font-medium text-text-secondary text-xs">{t.status}</th>
              <th className="text-center px-4 py-3 font-medium text-text-secondary text-xs">{t.items_plural}</th>
              <th className="text-left px-4 py-3 font-medium text-text-secondary text-xs">{t.carrier}</th>
              <th className="text-right px-4 py-3 font-medium text-text-secondary text-xs">{t.totalTTC}</th>
              <th className="text-right px-4 py-3 font-medium text-text-secondary text-xs"></th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => {
              const cfg = statusConfig[order.status] ?? statusConfig.PENDING;
              const isExpanded = expandedId === order.id;

              return (
                <tr
                  key={order.id}
                  className="border-b border-border last:border-b-0 hover:bg-bg-secondary/30 transition-colors cursor-pointer"
                  onClick={() => setExpandedId(isExpanded ? null : order.id)}
                >
                  <td className="px-4 py-3">
                    <span className="font-heading font-semibold text-text-primary">{order.orderNumber}</span>
                  </td>
                  <td className="px-4 py-3 text-text-secondary">{formatDate(order.createdAt)}</td>
                  <td className="px-4 py-3">
                    <span className={`${cfg.badgeClass} text-xs`}>{statusLabels[order.status]}</span>
                  </td>
                  <td className="px-4 py-3 text-center text-text-secondary">{order.totalItems}</td>
                  <td className="px-4 py-3 text-text-secondary">
                    <span>{order.carrierName}</span>
                    {order.carrierPrice === 0
                      ? <span className="ml-1.5 text-xs text-green-600 font-medium">{t.free}</span>
                      : <span className="ml-1.5 text-xs text-text-muted">{order.carrierPrice.toFixed(2)} €</span>
                    }
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className="font-heading font-semibold text-text-primary">{order.totalTTC.toFixed(2)} €</span>
                    {order.tvaRate === 0 && (
                      <span className="block text-[10px] text-text-muted">{t.tvaExempt}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-2">
                      <Link
                        href={`/commandes/${order.id}`}
                        className="inline-flex items-center gap-1.5 text-xs font-body text-text-secondary hover:text-accent transition-colors border border-border rounded-lg px-3 py-1.5 hover:border-accent"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                            d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                            d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                        {t.details}
                      </Link>
                      <ReorderButton orderId={order.id} />
                      {order.status === "PENDING" && (
                        <CancelOrderButton orderId={order.id} orderNumber={order.orderNumber} />
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="md:hidden divide-y divide-border">
        {orders.map((order) => {
          const cfg = statusConfig[order.status] ?? statusConfig.PENDING;
          const isExpanded = expandedId === order.id;

          return (
            <div key={order.id}>
              <button
                type="button"
                className="w-full px-4 py-3.5 text-left"
                onClick={() => setExpandedId(isExpanded ? null : order.id)}
              >
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <span className="font-heading text-sm font-semibold text-text-primary">{order.orderNumber}</span>
                  <span className={`${cfg.badgeClass} text-xs`}>{statusLabels[order.status]}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-body text-text-muted">{formatDate(order.createdAt)}</span>
                  <span className="font-heading text-sm font-semibold text-text-primary">{order.totalTTC.toFixed(2)} €</span>
                </div>
                <div className="flex items-center justify-between gap-2 mt-1">
                  <span className="text-xs font-body text-text-muted">
                    {order.totalItems} {order.totalItems !== 1 ? t.items_plural : t.items} — {order.carrierName}
                  </span>
                  <svg className={`w-4 h-4 text-text-muted transition-transform ${isExpanded ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </button>

              {isExpanded && (
                <div className="px-4 pb-4 space-y-3">
                  {/* Items */}
                  <div className="space-y-1">
                    {order.items.map((item, i) => (
                      <p key={i} className="text-xs font-body text-text-secondary">
                        {item.quantity}× {formatItemSummary(item)}
                      </p>
                    ))}
                  </div>

                  {/* Tracking */}
                  {order.eeTrackingId && (
                    <p className="text-xs font-body text-text-muted">
                      Suivi :{" "}
                      {order.trackingUrl ? (
                        <a href={order.trackingUrl} target="_blank" rel="noopener noreferrer" className="font-mono text-text-primary hover:underline">
                          {order.eeTrackingId}
                        </a>
                      ) : (
                        <span className="font-mono">{order.eeTrackingId}</span>
                      )}
                    </p>
                  )}

                  {/* Actions */}
                  <div className="flex items-center gap-2 pt-2 border-t border-border flex-wrap">
                    <Link
                      href={`/commandes/${order.id}`}
                      className="inline-flex items-center gap-1.5 text-xs font-body text-text-secondary hover:text-accent transition-colors border border-border rounded-lg px-3 py-2 min-h-[44px] hover:border-accent"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                          d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                          d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                      {t.details}
                    </Link>
                    <ReorderButton orderId={order.id} />
                    {order.status === "PENDING" && (
                      <CancelOrderButton orderId={order.id} orderNumber={order.orderNumber} />
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
