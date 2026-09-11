/**
 * Purge des HTML stockés dans EmailSend pour les envois RÉUSSIS.
 *
 * Depuis 2026-09-11 les nouveaux envois SENT n'écrivent plus `htmlBody` en base
 * (la cliente retrouve le mail dans sa boîte pro Gmail via le forward).
 * Ce script libère l'espace déjà consommé par l'historique.
 *
 * Règle : SEUL le HTML des envois status="SENT" est effacé. Les FAILED
 * gardent leur contenu — utile pour comprendre pourquoi ça a échoué + pour
 * proposer le bouton « Renvoyer » depuis le journal admin.
 *
 * Usage :
 *   npx tsx scripts/purge-email-html-bodies.ts            # dry-run (compte + estime)
 *   npx tsx scripts/purge-email-html-bodies.ts --apply    # exécute la purge
 *
 * Idempotent : re-lançable sans dommage (skippe les rows déjà nettoyées).
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const apply = process.argv.includes("--apply");

  // Comptage préalable pour affichage — tous tenants confondus.
  const [totalSentWithHtml, totalFailedWithHtml, sample] = await Promise.all([
    prisma.emailSend.count({
      where: { status: "SENT", htmlBody: { not: null } },
    }),
    prisma.emailSend.count({
      where: { status: "FAILED", htmlBody: { not: null } },
    }),
    prisma.emailSend.findMany({
      where: { status: "SENT", htmlBody: { not: null } },
      select: { htmlBody: true },
      take: 20,
    }),
  ]);

  const avgHtmlKb =
    sample.length > 0
      ? Math.round(
          sample.reduce((s, r) => s + (r.htmlBody?.length ?? 0), 0) /
            sample.length /
            1024,
        )
      : 0;
  const estimatedMbFreed = Math.round((totalSentWithHtml * avgHtmlKb) / 1024);

  console.log("┌─ Purge EmailSend.htmlBody (envois réussis) ─");
  console.log(`│ Envois SENT avec HTML   : ${totalSentWithHtml.toLocaleString("fr-FR")}`);
  console.log(`│ Envois FAILED (gardés)  : ${totalFailedWithHtml.toLocaleString("fr-FR")}`);
  console.log(`│ Taille moyenne HTML     : ${avgHtmlKb} Ko (échantillon 20)`);
  console.log(`│ Estimation libéré       : ~${estimatedMbFreed} Mo`);
  console.log(`│ Mode                    : ${apply ? "APPLY" : "DRY-RUN"}`);
  console.log("└─────────────────────────────────────────────");

  if (!apply) {
    console.log("");
    console.log("→ Dry-run OK. Relance avec --apply pour purger réellement.");
    await prisma.$disconnect();
    return;
  }

  if (totalSentWithHtml === 0) {
    console.log("→ Rien à purger.");
    await prisma.$disconnect();
    return;
  }

  // Purge par batch pour ne pas locker la table trop longtemps.
  const BATCH = 500;
  let done = 0;
  while (true) {
    const batch = await prisma.emailSend.findMany({
      where: { status: "SENT", htmlBody: { not: null } },
      select: { id: true },
      take: BATCH,
    });
    if (batch.length === 0) break;
    await prisma.emailSend.updateMany({
      where: { id: { in: batch.map((r) => r.id) } },
      data: { htmlBody: null },
    });
    done += batch.length;
    console.log(`  … ${done.toLocaleString("fr-FR")} / ${totalSentWithHtml.toLocaleString("fr-FR")}`);
  }

  console.log(`✓ Purge terminée. ${done.toLocaleString("fr-FR")} rows nettoyées.`);
  console.log("  Note : espace disque libéré après OPTIMIZE TABLE EmailSend;");
  console.log("  (à lancer côté DBA quand la charge le permet).");

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("[purge-email-html-bodies] échec", err);
  process.exit(1);
});
