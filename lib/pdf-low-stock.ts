/**
 * lib/pdf-low-stock.ts
 *
 * Génère un PDF « stock faible » — une page par produit, chaque ligne =
 * couleur avec palette / nom / stock (0 en rouge, <10 en orange) + image
 * en grand format.
 */

import PDFDocument from "pdfkit";
import sharp from "sharp";
import { readFile, keyFromDbPath } from "@/lib/storage";
import { prisma } from "@/lib/prisma";
import type { ProductForReport } from "@/lib/low-stock-report";

const C = {
  primary:     "#0F172A",
  secondary:   "#334155",
  muted:       "#64748B",
  border:      "#E2E8F0",
  surfaceAlt:  "#F8FAFC",
  headerBg:    "#0F172A",
  headerText:  "#FFFFFF",
  headerSub:   "#94A3B8",
  outText:     "#B91C1C", // rouge foncé pour stock = 0
  outBg:       "#FEE2E2",
  lowText:     "#C2410C", // orange foncé pour stock < 10
  lowBg:       "#FFEDD5",
};

function rgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function formatDate(d: Date) {
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
}

/** Charge une image locale et la convertit en PNG carré (pdfkit ne lit pas WebP). */
async function resolveImageBuffer(imagePath: string | null): Promise<Buffer | null> {
  if (!imagePath) return null;
  try {
    const raw = await readFile(keyFromDbPath(imagePath));
    return Buffer.from(await sharp(raw).png().toBuffer());
  } catch {
    return null;
  }
}

/** Charge un motif de couleur (patternImage) et le convertit en PNG. */
async function resolvePatternBuffer(patternPath: string | null): Promise<Buffer | null> {
  return resolveImageBuffer(patternPath);
}

export async function generateLowStockPDF(products: ProductForReport[]): Promise<Buffer> {
  const company = await prisma.companyInfo.findFirst({
    select: { shopName: true, name: true },
  });
  const shopName = company?.shopName || company?.name || "Ma Boutique";
  const generatedAt = new Date();

  // Précharge toutes les images produits + motifs de couleur en parallèle.
  const imageBuffers = new Map<string, Buffer>();
  const patternBuffers = new Map<string, Buffer>();
  await Promise.all(
    products.flatMap((p) =>
      p.colors.map(async (c) => {
        if (c.firstImagePath && !imageBuffers.has(c.firstImagePath)) {
          const buf = await resolveImageBuffer(c.firstImagePath);
          if (buf) imageBuffers.set(c.firstImagePath, buf);
        }
        if (c.color?.patternImage && !patternBuffers.has(c.color.patternImage)) {
          const buf = await resolvePatternBuffer(c.color.patternImage);
          if (buf) patternBuffers.set(c.color.patternImage, buf);
        }
      }),
    ),
  );

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({
      size: "A4",
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      bufferPages: true,
    });

    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const PW = 595.28;
    const PH = 841.89;
    const ML = 40;
    const MR = 40;
    const CW = PW - ML - MR;

    // Ligne = 1 couleur : image à gauche (grand format), palette + nom + stock à droite.
    // IMG_SIZE 270 = ~3× la taille précédente pour bien voir la couleur/produit.
    const IMG_SIZE = 270;
    const ROW_H = IMG_SIZE + 20;
    const SWATCH = 36;
    const BOTTOM_LIMIT = PH - 40;

    let firstPage = true;
    let y = 0;

    function drawHeader(pageIndex: number, totalPages: number, product: ProductForReport) {
      const H = 90;
      doc.rect(0, 0, PW, H).fill(rgb(C.headerBg));

      doc.font("Helvetica-Bold").fontSize(16).fillColor(rgb(C.headerText));
      doc.text(shopName.toUpperCase(), ML, 18, { characterSpacing: 2 });

      doc.font("Helvetica").fontSize(9).fillColor(rgb(C.headerSub));
      doc.text("RAPPORT STOCK FAIBLE", ML, 42, { characterSpacing: 3 });
      doc.text(formatDate(generatedAt), ML, 56);

      // Bloc pagination à droite
      const rightW = 200;
      const rightX = PW - MR - rightW;
      doc.font("Helvetica").fontSize(8).fillColor(rgb(C.headerSub));
      doc.text(`Page ${pageIndex} / ${totalPages}`, rightX, 22, { width: rightW, align: "right" });
      doc.font("Helvetica-Bold").fontSize(11).fillColor(rgb(C.headerText));
      doc.text(product.reference, rightX, 40, { width: rightW, align: "right" });
      if (product.category) {
        doc.font("Helvetica").fontSize(8).fillColor(rgb(C.headerSub));
        doc.text(product.category, rightX, 58, { width: rightW, align: "right" });
      }

      y = H + 18;

      // Titre produit
      doc.font("Helvetica-Bold").fontSize(18).fillColor(rgb(C.primary));
      doc.text(product.name, ML, y, { width: CW });
      y += 26;

      // Sous-titre : nb couleurs en alerte
      const outCount = product.colors.filter((c) => c.level === "out").length;
      const lowCount = product.colors.filter((c) => c.level === "low").length;
      const parts: string[] = [];
      if (outCount > 0) parts.push(`${outCount} en rupture`);
      if (lowCount > 0) parts.push(`${lowCount} presque en rupture`);
      doc.font("Helvetica").fontSize(10).fillColor(rgb(C.muted));
      doc.text(parts.join(" · "), ML, y);
      y += 20;

      // Bandeau colonnes
      doc.rect(ML, y, CW, 22).fill(rgb(C.surfaceAlt));
      doc.font("Helvetica-Bold").fontSize(8).fillColor(rgb(C.muted));
      doc.text("PHOTO",           ML + 10, y + 7, { characterSpacing: 1.5 });
      doc.text("COULEUR / STOCK", ML + 10 + IMG_SIZE + 24, y + 7, { characterSpacing: 1.5 });
      y += 22 + 6;
    }

    function drawEmptyState() {
      const H = 90;
      doc.rect(0, 0, PW, H).fill(rgb(C.headerBg));
      doc.font("Helvetica-Bold").fontSize(16).fillColor(rgb(C.headerText));
      doc.text(shopName.toUpperCase(), ML, 18, { characterSpacing: 2 });
      doc.font("Helvetica").fontSize(9).fillColor(rgb(C.headerSub));
      doc.text("RAPPORT STOCK FAIBLE", ML, 42, { characterSpacing: 3 });
      doc.text(formatDate(generatedAt), ML, 56);
      y = H + 60;
      doc.font("Helvetica-Bold").fontSize(14).fillColor(rgb(C.primary));
      doc.text("Aucun produit en rupture ou presque en rupture.", ML, y, { width: CW, align: "center" });
      y += 24;
      doc.font("Helvetica").fontSize(10).fillColor(rgb(C.muted));
      doc.text(
        `Toutes les variantes actives ont un stock supérieur ou égal à 10.`,
        ML, y, { width: CW, align: "center" },
      );
    }

    function drawColorRow(c: ProductForReport["colors"][number]) {
      const rowY = y;
      // Bordure fine autour de la ligne
      doc.roundedRect(ML, rowY, CW, ROW_H, 6)
        .lineWidth(0.8).strokeColor(rgb(C.border)).stroke();

      // Image (à gauche)
      const imgX = ML + 10;
      const imgY = rowY + (ROW_H - IMG_SIZE) / 2;
      const buf = c.firstImagePath ? imageBuffers.get(c.firstImagePath) : null;
      if (buf) {
        try {
          doc.save();
          doc.roundedRect(imgX, imgY, IMG_SIZE, IMG_SIZE, 4).clip();
          doc.image(buf, imgX, imgY, { fit: [IMG_SIZE, IMG_SIZE], align: "center", valign: "center" });
          doc.restore();
          doc.roundedRect(imgX, imgY, IMG_SIZE, IMG_SIZE, 4)
            .lineWidth(0.5).strokeColor(rgb(C.border)).stroke();
        } catch {
          // Image invalide — placeholder gris
          doc.roundedRect(imgX, imgY, IMG_SIZE, IMG_SIZE, 4).fill(rgb(C.surfaceAlt));
        }
      } else {
        doc.roundedRect(imgX, imgY, IMG_SIZE, IMG_SIZE, 6).fill(rgb(C.surfaceAlt));
        doc.font("Helvetica").fontSize(11).fillColor(rgb(C.muted));
        doc.text("Pas de photo", imgX, imgY + IMG_SIZE / 2 - 6, {
          width: IMG_SIZE, align: "center",
        });
      }

      // Colonne droite (à droite de l'image agrandie) : palette + nom en haut,
      // badge stock en bas, sur toute la hauteur de la ligne.
      const colX = imgX + IMG_SIZE + 24;
      const colW = ML + CW - colX - 14;

      // ── Top de la colonne : palette + nom couleur ───────────────────────
      const topY = rowY + 24;
      const swatchY = topY;
      const pattern = c.color?.patternImage ? patternBuffers.get(c.color.patternImage) : null;
      if (pattern) {
        try {
          doc.save();
          doc.roundedRect(colX, swatchY, SWATCH, SWATCH, 6).clip();
          doc.image(pattern, colX, swatchY, { fit: [SWATCH, SWATCH], align: "center", valign: "center" });
          doc.restore();
        } catch {
          const hex = c.color?.hex ?? "#CBD5E1";
          doc.roundedRect(colX, swatchY, SWATCH, SWATCH, 6).fill(rgb(hex));
        }
      } else {
        const hex = c.color?.hex ?? "#CBD5E1";
        doc.roundedRect(colX, swatchY, SWATCH, SWATCH, 6).fill(rgb(hex));
      }
      doc.roundedRect(colX, swatchY, SWATCH, SWATCH, 6)
        .lineWidth(0.5).strokeColor(rgb(C.border)).stroke();

      // Nom couleur sous la palette (colonne étroite ~200px, on peut wrapper).
      const nameY = swatchY + SWATCH + 14;
      doc.font("Helvetica-Bold").fontSize(16).fillColor(rgb(C.primary));
      doc.text(c.color?.name ?? "—", colX, nameY, { width: colW });

      // ── Bas de la colonne : badge stock large et centré ─────────────────
      const isOut = c.level === "out";
      const badgeBg = isOut ? C.outBg : C.lowBg;
      const badgeText = isOut ? C.outText : C.lowText;
      const badgeW = Math.min(colW, 170);
      const badgeH = 70;
      const badgeX = colX + (colW - badgeW) / 2;
      const badgeY = rowY + ROW_H - badgeH - 24;

      doc.roundedRect(badgeX, badgeY, badgeW, badgeH, 12).fill(rgb(badgeBg));
      doc.font("Helvetica-Bold").fontSize(9).fillColor(rgb(badgeText));
      doc.text(isOut ? "RUPTURE" : "STOCK FAIBLE", badgeX, badgeY + 10, {
        width: badgeW, align: "center", characterSpacing: 2,
      });
      doc.font("Helvetica-Bold").fontSize(34).fillColor(rgb(badgeText));
      doc.text(String(c.stock), badgeX, badgeY + 26, {
        width: badgeW, align: "center",
      });

      y += ROW_H + 8;
    }

    // ── Cas vide ─────────────────────────────────────────────────────────
    if (products.length === 0) {
      drawEmptyState();
      doc.end();
      return;
    }

    // ── Une page par produit ─────────────────────────────────────────────
    const total = products.length;
    products.forEach((product, idx) => {
      if (!firstPage) doc.addPage();
      firstPage = false;
      drawHeader(idx + 1, total, product);

      for (const c of product.colors) {
        // Si la ligne dépasse le bas, on ouvre une nouvelle page « suite »
        // pour le même produit (rare : produit avec >5 couleurs en alerte).
        if (y + ROW_H > BOTTOM_LIMIT) {
          doc.addPage();
          drawHeader(idx + 1, total, product);
        }
        drawColorRow(c);
      }
    });

    doc.end();
  });
}
