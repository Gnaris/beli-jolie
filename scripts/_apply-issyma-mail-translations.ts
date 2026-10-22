/**
 * Applique le bundle de traductions produit par les sous-agents IA sur la
 * table `NewsletterTemplateLocale` pour le tenant `issyma`.
 *
 * Lit `/tmp/issyma-apply.json` (envoyé sur le VPS par scp).
 * Upsert idempotent sur la contrainte unique (templateId, locale).
 *
 *   MULTI_TENANT_SCOPE=off npx tsx scripts/_apply-issyma-mail-translations.ts
 *   MULTI_TENANT_SCOPE=off npx tsx scripts/_apply-issyma-mail-translations.ts --apply
 */
import { PrismaClient } from "@prisma/client";
import fs from "node:fs";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

interface Row {
  templateId: string;
  name: string;
  kind: string;
  locale: "en" | "de" | "es" | "it";
  subject: string;
  html: string;
  alreadyFilled: boolean;
}
interface Bundle { tenantSlug: string; rows: Row[] }

async function main() {
  const bundle: Bundle = JSON.parse(fs.readFileSync("/tmp/issyma-apply.json", "utf8"));
  const tenant = await prisma.tenant.findFirst({ where: { slug: bundle.tenantSlug }, select: { id: true, slug: true, name: true } });
  if (!tenant) {
    console.error(`Tenant '${bundle.tenantSlug}' introuvable.`);
    process.exit(1);
  }
  console.log(`Tenant: ${tenant.name} (${tenant.slug}) — id=${tenant.id}`);
  console.log(`Rows à upserter : ${bundle.rows.length} ${APPLY ? "" : "(DRY-RUN — pas d'écriture)"}`);

  const existing = await prisma.newsletterTemplateLocale.findMany({
    where: { tenantId: tenant.id },
    select: { templateId: true, locale: true },
  });
  const existingSet = new Set(existing.map((e) => `${e.templateId}::${e.locale}`));

  let created = 0;
  let updated = 0;

  for (const row of bundle.rows) {
    const key = `${row.templateId}::${row.locale}`;
    const willUpdate = existingSet.has(key);
    if (willUpdate) updated += 1;
    else created += 1;

    if (APPLY) {
      await prisma.newsletterTemplateLocale.upsert({
        where: { templateId_locale: { templateId: row.templateId, locale: row.locale } },
        update: { subject: row.subject, html: row.html },
        create: {
          tenantId: tenant.id,
          templateId: row.templateId,
          locale: row.locale,
          subject: row.subject,
          html: row.html,
        },
      });
    }
    console.log(`  ${APPLY ? "✓" : "·"} ${willUpdate ? "update" : "create"}  ${row.name.slice(0, 40).padEnd(40)}  ${row.locale.toUpperCase()}  subj="${row.subject.slice(0, 60)}"`);
  }

  console.log(`\n${APPLY ? "✓" : "DRY-RUN"} ${created} création(s), ${updated} mise(s) à jour.`);

  // Recompte final (seulement si APPLY, pour verif post-écriture)
  if (APPLY) {
    const after = await prisma.newsletterTemplateLocale.findMany({
      where: { tenantId: tenant.id },
      select: { templateId: true, locale: true, subject: true, html: true },
    });
    const filled = after.filter((a) => (a.html ?? "").trim().length > 0).length;
    const total = after.length;
    console.log(`\nAprès apply : ${total} ligne(s) NewsletterTemplateLocale pour issyma, dont ${filled} avec HTML non vide.`);
  }
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
