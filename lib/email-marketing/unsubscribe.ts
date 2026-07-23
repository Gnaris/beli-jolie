/**
 * lib/email-marketing/unsubscribe.ts
 *
 * Vérifie si une adresse est désabonnée d'un scope donné, et écrit une
 * nouvelle désinscription (idempotent).
 *
 * MARKETING_ALL est un super-scope : s'il est présent, tous les autres
 * scopes sont considérés désinscrits eux aussi.
 */
import { prisma } from "@/lib/prisma";
import type { EmailUnsubscribeScope } from "@prisma/client";

export async function isUnsubscribed(
  tenantId: string,
  email: string,
  scope: EmailUnsubscribeScope,
): Promise<boolean> {
  const normalized = email.toLowerCase().trim();
  const rows = await prisma.emailUnsubscribe.findMany({
    where: {
      tenantId,
      email: normalized,
      scope: { in: [scope, "MARKETING_ALL"] },
    },
    select: { scope: true },
  });
  return rows.length > 0;
}

export async function addUnsubscribe(
  tenantId: string,
  email: string,
  scope: EmailUnsubscribeScope,
): Promise<void> {
  const normalized = email.toLowerCase().trim();
  await prisma.emailUnsubscribe.upsert({
    where: {
      tenantId_email_scope: { tenantId, email: normalized, scope },
    },
    create: { tenantId, email: normalized, scope },
    update: {},
  });
}

export async function removeUnsubscribe(
  tenantId: string,
  email: string,
  scope: EmailUnsubscribeScope,
): Promise<void> {
  const normalized = email.toLowerCase().trim();
  await prisma.emailUnsubscribe.deleteMany({
    where: { tenantId, email: normalized, scope },
  });
}
