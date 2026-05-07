/**
 * Script ponctuel — Supprime tous les comptes CLIENT (les admins sont préservés).
 * Usage : npx tsx scripts/delete-test-clients.ts
 *
 * Effet en cascade : Cart, ShippingAddress, Order, Favorite, etc. Les commandes
 * référencent l'utilisateur via `userId` sans onDelete:Cascade, on les supprime
 * donc avant les utilisateurs.
 */
import { prisma } from "../lib/prisma";

async function main() {
  const clients = await prisma.user.findMany({
    where: { role: "CLIENT" },
    select: { id: true, email: true, company: true, role: true },
  });

  if (clients.length === 0) {
    console.log("Aucun compte CLIENT à supprimer.");
    return;
  }

  console.log(`Suppression de ${clients.length} compte(s) CLIENT :`);
  for (const c of clients) {
    console.log(`  - ${c.email} (${c.company})`);
  }

  const ids = clients.map((c) => c.id);

  // Ordre : on coupe d'abord toutes les tables enfants qui n'ont pas onDelete:Cascade
  // sur User. Cart, ShippingAddress, Favorite (côté client) ont déjà Cascade ;
  // mais Order et OrderItem n'en ont pas — il faut les retirer manuellement.
  const orderIds = (await prisma.order.findMany({
    where: { userId: { in: ids } },
    select: { id: true },
  })).map((o) => o.id);

  if (orderIds.length > 0) {
    await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.stockMovement.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    console.log(`  → ${orderIds.length} commande(s) supprimée(s)`);
  }

  // Mettre à null les références "createdBy" / "userId" sur les tables que le client
  // peut avoir alimentées sans cascade (ex: stockMovements créés par l'admin sur ce compte ?
  // → non, StockMovement est lié à un User via createdBy mais on ne supprime que des CLIENTs).
  // Idem pour PriceHistory, ProductView : ces user-references côté admin n'existeront pas
  // pour des CLIENT, on peut donc supprimer directement.

  // Supprimer les utilisateurs (Cart, ShippingAddress, Favorite, RestockAlert,
  // ProductView, Conversation, Message, Claim, Credit, PromotionUsage, ImportDraft,
  // ImportJob ont onDelete:Cascade ou seront supprimés par le cascade).
  const result = await prisma.user.deleteMany({ where: { role: "CLIENT" } });
  console.log(`✅ ${result.count} compte(s) CLIENT supprimé(s).`);

  // Vérification : on liste les comptes restants
  const remaining = await prisma.user.findMany({
    select: { email: true, role: true },
  });
  console.log(`\nComptes restants (${remaining.length}) :`);
  for (const u of remaining) {
    console.log(`  - [${u.role}] ${u.email}`);
  }
}

main()
  .catch((err) => {
    console.error("Erreur :", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
