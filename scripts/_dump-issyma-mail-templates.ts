/**
 * Dump FR source + état des locales pour chaque NewsletterTemplate du tenant
 * `issyma` au format JSON sur stdout. Alimente la pipeline de traduction par
 * sous-agents IA (côté machine locale).
 *
 *   MULTI_TENANT_SCOPE=off npx tsx scripts/_dump-issyma-mail-templates.ts > issyma-mail-templates.json
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const tenant = await prisma.tenant.findFirst({ where: { slug: "issyma" }, select: { id: true, slug: true } });
  if (!tenant) {
    console.error("Tenant 'issyma' introuvable.");
    process.exit(1);
  }
  const templates = await prisma.newsletterTemplate.findMany({
    where: { tenantId: tenant.id },
    include: {
      locales: { select: { locale: true, subject: true, html: true } },
    },
  });

  const abandoned = await prisma.abandonedCartStage.findMany({
    where: { tenantId: tenant.id },
    select: { templateId: true, stageIndex: true },
  });
  const inactive = await prisma.inactiveClientStage.findMany({
    where: { tenantId: tenant.id },
    select: { templateId: true, stageIndex: true },
  });
  const kindOf = new Map<string, string>();
  for (const s of abandoned) kindOf.set(s.templateId, `abandoned_cart_stage_${s.stageIndex}`);
  for (const s of inactive) kindOf.set(s.templateId, `inactive_client_stage_${s.stageIndex}`);

  const out = {
    tenantId: tenant.id,
    tenantSlug: tenant.slug,
    templates: templates.map((t) => ({
      id: t.id,
      name: t.name,
      scenarioKey: t.scenarioKey,
      kind: t.scenarioKey ?? kindOf.get(t.id) ?? "free",
      fr: { subject: t.subject, html: t.html ?? "" },
      locales: Object.fromEntries(
        (["en", "de", "es", "it"] as const).map((loc) => {
          const l = t.locales.find((x) => x.locale === loc);
          const filled = !!(l?.html && l.html.trim().length > 0);
          return [loc, { filled, subject: l?.subject ?? null, htmlLength: l?.html?.length ?? 0 }];
        }),
      ),
    })),
  };
  console.log(JSON.stringify(out, null, 2));
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
