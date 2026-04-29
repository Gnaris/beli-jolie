import { getServerSession } from "next-auth";
import { notFound } from "next/navigation";
import { redirect, Link } from "@/i18n/navigation";
import Image from "next/image";
import { authOptions } from "@/lib/auth";
import { getClientClaim } from "@/app/actions/client/claims";
import { getImageSrc, resolveImageUrl } from "@/lib/image-utils";
import { getCachedShopName } from "@/lib/cached-data";
import ClaimDetailClient from "./ClaimDetailClient";
import type { Metadata } from "next";

export async function generateMetadata(): Promise<Metadata> {
  const shopName = await getCachedShopName();
  return { title: `Réclamation — ${shopName}` };
}

const REASON_LABELS: Record<string, string> = {
  DEFECTIVE: "Défectueux",
  WRONG_ITEM: "Mauvais article",
  MISSING: "Manquant",
  DAMAGED: "Endommagé",
  OTHER: "Autre",
};

export default async function ClientClaimDetailPage({ params }: { params: Promise<{ id: string; locale: string }> }) {
  const session = await getServerSession(authOptions);
  const { id, locale } = await params;
  if (!session) return redirect({href: "/connexion", locale});
  if (session.user.status !== "APPROVED") return redirect({href: "/espace-pro", locale});
  const claim = await getClientClaim(id);
  if (!claim) notFound();

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <Link
        href="/espace-pro/reclamations"
        className="inline-flex items-center gap-1.5 text-sm text-text-muted hover:text-text-primary font-body transition-colors"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Retour aux réclamations
      </Link>

      {/* Header card */}
      <div className="bg-bg-primary border border-border rounded-2xl p-6 shadow-sm space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="font-heading text-xl font-bold text-text-primary">{claim.reference}</h1>
            <p className="text-xs text-text-muted font-body mt-1">
              Créée le {new Date(claim.createdAt).toLocaleDateString("fr-FR", {
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
            </p>
          </div>
          <span className={`badge ${
            claim.type === "ORDER_CLAIM" ? "badge-purple" : "badge-neutral"
          }`}>
            {claim.type === "ORDER_CLAIM" ? "Commande" : "Générale"}
          </span>
        </div>

        {/* Info */}
        <div className="space-y-3">
          {claim.order && (
            <div className="flex items-center gap-2 text-sm font-body">
              <svg className="w-4 h-4 text-text-muted flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
              </svg>
              <span className="text-text-muted">Commande :</span>
              <span className="font-medium text-text-primary">{claim.order.orderNumber}</span>
            </div>
          )}

          <div className="bg-bg-secondary/50 rounded-xl p-4">
            <p className="text-xs uppercase tracking-wider text-text-muted font-semibold font-body mb-2">Description</p>
            <p className="text-sm text-text-primary font-body whitespace-pre-wrap leading-relaxed">{claim.description}</p>
          </div>
        </div>

        {/* Items */}
        {claim.items.length > 0 && (
          <div className="space-y-3">
            <p className="text-xs uppercase tracking-wider text-text-muted font-semibold font-body">
              Articles concernés ({claim.items.length})
            </p>
            <div className="space-y-2">
              {claim.items.map((item) => (
                <div key={item.id} className="flex items-center gap-3 p-3 bg-bg-secondary/50 rounded-xl">
                  {item.orderItem?.imagePath && (
                    <div className="w-10 h-10 rounded-lg overflow-hidden bg-bg-secondary flex-shrink-0">
                      <Image
                        src={getImageSrc(item.orderItem.imagePath, "thumb")}
                        alt={item.orderItem?.productName || "Article"}
                        width={40}
                        height={40}
                        className="object-cover w-full h-full"
                      />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-body font-medium text-text-primary truncate">
                      {item.orderItem?.productName || "Article"}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs text-text-muted font-body">
                        Qté : {item.quantity}
                      </span>
                      <span className="text-xs text-text-muted">•</span>
                      <span className="badge badge-neutral text-[10px]">
                        {REASON_LABELS[item.reason] || item.reason}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Attached images */}
        {claim.images.length > 0 && (
          <div className="space-y-3">
            <p className="text-xs uppercase tracking-wider text-text-muted font-semibold font-body">
              Pièces jointes ({claim.images.length})
            </p>
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
              {claim.images.map((img) => (
                <a
                  key={img.id}
                  href={resolveImageUrl(img.imagePath)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="relative aspect-square rounded-xl overflow-hidden border border-border bg-bg-secondary hover:border-[#1A1A1A]/30 hover:shadow-md transition-all group"
                >
                  <Image
                    src={resolveImageUrl(img.imagePath)}
                    alt="Pièce jointe"
                    fill
                    className="object-cover group-hover:scale-105 transition-transform"
                  />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center">
                    <svg className="w-5 h-5 text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow-lg" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" />
                    </svg>
                  </div>
                </a>
              ))}
            </div>
          </div>
        )}
      </div>

      <ClaimDetailClient claim={claim} />
    </div>
  );
}
