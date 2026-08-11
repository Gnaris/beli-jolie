/**
 * Définition des blocs newsletter + rendu HTML pour l'envoi.
 *
 * Un modèle newsletter est un tableau JSON de NewsletterBlock. Chaque bloc
 * a un `type` et un `data` typé selon le type.
 *
 * Utilisé côté serveur pour rendre le HTML final envoyé au client,
 * et côté client pour l'éditeur visuel (SendMailModal + éditeur dédié).
 */

import { escapeHtml, absoluteUrl, formatEuros, ctaButton, wrapMail, type SharedMailContext } from "@/lib/mail-templates/shared";

export type NewsletterBlockType =
  | "banner"
  | "heading"
  | "callout"
  | "button"
  | "products"
  | "imgtext"
  | "list"
  | "divider"
  | "empty"
  | "columns"
  | "footer";

export interface BannerData { img: string; alt: string; bg?: string; height?: number; fit?: "cover" | "contain" }
export interface HeadingData { title: string; body: string; align: "left" | "center" | "right"; bg?: string; titleColor?: string; bodyColor?: string }
export interface CalloutData { title: string; subtitle: string; cta: string; ctaUrl: string; bg: string; color: string }
export interface ButtonData { label: string; url: string; bg: string; color: string; align?: "left" | "center" | "right" }
export interface ProductsData { cols: 2 | 3 | 4; productIds: string[]; bg?: string }
export interface ImgTextData { img: string; title: string; body: string; side: "left" | "right" | "top" | "bottom"; bg?: string; titleColor?: string; bodyColor?: string; imgWidth?: number; textAlign?: "left" | "center" | "right" }
export interface ListData { items: string[]; bg?: string; color?: string }
export interface EmptyData { height: number; bg?: string }
export interface ColumnData { kind: "text" | "image"; text?: string; img?: string }
export interface ColumnsData { cols: 2 | 3; columns: ColumnData[]; bg?: string; color?: string }
// divider + footer sont sans data

export type NewsletterBlock =
  | { id: number | string; type: "banner"; data: BannerData }
  | { id: number | string; type: "heading"; data: HeadingData }
  | { id: number | string; type: "callout"; data: CalloutData }
  | { id: number | string; type: "button"; data: ButtonData }
  | { id: number | string; type: "products"; data: ProductsData }
  | { id: number | string; type: "imgtext"; data: ImgTextData }
  | { id: number | string; type: "list"; data: ListData }
  | { id: number | string; type: "empty"; data: EmptyData }
  | { id: number | string; type: "columns"; data: ColumnsData }
  | { id: number | string; type: "divider"; data: Record<string, never> }
  | { id: number | string; type: "footer"; data: Record<string, never> };

export type NewsletterBlockData = NewsletterBlock["data"];

// Données minimales des produits chargées pour le rendu de la grille produits
export interface ProductLite {
  id: string;
  name: string;
  reference: string;
  imagePath: string | null;
  priceCents: number | null;
}

// Défaut de chaque type de bloc
export function defaultDataFor(type: NewsletterBlockType): NewsletterBlockData {
  switch (type) {
    case "banner": return { img: "", alt: "Bannière" };
    case "heading": return { title: "Nouveau titre", body: "Votre texte ici.", align: "center" as const };
    case "callout": return { title: "Offre spéciale", subtitle: "Utilisez le code…", cta: "En profiter", ctaUrl: "", bg: "#334155", color: "#ffffff" };
    case "button": return { label: "Découvrir", url: "", bg: "#0f172a", color: "#ffffff", align: "center" as const };
    case "products": return { cols: 3 as const, productIds: [] };
    case "imgtext": return { img: "", title: "Titre", body: "Description…", side: "left" as const };
    case "list": return { items: ["✨ Item 1", "🎁 Item 2", "📦 Item 3"] };
    case "empty": return { height: 40 };
    case "columns": return { cols: 2 as const, columns: [{ kind: "text", text: "Colonne 1" }, { kind: "text", text: "Colonne 2" }] };
    case "divider": return {};
    case "footer": return {};
  }
}

/**
 * Rend un tableau de blocs en HTML mail complet (avec wrap + head + body).
 * Le footer standard est TOUJOURS ajouté en fin (ou remplace celui déjà présent).
 */
export function renderNewsletterHtml({
  subject,
  blocks,
  productsById,
  shared,
}: {
  subject: string;
  blocks: NewsletterBlock[];
  productsById: Map<string, ProductLite>;
  shared: SharedMailContext;
}): string {
  const bodyHtml = blocks
    .filter((b) => b.type !== "footer") // footer géré par wrapMail
    .map((b) => renderBlock(b, productsById, shared))
    .join("\n");

  return wrapMail({
    title: subject,
    bannerGradient: "linear-gradient(135deg,#0f172a,#334155)",
    bannerTitle: subject,
    bodyHtml,
    shared,
  });
}

function wrapBg(bg: string | undefined, inner: string): string {
  if (!bg) return inner;
  return `<div style="background:${bg};">${inner}</div>`;
}

function renderBlock(block: NewsletterBlock, productsById: Map<string, ProductLite>, shared: SharedMailContext): string {
  switch (block.type) {
    case "banner": {
      const src = block.data.img ? absoluteUrl(shared.baseUrl, block.data.img) : "";
      if (!src) return "";
      const h = block.data.height ? Math.max(60, Math.min(600, Number(block.data.height))) : null;
      const fit = block.data.fit === "contain" ? "contain" : "cover";
      const heightStyle = h ? `height:${h}px; object-fit:${fit};` : "";
      return wrapBg(block.data.bg, `<div style="margin:16px 0;"><img src="${escapeHtml(src)}" alt="${escapeHtml(block.data.alt || "")}" style="width:100%; ${heightStyle} display:block; border-radius:8px;"></div>`);
    }
    case "heading": {
      const titleColor = block.data.titleColor || "#0f172a";
      const bodyColor = block.data.bodyColor || "#475569";
      const hasBody = (block.data.body || "").trim().length > 0;
      const hasTitle = (block.data.title || "").trim().length > 0;
      const titleHtml = hasTitle
        ? `<h2 style="font-family:'Poppins', sans-serif; font-size:20px; font-weight:700; color:${titleColor}; margin:0${hasBody ? " 0 10px" : ""};">${escapeHtml(block.data.title)}</h2>`
        : "";
      const bodyHtml = hasBody
        ? `<p style="font-size:14px; color:${bodyColor}; line-height:1.6; margin:0; white-space:pre-wrap;">${escapeHtml(block.data.body)}</p>`
        : "";
      if (!hasTitle && !hasBody) return "";
      return wrapBg(block.data.bg, `<div style="padding:16px 20px; text-align:${block.data.align};">${titleHtml}${bodyHtml}</div>`);
    }
    case "callout":
      return `<div style="margin:16px 0;">
<div style="background:${block.data.bg}; color:${block.data.color}; padding:20px; border-radius:14px; text-align:center;">
<div style="font-family:'Poppins', sans-serif; font-size:16px; font-weight:700; margin-bottom:6px;">${escapeHtml(block.data.title)}</div>
<div style="font-size:13px; opacity:0.85; margin-bottom:14px;">${escapeHtml(block.data.subtitle)}</div>
${block.data.ctaUrl ? `<a href="${escapeHtml(block.data.ctaUrl)}" style="display:inline-block; background:white; color:${block.data.bg}; padding:10px 22px; border-radius:999px; font-weight:600; font-size:13px; text-decoration:none;">${escapeHtml(block.data.cta)}</a>` : ""}
</div>
</div>`;
    case "button": {
      const align = block.data.align || "center";
      const url = block.data.url || shared.baseUrl;
      // ctaButton par défaut centre. Custom rendering si couleurs perso ou alignement autre.
      if (block.data.bg === "#0f172a" && block.data.color === "#ffffff" && align === "center") {
        return ctaButton(block.data.label, url);
      }
      return `<div style="text-align:${align}; margin:16px 0;">
<a href="${escapeHtml(url)}" style="display:inline-block; background:${block.data.bg}; color:${block.data.color}; padding:12px 28px; border-radius:10px; font-family:'Poppins', sans-serif; font-weight:600; font-size:14px; text-decoration:none;">${escapeHtml(block.data.label)}</a>
</div>`;
    }
    case "products": {
      const products = block.data.productIds
        .map((id) => productsById.get(id))
        .filter((p): p is ProductLite => Boolean(p));
      if (products.length === 0) return "";
      const cols = block.data.cols;
      let html = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:16px 0;">`;
      for (let i = 0; i < products.length; i += cols) {
        html += `<tr>`;
        const row = products.slice(i, i + cols);
        for (const p of row) {
          const width = `${Math.floor(100 / cols)}%`;
          const imgSrc = p.imagePath ? absoluteUrl(shared.baseUrl, p.imagePath) : "";
          html += `<td width="${width}" style="padding:6px; vertical-align:top;">
<div style="border:1px solid #e2e8f0; border-radius:10px; overflow:hidden;">
${imgSrc ? `<img src="${escapeHtml(imgSrc)}" alt="" style="width:100%; height:120px; object-fit:cover; display:block;">` : `<div style="height:120px; background:#f1f5f9;"></div>`}
<div style="padding:10px; text-align:center;">
<div style="font-family:'Poppins', sans-serif; font-size:12px; font-weight:600; color:#0f172a;">${escapeHtml(p.name)}</div>
${p.priceCents !== null ? `<div style="font-size:13px; color:#0f172a; font-weight:700; margin-top:2px;">${formatEuros(p.priceCents)}</div>` : ""}
</div>
</div>
</td>`;
        }
        // Padding vides pour les colonnes manquantes
        for (let k = row.length; k < cols; k++) html += `<td width="${Math.floor(100 / cols)}%"></td>`;
        html += `</tr>`;
      }
      html += `</table>`;
      return wrapBg(block.data.bg, html);
    }
    case "imgtext": {
      const src = block.data.img ? absoluteUrl(shared.baseUrl, block.data.img) : "";
      const titleColor = block.data.titleColor || "#0f172a";
      const bodyColor = block.data.bodyColor || "#475569";
      const textAlign = block.data.textAlign || "left";
      const imgWidth = Math.max(20, Math.min(100, Number(block.data.imgWidth) || 45));
      const imgFull = src ? `<img src="${escapeHtml(src)}" alt="" style="width:100%; border-radius:8px; display:block;">` : "";
      const txtBlock = `<div style="font-family:'Poppins', sans-serif; font-size:15px; font-weight:700; color:${titleColor}; margin-bottom:6px; text-align:${textAlign};">${escapeHtml(block.data.title)}</div>
<div style="font-size:13px; color:${bodyColor}; line-height:1.6; white-space:pre-wrap; text-align:${textAlign};">${escapeHtml(block.data.body)}</div>`;
      const side = block.data.side;
      if (side === "top" || side === "bottom") {
        // Pour top/bottom, la largeur d'image contrôle sa taille en centrant.
        const imgWrap = src ? `<div style="width:${imgWidth}%; margin:0 auto;">${imgFull}</div>` : "";
        const imgRow = `<tr><td style="padding:0 10px 10px;">${imgWrap}</td></tr>`;
        const txtRow = `<tr><td style="padding:0 10px 10px;">${txtBlock}</td></tr>`;
        return wrapBg(block.data.bg, `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:16px 0;">${side === "top" ? imgRow + txtRow : txtRow + imgRow}</table>`);
      }
      const imgCell = `<td width="${imgWidth}%" style="padding:0 10px; vertical-align:middle;">${imgFull}</td>`;
      const txtCell = `<td style="vertical-align:middle; padding:0 10px;">${txtBlock}</td>`;
      return wrapBg(block.data.bg, `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:16px 0;"><tr>${side === "left" ? imgCell + txtCell : txtCell + imgCell}</tr></table>`);
    }
    case "list": {
      const color = block.data.color || "#334155";
      return wrapBg(block.data.bg, `<ul style="list-style:none; padding:12px 20px; margin:0;">
${block.data.items.map((item) => `<li style="padding:8px 0; font-size:14px; color:${color}; border-bottom:1px solid #f1f5f9;">${escapeHtml(item)}</li>`).join("")}
</ul>`);
    }
    case "empty": {
      const h = Math.max(4, Math.min(400, Number(block.data.height) || 40));
      const bg = block.data.bg || "transparent";
      return `<div style="height:${h}px; background:${bg}; line-height:${h}px; font-size:1px;">&nbsp;</div>`;
    }
    case "columns": {
      const cols = block.data.cols;
      const columns = block.data.columns.slice(0, cols);
      // Compléter si manquant
      while (columns.length < cols) columns.push({ kind: "text", text: "" });
      const width = `${Math.floor(100 / cols)}%`;
      const color = block.data.color || "#334155";
      const cells = columns.map((col) => {
        if (col.kind === "image") {
          const src = col.img ? absoluteUrl(shared.baseUrl, col.img) : "";
          return `<td width="${width}" style="padding:8px; vertical-align:top;">${src ? `<img src="${escapeHtml(src)}" alt="" style="width:100%; border-radius:8px; display:block;">` : `<div style="height:100px; background:#f1f5f9; border-radius:8px;"></div>`}</td>`;
        }
        return `<td width="${width}" style="padding:8px; vertical-align:top; font-size:14px; color:${color}; line-height:1.6; white-space:pre-wrap;">${escapeHtml(col.text || "")}</td>`;
      }).join("");
      return wrapBg(block.data.bg, `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:16px 0;"><tr>${cells}</tr></table>`);
    }
    case "divider":
      return `<hr style="border:none; border-top:1px solid #e2e8f0; margin:16px 0;">`;
    case "footer":
      return ""; // Géré par wrapMail
  }
}
