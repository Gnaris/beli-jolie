/**
 * Vide toutes les commandes + tous les clients (User CLIENT + AdminClientCard)
 * de la BDD locale, en préservant les admins et toute la config produit.
 *
 * Sécurité : refuse de tourner si DATABASE_URL ne pointe pas sur localhost.
 *
 * Usage :
 *   npx tsx scripts/wipe-orders-clients-local.ts --dry     # comptage seul
 *   npx tsx scripts/wipe-orders-clients-local.ts --go      # exécute la purge
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const url = process.env.DATABASE_URL ?? "";
if (!/@localhost|@127\.0\.0\.1/.test(url)) {
  console.error(`Refus : DATABASE_URL n'est pas local (${url.replace(/:[^@]+@/, ":***@")}).`);
  process.exit(1);
}

const mode = process.argv.includes("--go")
  ? "go"
  : process.argv.includes("--dry")
    ? "dry"
    : null;
if (!mode) {
  console.error("Passe --dry (comptage) ou --go (exécute la purge).");
  process.exit(1);
}

async function main() {
  const counts = {
    userClient: await prisma.user.count({ where: { role: "CLIENT" } }),
    userAdmin: await prisma.user.count({ where: { role: "ADMIN" } }),
    adminClientCard: await prisma.adminClientCard.count(),
    order: await prisma.order.count(),
    pfsOrder: await prisma.pfsOrder.count(),
    efashionOrder: await prisma.efashionOrder.count(),
    ankorstoreOrder: await prisma.ankorstoreOrder.count(),
    faireOrder: await prisma.faireOrder.count(),
    microstoreOrder: await prisma.microstoreOrder.count(),
    claim: await prisma.claim.count(),
    credit: await prisma.credit.count(),
    conversation: await prisma.conversation.count(),
    favorite: await prisma.favorite.count(),
    cart: await prisma.cart.count(),
    shippingAddress: await prisma.shippingAddress.count(),
  };

  console.log("═══ Contenu actuel ═══");
  for (const [k, v] of Object.entries(counts)) console.log(`  ${k.padEnd(20)} ${v}`);
  console.log(`\nÀ SUPPRIMER : tout sauf ${counts.userAdmin} admin(s).`);

  if (mode === "dry") {
    console.log("\n[--dry] Aucune modification. Relance avec --go pour purger.");
    return;
  }

  console.log("\n═══ Purge en cours ═══");

  // Ordre : enfants → parents. Prisma auto-cascade la plupart des liens User
  // (Cart, Favorite, etc.) mais on nettoie explicitement ce qui référence
  // Order/User en SET NULL ou RESTRICT pour ne pas laisser d'orphelins.

  // 1) Marketplace orders (indépendants du User boutique)
  await prisma.pfsOrderItem.deleteMany({});
  await prisma.pfsOrder.deleteMany({});
  await prisma.efashionOrderItem.deleteMany({});
  await prisma.efashionOrder.deleteMany({});
  await prisma.ankorstoreOrderItem.deleteMany({});
  await prisma.ankorstoreOrder.deleteMany({});
  await prisma.faireOrderItem.deleteMany({});
  await prisma.faireOrder.deleteMany({});
  await prisma.microstoreOrderItem.deleteMany({});
  await prisma.microstoreOrder.deleteMany({});
  console.log("  ✓ marketplaces orders vidés");

  // 2) Réclamations
  await prisma.claim.deleteMany({});
  console.log("  ✓ réclamations vidées");

  // 3) Avoirs
  await prisma.creditUsage.deleteMany({});
  await prisma.credit.deleteMany({});
  console.log("  ✓ avoirs vidés");

  // 4) Chat
  await prisma.messageAttachment.deleteMany({});
  await prisma.message.deleteMany({});
  await prisma.conversation.deleteMany({});
  console.log("  ✓ conversations vidées");

  // 5) Commandes boutique + modifs
  //    Nettoyer d'abord tout ce qui référence Order.id en RESTRICT :
  //    - PromotionUsage (FK RESTRICT sur orderId)
  //    - StockMovement (FK nullable : on détache pour préserver l'historique stock)
  await prisma.promotionUsage.deleteMany({});
  await prisma.stockMovement.updateMany({
    where: { orderId: { not: null } },
    data: { orderId: null },
  });
  await prisma.orderItemModification.deleteMany({});
  await prisma.orderItem.deleteMany({});
  await prisma.order.deleteMany({});
  console.log("  ✓ commandes boutique vidées");

  // 7) Fiches admin client (répertoire perso admin)
  await prisma.adminClientCardProductPurchase.deleteMany({});
  await prisma.adminClientCard.deleteMany({});
  console.log("  ✓ fiches admin client vidées");

  // 8) Ce qui pend au User CLIENT (Cart, Favorite, ShippingAddress,
  // RegistrationLog…) — supprimé en cascade quand on delete
  // les Users, mais on liste ici pour être exhaustif si tables non-cascade.
  await prisma.favorite.deleteMany({});
  await prisma.cartItem.deleteMany({});
  await prisma.cart.deleteMany({});
  await prisma.shippingAddress.deleteMany({});
  await prisma.registrationLog.deleteMany({});
  await prisma.loginAttempt.deleteMany({});
  await prisma.loginOtp.deleteMany({});
  await prisma.accountLockout.deleteMany({});
  await prisma.passwordResetToken.deleteMany({});
  console.log("  ✓ dépendances client (cart, favoris, addr, logins…) vidées");

  // 9) Enfin : Users CLIENT
  const del = await prisma.user.deleteMany({ where: { role: "CLIENT" } });
  console.log(`  ✓ ${del.count} Users CLIENT supprimés`);

  console.log("\n═══ Terminé ═══");
  const admins = await prisma.user.count({ where: { role: "ADMIN" } });
  console.log(`${admins} admin(s) préservé(s). Config, produits, catégories intacts.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
