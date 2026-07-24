import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getCachedShopName, getCachedHasMicrostoreConfig } from "@/lib/cached-data";
import MicrostoreImportBar from "@/components/admin/microstore/MicrostoreImportBar";

export async function generateMetadata(): Promise<Metadata> {
  const shopName = await getCachedShopName();
  return { title: `Commandes Microstore — ${shopName} Admin` };
}

function todayYmd(): string {
  return new Date().toISOString().substring(0, 10);
}
function daysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().substring(0, 10);
}
function formatMoney(v: unknown): string {
  const n = typeof v === "number" ? v : Number(v?.toString?.() ?? 0);
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
  }).format(n);
}

const STATUS_LABEL: Record<string, { label: string; className: string }> = {
  NEW: { label: "À préparer", className: "bg-sky-50 text-sky-700 border-sky-200" },
  SHIPPED: {
    label: "Expédiée",
    className: "bg-emerald-50 text-emerald-700 border-emerald-200",
  },
  CANCELLED: { label: "Annulée", className: "bg-red-50 text-red-700 border-red-200" },
};

export default async function MicrostoreOrdersPage() {
  const connected = await getCachedHasMicrostoreConfig();

  const [orders, lastImported, totalCount] = await Promise.all([
    prisma.microstoreOrder.findMany({
      orderBy: { createdAtMicrostore: "desc" },
      take: 50,
      select: {
        id: true,
        microstoreOrderId: true,
        status: true,
        totalHT: true,
        customerName: true,
        customerCompany: true,
        customerCountry: true,
        shippingLabel: true,
        remark: true,
        createdAtMicrostore: true,
        _count: { select: { items: true } },
      },
    }),
    prisma.microstoreOrder.findFirst({
      orderBy: { createdAtMicrostore: "desc" },
      select: { createdAtMicrostore: true },
    }),
    prisma.microstoreOrder.count(),
  ]);

  const defaultFrom = lastImported
    ? new Date(lastImported.createdAtMicrostore.getTime() - 24 * 60 * 60 * 1000)
        .toISOString()
        .substring(0, 10)
    : daysAgo(30);
  const defaultTo = todayYmd();

  return (
    <div className="space-y-6">
      {/* Fil d'ariane */}
      <nav className="text-xs text-text-muted font-body">
        <Link href="/admin/commandes" className="hover:text-text-primary">
          Commandes
        </Link>
        <span className="mx-2">/</span>
        <span className="text-text-primary font-medium">Microstore</span>
      </nav>

      {/* Hero */}
      <section className="relative overflow-hidden rounded-3xl border border-border shadow-sm">
        <div className="absolute inset-0 bg-gradient-to-br from-slate-50 via-bg-primary to-bg-primary" />
        <div className="absolute -top-16 -right-12 w-56 h-56 rounded-full blur-3xl bg-slate-300/30 pointer-events-none" />
        <div className="relative px-6 py-8 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div>
            <p className="font-body text-[10.5px] font-semibold uppercase tracking-[0.2em] text-text-muted">
              Marketplace
            </p>
            <h1 className="font-heading text-2xl sm:text-3xl font-bold text-text-primary mt-2">
              Commandes Microstore
            </h1>
            <p className="font-body text-sm text-text-secondary mt-2 max-w-xl">
              Importe et suit les commandes passées sur Microstore. Le paiement est considéré comme déjà encaissé.
            </p>
          </div>
          <div className="rounded-2xl border border-border bg-bg-primary p-4 min-w-[160px]">
            <div className="text-[10px] uppercase tracking-wider text-text-muted font-body">
              Total importées
            </div>
            <div className="font-heading text-3xl font-bold text-text-primary tabular-nums mt-1">
              {totalCount}
            </div>
          </div>
        </div>
      </section>

      {/* Bandeau non-connecté */}
      {!connected && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-amber-500 text-white flex items-center justify-center shrink-0">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 9v3.75m0 3.75h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            </svg>
          </div>
          <div className="flex-1">
            <div className="font-heading text-sm font-bold text-amber-900">
              Microstore n'est pas encore connecté
            </div>
            <div className="text-xs text-amber-800 mt-1">
              Connectez votre compte via QR code pour pouvoir importer vos commandes.
            </div>
            <Link
              href="/admin/parametres/microstore"
              className="inline-block mt-2 h-9 px-4 rounded-lg bg-amber-800 text-white text-xs font-body font-bold hover:bg-amber-900 transition-colors leading-9"
            >
              Aller à la connexion →
            </Link>
          </div>
        </div>
      )}

      {/* Bandeau import */}
      {connected && (
        <MicrostoreImportBar defaultFromDate={defaultFrom} defaultToDate={defaultTo} />
      )}

      {/* Table */}
      <section className="rounded-2xl border border-border bg-bg-primary shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-border">
          <h2 className="font-heading text-base font-semibold text-text-primary">
            Dernières commandes importées
          </h2>
          <p className="text-xs text-text-muted font-body mt-0.5">
            {orders.length} sur {totalCount} affichée{orders.length > 1 ? "s" : ""}
          </p>
        </div>
        {orders.length === 0 ? (
          <div className="p-10 text-center text-sm text-text-muted font-body">
            Aucune commande Microstore importée pour l'instant.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-bg-secondary/60 text-[10.5px] uppercase tracking-wider text-text-muted font-body">
                <tr>
                  <th className="text-left px-4 py-3">N° Microstore</th>
                  <th className="text-left px-4 py-3">Date</th>
                  <th className="text-left px-4 py-3">Client</th>
                  <th className="text-left px-4 py-3">Livraison</th>
                  <th className="text-right px-4 py-3">Articles</th>
                  <th className="text-right px-4 py-3">Total HT</th>
                  <th className="text-center px-4 py-3">Statut</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {orders.map((o) => {
                  const badge = STATUS_LABEL[o.status] ?? {
                    label: o.status,
                    className: "bg-bg-secondary text-text-muted border-border",
                  };
                  return (
                    <tr key={o.id} className="hover:bg-bg-secondary/30">
                      <td className="px-4 py-3 font-body font-semibold text-text-primary tabular-nums">
                        {o.microstoreOrderId}
                      </td>
                      <td className="px-4 py-3 font-body text-text-secondary tabular-nums">
                        {o.createdAtMicrostore.toLocaleDateString("fr-FR", {
                          day: "2-digit",
                          month: "2-digit",
                          year: "2-digit",
                        })}
                      </td>
                      <td className="px-4 py-3 font-body">
                        <div className="text-text-primary">{o.customerName}</div>
                        {o.customerCompany && (
                          <div className="text-xs text-text-muted mt-0.5">
                            {o.customerCompany}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 font-body text-xs text-text-secondary">
                        {o.shippingLabel ?? "—"}
                        {o.remark && (
                          <div
                            className="text-[10.5px] text-amber-700 mt-0.5 max-w-[200px] truncate"
                            title={o.remark}
                          >
                            💬 {o.remark}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-body tabular-nums text-text-secondary">
                        {o._count.items}
                      </td>
                      <td className="px-4 py-3 text-right font-heading font-semibold tabular-nums text-text-primary">
                        {formatMoney(o.totalHT)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span
                          className={`inline-flex items-center px-2 py-1 rounded-full text-[10.5px] font-body font-bold uppercase tracking-wider border ${badge.className}`}
                        >
                          {badge.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
