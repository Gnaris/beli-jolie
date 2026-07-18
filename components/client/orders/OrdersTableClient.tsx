"use client";

import { Link } from "@/i18n/navigation";
import { useLocale } from "next-intl";
import ReorderButton from "./ReorderButton";
import CancelOrderButton from "@/components/client/CancelOrderButton";

interface OrderItem {
  productName: string;
  colorName: string | null;
  imagePath: string | null;
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
  updatedAt: string;
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

interface Kpi {
  totalSpent: number;
  pending: number;
  validated: number;
  shipped: number;
}

interface Props {
  orders: SerializedOrder[];
  kpi: Kpi;
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
    trackParcel: string;
    placedOn: string;
    shippedOn: string;
    stepPending: string;
    stepValidated: string;
    stepShipped: string;
    kpiTotalSpent: string;
    kpiPending: string;
    kpiValidated: string;
    kpiShipped: string;
    articlesLabel: string;
    downloadInvoice: string;
  };
}

type StepState = "done" | "active" | "todo";

const STATUS_ORDER: Record<string, number> = { PENDING: 0, VALIDATED: 1, SHIPPED: 2 };

const MAX_THUMBS_LARGE = 6;
const MAX_THUMBS_COMPACT = 3;

function stepStateFor(orderStatus: string, stepIndex: number): StepState {
  if (orderStatus === "CANCELLED") return "todo";
  const current = STATUS_ORDER[orderStatus] ?? 0;
  if (stepIndex < current) return "done";
  if (stepIndex === current) return "active";
  return "todo";
}

function formatEuro(amount: number, locale: string) {
  return new Intl.NumberFormat(locale === "fr" ? "fr-FR" : "en-US", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 2,
  }).format(amount);
}

function formatDate(iso: string, locale: string) {
  return new Date(iso).toLocaleDateString(locale === "fr" ? "fr-FR" : "en-US", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function Thumb({ imagePath, label }: { imagePath: string | null; label: string }) {
  if (imagePath) {
    return (
      <div className="w-11 h-11 rounded-lg overflow-hidden border border-border bg-bg-tertiary flex-shrink-0">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={imagePath} alt={label} className="w-full h-full object-cover" loading="lazy" />
      </div>
    );
  }
  return (
    <div className="w-11 h-11 rounded-lg border border-border bg-bg-tertiary flex-shrink-0 flex items-center justify-center text-[10px] font-medium text-text-muted uppercase">
      {label.slice(0, 2)}
    </div>
  );
}

function ThumbsRow({ items, max }: { items: OrderItem[]; max: number }) {
  const shown = items.slice(0, max);
  const rest = items.length - shown.length;
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {shown.map((it, i) => (
        <Thumb key={i} imagePath={it.imagePath} label={it.productName} />
      ))}
      {rest > 0 && (
        <div className="w-11 h-11 rounded-lg border border-border bg-bg-tertiary flex-shrink-0 flex items-center justify-center text-xs font-semibold text-text-secondary">
          +{rest}
        </div>
      )}
    </div>
  );
}

function TimelineStep({ label, state, index }: { label: string; state: StepState; index: number }) {
  const dotBase = "w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold";
  const dotClass =
    state === "done"
      ? `${dotBase} bg-text-secondary text-text-inverse`
      : state === "active"
      ? `${dotBase} bg-text-primary text-text-inverse shadow-[0_4px_12px_rgba(24,24,27,0.25)]`
      : `${dotBase} bg-bg-tertiary text-text-muted border border-dashed border-border-dark`;

  return (
    <div className="flex flex-col items-center gap-1.5 min-w-0">
      <div className={dotClass}>
        {state === "done" ? (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
          </svg>
        ) : (
          index + 1
        )}
      </div>
      <span
        className={`text-[10px] font-body font-semibold text-center ${
          state === "active" ? "text-text-primary" : state === "done" ? "text-text-secondary" : "text-text-muted"
        }`}
      >
        {label}
      </span>
    </div>
  );
}

function TimelineLine({ state }: { state: StepState }) {
  return (
    <div className="flex-1 h-0.5 bg-border relative">
      {state !== "todo" && (
        <div
          className={`absolute inset-y-0 left-0 ${state === "done" ? "w-full bg-text-secondary" : "w-3/5 bg-text-primary"}`}
        />
      )}
    </div>
  );
}

export default function OrdersTableClient({ orders, kpi, statusLabels, statusConfig, translations: t }: Props) {
  const locale = useLocale();

  return (
    <div className="space-y-6">
      {/* KPI tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
        <div className="bg-bg-primary border border-border rounded-2xl p-4 md:p-5 shadow-sm">
          <p className="text-xs text-text-muted uppercase tracking-wider">{t.kpiTotalSpent}</p>
          <p className="font-heading text-2xl md:text-3xl font-bold text-text-primary mt-1">
            {formatEuro(kpi.totalSpent, locale)}
          </p>
        </div>
        <div className="bg-bg-primary border border-border rounded-2xl p-4 md:p-5 shadow-sm">
          <p className="text-xs text-text-muted uppercase tracking-wider">{t.kpiShipped}</p>
          <p className="font-heading text-2xl md:text-3xl font-bold text-success mt-1">{kpi.shipped}</p>
        </div>
        <div className="bg-bg-primary border border-border rounded-2xl p-4 md:p-5 shadow-sm">
          <p className="text-xs text-text-muted uppercase tracking-wider">{t.kpiValidated}</p>
          <p className="font-heading text-2xl md:text-3xl font-bold text-info mt-1">{kpi.validated}</p>
        </div>
        <div className="bg-bg-primary border border-border rounded-2xl p-4 md:p-5 shadow-sm">
          <p className="text-xs text-text-muted uppercase tracking-wider">{t.kpiPending}</p>
          <p className="font-heading text-2xl md:text-3xl font-bold text-warning mt-1">{kpi.pending}</p>
        </div>
      </div>

      {/* Order cards */}
      <div className="space-y-4">
        {orders.map((order) => {
          const cfg = statusConfig[order.status] ?? statusConfig.PENDING;
          const badge = <span className={`${cfg.badgeClass} text-xs`}>{statusLabels[order.status]}</span>;
          const compact = order.status === "SHIPPED" || order.status === "CANCELLED";

          if (compact) {
            const dateIso = order.status === "SHIPPED" ? order.updatedAt : order.createdAt;
            const dateLabel =
              order.status === "SHIPPED"
                ? t.shippedOn.replace("{date}", formatDate(dateIso, locale))
                : t.placedOn.replace("{date}", formatDate(dateIso, locale));

            return (
              <article
                key={order.id}
                className="bg-bg-primary border border-border rounded-2xl shadow-sm p-4 md:p-5"
              >
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div className="flex items-center gap-4 flex-wrap min-w-0">
                    <div className="min-w-0">
                      <p className="text-xs uppercase tracking-widest text-text-muted">{t.orderNumber}</p>
                      <div className="flex items-center gap-3 mt-1 flex-wrap">
                        <h3 className="font-heading text-lg md:text-xl font-bold text-text-primary">
                          {order.orderNumber}
                        </h3>
                        {badge}
                      </div>
                      <p className="text-xs text-text-muted mt-1">
                        {dateLabel} · {order.totalItems} {order.totalItems > 1 ? t.items_plural : t.items}
                        {order.status === "SHIPPED" && order.eeTrackingId && (
                          <>
                            {" · "}
                            <span className="text-text-secondary">{order.carrierName}</span>{" "}
                            <span className="font-mono text-text-secondary">{order.eeTrackingId}</span>
                          </>
                        )}
                      </p>
                    </div>
                    <div className="hidden sm:flex items-center pl-4 border-l border-border">
                      <ThumbsRow items={order.items} max={MAX_THUMBS_COMPACT} />
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-heading text-lg md:text-xl font-bold text-text-primary mr-2">
                      {formatEuro(order.totalTTC, locale)}
                    </p>
                    {order.status === "SHIPPED" && order.trackingUrl && (
                      <a
                        href={order.trackingUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 px-3 py-2 border border-border rounded-lg text-xs font-semibold text-text-secondary hover:bg-bg-secondary hover:border-border-dark transition-colors"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                            d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                            d="M13 16V5a1 1 0 00-1-1H4a1 1 0 00-1 1v11a1 1 0 001 1h1m8 0h6m-6-8h4l3 5v3a1 1 0 01-1 1h-2" />
                        </svg>
                        {t.trackParcel}
                      </a>
                    )}
                    <Link
                      href={`/commandes/${order.id}`}
                      className="inline-flex items-center gap-1.5 px-3 py-2 border border-border rounded-lg text-xs font-semibold text-text-secondary hover:bg-bg-secondary hover:border-border-dark transition-colors"
                    >
                      {t.details}
                    </Link>
                    <ReorderButton orderId={order.id} />
                  </div>
                </div>
              </article>
            );
          }

          // Full card (PENDING / VALIDATED)
          const dateLabel = t.placedOn.replace("{date}", formatDate(order.createdAt, locale));

          return (
            <article
              key={order.id}
              className="bg-bg-primary border border-border rounded-2xl shadow-sm overflow-hidden"
            >
              <div className="p-5 md:p-6">
                <div className="flex items-start justify-between gap-4 flex-wrap mb-5">
                  <div>
                    <p className="text-xs uppercase tracking-widest text-text-muted">{t.orderNumber}</p>
                    <div className="flex items-center gap-3 mt-1 flex-wrap">
                      <h3 className="font-heading text-xl md:text-2xl font-bold text-text-primary">
                        {order.orderNumber}
                      </h3>
                      {badge}
                    </div>
                    <p className="text-xs text-text-muted mt-1">
                      {dateLabel} · {order.totalItems} {order.totalItems > 1 ? t.items_plural : t.items}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs uppercase tracking-widest text-text-muted">{t.totalTTC}</p>
                    <p className="font-heading text-2xl md:text-3xl font-bold text-text-primary">
                      {formatEuro(order.totalTTC, locale)}
                    </p>
                    {order.tvaRate === 0 && (
                      <span className="block text-[10px] text-text-muted mt-0.5">{t.tvaExempt}</span>
                    )}
                  </div>
                </div>

                {/* Timeline 3 steps */}
                <div className="bg-bg-secondary rounded-2xl p-4 md:p-5 mb-5">
                  <div className="flex items-center gap-2 md:gap-4">
                    <TimelineStep label={t.stepPending} state={stepStateFor(order.status, 0)} index={0} />
                    <TimelineLine state={stepStateFor(order.status, 0)} />
                    <TimelineStep label={t.stepValidated} state={stepStateFor(order.status, 1)} index={1} />
                    <TimelineLine state={stepStateFor(order.status, 1)} />
                    <TimelineStep label={t.stepShipped} state={stepStateFor(order.status, 2)} index={2} />
                  </div>
                </div>

                {/* Thumbnails */}
                <div className="mb-5">
                  <p className="text-xs uppercase tracking-widest text-text-muted mb-2">{t.articlesLabel}</p>
                  <ThumbsRow items={order.items} max={MAX_THUMBS_LARGE} />
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 flex-wrap pt-4 border-t border-border-light">
                  <Link
                    href={`/commandes/${order.id}`}
                    className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-bg-dark text-text-inverse text-sm font-semibold rounded-lg hover:bg-primary-hover transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                        d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                        d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    {t.details}
                  </Link>
                  <ReorderButton orderId={order.id} size="md" />
                  {order.status === "PENDING" && (
                    <CancelOrderButton orderId={order.id} orderNumber={order.orderNumber} size="md" />
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
