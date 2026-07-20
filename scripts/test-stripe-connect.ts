/**
 * Test one-shot : l'accès à Stripe Connect est-il débloqué sur le compte BJ ?
 *
 * 1. Lit `stripe_secret_key` du tenant `beliandjolie` en BDD (déchiffré).
 * 2. `accounts.list({ limit: 1 })` — lecture pure, aucun effet de bord.
 * 3. Si (2) passe, tente `accounts.create({ type: 'express' })` puis supprime
 *    immédiatement le compte de test.
 *
 * Usage : `MULTI_TENANT_SCOPE=off npx tsx scripts/test-stripe-connect.ts`
 */

import Stripe from "stripe";
import { PrismaClient } from "@prisma/client";
import { decryptIfSensitive } from "@/lib/encryption";
import { config as loadEnv } from "dotenv";

loadEnv();

const prisma = new PrismaClient();

async function main() {
  const tenantSlug = process.argv[2] || "beli-jolie";

  let secretKey: string | null = null;
  const tenant = await prisma.tenant.findFirst({ where: { slug: tenantSlug } });
  if (tenant) {
    const row = await prisma.siteConfig.findFirst({
      where: { tenantId: tenant.id, key: "stripe_secret_key" },
    });
    if (row?.value) secretKey = decryptIfSensitive("stripe_secret_key", row.value).trim();
  }
  if (!secretKey) {
    secretKey = process.env.STRIPE_SECRET_KEY?.trim() || null;
    if (secretKey) console.log("(clé lue depuis .env, aucune SiteConfig)");
  }
  if (!secretKey) throw new Error("Aucune STRIPE_SECRET_KEY (BDD ni .env)");
  const mode = secretKey.startsWith("sk_live_") ? "LIVE" : secretKey.startsWith("sk_test_") ? "TEST" : "??";
  console.log(`\nTenant : ${tenantSlug}  |  Mode : ${mode}\n`);

  const stripe = new Stripe(secretKey);

  // Étape 1 — lecture pure
  console.log("[1/2] accounts.list({ limit: 1 })…");
  try {
    const list = await stripe.accounts.list({ limit: 1 });
    console.log(`  ✓ Connect en lecture OK. Comptes déjà connectés : ${list.data.length}\n`);
  } catch (err) {
    const e = err as Stripe.errors.StripeError;
    console.log(`  ✗ Connect ENCORE BLOQUÉ.`);
    console.log(`    type    : ${e.type}`);
    console.log(`    code    : ${e.code || "-"}`);
    console.log(`    message : ${e.message}\n`);
    process.exit(1);
  }

  // Étape 2 — création + delete immédiat
  console.log("[2/2] accounts.create({ type: 'express' }) puis delete…");
  let createdId: string | null = null;
  try {
    const acct = await stripe.accounts.create({
      type: "express",
      country: "FR",
      email: `connect-test-${Date.now()}@beliandjolie.com`,
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
    });
    createdId = acct.id;
    console.log(`  ✓ Compte Express créé : ${acct.id}`);
  } catch (err) {
    const e = err as Stripe.errors.StripeError;
    console.log(`  ✗ Création REFUSÉE.`);
    console.log(`    type    : ${e.type}`);
    console.log(`    code    : ${e.code || "-"}`);
    console.log(`    message : ${e.message}\n`);
    process.exit(1);
  }

  if (createdId) {
    try {
      await stripe.accounts.del(createdId);
      console.log(`  ✓ Compte de test supprimé.\n`);
    } catch (err) {
      const e = err as Stripe.errors.StripeError;
      console.log(`  ⚠  Compte créé mais suppression échouée. ID à nettoyer manuellement : ${createdId}`);
      console.log(`    ${e.message}\n`);
    }
  }

  console.log("=== RÉSULTAT : Stripe Connect est DÉBLOQUÉ sur ce compte ===\n");
}

main()
  .catch((e) => {
    console.error("Erreur fatale :", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
