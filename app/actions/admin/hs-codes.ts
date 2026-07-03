"use server";

import { z } from "zod";
import { getServerSession } from "next-auth";
import { revalidatePath, revalidateTag } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    throw new Error("Accès non autorisé.");
  }
}

const codeSchema = z
  .string()
  .trim()
  .min(1, "Le code SH est requis.")
  .regex(/^\d+$/, "Le code SH doit contenir uniquement des chiffres.")
  .refine(
    (v) => v.length >= 6 && v.length <= 10,
    "Le code SH doit faire 6 à 10 chiffres.",
  );

const labelSchema = z.string().trim().min(1, "Le libellé est requis.");

const inputSchema = z.object({
  code: codeSchema,
  label: labelSchema,
});

function invalidate() {
  revalidateTag("hs-codes", "default");
  revalidatePath("/admin/codes-sh");
  revalidatePath("/admin/produits");
}

function isUniqueViolation(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    "code" in e &&
    (e as { code: string }).code === "P2002"
  );
}

export async function createHsCode(input: {
  code: string;
  label: string;
}) {
  await requireAdmin();
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) throw new Error(parsed.error.issues[0].message);

  try {
    const row = await prisma.hsCode.create({ data: parsed.data });
    invalidate();
    return {
      success: true as const,
      id: row.id,
      code: row.code,
      label: row.label,
    };
  } catch (e: unknown) {
    if (isUniqueViolation(e)) throw new Error("Ce code SH existe déjà.");
    throw e;
  }
}

export async function updateHsCode(
  id: string,
  input: { code: string; label: string },
) {
  await requireAdmin();
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) throw new Error(parsed.error.issues[0].message);

  try {
    await prisma.hsCode.update({ where: { id }, data: parsed.data });
    invalidate();
    return { success: true as const };
  } catch (e: unknown) {
    if (isUniqueViolation(e)) throw new Error("Ce code SH existe déjà.");
    throw e;
  }
}

export async function deleteHsCode(id: string) {
  await requireAdmin();
  await prisma.hsCode.delete({ where: { id } });
  invalidate();
  return { success: true as const };
}

/** Reorder HS codes by providing an ordered array of ids */
export async function reorderHsCodes(orderedIds: string[]) {
  await requireAdmin();

  await prisma.$transaction(
    orderedIds.map((id, index) =>
      prisma.hsCode.update({ where: { id }, data: { position: index } }),
    ),
  );

  invalidate();
}
