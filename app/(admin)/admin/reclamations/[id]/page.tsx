import { getServerSession } from "next-auth";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { authOptions } from "@/lib/auth";
import { getAdminClaim } from "@/app/actions/admin/claims";
import ClaimTimeline from "@/components/client/claims/ClaimTimeline";
import AdminClaimView from "./AdminClaimView";
import AdminClaimActions from "./AdminClaimActions";

export const metadata = { title: "Reclamation — Admin" };

export default async function AdminClaimDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") redirect("/connexion");

  const { id } = await params;
  const claim = await getAdminClaim(id);
  if (!claim) notFound();

  return (
    <div className="space-y-4">
      <Link href="/admin/reclamations" className="text-sm text-text-muted hover:text-text-primary font-body transition-colors">
        &larr; Retour aux reclamations
      </Link>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Main content */}
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-bg-primary border border-border rounded-2xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h1 className="font-heading text-xl font-bold text-text-primary">{claim.reference}</h1>
              <span className="text-xs text-text-muted font-body">
                {new Date(claim.createdAt).toLocaleDateString("fr-FR")}
              </span>
            </div>
            <ClaimTimeline status={claim.status} hasReturn={!!claim.returnInfo} />
            <p className="text-sm text-text-primary font-body">{claim.description}</p>

            {claim.items.length > 0 && (
              <div className="border-t border-border pt-4 space-y-2">
                <p className="text-xs uppercase tracking-wider text-text-muted font-semibold font-body">Articles</p>
                {claim.items.map((item) => (
                  <div key={item.id} className="flex items-center gap-3 p-2 bg-bg-secondary rounded-lg">
                    <div className="flex-1">
                      <p className="text-sm font-body text-text-primary">{item.orderItem?.productName || "Article"}</p>
                      <p className="text-xs text-text-muted font-body">
                        Qte: {item.quantity} — {item.reason}
                        {item.reasonDetail && ` — ${item.reasonDetail}`}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {claim.images.length > 0 && (
              <div className="border-t border-border pt-4">
                <p className="text-xs uppercase tracking-wider text-text-muted font-semibold font-body mb-2">Photos</p>
                <div className="flex gap-2 flex-wrap">
                  {claim.images.map((img) => (
                    <a key={img.id} href={img.imagePath} target="_blank" rel="noopener noreferrer"
                       className="w-20 h-20 bg-bg-secondary rounded-lg flex items-center justify-center text-xs text-text-muted hover:opacity-75">
                      Photo
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Conversation */}
          {claim.conversation && (
            <div className="bg-bg-primary border border-border rounded-2xl overflow-hidden" style={{ maxHeight: "500px" }}>
              <AdminClaimView claim={claim} />
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          {/* Client info */}
          <div className="bg-bg-primary border border-border rounded-2xl p-6 space-y-3">
            <h3 className="font-heading font-bold text-text-primary">Client</h3>
            <div className="text-sm font-body space-y-1">
              <p className="text-text-primary font-semibold">{claim.user.firstName} {claim.user.lastName}</p>
              {claim.user.company && <p className="text-text-muted">{claim.user.company}</p>}
              <p className="text-text-muted">{claim.user.email}</p>
            </div>
          </div>

          {/* Order info */}
          {claim.order && (
            <div className="bg-bg-primary border border-border rounded-2xl p-6 space-y-3">
              <h3 className="font-heading font-bold text-text-primary">Commande</h3>
              <div className="text-sm font-body space-y-1">
                <p className="text-text-primary">{claim.order.orderNumber}</p>
                <p className="text-text-muted">
                  {new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(Number(claim.order.totalTTC))}
                </p>
                <Link href={`/admin/commandes/${claim.order.id}`} className="text-text-muted underline hover:text-text-primary">
                  Voir la commande
                </Link>
              </div>
            </div>
          )}

          {/* Actions */}
          <AdminClaimActions claimId={claim.id} status={claim.status} userId={claim.user.id} adminNote={claim.adminNote} />
        </div>
      </div>
    </div>
  );
}
