import { getServerSession } from "next-auth";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { authOptions } from "@/lib/auth";
import { getClientClaim } from "@/app/actions/client/claims";
import ClaimTimeline from "@/components/client/claims/ClaimTimeline";
import ClaimDetailClient from "./ClaimDetailClient";

export const metadata = { title: "Reclamation" };

export default async function ClientClaimDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "CLIENT") redirect("/connexion");

  const { id } = await params;
  const claim = await getClientClaim(id);
  if (!claim) notFound();

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <Link href="/espace-pro/reclamations" className="text-sm text-text-muted hover:text-text-primary font-body transition-colors">
        &larr; Retour aux reclamations
      </Link>

      <div className="bg-bg-primary border border-border rounded-2xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="font-heading text-xl font-bold text-text-primary">{claim.reference}</h1>
          <span className="text-xs text-text-muted font-body">
            {new Date(claim.createdAt).toLocaleDateString("fr-FR")}
          </span>
        </div>

        <ClaimTimeline status={claim.status} hasReturn={!!claim.returnInfo} />

        <div className="space-y-2">
          <p className="text-sm text-text-muted font-body">
            <span className="font-semibold">Type :</span> {claim.type === "ORDER_CLAIM" ? "Liee a une commande" : "Generale"}
          </p>
          {claim.order && (
            <p className="text-sm text-text-muted font-body">
              <span className="font-semibold">Commande :</span> {claim.order.orderNumber}
            </p>
          )}
          <p className="text-sm text-text-primary font-body mt-3">{claim.description}</p>
        </div>

        {claim.items.length > 0 && (
          <div className="border-t border-border pt-4 space-y-2">
            <p className="text-xs uppercase tracking-wider text-text-muted font-semibold font-body">Articles concernes</p>
            {claim.items.map((item) => (
              <div key={item.id} className="flex items-center gap-3 p-2 bg-bg-secondary rounded-lg">
                <div className="flex-1">
                  <p className="text-sm font-body text-text-primary">{item.orderItem?.productName || "Article"}</p>
                  <p className="text-xs text-text-muted font-body">
                    Qte: {item.quantity} — {item.reason}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <ClaimDetailClient claim={claim} />
    </div>
  );
}
