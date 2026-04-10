import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { authOptions } from "@/lib/auth";
import { getClientClaims } from "@/app/actions/client/claims";

export const metadata = { title: "Reclamations" };

const STATUS_CONFIG: Record<string, { badge: string; label: string; borderColor: string }> = {
  OPEN: { badge: "badge badge-info", label: "Ouverte", borderColor: "border-l-gray-500" },
  IN_REVIEW: { badge: "badge badge-warning", label: "En examen", borderColor: "border-l-amber-400" },
  ACCEPTED: { badge: "badge badge-success", label: "Accept\u00e9e", borderColor: "border-l-green-500" },
  REJECTED: { badge: "badge badge-error", label: "Refus\u00e9e", borderColor: "border-l-red-500" },
  RETURN_PENDING: { badge: "badge badge-warning", label: "Retour demand\u00e9", borderColor: "border-l-amber-400" },
  RETURN_SHIPPED: { badge: "badge badge-info", label: "Retour exp\u00e9di\u00e9", borderColor: "border-l-gray-500" },
  RETURN_RECEIVED: { badge: "badge badge-success", label: "Retour re\u00e7u", borderColor: "border-l-green-500" },
  RESOLUTION_PENDING: { badge: "badge badge-warning", label: "R\u00e9solution en cours", borderColor: "border-l-amber-400" },
  RESOLVED: { badge: "badge badge-success", label: "R\u00e9solue", borderColor: "border-l-green-500" },
  CLOSED: { badge: "badge badge-neutral", label: "Ferm\u00e9e", borderColor: "border-l-gray-300" },
};

export default async function ClientClaimsPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/connexion");

  const claims = await getClientClaims();

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-xs font-body text-text-muted">
        <Link href="/espace-pro" className="hover:text-text-primary transition-colors">
          Espace pro
        </Link>
        <svg className="w-3.5 h-3.5 text-text-muted/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        <span className="text-text-primary font-medium">R&eacute;clamations</span>
      </nav>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-bold text-text-primary">Mes r&eacute;clamations</h1>
          <p className="text-sm text-text-muted font-body mt-1">
            {claims.length === 0
              ? "Suivez l\u2019avancement de vos r\u00e9clamations et \u00e9changez avec notre \u00e9quipe."
              : `${claims.length} r\u00e9clamation${claims.length > 1 ? "s" : ""} \u2014 suivez leur avancement et \u00e9changez avec notre \u00e9quipe.`}
          </p>
        </div>
        <Link
          href="/espace-pro/reclamations/nouveau"
          className="inline-flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-semibold font-body bg-bg-dark text-text-inverse rounded-xl hover:bg-primary-hover transition-colors shadow-sm whitespace-nowrap"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Nouvelle r&eacute;clamation
        </Link>
      </div>

      {claims.length === 0 ? (
        /* Empty state */
        <div className="bg-bg-primary border border-border rounded-2xl p-16 text-center shadow-sm">
          <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-bg-secondary flex items-center justify-center">
            <svg className="w-10 h-10 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <h2 className="font-heading text-lg font-semibold text-text-primary mb-2">Aucune r&eacute;clamation</h2>
          <p className="text-text-muted font-body text-sm max-w-sm mx-auto mb-6">
            Vous n&apos;avez pas encore de r&eacute;clamation. Si vous rencontrez un probl&egrave;me avec une commande, cr&eacute;ez-en une.
          </p>
          <Link
            href="/espace-pro/reclamations/nouveau"
            className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold font-body bg-bg-dark text-text-inverse rounded-xl hover:bg-primary-hover transition-colors shadow-sm"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Cr&eacute;er une r&eacute;clamation
          </Link>
        </div>
      ) : (
        <>
          {/* Desktop table (hidden on mobile) */}
          <div className="hidden md:block bg-bg-primary border border-border rounded-2xl overflow-hidden shadow-sm">
            <table className="w-full text-sm font-body">
              <thead>
                <tr className="bg-bg-secondary border-b border-border">
                  <th className="text-left text-[11px] font-semibold text-text-secondary uppercase tracking-wider px-4 py-3">R&eacute;f&eacute;rence</th>
                  <th className="text-left text-[11px] font-semibold text-text-secondary uppercase tracking-wider px-4 py-3">Type</th>
                  <th className="text-left text-[11px] font-semibold text-text-secondary uppercase tracking-wider px-4 py-3">Commande</th>
                  <th className="text-center text-[11px] font-semibold text-text-secondary uppercase tracking-wider px-4 py-3">Articles</th>
                  <th className="text-center text-[11px] font-semibold text-text-secondary uppercase tracking-wider px-4 py-3">Statut</th>
                  <th className="text-right text-[11px] font-semibold text-text-secondary uppercase tracking-wider px-4 py-3">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {claims.map((claim) => {
                  const cfg = STATUS_CONFIG[claim.status] || { badge: "badge badge-neutral", label: claim.status, borderColor: "border-l-gray-300" };
                  return (
                    <tr key={claim.id} className="group relative hover:bg-bg-secondary/50 transition-colors">
                      <td className="px-4 py-3">
                        <Link
                          href={`/espace-pro/reclamations/${claim.id}`}
                          className="font-heading font-bold text-text-primary hover:underline after:absolute after:inset-0 after:content-['']"
                        >
                          <span className={`inline-block w-1.5 h-1.5 rounded-full mr-2 align-middle ${cfg.borderColor.replace("border-l-", "bg-")}`} />
                          {claim.reference}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        {claim.type === "ORDER_CLAIM" ? (
                          <span className="badge badge-purple">Commande</span>
                        ) : (
                          <span className="badge badge-neutral">G&eacute;n&eacute;rale</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-text-muted">
                        {claim.order ? claim.order.orderNumber : "\u2014"}
                      </td>
                      <td className="px-4 py-3 text-center text-text-muted">
                        {claim._count.items > 0 ? `${claim._count.items} article${claim._count.items > 1 ? "s" : ""}` : "\u2014"}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={cfg.badge}>{cfg.label}</span>
                      </td>
                      <td className="px-4 py-3 text-right text-xs text-text-muted whitespace-nowrap">
                        {new Date(claim.createdAt).toLocaleDateString("fr-FR", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile cards (hidden on desktop) */}
          <div className="md:hidden space-y-3">
            {claims.map((claim) => {
              const cfg = STATUS_CONFIG[claim.status] || { badge: "badge badge-neutral", label: claim.status, borderColor: "border-l-gray-300" };
              return (
                <Link
                  key={claim.id}
                  href={`/espace-pro/reclamations/${claim.id}`}
                  className={`block bg-bg-primary border border-border rounded-2xl shadow-sm p-4 border-l-4 ${cfg.borderColor} hover:shadow-md transition-shadow`}
                >
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="min-w-0">
                      <p className="font-heading font-bold text-text-primary text-sm truncate">
                        {claim.reference}
                      </p>
                      <p className="text-xs text-text-muted font-body mt-0.5">
                        {new Date(claim.createdAt).toLocaleDateString("fr-FR", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                      </p>
                    </div>
                    <span className={cfg.badge}>{cfg.label}</span>
                  </div>

                  <div className="flex items-center gap-3 flex-wrap">
                    {claim.type === "ORDER_CLAIM" ? (
                      <span className="badge badge-purple">Commande</span>
                    ) : (
                      <span className="badge badge-neutral">G&eacute;n&eacute;rale</span>
                    )}
                    {claim.order && (
                      <span className="text-xs text-text-muted font-body">
                        {claim.order.orderNumber}
                      </span>
                    )}
                    {claim._count.items > 0 && (
                      <span className="text-xs text-text-muted font-body">
                        {claim._count.items} article{claim._count.items > 1 ? "s" : ""}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center justify-end mt-2">
                    <svg className="w-4 h-4 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                </Link>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
