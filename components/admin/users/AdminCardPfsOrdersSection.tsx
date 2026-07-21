"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  listPfsOrdersForClientCard,
  type PfsOrderListItem,
} from "@/app/actions/admin/pfs-orders";

const STATUS_LABEL: Record<PfsOrderListItem["status"], { label: string; cls: string }> = {
  NEW: { label: "Nouveau", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  VALIDATED: { label: "Validé", cls: "bg-slate-100 text-slate-700 border-slate-200" },
  SENT: { label: "Envoyé", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  CANCELLED: { label: "Annulé", cls: "bg-rose-50 text-rose-700 border-rose-200" },
};

interface Props {
  cardId: string;
  hasPfs: boolean;
}

const PER_PAGE = 5;

export default function AdminCardPfsOrdersSection({ cardId, hasPfs }: Props) {
  const [orders, setOrders] = useState<PfsOrderListItem[] | null>(null);
  const [page, setPage] = useState(1);

  useEffect(() => {
    if (!hasPfs) return;
    let cancelled = false;
    void (async () => {
      try {
        const rows = await listPfsOrdersForClientCard(cardId);
        if (!cancelled) {
          setOrders(rows);
          setPage(1);
        }
      } catch {
        if (!cancelled) setOrders([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cardId, hasPfs]);

  if (!hasPfs) return null;

  const totalHT = orders?.reduce((s, o) => s + o.totalHT, 0) ?? 0;
  const avg = orders && orders.length > 0 ? orders.reduce((s, o) => s + o.totalTTC, 0) / orders.length : 0;
  const lastDate = orders && orders.length > 0 ? new Date(orders[0].createdAtPfs) : null;

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <span
          className="w-6 h-6 rounded-md text-white font-heading font-bold text-xs flex items-center justify-center"
          style={{ background: "linear-gradient(135deg,#4f46e5,#6366f1)" }}
        >
          P
        </span>
        <h3 className="text-[11px] font-bold uppercase tracking-[0.18em] text-text-muted">
          Commandes Paris Fashion Shop
        </h3>
      </div>

      {orders === null && <p className="text-xs text-text-muted">Chargement…</p>}
      {orders && orders.length === 0 && (
        <p className="text-xs text-text-muted">Aucune commande PFS liée à ce client.</p>
      )}

      {orders && orders.length > 0 && (
        <>
          <div className="grid grid-cols-3 gap-2">
            <MiniStat label="Commandes" value={String(orders.length)} />
            <MiniStat
              label="CA HT"
              value={`${Math.round(totalHT).toLocaleString("fr-FR")} €`}
            />
            <MiniStat
              label="Panier moyen"
              value={`${Math.round(avg).toLocaleString("fr-FR")} €`}
              hint="TTC"
            />
          </div>

          {lastDate && (
            <div className="text-[11px] text-text-muted">
              Dernière commande : {lastDate.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" })}
            </div>
          )}

          {(() => {
            const totalPages = Math.max(1, Math.ceil(orders.length / PER_PAGE));
            const currentPage = Math.min(page, totalPages);
            const start = (currentPage - 1) * PER_PAGE;
            const pageRows = orders.slice(start, start + PER_PAGE);
            return (
              <>
                <ul className="divide-y divide-border rounded-xl border border-border overflow-hidden">
                  {pageRows.map((o) => {
                    const meta = STATUS_LABEL[o.status];
                    return (
                      <li key={o.id} className="flex items-center gap-3 px-3 py-2 hover:bg-bg-secondary">
                        <Link
                          href={`/admin/commandes?source=pfs&open=${o.id}`}
                          className="font-mono text-xs text-text-primary font-semibold hover:underline"
                        >
                          {o.orderNumber}
                        </Link>
                        <span className="text-[11px] text-text-muted">
                          {new Date(o.createdAtPfs).toLocaleDateString("fr-FR", {
                            day: "2-digit",
                            month: "2-digit",
                            year: "2-digit",
                          })}
                        </span>
                        <span className="ml-auto text-xs font-semibold text-text-primary">
                          {o.totalTTC.toFixed(2).replace(".", ",")} €
                        </span>
                        <span
                          className={`inline-block rounded-full text-[10px] px-2 py-0.5 font-medium border ${meta.cls}`}
                        >
                          {meta.label}
                        </span>
                      </li>
                    );
                  })}
                </ul>
                {totalPages > 1 && (
                  <div className="flex items-center justify-between gap-2 pt-1">
                    <span className="text-[11px] text-text-muted">
                      Page {currentPage} sur {totalPages} — {orders.length} commande{orders.length > 1 ? "s" : ""}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                        disabled={currentPage <= 1}
                        className="inline-flex items-center gap-1 rounded-lg border border-border bg-bg-primary px-2.5 py-1 text-[12px] text-text-secondary hover:bg-bg-secondary disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        Précédent
                      </button>
                      <button
                        type="button"
                        onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                        disabled={currentPage >= totalPages}
                        className="inline-flex items-center gap-1 rounded-lg border border-border bg-bg-primary px-2.5 py-1 text-[12px] text-text-secondary hover:bg-bg-secondary disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        Suivant
                      </button>
                    </div>
                  </div>
                )}
              </>
            );
          })()}
        </>
      )}
    </section>
  );
}

function MiniStat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl bg-bg-secondary border border-border p-3">
      <div className="text-[10px] uppercase tracking-wider text-text-muted">{label}</div>
      <div className="font-heading text-lg font-bold text-text-primary tabular-nums">{value}</div>
      {hint && <div className="text-[10px] text-text-muted">{hint}</div>}
    </div>
  );
}
