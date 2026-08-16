/**
 * ONE-SHOT : ajoute le "Bracelet jonc thaïlandaise en laiton — Violet"
 * manquant à la commande 4P9YYCBL pour que Order.totalTTC (140.34 €) matche
 * exactement le PaymentIntent Stripe.
 *
 * Approche : nouvelle OrderItem dupliquée à 3.03 € HT (au lieu de fusionner
 * sur la ligne existante à 3.04 €, ce qui donnerait 140.35 € et créerait
 * 1 centime d'écart avec Stripe). Décrémente le stock (W123 Violet : -1 → -2).
 *
 * Usage : MULTI_TENANT_SCOPE=off npx tsx scripts/add-missing-bracelet-quinchon.ts --apply
 */
import { PrismaClient } from "@prisma/client";
import { config as loadEnv } from "dotenv";

loadEnv();
const prisma = new PrismaClient();

const ORDER_ID = "cmswbojb800026dr546jyx5st";
const VIOLET_VARIANT_ID = "cmozngdu90gtrekvdts1698hm"; // W123 Violet, stock actuel = -1
const NEW_UNIT_PRICE = 3.03;
const APPLY = process.argv.includes("--apply");

async function main() {
  const order = await prisma.order.findUnique({
    where: { id: ORDER_ID },
    include: { items: true },
  });
  if (!order) throw new Error("Commande introuvable");

  // Trouver la ligne violet existante pour dupliquer ses métadonnées
  const violetLine = order.items.find((it) => {
    if (!it.variantSnapshot) return false;
    try {
      const snap = JSON.parse(it.variantSnapshot);
      return snap.productColorId === VIOLET_VARIANT_ID;
    } catch {
      return false;
    }
  });
  if (!violetLine) throw new Error("Ligne W123 Violet introuvable dans la commande");

  const currentSubtotalHT = Number(order.subtotalHT);
  const carrierPrice = Number(order.carrierPrice);
  const tvaRate = Number(order.tvaRate);
  const newSubtotalHT = currentSubtotalHT + NEW_UNIT_PRICE;
  const newTvaAmount = Math.floor((newSubtotalHT + carrierPrice) * tvaRate * 100) / 100;
  const newTotalTTC = Math.floor((newSubtotalHT + carrierPrice + newTvaAmount) * 100) / 100;

  console.log(`Commande      : ${order.orderNumber}`);
  console.log(`Actuel        : subtotalHT=${currentSubtotalHT} tvaAmount=${order.tvaAmount} totalTTC=${order.totalTTC}`);
  console.log(`Ajout ligne   : ${violetLine.productName} ${violetLine.colorName} × 1 @ ${NEW_UNIT_PRICE.toFixed(2)}`);
  console.log(`Nouveau       : subtotalHT=${newSubtotalHT.toFixed(2)} tvaAmount=${newTvaAmount.toFixed(2)} totalTTC=${newTotalTTC.toFixed(2)}`);
  console.log(`Target Stripe : 140.34`);
  console.log(`Match         : ${newTotalTTC === 140.34 ? "OUI ✓" : "NON ✗"}`);

  if (newTotalTTC !== 140.34) {
    throw new Error(`Calcul ne matche pas 140.34 — arrête sans rien toucher.`);
  }

  if (!APPLY) {
    console.log("\n[DRY-RUN] Relance avec --apply pour patcher.");
    return;
  }

  await prisma.$transaction(async (tx) => {
    // Nouvelle OrderItem (duplique le snapshot du violet existant, prix ajusté)
    await tx.orderItem.create({
      data: {
        orderId: ORDER_ID,
        tenantId: order.tenantId,
        productName: violetLine.productName,
        productRef: violetLine.productRef,
        colorName: violetLine.colorName,
        saleType: violetLine.saleType,
        packQty: violetLine.packQty,
        size: violetLine.size,
        sizesJson: violetLine.sizesJson,
        packDetails: violetLine.packDetails,
        imagePath: violetLine.imagePath,
        unitPrice: NEW_UNIT_PRICE,
        quantity: 1,
        lineTotal: NEW_UNIT_PRICE,
        variantSnapshot: violetLine.variantSnapshot,
      },
    });

    // Update totaux commande
    await tx.order.update({
      where: { id: ORDER_ID },
      data: {
        subtotalHT: newSubtotalHT,
        tvaAmount: newTvaAmount,
        totalTTC: newTotalTTC,
      },
    });

    // Décrément stock (W123 Violet: -1 → -2)
    await tx.productColor.update({
      where: { id: VIOLET_VARIANT_ID },
      data: { stock: { decrement: 1 } },
    });

    // Traçabilité stock
    await tx.stockMovement.create({
      data: {
        tenantId: order.tenantId,
        productColorId: VIOLET_VARIANT_ID,
        quantity: -1,
        type: "ORDER",
        orderId: ORDER_ID,
        reason: `Commande ${order.orderNumber} — ajout bracelet manquant (recovery Quinchon)`,
      },
    });
  });

  console.log(`\n✓ Commande ${order.orderNumber} → ${newTotalTTC.toFixed(2)} € (matche Stripe).`);
  console.log(`✓ Stock W123 Violet décrementé à ${-2} (backorder tracé).`);
}

main()
  .catch((e) => {
    console.error("Erreur :", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
