import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import Link from "next/link";
import AccessCodeDetail from "@/components/admin/access-codes/AccessCodeDetail";

export const metadata: Metadata = { title: "Détails du code d'accès" };

export default async function AccessCodeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const accessCode = await prisma.accessCode.findUnique({
    where: { id },
    include: {
      user: { select: { firstName: true, lastName: true, email: true, company: true } },
      views: {
        orderBy: { createdAt: "desc" },
        take: 100,
        include: {
          product: { select: { name: true, reference: true } },
        },
      },
    },
  });

  if (!accessCode) notFound();

  const data = {
    id: accessCode.id,
    code: accessCode.code,
    note: accessCode.note,
    isActive: accessCode.isActive,
    expiresAt: accessCode.expiresAt.toISOString(),
    createdAt: accessCode.createdAt.toISOString(),
    firstAccessAt: accessCode.firstAccessAt?.toISOString() ?? null,
    lastAccessAt: accessCode.lastAccessAt?.toISOString() ?? null,
    usedBy: accessCode.usedBy,
    usedByName: accessCode.usedByName,
    usedAt: accessCode.usedAt?.toISOString() ?? null,
    user: accessCode.user
      ? {
          firstName: accessCode.user.firstName,
          lastName: accessCode.user.lastName,
          email: accessCode.user.email,
          company: accessCode.user.company,
        }
      : null,
    views: accessCode.views.map((v) => ({
      id: v.id,
      pageUrl: v.pageUrl,
      productId: v.productId,
      productName: v.productName ?? v.product?.name ?? null,
      productRef: v.product?.reference ?? null,
      createdAt: v.createdAt.toISOString(),
    })),
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Link
          href="/admin/codes-acces"
          className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-bg-secondary transition-colors"
        >
          <svg className="w-4 h-4 text-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
        </Link>
        <div>
          <h1 className="page-title">Code {accessCode.code}</h1>
          <p className="page-subtitle">Détails et historique de navigation</p>
        </div>
      </div>

      <AccessCodeDetail data={data} />
    </div>
  );
}
