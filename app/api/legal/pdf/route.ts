/**
 * GET /api/legal/pdf?type=CGV
 *
 * Generate a PDF version of a legal document using pdfkit.
 * Public endpoint — no auth required (same as the public pages).
 */

import { NextRequest, NextResponse } from "next/server";
import PDFDocument from "pdfkit";
import { prisma } from "@/lib/prisma";
import { renderLegalContent, companyInfoToVariables } from "@/lib/legal-templates";
import type { LegalDocumentType } from "@prisma/client";

const VALID_TYPES = [
  "MENTIONS_LEGALES",
  "CGV",
  "CGU",
  "POLITIQUE_CONFIDENTIALITE",
  "COOKIES",
];

// Simple HTML to plain-text-ish converter for pdfkit (which doesn't support HTML)
function htmlToBlocks(html: string): { type: "h2" | "h3" | "h4" | "p" | "li"; text: string }[] {
  const blocks: { type: "h2" | "h3" | "h4" | "p" | "li"; text: string }[] = [];
  // Strip HTML tags but preserve structure
  const cleaned = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/h[234]>/gi, "\n");

  // Split by heading/paragraph tags
  const parts = cleaned.split(/<(h2|h3|h4)[^>]*>/i);

  let currentType: "h2" | "h3" | "h4" | "p" = "p";

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part) continue;

    // Check if this part is a tag name
    if (/^h[234]$/i.test(part)) {
      currentType = part.toLowerCase() as "h2" | "h3" | "h4";
      continue;
    }

    // This is content — strip remaining HTML
    const textContent = part
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#039;/g, "'")
      .replace(/&apos;/g, "'")
      .replace(/&nbsp;/g, " ")
      .trim();

    if (!textContent) continue;

    // Split by newlines for paragraphs
    const lines = textContent.split("\n").map((l) => l.trim()).filter(Boolean);

    if (currentType.startsWith("h")) {
      // First line is the heading
      if (lines[0]) {
        blocks.push({ type: currentType, text: lines[0] });
      }
      // Rest are paragraphs
      for (let j = 1; j < lines.length; j++) {
        const line = lines[j];
        const isListItem = line.startsWith("•") || line.startsWith("-") || line.startsWith("*");
        blocks.push({
          type: isListItem ? "li" : "p",
          text: isListItem ? line.replace(/^[•\-*]\s*/, "") : line,
        });
      }
      currentType = "p";
    } else {
      for (const line of lines) {
        const isListItem = line.startsWith("•") || line.startsWith("-") || line.startsWith("*");
        blocks.push({
          type: isListItem ? "li" : "p",
          text: isListItem ? line.replace(/^[•\-*]\s*/, "") : line,
        });
      }
    }
  }

  return blocks;
}

export async function GET(request: NextRequest) {
  const type = request.nextUrl.searchParams.get("type");

  if (!type || !VALID_TYPES.includes(type)) {
    return NextResponse.json({ error: "Type de document invalide" }, { status: 400 });
  }

  const [doc, companyInfo] = await Promise.all([
    prisma.legalDocument.findUnique({ where: { type: type as LegalDocumentType } }),
    prisma.companyInfo.findFirst(),
  ]);

  if (!doc || !doc.isActive) {
    return NextResponse.json({ error: "Document non trouvé" }, { status: 404 });
  }

  const variables = companyInfoToVariables(companyInfo);
  const renderedContent = renderLegalContent(doc.content, variables);

  // Generate PDF
  const pdfDoc = new PDFDocument({
    size: "A4",
    margins: { top: 60, bottom: 60, left: 50, right: 50 },
    info: {
      Title: doc.title,
      Author: companyInfo?.name || "Beli & Jolie",
      Subject: doc.title,
      CreationDate: new Date(),
    },
  });

  const chunks: Buffer[] = [];
  pdfDoc.on("data", (chunk: Buffer) => chunks.push(chunk));

  // Header
  pdfDoc
    .fontSize(22)
    .font("Helvetica-Bold")
    .fillColor("#1A1A1A")
    .text(doc.title, { align: "center" });

  pdfDoc.moveDown(0.5);
  pdfDoc
    .fontSize(9)
    .font("Helvetica")
    .fillColor("#6B6B6B")
    .text(
      `Dernière mise à jour : ${doc.updatedAt.toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" })}`,
      { align: "center" }
    );

  // Divider
  pdfDoc.moveDown(1);
  pdfDoc
    .strokeColor("#E5E5E5")
    .lineWidth(1)
    .moveTo(50, pdfDoc.y)
    .lineTo(545, pdfDoc.y)
    .stroke();
  pdfDoc.moveDown(1);

  // Content
  const blocks = htmlToBlocks(renderedContent);
  for (const block of blocks) {
    switch (block.type) {
      case "h2":
        pdfDoc.moveDown(0.8);
        pdfDoc.fontSize(14).font("Helvetica-Bold").fillColor("#1A1A1A").text(block.text);
        pdfDoc.moveDown(0.3);
        break;
      case "h3":
        pdfDoc.moveDown(0.5);
        pdfDoc.fontSize(12).font("Helvetica-Bold").fillColor("#333333").text(block.text);
        pdfDoc.moveDown(0.2);
        break;
      case "h4":
        pdfDoc.moveDown(0.3);
        pdfDoc.fontSize(11).font("Helvetica-Bold").fillColor("#444444").text(block.text);
        pdfDoc.moveDown(0.1);
        break;
      case "li":
        pdfDoc.fontSize(10).font("Helvetica").fillColor("#333333").text(`  •  ${block.text}`, { indent: 15 });
        break;
      case "p":
      default:
        pdfDoc.fontSize(10).font("Helvetica").fillColor("#333333").text(block.text, { lineGap: 3 });
        pdfDoc.moveDown(0.2);
        break;
    }
  }

  // Footer
  const companyName = companyInfo?.name || "Beli & Jolie";
  pdfDoc.moveDown(2);
  pdfDoc
    .strokeColor("#E5E5E5")
    .lineWidth(0.5)
    .moveTo(50, pdfDoc.y)
    .lineTo(545, pdfDoc.y)
    .stroke();
  pdfDoc.moveDown(0.5);
  pdfDoc
    .fontSize(8)
    .font("Helvetica")
    .fillColor("#999999")
    .text(`${companyName} — ${doc.title} — ${new Date().getFullYear()}`, { align: "center" });

  pdfDoc.end();

  // Wait for all chunks
  const buffer = await new Promise<Buffer>((resolve) => {
    pdfDoc.on("end", () => {
      resolve(Buffer.concat(chunks));
    });
  });

  const filename = `${doc.title.replace(/[^a-zA-Z0-9àâäéèêëïîôùûüÿçæœ\s-]/g, "").replace(/\s+/g, "-")}.pdf`;

  return new NextResponse(buffer as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
