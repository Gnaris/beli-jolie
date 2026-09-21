import { getServerSession } from "next-auth";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getAdminClaim, markMessagesReadByAdmin } from "@/app/actions/admin/claims";
import AdminClaimConversation from "./AdminClaimConversation";

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
  const [orderCount, orderAgg, previousClaims] = await Promise.all([
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
        href="/admin/reclamations"
        className="inline-flex items-center gap-1.5 text-sm text-text-muted hover:text-text-primary transition-colors"
      >
        ← Retour au Service Client
      </Link>

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
