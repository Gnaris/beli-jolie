import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadLegalPage } from "@/lib/legal-page";
import LegalPageClient from "@/components/legal/LegalPageClient";

export const metadata: Metadata = {
  title: "Politique de confidentialité — Beli & Jolie",
  description: "Politique de confidentialité et RGPD du site Beli & Jolie.",
};

export default async function ConfidentialitePage() {
  const data = await loadLegalPage("POLITIQUE_CONFIDENTIALITE");
  if (!data) notFound();

  return (
    <LegalPageClient
      title={data.title}
      content={data.content}
      updatedAt={data.updatedAt}
      pdfUrl="/api/legal/pdf?type=POLITIQUE_CONFIDENTIALITE"
    />
  );
}
