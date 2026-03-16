import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = { title: "Commandes — Admin" };

const STATUS_LABELS: Record<string, { label: string; badge: string }> = {
  PENDING:    { label: "En attente",      badge: "badge-warning" },
  PROCESSING: { label: "En préparation",  badge: "badge-info" },
  SHIPPED:    { label: "Expédiée",        badge: "badge-success" },
  DELIVERED:  { label: "Livrée",          badge: "badge-success" },
  CANCELLED:  { label: "Annulée",         badge: "badge-error" },
};

export default async function AdminCommandesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string }>;
}) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") redirect("/connexion");

  const { status, q } = await searchParams;

  const orders = await prisma.order.findMany({
    where: {
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
    },
    orderBy: { createdAt: "desc" },
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
  });

  const counts = await prisma.order.groupBy({
    by: ["status"],
    _count: true,
  });
  const countMap = Object.fromEntries(counts.map((c) => [c.status, c._count]));
  const total = orders.length;

  return (
    <div className="space-y-6">
      {/* En-tête */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">
            Commandes
          </h1>
          <p className="page-subtitle font-[family-name:var(--font-roboto)]">
            {total} commande{total !== 1 ? "s" : ""}
          </p>
        </div>
      </div>

      {/* Filtres rapides statuts */}
      <div className="flex flex-wrap gap-2">
        <FilterChip href="/admin/commandes" label="Toutes" active={!status} count={Object.values(countMap).reduce((a, b) => a + b, 0)} />
        {Object.entries(STATUS_LABELS).map(([key, cfg]) => (
          <FilterChip
            key={key}
            href={`/admin/commandes?status=${key}`}
            label={cfg.label}
            active={status === key}
            count={countMap[key] ?? 0}
          />
        ))}
      </div>

      {/* Recherche */}
      <form className="flex gap-2 max-w-sm">
        <input
          name="q"
          defaultValue={q}
          placeholder="Société, email, n° commande…"
          className="field-input flex-1"
        />
        <button type="submit"
          className="btn-primary whitespace-nowrap">
          Chercher
        </button>
      </form>

      {/* Tableau */}
      {orders.length === 0 ? (
        <div className="card p-10 text-center text-text-muted font-[family-name:var(--font-roboto)] text-sm">
          Aucune commande trouvée.
        </div>
      ) : (
        <div className="card overflow-hidden w-full">
          {/* En-tête tableau — desktop */}
          <div className="hidden lg:grid grid-cols-[minmax(160px,2fr)_minmax(140px,2fr)_minmax(100px,1fr)_minmax(100px,1fr)_minmax(120px,1.5fr)_80px] gap-4 px-6 py-3 border-b border-border table-header">
            {["N° Commande", "Client", "Montant TTC", "Statut", "Transporteur", ""].map((h) => (
              <span key={h} className="text-xs font-[family-name:var(--font-roboto)] font-semibold text-text-secondary uppercase tracking-wider">
                {h}
              </span>
            ))}
          </div>

          {orders.map((order) => {
            const st = STATUS_LABELS[order.status] ?? STATUS_LABELS.PENDING;
            return (
              <Link
                key={order.id}
                href={`/admin/commandes/${order.id}`}
                className="grid grid-cols-1 lg:grid-cols-[minmax(160px,2fr)_minmax(140px,2fr)_minmax(100px,1fr)_minmax(100px,1fr)_minmax(120px,1.5fr)_80px] gap-3 lg:gap-4 px-6 py-4 border-b border-border last:border-b-0 items-center hover:bg-bg-secondary transition-colors"
              >
                {/* N° + date */}
                <div className="min-w-0">
                  <p className="font-[family-name:var(--font-roboto)] font-semibold text-text-primary text-sm">
                    {order.orderNumber}
                  </p>
                  <p className="text-xs text-text-muted font-[family-name:var(--font-roboto)] mt-0.5">
                    {new Date(order.createdAt).toLocaleDateString("fr-FR", {
                      day: "2-digit", month: "short", year: "numeric",
                    })}
                    {" · "}{order._count.items} article{order._count.items > 1 ? "s" : ""}
                  </p>
                </div>

                {/* Client */}
                <div className="min-w-0">
                  <p className="text-sm font-medium text-text-primary font-[family-name:var(--font-roboto)] truncate">
                    {order.clientCompany}
                  </p>
                  <p className="text-xs text-text-muted font-[family-name:var(--font-roboto)] truncate">
                    {order.clientEmail}
                  </p>
                </div>

                {/* Montant */}
                <p className="text-sm font-[family-name:var(--font-poppins)] font-semibold text-text-primary">
                  {order.totalTTC.toFixed(2)} €
                </p>

                {/* Statut */}
                <div>
                  <span className={`${st.badge} w-fit`}>
                    {st.label}
                  </span>
                </div>

                {/* Transporteur */}
                <div className="min-w-0">
                  <p className="text-xs text-text-secondary font-[family-name:var(--font-roboto)] truncate">
                    {order.carrierName}
                  </p>
                  {order.eeTrackingId && (
                    <p className="text-xs font-mono text-text-muted mt-0.5 truncate">
                      {order.eeTrackingId}
                    </p>
                  )}
                </div>

                {/* Actions */}
                <span className="text-xs font-[family-name:var(--font-roboto)] font-medium text-text-secondary hover:text-text-primary transition-colors whitespace-nowrap text-right">
                  Voir →
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function FilterChip({
  href, label, active, count,
}: {
  href: string; label: string; active: boolean; count: number;
}) {
  return (
    <Link
      href={href}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-[family-name:var(--font-roboto)] font-medium border rounded-lg transition-colors ${
        active
          ? "bg-bg-dark text-text-inverse border-bg-dark"
          : "bg-bg-primary text-text-secondary border-border hover:border-border-dark hover:text-text-primary"
      }`}
    >
      {label}
      <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold ${
        active ? "bg-white/20 text-text-inverse" : "bg-bg-tertiary text-text-secondary"
      }`}>
        {count}
      </span>
    </Link>
  );
}
