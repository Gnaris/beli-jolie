import { getServerSession } from "next-auth";
import { redirect, Link } from "@/i18n/navigation";
import { authOptions } from "@/lib/auth";
import { getClientClaim, markMessagesReadByClient } from "@/app/actions/client/claims";
import { getCachedShopName } from "@/lib/cached-data";
import { getTranslations } from "next-intl/server";
import ClaimDetailClient from "./ClaimDetailClient";
import ClaimOrderItemsPanel from "@/components/claims/ClaimOrderItemsPanel";
import CloseMyClaimButton from "@/components/client/claims/CloseMyClaimButton";
import { computeClaimItemPricing } from "@/lib/claim-item-pricing";
import type { Metadata } from "next";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const [shopName, tClaims] = await Promise.all([
    getCachedShopName(),
    getTranslations({ locale, namespace: "claims" }),
  ]);
  return { title: tClaims("metaDetailTitle", { shopName }) };
}

export default async function ClientClaimDetailPage({ params }: { params: Promise<{ id: string; locale: string }> }) {
  const session = await getServerSession(authOptions);
  const { id, locale } = await params;
  if (!session) return redirect({ href: "/connexion", locale });
  if (session.user.status !== "APPROVED") return redirect({ href: "/espace-pro", locale });

  const claim = await getClientClaim(id);
  // Si la conversation a été supprimée par l'admin (ou n'a jamais existé pour ce
  // client), on renvoie proprement sur la liste avec un flash — pas de 404.
  if (!claim) return redirect({ href: "/espace-pro/service-client?deleted=1", locale });

  // Marque les messages admin comme lus à l'ouverture de la page
  await markMessagesReadByClient(id);

  const t = await getTranslations({ locale, namespace: "claims" });
  const dateLocale = locale === "fr" ? "fr-FR" : "en-US";
  const formattedDate = new Date(claim.createdAt).toLocaleDateString(dateLocale, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const isOpen = claim.status === "OPEN";

  const messages =
    claim.conversation?.messages.map((m) => ({
      id: m.id,
      content: m.content,
      senderRole: m.senderRole as "ADMIN" | "CLIENT",
      senderFirstName: m.sender.firstName ?? null,
      createdAt: m.createdAt.toISOString(),
      attachments: m.attachments.map((a) => ({
        id: a.id,
        fileName: a.fileName,
        filePath: a.filePath,
        fileSize: a.fileSize,
        mimeType: a.mimeType,
      })),
    })) ?? [];

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <Link
        href="/espace-pro/service-client"
        className="inline-flex items-center gap-1.5 text-sm text-text-muted hover:text-text-primary font-body transition-colors"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        {t("backToList")}
      </Link>

      {/* Header card */}
      <div className="bg-bg-primary border border-border rounded-2xl p-5 sm:p-6 shadow-sm">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              {isOpen ? (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-zinc-100 text-zinc-800 text-xs font-semibold border border-zinc-200">
                  <span className="w-1.5 h-1.5 rounded-full bg-zinc-800" />
                  {t("statusOpen")}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-zinc-50 text-zinc-500 text-xs font-semibold border border-zinc-200">
                  <span className="w-1.5 h-1.5 rounded-full bg-zinc-400" />
                  {t("statusClosed")}
                </span>
              )}
              <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-text-muted">
                {claim.reference}
              </span>
            </div>
            <h1 className="font-heading text-xl sm:text-2xl font-bold text-text-primary mt-1 break-words">
              {claim.subject}
            </h1>
            <p className="text-xs text-text-muted font-body mt-1">
              {t("detailCreatedOn", { date: formattedDate })}
            </p>
          </div>
          {isOpen && <CloseMyClaimButton claimId={claim.id} />}
        </div>
      </div>

      {claim.type === "ORDER_RELATED" && claim.order && (() => {
        const discountableSubtotal = claim.order.items
          .filter((it) => !it.isCompensation)
          .reduce((s, it) => s + Number(it.lineTotal), 0);
        const ctx = {
          discountableSubtotal,
          clientDiscountAmt: Number(claim.order.clientDiscountAmt ?? 0),
          promoDiscount: Number(claim.order.promoDiscount ?? 0),
        };
        return (
          <ClaimOrderItemsPanel
            role="client"
            order={{
              id: claim.order.id,
              orderNumber: claim.order.orderNumber,
              createdAt: claim.order.createdAt.toISOString(),
              totalTTC: Number(claim.order.totalTTC),
              status: claim.order.status as "PENDING" | "SHIPPED" | "CANCELLED",
            }}
            items={claim.orderItems.map((oi) => {
              const pricing = computeClaimItemPricing(
                {
                  quantity: oi.orderItem.quantity,
                  unitPrice: Number(oi.orderItem.unitPrice),
                  lineTotal: Number(oi.orderItem.lineTotal),
                  lineDiscountAmt: oi.orderItem.lineDiscountAmt ? Number(oi.orderItem.lineDiscountAmt) : null,
                  isCompensation: oi.orderItem.isCompensation,
                  variantSnapshot: oi.orderItem.variantSnapshot,
                },
                ctx,
                oi.quantity,
              );
              return {
                id: oi.id,
                reportedQuantity: oi.quantity,
                orderItem: {
                  id: oi.orderItem.id,
                  productName: oi.orderItem.productName,
                  productRef: oi.orderItem.productRef,
                  colorName: oi.orderItem.colorName,
                  imagePath: oi.orderItem.imagePath,
                  saleType: oi.orderItem.saleType,
                  packQty: oi.orderItem.packQty,
                  size: oi.orderItem.size,
                  sizesJson: oi.orderItem.sizesJson,
                  quantity: oi.orderItem.quantity,
                },
                pricing,
              };
            })}
          />
        );
      })()}

      {claim.conversation && (
        <ClaimDetailClient
          claimId={claim.id}
          conversationId={claim.conversation.id}
          initialMessages={messages}
          initialStatus={claim.status as "OPEN" | "CLOSED"}
        />
      )}
    </div>
  );
}
