/**
 * Diagnostic rapide de la file d'operations Ankorstore en BDD locale.
 *
 * Usage : npx tsx scripts/diag-ankorstore-queue.ts
 */
import "dotenv/config";
import { prisma } from "@/lib/prisma";

async function main() {
  const all = await prisma.ankorstoreOperation.groupBy({
    by: ["status"],
    _count: { _all: true },
  });
  console.log("Operations Ankorstore par statut :");
  for (const r of all) console.log("  " + r.status.padEnd(15) + " = " + r._count._all);

  const oldest = await prisma.ankorstoreOperation.findFirst({
    where: { status: "PENDING" },
    orderBy: { createdAt: "asc" },
    select: { id: true, type: true, createdAt: true, productId: true },
  });
  if (oldest) {
    const ageH = Math.round(((Date.now() - oldest.createdAt.getTime()) / 3600000) * 10) / 10;
    console.log(
      `Plus vieille PENDING : type=${oldest.type}  age=${ageH}h  produit=${oldest.productId}`,
    );
  }

  const recent = await prisma.ankorstoreOperation.findFirst({
    where: { callbackPayload: { not: undefined as unknown as null } },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true, status: true, type: true },
  });
  if (recent) {
    const ageM = Math.round((Date.now() - recent.createdAt.getTime()) / 60000);
    console.log(`Derniere operation avec callback : il y a ${ageM} min (statut: ${recent.status})`);
  } else {
    console.log("Aucun callback recu (callbackPayload est null partout)");
  }

  const last24h = await prisma.ankorstoreOperation.count({
    where: {
      createdAt: { gte: new Date(Date.now() - 24 * 3600 * 1000) },
      callbackPayload: { not: undefined as unknown as null },
    },
  });
  console.log(`Operations avec callback dans les 24 dernieres h : ${last24h}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
