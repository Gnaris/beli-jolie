import { getServerSession } from "next-auth";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  getAdminClaim,
  markMessagesReadByAdmin,
  getClientCreditContext,
} from "@/app/actions/admin/claims";
import AdminClaimConversation from "./AdminClaimConversation";
import ClaimOrderItemsPanel from "@/components/claims/ClaimOrderItemsPanel";
import ClientCreditPanel from "@/components/admin/claims/ClientCreditPanel";
import { computeClaimItemPricing } from "@/lib/claim-item-pricing";

export const metadata = { title: "Conversation — Admin" };

export default async function AdminClaimDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") redirect("/connexion");

  const { id } = await params;
  const claim = await getAdminClaim(id);
  if (!claim) notFound();

  // Marque immédiatement les messages CLIENT comme lus (à l'ouverture de la page)
  await markMessagesReadByAdmin(id);

  // Petites stats client (nombre commandes + total commandé) — non bloquantes
  const [orderCount, orderAgg, previousClaims, creditContext] = await Promise.all([
    prisma.order.count({ where: { userId: claim.user.id } }),
    prisma.order.aggregate({
      where: { userId: claim.user.id, status: { in: ["PENDING", "SHIPPED"] } },
      _sum: { subtotalHT: true, carrierPrice: true },
    }),
    prisma.claim.findMany({
      where: {
        userId: claim.user.id,
        id: { not: claim.id },
      },
      select: { id: true, reference: true, subject: true, status: true, closedAt: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
    getClientCreditContext(claim.user.id),
  ]);

  const totalSpent =
    Number(orderAgg._sum.subtotalHT ?? 0) + Number(orderAgg._sum.carrierPrice ?? 0);

  const clientSummary = {
    id: claim.user.id,
    firstName: claim.user.firstName ?? "",
    lastName: claim.user.lastName ?? "",
    company: claim.user.company ?? "",
    email: claim.user.email ?? "",
    createdAt: claim.user.createdAt?.toISOString() ?? new Date().toISOString(),
    orderCount,
    totalSpent,
  };

  const conversation = claim.conversation
    ? {
        id: claim.conversation.id,
        messages: claim.conversation.messages.map((m) => ({
          id: m.id,
          content: m.content,
          senderRole: m.senderRole as "ADMIN" | "CLIENT",
          senderFirstName: m.sender.firstName ?? null,
          createdAt: m.createdAt.toISOString(),
          readAt: m.readAt ? m.readAt.toISOString() : null,
          attachments: m.attachments.map((a) => ({
            id: a.id,
            fileName: a.fileName,
            filePath: a.filePath,
            fileSize: a.fileSize,
            mimeType: a.mimeType,
          })),
        })),
      }
    : null;

  return (
    <div className="space-y-4 md:space-y-5">
      <Link
        href="/admin/service-client"
        className="inline-flex items-center gap-1.5 text-sm text-text-muted hover:text-text-primary transition-colors"
      >
        ← Retour au Service Client
      </Link>

      {(() => {
        // Panneau articles signalés (+ pré-calcul du total remboursable pour
        // pré-remplir l'accord d'avoir).
        let totalRefundable = 0;
        let orderPanel: React.ReactNode = null;
        if (claim.type === "ORDER_RELATED" && claim.order) {
          const discountableSubtotal = claim.order.items
            .filter((it) => !it.isCompensation)
            .reduce((s, it) => s + Number(it.lineTotal), 0);
          const ctx = {
            discountableSubtotal,
            clientDiscountAmt: Number(claim.order.clientDiscountAmt ?? 0),
            promoDiscount: Number(claim.order.promoDiscount ?? 0),
          };
          const enrichedItems = claim.orderItems.map((oi) => {
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
            totalRefundable += pricing.refundableAmount;
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
          });
          orderPanel = (
            <ClaimOrderItemsPanel
              role="admin"
              order={{
                id: claim.order.id,
                orderNumber: claim.order.orderNumber,
                createdAt: claim.order.createdAt.toISOString(),
                totalTTC: Number(claim.order.totalTTC),
                status: claim.order.status as "PENDING" | "SHIPPED" | "CANCELLED",
              }}
              items={enrichedItems}
            />
          );
        }
        return (
          <>
            {orderPanel}
            <ClientCreditPanel
              clientId={claim.user.id}
              clientName={clientSummary.company || `${clientSummary.firstName} ${clientSummary.lastName}`.trim() || clientSummary.email}
              claimReference={claim.reference}
              initialAvailable={creditContext.available}
              initialRecent={creditContext.recent}
              suggestedAmount={totalRefundable > 0 ? Math.round(totalRefundable * 100) / 100 : undefined}
            />
          </>
        );
      })()}

      <AdminClaimConversation
        claim={{
          id: claim.id,
          reference: claim.reference,
          subject: claim.subject,
          status: claim.status as "OPEN" | "CLOSED",
          createdAt: claim.createdAt.toISOString(),
        }}
        client={clientSummary}
        conversation={conversation}
        previousClaims={previousClaims.map((pc) => ({
          id: pc.id,
          reference: pc.reference,
          subject: pc.subject,
          status: pc.status as "OPEN" | "CLOSED",
          closedAt: pc.closedAt ? pc.closedAt.toISOString() : null,
          createdAt: pc.createdAt.toISOString(),
        }))}
        adminName={session.user.name ?? "Administrateur"}
      />
    </div>
  );
}
