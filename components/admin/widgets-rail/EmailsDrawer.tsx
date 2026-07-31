"use client";

/**
 * Widget Emails — poll /api/admin/emails/live toutes les 5s pour afficher :
 *  - Envois très récents (dernière minute) — proxy "en cours d'envoi"
 *  - À venir au prochain scan (panier abandonné éligible, retour stock pending)
 *  - Feed des 15 derniers envois (tous scénarios)
 *
 * Alimente le badge du rail avec le total "sending + queued".
 */

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRightRail } from "./RightRailContext";
import { DrawerShell } from "./DrawerShell";
import { dispatchBackInStockNow } from "@/app/actions/admin/email-scenarios";
import { useToast } from "@/components/ui/Toast";

type ScenarioKey = "ABANDONED_CART" | "BACK_IN_STOCK" | "WELCOME" | "NEWSLETTER";

interface LiveSend {
  id: string;
  scenarioKey: ScenarioKey;
  recipientEmail: string;
  subject: string;
  sentAt: string;
  openedAt?: string | null;
  clickedAt?: string | null;
}

interface ScenarioSummary {
  key: ScenarioKey;
  label: string;
  queued: number;
  eligibleClients?: number;
  actionable?: boolean;
}

interface PendingRestockProduct {
  productId: string;
  productName: string;
  reference: string;
  priceLabel: string;
  imageUrl: string | null;
  colors: string[];
  variantsCount: number;
  favoritedBy: number;
  occurredAt: string;
}

interface LiveResponse {
  sending: LiveSend[];
  recent: LiveSend[];
  scenarios: ScenarioSummary[];
  totalQueued: number;
  backInStockPendingProducts: PendingRestockProduct[];
}

const POLL_ACTIVE_MS = 5_000;
const POLL_IDLE_MS = 60_000;

const SCENARIO_LABEL: Record<ScenarioKey, string> = {
  ABANDONED_CART: "Panier abandonné",
  BACK_IN_STOCK: "Retour en stock",
  WELCOME: "Bienvenue",
  NEWSLETTER: "Newsletter",
};

const SCENARIO_COLOR: Record<ScenarioKey, string> = {
  ABANDONED_CART: "text-violet-600 bg-violet-50 border-violet-200",
  BACK_IN_STOCK: "text-emerald-600 bg-emerald-50 border-emerald-200",
  WELCOME: "text-sky-600 bg-sky-50 border-sky-200",
  NEWSLETTER: "text-amber-600 bg-amber-50 border-amber-200",
};

const EMAILS_ICON = (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75"
    />
  </svg>
);

export function EmailsDrawer() {
  const { openWidget, close, setBadge } = useRightRail();
  const [data, setData] = useState<LiveResponse | null>(null);
  const [isVisible, setIsVisible] = useState(true);
  const [pending, startTransition] = useTransition();
  const toast = useToast();
  const isMounted = useRef(true);

  useEffect(
    () => () => {
      isMounted.current = false;
    },
    [],
  );

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/emails/live", { cache: "no-store" });
      if (!res.ok) return;
      const json = (await res.json()) as LiveResponse;
      if (isMounted.current) setData(json);
    } catch {
      // silence
    }
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const update = () => setIsVisible(document.visibilityState === "visible");
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  useEffect(() => {
    if (isVisible) void load();
  }, [isVisible, load]);

  const hasActive = (data?.sending.length ?? 0) > 0 || (data?.totalQueued ?? 0) > 0;

  useEffect(() => {
    if (!isVisible) return;
    const delay = hasActive ? POLL_ACTIVE_MS : POLL_IDLE_MS;
    const id = window.setInterval(load, delay);
    return () => window.clearInterval(id);
  }, [hasActive, isVisible, load]);

  // Badge : sending + queued (rappels imminents)
  useEffect(() => {
    if (!data) return;
    const total = data.sending.length + data.totalQueued;
    setBadge("emails", { count: total, pulse: data.sending.length > 0 });
  }, [data, setBadge]);

  const sending = data?.sending ?? [];
  const recent = data?.recent ?? [];
  const scenarios = data?.scenarios ?? [];

  const title =
    sending.length > 0
      ? `${sending.length} envoi${sending.length > 1 ? "s" : ""} en cours`
      : (data?.totalQueued ?? 0) > 0
        ? `${data?.totalQueued} email${(data?.totalQueued ?? 0) > 1 ? "s" : ""} en attente`
        : "Rien à envoyer";

  return (
    <DrawerShell
      open={openWidget === "emails"}
      onClose={close}
      accent="fuchsia"
      eyebrow="Emails automatiques"
      title={
        <span className="flex items-center gap-1.5">
          {sending.length > 0 && (
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          )}
          {title}
        </span>
      }
      icon={EMAILS_ICON}
      footer={
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-slate-500">Rafraîchi automatiquement</span>
          <Link
            href="/admin/emails"
            className="text-fuchsia-600 hover:text-fuchsia-700 font-medium"
          >
            Configurer →
          </Link>
        </div>
      }
    >
      {data === null ? (
        <div className="p-6 text-center text-sm text-slate-500">Chargement…</div>
      ) : (
        <>
          {/* Section — En cours d'envoi */}
          <details open={sending.length > 0} className="border-b border-slate-100">
            <summary className="cursor-pointer px-4 py-2.5 text-xs uppercase tracking-[0.15em] font-semibold text-slate-500 flex items-center justify-between hover:bg-slate-50">
              <span>{"En cours d'envoi"}</span>
              <CountBadge value={sending.length} accent="emerald" />
            </summary>
            {sending.length === 0 ? (
              <div className="px-4 py-3 text-xs text-slate-400">
                Aucun envoi actif à la minute.
              </div>
            ) : (
              sending.map((s) => <SendRow key={s.id} send={s} tone="active" />)
            )}
          </details>

          {/* Section — En attente d'envoi */}
          <details open={(data?.totalQueued ?? 0) > 0} className="border-b border-slate-100">
            <summary className="cursor-pointer px-4 py-2.5 text-xs uppercase tracking-[0.15em] font-semibold text-slate-500 flex items-center justify-between hover:bg-slate-50">
              <span>{"En attente d'envoi"}</span>
              <CountBadge value={data?.totalQueued ?? 0} accent="fuchsia" />
            </summary>
            {data?.totalQueued === 0 ? (
              <div className="px-4 py-3 text-xs text-slate-400">
                Aucun email en attente.
              </div>
            ) : (
              <>
                {scenarios
                  .filter((s) => s.queued > 0)
                  .map((s) => (
                    <QueueRow
                      key={s.key}
                      scenario={s}
                      disabled={pending}
                      onDispatch={() => {
                        if (s.key !== "BACK_IN_STOCK") return;
                        startTransition(async () => {
                          const res = await dispatchBackInStockNow();
                          if (!res.success) {
                            toast.error(`Échec : ${res.error}`);
                          } else {
                            toast.success(
                              `${res.emailsSent ?? 0} email(s) envoyé(s) à ${res.clientsNotified ?? 0} client(s)`,
                            );
                            void load();
                          }
                        });
                      }}
                    />
                  ))}
                {/* Liste détaillée des produits remis en stock */}
                {(data?.backInStockPendingProducts?.length ?? 0) > 0 && (
                  <div className="px-4 py-3 bg-slate-50 border-t border-slate-100">
                    <div className="text-[10px] uppercase tracking-[0.15em] font-semibold text-slate-500 mb-2">
                      Produits remis en stock ({data?.backInStockPendingProducts.length})
                    </div>
                    <div className="space-y-2 max-h-72 overflow-y-auto">
                      {data?.backInStockPendingProducts.map((p) => (
                        <RestockProductRow key={p.productId} product={p} />
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </details>

          {/* Section — Feed récent */}
          <details open={sending.length === 0}>
            <summary className="cursor-pointer px-4 py-2.5 text-xs uppercase tracking-[0.15em] font-semibold text-slate-500 flex items-center justify-between hover:bg-slate-50">
              <span>15 derniers envois</span>
              <CountBadge value={recent.length} accent="slate" />
            </summary>
            {recent.length === 0 ? (
              <div className="px-4 py-3 text-xs text-slate-400">
                {"Aucun email envoyé pour l'instant."}
              </div>
            ) : (
              recent.map((s) => <SendRow key={s.id} send={s} tone="done" />)
            )}
          </details>
        </>
      )}
    </DrawerShell>
  );
}

// ────────────────────────────────────────────────────────
// Sous-composants
// ────────────────────────────────────────────────────────

function CountBadge({
  value,
  accent,
}: {
  value: number;
  accent: "emerald" | "fuchsia" | "slate";
}) {
  const map = {
    emerald: "bg-emerald-100 text-emerald-700",
    fuchsia: "bg-fuchsia-100 text-fuchsia-700",
    slate: "bg-slate-100 text-slate-600",
  } as const;
  return (
    <span
      className={`min-w-[22px] h-5 px-1.5 rounded-full text-[10px] font-bold flex items-center justify-center ${map[accent]}`}
    >
      {value}
    </span>
  );
}

function SendRow({ send, tone }: { send: LiveSend; tone: "active" | "done" }) {
  return (
    <div className="px-4 py-2.5 border-b border-slate-100 last:border-b-0">
      <div className="flex items-center justify-between gap-2 mb-1">
        <span
          className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${SCENARIO_COLOR[send.scenarioKey]}`}
        >
          {tone === "active" && (
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          )}
          {SCENARIO_LABEL[send.scenarioKey]}
        </span>
        <span className="text-[10px] text-slate-400 tabular-nums">
          {formatRelative(send.sentAt)}
        </span>
      </div>
      <p className="text-sm text-slate-800 truncate" title={send.recipientEmail}>
        {send.recipientEmail}
      </p>
      <p className="text-[11px] text-slate-500 truncate" title={send.subject}>
        {send.subject || "(sans objet)"}
      </p>
      {(send.openedAt || send.clickedAt) && (
        <div className="mt-1 flex gap-1.5">
          {send.openedAt && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 font-medium">
              Ouvert
            </span>
          )}
          {send.clickedAt && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-50 text-sky-700 font-medium">
              Cliqué
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function QueueRow({
  scenario,
  onDispatch,
  disabled,
}: {
  scenario: ScenarioSummary;
  onDispatch?: () => void;
  disabled?: boolean;
}) {
  const rationale: Record<ScenarioKey, string> = {
    ABANDONED_CART: "Paniers ayant dépassé le délai de relance",
    BACK_IN_STOCK:
      scenario.key === "BACK_IN_STOCK"
        ? `${scenario.queued} produit${scenario.queued > 1 ? "s" : ""} · ${scenario.eligibleClients ?? 0} client${(scenario.eligibleClients ?? 0) > 1 ? "s" : ""} concerné${(scenario.eligibleClients ?? 0) > 1 ? "s" : ""}`
        : "",
    WELCOME: "",
    NEWSLETTER: "",
  };
  return (
    <div className="px-4 py-3 border-b border-slate-100 last:border-b-0">
      <div className="flex items-center gap-3">
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${SCENARIO_COLOR[scenario.key]}`}
        >
          {SCENARIO_LABEL[scenario.key]}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-xs text-slate-500 truncate">{rationale[scenario.key]}</p>
        </div>
        <span className="text-sm font-semibold text-slate-800 tabular-nums">
          {scenario.queued}
        </span>
      </div>
      {scenario.actionable && scenario.queued > 0 && onDispatch && (
        <div className="mt-2 flex justify-end">
          <button
            type="button"
            onClick={onDispatch}
            disabled={disabled}
            className="text-xs font-medium px-3 py-1.5 rounded-lg bg-fuchsia-600 hover:bg-fuchsia-700 text-white disabled:opacity-50"
          >
            {disabled ? "Envoi en cours…" : "Envoyer maintenant"}
          </button>
        </div>
      )}
    </div>
  );
}

function RestockProductRow({ product }: { product: PendingRestockProduct }) {
  return (
    <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-lg p-2">
      <div className="w-10 h-10 rounded bg-slate-100 overflow-hidden flex items-center justify-center shrink-0">
        {product.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={product.imageUrl} alt="" className="w-full h-full object-cover" />
        ) : (
          <span className="text-slate-400 text-sm">◆</span>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-slate-800 truncate" title={product.productName}>
          {product.productName}
        </p>
        <p className="text-[10px] text-slate-500 truncate">
          {product.reference}
          {product.colors.length > 0 && ` · ${product.colors.join(", ")}`}
          {" · "}
          {product.favoritedBy} favori{product.favoritedBy > 1 ? "s" : ""}
        </p>
      </div>
      <div className="text-[11px] font-semibold text-slate-700 tabular-nums shrink-0">
        {product.priceLabel}
      </div>
    </div>
  );
}

function formatRelative(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diffSec = Math.floor((now - then) / 1000);
  if (diffSec < 5) return "à l'instant";
  if (diffSec < 60) return `il y a ${diffSec} s`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `il y a ${diffMin} min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `il y a ${diffH} h`;
  const diffD = Math.floor(diffH / 24);
  return `il y a ${diffD} j`;
}
