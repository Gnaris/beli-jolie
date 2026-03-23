"use server";

import { getServerSession } from "next-auth";
import { revalidatePath, revalidateTag } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { DEFAULT_TEMPLATES } from "@/lib/legal-templates";
import type { LegalDocumentType } from "@prisma/client";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") throw new Error("Non autorisé");
}

/**
 * Get all legal documents (for listing page)
 */
export async function getLegalDocuments() {
  return prisma.legalDocument.findMany({
    orderBy: { createdAt: "asc" },
    include: {
      _count: { select: { versions: true } },
    },
  });
}

/**
 * Get a single legal document by type
 */
export async function getLegalDocument(type: LegalDocumentType) {
  return prisma.legalDocument.findUnique({ where: { type } });
}

/**
 * Get version history for a document
 */
export async function getLegalDocumentVersions(documentId: string) {
  return prisma.legalDocumentVersion.findMany({
    where: { documentId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
}

/**
 * Initialize default documents if none exist
 */
export async function initializeLegalDocuments(): Promise<{ success: boolean; created: number }> {
  try {
    await requireAdmin();

    const existing = await prisma.legalDocument.count();
    if (existing > 0) return { success: true, created: 0 };

    const types = Object.keys(DEFAULT_TEMPLATES) as (keyof typeof DEFAULT_TEMPLATES)[];
    const companyInfo = await prisma.companyInfo.findFirst();
    const companySnapshot = JSON.stringify(companyInfo || {});

    for (const type of types) {
      const template = DEFAULT_TEMPLATES[type];
      const doc = await prisma.legalDocument.create({
        data: {
          type: type as LegalDocumentType,
          title: template.title,
          content: template.content,
          isActive: true,
        },
      });
      // Create initial version
      await prisma.legalDocumentVersion.create({
        data: {
          documentId: doc.id,
          content: template.content,
          companyInfoSnapshot: companySnapshot,
          changeNote: "Version initiale",
        },
      });
    }

    revalidateTag("legal-documents", "default");
    return { success: true, created: types.length };
  } catch {
    return { success: false, created: 0 };
  }
}

/**
 * Save/update a legal document's content
 */
export async function saveLegalDocument(
  type: LegalDocumentType,
  content: string,
  title?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAdmin();

    if (!content?.trim()) {
      return { success: false, error: "Le contenu ne peut pas être vide." };
    }

    const companyInfo = await prisma.companyInfo.findFirst();
    const companySnapshot = JSON.stringify(companyInfo || {});

    const existing = await prisma.legalDocument.findUnique({ where: { type } });

    if (existing) {
      // Update document
      await prisma.legalDocument.update({
        where: { type },
        data: {
          content,
          ...(title ? { title } : {}),
        },
      });

      // Create new version
      await prisma.legalDocumentVersion.create({
        data: {
          documentId: existing.id,
          content,
          companyInfoSnapshot: companySnapshot,
          changeNote: "Modification manuelle",
        },
      });
    } else {
      // Create new document
      const defaultTemplate = DEFAULT_TEMPLATES[type as keyof typeof DEFAULT_TEMPLATES];
      const doc = await prisma.legalDocument.create({
        data: {
          type,
          title: title || defaultTemplate?.title || type,
          content,
          isActive: true,
        },
      });
      await prisma.legalDocumentVersion.create({
        data: {
          documentId: doc.id,
          content,
          companyInfoSnapshot: companySnapshot,
          changeNote: "Version initiale",
        },
      });
    }

    revalidatePath("/admin/documents-legaux");
    revalidateTag("legal-documents", "default");
    // Revalidate public pages
    revalidatePath("/mentions-legales");
    revalidatePath("/cgv");
    revalidatePath("/confidentialite");
    revalidatePath("/cookies");
    revalidatePath("/cgu");
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Erreur" };
  }
}

/**
 * Toggle document active state
 */
export async function toggleLegalDocument(
  type: LegalDocumentType,
  isActive: boolean
): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAdmin();
    await prisma.legalDocument.update({
      where: { type },
      data: { isActive },
    });
    revalidatePath("/admin/documents-legaux");
    revalidateTag("legal-documents", "default");
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Erreur" };
  }
}

/**
 * Rollback to a specific version
 */
export async function rollbackLegalDocument(
  versionId: string,
  strategy: "content_only" | "content_and_company" | "content_with_current_company"
): Promise<{ success: boolean; error?: string; companyDiff?: boolean }> {
  try {
    await requireAdmin();

    const version = await prisma.legalDocumentVersion.findUnique({
      where: { id: versionId },
      include: { document: true },
    });

    if (!version) {
      return { success: false, error: "Version introuvable." };
    }

    const currentCompanyInfo = await prisma.companyInfo.findFirst();
    const currentSnapshot = JSON.stringify(currentCompanyInfo || {});
    const versionSnapshot = version.companyInfoSnapshot;

    // Check if company info differs
    const companyDiff = currentSnapshot !== versionSnapshot;

    if (strategy === "content_and_company" && companyDiff) {
      // Restore both content and company info from the version
      const oldCompanyInfo = JSON.parse(versionSnapshot);
      if (oldCompanyInfo && oldCompanyInfo.id) {
        // Update company info to match the old version
        await prisma.companyInfo.update({
          where: { id: oldCompanyInfo.id },
          data: {
            name: oldCompanyInfo.name,
            legalForm: oldCompanyInfo.legalForm,
            capital: oldCompanyInfo.capital,
            siret: oldCompanyInfo.siret,
            rcs: oldCompanyInfo.rcs,
            tvaNumber: oldCompanyInfo.tvaNumber,
            address: oldCompanyInfo.address,
            city: oldCompanyInfo.city,
            postalCode: oldCompanyInfo.postalCode,
            country: oldCompanyInfo.country || "France",
            phone: oldCompanyInfo.phone,
            email: oldCompanyInfo.email,
            website: oldCompanyInfo.website,
            director: oldCompanyInfo.director,
            hostName: oldCompanyInfo.hostName,
            hostAddress: oldCompanyInfo.hostAddress,
            hostPhone: oldCompanyInfo.hostPhone,
            hostEmail: oldCompanyInfo.hostEmail,
          },
        });
        revalidateTag("company-info", "default");
        revalidatePath("/admin/parametres");
      }
    }

    // Update document content
    await prisma.legalDocument.update({
      where: { id: version.documentId },
      data: { content: version.content },
    });

    // Create a new version entry for the rollback
    const newCompanyInfo = await prisma.companyInfo.findFirst();
    await prisma.legalDocumentVersion.create({
      data: {
        documentId: version.documentId,
        content: version.content,
        companyInfoSnapshot: JSON.stringify(newCompanyInfo || {}),
        changeNote: `Restauration de la version du ${version.createdAt.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}`,
      },
    });

    revalidatePath("/admin/documents-legaux");
    revalidateTag("legal-documents", "default");
    revalidatePath("/mentions-legales");
    revalidatePath("/cgv");
    revalidatePath("/confidentialite");
    revalidatePath("/cookies");
    revalidatePath("/cgu");

    return { success: true, companyDiff };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Erreur" };
  }
}
