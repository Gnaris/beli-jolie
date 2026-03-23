/**
 * lib/legal-page.ts
 *
 * Shared server-side utility to load a legal document and render it
 * with company info variables replaced.
 */

import { prisma } from "@/lib/prisma";
import { renderLegalContent, companyInfoToVariables } from "@/lib/legal-templates";
import type { LegalDocumentType } from "@prisma/client";

export async function loadLegalPage(type: LegalDocumentType) {
  const [doc, companyInfo] = await Promise.all([
    prisma.legalDocument.findUnique({ where: { type } }),
    prisma.companyInfo.findFirst(),
  ]);

  if (!doc || !doc.isActive) return null;

  const variables = companyInfoToVariables(companyInfo);
  const renderedContent = renderLegalContent(doc.content, variables);

  return {
    title: doc.title,
    content: renderedContent,
    updatedAt: doc.updatedAt.toISOString(),
  };
}
