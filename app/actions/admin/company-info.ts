"use server";

import { getServerSession } from "next-auth";
import { revalidatePath, revalidateTag } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") throw new Error("Non autorisé");
}

export interface CompanyInfoData {
  shopName?: string;
  name: string;
  legalForm?: string;
  capital?: string;
  siret?: string;
  rcs?: string;
  tvaNumber?: string;
  address?: string;
  city?: string;
  postalCode?: string;
  country?: string;
  phone?: string;
  whatsapp?: string;
  email?: string;
  website?: string;
  director?: string;
  hostName?: string;
  hostAddress?: string;
  hostPhone?: string;
  hostEmail?: string;
}

export async function getCompanyInfo() {
  return prisma.companyInfo.findFirst();
}

export async function updateCompanyInfo(
  data: CompanyInfoData
): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAdmin();

    if (!data.name?.trim()) {
      return { success: false, error: "La raison sociale est obligatoire." };
    }

    const existing = await prisma.companyInfo.findFirst();

    if (existing) {
      await prisma.companyInfo.update({
        where: { id: existing.id },
        data: {
          shopName: data.shopName?.trim() || null,
          name: data.name.trim(),
          legalForm: data.legalForm?.trim() || null,
          capital: data.capital?.trim() || null,
          siret: data.siret?.trim() || null,
          rcs: data.rcs?.trim() || null,
          tvaNumber: data.tvaNumber?.trim() || null,
          address: data.address?.trim() || null,
          city: data.city?.trim() || null,
          postalCode: data.postalCode?.trim() || null,
          country: data.country?.trim() || "France",
          phone: data.phone?.trim() || null,
          whatsapp: data.whatsapp?.trim() || null,
          email: data.email?.trim() || null,
          website: data.website?.trim() || null,
          director: data.director?.trim() || null,
          hostName: data.hostName?.trim() || null,
          hostAddress: data.hostAddress?.trim() || null,
          hostPhone: data.hostPhone?.trim() || null,
          hostEmail: data.hostEmail?.trim() || null,
        },
      });
    } else {
      await prisma.companyInfo.create({
        data: {
          shopName: data.shopName?.trim() || null,
          name: data.name.trim(),
          legalForm: data.legalForm?.trim() || null,
          capital: data.capital?.trim() || null,
          siret: data.siret?.trim() || null,
          rcs: data.rcs?.trim() || null,
          tvaNumber: data.tvaNumber?.trim() || null,
          address: data.address?.trim() || null,
          city: data.city?.trim() || null,
          postalCode: data.postalCode?.trim() || null,
          country: data.country?.trim() || "France",
          phone: data.phone?.trim() || null,
          whatsapp: data.whatsapp?.trim() || null,
          email: data.email?.trim() || null,
          website: data.website?.trim() || null,
          director: data.director?.trim() || null,
          hostName: data.hostName?.trim() || null,
          hostAddress: data.hostAddress?.trim() || null,
          hostPhone: data.hostPhone?.trim() || null,
          hostEmail: data.hostEmail?.trim() || null,
        },
      });
    }

    // When company info changes, create new versions for all active documents
    const companyInfo = await prisma.companyInfo.findFirst();
    const companySnapshot = JSON.stringify(companyInfo);

    const activeDocuments = await prisma.legalDocument.findMany({
      where: { isActive: true },
    });

    if (activeDocuments.length > 0) {
      await Promise.all(
        activeDocuments.map((doc) =>
          prisma.$transaction([
            prisma.legalDocumentVersion.create({
              data: {
                documentId: doc.id,
                content: doc.content,
                companyInfoSnapshot: companySnapshot,
                changeNote: "Mise à jour des informations société",
              },
            }),
            prisma.legalDocument.update({
              where: { id: doc.id },
              data: { updatedAt: new Date() },
            }),
          ])
        )
      );
    }

    revalidatePath("/admin/parametres");
    revalidatePath("/admin/documents-legaux");
    revalidateTag("legal-documents", "default");
    revalidateTag("company-info", "default");
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Erreur" };
  }
}
