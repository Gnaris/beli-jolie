/**
 * Applique les 3 designs par défaut aux stades panier abandonné existants
 * d'un tenant (ou de tous). Idempotent : réécrit `subject` + `blocks` des
 * templates liés aux stades 1, 2, 3. Les stades >3 sont laissés tels quels.
 *
 * Le nom du template n'est PAS écrasé (la cliente a peut-être renommé).
 * Le stade 1 conserve son `scenarioKey = "ABANDONED_CART"` — c'est le
 * template « officiel » du scénario.
 *
 * Usage :
 *   npx tsx scripts/apply-abandoned-cart-designs.ts --tenant beliandjolie
 *   npx tsx scripts/apply-abandoned-cart-designs.ts --tenant beliandjolie --apply
 *   npx tsx scripts/apply-abandoned-cart-designs.ts --all --apply
 *
 * Sans `--apply` = dry-run : liste ce qui serait modifié sans écrire en base.
 * Sans `--tenant` ni `--all` = erreur (garde-fou multi-tenant).
 */

import { prisma } from "@/lib/prisma";
import { abandonedCartStageDefault } from "@/lib/mail-scenario-defaults";

function parseArgs(argv: string[]): {
  tenantSlug: string | null;
  all: boolean;
  apply: boolean;
} {
  let tenantSlug: string | null = null;
  let all = false;
  let apply = false;
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--all") all = true;
    else if (a === "--apply") apply = true;
    else if (a === "--tenant") {
      tenantSlug = argv[++i] ?? null;
    } else if (a.startsWith("--tenant=")) {
      tenantSlug = a.slice("--tenant=".length);
    }
  }
  return { tenantSlug, all, apply };
}

async function run() {
  const { tenantSlug, all, apply } = parseArgs(process.argv);
  if (!tenantSlug && !all) {
    console.error(
      "Usage : --tenant <slug>  OU  --all  (ajoute --apply pour écrire, sinon dry-run).",
    );
    process.exit(1);
  }

  const tenants = await prisma.tenant.findMany({
    where: tenantSlug ? { slug: tenantSlug } : undefined,
    select: { id: true, slug: true, name: true },
    orderBy: { slug: "asc" },
  });
  if (tenants.length === 0) {
    console.error(`Aucun tenant trouvé (slug=${tenantSlug ?? "*"}).`);
    process.exit(1);
  }

  console.log(
    `Mode : ${apply ? "APPLY (écriture)" : "DRY-RUN (aucune écriture)"}`,
  );
  console.log(`Tenants ciblés : ${tenants.map((t) => t.slug).join(", ")}\n`);

  for (const tenant of tenants) {
    const stages = await prisma.abandonedCartStage.findMany({
      where: { tenantId: tenant.id },
      orderBy: { stageIndex: "asc" },
      include: {
        template: {
          select: { id: true, name: true, subject: true },
        },
      },
    });

    if (stages.length === 0) {
      console.log(`[${tenant.slug}] aucun stade — skip.`);
      continue;
    }

    console.log(`[${tenant.slug}] ${stages.length} stade(s) trouvé(s) :`);

    for (const stage of stages) {
      if (stage.stageIndex > 3) {
        console.log(
          `  · Stade ${stage.stageIndex} (« ${stage.template.name} ») → laissé tel quel (design libre).`,
        );
        continue;
      }
      const def = abandonedCartStageDefault(stage.stageIndex);
      console.log(
        `  · Stade ${stage.stageIndex} (« ${stage.template.name} »)`,
      );
      console.log(`      subject actuel : « ${stage.template.subject} »`);
      console.log(`      subject nouveau : « ${def.subject} »`);
      console.log(`      blocs : ${def.blocks.length} bloc(s) posés`);

      if (apply) {
        await prisma.newsletterTemplate.update({
          where: { id: stage.template.id },
          data: {
            subject: def.subject,
            blocks: def.blocks as unknown as object,
          },
        });
        console.log("      ✔ écrit en base");
      }
    }
    console.log();
  }

  if (!apply) {
    console.log(
      "Dry-run terminé. Relance avec --apply pour écrire réellement en base.",
    );
  } else {
    console.log("Migration appliquée.");
  }
}

run()
  .catch((err) => {
    console.error("Erreur :", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
