/**
 * lib/pdf-order.ts
 *
 * Génération du bon de commande PDF avec pdfkit.
 * Inclut les images produits, les détails des articles et les totaux.
 */

import PDFDocument from "pdfkit";
import path from "path";
import fs from "fs";

// ─────────────────────────────────────────────
// Couleurs — Monochrome theme
// ─────────────────────────────────────────────
const C = {
  rose:        "#1A1A1A",
  roseDark:    "#111111",
  roseLight:   "#E5E5E5",
  roseBg:      "#F7F7F8",
  sage:        "#6B6B6B",
  plum:        "#1A1A1A",
  plumLight:   "#6B6B6B",
  muted:       "#9CA3AF",
  surface:     "#FFFFFF",
  white:       "#FFFFFF",
  footerBg:    "#111111",
};

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface OrderItemPDF {
  productName: string;
  productRef:  string;
  colorName:   string;
  saleType:    string;
  packQty:     number | null;
  size:        string | null;
  packDetails: string | null; // JSON: [{colorName,size,qty}] — composition du pack
  imagePath:   string | null;
  unitPrice:   number;
  quantity:    number;
  lineTotal:   number;
}

export interface OrderPDFData {
  orderNumber:    string;
  createdAt:      Date;
  // Client
  clientCompany:  string;
  clientFirstName:string;
  clientLastName: string;
  clientEmail:    string;
  clientPhone:    string;
  clientSiret:    string;
  clientVatNumber:string | null;
  // Livraison
  shipLabel:      string;
  shipFirstName:  string;
  shipLastName:   string;
  shipCompany:    string | null;
  shipAddress1:   string;
  shipAddress2:   string | null;
  shipZipCode:    string;
  shipCity:       string;
  shipCountry:    string;
  // Transporteur
  carrierName:    string;
  carrierPrice:   number;
  // TVA
  tvaRate:        number;
  subtotalHT:     number;
  tvaAmount:      number;
  totalTTC:       number;
  // Articles
  items:          OrderItemPDF[];
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function hex2rgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function setFill(doc: PDFKit.PDFDocument, hex: string) {
  doc.fillColor(hex2rgb(hex) as [number, number, number]);
}

function fmt(n: number) {
  return n.toFixed(2).replace(".", ",") + " €";
}

function formatDate(d: Date) {
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
}

function tvaLabel(rate: number): string {
  if (rate === 0) return "0%";
  return `${(rate * 100).toFixed(0)}%`;
}

/** Résout un chemin d'image stocké en base (ex: /uploads/products/xxx.jpg) → chemin absolu */
function resolveImagePath(imagePath: string | null): string | null {
  if (!imagePath) return null;
  const abs = path.join(process.cwd(), "public", imagePath.replace(/^\//, ""));
  if (fs.existsSync(abs)) return abs;
  return null;
}

// ─────────────────────────────────────────────
// Génération principale
// ─────────────────────────────────────────────

export function generateOrderPDF(data: OrderPDFData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];

    const doc = new PDFDocument({
      size: "A4",
      margins: { top: 50, bottom: 50, left: 50, right: 50 },
      bufferPages: true,
    });

    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const W  = doc.page.width;   // 595
    const ML = 50;                // marge gauche
    const MR = 50;                // marge droite
    const CW = W - ML - MR;      // largeur utile = 495

    // ── En-tête ──────────────────────────────────────────────────────────────

    // Bandeau rose haut
    doc.rect(0, 0, W, 80).fill(hex2rgb(C.rose) as [number, number, number]);

    // Logo texte
    doc.font("Helvetica-Bold").fontSize(22);
    setFill(doc, C.white);
    doc.text("Beli & Jolie", ML, 22);

    doc.font("Helvetica").fontSize(10);
    setFill(doc, "#F8D5DC");
    doc.text("Bijoux Acier Inoxydable — Plateforme BtoB", ML, 48);

    // N° commande à droite
    const orderLabel = `N° ${data.orderNumber}`;
    doc.font("Helvetica-Bold").fontSize(12);
    setFill(doc, C.white);
    doc.text(orderLabel, ML, 22, { width: CW, align: "right" });

    doc.font("Helvetica").fontSize(9);
    doc.text(`Date : ${formatDate(data.createdAt)}`, ML, 40, { width: CW, align: "right" });

    let y = 100;

    // ── Section client + adresse (deux colonnes) ──────────────────────────────

    const colW = (CW - 20) / 2;

    // Fond section
    doc.rect(ML, y, CW, 110).fill(hex2rgb(C.surface) as [number, number, number]);
    doc.rect(ML, y, CW, 110).stroke(hex2rgb(C.roseLight) as [number, number, number]);

    // Colonne gauche — infos client
    y += 10;
    doc.font("Helvetica-Bold").fontSize(8);
    setFill(doc, C.rose);
    doc.text("CLIENT", ML + 10, y, { characterSpacing: 1 });

    y += 14;
    doc.font("Helvetica-Bold").fontSize(10);
    setFill(doc, C.plum);
    doc.text(data.clientCompany, ML + 10, y, { width: colW - 10 });

    y += 14;
    doc.font("Helvetica").fontSize(9);
    setFill(doc, C.plumLight);
    doc.text(`${data.clientFirstName} ${data.clientLastName}`, ML + 10, y, { width: colW - 10 });
    y += 12;
    doc.text(data.clientEmail, ML + 10, y, { width: colW - 10 });
    y += 12;
    doc.text(data.clientPhone, ML + 10, y, { width: colW - 10 });
    y += 12;
    doc.font("Courier").fontSize(8);
    setFill(doc, C.muted);
    doc.text(`SIRET : ${data.clientSiret}`, ML + 10, y, { width: colW - 10 });
    if (data.clientVatNumber) {
      y += 11;
      doc.text(`N° TVA : ${data.clientVatNumber}`, ML + 10, y, { width: colW - 10 });
    }

    // Colonne droite — adresse livraison
    const col2X = ML + colW + 20;
    y = 110;
    doc.font("Helvetica-Bold").fontSize(8);
    setFill(doc, C.sage);
    doc.text("ADRESSE DE LIVRAISON", col2X, y, { characterSpacing: 1 });

    y += 14;
    doc.font("Helvetica-Bold").fontSize(10);
    setFill(doc, C.plum);
    doc.text(data.shipLabel, col2X, y, { width: colW });

    y += 14;
    doc.font("Helvetica").fontSize(9);
    setFill(doc, C.plumLight);
    doc.text(`${data.shipFirstName} ${data.shipLastName}`, col2X, y, { width: colW });
    if (data.shipCompany) {
      y += 12;
      doc.text(data.shipCompany, col2X, y, { width: colW });
    }
    y += 12;
    doc.text(data.shipAddress1, col2X, y, { width: colW });
    if (data.shipAddress2) {
      y += 12;
      doc.text(data.shipAddress2, col2X, y, { width: colW });
    }
    y += 12;
    doc.text(`${data.shipZipCode} ${data.shipCity}`, col2X, y, { width: colW });
    y += 12;
    doc.text(data.shipCountry, col2X, y, { width: colW });

    y = 220;

    // ── Transporteur ─────────────────────────────────────────────────────────

    doc.rect(ML, y, CW, 30).fill(hex2rgb(C.roseBg) as [number, number, number]);
    doc.rect(ML, y, CW, 30).stroke(hex2rgb(C.roseLight) as [number, number, number]);

    doc.font("Helvetica-Bold").fontSize(9);
    setFill(doc, C.plum);
    doc.text("TRANSPORTEUR :", ML + 10, y + 10);

    doc.font("Helvetica").fontSize(9);
    setFill(doc, C.plumLight);
    doc.text(data.carrierName, ML + 110, y + 10, { width: 200 });

    doc.font("Helvetica-Bold").fontSize(9);
    setFill(doc, C.rose);
    doc.text(data.carrierPrice === 0 ? "Gratuit" : fmt(data.carrierPrice), ML + 10, y + 10, { width: CW - 20, align: "right" });

    y = 265;

    // ── Titre section articles ─────────────────────────────────────────────────

    doc.font("Helvetica-Bold").fontSize(9);
    setFill(doc, C.rose);
    doc.text("ARTICLES COMMANDÉS", ML, y, { characterSpacing: 1 });

    y += 6;
    doc.rect(ML, y, CW, 1).fill(hex2rgb(C.rose) as [number, number, number]);
    y += 12;

    // ── Articles ─────────────────────────────────────────────────────────────

    const IMG_W  = 120;
    const IMG_H  = 120;
    const IMG_GAP = 16;
    const TEXT_X  = ML + IMG_W + IMG_GAP;
    const TEXT_W  = CW - IMG_W - IMG_GAP;

    for (const item of data.items) {
      const rowH = IMG_H + 16;

      // Page break
      if (y + rowH > doc.page.height - 150) {
        doc.addPage();
        y = 50;
      }

      // Fond léger
      doc.rect(ML, y, CW, rowH).fill(hex2rgb(C.surface) as [number, number, number]);
      doc.rect(ML, y, CW, rowH).stroke(hex2rgb(C.roseLight) as [number, number, number]);

      // Image produit
      const imgPath = resolveImagePath(item.imagePath);
      if (imgPath) {
        try {
          doc.image(imgPath, ML + 8, y + 8, { width: IMG_W - 16, height: IMG_H - 16, fit: [IMG_W - 16, IMG_H - 16] });
        } catch {
          // Image corrompue — placeholder
          doc.rect(ML + 8, y + 8, IMG_W - 16, IMG_H - 16).fill(hex2rgb(C.roseBg) as [number, number, number]);
        }
      } else {
        // Placeholder
        doc.rect(ML + 8, y + 8, IMG_W - 16, IMG_H - 16).fill(hex2rgb(C.roseBg) as [number, number, number]);
        doc.font("Helvetica").fontSize(8);
        setFill(doc, C.muted);
        doc.text("Image\nnon\ndisponible", ML + 8, y + 42, { width: IMG_W - 16, align: "center" });
      }

      // Nom produit
      let ty = y + 10;
      doc.font("Helvetica-Bold").fontSize(11);
      setFill(doc, C.plum);
      doc.text(item.productName, TEXT_X, ty, { width: TEXT_W - 10 });
      ty += doc.heightOfString(item.productName, { width: TEXT_W - 10 }) + 4;

      // Référence
      doc.font("Courier").fontSize(8);
      setFill(doc, C.muted);
      doc.text(`Réf. ${item.productRef}`, TEXT_X, ty, { width: TEXT_W - 10 });
      ty += 14;

      // Détails
      doc.font("Helvetica").fontSize(9);
      setFill(doc, C.plumLight);

      const details: string[] = [
        `Couleur : ${item.colorName}`,
        item.saleType === "UNIT"
          ? "Vendu à l'unité"
          : `Paquet de ${item.packQty} pièces`,
      ];
      if (item.size) details.push(`Taille : ${item.size}`);

      doc.text(details.join("  ·  "), TEXT_X, ty, { width: TEXT_W - 10 });
      ty += 16;

      // Pack composition details (if multi-entry pack)
      if (item.packDetails) {
        try {
          const entries: { colorName: string; size: string; qty: number }[] = JSON.parse(item.packDetails);
          if (entries.length > 0) {
            doc.font("Helvetica").fontSize(8);
            setFill(doc, C.muted);
            const compLines = entries.map((e) => `${e.qty}× ${e.colorName} ${e.size}`);
            doc.text(compLines.join("  ·  "), TEXT_X + 5, ty, { width: TEXT_W - 15 });
            ty += Math.ceil(compLines.length / 4) * 12 + 4;
          }
        } catch { /* ignore parse errors on legacy orders */ }
      }

      // Prix ligne
      // déjà calculé dans lineTotal
      doc.font("Helvetica").fontSize(9);
      setFill(doc, C.plumLight);
      doc.text(
        `${item.quantity} × ${fmt(item.unitPrice)}`,
        TEXT_X, ty, { width: TEXT_W - 100 }
      );

      doc.font("Helvetica-Bold").fontSize(12);
      setFill(doc, C.rose);
      doc.text(fmt(item.lineTotal), TEXT_X, ty, { width: TEXT_W - 10, align: "right" });

      y += rowH + 8;
    }

    // ── Totaux ───────────────────────────────────────────────────────────────

    // Page break si besoin
    if (y + 120 > doc.page.height - 60) {
      doc.addPage();
      y = 50;
    }

    y += 6;
    doc.rect(ML, y, CW, 1).fill(hex2rgb(C.roseLight) as [number, number, number]);
    y += 12;

    const totalsX = ML + CW - 220;
    const totalsW = 220;

    function totalRow(label: string, value: string, bold = false, color = C.plum) {
      doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(bold ? 11 : 9);
      setFill(doc, bold ? C.plumLight : C.plumLight);
      doc.text(label, totalsX, y, { width: 130 });
      doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(bold ? 11 : 9);
      setFill(doc, color);
      doc.text(value, totalsX, y, { width: totalsW, align: "right" });
      y += bold ? 18 : 14;
    }

    totalRow("Sous-total HT", fmt(data.subtotalHT));
    totalRow(
      `TVA (${tvaLabel(data.tvaRate)}${data.tvaRate === 0 ? " — autoliquidation/exonéré" : ""})`,
      fmt(data.tvaAmount)
    );
    totalRow("Livraison", data.carrierPrice === 0 ? "Gratuit" : fmt(data.carrierPrice));

    y += 4;
    doc.rect(totalsX, y, totalsW, 1).fill(hex2rgb(C.rose) as [number, number, number]);
    y += 8;

    // Fond rose total
    doc.rect(totalsX - 10, y - 4, totalsW + 10, 28).fill(hex2rgb(C.rose) as [number, number, number]);
    doc.font("Helvetica-Bold").fontSize(13);
    setFill(doc, C.white);
    doc.text("TOTAL TTC", totalsX, y + 4, { width: 130 });
    doc.text(fmt(data.totalTTC), totalsX, y + 4, { width: totalsW, align: "right" });

    y += 40;

    // ── Note si TVA 0% ────────────────────────────────────────────────────────

    if (data.tvaRate === 0 && data.clientVatNumber) {
      doc.rect(ML, y, CW, 28).fill(hex2rgb(C.roseBg) as [number, number, number]);
      doc.font("Helvetica").fontSize(8);
      setFill(doc, C.plumLight);
      doc.text(
        `Autoliquidation de la TVA — Article 44 de la Directive 2006/112/CE. N° TVA acheteur : ${data.clientVatNumber}`,
        ML + 10, y + 9, { width: CW - 20 }
      );
      y += 36;
    }

    // ── Pied de page ─────────────────────────────────────────────────────────

    const pageCount = (doc.bufferedPageRange().count);
    for (let i = 0; i < pageCount; i++) {
      doc.switchToPage(i);
      const footerY = doc.page.height - 40;
      doc.rect(0, footerY, W, 40).fill(hex2rgb(C.footerBg) as [number, number, number]);
      doc.font("Helvetica").fontSize(8);
      setFill(doc, "#9CA3AF");
      doc.text(
        `Beli & Jolie — Bijoux Acier Inoxydable BtoB  ·  ${data.orderNumber}  ·  Page ${i + 1} / ${pageCount}`,
        ML, footerY + 14, { width: CW, align: "center" }
      );
    }

    doc.end();
  });
}
