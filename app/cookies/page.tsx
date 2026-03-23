import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadLegalPage } from "@/lib/legal-page";
import LegalPageClient from "@/components/legal/LegalPageClient";

export const metadata: Metadata = {
  title: "Politique de cookies — Beli & Jolie",
  description: "Politique de cookies du site Beli & Jolie.",
};

export default async function CookiesPage() {
  const data = await loadLegalPage("COOKIES");
  if (!data) notFound();

  return (
    <LegalPageClient
      title={data.title}
      content={data.content}
      updatedAt={data.updatedAt}
      pdfUrl="/api/legal/pdf?type=COOKIES"
    />
  );
}
