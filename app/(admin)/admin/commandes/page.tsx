import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = { title: "Commandes — Admin" };

const STATUS_LABELS: Record<string, { label: string; bg: string; text: string }> = {
  PENDING:    { label: "En attente",    bg: "bg-amber-50",    text: "text-amber-700" },
  PROCESSING: { label: "En préparation", bg: "bg-blue-50",     text: "text-blue-700" },
  SHIPPED:    { label: "Expédiée",      bg: "bg-[#EEF5F1]",  text: "text-[#5E8470]" },
  DELIVERED:  { label: "Livrée",        bg: "bg-[#EEF5F1]",  text: "text-[#5E8470]" },
  CANCELLED:  { label: "Annulée",       bg: "bg-red-50",      text: "text-red-700" },
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
          <h1 className="font-[family-name:var(--font-poppins)] text-2xl font-semibold text-[#0F172A]">
            Commandes
          </h1>
          <p className="text-sm text-[#475569] font-[family-name:var(--font-roboto)] mt-0.5">
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
          className="flex-1 border border-[#E2E8F0] px-3 py-2 text-sm font-[family-name:var(--font-roboto)] focus:outline-none focus:border-[#0F3460] rounded"
        />
        <button type="submit"
          className="px-4 py-2 bg-[#0F3460] text-white text-sm rounded hover:bg-[#0A2540] transition-colors font-[family-name:var(--font-roboto)]">
          Chercher
        </button>
      </form>

      {/* Tableau */}
      {orders.length === 0 ? (
        <div className="bg-white border border-[#E2E8F0] p-10 text-center text-[#475569] font-[family-name:var(--font-roboto)] text-sm">
          Aucune commande trouvée.
        </div>
      ) : (
        <div className="bg-white border border-[#E2E8F0] overflow-hidden">
          {/* En-tête tableau — desktop */}
          <div className="hidden lg:grid grid-cols-[1.5fr_1fr_1fr_1fr_1fr_auto] gap-4 px-5 py-3 border-b border-[#E2E8F0] bg-[#F1F5F9]">
            {["N° Commande", "Client", "Montant TTC", "Statut", "Transporteur", "Actions"].map((h) => (
              <span key={h} className="text-xs font-[family-name:var(--font-roboto)] font-semibold text-[#475569] uppercase tracking-wider">
                {h}
              </span>
            ))}
          </div>

          {orders.map((order) => {
            const st = STATUS_LABELS[order.status] ?? STATUS_LABELS.PENDING;
            return (
              <div
                key={order.id}
                className="grid grid-cols-1 lg:grid-cols-[1.5fr_1fr_1fr_1fr_1fr_auto] gap-3 lg:gap-4 px-5 py-4 border-b border-[#F1F5F9] last:border-0 items-center"
              >
                {/* N° + date */}
                <div>
                  <p className="font-[family-name:var(--font-roboto)] font-semibold text-[#0F172A] text-sm">
                    {order.orderNumber}
                  </p>
                  <p className="text-xs text-[#475569] font-[family-name:var(--font-roboto)] mt-0.5">
                    {new Date(order.createdAt).toLocaleDateString("fr-FR", {
                      day: "2-digit", month: "short", year: "numeric",
                    })}
                    {" · "}{order._count.items} article{order._count.items > 1 ? "s" : ""}
                  </p>
                </div>

                {/* Client */}
                <div>
                  <p className="text-sm font-medium text-[#0F172A] font-[family-name:var(--font-roboto)]">
                    {order.clientCompany}
                  </p>
                  <p className="text-xs text-[#475569] font-[family-name:var(--font-roboto)] truncate">
                    {order.clientEmail}
                  </p>
                </div>

                {/* Montant */}
                <p className="text-sm font-[family-name:var(--font-poppins)] font-semibold text-[#0F172A]">
                  {order.totalTTC.toFixed(2)} €
                </p>

                {/* Statut */}
                <span className={`inline-flex items-center text-xs font-medium px-2.5 py-1 rounded-full font-[family-name:var(--font-roboto)] ${st.bg} ${st.text} w-fit`}>
                  {st.label}
                </span>

                {/* Transporteur */}
                <div>
                  <p className="text-xs text-[#475569] font-[family-name:var(--font-roboto)]">
                    {order.carrierName}
                  </p>
                  {order.eeTrackingId && (
                    <p className="text-xs font-mono text-[#0F3460] mt-0.5">
                      {order.eeTrackingId}
                    </p>
                  )}
                </div>

                {/* Actions */}
                <Link
                  href={`/admin/commandes/${order.id}`}
                  className="text-xs font-[family-name:var(--font-roboto)] font-medium text-[#0F3460] border border-[#0F3460] px-3 py-1.5 hover:bg-[#0F3460] hover:text-white transition-colors whitespace-nowrap"
                >
                  Voir →
                </Link>
              </div>
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
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-[family-name:var(--font-roboto)] font-medium border transition-colors ${
        active
          ? "bg-[#0F3460] text-white border-[#0F3460]"
          : "bg-white text-[#475569] border-[#E2E8F0] hover:border-[#0F3460] hover:text-[#0F3460]"
      }`}
    >
      {label}
      <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold ${
        active ? "bg-white/20 text-white" : "bg-[#F1F5F9] text-[#475569]"
      }`}>
        {count}
      </span>
    </Link>
  );
}
