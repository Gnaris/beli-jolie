import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { authOptions } from "@/lib/auth";
import { getClientClaims } from "@/app/actions/client/claims";

export const metadata = { title: "Reclamations" };

const STATUS_BADGES: Record<string, { className: string; label: string }> = {
  OPEN: { className: "badge badge-info", label: "Ouverte" },
  IN_REVIEW: { className: "badge badge-warning", label: "En examen" },
  ACCEPTED: { className: "badge badge-success", label: "Acceptee" },
  REJECTED: { className: "badge badge-error", label: "Refusee" },
  RETURN_PENDING: { className: "badge badge-warning", label: "Retour demande" },
  RETURN_SHIPPED: { className: "badge badge-info", label: "Retour expedie" },
  RETURN_RECEIVED: { className: "badge badge-success", label: "Retour recu" },
  RESOLUTION_PENDING: { className: "badge badge-warning", label: "Resolution en cours" },
  RESOLVED: { className: "badge badge-success", label: "Resolue" },
  CLOSED: { className: "badge badge-neutral", label: "Fermee" },
};

export default async function ClientClaimsPage() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "CLIENT") redirect("/connexion");

  const claims = await getClientClaims();

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-2xl font-bold text-text-primary">Reclamations</h1>
        <Link
          href="/espace-pro/reclamations/nouveau"
          className="px-4 py-2 text-sm font-body bg-[#1A1A1A] text-white rounded-lg hover:bg-[#333] transition-colors"
        >
          Nouvelle reclamation
        </Link>
      </div>

      {claims.length === 0 ? (
        <div className="bg-bg-primary border border-border rounded-2xl p-8 text-center">
          <p className="text-text-muted font-body">Aucune reclamation.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {claims.map((claim) => {
            const badge = STATUS_BADGES[claim.status] || { className: "badge badge-neutral", label: claim.status };
            return (
              <Link
                key={claim.id}
                href={`/espace-pro/reclamations/${claim.id}`}
                className="block bg-bg-primary border border-border rounded-2xl p-4 hover:border-[#1A1A1A]/30 transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-heading font-semibold text-text-primary">{claim.reference}</span>
                      <span className={badge.className}>{badge.label}</span>
                      <span className="badge badge-neutral">
                        {claim.type === "ORDER_CLAIM" ? "Commande" : "Generale"}
                      </span>
                    </div>
                    {claim.order && (
                      <p className="text-xs text-text-muted font-body mt-1">
                        Commande {claim.order.orderNumber}
                      </p>
                    )}
                  </div>
                  <span className="text-xs text-text-muted font-body whitespace-nowrap">
                    {new Date(claim.createdAt).toLocaleDateString("fr-FR")}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
