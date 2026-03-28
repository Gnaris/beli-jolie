import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadLegalPage } from "@/lib/legal-page";
import LegalPageClient from "@/components/legal/LegalPageClient";
import { getCachedShopName } from "@/lib/cached-data";

export async function generateMetadata(): Promise<Metadata> {
  const shopName = await getCachedShopName();
  return {
    title: `Conditions Générales de Vente — ${shopName}`,
    description: `CGV du site ${shopName}, plateforme grossiste B2B.`,
  };
}

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
