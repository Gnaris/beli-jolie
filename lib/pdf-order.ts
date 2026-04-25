/**
 * lib/pdf-order.ts
 *
 * Génération du bon de commande PDF avec pdfkit.
 * Design professionnel : tableau par catégorie, adresses facturation/livraison,
 * colonnes prix unitaire / total HT / total TTC.
 */

import PDFDocument from "pdfkit";
import sharp from "sharp";
import { readFile, keyFromDbPath } from "@/lib/storage";
import { prisma } from "@/lib/prisma";

// ─────────────────────────────────────────────
// Palette — Élégante et professionnelle
// ─────────────────────────────────────────────
const C = {
  primary:     "#1B1B1B",   // Titres, texte principal
  secondary:   "#4A4A4A",   // Texte secondaire
  muted:       "#8B8B8B",   // Labels, infos tertiaires
  accent:      "#2563EB",   // Bleu accent (numéro commande, liens)
  accentLight: "#EFF6FF",   // Fond bleu clair
  border:      "#E2E8F0",   // Bordures
  borderDark:  "#CBD5E1",   // Bordures appuyées
  surface:     "#FFFFFF",   // Fond blanc
  surfaceAlt:  "#F8FAFC",   // Fond alterné tableau
  headerBg:    "#0F172A",   // Fond header sombre
  headerText:  "#FFFFFF",   // Texte header
  headerSub:   "#94A3B8",   // Sous-texte header
  catBg:       "#F1F5F9",   // Fond catégorie
  catText:     "#334155",   // Texte catégorie
  totalBg:     "#0F172A",   // Fond total final
  totalText:   "#FFFFFF",   // Texte total final
  success:     "#059669",   // Vert pour montants positifs
  footerBg:    "#F8FAFC",   // Fond pied de page
  footerText:  "#64748B",   // Texte pied de page
};

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface OrderItemPDF {
  productName:  string;
  productRef:   string;
  colorName:    string;
  categoryName: string | null; // Catégorie du produit (pour regroupement)
  saleType:     string;
  packQty:      number | null;
  size:         string | null;
  sizesJson?:   string | null; // JSON: [{name, quantity}] — tailles avec quantités
  packDetails:  string | null; // JSON: [{colorName,size,qty}] — composition du pack
  imagePath:    string | null;
  unitPrice:    number;
  quantity:     number;
  lineTotal:    number;
  variantSnapshot?: string | null; // JSON: full variant details snapshot for legal traceability
}

export interface OrderPDFData {
  orderNumber:    string;
  createdAt:      Date;
  // Client (= adresse de facturation)
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
  // Remises
  clientDiscountAmt: number;
  promoCode:         string | null;
  promoDiscount:     number;
  creditApplied:     number;
  // TVA
  tvaRate:        number;
  subtotalHT:     number;
  tvaAmount:      number;
  totalTTC:       number;
  // Articles
  items:          OrderItemPDF[];
  // Options
  /** Si true, masque toutes les colonnes et sections de prix */
  hidePrices?:    boolean;
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function rgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function fmt(n: number) {
  return n.toFixed(2).replace(".", ",") + " \u20AC";
}

function formatDate(d: Date) {
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
}

function formatTime(d: Date) {
  return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

function tvaLabel(rate: number): string {
  if (rate === 0) return "0%";
  return `${(rate * 100).toFixed(0)}%`;
}

/** Lit une image locale et la convertit en PNG pour pdfkit (WebP non supporté) */
async function resolveImageBuffer(imagePath: string | null): Promise<Buffer | null> {
  if (!imagePath) return null;
  try {
    const raw = await readFile(keyFromDbPath(imagePath));
    // pdfkit ne supporte que JPEG et PNG — convertir via sharp
    return Buffer.from(await sharp(raw).png().toBuffer());
  } catch {
    return null;
  }
}

/** Regroupe les items par catégorie */
function groupByCategory(items: OrderItemPDF[]): Map<string, OrderItemPDF[]> {
  const groups = new Map<string, OrderItemPDF[]>();
  for (const item of items) {
    const cat = item.categoryName || "Autres";
    const list = groups.get(cat) || [];
    list.push(item);
    groups.set(cat, list);
  }
  return groups;
}

/** Construit la description de la variante (couleur, tailles, composition) */
function buildVariantDesc(item: OrderItemPDF): string {
  const parts: string[] = [];

  if (item.saleType === "PACK" && item.packQty) {
    parts.push(`Paquet de ${item.packQty} pcs`);
  }

  if (item.sizesJson) {
    try {
      const sizes: { name: string; quantity: number }[] = JSON.parse(item.sizesJson);
      if (sizes.length > 0) {
        parts.push(sizes.map(s => `${s.name}\u00D7${s.quantity}`).join(", "));
      }
    } catch { /* ignore */ }
  } else if (item.size) {
    parts.push(`Taille : ${item.size}`);
  }

  if (item.packDetails) {
    try {
      const entries: { colors: string[] }[] = JSON.parse(item.packDetails);
      if (entries.length > 0) {
        const compStr = entries.map(e => e.colors.join("/")).join(", ");
        parts.push(compStr);
      }
    } catch { /* ignore */ }
  }

  return parts.join(" \u2014 ");
}

// ─────────────────────────────────────────────
// Génération principale
// ─────────────────────────────────────────────

export async function generateOrderPDF(data: OrderPDFData): Promise<Buffer> {
  const company = await prisma.companyInfo.findFirst({
    select: {
      shopName: true, name: true, legalForm: true, siret: true,
      tvaNumber: true, address: true, city: true, postalCode: true,
      country: true, phone: true, email: true, website: true,
    },
  });
  const shopName = company?.shopName || company?.name || "Ma Boutique";

  // Prefetch all item images from local storage in parallel
  const imageBuffers = new Map<string, Buffer>();
  await Promise.all(
    data.items.map(async (item) => {
      if (item.imagePath) {
        const buf = await resolveImageBuffer(item.imagePath);
        if (buf) imageBuffers.set(item.imagePath, buf);
      }
    })
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

    const PW = 595.28;  // A4 width
    const PH = 841.89;  // A4 height
    const ML = 40;      // Marge gauche
    const MR = 40;      // Marge droite
    const CW = PW - ML - MR; // Largeur utile

    const FOOTER_H = 50;
    const BOTTOM_LIMIT = PH - FOOTER_H - 30;

    let y = 0;
    let pageNum = 0;

    function checkPageBreak(needed: number): void {
      if (y + needed > BOTTOM_LIMIT) {
        doc.addPage();
        pageNum++;
        y = 40;
      }
    }

    function drawLine(x: number, yPos: number, w: number, color = C.border, thickness = 0.5): void {
      doc.lineWidth(thickness).strokeColor(rgb(color)).moveTo(x, yPos).lineTo(x + w, yPos).stroke();
    }

    // ════════════════════════════════════════════════════════════════════════
    // EN-TÊTE — Bandeau sombre avec infos boutique + numéro commande
    // ════════════════════════════════════════════════════════════════════════

    const HEADER_H = 90;
    doc.rect(0, 0, PW, HEADER_H).fill(rgb(C.headerBg));

    // Nom de la boutique
    doc.font("Helvetica-Bold").fontSize(20).fillColor(rgb(C.headerText));
    doc.text(shopName.toUpperCase(), ML, 20, { characterSpacing: 2 });

    // Sous-titre
    doc.font("Helvetica").fontSize(9).fillColor(rgb(C.headerSub));
    doc.text("BON DE COMMANDE", ML, 50, { characterSpacing: 3 });

    // Bloc numéro de commande à droite
    const orderBadgeW = 180;
    const orderBadgeX = PW - MR - orderBadgeW;
    doc.roundedRect(orderBadgeX, 18, orderBadgeW, 50, 6).fill(rgb(C.accent));
    doc.font("Helvetica").fontSize(8).fillColor(rgb(C.headerText));
    doc.text("N\u00B0 DE COMMANDE", orderBadgeX, 24, { width: orderBadgeW, align: "center" });
    doc.font("Helvetica-Bold").fontSize(14).fillColor(rgb(C.headerText));
    doc.text(data.orderNumber, orderBadgeX, 38, { width: orderBadgeW, align: "center" });

    // Date et heure sous le badge
    doc.font("Helvetica").fontSize(8).fillColor(rgb(C.headerSub));
    doc.text(
      `${formatDate(data.createdAt)}  \u00B7  ${formatTime(data.createdAt)}`,
      orderBadgeX, 72, { width: orderBadgeW, align: "center" }
    );

    y = HEADER_H + 20;

    // ════════════════════════════════════════════════════════════════════════
    // BLOC ADRESSES — Facturation (gauche) + Livraison (droite)
    // ════════════════════════════════════════════════════════════════════════

    const addrColW = (CW - 20) / 2;
    const addrH = 130;

    // --- Facturation (gauche) ---
    doc.roundedRect(ML, y, addrColW, addrH, 4)
      .lineWidth(0.5).strokeColor(rgb(C.border)).stroke();

    // Étiquette
    const labelY = y + 10;
    doc.font("Helvetica-Bold").fontSize(7).fillColor(rgb(C.accent));
    doc.text("FACTURATION", ML + 14, labelY, { characterSpacing: 2 });

    let ay = labelY + 16;
    doc.font("Helvetica-Bold").fontSize(10).fillColor(rgb(C.primary));
    doc.text(data.clientCompany, ML + 14, ay, { width: addrColW - 28 });
    ay += 15;

    doc.font("Helvetica").fontSize(8.5).fillColor(rgb(C.secondary));
    doc.text(`${data.clientFirstName} ${data.clientLastName}`, ML + 14, ay, { width: addrColW - 28 });
    ay += 12;
    doc.text(data.clientEmail, ML + 14, ay, { width: addrColW - 28 });
    ay += 12;
    doc.text(data.clientPhone, ML + 14, ay, { width: addrColW - 28 });
    ay += 14;

    doc.font("Helvetica").fontSize(7.5).fillColor(rgb(C.muted));
    doc.text(`SIRET : ${data.clientSiret}`, ML + 14, ay, { width: addrColW - 28 });
    if (data.clientVatNumber) {
      ay += 10;
      doc.text(`TVA Intra. : ${data.clientVatNumber}`, ML + 14, ay, { width: addrColW - 28 });
    }

    // --- Livraison (droite) ---
    const col2X = ML + addrColW + 20;
    doc.roundedRect(col2X, y, addrColW, addrH, 4)
      .lineWidth(0.5).strokeColor(rgb(C.border)).stroke();

    doc.font("Helvetica-Bold").fontSize(7).fillColor(rgb(C.success));
    doc.text("LIVRAISON", col2X + 14, y + 10, { characterSpacing: 2 });

    ay = y + 26;
    doc.font("Helvetica-Bold").fontSize(10).fillColor(rgb(C.primary));
    doc.text(data.shipLabel, col2X + 14, ay, { width: addrColW - 28 });
    ay += 15;

    doc.font("Helvetica").fontSize(8.5).fillColor(rgb(C.secondary));
    doc.text(`${data.shipFirstName} ${data.shipLastName}`, col2X + 14, ay, { width: addrColW - 28 });
    if (data.shipCompany) {
      ay += 12;
      doc.text(data.shipCompany, col2X + 14, ay, { width: addrColW - 28 });
    }
    ay += 12;
    doc.text(data.shipAddress1, col2X + 14, ay, { width: addrColW - 28 });
    if (data.shipAddress2) {
      ay += 12;
      doc.text(data.shipAddress2, col2X + 14, ay, { width: addrColW - 28 });
    }
    ay += 12;
    doc.text(`${data.shipZipCode} ${data.shipCity}`, col2X + 14, ay, { width: addrColW - 28 });
    ay += 12;
    doc.font("Helvetica-Bold").fontSize(8).fillColor(rgb(C.secondary));
    doc.text(data.shipCountry, col2X + 14, ay, { width: addrColW - 28 });

    y += addrH + 14;

    // ── Transporteur (barre fine) ───────────────────────────────────────
    const hp = !!data.hidePrices;
    doc.roundedRect(ML, y, CW, 26, 3).fill(rgb(C.accentLight));
    doc.font("Helvetica-Bold").fontSize(8).fillColor(rgb(C.accent));
    doc.text("TRANSPORTEUR", ML + 12, y + 8);
    doc.font("Helvetica").fontSize(8.5).fillColor(rgb(C.secondary));
    doc.text(data.carrierName, ML + 110, y + 8, { width: 200 });
    if (!hp) {
      doc.font("Helvetica-Bold").fontSize(8.5).fillColor(rgb(C.accent));
      doc.text(
        data.carrierPrice === 0 ? "Gratuit" : fmt(data.carrierPrice),
        ML, y + 8, { width: CW - 12, align: "right" }
      );
    }

    y += 40;

    // ════════════════════════════════════════════════════════════════════════
    // TABLEAU DES ARTICLES — Groupé par catégorie
    // ════════════════════════════════════════════════════════════════════════

    // ── En-tête du tableau ──────────────────────────────────────────────
    // PW=595.28, ML=MR=40 → CW=515.28. Toutes les colonnes doivent
    // totaliser exactement CW. On pose les offsets relatifs à ML.
    const IMG_W = 100; // 90px image + padding
    const COL = hp
      ? {
          // Sans prix : 4 colonnes (100+220+140+rest=55.28)
          img:   { x: ML,         w: 100 },
          name:  { x: ML + 100,   w: 220 },
          color: { x: ML + 320,   w: 140 },
          qty:   { x: ML + 460,   w: CW - 460 },  // 55.28
          unit:  { x: 0, w: 0 },
          ht:    { x: 0, w: 0 },
        }
      : {
          // Avec prix : 6 colonnes (100+145+85+40+72+rest=73.28)
          img:   { x: ML,         w: 100 },
          name:  { x: ML + 100,   w: 145 },
          color: { x: ML + 245,   w: 85 },
          qty:   { x: ML + 330,   w: 40 },
          unit:  { x: ML + 370,   w: 72 },
          ht:    { x: ML + 442,   w: CW - 442 },   // 73.28
        };

    function drawTableHeader(): void {
      doc.rect(ML, y, CW, 26).fill(rgb(C.headerBg));

      doc.font("Helvetica-Bold").fontSize(8).fillColor(rgb(C.headerText));
      doc.text("",               COL.img.x + 4,   y + 8, { width: COL.img.w });
      doc.text("ARTICLE",        COL.name.x + 8,  y + 8, { width: COL.name.w });
      doc.text("COULEUR / VARIANTE", COL.color.x + 4, y + 8, { width: COL.color.w });
      doc.text("QT\u00C9",       COL.qty.x + 4,   y + 8, { width: COL.qty.w - 8, align: "center" });
      if (!hp) {
        doc.text("PRIX UNIT.",    COL.unit.x + 4,  y + 8, { width: COL.unit.w, align: "right" });
        doc.text("TOTAL HT",     COL.ht.x + 4,    y + 8, { width: COL.ht.w - 8, align: "right" });
      }

      y += 26;
    }

    drawTableHeader();

    // ── Lignes par catégorie ──────────────────────────────────────────────
    const groups = groupByCategory(data.items);
    let rowIdx = 0;
    let totalItemCount = 0;

    for (const [category, items] of groups) {
      // Bandeau catégorie
      checkPageBreak(56); // category header + at least 1 row
      if (y <= 40) drawTableHeader(); // re-draw header after page break

      doc.rect(ML, y, CW, 22).fill(rgb(C.catBg));
      doc.font("Helvetica-Bold").fontSize(9).fillColor(rgb(C.catText));
      doc.text(category.toUpperCase(), ML + 12, y + 6, { characterSpacing: 1.5 });

      // Nombre d'articles dans la catégorie
      doc.font("Helvetica").fontSize(8).fillColor(rgb(C.muted));
      doc.text(
        `${items.length} article${items.length > 1 ? "s" : ""}`,
        ML, y + 6, { width: CW - 12, align: "right" }
      );

      y += 22;

      for (const item of items) {
        const variantDesc = buildVariantDesc(item);
        const nameH = Math.max(
          doc.font("Helvetica-Bold").fontSize(10).heightOfString(item.productName, { width: COL.name.w - 16 }),
          14
        );
        const variantH = variantDesc
          ? doc.font("Helvetica").fontSize(8).heightOfString(variantDesc, { width: hp ? COL.color.w - 10 : COL.color.w + COL.qty.w + COL.unit.w - 10 })
          : 0;
        const IMG_SIZE = 90;
        const rowH = Math.max(IMG_SIZE + 14, nameH + 30 + variantH);

        checkPageBreak(rowH + 2);
        if (y <= 40) {
          drawTableHeader();
          // Re-draw category header
          doc.rect(ML, y, CW, 20).fill(rgb(C.catBg));
          doc.font("Helvetica-Bold").fontSize(8).fillColor(rgb(C.catText));
          doc.text(category.toUpperCase() + " (suite)", ML + 12, y + 5, { characterSpacing: 1.5 });
          y += 20;
        }

        // Fond alterné
        if (rowIdx % 2 === 1) {
          doc.rect(ML, y, CW, rowH).fill(rgb(C.surfaceAlt));
        }

        // Image produit
        const imgBuffer = item.imagePath ? imageBuffers.get(item.imagePath) : undefined;
        const imgX = COL.img.x + 5;
        const imgY = y + (rowH - IMG_SIZE) / 2;
        let imageRendered = false;
        if (imgBuffer) {
          try {
            doc.image(imgBuffer, imgX, imgY, { fit: [IMG_SIZE, IMG_SIZE] });
            imageRendered = true;
          } catch {
            // Format non supporté — placeholder ci-dessous
          }
        }
        if (!imageRendered) {
          doc.roundedRect(imgX, imgY, IMG_SIZE, IMG_SIZE, 4).fill(rgb(C.surfaceAlt));
          doc.font("Helvetica").fontSize(7).fillColor(rgb(C.muted));
          doc.text("Image\nnon disponible", imgX, imgY + IMG_SIZE / 2 - 8, { width: IMG_SIZE, align: "center" });
        }

        // Nom du produit + référence — centré verticalement
        const textBlockH = nameH + 16 + variantH;
        const textStartY = y + Math.max(7, (rowH - textBlockH) / 2);

        doc.font("Helvetica-Bold").fontSize(10).fillColor(rgb(C.primary));
        doc.text(item.productName, COL.name.x + 8, textStartY, { width: COL.name.w - 16 });
        const afterName = textStartY + nameH + 3;
        doc.font("Helvetica").fontSize(7.5).fillColor(rgb(C.muted));
        doc.text(`R\u00E9f. ${item.productRef}`, COL.name.x + 8, afterName, { width: COL.name.w - 16 });

        // Couleur
        doc.font("Helvetica").fontSize(9).fillColor(rgb(C.secondary));
        doc.text(item.colorName, COL.color.x + 4, textStartY, { width: COL.color.w - 8 });

        // Détail variante (sous la couleur)
        if (variantDesc) {
          doc.font("Helvetica").fontSize(7.5).fillColor(rgb(C.muted));
          doc.text(variantDesc, COL.color.x + 4, textStartY + 14, { width: hp ? COL.color.w - 10 : COL.color.w + COL.qty.w + COL.unit.w - 10 });
        }

        // Quantité — centré verticalement
        doc.font("Helvetica-Bold").fontSize(11).fillColor(rgb(C.primary));
        doc.text(String(item.quantity), COL.qty.x + 4, textStartY, { width: COL.qty.w - 8, align: "center" });

        if (!hp) {
          // Prix unitaire HT
          doc.font("Helvetica").fontSize(9).fillColor(rgb(C.secondary));
          doc.text(fmt(item.unitPrice), COL.unit.x + 4, textStartY, { width: COL.unit.w - 8, align: "right" });

          // Total HT ligne
          doc.font("Helvetica-Bold").fontSize(10).fillColor(rgb(C.primary));
          doc.text(fmt(item.lineTotal), COL.ht.x + 4, textStartY, { width: COL.ht.w - 12, align: "right" });
        }

        // Séparateur léger
        drawLine(ML + 8, y + rowH - 0.5, CW - 16, C.border, 0.3);

        y += rowH;
        rowIdx++;
        totalItemCount += item.quantity;
      }
    }

    // Ligne de fermeture tableau
    drawLine(ML, y, CW, C.borderDark, 1);
    y += 4;

    // ── Résumé articles ──────────────────────────────────────────────
    doc.font("Helvetica").fontSize(7.5).fillColor(rgb(C.muted));
    doc.text(
      `${data.items.length} r\u00E9f\u00E9rence${data.items.length > 1 ? "s" : ""} \u00B7 ${totalItemCount} pi\u00E8ce${totalItemCount > 1 ? "s" : ""} au total`,
      ML, y + 2
    );

    y += 18;

    // ════════════════════════════════════════════════════════════════════════
    // SECTION TOTAUX — Alignée à droite (masquée si hidePrices)
    // ════════════════════════════════════════════════════════════════════════

    if (!hp) {
      checkPageBreak(160);

      const TOTALS_W = 240;
      const TOTALS_X = PW - MR - TOTALS_W;

      const totalRow = (label: string, value: string, opts?: {
        bold?: boolean; labelColor?: string; valueColor?: string; fontSize?: number;
      }): void => {
        const fs = opts?.fontSize || 8.5;
        const fontName = opts?.bold ? "Helvetica-Bold" : "Helvetica";

        doc.font(fontName).fontSize(fs).fillColor(rgb(opts?.labelColor || C.secondary));
        doc.text(label, TOTALS_X, y, { width: 140 });
        doc.font(fontName).fontSize(fs).fillColor(rgb(opts?.valueColor || C.primary));
        doc.text(value, TOTALS_X, y, { width: TOTALS_W, align: "right" });
        y += opts?.bold ? 18 : 15;
      };

      // Sous-total brut (avant remises)
      const subtotalBrut = data.subtotalHT + data.clientDiscountAmt + data.promoDiscount + data.creditApplied;
      if (data.clientDiscountAmt > 0 || data.promoDiscount > 0 || data.creditApplied > 0) {
        totalRow("Sous-total articles HT", fmt(subtotalBrut));
      }

      // Remise commerciale
      if (data.clientDiscountAmt > 0) {
        totalRow("Remise commerciale", `\u2212 ${fmt(data.clientDiscountAmt)}`, { valueColor: C.success });
      }

      // Code promo
      if (data.promoDiscount > 0) {
        totalRow(
          data.promoCode ? `Code promo (${data.promoCode})` : "R\u00E9duction promotionnelle",
          `\u2212 ${fmt(data.promoDiscount)}`, { valueColor: C.success }
        );
      }

      // Avoir utilisé
      if (data.creditApplied > 0) {
        totalRow("Avoir utilis\u00E9", `\u2212 ${fmt(data.creditApplied)}`, { valueColor: C.success });
      }

      // Sous-total HT (après remises)
      totalRow("Sous-total HT", fmt(data.subtotalHT), { bold: true });

      // TVA
      const tvaNote = data.tvaRate === 0 ? " (autoliquidation)" : "";
      totalRow(`TVA ${tvaLabel(data.tvaRate)}${tvaNote}`, fmt(data.tvaAmount));

      // Livraison
      totalRow("Frais de livraison", data.carrierPrice === 0 ? "Offerts" : fmt(data.carrierPrice), {
        valueColor: data.carrierPrice === 0 ? C.success : C.primary,
      });

      y += 4;

      // ── Total TTC — Bloc sombre ──────────────────────────────────────
      const totalBoxH = 32;
      doc.roundedRect(TOTALS_X - 8, y, TOTALS_W + 8, totalBoxH, 4).fill(rgb(C.totalBg));

      doc.font("Helvetica-Bold").fontSize(11).fillColor(rgb(C.totalText));
      doc.text("TOTAL TTC", TOTALS_X + 4, y + 9, { width: 120 });
      doc.font("Helvetica-Bold").fontSize(13).fillColor(rgb(C.totalText));
      doc.text(fmt(data.totalTTC), TOTALS_X + 4, y + 8, { width: TOTALS_W - 8, align: "right" });

      y += totalBoxH + 16;

      // ── Note TVA 0% ──────────────────────────────────────────────────
      if (data.tvaRate === 0 && data.clientVatNumber) {
        checkPageBreak(30);
        doc.roundedRect(ML, y, CW, 24, 3).fill(rgb(C.accentLight));
        doc.font("Helvetica").fontSize(7).fillColor(rgb(C.accent));
        doc.text(
          `Autoliquidation de la TVA \u2014 Article 44 de la Directive 2006/112/CE. N\u00B0 TVA acheteur : ${data.clientVatNumber}`,
          ML + 10, y + 7, { width: CW - 20 }
        );
        y += 32;
      }
    }

    // ── Infos société émettrice ──────────────────────────────────────
    if (company) {
      checkPageBreak(50);
      drawLine(ML, y, CW, C.border, 0.5);
      y += 10;

      doc.font("Helvetica").fontSize(6.5).fillColor(rgb(C.muted));
      const companyLines: string[] = [];
      if (company.name) companyLines.push(company.name);
      if (company.legalForm) companyLines[0] = `${companyLines[0]} \u2014 ${company.legalForm}`;
      if (company.siret) companyLines.push(`SIRET : ${company.siret}`);
      if (company.tvaNumber) companyLines.push(`TVA Intra. : ${company.tvaNumber}`);
      const addrParts: string[] = [];
      if (company.address) addrParts.push(company.address);
      if (company.postalCode || company.city) addrParts.push([company.postalCode, company.city].filter(Boolean).join(" "));
      if (company.country && company.country !== "France") addrParts.push(company.country);
      if (addrParts.length > 0) companyLines.push(addrParts.join(", "));
      const contactParts: string[] = [];
      if (company.phone) contactParts.push(company.phone);
      if (company.email) contactParts.push(company.email);
      if (company.website) contactParts.push(company.website);
      if (contactParts.length > 0) companyLines.push(contactParts.join(" \u00B7 "));

      doc.text(companyLines.join("\n"), ML, y, { width: CW, align: "center", lineGap: 2 });
    }

    // ════════════════════════════════════════════════════════════════════════
    // PIED DE PAGE — toutes les pages
    // ════════════════════════════════════════════════════════════════════════

    const pageCount = doc.bufferedPageRange().count;
    for (let i = 0; i < pageCount; i++) {
      doc.switchToPage(i);
      const footerY = PH - FOOTER_H;

      // Ligne séparatrice
      doc.lineWidth(0.5).strokeColor(rgb(C.border))
        .moveTo(ML, footerY).lineTo(PW - MR, footerY).stroke();

      // Texte pied de page
      doc.font("Helvetica").fontSize(7).fillColor(rgb(C.footerText));
      doc.text(
        `${shopName} \u2014 Grossiste B2B  \u00B7  ${data.orderNumber}  \u00B7  ${formatDate(data.createdAt)}`,
        ML, footerY + 12, { width: CW * 0.7 }
      );

      doc.font("Helvetica").fontSize(7).fillColor(rgb(C.footerText));
      doc.text(
        `Page ${i + 1} / ${pageCount}`,
        ML, footerY + 12, { width: CW, align: "right" }
      );

      // Filet bas décoratif
      doc.rect(0, PH - 3, PW, 3).fill(rgb(C.accent));
    }

    doc.end();
  });
}
