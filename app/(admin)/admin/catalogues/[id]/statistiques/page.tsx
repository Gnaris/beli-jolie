import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getCatalogStats } from "@/app/actions/admin/catalogs";

export const metadata: Metadata = { title: "Statistiques du catalogue — Admin" };

interface Props {
  params: Promise<{ id: string }>;
}

function displayName(u: {
  firstName: string | null;
  lastName: string | null;
  email: string;
  company: string | null;
}): string {
  const full = [u.firstName, u.lastName].filter(Boolean).join(" ").trim();
  if (full && u.company) return `${full} — ${u.company}`;
  return full || u.company || u.email;
}

function formatDate(d: Date): string {
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(d));
}

export default async function CatalogStatsPage({ params }: Props) {
  const { id } = await params;

  let stats;
  try {
    stats = await getCatalogStats(id);
  } catch {
    notFound();
  }

  const { catalog, totalViews, anonymousViews, connectedViews, views, cartAdditions } = stats;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <Link
            href={`/admin/catalogues/${catalog.id}`}
            className="shrink-0 w-9 h-9 flex items-center justify-center rounded-xl border border-border hover:bg-bg-secondary transition-colors text-text-muted hover:text-text-primary"
            title="Retour à l'édition"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
          </Link>
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-[0.24em] text-text-muted font-body">Statistiques</p>
            <h1 className="font-heading font-bold text-text-primary text-xl sm:text-2xl truncate">
              {catalog.title}
            </h1>
          </div>
        </div>
        <a
          href={`/catalogue/${catalog.token}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-border hover:bg-bg-secondary transition-colors text-sm text-text-muted hover:text-text-primary"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
          </svg>
          Ouvrir le lien public
        </a>
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="relative overflow-hidden bg-bg-primary border border-border rounded-2xl p-5 shadow-sm">
          <div className="absolute -top-6 -right-6 w-24 h-24 rounded-full bg-sky-100/60 blur-2xl" />
          <p className="text-[11px] uppercase tracking-[0.22em] text-text-muted font-body">Total visites</p>
          <p className="font-heading text-3xl font-bold text-sky-700 mt-2">{totalViews}</p>
          <p className="text-xs text-text-muted font-body mt-1">Chaque ouverture du lien compte.</p>
        </div>
        <div className="relative overflow-hidden bg-bg-primary border border-border rounded-2xl p-5 shadow-sm">
          <div className="absolute -top-6 -right-6 w-24 h-24 rounded-full bg-emerald-100/60 blur-2xl" />
          <p className="text-[11px] uppercase tracking-[0.22em] text-text-muted font-body">Vues clients connectés</p>
          <p className="font-heading text-3xl font-bold text-emerald-700 mt-2">{connectedViews}</p>
          <p className="text-xs text-text-muted font-body mt-1">Un client identifié qui a ouvert le lien.</p>
        </div>
        <div className="relative overflow-hidden bg-bg-primary border border-border rounded-2xl p-5 shadow-sm">
          <div className="absolute -top-6 -right-6 w-24 h-24 rounded-full bg-slate-100/60 blur-2xl" />
          <p className="text-[11px] uppercase tracking-[0.22em] text-text-muted font-body">Vues anonymes</p>
          <p className="font-heading text-3xl font-bold text-slate-700 mt-2">{anonymousViews}</p>
          <p className="text-xs text-text-muted font-body mt-1">Visiteurs non connectés.</p>
        </div>
      </div>

      {/* Ajouts au panier */}
      <section className="bg-bg-primary border border-border rounded-2xl shadow-sm overflow-hidden">
        <div className="p-5 pb-3 flex items-center gap-3">
          <span className="inline-block w-1 h-5 rounded-full bg-emerald-400" />
          <h2 className="font-heading font-semibold text-text-primary text-sm uppercase tracking-[0.18em]">
            Clients qui ont ajouté un produit au panier ({cartAdditions.length})
          </h2>
        </div>
        {cartAdditions.length === 0 ? (
          <div className="px-5 pb-5">
            <p className="text-sm text-text-muted font-body">
              Aucun ajout au panier depuis ce catalogue pour l'instant.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="table-header">
                  <th className="text-left px-5 py-3 text-xs font-semibold text-[#6B7280] uppercase tracking-wider">Client</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-[#6B7280] uppercase tracking-wider">Produit</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-[#6B7280] uppercase tracking-wider hidden md:table-cell">Couleur</th>
                  <th className="text-right px-5 py-3 text-xs font-semibold text-[#6B7280] uppercase tracking-wider">Quantité</th>
                  <th className="text-right px-5 py-3 text-xs font-semibold text-[#6B7280] uppercase tracking-wider hidden sm:table-cell">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F3F4F6]">
                {cartAdditions.map((add) => (
                  <tr key={add.id} className="hover:bg-[#FAFAFA] transition-colors">
                    <td className="px-5 py-3">
                      <p className="text-sm text-text-primary font-body">{displayName(add.user)}</p>
                      <p className="text-xs text-text-muted font-body">{add.user.email}</p>
                    </td>
                    <td className="px-5 py-3">
                      <p className="text-sm text-text-primary font-body">{add.product.name}</p>
                      <p className="text-xs text-text-muted font-body font-mono">{add.product.reference}</p>
                    </td>
                    <td className="px-5 py-3 hidden md:table-cell">
                      <span className="text-sm text-text-secondary font-body">
                        {add.variant?.colorName ?? "—"}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <span className="badge badge-neutral text-xs">×{add.quantity}</span>
                    </td>
                    <td className="px-5 py-3 text-right hidden sm:table-cell">
                      <span className="text-xs text-text-muted font-body">{formatDate(add.addedAt)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Visites clients connectés */}
      <section className="bg-bg-primary border border-border rounded-2xl shadow-sm overflow-hidden">
        <div className="p-5 pb-3 flex items-center gap-3">
          <span className="inline-block w-1 h-5 rounded-full bg-sky-400" />
          <h2 className="font-heading font-semibold text-text-primary text-sm uppercase tracking-[0.18em]">
            Dernières visites de clients connectés
          </h2>
        </div>
        {views.filter((v) => v.user).length === 0 ? (
          <div className="px-5 pb-5">
            <p className="text-sm text-text-muted font-body">
              Aucun client connecté n'a encore visité ce catalogue.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="table-header">
                  <th className="text-left px-5 py-3 text-xs font-semibold text-[#6B7280] uppercase tracking-wider">Client</th>
                  <th className="text-right px-5 py-3 text-xs font-semibold text-[#6B7280] uppercase tracking-wider">Date de visite</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F3F4F6]">
                {views
                  .filter((v) => v.user)
                  .map((v) => (
                    <tr key={v.id} className="hover:bg-[#FAFAFA] transition-colors">
                      <td className="px-5 py-3">
                        <p className="text-sm text-text-primary font-body">{displayName(v.user!)}</p>
                        <p className="text-xs text-text-muted font-body">{v.user!.email}</p>
                      </td>
                      <td className="px-5 py-3 text-right">
                        <span className="text-xs text-text-muted font-body">{formatDate(v.viewedAt)}</span>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
