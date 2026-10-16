/**
 * Backfill : crée un OrderPayment INITIAL pour chaque Order existante qui n'en
 * a pas encore. Déduit la méthode depuis `paymentMode`, le status depuis
 * `paymentStatus`, et le montant depuis `paidSubtotalHT` + port + TVA (ou
 * `subtotalHT` en fallback pour les anciennes commandes sans snapshot).
 *
 * Usage :
 *   npx tsx scripts/backfill-order-payments.ts --dry-run
 *   npx tsx scripts/backfill-order-payments.ts --apply
 */
import { PrismaClient } from "@prisma/client";
import { roundCent } from "../lib/money";

const prisma = new PrismaClient();

type Method = "CARD" | "STRIPE_LINK" | "BANK_TRANSFER" | "PAY_ON_PICKUP" | "CREDIT";
type Status = "PENDING" | "PAID" | "CANCELLED";

function mapMethod(paymentMode: string | null): Method {
  switch (paymentMode) {
    case "BANK_TRANSFER":
      return "BANK_TRANSFER";
    case "STRIPE_LINK":
      return "STRIPE_LINK";
    case "PAY_ON_PICKUP":
      return "PAY_ON_PICKUP";
    case "CREDIT":
      return "CREDIT";
    case "CARD":
    default:
      return "CARD";
  }
}

function mapStatus(paymentStatus: string | null): Status {
  if (paymentStatus === "paid") return "PAID";
  if (paymentStatus === "failed") return "CANCELLED";
  return "PENDING";
}

async function main() {
  const apply = process.argv.includes("--apply");
  const dryRun = process.argv.includes("--dry-run") || !apply;

  console.log(`[backfill-order-payments] mode = ${dryRun ? "DRY-RUN" : "APPLY"}`);

  // On force la lecture inter-tenants : ce script tourne hors ALS.
  const orders = await prisma.$queryRawUnsafe<
    Array<{
      id: string;
      tenantId: string | null;
      paymentMode: string | null;
      paymentStatus: string | null;
      paidSubtotalHT: string | null;
      subtotalHT: string;
      carrierPrice: string;
      tvaRate: number;
      stripePaymentIntentId: string | null;
      stripeCheckoutSessionId: string | null;
      stripeCheckoutSessionUrl: string | null;
      stripeCheckoutSessionExpiresAt: Date | null;
      bankTransferConfirmedAt: Date | null;
      bankTransferConfirmedBy: string | null;
      createdAt: Date;
      updatedAt: Date;
    }>
  >(`
    SELECT o.id, o.tenantId, o.paymentMode, o.paymentStatus,
           o.paidSubtotalHT, o.subtotalHT, o.carrierPrice, o.tvaRate,
           o.stripePaymentIntentId, o.stripeCheckoutSessionId,
           o.stripeCheckoutSessionUrl, o.stripeCheckoutSessionExpiresAt,
           o.bankTransferConfirmedAt, o.bankTransferConfirmedBy,
           o.createdAt, o.updatedAt
    FROM \`Order\` o
    LEFT JOIN OrderPayment op ON op.orderId = o.id AND op.kind = 'INITIAL'
    WHERE op.id IS NULL
  `);

  console.log(`[backfill-order-payments] ${orders.length} commande(s) à backfiller`);

  let created = 0;
  for (const o of orders) {
    const paidHT = Number(o.paidSubtotalHT ?? o.subtotalHT);
    const carrier = Number(o.carrierPrice);
    const tva = roundCent((paidHT + carrier) * o.tvaRate);
    const amount = roundCent(paidHT + carrier + tva);
    const method = mapMethod(o.paymentMode);
    const status = mapStatus(o.paymentStatus);

    const data = {
      orderId: o.id,
      tenantId: o.tenantId,
      kind: "INITIAL" as const,
      method,
      status,
      amount,
      stripePaymentIntentId: o.stripePaymentIntentId,
      stripeCheckoutSessionId: o.stripeCheckoutSessionId,
      stripeCheckoutUrl: o.stripeCheckoutSessionUrl,
      stripeExpiresAt: o.stripeCheckoutSessionExpiresAt,
      paidAt: status === "PAID" ? o.updatedAt : null,
      confirmedAt: o.bankTransferConfirmedAt,
      confirmedBy: o.bankTransferConfirmedBy,
      createdAt: o.createdAt,
    };

    if (dryRun) {
      console.log(`[dry-run] order=${o.id} method=${method} status=${status} amount=${amount}`);
    } else {
      // @ts-expect-error — orderPayment exposé après `prisma generate` post-schema push
      await prisma.orderPayment.create({ data });
      created += 1;
      if (created % 50 === 0) console.log(`  ... ${created} créés`);
    }
  }

  console.log(
    `[backfill-order-payments] ${dryRun ? "aurait créé" : "créé"} ${
      dryRun ? orders.length : created
    } OrderPayment INITIAL.`,
  );
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
