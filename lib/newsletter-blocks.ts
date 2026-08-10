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
  | "footer";

export interface BannerData { img: string; alt: string }
export interface HeadingData { title: string; body: string; align: "left" | "center" | "right" }
export interface CalloutData { title: string; subtitle: string; cta: string; ctaUrl: string; bg: string; color: string }
export interface ButtonData { label: string; url: string; bg: string; color: string }
export interface ProductsData { cols: 2 | 3 | 4; productIds: string[] }
export interface ImgTextData { img: string; title: string; body: string; side: "left" | "right" }
export interface ListData { items: string[] }
// divider + footer sont sans data

export type NewsletterBlock =
  | { id: number | string; type: "banner"; data: BannerData }
  | { id: number | string; type: "heading"; data: HeadingData }
  | { id: number | string; type: "callout"; data: CalloutData }
  | { id: number | string; type: "button"; data: ButtonData }
  | { id: number | string; type: "products"; data: ProductsData }
  | { id: number | string; type: "imgtext"; data: ImgTextData }
  | { id: number | string; type: "list"; data: ListData }
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
    case "button": return { label: "Découvrir", url: "", bg: "#0f172a", color: "#ffffff" };
    case "products": return { cols: 3 as const, productIds: [] };
    case "imgtext": return { img: "", title: "Titre", body: "Description…", side: "left" as const };
    case "list": return { items: ["✨ Item 1", "🎁 Item 2", "📦 Item 3"] };
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

function renderBlock(block: NewsletterBlock, productsById: Map<string, ProductLite>, shared: SharedMailContext): string {
  switch (block.type) {
    case "banner": {
      const src = block.data.img ? absoluteUrl(shared.baseUrl, block.data.img) : "";
      if (!src) return "";
      return `<div style="margin:16px 0;"><img src="${escapeHtml(src)}" alt="${escapeHtml(block.data.alt || "")}" style="width:100%; display:block; border-radius:8px;"></div>`;
    }
    case "heading":
      return `<div style="padding:16px 0; text-align:${block.data.align};">
<h2 style="font-family:'Poppins', sans-serif; font-size:20px; font-weight:700; color:#0f172a; margin:0 0 10px;">${escapeHtml(block.data.title)}</h2>
<p style="font-size:14px; color:#475569; line-height:1.6; margin:0; white-space:pre-wrap;">${escapeHtml(block.data.body)}</p>
</div>`;
    case "callout":
      return `<div style="margin:16px 0;">
<div style="background:${block.data.bg}; color:${block.data.color}; padding:20px; border-radius:14px; text-align:center;">
<div style="font-family:'Poppins', sans-serif; font-size:16px; font-weight:700; margin-bottom:6px;">${escapeHtml(block.data.title)}</div>
<div style="font-size:13px; opacity:0.85; margin-bottom:14px;">${escapeHtml(block.data.subtitle)}</div>
${block.data.ctaUrl ? `<a href="${escapeHtml(block.data.ctaUrl)}" style="display:inline-block; background:white; color:${block.data.bg}; padding:10px 22px; border-radius:999px; font-weight:600; font-size:13px; text-decoration:none;">${escapeHtml(block.data.cta)}</a>` : ""}
</div>
</div>`;
    case "button":
      return ctaButton(block.data.label, block.data.url || shared.baseUrl);
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
      return html;
    }
    case "imgtext": {
      const src = block.data.img ? absoluteUrl(shared.baseUrl, block.data.img) : "";
      const imgCell = `<td width="45%" style="padding:0 10px; vertical-align:middle;">${src ? `<img src="${escapeHtml(src)}" alt="" style="width:100%; border-radius:8px; display:block;">` : ""}</td>`;
      const txtCell = `<td style="vertical-align:middle; padding:0 10px;">
<div style="font-family:'Poppins', sans-serif; font-size:15px; font-weight:700; color:#0f172a; margin-bottom:6px;">${escapeHtml(block.data.title)}</div>
<div style="font-size:13px; color:#475569; line-height:1.6; white-space:pre-wrap;">${escapeHtml(block.data.body)}</div>
</td>`;
      return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:16px 0;"><tr>${block.data.side === "left" ? imgCell + txtCell : txtCell + imgCell}</tr></table>`;
    }
    case "list":
      return `<ul style="list-style:none; padding:0; margin:16px 0;">
${block.data.items.map((item) => `<li style="padding:8px 0; font-size:14px; color:#334155; border-bottom:1px solid #f1f5f9;">${escapeHtml(item)}</li>`).join("")}
</ul>`;
    case "divider":
      return `<hr style="border:none; border-top:1px solid #e2e8f0; margin:16px 0;">`;
    case "footer":
      return ""; // Géré par wrapMail
  }
}
