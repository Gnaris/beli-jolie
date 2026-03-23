import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import LegalDocumentsClient from "@/components/admin/legal/LegalDocumentsClient";

export const metadata: Metadata = { title: "Documents légaux — Beli & Jolie Admin" };

export default async function DocumentsLegauxPage() {
  const [documents, companyInfo] = await Promise.all([
    prisma.legalDocument.findMany({
      orderBy: { createdAt: "asc" },
      include: {
        _count: { select: { versions: true } },
      },
    }),
    prisma.companyInfo.findFirst(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Documents légaux</h1>
        <p className="page-subtitle">
          Gérez vos CGV, mentions légales, politique de confidentialité et autres documents obligatoires.
        </p>
      </div>

      <LegalDocumentsClient
        documents={JSON.parse(JSON.stringify(documents))}
        hasCompanyInfo={!!companyInfo}
      />
    </div>
  );
}
