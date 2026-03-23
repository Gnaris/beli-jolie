import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadLegalPage } from "@/lib/legal-page";
import LegalPageClient from "@/components/legal/LegalPageClient";

export const metadata: Metadata = {
  title: "Conditions Générales de Vente — Beli & Jolie",
  description: "CGV du site Beli & Jolie, grossiste B2B en bijoux en acier inoxydable.",
};

export default async function CGVPage() {
  const data = await loadLegalPage("CGV");
  if (!data) notFound();

  return (
    <LegalPageClient
      title={data.title}
      content={data.content}
      updatedAt={data.updatedAt}
      pdfUrl="/api/legal/pdf?type=CGV"
    />
  );
}
