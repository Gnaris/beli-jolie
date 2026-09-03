import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { redirect, notFound } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { getNewsletterTemplate } from "@/app/actions/admin/newsletter-templates";
import NewsletterEditorClient from "@/components/admin/users/NewsletterEditorClient";
import { readMailBrandingForTenant } from "@/lib/mail-branding";
import { requireCurrentTenant } from "@/lib/tenant";
import { getCachedShopName } from "@/lib/cached-data";
import { getCurrentTenantBaseUrl } from "@/lib/tenant-url";
import { prisma } from "@/lib/prisma";

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

  const tenant = await requireCurrentTenant();
  const [branding, shopName, baseUrl, companyInfo] = await Promise.all([
    readMailBrandingForTenant(tenant.id),
    getCachedShopName(),
    getCurrentTenantBaseUrl(),
    prisma.companyInfo.findFirst({
      where: { tenantId: tenant.id },
      select: { shopName: true, name: true, address: true, postalCode: true, city: true },
    }),
  ]);
  const legalDisplayName = companyInfo?.shopName?.trim() || companyInfo?.name?.trim() || shopName;
  const legalAddress = companyInfo
    ? [companyInfo.address, [companyInfo.postalCode, companyInfo.city].filter(Boolean).join(" ")]
        .filter(Boolean)
        .join(", ")
    : "";
  const legalLine = [legalDisplayName, legalAddress].filter(Boolean).join(" · ");

  return (
    <NewsletterEditorClient
      template={template}
      branding={branding}
      shopName={shopName}
      baseUrl={baseUrl}
      legalLine={legalLine}
    />
  );
}
