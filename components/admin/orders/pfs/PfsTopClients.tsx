"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { PfsStatsBundle } from "@/app/actions/admin/pfs-orders";
import { countryFlagUrl, isKnownCountry } from "@/lib/countries";
import TopPager from "./TopPager";

interface Props {
  stats: PfsStatsBundle | null;
  onOpenOrder?: (id: string) => void;
}

const SORT_OVERLAY_MS = 250;
const PER_PAGE = 10;

function initials(s: string) {
  const parts = s.trim().split(/\s+/);
  return (parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "");
}

function formatEur(n: number) {
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(Math.round(n)) + " €";
}

/**
 * Retourne l'URL PNG du drapeau via le helper commun (flagcdn.com) si le code
 * ISO est reconnu, sinon null. Les emojis flag ne sont pas rendus sur Windows
 * Chromium desktop — on passe donc par un vrai raster.
 */
function flagUrl(iso: string | null): string | null {
  if (!iso) return null;
  if (!isKnownCountry(iso)) return null;
  return countryFlagUrl(iso, 20);
}

function formatLastOrder(iso: string | null, nowMs: number): string {
  if (!iso) return "—";
  const ts = new Date(iso).getTime();
  const days = Math.floor((nowMs - ts) / 86_400_000);
  if (days <= 0) return "aujourd'hui";
  if (days === 1) return "hier";
  if (days < 30) return `il y a ${days} j`;
  if (days < 365) return `il y a ${Math.round(days / 30)} mois`;
  return `il y a ${Math.round(days / 365)} an${Math.round(days / 365) > 1 ? "s" : ""}`;
}

export default function PfsTopClients({ stats }: Props) {
  const [uiSort, setUiSort] = useState<"totalHT" | "ordersCount">("totalHT");
  const [sort, setSort] = useState<"totalHT" | "ordersCount">("totalHT");
  const [switching, setSwitching] = useState(false);
  const [page, setPage] = useState(1);
  const [nowMs, setNowMs] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafRef = useRef<number | null>(null);

  const allRows = useMemo(() => {
    if (!stats) return [];
    return [...stats.topClients].sort((a, b) =>
      sort === "totalHT" ? b.totalHT - a.totalHT : b.ordersCount - a.ordersCount,
    );
  }, [stats, sort]);

  const totalPages = Math.max(1, Math.ceil(allRows.length / PER_PAGE));
  const safePage = Math.min(page, totalPages);
  const startOffset = (safePage - 1) * PER_PAGE;
  const rows = allRows.slice(startOffset, startOffset + PER_PAGE);

  // Reset à la page 1 quand tri/période change.
  useEffect(() => {
    setPage(1);
  }, [sort, stats]);

  // Init côté client uniquement (évite hydration mismatch).
  useEffect(() => {
    setNowMs(Date.now());
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const changeSort = (next: "totalHT" | "ordersCount") => {
    if (next === uiSort) return;
    setUiSort(next);
    setSwitching(true);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      setSort(next);
    });
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setSwitching(false), SORT_OVERLAY_MS);
  };

  return (
    <div className="relative rounded-2xl bg-bg-primary border border-border shadow-sm p-5 flex flex-col h-full">
      <div className="flex items-center gap-2 mb-4">
        <div className="text-xs uppercase tracking-[0.2em] text-text-muted font-medium">Top clients</div>
        <div className="ml-auto flex gap-1">
          <button
            type="button"
            onClick={() => changeSort("totalHT")}
            className={`text-xs rounded-full px-2.5 py-1 ${
              uiSort === "totalHT" ? "bg-slate-900 text-white" : "bg-bg-secondary text-text-secondary"
            }`}
          >
            CA ↓
          </button>
          <button
            type="button"
            onClick={() => changeSort("ordersCount")}
            className={`text-xs rounded-full px-2.5 py-1 ${
              uiSort === "ordersCount" ? "bg-slate-900 text-white" : "bg-bg-secondary text-text-secondary"
            }`}
          >
            Commandes ↓
          </button>
        </div>
      </div>
      {rows.length === 0 && (
        <p className="text-sm text-text-muted py-6 text-center">Aucun client sur la période sélectionnée.</p>
      )}
      <ul className="divide-y divide-border flex-1 flex flex-col">
        {rows.map((c, i) => {
          const rank = startOffset + i + 1;
          const avgBasket = c.ordersCount > 0 ? c.totalHT / c.ordersCount : 0;
          const flag = flagUrl(c.customerCountry);
          const inner = (
            <>
              <span className="w-8 shrink-0 text-center font-heading font-bold text-sm text-text-muted tabular-nums self-start pt-1">
                #{rank}
              </span>
              <span className="w-11 h-11 rounded-md bg-bg-secondary text-text-primary border border-border flex items-center justify-center font-heading font-bold text-sm uppercase shrink-0 self-start">
                {initials(c.customerShop || c.customerName)}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 min-w-0">
                  {flag && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={flag}
                      alt={c.customerCountry ?? ""}
                      width={20}
                      height={15}
                      className="rounded-sm border border-border shrink-0"
                      loading="lazy"
                    />
                  )}
                  <div className="font-semibold text-text-primary truncate">
                    {c.customerShop || c.customerName}
                  </div>
                </div>
                {c.customerShop && c.customerName !== c.customerShop && (
                  <div className="text-[11.5px] text-text-muted truncate mt-0.5">
                    Contact : <span className="text-text-secondary">{c.customerName}</span>
                  </div>
                )}
                <div className="mt-1.5 text-[11.5px] text-text-muted truncate">
                  <span className="font-medium text-text-primary tabular-nums">
                    {c.ordersCount}
                  </span>{" "}
                  commande{c.ordersCount > 1 ? "s" : ""}
                  <span className="mx-1.5 opacity-40">·</span>
                  Date dernière commande :{" "}
                  <span
                    className="text-text-secondary"
                    title={c.lastOrderAt ? new Date(c.lastOrderAt).toLocaleString("fr-FR") : undefined}
                  >
                    {formatLastOrder(c.lastOrderAt, nowMs)}
                  </span>
                </div>
                {c.customerPhone && (
                  <div className="mt-0.5 text-[11.5px] text-text-muted truncate inline-flex items-center gap-1">
                    <svg
                      className="w-3 h-3 shrink-0"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"
                      />
                    </svg>
                    <span className="tabular-nums text-text-secondary">{c.customerPhone}</span>
                  </div>
                )}
              </div>
              <div className="text-right shrink-0 self-start pt-0.5 flex flex-col gap-1">
                <div>
                  <div className="font-heading font-semibold text-text-primary tabular-nums leading-tight">
                    {formatEur(c.totalHT)}
                  </div>
                  <div className="text-[10.5px] text-text-muted uppercase tracking-wider">CA HT</div>
                </div>
                <div className="mt-1 rounded-md bg-bg-secondary border border-border px-2 py-1">
                  <div className="text-[10.5px] text-text-muted uppercase tracking-wider">Panier moy.</div>
                  <div className="text-[12.5px] font-semibold text-text-primary tabular-nums leading-tight">
                    {formatEur(avgBasket)}
                  </div>
                </div>
              </div>
            </>
          );
          return (
            <li key={c.pfsCustomerId} className="flex-1 flex">
              {c.adminClientCardId ? (
                <Link
                  href={`/admin/clients?tab=fiches&card=${c.adminClientCardId}`}
                  className="flex items-center gap-3 py-3.5 -mx-2 px-2 hover:bg-bg-secondary rounded-lg w-full h-full"
                >
                  {inner}
                </Link>
              ) : (
                <div className="flex items-center gap-3 py-3.5 -mx-2 px-2 w-full h-full">{inner}</div>
              )}
            </li>
          );
        })}
      </ul>
      {allRows.length > 0 && (
        <TopPager
          page={safePage}
          totalPages={totalPages}
          startIndex={startOffset + 1}
          endIndex={Math.min(safePage * PER_PAGE, allRows.length)}
          total={allRows.length}
          onChange={setPage}
        />
      )}
      {switching && (
        <div
          className="absolute inset-0 rounded-2xl bg-slate-900/10 backdrop-blur-[1px] flex items-center justify-center pointer-events-none z-10"
          aria-hidden
        >
          <div className="rounded-full bg-slate-900/80 text-white text-xs font-medium px-3 py-1.5 flex items-center gap-2 shadow-lg">
            <span className="inline-block w-3 h-3 rounded-full border-2 border-white border-t-transparent animate-spin" />
            Chargement…
          </div>
        </div>
      )}
    </div>
  );
}
