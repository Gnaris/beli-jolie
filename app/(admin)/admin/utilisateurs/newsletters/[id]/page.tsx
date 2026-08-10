import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { redirect, notFound } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { getNewsletterTemplate } from "@/app/actions/admin/newsletter-templates";
import NewsletterEditorClient from "@/components/admin/users/NewsletterEditorClient";

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

  return <NewsletterEditorClient template={template} />;
}
