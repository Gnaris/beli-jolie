/**
 * Diagnostic rapide : liste les derniers StripeWebhookEvent enregistrés en BDD
 * pour voir si le webhook tombe bien côté serveur. S'il n'y a aucune ligne
 * récente, c'est que `stripe listen` ne forwarde pas vers localhost.
 *
 * Usage : npx tsx scripts/diagnose-webhook.ts [tenantSlug?]
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const slug = process.argv[2];
  const tenant = slug
    ? await prisma.tenant.findFirst({ where: { slug } })
    : (await prisma.tenant.findMany({ take: 1 }))[0];
  if (!tenant) {
    console.error("Aucun tenant trouvé.");
    process.exit(1);
  }
  console.log(`Tenant : ${tenant.slug} (${tenant.id})`);

  const rows = await prisma.$queryRawUnsafe<
    Array<{ eventId: string; type: string; createdAt: Date }>
  >(
    `SELECT eventId, type, createdAt
       FROM StripeWebhookEvent
      WHERE tenantId = ? OR tenantId IS NULL
      ORDER BY createdAt DESC
      LIMIT 20`,
    tenant.id,
  );

  if (rows.length === 0) {
    console.log(
      "⚠️  Aucun StripeWebhookEvent en BDD. Causes probables :\n" +
        "   1. `stripe listen --forward-to localhost:3000/api/payments/webhook` n'est pas lancé.\n" +
        "   2. Le `whsec_` saisi dans /admin/parametres ne correspond pas à celui de la CLI → signature refusée (400).\n" +
        "   3. Le serveur Next renvoie 500 avant d'enregistrer l'event (regarder le terminal `npm run dev`).",
    );
    await prisma.$disconnect();
    return;
  }

  console.log(`${rows.length} dernier(s) webhook(s) :`);
  for (const r of rows) {
    console.log(`  ${r.createdAt.toISOString()}  ${r.type.padEnd(32)}  ${r.eventId}`);
  }
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
