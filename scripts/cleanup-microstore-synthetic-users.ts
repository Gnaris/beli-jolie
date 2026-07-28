// Nettoie les User CLIENT créés à tort par l'ancien import Microstore.
//
// Avant 2026-07-28, chaque commande Microstore importée créait un User
// synthétique (email @no-email.local ou siret MICROSTORE_*) qui apparaissait
// à tort dans « Clients inscrits ». Les fiches clients admin existent déjà
// pour ces mêmes personnes — il suffit de supprimer les Users.
//
// Avant suppression, on détache les MicrostoreOrder (userId → null) pour ne
// pas casser les commandes.
//
// Usage :
//   Dry-run (défaut, montre ce qui serait supprimé) :
//     MULTI_TENANT_SCOPE=off npx tsx scripts/cleanup-microstore-synthetic-users.ts
//   Suppression réelle :
//     MULTI_TENANT_SCOPE=off npx tsx scripts/cleanup-microstore-synthetic-users.ts --apply

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

async function main() {
  const users = await prisma.user.findMany({
    where: {
      role: "CLIENT",
      OR: [
        { email: { endsWith: "@no-email.local" } },
        { siret: { startsWith: "MICROSTORE_" } },
      ],
    },
    select: {
      id: true,
      tenantId: true,
      email: true,
      firstName: true,
      lastName: true,
      company: true,
      siret: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });

  console.log(`Trouvé ${users.length} User Microstore synthétique(s).`);

  if (users.length === 0) {
    console.log("Rien à faire.");
    return;
  }

  for (const u of users) {
    console.log(
      `  - [${u.tenantId}] ${u.email} — ${u.firstName ?? ""} ${u.lastName ?? ""} (${u.company ?? ""}) siret=${u.siret ?? ""}`,
    );
  }

  if (!APPLY) {
    console.log("\n(dry-run) Rien de supprimé. Ajouter --apply pour supprimer.");
    return;
  }

  console.log("\n→ Détachement des MicrostoreOrder et suppression…");
  let ordersDetached = 0;
  let usersDeleted = 0;
  for (const u of users) {
    const detach = await prisma.microstoreOrder.updateMany({
      where: { userId: u.id },
      data: { userId: null },
    });
    ordersDetached += detach.count;
    await prisma.user.delete({ where: { id: u.id } });
    usersDeleted++;
  }

  console.log(`✅ ${usersDeleted} User supprimé(s), ${ordersDetached} commande(s) détachée(s).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
