/**
 * Mapping statut de commande → classes visuelles Tailwind pour le hero client / admin.
 * Utilisé pour aligner le rendu client (page détail commande) sur le rendu admin.
 */

export type OrderStatusCode = "PENDING" | "VALIDATED" | "SHIPPED" | "CANCELLED";

export interface OrderStatusVisual {
  dot: string;
  pill: string;
}

const STATUS_VISUAL: Record<OrderStatusCode, OrderStatusVisual> = {
  PENDING: { dot: "bg-amber-500", pill: "bg-amber-100 text-amber-800" },
  VALIDATED: { dot: "bg-sky-500", pill: "bg-sky-100 text-sky-800" },
  SHIPPED: { dot: "bg-emerald-500", pill: "bg-emerald-100 text-emerald-800" },
  CANCELLED: { dot: "bg-rose-500", pill: "bg-rose-100 text-rose-800" },
};

const FALLBACK: OrderStatusVisual = { dot: "bg-slate-400", pill: "bg-slate-100 text-slate-700" };

export function getOrderStatusVisual(status: string): OrderStatusVisual {
  return STATUS_VISUAL[status as OrderStatusCode] ?? FALLBACK;
}
