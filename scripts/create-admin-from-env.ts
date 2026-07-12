/**
 * Version non-interactive de create-admin.ts.
 * Utilisee par scripts/deploy/new-shop.sh pour amorcer le compte admin d'une
 * boutique fraichement clonee.
 *
 * Variables d'environnement requises :
 *   - ADMIN_EMAIL
 *   - ADMIN_PASSWORD (6 caracteres minimum)
 *
 * Comportement :
 *   - Si un admin existe deja, ne fait rien (idempotent).
 *   - Si l'email existe deja mais pas admin, le promeut ADMIN + APPROVED.
 *   - Sinon cree un nouveau compte ADMIN + APPROVED.
 */

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

type PrismaLike = {
  user: {
    findFirst: (args: {
      where: { role?: "ADMIN"; email?: string };
    }) => Promise<{ id?: string; email?: string } | null>;
    updateMany: (args: {
      where: { email: string };
      data: { role: "ADMIN"; status: "APPROVED" };
    }) => Promise<unknown>;
    create: (args: { data: Record<string, unknown> }) => Promise<unknown>;
  };
};

export type EnsureAdminResult =
  | { kind: "already-exists"; email: string }
  | { kind: "promoted"; email: string }
  | { kind: "created"; email: string };

/**
 * Cree ou promeut le compte admin. Fonction pure (aucun process.exit,
 * aucun printf), testable unitairement en injectant un mock Prisma.
 */
export async function ensureAdmin(
  prisma: PrismaLike,
  email: string,
  password: string,
  hashFn: (plain: string) => Promise<string> = (plain) => bcrypt.hash(plain, 12),
): Promise<EnsureAdminResult> {
  const trimmedEmail = email.trim();
  if (!trimmedEmail) throw new Error("ADMIN_EMAIL manquant.");
  if (!password || password.length < 6) {
    throw new Error("ADMIN_PASSWORD manquant ou trop court (6 caracteres minimum).");
  }

  const existingAdmin = await prisma.user.findFirst({ where: { role: "ADMIN" } });
  if (existingAdmin) {
    return { kind: "already-exists", email: existingAdmin.email ?? trimmedEmail };
  }

  const existingUser = await prisma.user.findFirst({ where: { email: trimmedEmail } });
  if (existingUser) {
    // updateMany car email n'est plus unique global (composite tenantId+email).
    await prisma.user.updateMany({
      where: { email: trimmedEmail },
      data: { role: "ADMIN", status: "APPROVED" },
    });
    return { kind: "promoted", email: trimmedEmail };
  }

  const hashedPassword = await hashFn(password);
  await prisma.user.create({
    data: {
      email: trimmedEmail,
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
  return { kind: "created", email: trimmedEmail };
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const result = await ensureAdmin(
      prisma as unknown as PrismaLike,
      process.env.ADMIN_EMAIL ?? "",
      process.env.ADMIN_PASSWORD ?? "",
    );
    switch (result.kind) {
      case "already-exists":
        console.log(`ADMIN_EXISTS ${result.email}`);
        break;
      case "promoted":
        console.log(`ADMIN_PROMOTED ${result.email}`);
        break;
      case "created":
        console.log(`ADMIN_CREATED ${result.email}`);
        break;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Erreur create-admin-from-env :", msg);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// N'execute main que quand appele directement, pas quand importe par les tests.
const isDirectCall = import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("create-admin-from-env.ts");
if (isDirectCall) {
  main();
}
