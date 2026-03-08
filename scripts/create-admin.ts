/**
 * Script de création du compte administrateur
 * Usage : npx tsx scripts/create-admin.ts
 */

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const ADMIN_EMAIL    = "beliandjolie@gmail.com";
const ADMIN_PASSWORD = "Lin123Chen";

async function main() {
  console.log("🔧 Création du compte administrateur...\n");

  // Vérifier si un admin existe déjà
  const existing = await prisma.user.findUnique({
    where: { email: ADMIN_EMAIL },
  });

  if (existing) {
    console.log(`⚠️  Un compte avec l'email ${ADMIN_EMAIL} existe déjà.`);
    console.log(`   Rôle   : ${existing.role}`);
    console.log(`   Statut : ${existing.status}`);

    // Si ce n'est pas un admin, on le met à jour
    if (existing.role !== "ADMIN") {
      await prisma.user.update({
        where: { email: ADMIN_EMAIL },
        data: { role: "ADMIN", status: "APPROVED" },
      });
      console.log("✅ Rôle mis à jour → ADMIN");
    }
    return;
  }

  // Hash du mot de passe
  const hashedPassword = await bcrypt.hash(ADMIN_PASSWORD, 12);

  // Création de l'admin
  const admin = await prisma.user.create({
    data: {
      email:     ADMIN_EMAIL,
      password:  hashedPassword,
      firstName: "Admin",
      lastName:  "Beli & Jolie",
      company:   "Beli & Jolie",
      phone:     "0600000000",
      siret:     "00000000000000",
      kbisPath:  "private/uploads/kbis/admin.pdf",
      role:      "ADMIN",
      status:    "APPROVED",
    },
  });

  console.log("✅ Compte admin créé avec succès !\n");
  console.log("┌─────────────────────────────────────────┐");
  console.log(`│  Email    : ${admin.email.padEnd(29)}│`);
  console.log(`│  Mot de passe : ${ADMIN_PASSWORD.padEnd(23)}│`);
  console.log(`│  Rôle     : ADMIN                       │`);
  console.log("└─────────────────────────────────────────┘");
  console.log("\n🔐 Connectez-vous sur http://localhost:3000/connexion");
}

main()
  .catch((e) => {
    console.error("❌ Erreur :", e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
