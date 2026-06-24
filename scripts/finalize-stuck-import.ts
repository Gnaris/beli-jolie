/**
 * Débloque un ImportJob d'images resté en UPLOADING/PROCESSING parce que la
 * requête finalize a été interrompue côté client (HTTP 499 / page fermée).
 *
 * Réutilise finalizeImageImport — créé le brouillon d'erreurs, pose les flags
 * marketplaces et passe le job en COMPLETED, exactement comme l'aurait fait
 * la route HTTP si elle n'avait pas été interrompue.
 *
 * Usage : npx tsx scripts/finalize-stuck-import.ts <jobId>
 */
import { prisma } from "@/lib/prisma";
import { finalizeImageImport } from "@/lib/import-processor";

async function main() {
  const jobId = process.argv[2];
  if (!jobId) {
    console.error("Usage: npx tsx scripts/finalize-stuck-import.ts <jobId>");
    process.exit(1);
  }

  const job = await prisma.importJob.findUnique({ where: { id: jobId } });
  if (!job) {
    console.error(`Job ${jobId} introuvable.`);
    process.exit(1);
  }
  if (job.type !== "IMAGES") {
    console.error(`Job ${jobId} n'est pas un import d'images (type=${job.type}).`);
    process.exit(1);
  }
  if (job.status === "COMPLETED") {
    console.log(`Job ${jobId} déjà COMPLETED — rien à faire.`);
    process.exit(0);
  }
  if (job.status !== "UPLOADING" && job.status !== "PROCESSING") {
    console.error(`Job ${jobId} a le statut ${job.status} — non débloquable.`);
    process.exit(1);
  }

  console.log(`Débloque le job ${jobId} (status=${job.status}, total=${job.totalItems}, success=${job.successItems}, errors=${job.errorItems})...`);

  if (job.status === "UPLOADING") {
    await prisma.importJob.update({ where: { id: jobId }, data: { status: "PROCESSING" } });
  }

  await finalizeImageImport(jobId);

  const after = await prisma.importJob.findUnique({ where: { id: jobId } });
  console.log(`Job ${jobId} → status=${after?.status}, success=${after?.successItems}, errors=${after?.errorItems}, errorDraftId=${after?.errorDraftId ?? "(aucun)"}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
