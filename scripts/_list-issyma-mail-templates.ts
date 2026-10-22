/**
 * Liste tous les modèles de mail du tenant `issyma` et affiche pour chacun
 * quelles langues (EN/DE/ES/IT) sont déjà remplies et lesquelles manquent.
 * Lecture seule — sert à préparer la traduction par sous-agents IA.
 *
 *   MULTI_TENANT_SCOPE=off npx tsx scripts/_list-issyma-mail-templates.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const tenant = await prisma.tenant.findFirst({
    where: { slug: "issyma" },
    select: { id: true, name: true, slug: true },
  });
  if (!tenant) {
    console.error("Tenant 'issyma' introuvable.");
    process.exit(1);
  }
  console.log(`Tenant: ${tenant.name} (${tenant.slug}) — id=${tenant.id}\n`);

  const templates = await prisma.newsletterTemplate.findMany({
    where: { tenantId: tenant.id },
    orderBy: [{ scenarioKey: "asc" }, { name: "asc" }],
    include: {
      locales: {
        select: { locale: true, subject: true, html: true },
      },
    },
  });

  const abandonedStages = await prisma.abandonedCartStage.findMany({
    where: { tenantId: tenant.id },
    select: { templateId: true, stageIndex: true },
  });
  const inactiveStages = await prisma.inactiveClientStage.findMany({
    where: { tenantId: tenant.id },
    select: { templateId: true, stageIndex: true },
  });
  const stageLabel = new Map<string, string>();
  for (const s of abandonedStages) stageLabel.set(s.templateId, `AbandonedCart stage ${s.stageIndex}`);
  for (const s of inactiveStages) stageLabel.set(s.templateId, `InactiveClient stage ${s.stageIndex}`);

  console.log(`${templates.length} modèle(s) de mail pour issyma :\n`);
  const TARGETS = ["en", "de", "es", "it"] as const;
  let totalMissing = 0;

  for (const t of templates) {
    const sizeHtml = (t.html ?? "").length;
    const kind = t.scenarioKey
      ? `[${t.scenarioKey}]`
      : stageLabel.has(t.id)
        ? `[${stageLabel.get(t.id)}]`
        : "[libre]";
    console.log(`\n  ${kind}  ${t.name}  (id=${t.id})`);
    console.log(`    FR  sujet="${t.subject}"  html=${sizeHtml} chars`);
    for (const loc of TARGETS) {
      const l = t.locales.find((x) => x.locale === loc);
      const htmlFilled = (l?.html ?? "").trim().length > 0;
      const subjFilled = (l?.subject ?? "").trim().length > 0;
      if (!l || (!htmlFilled && !subjFilled)) {
        console.log(`    ${loc.toUpperCase()}  ⚠ VIDE`);
        totalMissing += 1;
      } else if (!htmlFilled) {
        console.log(`    ${loc.toUpperCase()}  ⚠ HTML VIDE (sujet seul)`);
        totalMissing += 1;
      } else {
        console.log(`    ${loc.toUpperCase()}  ✓ sujet="${l.subject}"  html=${l.html?.length ?? 0} chars`);
      }
    }
  }

  console.log(`\n→ ${totalMissing} couple(s) (modèle, langue) à traduire sur un max de ${templates.length * TARGETS.length}.`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
