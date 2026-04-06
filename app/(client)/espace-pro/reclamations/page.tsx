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
        <div className="space-y-3">
          {claims.map((claim) => {
            const cfg = STATUS_CONFIG[claim.status] || { badge: "badge badge-neutral", label: claim.status, icon: "📄" };
            const hasItems = claim._count.items > 0;
            const hasImages = claim._count.images > 0;

            return (
              <Link
                key={claim.id}
                href={`/espace-pro/reclamations/${claim.id}`}
                className="group block bg-bg-primary border border-border rounded-2xl p-5 hover:border-[#1A1A1A]/20 hover:shadow-md transition-all duration-200"
              >
                <div className="flex items-start gap-4">
                  {/* Icon */}
                  <div className="w-10 h-10 rounded-xl bg-bg-secondary flex items-center justify-center text-lg flex-shrink-0 group-hover:scale-105 transition-transform">
                    {cfg.icon}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <span className="font-heading font-bold text-text-primary">{claim.reference}</span>
                      <span className={cfg.badge}>{cfg.label}</span>
                      {claim.type === "ORDER_CLAIM" ? (
                        <span className="badge badge-purple">Commande</span>
                      ) : (
                        <span className="badge badge-neutral">Générale</span>
                      )}
                    </div>

                    {claim.order && (
                      <p className="text-xs text-text-muted font-body mt-1.5">
                        Commande <span className="font-medium text-text-primary">{claim.order.orderNumber}</span>
                      </p>
                    )}

                    {/* Meta row */}
                    <div className="flex items-center gap-3 mt-2.5">
                      {hasItems && (
                        <span className="inline-flex items-center gap-1 text-xs text-text-muted font-body">
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                          </svg>
                          {claim._count.items} article{claim._count.items > 1 ? "s" : ""}
                        </span>
                      )}
                      {hasImages && (
                        <span className="inline-flex items-center gap-1 text-xs text-text-muted font-body">
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                          {claim._count.images} photo{claim._count.images > 1 ? "s" : ""}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Date + arrow */}
                  <div className="flex flex-col items-end gap-2 flex-shrink-0">
                    <span className="text-xs text-text-muted font-body">
                      {new Date(claim.createdAt).toLocaleDateString("fr-FR", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </span>
                    <svg className="w-4 h-4 text-text-muted/40 group-hover:text-text-primary group-hover:translate-x-0.5 transition-all" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
