import { getServerSession } from "next-auth";
import { redirect, Link } from "@/i18n/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getCachedShopName } from "@/lib/cached-data";
import ClaimForm from "@/components/client/claims/ClaimForm";
import { getLocale } from "next-intl/server";
import type { Metadata } from "next";

export async function generateMetadata(): Promise<Metadata> {
  const shopName = await getCachedShopName();
  return { title: `Nouvelle réclamation — ${shopName}` };
}

export default async function NewClaimPage({ searchParams }: { searchParams: Promise<{ order?: string }> }) {
  const session = await getServerSession(authOptions);
  const locale = await getLocale();
  if (!session) return redirect({href: "/connexion", locale});
  if (session.user.status !== "APPROVED") return redirect({href: "/espace-pro", locale});

  const { order: preselectedOrderId } = await searchParams;

  const orders = await prisma.order.findMany({
    where: {
      userId: session.user.id,
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
        <Link
          href="/espace-pro/reclamations"
          className="inline-flex items-center gap-1.5 text-sm text-text-muted hover:text-text-primary font-body transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Retour aux réclamations
        </Link>
        <h1 className="font-heading text-2xl font-bold text-text-primary mt-3">Nouvelle réclamation</h1>
        <p className="text-sm text-text-muted font-body mt-1">
          Décrivez votre problème et notre équipe vous répondra dans les plus brefs délais.
        </p>
      </div>
      <ClaimForm orders={orders} preselectedOrderId={preselectedOrderId} />
    </div>
  );
}
