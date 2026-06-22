import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { notFound, redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import ImportJobDetailClient, {
  type ImportJobDetailData,
} from "@/components/admin/products/import/ImportJobDetailClient";

export const metadata: Metadata = {
  title: "Détail d'import",
};

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function ImportJobDetailPage({ params }: PageProps) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") redirect("/connexion");

  const { id } = await params;

  const job = await prisma.importJob.findUnique({ where: { id } });
  if (!job || job.adminId !== session.user.id) notFound();

  const data: ImportJobDetailData = {
    id: job.id,
    type: job.type as "PRODUCTS" | "IMAGES",
    status: job.status,
    filename: job.filename,
    totalItems: job.totalItems,
    processedItems: job.processedItems,
    successItems: job.successItems,
    errorItems: job.errorItems,
    errorMessage: job.errorMessage,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
    resultDetails: (job.resultDetails ?? null) as ImportJobDetailData["resultDetails"],
  };

  return <ImportJobDetailClient data={data} />;
}
