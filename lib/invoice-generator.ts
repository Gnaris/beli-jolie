/**
 * lib/invoice-generator.ts
 *
 * Client-facing invoice PDF generation using pdfkit.
 * Reuses the monochrome style from pdf-order.ts.
 */

import PDFDocument from "pdfkit";
import { getCachedCompanyInfo, getCachedShopName } from "@/lib/cached-data";

interface OrderForInvoice {
  orderNumber: string;
  createdAt: Date;
  totalHT: number | { toNumber: () => number } | null;
  tvaAmount: number | { toNumber: () => number } | null;
  totalTTC: number | { toNumber: () => number } | null;
  shippingCost: number | { toNumber: () => number } | null;
  clientName: string;
  clientCompany: string;
  clientEmail: string;
  clientAddress: string;
  clientCity: string;
  clientZip: string;
  clientCountry: string;
  items: {
    productName: string;
    productRef: string;
    colorName: string | null;
    quantity: number;
    unitPrice: number | { toNumber: () => number } | null;
    lineTotal: number | { toNumber: () => number } | null;
  }[];
}

function toNum(v: number | { toNumber: () => number } | null | undefined): number {
  if (v == null) return 0;
  return typeof v === "number" ? v : v.toNumber();
}

export async function generateInvoicePdf(order: OrderForInvoice): Promise<Buffer> {
  const [shopName, companyInfo] = await Promise.all([
    getCachedShopName(),
    getCachedCompanyInfo(),
  ]);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks: Buffer[] = [];

    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // Header
    doc.fontSize(20).font("Helvetica-Bold").text(shopName || "Facture", 50, 50);
    doc.fontSize(10).font("Helvetica").fillColor("#666666");
    if (companyInfo?.address) doc.text(companyInfo.address, 50, 75);
    if (companyInfo?.email) doc.text(companyInfo.email);
    if (companyInfo?.siret) doc.text(`SIRET: ${companyInfo.siret}`);

    // Invoice info
    doc.fontSize(12).font("Helvetica-Bold").fillColor("#1A1A1A");
    doc.text(`Facture ${order.orderNumber}`, 350, 50);
    doc.fontSize(10).font("Helvetica").fillColor("#666666");
    doc.text(`Date: ${new Date(order.createdAt).toLocaleDateString("fr-FR")}`, 350, 70);

    // Client info
    const clientY = 140;
    doc.fontSize(10).font("Helvetica-Bold").fillColor("#1A1A1A").text("Facture a :", 50, clientY);
    doc.font("Helvetica").fillColor("#333333");
    doc.text(order.clientCompany || order.clientName, 50, clientY + 15);
    doc.text(order.clientName);
    doc.text(order.clientAddress);
    doc.text(`${order.clientZip} ${order.clientCity}`);
    doc.text(order.clientCountry);

    // Items table
    let y = 260;
    doc.fontSize(9).font("Helvetica-Bold").fillColor("#1A1A1A");
    doc.text("Ref", 50, y);
    doc.text("Produit", 120, y);
    doc.text("Couleur", 300, y);
    doc.text("Qte", 380, y, { width: 40, align: "right" });
    doc.text("Prix unit.", 420, y, { width: 60, align: "right" });
    doc.text("Total", 480, y, { width: 70, align: "right" });

    y += 15;
    doc.moveTo(50, y).lineTo(550, y).strokeColor("#E5E5E5").stroke();
    y += 5;

    doc.font("Helvetica").fillColor("#333333");
    for (const item of order.items) {
      if (y > 700) {
        doc.addPage();
        y = 50;
      }
      doc.text(item.productRef || "", 50, y, { width: 65 });
      doc.text(item.productName, 120, y, { width: 175 });
      doc.text(item.colorName || "", 300, y, { width: 75 });
      doc.text(String(item.quantity), 380, y, { width: 40, align: "right" });
      doc.text(`${toNum(item.unitPrice).toFixed(2)}`, 420, y, { width: 60, align: "right" });
      doc.text(`${toNum(item.lineTotal).toFixed(2)}`, 480, y, { width: 70, align: "right" });
      y += 18;
    }

    // Totals
    y += 10;
    doc.moveTo(380, y).lineTo(550, y).strokeColor("#E5E5E5").stroke();
    y += 10;

    doc.font("Helvetica").fillColor("#333333");
    doc.text("Total HT", 380, y, { width: 100 });
    doc.text(`${toNum(order.totalHT).toFixed(2)} EUR`, 480, y, { width: 70, align: "right" });
    y += 18;

    if (toNum(order.shippingCost) > 0) {
      doc.text("Livraison", 380, y, { width: 100 });
      doc.text(`${toNum(order.shippingCost).toFixed(2)} EUR`, 480, y, { width: 70, align: "right" });
      y += 18;
    }

    doc.text("TVA", 380, y, { width: 100 });
    doc.text(`${toNum(order.tvaAmount).toFixed(2)} EUR`, 480, y, { width: 70, align: "right" });
    y += 18;

    doc.font("Helvetica-Bold").fillColor("#1A1A1A");
    doc.text("Total TTC", 380, y, { width: 100 });
    doc.text(`${toNum(order.totalTTC).toFixed(2)} EUR`, 480, y, { width: 70, align: "right" });

    doc.end();
  });
}
