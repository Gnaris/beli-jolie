/**
 * ONE-SHOT : répare une commande dont les totaux ont été faussés par le bug
 * de double-remise sur les articles ajoutés (compensation) — cf. correctif
 * `lib/order-totals.ts` du 2026-08-17.
 *
 * Ce que ça fait :
 *   1. Lit le PaymentIntent Stripe → retrouve le montant TTC réellement payé
 *   2. Pose `paidSubtotalHT` = (TTC / (1+TVA)) − port (snapshot du HT payé)
 *   3. Recalcule `subtotalHT` / `tvaAmount` / `totalTTC` avec la nouvelle
 *      formule (compensation items hors base de remise client)
 *
 * Usage sur le VPS :
 *   MULTI_TENANT_SCOPE=off npx tsx scripts/repair-order-comp-discount.ts ABC12345 --dry-run
 *   MULTI_TENANT_SCOPE=off npx tsx scripts/repair-order-comp-discount.ts ABC12345 --apply
 */

import { PrismaClient } from "@prisma/client";
import Stripe from "stripe";
import { decryptIfSensitive } from "@/lib/encryption";
import { recomputeOrderTotals } from "@/lib/order-totals";
import { config as loadEnv } from "dotenv";

loadEnv();

const prisma = new PrismaClient();

const [, , orderNumberArg, mode] = process.argv;
const APPLY = mode === "--apply";

if (!orderNumberArg) {
  console.error("Usage: repair-order-comp-discount.ts <orderNumber> [--apply]");
  process.exit(1);
}

async function run() {
  const order = await prisma.order.findFirst({
    where: { orderNumber: orderNumberArg },
    include: { items: true, itemModifications: true },
  });
  if (!order) throw new Error(`Commande ${orderNumberArg} introuvable`);

  console.log(`\n=== Commande ${order.orderNumber} (id=${order.id}) ===`);
  console.log(`Tenant : ${order.tenantId}`);
  console.log(`Statut : ${order.status}`);
  console.log(`\nÉtat actuel en BDD :`);
  console.log(`  subtotalHT      = ${order.subtotalHT}`);
  console.log(`  tvaAmount       = ${order.tvaAmount}`);
  console.log(`  totalTTC        = ${order.totalTTC}`);
  console.log(`  paidSubtotalHT  = ${order.paidSubtotalHT ?? "NULL"}`);
  console.log(`  carrierPrice    = ${order.carrierPrice}`);
  console.log(`  tvaRate         = ${order.tvaRate}`);
  console.log(`  discountType    = ${order.clientDiscountType ?? "aucun"}`);
  console.log(`  discountValue   = ${order.clientDiscountValue ?? "aucun"}`);
  console.log(`\nItems : ${order.items.length} (dont ${order.items.filter((i) => i.isCompensation).length} en compensation)`);

  // 1. Retrouver le montant réellement payé via Stripe
  if (!order.stripePaymentIntentId) {
    throw new Error("Pas de stripePaymentIntentId — impossible de retrouver le montant payé");
  }
  const cfg = await prisma.siteConfig.findFirst({
    where: { tenantId: order.tenantId, key: "stripe_secret_key" },
  });
  if (!cfg?.value) throw new Error("Clé Stripe absente en BDD pour ce tenant");
  const sk = decryptIfSensitive("stripe_secret_key", cfg.value).trim();
  const stripe = new Stripe(sk);
  const pi = await stripe.paymentIntents.retrieve(order.stripePaymentIntentId);
  const paidTTC = pi.amount / 100;
  const carrierPriceNum = Number(order.carrierPrice);
  const tvaRateNum = order.tvaRate;
  // TTC = (HT + port) × (1+TVA) → HT = TTC / (1+TVA) − port
  const paidSubtotalHT = paidTTC / (1 + tvaRateNum) - carrierPriceNum;

  console.log(`\nStripe PI ${order.stripePaymentIntentId} :`);
  console.log(`  Montant TTC payé = ${paidTTC.toFixed(2)} €`);
  console.log(`  → paidSubtotalHT reconstitué = ${paidSubtotalHT.toFixed(2)} €`);

  // 2. Recalculer les totaux avec la nouvelle formule
  const totals = recomputeOrderTotals({
    items: order.items.map((i) => ({
      lineTotal: Number(i.lineTotal),
      isCompensation: i.isCompensation,
    })),
    tvaRate: tvaRateNum,
    carrierPrice: carrierPriceNum,
    clientDiscountType: order.clientDiscountType,
    clientDiscountValue: order.clientDiscountValue
      ? Number(order.clientDiscountValue)
      : null,
  });

  console.log(`\nTotaux recalculés (nouvelle formule) :`);
  console.log(`  subtotalHT       = ${totals.subtotalHT.toFixed(2)} €`);
  console.log(`  clientDiscountAmt= ${totals.clientDiscountAmt.toFixed(2)} €`);
  console.log(`  tvaAmount        = ${totals.tvaAmount.toFixed(2)} €`);
  console.log(`  totalTTC         = ${totals.totalTTC.toFixed(2)} €`);

  // 3. Sanity check : si le nouveau totalTTC dépasse le paidTTC, alerte
  if (totals.totalTTC > paidTTC + 0.01) {
    console.log(
      `\n⚠  ATTENTION : nouveau totalTTC (${totals.totalTTC.toFixed(2)}) > payé (${paidTTC.toFixed(2)})`,
    );
    console.log(`   Différence : ${(totals.totalTTC - paidTTC).toFixed(2)} €`);
    console.log(`   Vérifier avant --apply.`);
  }

  if (!APPLY) {
    console.log(`\n[DRY-RUN] Rien modifié. Relance avec --apply pour appliquer.\n`);
    return;
  }

  await prisma.order.update({
    where: { id: order.id },
    data: {
      subtotalHT: totals.subtotalHT,
      tvaAmount: totals.tvaAmount,
      totalTTC: totals.totalTTC,
      clientDiscountAmt: totals.clientDiscountAmt,
      paidSubtotalHT,
    },
  });
  console.log(`\n✓ Commande ${order.orderNumber} mise à jour.\n`);
}

run()
  .catch((err) => {
    console.error("Erreur :", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
