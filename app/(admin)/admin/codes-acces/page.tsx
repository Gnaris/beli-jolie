import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import AccessCodesManager from "@/components/admin/access-codes/AccessCodesManager";

export const metadata: Metadata = { title: "Codes d'accès invité" };

export default async function CodesAccesPage() {
  const codes = await prisma.accessCode.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { views: true } },
      user: { select: { firstName: true, lastName: true, email: true, company: true } },
    },
  });

  const items = codes.map((c) => ({
    id: c.id,
    code: c.code,
    note: c.note,
    isActive: c.isActive,
    expiresAt: c.expiresAt.toISOString(),
    createdAt: c.createdAt.toISOString(),
    firstAccessAt: c.firstAccessAt?.toISOString() ?? null,
    lastAccessAt: c.lastAccessAt?.toISOString() ?? null,
    usedBy: c.usedBy,
    usedByName: c.usedByName,
    usedAt: c.usedAt?.toISOString() ?? null,
    viewCount: c._count.views,
    user: c.user
      ? {
          firstName: c.user.firstName,
          lastName: c.user.lastName,
          email: c.user.email,
          company: c.user.company,
        }
      : null,
  }));

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="page-title">Codes d&apos;accès invité</h1>
        <p className="page-subtitle">
          Créez des codes pour inviter des prospects à naviguer sur le site avant inscription.
        </p>
      </div>

      <AccessCodesManager initialCodes={items} />
    </div>
  );
}
