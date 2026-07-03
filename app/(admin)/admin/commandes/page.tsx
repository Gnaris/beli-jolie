import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import ExportOrdersButton from "@/components/admin/orders/ExportOrdersButton";

export const metadata: Metadata = { title: "Commandes — Admin" };

const STATUS_LABELS: Record<string, { label: string; badge: string; dot: string }> = {
  PENDING:   { label: "Nouveau",  badge: "badge badge-warning", dot: "bg-amber-500" },
  SHIPPED:   { label: "Expédiée", badge: "badge badge-success", dot: "bg-emerald-500" },
  CANCELLED: { label: "Annulée",  badge: "badge badge-error",   dot: "bg-red-500" },
};

const PER_PAGE = 30;

export default async function AdminCommandesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; page?: string }>;
}) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") redirect("/connexion");

  const { status, q, page: pageParam = "1" } = await searchParams;
  const currentPage = Math.max(1, parseInt(pageParam));

  const where = {
    ...(status ? { status: status as never } : {}),
    ...(q
      ? {
          OR: [
            { orderNumber: { contains: q } },
            { clientCompany: { contains: q } },
            { clientEmail: { contains: q } },
          ],
        }
      : {}),
  };

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfPrevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);

  const [orders, total, counts, pendingOldest, shippedThisMonth, shippedPrevMonth, monthAggregate] = await Promise.all([
    prisma.order.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (currentPage - 1) * PER_PAGE,
      take: PER_PAGE,
      select: {
        id:            true,
        orderNumber:   true,
        status:        true,
        clientCompany: true,
        clientEmail:   true,
        totalTTC:      true,
        carrierName:   true,
        eeTrackingId:  true,
        createdAt:     true,
        _count: { select: { items: true } },
      },
    }),
    prisma.order.count({ where }),
    prisma.order.groupBy({
      by: ["status"],
      _count: true,
    }),
    prisma.order.findFirst({
      where: { status: "PENDING" },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    }),
    prisma.order.count({
      where: { status: "SHIPPED", createdAt: { gte: startOfMonth } },
    }),
    prisma.order.count({
      where: { status: "SHIPPED", createdAt: { gte: startOfPrevMonth, lt: startOfMonth } },
    }),
    prisma.order.aggregate({
      where: { status: "SHIPPED", createdAt: { gte: startOfMonth } },
      _sum: { totalTTC: true },
      _count: { _all: true },
    }),
  ]);

  const monthItemsAggregate = await prisma.orderItem.aggregate({
    where: { order: { status: "SHIPPED", createdAt: { gte: startOfMonth } } },
    _sum: { quantity: true },
  });

  const countMap = Object.fromEntries(counts.map((c) => [c.status, c._count]));
  const totalAllStatuses = Object.values(countMap).reduce((a, b) => a + b, 0);
  const totalPages = Math.ceil(total / PER_PAGE);

  const monthRevenue = Number(monthAggregate._sum.totalTTC ?? 0);
  const monthCount = monthAggregate._count._all;
  const avgBasket = monthCount > 0 ? monthRevenue / monthCount : 0;
  const growth =
    shippedPrevMonth > 0
      ? ((shippedThisMonth - shippedPrevMonth) / shippedPrevMonth) * 100
      : null;

  const pendingSince = pendingOldest
    ? Math.max(0, Math.floor((now.getTime() - pendingOldest.createdAt.getTime()) / 86_400_000))
    : null;

  const monthItems = Number(monthItemsAggregate._sum.quantity ?? 0);

  const nfShort = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });

  const isFilterActive = Boolean(status || q);
  const hasNoOrdersAtAll = totalAllStatuses === 0;

  return (
    <div className="space-y-6">
      {/* ── HERO ── */}
      <section
        className="relative rounded-3xl border border-border p-6 md:p-8 overflow-hidden"
        style={{
          background: `
            radial-gradient(60% 80% at 12% 10%, rgba(24,24,27,0.06), transparent 60%),
            radial-gradient(50% 70% at 92% 20%, rgba(63,63,70,0.05), transparent 60%),
            radial-gradient(70% 90% at 60% 100%, rgba(24,24,27,0.04), transparent 60%),
            linear-gradient(180deg, #F5F3EE 0%, var(--color-bg-primary) 60%, var(--color-bg-primary) 100%)
          `,
        }}
      >
        <div
          className="absolute -top-16 -right-10 w-56 h-56 rounded-full pointer-events-none"
          style={{ background: "rgba(24,24,27,0.08)", filter: "blur(48px)" }}
        />
        <div
          className="absolute -bottom-20 -left-10 w-56 h-56 rounded-full pointer-events-none"
          style={{ background: "rgba(63,63,70,0.06)", filter: "blur(48px)" }}
        />

        <div className="relative flex items-start justify-between gap-6 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs font-medium text-text-muted mb-3">
              <span>Admin</span>
              <span className="opacity-40">/</span>
              <span className="text-text-secondary">Commandes</span>
            </div>
            <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/70 backdrop-blur border border-border text-[11px] font-bold uppercase tracking-[0.18em] text-text-primary">
              <span
                className="w-1.5 h-1.5 rounded-full bg-text-primary"
                style={{ boxShadow: "0 0 0 3px rgba(24,24,27,0.14)" }}
              />
              Ventes · Commandes
            </span>
            <h1 className="font-heading text-3xl md:text-4xl font-bold tracking-tight mt-3">
              Commandes
            </h1>
            <p className="text-[15px] text-text-secondary mt-1.5 max-w-xl">
              Suivez les commandes reçues, préparez les expéditions et exportez pour la comptabilité.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <ExportOrdersButton status={status} q={q} />
          </div>
        </div>
      </section>

      {/* ── KPI TILES ── */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiTile
          icon={
            <path
              strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7"
              d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
            />
          }
          label="À expédier"
          value={countMap.PENDING ?? 0}
          hint={
            (countMap.PENDING ?? 0) === 0
              ? "Aucune commande en attente"
              : pendingSince !== null
              ? pendingSince === 0
                ? "La plus ancienne : aujourd'hui"
                : `La plus ancienne : il y a ${pendingSince} jour${pendingSince > 1 ? "s" : ""}`
              : ""
          }
          suffix="nouvelles"
        />
        <KpiTile
          icon={<path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" d="M5 13l4 4L19 7" />}
          label="Expédiées ce mois"
          value={shippedThisMonth}
          hint={
            growth === null
              ? "Premier mois d'activité"
              : growth === 0
              ? "Stable / mois précédent"
              : `${growth > 0 ? "↗" : "↘"} ${Math.abs(growth).toFixed(0)} % vs mois précédent`
          }
        />
        <KpiTile
          icon={
            <path
              strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7"
              d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1"
            />
          }
          label="CA du mois"
          value={nfShort.format(Math.round(monthRevenue))}
          suffix="€"
          hint={
            monthCount === 0
              ? "Aucune commande expédiée"
              : `Panier moyen ${nfShort.format(Math.round(avgBasket))} €`
          }
        />
        <KpiTile
          icon={<path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />}
          label="Articles vendus"
          value={nfShort.format(monthItems)}
          suffix="pièces"
          hint={monthCount === 0 ? "" : `Sur ${monthCount} commande${monthCount > 1 ? "s" : ""}`}
        />
      </section>

      {/* ── FILTRES + RECHERCHE ── */}
      <section className="relative rounded-2xl bg-bg-primary border border-border overflow-hidden">
        <div className="p-5 md:p-6 space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <SectionEyebrow>Filtrer les commandes</SectionEyebrow>
            {isFilterActive && (
              <Link
                href="/admin/commandes"
                className="text-xs font-medium text-text-muted hover:text-text-primary transition-colors"
              >
                Réinitialiser
              </Link>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <FilterChip href="/admin/commandes" label="Toutes" active={!status} count={totalAllStatuses} />
            {Object.entries(STATUS_LABELS).map(([key, cfg]) => (
              <FilterChip
                key={key}
                href={`/admin/commandes?status=${key}`}
                label={cfg.label}
                active={status === key}
                count={countMap[key] ?? 0}
                dotClass={cfg.dot}
              />
            ))}
            <form className="ml-auto relative w-full sm:w-72">
              <svg
                className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
                fill="none" stroke="currentColor" viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
              </svg>
              <input
                name="q"
                defaultValue={q}
                placeholder="Société, email, n° commande…"
                className="w-full pl-10 pr-3 py-2.5 rounded-xl border border-border bg-white text-sm focus:outline-none focus:border-text-primary focus:ring-4 focus:ring-black/5 transition-all"
              />
              {status && <input type="hidden" name="status" value={status} />}
            </form>
          </div>
        </div>
      </section>

      {/* ── LISTE COMMANDES ── */}
      {orders.length === 0 ? (
        hasNoOrdersAtAll ? (
          <EmptyState />
        ) : (
          <FilteredEmptyState q={q} status={status ? STATUS_LABELS[status]?.label : undefined} />
        )
      ) : (
        <section className="relative rounded-2xl bg-bg-primary border border-border overflow-hidden">
          <div
            className="absolute inset-x-0 top-0 h-[3px]"
            style={{ background: "linear-gradient(90deg, #52525B, #18181B)" }}
          />

          <div className="px-5 md:px-6 pt-6 pb-4 flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3">
              <SectionEyebrow>Liste des commandes</SectionEyebrow>
              <span className="text-sm text-text-muted">
                {total} résultat{total > 1 ? "s" : ""}
              </span>
            </div>
          </div>

          {/* Entête colonnes desktop */}
          <div
            className="hidden lg:grid px-6 py-3 bg-bg-secondary border-y border-border"
            style={{
              gridTemplateColumns: "minmax(180px,1.8fr) minmax(200px,2fr) 130px 130px minmax(160px,1.5fr) 80px",
              gap: "0.75rem",
            }}
          >
            <ColHeader>N° Commande</ColHeader>
            <ColHeader>Client</ColHeader>
            <ColHeader className="text-right">Montant TTC</ColHeader>
            <ColHeader>Statut</ColHeader>
            <ColHeader>Transporteur</ColHeader>
            <ColHeader className="text-right">Voir</ColHeader>
          </div>

          <div className="divide-y divide-border">
            {orders.map((order) => {
              const st = STATUS_LABELS[order.status] ?? STATUS_LABELS.PENDING;
              const isCancelled = order.status === "CANCELLED";
              return (
                <Link
                  key={order.id}
                  href={`/admin/commandes/${order.id}`}
                  className={`grid grid-cols-1 lg:grid px-4 md:px-6 py-4 items-center hover:bg-bg-secondary transition-colors ${
                    isCancelled ? "opacity-70" : ""
                  }`}
                  style={{
                    gridTemplateColumns: "minmax(180px,1.8fr) minmax(200px,2fr) 130px 130px minmax(160px,1.5fr) 80px",
                    gap: "0.75rem",
                  }}
                >
                  <div className="min-w-0">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className={`font-mono font-bold text-sm text-text-primary ${isCancelled ? "line-through decoration-zinc-400" : ""}`}>
                        {order.orderNumber}
                      </span>
                      <span className={`lg:hidden ${st.badge} text-[10px]`}>{st.label}</span>
                    </div>
                    <p className="text-[11.5px] text-text-muted mt-0.5">
                      {new Date(order.createdAt).toLocaleDateString("fr-FR", {
                        day: "2-digit", month: "short", year: "numeric",
                      })}
                      {" · "}{order._count.items} article{order._count.items > 1 ? "s" : ""}
                    </p>
                  </div>

                  <div className="min-w-0 mt-2 lg:mt-0">
                    <p className="text-[13.5px] font-semibold text-text-primary truncate">
                      {order.clientCompany}
                    </p>
                    <p className="text-[11.5px] text-text-muted truncate">
                      {order.clientEmail}
                    </p>
                  </div>

                  <div className="mt-2 lg:mt-0 lg:text-right">
                    <span className={`text-sm font-bold tabular-nums ${isCancelled ? "text-text-muted" : "text-text-primary"}`}>
                      {Number(order.totalTTC).toFixed(2).replace(".", ",")}&nbsp;€
                    </span>
                  </div>

                  <div className="mt-2 lg:mt-0 hidden lg:block">
                    <span className={st.badge}>{st.label}</span>
                  </div>

                  <div className="min-w-0 mt-2 lg:mt-0">
                    <p className="text-xs text-text-secondary truncate">
                      {order.carrierName || "—"}
                    </p>
                    {order.eeTrackingId && (
                      <p className="text-[11px] font-mono text-text-muted mt-0.5 truncate">
                        {order.eeTrackingId}
                      </p>
                    )}
                  </div>

                  <div className="hidden lg:flex justify-end">
                    <span className="w-8 h-8 rounded-lg flex items-center justify-center text-text-muted group-hover:text-text-primary transition-colors">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
                      </svg>
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="px-6 py-4 border-t border-border flex items-center justify-between gap-3 flex-wrap">
              <p className="text-xs text-text-muted">
                <span className="font-semibold text-text-secondary">
                  {(currentPage - 1) * PER_PAGE + 1}–{Math.min(currentPage * PER_PAGE, total)}
                </span>{" "}
                sur <span className="font-semibold text-text-secondary">{total}</span>
                {totalPages > 1 && (
                  <>
                    {" · "}Page {currentPage} / {totalPages}
                  </>
                )}
              </p>
              <Pagination
                currentPage={currentPage}
                totalPages={totalPages}
                status={status}
                q={q}
              />
            </div>
          )}
        </section>
      )}
    </div>
  );
}

/* ─── Sub-composants ─────────────────────── */

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

function KpiTile({
  icon, label, value, suffix, hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  suffix?: string;
  hint?: string;
}) {
  return (
    <div
      className="relative rounded-2xl border border-border p-5 overflow-hidden"
      style={{
        background: "linear-gradient(140deg, #F5F3EE 0%, var(--color-bg-primary) 55%, var(--color-bg-primary) 100%)",
      }}
    >
      <div
        className="absolute inset-x-0 top-0 h-[3px]"
        style={{ background: "linear-gradient(90deg, #52525B, #18181B)" }}
      />
      <div
        className="absolute -top-8 -right-8 w-24 h-24 rounded-full pointer-events-none"
        style={{ background: "rgba(24,24,27,0.06)", filter: "blur(48px)" }}
      />
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-zinc-100 ring-1 ring-zinc-200 flex items-center justify-center text-zinc-800">
          <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            {icon}
          </svg>
        </div>
        <span className="text-[11px] font-bold tracking-[0.14em] uppercase text-zinc-700">
          {label}
        </span>
      </div>
      <div className="mt-4 flex items-baseline gap-2">
        <span className="text-3xl font-bold text-zinc-900 tabular-nums">{value}</span>
        {suffix && <span className="text-xs text-text-muted">{suffix}</span>}
      </div>
      {hint && <p className="text-[11.5px] text-text-muted mt-1">{hint}</p>}
    </div>
  );
}

function FilterChip({
  href, label, active, count, dotClass,
}: {
  href: string; label: string; active: boolean; count: number; dotClass?: string;
}) {
  return (
    <Link
      href={href}
      className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-xl text-sm font-medium border transition-all ${
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
    </Link>
  );
}

function Pagination({
  currentPage, totalPages, status, q,
}: {
  currentPage: number; totalPages: number; status?: string; q?: string;
}) {
  const makeHref = (page: number) =>
    `/admin/commandes?${new URLSearchParams({
      ...(status ? { status } : {}),
      ...(q ? { q } : {}),
      page: String(page),
    }).toString()}`;

  const pageBtn = "min-w-[36px] h-9 px-3 rounded-lg border border-border bg-white text-sm font-semibold text-text-secondary inline-flex items-center justify-center transition-all hover:border-border-dark hover:text-text-primary";
  const activeBtn = "min-w-[36px] h-9 px-3 rounded-lg border border-text-primary bg-text-primary text-text-inverse text-sm font-semibold inline-flex items-center justify-center";

  const pages: (number | "...")[] = [];
  if (totalPages <= 5) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
  } else {
    pages.push(1, 2);
    if (currentPage > 3) pages.push("...");
    if (currentPage > 2 && currentPage < totalPages - 1) pages.push(currentPage);
    if (currentPage < totalPages - 2) pages.push("...");
    pages.push(totalPages);
  }

  return (
    <div className="flex items-center gap-1.5">
      {currentPage > 1 ? (
        <Link href={makeHref(currentPage - 1)} className={pageBtn}>
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
      ) : (
        <span className={`${pageBtn} opacity-40 pointer-events-none`}>
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" />
          </svg>
        </span>
      )}

      {pages.map((p, i) =>
        p === "..." ? (
          <span key={`ell-${i}`} className="text-text-muted px-1">…</span>
        ) : p === currentPage ? (
          <span key={p} className={activeBtn}>{p}</span>
        ) : (
          <Link key={p} href={makeHref(p)} className={pageBtn}>{p}</Link>
        )
      )}

      {currentPage < totalPages ? (
        <Link href={makeHref(currentPage + 1)} className={pageBtn}>
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
          </svg>
        </Link>
      ) : (
        <span className={`${pageBtn} opacity-40 pointer-events-none`}>
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
          </svg>
        </span>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <section
      className="p-8 md:p-14 text-center rounded-3xl"
      style={{
        background: "linear-gradient(180deg, rgba(24,24,27,0.03), transparent 60%)",
        border: "2px dashed var(--color-border-dark)",
      }}
    >
      <div className="mx-auto w-24 h-24 rounded-full bg-white ring-1 ring-border flex items-center justify-center mb-6 shadow-sm">
        <svg className="w-12 h-12 text-zinc-800" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.4"
            d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
          />
        </svg>
      </div>
      <h2 className="font-heading text-2xl font-bold text-text-primary">
        Aucune commande pour l'instant
      </h2>
      <p className="text-sm text-text-secondary mt-2 max-w-md mx-auto">
        Dès qu'un client validera son panier, sa commande apparaîtra ici. Vous pourrez la préparer,
        ajouter un numéro de suivi, puis la marquer comme expédiée.
      </p>
      <div className="mt-10 grid sm:grid-cols-3 gap-4 max-w-3xl mx-auto text-left">
        {[
          { n: 1, title: "Publiez vos produits", body: "Vérifiez que vos fiches sont en ligne et complètes." },
          { n: 2, title: "Validez vos clients", body: "Approuvez les demandes d'inscription pour qu'ils voient les prix." },
          { n: 3, title: "Attendez vos ventes", body: "Vos commandes s'afficheront ici automatiquement." },
        ].map((step) => (
          <div key={step.n} className="bg-white/70 border border-border rounded-xl p-4">
            <div className="w-8 h-8 rounded-lg bg-zinc-900 text-white flex items-center justify-center mb-2 font-bold text-sm">
              {step.n}
            </div>
            <p className="text-sm font-semibold">{step.title}</p>
            <p className="text-xs text-text-muted mt-1">{step.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function FilteredEmptyState({ q, status }: { q?: string; status?: string }) {
  return (
    <section className="rounded-2xl bg-bg-primary border border-border p-10 md:p-14 text-center">
      <div className="mx-auto w-20 h-20 rounded-full bg-bg-secondary flex items-center justify-center mb-5">
        <svg className="w-10 h-10 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.4"
            d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607zM9 9l6 6m0-6l-6 6"
          />
        </svg>
      </div>
      <h2 className="font-heading text-xl font-bold text-text-primary">
        Aucune commande ne correspond
      </h2>
      <p className="text-sm text-text-secondary mt-2 max-w-md mx-auto">
        {status && q ? (
          <>
            Aucune commande <strong>« {status} »</strong> avec le mot-clé{" "}
            <span className="font-mono bg-bg-secondary px-1.5 py-0.5 rounded">{q}</span>.
          </>
        ) : q ? (
          <>
            Aucune commande avec le mot-clé{" "}
            <span className="font-mono bg-bg-secondary px-1.5 py-0.5 rounded">{q}</span>.
          </>
        ) : status ? (
          <>Aucune commande au statut <strong>« {status} »</strong>.</>
        ) : (
          <>Essayez d'élargir la recherche.</>
        )}
      </p>
      <div className="mt-5 flex items-center justify-center gap-2 flex-wrap">
        <Link href="/admin/commandes" className="btn-primary">
          Voir toutes les commandes
        </Link>
      </div>
    </section>
  );
}
