/**
 * Récupère les PaymentIntents Stripe récents pour Delphine Quinchon.
 * Sert à identifier lequel des 3 paiements réussis on va rattacher à la
 * commande recovery, et à connaître le montant exact facturé.
 *
 * Usage sur le VPS : `MULTI_TENANT_SCOPE=off npx tsx scripts/fetch-quinchon-pis.ts`
 */
import Stripe from "stripe";
import { PrismaClient } from "@prisma/client";
import { decryptIfSensitive } from "@/lib/encryption";
import { config as loadEnv } from "dotenv";

loadEnv();

const prisma = new PrismaClient();

const USER_ID = "cmr0l3vqs00het6oeqaiysv7f";
const EMAIL = "delphine.quinchon59@gmail.com";

async function main() {
  const tenant = await prisma.tenant.findFirst({ where: { slug: "beliandjolie" } });
  if (!tenant) throw new Error("Tenant beliandjolie introuvable");

  const row = await prisma.siteConfig.findFirst({
    where: { tenantId: tenant.id, key: "stripe_secret_key" },
  });
  if (!row?.value) throw new Error("Cle Stripe absente en BDD");
  const secretKey = decryptIfSensitive("stripe_secret_key", row.value).trim();
  const mode = secretKey.startsWith("sk_live_") ? "LIVE" : "TEST";
  console.log(`\nTenant : beliandjolie  |  Mode Stripe : ${mode}\n`);

  const stripe = new Stripe(secretKey);

  const since = Math.floor((Date.now() - 48 * 3600 * 1000) / 1000);
  const list = await stripe.paymentIntents.list({ limit: 100, created: { gte: since } });

  const mine = list.data.filter(
    (pi) => pi.metadata?.userId === USER_ID || pi.receipt_email === EMAIL,
  );

  for (const pi of mine) {
    console.log("─".repeat(60));
    console.log(`ID           : ${pi.id}`);
    console.log(`Status       : ${pi.status}`);
    console.log(`Amount       : ${(pi.amount / 100).toFixed(2)} EUR`);
    console.log(`Received     : ${(pi.amount_received / 100).toFixed(2)} EUR`);
    console.log(`Created      : ${new Date(pi.created * 1000).toISOString()}`);
    console.log(`Receipt mail : ${pi.receipt_email || "-"}`);
    console.log(`Metadata     : ${JSON.stringify(pi.metadata)}`);
    if (pi.latest_charge) {
      const chargeId =
        typeof pi.latest_charge === "string" ? pi.latest_charge : pi.latest_charge.id;
      try {
        const charge = await stripe.charges.retrieve(chargeId);
        console.log(
          `Charge       : ${charge.id}  refunded=${charge.refunded}  refundedAmount=${(
            charge.amount_refunded / 100
          ).toFixed(2)} EUR`,
        );
      } catch (err) {
        console.log(`Charge       : (retrieve failed) ${(err as Error).message}`);
      }
    }
  }

  console.log("─".repeat(60));
  console.log(`\nTotal : ${mine.length} PI(s) trouvés pour Quinchon (48h glissantes)\n`);
}

main()
  .catch((err) => {
    console.error("Erreur fatale :", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
