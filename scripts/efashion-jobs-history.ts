import { prisma } from "@/lib/prisma";

async function main() {
  // Recent eFashion jobs for E140C
  const product = await prisma.product.findFirst({
    where: { reference: "E140C" },
    select: { id: true, efashionLastRefreshedAt: true },
  });
  if (!product) throw new Error("E140C introuvable");

  console.log(`Produit E140C — id local = ${product.id}`);
  console.log(`efashionLastRefreshedAt = ${product.efashionLastRefreshedAt}\n`);

  const jobs = await prisma.marketplaceRefreshJob.findMany({
    where: { productId: product.id, marketplace: "EFASHION" },
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  console.log(`${jobs.length} jobs eFashion les plus récents :\n`);
  for (const j of jobs) {
    console.log(`  id=${j.id}  status=${j.status}  mode=${j.mode}`);
    console.log(`    createdAt   = ${j.createdAt}`);
    console.log(`    startedAt   = ${j.startedAt}`);
    console.log(`    completedAt = ${j.completedAt}`);
    console.log(`    payload     = ${JSON.stringify(j.payload)}`);
    console.log(`    errorMsg    = ${j.errorMessage ?? "(aucun)"}`);
    console.log(`    efOutcome   = ${JSON.stringify(j.efashionOutcome)}`);
    console.log("");
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
