"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { getAdminClaims } from "@/app/actions/admin/claims";

type Claim = Awaited<ReturnType<typeof getAdminClaims>>[number];

const STATUS_BADGES: Record<string, { className: string; label: string }> = {
  OPEN: { className: "badge badge-info", label: "Ouverte" },
  IN_REVIEW: { className: "badge badge-warning", label: "En examen" },
  ACCEPTED: { className: "badge badge-success", label: "Acceptée" },
  REJECTED: { className: "badge badge-error", label: "Refusée" },
  RETURN_PENDING: { className: "badge badge-warning", label: "Retour attendu" },
  RETURN_SHIPPED: { className: "badge badge-info", label: "Retour expédié" },
  RETURN_RECEIVED: { className: "badge badge-success", label: "Colis reçu" },
  RESOLUTION_PENDING: { className: "badge badge-warning", label: "Résolution" },
  RESOLVED: { className: "badge badge-success", label: "Résolue" },
  CLOSED: { className: "badge badge-neutral", label: "Fermée" },
};

type FilterConfig = { key: string; label: string; dot?: string; statuses: string[] };

const FILTERS: FilterConfig[] = [
  { key: "all", label: "Toutes", statuses: [] },
  { key: "OPEN", label: "Ouvertes", dot: "bg-sky-500", statuses: ["OPEN"] },
  { key: "IN_REVIEW", label: "En examen", dot: "bg-amber-500", statuses: ["IN_REVIEW"] },
  { key: "RETURN_PENDING", label: "Retour attendu", dot: "bg-amber-500", statuses: ["RETURN_PENDING", "RETURN_SHIPPED", "RETURN_RECEIVED"] },
  { key: "RESOLUTION_PENDING", label: "À rembourser/renvoyer", dot: "bg-amber-500", statuses: ["RESOLUTION_PENDING"] },
  { key: "RESOLVED", label: "Résolues", dot: "bg-emerald-500", statuses: ["RESOLVED"] },
  { key: "CLOSED", label: "Fermées", dot: "bg-zinc-400", statuses: ["CLOSED"] },
];

function subtitleFor(claim: Claim): string {
  if (claim.type === "GENERAL") return "Question générale";
  const parts: string[] = [];
  if (claim._count.items > 0) {
    parts.push(`${claim._count.items} pièce${claim._count.items > 1 ? "s" : ""}`);
  }
  if (claim.creditAmount) {
    parts.push(`avoir ${claim.creditAmount.toFixed(0)} €`);
  } else if (claim.refundAmount) {
    parts.push(`remb. ${claim.refundAmount.toFixed(0)} €`);
  }
  return parts.length ? parts.join(" · ") : "Réclamation";
}

function formatDate(d: Date | string) {
  return new Date(d).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export default function AdminClaimsList({
  initialClaims,
  totalAll,
  countMap,
}: {
  initialClaims: Claim[];
  totalAll: number;
  countMap: Record<string, number>;
}) {
  const [claims, setClaims] = useState(initialClaims);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [isPending, startTransition] = useTransition();

  function handleFilter(f: string) {
    setFilter(f);
    startTransition(async () => {
      const data = await getAdminClaims(f);
      setClaims(data);
    });
  }

  const filtered = search
    ? claims.filter((c) => {
        const s = search.toLowerCase();
        return (
          c.reference.toLowerCase().includes(s) ||
          c.user.firstName.toLowerCase().includes(s) ||
          c.user.lastName.toLowerCase().includes(s) ||
          (c.user.company || "").toLowerCase().includes(s) ||
          (c.order?.orderNumber || "").toLowerCase().includes(s)
        );
      })
    : claims;

  const countFor = (f: FilterConfig) =>
    f.statuses.length === 0
      ? totalAll
      : f.statuses.reduce((sum, s) => sum + (countMap[s] ?? 0), 0);

  return (
    <div className="space-y-5 md:space-y-6">
      {/* ── FILTRES + RECHERCHE ── */}
      <section className="relative rounded-2xl bg-bg-primary border border-border overflow-hidden">
        <div className="p-4 sm:p-5 md:p-6 space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <SectionEyebrow>Filtrer les demandes</SectionEyebrow>
            {(filter !== "all" || search) && (
              <button
                type="button"
                onClick={() => {
                  setSearch("");
                  handleFilter("all");
                }}
                className="text-xs font-medium text-text-muted hover:text-text-primary transition-colors"
              >
                Réinitialiser
              </button>
            )}
          </div>

          <div className="flex flex-col-reverse md:flex-row md:items-center gap-3">
            <div className="flex items-center gap-2 overflow-x-auto no-scrollbar -mx-1 px-1 pb-1 md:pb-0 md:overflow-visible md:flex-wrap">
              {FILTERS.map((f) => (
                <FilterChip
                  key={f.key}
                  label={f.label}
                  active={filter === f.key}
                  count={countFor(f)}
                  dotClass={f.dot}
                  onClick={() => handleFilter(f.key)}
                />
              ))}
            </div>

            <div className="relative w-full md:w-72 md:ml-auto">
              <svg
                className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
                fill="none" stroke="currentColor" viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
              </svg>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Client, société, référence…"
                className="w-full pl-10 pr-3 py-2.5 rounded-xl border border-border bg-white text-sm focus:outline-none focus:border-text-primary focus:ring-4 focus:ring-black/5 transition-all"
              />
            </div>
          </div>
        </div>
      </section>

      {/* ── LISTE ── */}
      {isPending ? (
        <div className="rounded-2xl bg-bg-primary border border-border p-10 text-center text-sm text-text-muted font-body">
          Chargement…
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState hasSearch={!!search} filter={filter} />
      ) : (
        <section className="relative rounded-2xl bg-bg-primary border border-border overflow-hidden">
          <div
            className="absolute inset-x-0 top-0 h-[3px]"
            style={{ background: "linear-gradient(90deg, #52525B, #18181B)" }}
          />

          <div className="px-4 sm:px-5 md:px-6 pt-6 pb-4 flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3">
              <SectionEyebrow>Liste des demandes</SectionEyebrow>
              <span className="text-sm text-text-muted">
                {filtered.length} résultat{filtered.length > 1 ? "s" : ""}
              </span>
            </div>
          </div>

          <div
            className="hidden lg:grid px-6 py-3 bg-bg-secondary border-y border-border"
            style={{
              gridTemplateColumns: "minmax(190px,1.6fr) minmax(220px,2fr) 130px 150px 130px 60px",
              gap: "0.75rem",
              alignItems: "center",
            }}
          >
            <ColHeader>Référence</ColHeader>
            <ColHeader>Client</ColHeader>
            <ColHeader>Commande</ColHeader>
            <ColHeader>Statut</ColHeader>
            <ColHeader className="text-right">Date</ColHeader>
            <ColHeader className="text-right">Voir</ColHeader>
          </div>

          <div className="divide-y divide-border">
            {filtered.map((claim) => {
              const badge = STATUS_BADGES[claim.status] || { className: "badge badge-neutral", label: claim.status };
              const isTerminal = claim.status === "REJECTED" || claim.status === "CLOSED" || claim.status === "RESOLVED";
              const dimClass = claim.status === "RESOLVED" ? "opacity-90" : claim.status === "CLOSED" || claim.status === "REJECTED" ? "opacity-80" : "";
              const subtitle = subtitleFor(claim);
              const clientName = claim.user.company || `${claim.user.firstName} ${claim.user.lastName}`.trim();
              const clientSecondary = claim.user.company
                ? `${claim.user.firstName} ${claim.user.lastName}`.trim()
                : "";

              return (
                <Link
                  key={claim.id}
                  href={`/admin/reclamations/${claim.id}`}
                  className={`block group hover:bg-bg-secondary transition-colors ${dimClass}`}
                >
                  {/* MOBILE : carte empilée */}
                  <div className="lg:hidden p-4 flex flex-col gap-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`font-mono font-bold text-sm text-text-primary ${isTerminal && claim.status !== "RESOLVED" ? "line-through decoration-zinc-400" : ""}`}>
                            {claim.reference}
                          </span>
                          {claim.hasUnreadFromClient && <UnreadPill />}
                        </div>
                        <p className="text-[11.5px] text-text-muted mt-1">{subtitle}</p>
                      </div>
                      <span className={`${badge.className} shrink-0`}>{badge.label}</span>
                    </div>
                    <div className="flex items-end justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-text-primary truncate">{clientName}</p>
                        {clientSecondary && (
                          <p className="text-[11.5px] text-text-muted truncate">{clientSecondary}</p>
                        )}
                        <p className="text-[11px] text-text-muted mt-1">
                          {claim.order ? <><span className="font-mono">#{claim.order.orderNumber}</span> · </> : null}
                          {formatDate(claim.createdAt)}
                        </p>
                      </div>
                      <ChevronIcon />
                    </div>
                  </div>

                  {/* DESKTOP : grille */}
                  <div
                    className="hidden lg:grid px-6 py-4"
                    style={{
                      gridTemplateColumns: "minmax(190px,1.6fr) minmax(220px,2fr) 130px 150px 130px 60px",
                      gap: "0.75rem",
                      alignItems: "center",
                    }}
                  >
                    <div className="min-w-0">
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <span className={`font-mono font-bold text-sm text-text-primary ${isTerminal && claim.status !== "RESOLVED" ? "line-through decoration-zinc-400" : ""}`}>
                          {claim.reference}
                        </span>
                        {claim.hasUnreadFromClient && <UnreadPill />}
                      </div>
                      <p className="text-[11.5px] text-text-muted mt-0.5">{subtitle}</p>
                    </div>
                    <div className="min-w-0">
                      <p className="text-[13.5px] font-semibold text-text-primary truncate">{clientName}</p>
                      {clientSecondary && (
                        <p className="text-[11.5px] text-text-muted truncate">{clientSecondary}</p>
                      )}
                    </div>
                    <div>
                      {claim.order ? (
                        <span className="font-mono text-xs text-text-secondary">#{claim.order.orderNumber}</span>
                      ) : (
                        <span className="text-xs text-text-muted">—</span>
                      )}
                    </div>
                    <div>
                      <span className={badge.className}>{badge.label}</span>
                    </div>
                    <div className="text-right">
                      <span className="text-xs text-text-muted whitespace-nowrap">{formatDate(claim.createdAt)}</span>
                    </div>
                    <div className="flex justify-end">
                      <span className="w-8 h-8 rounded-lg flex items-center justify-center text-text-muted group-hover:text-text-primary transition-colors">
                        <ChevronIcon />
                      </span>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

function SectionEyebrow({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-text-primary">
      <span
        className="w-[3px] h-[14px] rounded-[3px]"
        style={{ background: "linear-gradient(180deg, #52525B, #18181B)" }}
      />
      {children}
    </span>
  );
}

function ColHeader({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`text-[11px] font-bold uppercase tracking-[0.12em] text-text-muted ${className}`}>
      {children}
    </div>
  );
}

function FilterChip({
  label, active, count, dotClass, onClick,
}: {
  label: string; active: boolean; count: number; dotClass?: string; onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`shrink-0 inline-flex items-center gap-2 px-3 py-1.5 rounded-xl text-sm font-medium border transition-all ${
        active
          ? "bg-text-primary text-text-inverse border-text-primary shadow-sm"
          : "bg-white text-text-secondary border-border hover:border-border-dark hover:text-text-primary"
      }`}
    >
      {dotClass && !active && <span className={`w-2 h-2 rounded-full ${dotClass}`} />}
      {label}
      <span
        className={`inline-flex items-center justify-center min-w-[22px] h-5 px-1.5 rounded-full text-[11px] font-bold ${
          active ? "bg-white/20 text-text-inverse" : "bg-bg-secondary text-text-secondary"
        }`}
      >
        {count}
      </span>
    </button>
  );
}

function UnreadPill() {
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-sky-100 text-sky-700 text-[10px] font-bold">
      <span className="w-1.5 h-1.5 rounded-full bg-sky-500 animate-pulse" />
      Nouveau msg
    </span>
  );
}

function ChevronIcon() {
  return (
    <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
    </svg>
  );
}

function EmptyState({ hasSearch, filter }: { hasSearch: boolean; filter: string }) {
  const filterLabel = FILTERS.find((f) => f.key === filter)?.label ?? "";
  return (
    <section className="rounded-2xl bg-bg-primary border border-border p-10 md:p-14 text-center">
      <div className="mx-auto w-20 h-20 rounded-full bg-bg-secondary flex items-center justify-center mb-5">
        <svg className="w-10 h-10 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.4"
            d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.87 9.87 0 01-4-.8L3 20l1.3-3.9A7.97 7.97 0 013 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
          />
        </svg>
      </div>
      <h2 className="font-heading text-xl font-bold text-text-primary">Aucune demande</h2>
      <p className="text-sm text-text-secondary mt-2 max-w-md mx-auto">
        {hasSearch
          ? "Essayez d'élargir votre recherche."
          : filter === "all"
          ? "Tout est en règle — aucune réclamation à traiter pour l'instant."
          : `Aucune demande dans « ${filterLabel} » pour l'instant.`}
      </p>
    </section>
  );
}
