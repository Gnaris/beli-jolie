/**
 * Restaure un stade de la relance panier abandonné pour la boutique
 * beliandjolie (des stades ont été supprimés accidentellement le 18/09/2026
 * via cascade FK depuis la liste des modèles newsletter).
 *
 * Recrée :
 *  - Un NewsletterTemplate avec le design par défaut du stade demandé
 *    (`abandonedCartStageDefault(stageIndex)`).
 *  - Un AbandonedCartStage avec le stageIndex et delaySeconds donnés,
 *    lié à ce template.
 *  - Recale `nextStageAt` des jobs PENDING dont currentStage = stageIndex-1
 *    (le prochain envoi pour eux est justement ce stade) au nouveau délai.
 *
 * Idempotent : refuse si un stade avec ce stageIndex existe déjà.
 *
 * Usage :
 *   npx tsx scripts/restore-beliandjolie-abandoned-cart-stage2.ts --stage 3 --days 6           # dry-run
 *   npx tsx scripts/restore-beliandjolie-abandoned-cart-stage2.ts --stage 3 --days 6 --apply   # écrit
 */

import { prisma } from "@/lib/prisma";
import { abandonedCartStageDefault } from "@/lib/mail-scenario-defaults";

const TENANT_ID_BELIANDJOLIE = "cmrhsmaim0000vld1q6b030mh";

function parseArgs(argv: string[]): { stageIndex: number; days: number; apply: boolean } {
  let stageIndex = 0;
  let days = 0;
  let apply = false;
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") apply = true;
    else if (a === "--stage") stageIndex = Number(argv[++i]);
    else if (a.startsWith("--stage=")) stageIndex = Number(a.slice("--stage=".length));
    else if (a === "--days") days = Number(argv[++i]);
    else if (a.startsWith("--days=")) days = Number(a.slice("--days=".length));
  }
  return { stageIndex, days, apply };
}

async function run() {
  const { stageIndex, days, apply } = parseArgs(process.argv);
  if (!Number.isInteger(stageIndex) || stageIndex < 2) {
    console.error("Usage : --stage <N ≥ 2> --days <D> [--apply]");
    process.exit(1);
  }
  if (!Number.isFinite(days) || days <= 0) {
    console.error("Le délai --days doit être > 0.");
    process.exit(1);
  }

  const delaySeconds = Math.round(days * 24 * 3600);

  const tenant = await prisma.tenant.findUnique({
    where: { id: TENANT_ID_BELIANDJOLIE },
    select: { id: true, slug: true, name: true },
  });
  if (!tenant) {
    console.error(`Tenant ${TENANT_ID_BELIANDJOLIE} introuvable.`);
    process.exit(1);
  }
  console.log(`Tenant cible : ${tenant.slug} (${tenant.name})`);
  console.log(`Mode : ${apply ? "APPLY (écriture)" : "DRY-RUN"}\n`);

  const existing = await prisma.abandonedCartStage.findMany({
    where: { tenantId: tenant.id },
    orderBy: { stageIndex: "asc" },
    select: { id: true, stageIndex: true, delaySeconds: true, templateId: true },
  });
  console.log(`Stades existants : ${existing.map((s) => `${s.stageIndex}(${(s.delaySeconds / 86400).toFixed(1)}j)`).join(", ") || "aucun"}\n`);

  if (existing.some((s) => s.stageIndex === stageIndex)) {
    console.error(`Un Stade ${stageIndex} existe déjà. Rien à faire.`);
    process.exit(1);
  }
  if (!existing.some((s) => s.stageIndex === stageIndex - 1)) {
    console.error(`Le Stade ${stageIndex - 1} doit exister avant d'ajouter le Stade ${stageIndex}.`);
    process.exit(1);
  }

  const def = abandonedCartStageDefault(stageIndex);
  console.log(`Stade ${stageIndex} à créer :`);
  console.log(`  · template name    : "Panier abandonné — Stade ${stageIndex}"`);
  console.log(`  · template subject : "${def.subject}"`);
  console.log(`  · nb blocs         : ${def.blocks.length}`);
  console.log(`  · delaySeconds     : ${delaySeconds}s (${days} jours)`);

  const pendingToReset = await prisma.abandonedCartJob.count({
    where: {
      tenantId: tenant.id,
      status: "PENDING",
      currentStage: stageIndex - 1,
    },
  });
  console.log(`\nJobs PENDING currentStage=${stageIndex - 1} (chronomètre à recaler) : ${pendingToReset}`);

  if (!apply) {
    console.log("\nDry-run terminé. Relance avec --apply pour écrire réellement en base.");
    return;
  }

  const now = new Date();
  const nextStageAt = new Date(now.getTime() + delaySeconds * 1000);

  const created = await prisma.$transaction(async (tx) => {
    const tpl = await tx.newsletterTemplate.create({
      data: {
        tenantId: tenant.id,
        name: `Panier abandonné — Stade ${stageIndex}`,
        subject: def.subject,
        blocks: def.blocks as unknown as object,
        scenarioKey: null,
      },
      select: { id: true },
    });
    const stage = await tx.abandonedCartStage.create({
      data: {
        tenantId: tenant.id,
        stageIndex,
        delaySeconds,
        templateId: tpl.id,
      },
      select: { id: true },
    });
    const reset = await tx.abandonedCartJob.updateMany({
      where: {
        tenantId: tenant.id,
        status: "PENDING",
        currentStage: stageIndex - 1,
      },
      data: {
        nextStageAt,
        lastEvaluatedAt: now,
      },
    });
    return { templateId: tpl.id, stageId: stage.id, resetCount: reset.count };
  });

  console.log(`\n✔ Stade ${stageIndex} restauré.`);
  console.log(`  · templateId  : ${created.templateId}`);
  console.log(`  · stageId     : ${created.stageId}`);
  console.log(`  · timers recalés (jobs currentStage=${stageIndex - 1}) : ${created.resetCount}`);
}

run()
  .catch((err) => {
    console.error("Erreur :", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
