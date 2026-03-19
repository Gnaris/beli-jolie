import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect, notFound } from "next/navigation";
import DraftProductsViewer from "@/components/admin/products/import/DraftProductsViewer";
import DraftImagesViewer from "@/components/admin/products/import/DraftImagesViewer";
import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Brouillon d'importation" };

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function BrouillonPage({ params }: PageProps) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") redirect("/connexion");

  const { id } = await params;
  const draft = await prisma.importDraft.findUnique({ where: { id } });

  if (!draft || draft.adminId !== session.user.id) notFound();

  const rows = draft.rows as Record<string, unknown>[];

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/admin/produits/importer" className="text-[#666] hover:text-[#1A1A1A] text-sm">
          ← Retour à l'importation
        </Link>
      </div>

      <div className="flex items-start justify-between">
        <div>
          <h1 className="page-title">Brouillon — Erreurs d'importation</h1>
          <p className="page-subtitle font-[family-name:var(--font-roboto)]">
            Fichier : <strong>{draft.filename ?? "—"}</strong> · {draft.successRows} importé(s) · {draft.errorRows} erreur(s)
          </p>
        </div>
        <span
          className={`badge-${draft.status === "RESOLVED" ? "success" : "warning"} self-start`}
        >
          {draft.status === "RESOLVED" ? "Résolu" : "En attente"}
        </span>
      </div>

      {draft.status === "RESOLVED" ? (
        <div className="bg-green-50 border border-green-200 rounded-2xl p-6 text-center">
          <p className="text-green-700 font-medium">✓ Toutes les erreurs ont été corrigées.</p>
          <Link href="/admin/produits" className="btn-primary mt-4 inline-block text-sm">
            Voir les produits
          </Link>
        </div>
      ) : draft.type === "PRODUCTS" ? (
        <DraftProductsViewer draftId={id} initialRows={rows} successCount={draft.successRows} totalCount={draft.totalRows} />
      ) : (
        <DraftImagesViewer draftId={id} initialRows={rows} successCount={draft.successRows} totalCount={draft.totalRows} />
      )}
    </div>
  );
}
