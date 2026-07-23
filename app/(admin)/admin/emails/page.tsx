import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth-helpers";
import {
  getAbandonedCartConfig,
  getOrCreateScenario,
} from "@/lib/email-marketing/scenarios";
import {
  getPendingRestockList,
  getPendingRestockSummary,
} from "@/lib/email-marketing/back-in-stock";
import EmailsClient from "@/components/admin/emails/EmailsClient";

export const metadata: Metadata = {
  title: "Emails automatiques",
};

export const dynamic = "force-dynamic";

export default async function AdminEmailsPage() {
  const { tenant } = await requireAdmin();

  const [
    abandonedCart,
    backInStockScenario,
    backInStockSummary,
    backInStockPendingProducts,
    welcomeScenario,
    newsletterScenario,
    recentSends,
    stats30d,
  ] = await Promise.all([
    getAbandonedCartConfig(tenant.id),
    getOrCreateScenario(tenant.id, "BACK_IN_STOCK"),
    getPendingRestockSummary(tenant.id),
    getPendingRestockList(tenant.id),
    getOrCreateScenario(tenant.id, "WELCOME"),
    getOrCreateScenario(tenant.id, "NEWSLETTER"),
    prisma.emailSend.findMany({
      where: { tenantId: tenant.id },
      orderBy: { sentAt: "desc" },
      take: 30,
      select: {
        id: true,
        scenarioKey: true,
        recipientEmail: true,
        subject: true,
        sentAt: true,
        openedAt: true,
        clickedAt: true,
        metadata: true,
      },
    }),
    computeStats30d(tenant.id),
  ]);

  // Nombre de clients approved (audience newsletter)
  const audienceCount = await prisma.user.count({
    where: {
      tenantId: tenant.id,
      status: "APPROVED",
      role: "CLIENT",
      email: { not: "" },
    },
  });

  return (
    <EmailsClient
      scenarios={{
        abandonedCart: {
          enabled: abandonedCart.enabled,
          reminders: abandonedCart.config.reminders,
        },
        backInStock: {
          enabled: backInStockScenario.enabled,
          pendingSummary: backInStockSummary,
          pendingProducts: backInStockPendingProducts,
        },
        welcome: { enabled: welcomeScenario.enabled },
        newsletter: { enabled: newsletterScenario.enabled },
      }}
      audienceCount={audienceCount}
      recentSends={recentSends.map((s) => ({
        id: s.id,
        scenarioKey: s.scenarioKey,
        recipientEmail: s.recipientEmail,
        subject: s.subject,
        sentAt: s.sentAt.toISOString(),
        openedAt: s.openedAt?.toISOString() ?? null,
        clickedAt: s.clickedAt?.toISOString() ?? null,
      }))}
      stats30d={stats30d}
    />
  );
}

async function computeStats30d(tenantId: string) {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const rows = await prisma.emailSend.findMany({
    where: { tenantId, sentAt: { gte: since } },
    select: { openedAt: true, clickedAt: true, scenarioKey: true },
  });
  const sent = rows.length;
  const opened = rows.filter((r) => r.openedAt).length;
  const clicked = rows.filter((r) => r.clickedAt).length;
  const byScenario: Record<string, number> = {};
  for (const r of rows) {
    byScenario[r.scenarioKey] = (byScenario[r.scenarioKey] ?? 0) + 1;
  }
  return { sent, opened, clicked, byScenario };
}
