"use client";

/**
 * Tiroir « Synchro marketplaces » — Section Erreurs en cartes détaillées
 * (variante 2 validée le 2026-07-13, maquette
 * `Downloads/maquette-widget-erreurs-marketplace.html` onglet « Variante 2 »).
 *
 *  - Erreurs (rouge)   : cartes groupées par produit, un bloc par marketplace
 *                        en échec (badge coloré + message + bouton Réessayer).
 *  - En cours (bleu)   : vue compact 1 ligne / produit avec 4 pastilles P/A/E/F.
 *  - En attente (gris) : idem, replié par défaut.
 *  - Terminés (vert)   : idem, replié par défaut.
 *
 * Alimenté par `useMarketplaceRefreshQueue()` — le retry ré-enfile un item
 * identique via `enqueue()` (mode/marketplace/options figés au push initial).
 */

import { useEffect } from "react";
import { useRightRail } from "./RightRailContext";
import { DrawerShell } from "./DrawerShell";
import {
  useMarketplaceRefreshQueue,
  isItemActive,
  hasError,
  type MarketplaceRefreshItem,
  type MarketplaceTarget,
  type TargetOutcome,
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
  const { items, clear, enqueue, runningCount, queuedCount } = useMarketplaceRefreshQueue();

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

  // Groupement des erreurs par produit pour la vue en cartes
  const errorGroups = groupErrorsByProduct(groups.errors);

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
            <div className="px-4 py-2 border-b border-slate-100 bg-white">
              <div className="relative h-1.5 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="absolute inset-y-0 left-0 bg-gradient-to-r from-sky-500 to-sky-400 rounded-full transition-all duration-500"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          )}
          {errorGroups.length > 0 && (
            <Section
              title="Erreurs"
              tone="rose"
              count={groups.errors.length}
              defaultOpen
            >
              <div className="p-3 space-y-3">
                {errorGroups.map((group) => (
                  <ErrorCard
                    key={group.productId}
                    group={group}
                    onRetry={(item) => {
                      enqueue([
                        {
                          productId: item.productId,
                          reference: item.reference,
                          productName: item.productName,
                          firstImage: item.firstImage,
                          options: item.options,
                          mode: item.mode,
                          marketplace: item.marketplace,
                        },
                      ]);
                    }}
                  />
                ))}
              </div>
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
// Sections pliables
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
// Cartes d'erreur (variante 2)
// ────────────────────────────────────────────────────────

interface ErrorGroup {
  productId: string;
  productName: string;
  reference: string;
  firstImage: string | null;
  latestCompletedAt: string | null;
  items: MarketplaceRefreshItem[];
}

/**
 * Regroupe les items en erreur par produit. Garde l'ordre d'arrivée initial
 * du produit (position de son 1er item dans la file), et à l'intérieur d'un
 * groupe les items sont triés par ordre chronologique.
 */
export function groupErrorsByProduct(
  items: ReadonlyArray<MarketplaceRefreshItem>,
): ErrorGroup[] {
  const groupsByProduct = new Map<string, ErrorGroup>();
  for (const item of items) {
    const existing = groupsByProduct.get(item.productId);
    if (existing) {
      existing.items.push(item);
      // Conserve la donnée de photo/nom la plus récente
      if (item.firstImage) existing.firstImage = item.firstImage;
      if (item.productName) existing.productName = item.productName;
      if (item.completedAt) {
        if (!existing.latestCompletedAt || item.completedAt > existing.latestCompletedAt) {
          existing.latestCompletedAt = item.completedAt;
        }
      }
    } else {
      groupsByProduct.set(item.productId, {
        productId: item.productId,
        productName: item.productName,
        reference: item.reference,
        firstImage: item.firstImage,
        latestCompletedAt: item.completedAt ?? null,
        items: [item],
      });
    }
  }
  return [...groupsByProduct.values()];
}

const MARKETPLACE_LABEL: Record<MarketplaceTarget, string> = {
  pfs: "PFS",
  ankorstore: "Ankor",
  efashion: "eFashion",
  faire: "Faire",
};

const MARKETPLACE_PILL_CLASS: Record<MarketplaceTarget, string> = {
  pfs: "bg-gradient-to-r from-sky-500 to-blue-600 text-white",
  ankorstore: "bg-gradient-to-r from-pink-400 to-pink-500 text-white",
  efashion: "bg-gradient-to-r from-amber-500 to-orange-500 text-white",
  faire: "bg-gradient-to-r from-slate-800 to-slate-900 text-white",
};

function modeTitle(mode: MarketplaceRefreshItem["mode"], kind: "not_found" | "error"): string {
  if (kind === "not_found") return "Produit introuvable";
  if (mode === "publish") return "Publication échouée";
  if (mode === "resync") return "Resynchronisation échouée";
  return "Refresh échoué";
}

function ErrorCard({
  group,
  onRetry,
}: {
  group: ErrorGroup;
  onRetry: (item: MarketplaceRefreshItem) => void;
}) {
  const errorCount = group.items.length;
  return (
    <div className="bg-white rounded-xl border border-rose-200 overflow-hidden shadow-sm">
      {/* Header carte : photo + nom + timestamp / compteur */}
      <div className="px-3 py-2 bg-gradient-to-r from-rose-50 to-white border-b border-rose-100 flex items-center gap-2">
        {group.firstImage ? (
          <img
            src={group.firstImage}
            alt=""
            className="w-8 h-8 rounded-lg object-cover bg-slate-100 flex-shrink-0 ring-1 ring-slate-200"
          />
        ) : (
          <div className="w-8 h-8 rounded-lg bg-slate-100 ring-1 ring-slate-200 flex items-center justify-center flex-shrink-0">
            <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.6}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5z" />
            </svg>
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p
            className="text-xs font-semibold truncate text-slate-800"
            title={group.productName || group.reference}
          >
            {group.productName || group.reference}
          </p>
          <p className="text-[10px] text-slate-500 truncate">{group.reference}</p>
        </div>
        {errorCount > 1 ? (
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-rose-100 text-rose-700 font-semibold flex-shrink-0">
            ×{errorCount}
          </span>
        ) : group.latestCompletedAt ? (
          <span className="text-[10px] text-slate-500 flex-shrink-0">
            {relativeTime(group.latestCompletedAt)}
          </span>
        ) : null}
      </div>
      {/* Corps : 1 bloc par marketplace en erreur */}
      <div className="p-3 space-y-2 divide-y divide-rose-100">
        {group.items.map((item, idx) => (
          <ErrorBlock
            key={item.id}
            item={item}
            onRetry={() => onRetry(item)}
            isFirst={idx === 0}
          />
        ))}
      </div>
    </div>
  );
}

function ErrorBlock({
  item,
  onRetry,
  isFirst,
}: {
  item: MarketplaceRefreshItem;
  onRetry: () => void;
  isFirst: boolean;
}) {
  const outcome = failingOutcome(item);
  const title = outcome
    ? modeTitle(item.mode, outcome.ok === false ? outcome.kind : "error")
    : "Erreur inconnue";
  const message = outcome && outcome.ok === false ? outcome.message : "Aucun détail renvoyé.";
  return (
    <div className={`space-y-1.5 ${isFirst ? "" : "pt-2"}`}>
      <div className="flex items-center gap-1.5">
        <span
          className={`inline-flex items-center px-1.5 h-4 rounded text-[9px] font-bold tracking-wide ${
            MARKETPLACE_PILL_CLASS[item.marketplace]
          }`}
        >
          {MARKETPLACE_LABEL[item.marketplace]}
        </span>
        <span className="text-[11px] font-semibold text-rose-700">{title}</span>
      </div>
      <p className="text-xs text-slate-700 leading-relaxed break-words">{message}</p>
      <div>
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-full bg-rose-600 text-white font-semibold hover:bg-rose-700 transition"
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h5M20 20v-5h-5M4 9a8 8 0 0114-5.5M20 15a8 8 0 01-14 5.5" />
          </svg>
          Réessayer
        </button>
      </div>
    </div>
  );
}

function failingOutcome(item: MarketplaceRefreshItem): TargetOutcome | undefined {
  const target = item.marketplace;
  const outcome =
    target === "pfs"
      ? item.pfsOutcome
      : target === "ankorstore"
      ? item.ankorsOutcome
      : target === "efashion"
      ? item.efashionOutcome
      : item.faireOutcome;
  if (outcome && outcome.ok === false) return outcome;
  // Fallback : cherche un outcome en échec sur les autres slots (job legacy multi-cibles)
  for (const o of [item.pfsOutcome, item.ankorsOutcome, item.efashionOutcome, item.faireOutcome]) {
    if (o && o.ok === false) return o;
  }
  return undefined;
}

function relativeTime(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const diffMs = Date.now() - then;
  if (diffMs < 60_000) return "à l'instant";
  const min = Math.floor(diffMs / 60_000);
  if (min < 60) return `il y a ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `il y a ${h} h`;
  const d = Math.floor(h / 24);
  return `il y a ${d} j`;
}

// ────────────────────────────────────────────────────────
// Ligne produit compact (En cours / En attente / Terminés)
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
