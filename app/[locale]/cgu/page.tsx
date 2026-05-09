import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { loadLegalPage } from "@/lib/legal-page";
import LegalPageClient from "@/components/legal/LegalPageClient";
import { getCachedShopName } from "@/lib/cached-data";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const [shopName, tMeta] = await Promise.all([
    getCachedShopName(),
    getTranslations({ locale, namespace: "meta" }),
  ]);
  return {
    title: tMeta("cguTitle", { shopName }),
    description: tMeta("cguDescription", { shopName }),
  };
}

export default async function CGUPage() {
  const data = await loadLegalPage("CGU");
  if (!data) notFound();

  return (
    <LegalPageClient
      title={data.title}
      content={data.content}
      updatedAt={data.updatedAt}
      pdfUrl="/api/legal/pdf?type=CGU"
    />
  );
}
