"use server";

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { z } from "zod";

// P3-06 — validation côté serveur des champs profil. Les longueurs maximales
// suivent les colonnes Prisma. Téléphone : même regex international que
// l'inscription (P3-07).
const ProfileSchema = z.object({
  firstName: z.string().trim().min(1, "Prénom requis.").max(80),
  lastName:  z.string().trim().min(1, "Nom requis.").max(80),
  company:   z.string().trim().min(1, "Société requise.").max(120),
  phone: z
    .string()
    .trim()
    .regex(
      /^(\+\d{1,3}|0)[1-9]\d{7,12}$/,
      "Numéro de téléphone invalide.",
    ),
  address: z.string().trim().max(255).optional().or(z.literal("")),
  vatNumber: z
    .string()
    .trim()
    .max(20)
    .regex(/^([A-Z]{2}[A-Z0-9]{2,13})?$/, "Numéro de TVA invalide.")
    .optional()
    .or(z.literal("")),
});

export async function updateProfile(data: {
  firstName: string;
  lastName: string;
  company: string;
  phone: string;
  address: string;
  vatNumber: string;
}) {
  const session = await getServerSession(authOptions);
  if (!session) throw new Error("Non autorise");

  const parsed = ProfileSchema.safeParse(data);
  if (!parsed.success) {
    // Zod 4 → .issues (et non .errors)
    const firstIssue = parsed.error.issues[0];
    throw new Error(firstIssue?.message ?? "Données invalides.");
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data: {
      firstName: parsed.data.firstName,
      lastName:  parsed.data.lastName,
      company:   parsed.data.company,
      phone:     parsed.data.phone,
      address:   parsed.data.address?.trim() || null,
      vatNumber: parsed.data.vatNumber?.trim() || null,
    },
  });

  revalidatePath("/espace-pro");
  return { success: true };
}
