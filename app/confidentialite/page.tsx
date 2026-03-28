import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadLegalPage } from "@/lib/legal-page";
import LegalPageClient from "@/components/legal/LegalPageClient";
import { getCachedShopName } from "@/lib/cached-data";

export async function generateMetadata(): Promise<Metadata> {
  const shopName = await getCachedShopName();
  return {
    title: `Politique de confidentialité — ${shopName}`,
    description: `Politique de confidentialité et RGPD du site ${shopName}.`,
  };
}

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
