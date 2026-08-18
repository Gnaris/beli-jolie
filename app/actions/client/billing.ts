"use server";

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const BillingSchema = z.object({
  firstName: z.string().trim().min(1, "Prénom requis.").max(80),
  lastName:  z.string().trim().min(1, "Nom requis.").max(80),
  company:   z.string().trim().min(1, "Société requise.").max(120),
  phone: z
    .string()
    .trim()
    .regex(/^(\+\d{1,3}|0)[1-9]\d{7,12}$/, "Numéro de téléphone invalide."),
  vatNumber: z
    .string()
    .trim()
    .max(20)
    .regex(/^([A-Z]{2}[A-Z0-9]{2,13})?$/, "Numéro de TVA invalide.")
    .optional()
    .or(z.literal("")),
  addressStreet:     z.string().trim().max(200).optional().or(z.literal("")),
  addressComplement: z.string().trim().max(200).optional().or(z.literal("")),
  addressZip:        z.string().trim().max(20).optional().or(z.literal("")),
  addressCity:       z.string().trim().max(100).optional().or(z.literal("")),
  addressCountry:    z.string().trim().max(2).optional().or(z.literal("")),
});

export interface UpdateBillingResult {
  success: true;
}

export interface UpdateBillingError {
  success: false;
  error:   string;
}

/**
 * Met à jour la facturation depuis la page commande.
 * Persiste sur le compte utilisateur les champs : société, téléphone,
 * N° TVA et adresse de la société.
 */
export async function updateBillingInfo(data: {
  firstName: string;
  lastName:  string;
  company:   string;
  phone:     string;
  vatNumber: string;
  addressStreet:     string;
  addressComplement: string;
  addressZip:        string;
  addressCity:       string;
  addressCountry:    string;
}): Promise<UpdateBillingResult | UpdateBillingError> {
  const session = await getServerSession(authOptions);
  if (!session) return { success: false, error: "Non authentifié." };

  const parsed = BillingSchema.safeParse(data);
  if (!parsed.success) {
    return {
      success: false,
      error:   parsed.error.issues[0]?.message ?? "Données invalides.",
    };
  }

  const p = parsed.data;

  await prisma.user.update({
    where: { id: session.user.id },
    data: {
      firstName: p.firstName,
      lastName:  p.lastName,
      company:   p.company,
      phone:     p.phone,
      vatNumber: p.vatNumber?.trim() || null,
      addressStreet:     p.addressStreet?.trim()     || null,
      addressComplement: p.addressComplement?.trim() || null,
      addressZip:        p.addressZip?.trim()        || null,
      addressCity:       p.addressCity?.trim()       || null,
      addressCountry:    p.addressCountry?.trim()    || null,
    },
  });

  revalidatePath("/panier");
  revalidatePath("/espace-pro");
  return { success: true };
}
