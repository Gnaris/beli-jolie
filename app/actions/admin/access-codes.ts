"use server";

import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { revalidatePath } from "next/cache";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    throw new Error("Accès non autorisé.");
  }
}

/**
 * Génère un code unique au format BELI-XXXX (4 caractères alphanumériques majuscules)
 */
function generateCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sans I/O/0/1 pour éviter confusion
  let result = "BELI-";
  for (let i = 0; i < 4; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// ─────────────────────────────────────────────
// Créer un code d'accès
// ─────────────────────────────────────────────
export async function createAccessCode(note?: string) {
  await requireAdmin();

  // Générer un code unique (retry si collision)
  let code: string;
  let attempts = 0;
  do {
    code = generateCode();
    const existing = await prisma.accessCode.findUnique({ where: { code } });
    if (!existing) break;
    attempts++;
  } while (attempts < 10);

  if (attempts >= 10) {
    return { error: "Impossible de générer un code unique. Réessayez." };
  }

  // Expiration dans 1 semaine
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7);

  const accessCode = await prisma.accessCode.create({
    data: {
      code,
      note: note?.trim() || null,
      expiresAt,
    },
  });

  revalidatePath("/admin/codes-acces");
  return { success: true, code: accessCode.code, id: accessCode.id };
}

// ─────────────────────────────────────────────
// Lister tous les codes d'accès
// ─────────────────────────────────────────────
export async function getAccessCodes() {
  await requireAdmin();

  return prisma.accessCode.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { views: true } },
      user: { select: { firstName: true, lastName: true, email: true, company: true } },
    },
  });
}

// ─────────────────────────────────────────────
// Détails d'un code d'accès avec historique
// ─────────────────────────────────────────────
export async function getAccessCodeDetails(id: string) {
  await requireAdmin();

  return prisma.accessCode.findUnique({
    where: { id },
    include: {
      user: { select: { firstName: true, lastName: true, email: true, company: true } },
      views: {
        orderBy: { createdAt: "desc" },
        take: 100,
        include: {
          product: { select: { name: true, reference: true } },
        },
      },
    },
  });
}

// ─────────────────────────────────────────────
// Désactiver un code d'accès
// ─────────────────────────────────────────────
export async function deactivateAccessCode(id: string) {
  await requireAdmin();

  await prisma.accessCode.update({
    where: { id },
    data: { isActive: false },
  });

  revalidatePath("/admin/codes-acces");
  return { success: true };
}

// ─────────────────────────────────────────────
// Réactiver un code d'accès
// ─────────────────────────────────────────────
export async function reactivateAccessCode(id: string) {
  await requireAdmin();

  // Renouveler l'expiration d'une semaine
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7);

  await prisma.accessCode.update({
    where: { id },
    data: { isActive: true, expiresAt },
  });

  revalidatePath("/admin/codes-acces");
  return { success: true };
}

// ─────────────────────────────────────────────
// Mettre à jour la note d'un code
// ─────────────────────────────────────────────
export async function updateAccessCodeNote(id: string, note: string) {
  await requireAdmin();

  await prisma.accessCode.update({
    where: { id },
    data: { note: note.trim() || null },
  });

  revalidatePath("/admin/codes-acces");
  return { success: true };
}

// ─────────────────────────────────────────────
// Supprimer un code d'accès
// ─────────────────────────────────────────────
export async function deleteAccessCode(id: string) {
  await requireAdmin();

  await prisma.accessCode.delete({ where: { id } });

  revalidatePath("/admin/codes-acces");
  return { success: true };
}
