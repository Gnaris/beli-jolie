import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
const USER_ID = "cms68eleb0001m02pe6o3xzji"; // Marie Lambert
const daysAgo = (d: number) => new Date(Date.now() - d * 24 * 60 * 60 * 1000);

async function main() {
  const u = await p.user.update({
    where: { id: USER_ID },
    data: {
      lastLoginAt: daysAgo(30),
      lastSeenAt: daysAgo(30),
    },
    select: { firstName: true, lastName: true, lastLoginAt: true, lastSeenAt: true },
  });
  console.log("Marie mise à jour :");
  console.log("  " + u.firstName + " " + u.lastName);
  console.log("  lastLoginAt : " + u.lastLoginAt?.toISOString());

  const cart = await p.cart.findUnique({
    where: { userId: USER_ID },
    select: { id: true, updatedAt: true, _count: { select: { items: true } } },
  });
  if (cart) {
    const h = Math.floor((Date.now() - cart.updatedAt.getTime()) / 3600000);
    console.log("  Panier : " + cart._count.items + " articles, " + h + "h ago");
    if (h < 24) {
      await p.$executeRaw`UPDATE Cart SET updatedAt = ${daysAgo(2)} WHERE id = ${cart.id}`;
      console.log("  → panier backdated à 48h");
    }
  } else {
    console.log("  ⚠ pas de panier — relance scripts/seed-abandoned-cart-local.ts");
  }

  const del = await p.emailSend.deleteMany({
    where: { userId: USER_ID, scenarioKey: "MANUAL_RELANCE" },
  });
  console.log("  Historique MANUAL_RELANCE effacé : " + del.count);
  console.log("\n✅ Marie a maintenant les 2 scénarios : panier (48h+) + inactive (30j)");
}

main().catch((e) => { console.error("ERR", e); process.exit(1); }).finally(() => p.$disconnect());
