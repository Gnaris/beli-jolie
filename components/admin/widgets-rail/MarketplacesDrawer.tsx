"use client";

/**
 * Tiroir « Synchro marketplaces » — Version C validée :
 *  - Erreurs (rouge) + En cours (bleu clair) ouvertes par défaut
 *  - En attente (gris) + Terminés (vert) refermés par défaut
 *  - Vue compact : 1 ligne par produit avec 4 pastilles P/A/E/F
 *
 * Alimenté par `useMarketplaceRefreshQueue()` — même contexte que l'ancien
 * widget flottant, seule la présentation change.
 */

import { useEffect } from "react";
import { useRightRail } from "./RightRailContext";
import { DrawerShell } from "./DrawerShell";
import {
  useMarketplaceRefreshQueue,
  isItemActive,
  hasError,
  type MarketplaceRefreshItem,
} from "@/components/admin/products/MarketplaceRefreshContext";

const MARKETPLACES_ICON = (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 00-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 00-16.536-1.84M7.5 14.25L5.106 5.272M6 20.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm12.75 0a.75.75 0 11-1.5 0 .75.75 0 011.5 0z"
    />
  </svg>
);

type Section = "errors" | "active" | "queued" | "done";

interface Groups {
  errors: MarketplaceRefreshItem[];
  active: MarketplaceRefreshItem[];
  queued: MarketplaceRefreshItem[];
  done: MarketplaceRefreshItem[];
}

function classify(item: MarketplaceRefreshItem): Section {
  if (hasError(item) && !isItemActive(item)) return "errors";
  if (item.status === "in_progress" || item.status === "awaiting_callback") return "active";
  if (item.status === "queued") return "queued";
  return "done";
}

export function MarketplacesDrawer() {
  const { openWidget, close, setBadge } = useRightRail();
  const { items, clear, runningCount, queuedCount } = useMarketplaceRefreshQueue();

  const groups: Groups = { errors: [], active: [], queued: [], done: [] };
  for (const item of items) groups[classify(item)].push(item);

  const activeCount = groups.active.length + groups.queued.length;

  useEffect(() => {
    setBadge("marketplaces", {
      count: activeCount || groups.errors.length,
      pulse: activeCount > 0 || groups.errors.length > 0,
    });
  }, [activeCount, groups.errors.length, setBadge]);

  const totalProcessed = groups.done.length;
  const totalPlanned = items.length;
  const pct = totalPlanned === 0 ? 0 : Math.round((totalProcessed / totalPlanned) * 100);

  const title =
    activeCount > 0
      ? `${runningCount + queuedCount} produit${runningCount + queuedCount > 1 ? "s" : ""} en cours`
      : groups.errors.length > 0
      ? `${groups.errors.length} erreur${groups.errors.length > 1 ? "s" : ""}`
      : totalProcessed > 0
      ? `${totalProcessed} terminé${totalProcessed > 1 ? "s" : ""}`
      : "Aucun lot";

  return (
    <DrawerShell
      open={openWidget === "marketplaces"}
      onClose={close}
      accent="sky"
      eyebrow="Marketplaces"
      title={
        <span className="flex items-center gap-1.5">
          {activeCount > 0 && (
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          )}
          {title}
        </span>
      }
      icon={MARKETPLACES_ICON}
      footer={
        items.length > 0 ? (
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-slate-500 tabular-nums">
              {totalProcessed} / {totalPlanned}
            </span>
            <button
              type="button"
              onClick={clear}
              className="text-slate-500 hover:text-slate-700 underline"
            >
              Vider la liste
            </button>
          </div>
        ) : undefined
      }
    >
      {items.length === 0 ? (
        <div className="p-6 text-center">
          <p className="text-sm text-slate-500">Aucune synchro en cours.</p>
          <p className="text-[11px] text-slate-400 mt-1">
            Les rafraîchissements marketplaces déclenchés depuis la page Produits
            apparaîtront ici.
          </p>
        </div>
      ) : (
        <>
          {totalPlanned > 0 && (
            <div className="px-4 py-2 border-b border-slate-100">
              <div className="relative h-1.5 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="absolute inset-y-0 left-0 bg-gradient-to-r from-sky-500 to-sky-400 rounded-full transition-all duration-500"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          )}
          {groups.errors.length > 0 && (
            <Section title="Erreurs" tone="rose" count={groups.errors.length} defaultOpen>
              {groups.errors.map((it) => (
                <ItemRow key={it.id} item={it} />
              ))}
            </Section>
          )}
          {groups.active.length > 0 && (
            <Section title="En cours" tone="sky" count={groups.active.length} defaultOpen>
              {groups.active.map((it) => (
                <ItemRow key={it.id} item={it} />
              ))}
            </Section>
          )}
          {groups.queued.length > 0 && (
            <Section title="En attente" tone="slate" count={groups.queued.length}>
              {groups.queued.map((it) => (
                <ItemRow key={it.id} item={it} />
              ))}
            </Section>
          )}
          {groups.done.length > 0 && (
            <Section title="Terminés" tone="emerald" count={groups.done.length}>
              {groups.done.map((it) => (
                <ItemRow key={it.id} item={it} />
              ))}
            </Section>
          )}
        </>
      )}
    </DrawerShell>
  );
}

// ────────────────────────────────────────────────────────
// Sections pliables (Version C)
// ────────────────────────────────────────────────────────

const TONE_CLASSES = {
  rose: { bg: "bg-rose-50/40", text: "text-rose-700", badge: "bg-rose-100 text-rose-700" },
  sky: { bg: "bg-sky-50/20", text: "text-slate-800", badge: "bg-sky-100 text-sky-700" },
  slate: { bg: "", text: "text-slate-800", badge: "bg-slate-100 text-slate-600" },
  emerald: { bg: "bg-emerald-50/30", text: "text-emerald-700", badge: "bg-emerald-100 text-emerald-700" },
} as const;

function Section({
  title,
  tone,
  count,
  defaultOpen = false,
  children,
}: {
  title: string;
  tone: keyof typeof TONE_CLASSES;
  count: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const t = TONE_CLASSES[tone];
  return (
    <details open={defaultOpen} className="border-b border-slate-100">
      <summary className={`px-4 py-2.5 flex items-center gap-2 cursor-pointer hover:bg-slate-50/60 ${t.bg} list-none`}>
        <svg className="w-3.5 h-3.5 text-slate-500 transition-transform group-open:rotate-90 [details[open]_&]:rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        <span className={`text-sm font-semibold flex-1 ${t.text}`}>{title}</span>
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${t.badge}`}>{count}</span>
      </summary>
      <div>{children}</div>
    </details>
  );
}

// ────────────────────────────────────────────────────────
// Ligne produit (vue compact avec 4 pastilles)
// ────────────────────────────────────────────────────────

function pillClass(outcome: MarketplaceRefreshItem["pfsOutcome"]): string {
  if (!outcome) return "bg-slate-100 text-slate-400";
  if (!outcome.ok) return "bg-rose-100 text-rose-700";
  return "bg-emerald-100 text-emerald-700";
}

function ItemRow({ item }: { item: MarketplaceRefreshItem }) {
  const inFlight = isItemActive(item);
  return (
    <div className="px-4 py-2 flex items-center gap-2 border-t border-slate-100 first:border-t-0">
      {inFlight ? (
        <svg className="w-3.5 h-3.5 text-sky-600 animate-spin flex-shrink-0" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth={4} />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      ) : hasError(item) ? (
        <svg className="w-3.5 h-3.5 text-rose-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      ) : item.status === "done" ? (
        <svg className="w-3.5 h-3.5 text-emerald-700 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={3}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      ) : (
        <span className="w-3.5 h-3.5 rounded-full bg-slate-200 flex-shrink-0" />
      )}
      <p className="text-xs font-medium truncate flex-1" title={item.reference}>
        {item.productName || item.reference}
      </p>
      <div className="flex gap-1">
        <span title="PFS" className={`w-4 h-4 rounded flex items-center justify-center text-[8px] font-bold ${pillClass(item.pfsOutcome)}`}>
          P
        </span>
        <span title="Ankorstore" className={`w-4 h-4 rounded flex items-center justify-center text-[8px] font-bold ${pillClass(item.ankorsOutcome)}`}>
          A
        </span>
        <span title="eFashion" className={`w-4 h-4 rounded flex items-center justify-center text-[8px] font-bold ${pillClass(item.efashionOutcome)}`}>
          E
        </span>
        <span title="Faire" className={`w-4 h-4 rounded flex items-center justify-center text-[8px] font-bold ${pillClass(item.faireOutcome)}`}>
          F
        </span>
      </div>
    </div>
  );
}
