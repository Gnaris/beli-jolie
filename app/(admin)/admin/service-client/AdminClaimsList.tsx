"use client";

import { useState, useTransition, useMemo } from "react";
import Link from "next/link";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { getAdminClaims, deleteClaim } from "@/app/actions/admin/claims";

type Claim = Awaited<ReturnType<typeof getAdminClaims>>["rows"][number];

type FilterKey = "all" | "OPEN" | "CLOSED";
type TypeKey = "all" | "ORDER_RELATED" | "OTHER";

const FILTERS: { key: FilterKey; label: string; dotClass?: string }[] = [
  { key: "all", label: "Toutes" },
  { key: "OPEN", label: "Ouvertes", dotClass: "bg-zinc-800" },
  { key: "CLOSED", label: "Fermées", dotClass: "bg-zinc-300" },
];

const TYPE_FILTERS: { key: TypeKey; label: string }[] = [
  { key: "all", label: "Tous types" },
  { key: "ORDER_RELATED", label: "Commande" },
  { key: "OTHER", label: "Autre" },
];

function getAvatarInitial(claim: Claim): string {
  const src = claim.user.company?.trim() || `${claim.user.firstName ?? ""} ${claim.user.lastName ?? ""}`.trim() || claim.user.email;
  return (src || "?").charAt(0).toUpperCase();
}

function formatRelative(date: Date | string): string {
  const d = new Date(date);
  const diffMs = Date.now() - d.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "à l'instant";
  if (diffMin < 60) return `il y a ${diffMin} min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `il y a ${diffH} h`;
  const diffD = Math.floor(diffH / 24);
  if (diffD === 1) return "hier";
  if (diffD < 7) return `il y a ${diffD} j`;
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short" });
}

function formatDateShort(date: Date | string): string {
  return new Date(date).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" });
}

function truncate(s: string | undefined, n: number): string {
  if (!s) return "";
  if (s.length <= n) return s;
  return s.slice(0, n).trimEnd() + "…";
}

export default function AdminClaimsList({
  initialClaims,
  initialPage,
  initialTotalPages,
  initialFilteredTotal,
  pageSize,
  totalAll,
  countMap,
}: {
  initialClaims: Claim[];
  initialPage: number;
  initialTotalPages: number;
  initialFilteredTotal: number;
  pageSize: number;
  totalAll: number;
  countMap: Record<string, number>;
}) {
  const [claims, setClaims] = useState(initialClaims);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [typeFilter, setTypeFilter] = useState<TypeKey>("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(initialPage);
  const [totalPages, setTotalPages] = useState(initialTotalPages);
  const [filteredTotal, setFilteredTotal] = useState(initialFilteredTotal);
  const [isPending, startTransition] = useTransition();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const toast = useToast();
  const { confirm } = useConfirm();

  async function handleDelete(claim: Claim, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const ok = await confirm({
      type: "danger",
      title: "Supprimer définitivement la conversation ?",
      message: `Réf. ${claim.reference} — cette action est irréversible. Tous les messages et les pièces jointes (fichiers inclus) seront effacés.`,
      confirmLabel: "Supprimer",
    });
    if (!ok) return;

    setDeletingId(claim.id);
    try {
      const res = await deleteClaim(claim.id);
      if (!res.success) {
        toast.error("Suppression impossible", res.error);
        return;
      }
      toast.success("Conversation supprimée");
      // Recharge la page courante
      loadPage(filter, typeFilter, page);
    } finally {
      setDeletingId(null);
    }
  }

  function loadPage(f: FilterKey, t: TypeKey, p: number) {
    startTransition(async () => {
      const data = await getAdminClaims(
        f === "all" ? undefined : f,
        p,
        t === "all" ? undefined : t,
      );
      setClaims(data.rows);
      setPage(data.page);
      setTotalPages(data.totalPages);
      setFilteredTotal(data.filteredTotal);
    });
  }

  function handleFilter(f: FilterKey) {
    setFilter(f);
    setPage(1);
    loadPage(f, typeFilter, 1);
  }

  function handleTypeFilter(t: TypeKey) {
    setTypeFilter(t);
    setPage(1);
    loadPage(filter, t, 1);
  }

  function goToPage(p: number) {
    if (p < 1 || p > totalPages || p === page) return;
    loadPage(filter, typeFilter, p);
  }

  const filtered = useMemo(() => {
    if (!search.trim()) return claims;
    const s = search.trim().toLowerCase();
    return claims.filter((c) => {
      const fields = [
        c.reference,
        c.subject,
        c.user.firstName,
        c.user.lastName,
        c.user.company,
        c.user.email,
      ]
        .filter(Boolean)
        .map((v) => String(v).toLowerCase());
      return fields.some((v) => v.includes(s));
    });
  }, [claims, search]);

  const countFor = (key: FilterKey): number => {
    if (key === "all") return totalAll;
    return countMap[key] ?? 0;
  };

  const isEmpty = !isPending && filtered.length === 0;

  return (
    <div className="space-y-5 md:space-y-6">
      {/* ── FILTRES + RECHERCHE ── */}
      <section className="relative rounded-2xl bg-bg-primary border border-border overflow-hidden">
        <div className="p-4 sm:p-5 md:p-6 space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <span className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-text-primary">
              <span
                className="w-[3px] h-[14px] rounded-[3px]"
                style={{ background: "linear-gradient(180deg, #52525B, #18181B)" }}
              />
              Filtrer les conversations
            </span>
            {(filter !== "all" || typeFilter !== "all" || search) && (
              <button
                type="button"
                onClick={() => {
                  setSearch("");
                  setTypeFilter("all");
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
                  count={countFor(f.key)}
                  dotClass={f.dotClass}
                  onClick={() => handleFilter(f.key)}
                />
              ))}
              <span className="w-px h-6 bg-border mx-1 hidden md:block" />
              {TYPE_FILTERS.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => handleTypeFilter(t.key)}
                  className={`shrink-0 inline-flex items-center gap-2 px-3 py-1.5 rounded-xl text-sm font-medium border transition-all ${
                    typeFilter === t.key
                      ? "bg-text-primary text-text-inverse border-text-primary shadow-sm"
                      : "bg-white text-text-secondary border-border hover:border-border-dark hover:text-text-primary"
                  }`}
                >
                  {t.label}
                </button>
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
                placeholder="Client, société, sujet, référence…"
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
      ) : isEmpty ? (
        <EmptyState hasSearch={!!search} filter={filter} />
      ) : (
        <section className="relative rounded-2xl bg-bg-primary border border-border overflow-hidden">
          <div
            className="absolute inset-x-0 top-0 h-[3px]"
            style={{ background: "linear-gradient(90deg, #52525B, #18181B)" }}
          />

          <div className="px-4 sm:px-5 md:px-6 pt-6 pb-4 flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3">
              <span className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-text-primary">
                <span
                  className="w-[3px] h-[14px] rounded-[3px]"
                  style={{ background: "linear-gradient(180deg, #52525B, #18181B)" }}
                />
                Conversations
              </span>
              <span className="text-sm text-text-muted">
                {search
                  ? `${filtered.length} résultat${filtered.length > 1 ? "s" : ""} (page filtrée localement)`
                  : filteredTotal <= pageSize
                  ? `${filteredTotal} au total`
                  : `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, filteredTotal)} sur ${filteredTotal}`}
              </span>
            </div>
          </div>

          {/* Header desktop */}
          <div
            className="hidden lg:grid px-6 py-3 bg-bg-secondary border-y border-border"
            style={{
              gridTemplateColumns: "40px minmax(280px,2.2fr) minmax(200px,1.6fr) 140px 130px 60px",
              gap: "0.75rem",
              alignItems: "center",
            }}
          >
            <div />
            <ColHeader>Client · Sujet</ColHeader>
            <ColHeader>Dernier message</ColHeader>
            <ColHeader>Statut</ColHeader>
            <ColHeader className="text-right">Ouverte le</ColHeader>
            <div />
          </div>

          <div className="divide-y divide-border">
            {filtered.map((claim) => {
              const isOpen = claim.status === "OPEN";
              const isFaded = !isOpen;
              const lastMsg = claim.lastMessage;
              const lastMsgAuthor = lastMsg?.senderRole === "ADMIN" ? "Vous" : (claim.user.firstName ?? "Client");
              const lastMsgText = lastMsg?.content
                ? lastMsg.content.startsWith("__system__:")
                  ? "(message système)"
                  : truncate(lastMsg.content, 60)
                : claim.subject;

              const avatarBg = isOpen ? "bg-zinc-800" : "bg-zinc-400";

              const canDelete = claim.status === "CLOSED";
              const isDeleting = deletingId === claim.id;

              return (
                <Link
                  key={claim.id}
                  href={`/admin/service-client/${claim.id}`}
                  className={`block group hover:bg-zinc-50 transition-colors relative ${isFaded ? "opacity-75" : ""} ${isDeleting ? "opacity-40 pointer-events-none" : ""}`}
                >
                  {claim.hasUnreadFromClient && (
                    <span className="absolute left-0 top-0 bottom-0 w-1 bg-red-500" />
                  )}

                  {/* MOBILE : carte empilée */}
                  <div className="lg:hidden p-4 flex flex-col gap-3">
                    <div className="flex items-start gap-3">
                      <div className={`w-10 h-10 rounded-full ${avatarBg} text-white font-bold flex items-center justify-center text-sm shrink-0`}>
                        {getAvatarInitial(claim)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-2 flex-wrap">
                          <span className="font-semibold text-[14px] truncate">
                            {claim.user.company || `${claim.user.firstName ?? ""} ${claim.user.lastName ?? ""}`.trim()}
                          </span>
                          {claim.hasUnreadFromClient && <UnreadBadge />}
                        </div>
                        <p className="text-[13px] mt-0.5 truncate text-text-secondary">{claim.subject}</p>
                        <TypeLine claim={claim} />
                      </div>
                      <StatusBadge status={claim.status} />
                    </div>
                    {lastMsg && (
                      <p className="text-[12.5px] text-text-secondary line-clamp-2 pl-13">
                        <span className="text-text-muted">{lastMsgAuthor} · </span>« {lastMsgText} »
                      </p>
                    )}
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[11px] text-text-muted flex items-center gap-2">
                        <span>Réf. {claim.reference}</span>
                        <span>·</span>
                        <span>{formatDateShort(claim.createdAt)}</span>
                      </p>
                      {canDelete && (
                        <button
                          type="button"
                          onClick={(e) => handleDelete(claim, e)}
                          disabled={isDeleting}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-red-200 bg-white text-red-700 text-[11px] font-semibold hover:bg-red-50 disabled:opacity-50"
                          title="Supprimer définitivement"
                        >
                          <TrashIcon />
                          Supprimer
                        </button>
                      )}
                    </div>
                  </div>

                  {/* DESKTOP : grille */}
                  <div
                    className="hidden lg:grid px-6 py-4"
                    style={{
                      gridTemplateColumns: "40px minmax(280px,2.2fr) minmax(200px,1.6fr) 140px 130px 60px",
                      gap: "0.75rem",
                      alignItems: "center",
                    }}
                  >
                    <div className={`w-10 h-10 rounded-full ${avatarBg} text-white font-bold flex items-center justify-center text-sm`}>
                      {getAvatarInitial(claim)}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <span className="font-semibold text-[14px] truncate">
                          {claim.user.company || `${claim.user.firstName ?? ""} ${claim.user.lastName ?? ""}`.trim()}
                        </span>
                        {claim.user.company && (claim.user.firstName || claim.user.lastName) && (
                          <span className="text-xs text-text-muted truncate">
                            · {claim.user.firstName} {claim.user.lastName}
                          </span>
                        )}
                        {claim.hasUnreadFromClient && <UnreadBadge />}
                      </div>
                      <p className="text-[13px] mt-0.5 truncate text-text-secondary">{claim.subject}</p>
                      <TypeLine claim={claim} />
                    </div>
                    <div className="min-w-0">
                      {lastMsg ? (
                        <>
                          <p className="text-[13px] font-medium truncate">
                            <span className="text-text-muted font-normal">{lastMsgAuthor} · </span>« {lastMsgText} »
                          </p>
                          <p className="text-[11px] mt-0.5 text-text-muted">{formatRelative(lastMsg.createdAt)}</p>
                        </>
                      ) : (
                        <p className="text-[12px] text-text-muted italic">Aucun message</p>
                      )}
                    </div>
                    <div>
                      <StatusBadge status={claim.status} />
                    </div>
                    <div className="text-right">
                      <span className="text-xs text-text-muted whitespace-nowrap">{formatDateShort(claim.createdAt)}</span>
                    </div>
                    <div className="flex justify-end items-center gap-1">
                      {canDelete && (
                        <button
                          type="button"
                          onClick={(e) => handleDelete(claim, e)}
                          disabled={isDeleting}
                          className="w-8 h-8 rounded-lg flex items-center justify-center text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
                          title="Supprimer définitivement"
                        >
                          <TrashIcon />
                        </button>
                      )}
                      <span className="w-8 h-8 rounded-lg flex items-center justify-center text-text-muted group-hover:text-text-primary transition-colors">
                        <ChevronIcon />
                      </span>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>

          {/* Pagination — cachée si recherche active (filtrage local) ou une seule page */}
          {!search && totalPages > 1 && (
            <div className="px-4 sm:px-5 md:px-6 py-4 border-t border-border flex items-center justify-between gap-3 flex-wrap bg-bg-secondary">
              <span className="text-xs text-text-muted">
                Page {page} sur {totalPages}
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => goToPage(page - 1)}
                  disabled={page <= 1 || isPending}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-border bg-white text-sm font-medium hover:bg-zinc-50 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" />
                  </svg>
                  Précédent
                </button>
                <button
                  type="button"
                  onClick={() => goToPage(page + 1)}
                  disabled={page >= totalPages || isPending}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-border bg-white text-sm font-medium hover:bg-zinc-50 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Suivant
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </div>
            </div>
          )}
        </section>
      )}
    </div>
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
          active ? "bg-white/20 text-text-inverse" : "bg-zinc-100 text-zinc-700"
        }`}
      >
        {count}
      </span>
    </button>
  );
}

function TypeLine({ claim }: { claim: Claim }) {
  const isOrder = claim.type === "ORDER_RELATED";
  return (
    <div className="mt-1 flex items-center gap-2 flex-wrap">
      <span
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider ${
          isOrder ? "bg-violet-50 text-violet-700 border border-violet-200" : "bg-slate-50 text-slate-600 border border-slate-200"
        }`}
      >
        {isOrder ? "Commande" : "Autre"}
      </span>
      {isOrder && claim.order && (
        <span className="text-[11px] text-text-muted font-mono">
          {claim.order.orderNumber}
        </span>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: "OPEN" | "CLOSED" }) {
  if (status === "OPEN") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-zinc-100 text-zinc-800 text-xs font-semibold border border-zinc-200">
        <span className="w-1.5 h-1.5 rounded-full bg-zinc-800" />
        Ouverte
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-zinc-50 text-zinc-500 text-xs font-semibold border border-zinc-200">
      <span className="w-1.5 h-1.5 rounded-full bg-zinc-400" />
      Fermée
    </span>
  );
}

function UnreadBadge() {
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-red-50 text-red-700 text-[10px] font-bold border border-red-200">
      <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
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

function TrashIcon() {
  return (
    <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8"
        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
  );
}

function EmptyState({ hasSearch, filter }: { hasSearch: boolean; filter: FilterKey }) {
  const filterLabel = FILTERS.find((f) => f.key === filter)?.label ?? "";
  return (
    <section className="rounded-2xl bg-bg-primary border border-border p-10 md:p-14 text-center">
      <div className="mx-auto w-20 h-20 rounded-full bg-zinc-100 flex items-center justify-center mb-5">
        <svg className="w-10 h-10 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.4"
            d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.87 9.87 0 01-4-.8L3 20l1.3-3.9A7.97 7.97 0 013 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
          />
        </svg>
      </div>
      <h2 className="font-heading text-xl font-bold text-text-primary">Aucune conversation</h2>
      <p className="text-sm text-text-secondary mt-2 max-w-md mx-auto">
        {hasSearch
          ? "Essayez d'élargir votre recherche."
          : filter === "all"
          ? "Tout est en règle — aucune demande client à traiter."
          : `Aucune conversation « ${filterLabel} » pour l'instant.`}
      </p>
    </section>
  );
}
