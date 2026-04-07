import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { authOptions } from "@/lib/auth";
import { getClientClaims } from "@/app/actions/client/claims";

export const metadata = { title: "Reclamations" };

const STATUS_CONFIG: Record<string, { badge: string; label: string; icon: string }> = {
  OPEN: { badge: "badge badge-info", label: "Ouverte", icon: "📩" },
  IN_REVIEW: { badge: "badge badge-warning", label: "En examen", icon: "🔍" },
  ACCEPTED: { badge: "badge badge-success", label: "Acceptée", icon: "✅" },
  REJECTED: { badge: "badge badge-error", label: "Refusée", icon: "❌" },
  RETURN_PENDING: { badge: "badge badge-warning", label: "Retour demandé", icon: "📦" },
  RETURN_SHIPPED: { badge: "badge badge-info", label: "Retour expédié", icon: "🚚" },
  RETURN_RECEIVED: { badge: "badge badge-success", label: "Retour reçu", icon: "📬" },
  RESOLUTION_PENDING: { badge: "badge badge-warning", label: "Résolution en cours", icon: "⏳" },
  RESOLVED: { badge: "badge badge-success", label: "Résolue", icon: "🎉" },
  CLOSED: { badge: "badge badge-neutral", label: "Fermée", icon: "🔒" },
};

export default async function ClientClaimsPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/connexion");

  const claims = await getClientClaims();

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-bold text-text-primary">Mes réclamations</h1>
          <p className="text-sm text-text-muted font-body mt-1">
            Suivez l&apos;avancement de vos réclamations et échangez avec notre équipe.
          </p>
        </div>
        <Link
          href="/espace-pro/reclamations/nouveau"
          className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold font-body bg-[#1A1A1A] text-white rounded-xl hover:bg-[#333] transition-colors shadow-sm"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Nouvelle réclamation
        </Link>
      </div>

      {claims.length === 0 ? (
        <div className="bg-bg-primary border border-border rounded-2xl p-12 text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-bg-secondary flex items-center justify-center">
            <svg className="w-8 h-8 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <p className="text-text-muted font-body text-sm">Aucune réclamation pour le moment.</p>
          <p className="text-text-muted/60 font-body text-xs mt-1">
            Si vous rencontrez un problème avec une commande, créez une réclamation.
          </p>
        </div>
      ) : (
        <div className="border border-border rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm font-body">
              <thead>
                <tr className="bg-bg-secondary border-b border-border">
                  <th className="text-left text-[11px] font-semibold text-text-secondary uppercase tracking-wider px-4 py-3">Référence</th>
                  <th className="text-left text-[11px] font-semibold text-text-secondary uppercase tracking-wider px-4 py-3">Type</th>
                  <th className="text-left text-[11px] font-semibold text-text-secondary uppercase tracking-wider px-4 py-3">Commande</th>
                  <th className="text-center text-[11px] font-semibold text-text-secondary uppercase tracking-wider px-4 py-3">Articles</th>
                  <th className="text-center text-[11px] font-semibold text-text-secondary uppercase tracking-wider px-4 py-3">Statut</th>
                  <th className="text-right text-[11px] font-semibold text-text-secondary uppercase tracking-wider px-4 py-3">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {claims.map((claim) => {
                  const cfg = STATUS_CONFIG[claim.status] || { badge: "badge badge-neutral", label: claim.status, icon: "📄" };
                  return (
                    <tr key={claim.id} className="hover:bg-bg-secondary/50 transition-colors">
                      <td className="px-4 py-3">
                        <Link href={`/espace-pro/reclamations/${claim.id}`} className="font-heading font-bold text-text-primary hover:underline">
                          {claim.reference}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        {claim.type === "ORDER_CLAIM" ? (
                          <span className="badge badge-purple">Commande</span>
                        ) : (
                          <span className="badge badge-neutral">Générale</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-text-muted">
                        {claim.order ? claim.order.orderNumber : "—"}
                      </td>
                      <td className="px-4 py-3 text-center text-text-muted">
                        {claim._count.items > 0 ? `${claim._count.items} article${claim._count.items > 1 ? "s" : ""}` : "—"}
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
        </div>
      )}
    </div>
  );
}
