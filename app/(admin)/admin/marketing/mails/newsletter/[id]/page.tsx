import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { redirect, notFound } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { getNewsletterTemplate } from "@/app/actions/admin/newsletter-templates";
import NewsletterHtmlEditorClient from "@/components/admin/newsletter/NewsletterHtmlEditorClient";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Éditeur newsletter — Admin" };

export default async function NewsletterEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") redirect("/connexion");

  const { id } = await params;
  const template = await getNewsletterTemplate(id);
  if (!template) notFound();

  // Depuis 2026-09-22 : tous les modèles s'éditent en HTML (auto-migration
  // inline dans getNewsletterTemplate pour les rares templates encore en
  // blocks). Plus qu'un seul éditeur, plus de branche.
  return <NewsletterHtmlEditorClient template={template} backUrl="/admin/marketing/mails" />;
}
