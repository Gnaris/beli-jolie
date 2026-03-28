/**
 * Script de création du compte administrateur
 * Usage : npx tsx scripts/create-admin.ts
 *
 * Vérifie s'il existe déjà un admin, sinon demande email + mot de passe.
 */

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import * as readline from "readline";

const prisma = new PrismaClient();

function ask(question: string, hidden = false): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    if (hidden) {
      // Masquer la saisie du mot de passe
      process.stdout.write(question);
      const stdin = process.stdin;
      const wasRaw = stdin.isRaw;
      if (stdin.setRawMode) stdin.setRawMode(true);
      stdin.resume();

      let password = "";
      const onData = (char: Buffer) => {
        const c = char.toString("utf8");
        if (c === "\n" || c === "\r" || c === "\u0004") {
          stdin.removeListener("data", onData);
          if (stdin.setRawMode) stdin.setRawMode(wasRaw ?? false);
          process.stdout.write("\n");
          rl.close();
          resolve(password);
        } else if (c === "\u0003") {
          // Ctrl+C
          process.exit(1);
        } else if (c === "\u007F" || c === "\b") {
          // Backspace
          if (password.length > 0) {
            password = password.slice(0, -1);
            process.stdout.write("\b \b");
          }
        } else {
          password += c;
          process.stdout.write("*");
        }
      };
      stdin.on("data", onData);
    } else {
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    }
  });
}

async function main() {
  console.log("\n========================================");
  console.log("   Configuration du compte admin");
  console.log("========================================\n");

  // Vérifier si un admin existe déjà
  const existingAdmin = await prisma.user.findFirst({
    where: { role: "ADMIN" },
  });

  if (existingAdmin) {
    console.log("Un compte admin existe deja :");
    console.log(`  Email  : ${existingAdmin.email}`);
    console.log(`  Statut : ${existingAdmin.status}`);
    console.log("\nAucune action necessaire.\n");
    return;
  }

  // Pas d'admin → demander les infos
  const email = await ask("Email admin : ");
  if (!email) {
    console.error("Email requis.");
    process.exit(1);
  }

  const password = await ask("Mot de passe : ", true);
  if (!password || password.length < 6) {
    console.error("Mot de passe requis (6 caracteres minimum).");
    process.exit(1);
  }

  const confirmPassword = await ask("Confirmer le mot de passe : ", true);
  if (password !== confirmPassword) {
    console.error("Les mots de passe ne correspondent pas.");
    process.exit(1);
  }

  // Vérifier si l'email est déjà pris
  const existingUser = await prisma.user.findUnique({
    where: { email },
  });

  if (existingUser) {
    // L'utilisateur existe mais n'est pas admin → le promouvoir
    await prisma.user.update({
      where: { email },
      data: { role: "ADMIN", status: "APPROVED" },
    });
    console.log(`\nCompte existant promu admin : ${email}\n`);
    return;
  }

  // Hash + création
  const hashedPassword = await bcrypt.hash(password, 12);

  await prisma.user.create({
    data: {
      email,
      password: hashedPassword,
      firstName: "Admin",
      lastName: "Admin",
      company: "Admin",
      phone: "0000000000",
      siret: "00000000000000",
      kbisPath: "private/uploads/kbis/admin.pdf",
      role: "ADMIN",
      status: "APPROVED",
    },
  });

  console.log("\n========================================");
  console.log("   Compte admin cree avec succes !");
  console.log("========================================");
  console.log(`  Email : ${email}`);
  console.log("\nConnectez-vous sur votre site a /connexion\n");
}

main()
  .catch((e) => {
    console.error("Erreur :", e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
