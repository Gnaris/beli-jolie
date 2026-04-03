import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import ClaimForm from "@/components/client/claims/ClaimForm";

export const metadata = { title: "Nouvelle reclamation" };

export default async function NewClaimPage({ searchParams }: { searchParams: Promise<{ order?: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "CLIENT") redirect("/connexion");

  const { order: preselectedOrderId } = await searchParams;

  const orders = await prisma.order.findMany({
    where: {
      userId: session.user.id,
      status: { in: ["SHIPPED", "DELIVERED"] },
    },
    select: {
      id: true,
      orderNumber: true,
      items: {
        select: { id: true, productName: true, quantity: true },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <Link href="/espace-pro/reclamations" className="text-sm text-text-muted hover:text-text-primary font-body transition-colors">
          &larr; Retour aux reclamations
        </Link>
        <h1 className="font-heading text-2xl font-bold text-text-primary mt-2">Nouvelle reclamation</h1>
      </div>
      <ClaimForm orders={orders} preselectedOrderId={preselectedOrderId} />
    </div>
  );
}
