"use server";

import { getServerSession } from "next-auth";
import { revalidatePath, revalidateTag } from "next/cache";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requireCurrentTenant } from "@/lib/tenant";
import { isKnownCountry } from "@/lib/countries";
import type { ClientDiscountType } from "@prisma/client";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    throw new Error("Accès non autorisé.");
  }
  return session;
}

const discountTypeSchema = z.enum(["PERCENT", "AMOUNT"]).nullable().optional();

const cardSchema = z.object({
  firstName: z.string().trim().min(1, "Le prénom est requis."),
  lastName: z.string().trim().min(1, "Le nom est requis."),
  company: z.string().trim().max(255).optional().nullable(),
  siret: z.string().trim().max(64).optional().nullable(),
  vatNumber: z.string().trim().max(64).optional().nullable(),
  email: z.union([z.string().trim().email("Email invalide."), z.literal("")]).optional().nullable(),
  phone: z.string().trim().max(64).optional().nullable(),
  website: z.string().trim().max(512).optional().nullable(),
  addressLine: z.string().trim().max(1024).optional().nullable(),
  postalCode: z.string().trim().max(32).optional().nullable(),
  city: z.string().trim().max(255).optional().nullable(),
  countryCode: z
    .string()
    .trim()
    .transform((v) => v.toUpperCase())
    .refine((v) => v === "" || isKnownCountry(v), "Pays inconnu.")
    .optional()
    .nullable(),
  hasPfs: z.boolean().optional(),
  hasAnkorstore: z.boolean().optional(),
  hasEfashion: z.boolean().optional(),
  hasFaire: z.boolean().optional(),
  hasMicrostore: z.boolean().optional(),
  hasPassage: z.boolean().optional(),
  lastOrderAt: z.string().optional().nullable(),
  lastMessageSentAt: z.string().optional().nullable(),
  orderDiscountType: discountTypeSchema,
  orderDiscountValue: z.number().min(0).max(999999).optional().nullable(),
  shippingFree: z.boolean().optional(),
  shippingDiscountType: discountTypeSchema,
  shippingDiscountValue: z.number().min(0).max(999999).optional().nullable(),
  note: z.string().trim().max(4000).optional().nullable(),
});

export type AdminClientCardInput = z.input<typeof cardSchema>;

function parseDate(v: string | null | undefined): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toNullString(v: string | null | undefined): string | null {
  const t = (v ?? "").trim();
  return t.length ? t : null;
}

function toPrismaData(input: z.infer<typeof cardSchema>) {
  const orderType = (input.orderDiscountType ?? null) as ClientDiscountType | null;
  const orderValue = orderType && input.orderDiscountValue != null ? input.orderDiscountValue : null;

  const shipFree = !!input.shippingFree;
  const shipType = shipFree ? null : ((input.shippingDiscountType ?? null) as ClientDiscountType | null);
  const shipValue = shipFree ? null : shipType && input.shippingDiscountValue != null ? input.shippingDiscountValue : null;

  return {
    firstName: input.firstName.trim(),
    lastName: input.lastName.trim(),
    company: toNullString(input.company),
    siret: toNullString(input.siret),
    vatNumber: toNullString(input.vatNumber),
    email: toNullString(input.email),
    phone: toNullString(input.phone),
    website: toNullString(input.website),
    addressLine: toNullString(input.addressLine),
    postalCode: toNullString(input.postalCode),
    city: toNullString(input.city),
    countryCode: toNullString(input.countryCode),
    hasPfs: !!input.hasPfs,
    hasAnkorstore: !!input.hasAnkorstore,
    hasEfashion: !!input.hasEfashion,
    hasFaire: !!input.hasFaire,
    hasMicrostore: !!input.hasMicrostore,
    hasPassage: !!input.hasPassage,
    lastOrderAt: parseDate(input.lastOrderAt),
    lastMessageSentAt: parseDate(input.lastMessageSentAt),
    orderDiscountType: orderType,
    orderDiscountValue: orderValue,
    shippingFree: shipFree,
    shippingDiscountType: shipType,
    shippingDiscountValue: shipValue,
    note: toNullString(input.note),
  };
}

export async function createAdminClientCard(input: AdminClientCardInput) {
  const session = await requireAdmin();
  const tenant = await requireCurrentTenant();

  const parsed = cardSchema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new Error(first?.message ?? "Données invalides.");
  }

  const data = toPrismaData(parsed.data);

  const created = await prisma.adminClientCard.create({
    data: {
      ...data,
      createdById: session.user.id,
      tenantId: tenant.id,
    },
    select: { id: true },
  });

  revalidatePath("/admin/utilisateurs");
  revalidateTag("admin-client-cards", "default");
  return { success: true as const, id: created.id };
}

export async function updateAdminClientCard(id: string, input: AdminClientCardInput) {
  await requireAdmin();

  const existing = await prisma.adminClientCard.findFirst({
    where: { id },
    select: { id: true },
  });
  if (!existing) throw new Error("Fiche introuvable.");

  const parsed = cardSchema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new Error(first?.message ?? "Données invalides.");
  }

  await prisma.adminClientCard.update({
    where: { id },
    data: toPrismaData(parsed.data),
  });

  revalidatePath("/admin/utilisateurs");
  revalidateTag("admin-client-cards", "default");
  return { success: true as const };
}

export async function deleteAdminClientCard(id: string) {
  await requireAdmin();

  const existing = await prisma.adminClientCard.findFirst({
    where: { id },
    select: { id: true },
  });
  if (!existing) throw new Error("Fiche introuvable.");

  await prisma.adminClientCard.delete({ where: { id } });

  revalidatePath("/admin/utilisateurs");
  revalidateTag("admin-client-cards", "default");
  return { success: true as const };
}
