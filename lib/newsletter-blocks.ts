/**
 * Définition des blocs newsletter + rendu HTML pour l'envoi.
 *
 * Un modèle newsletter est un tableau JSON de NewsletterBlock. Chaque bloc
 * a un `type` et un `data` typé selon le type.
 *
 * Utilisé côté serveur pour rendre le HTML final envoyé au client,
 * et côté client pour l'éditeur visuel (SendMailModal + éditeur dédié).
 */

import { escapeHtml, escapeHtmlWithBreaks, absoluteUrl, formatEuros, ctaButton, wrapMail, type SharedMailContext } from "@/lib/mail-templates/shared";
import { interpolate as interpolateVariables } from "@/lib/mail-merge-variables";

export type NewsletterBlockType =
  | "banner"
  | "header"
  | "heading"
  | "callout"
  | "button"
  | "products"
  | "imgtext"
  | "list"
  | "divider"
  | "empty"
  | "columns"
  | "footer"
  // ─── Blocs dynamiques (mails transactionnels uniquement) ───
  | "cartItems"
  | "favoritesGrid"
  | "daysInactive";

export interface BannerData { img: string; alt: string; bg?: string; height?: number; fit?: "cover" | "contain" }
export interface HeaderData {
  /** Logo (chemin public ou URL absolue). Vide = pas de logo affiché. */
  logo?: string;
  /** Hauteur max du logo en pixels. */
  logoMaxHeight?: number;
  /** Titre principal (souvent le nom de la boutique ou l'accroche). */
  title?: string;
  /** Sous-titre (baseline ou courte intro). */
  subtitle?: string;
  bg?: string;
  textColor?: string;
  titleSize?: number;
  subtitleSize?: number;
  align?: "left" | "center" | "right";
}
export interface HeadingData { title: string; body: string; align: "left" | "center" | "right"; bg?: string; titleColor?: string; bodyColor?: string; titleSize?: number; bodySize?: number; titleAlign?: "left" | "center" | "right"; bodyAlign?: "left" | "center" | "right" }
export interface CalloutData { title: string; subtitle: string; cta: string; ctaUrl: string; bg: string; color: string; titleSize?: number; subtitleSize?: number; ctaSize?: number }
export interface ButtonData { label: string; url: string; bg: string; color: string; align?: "left" | "center" | "right"; labelSize?: number }
export interface ProductsData { cols: 2 | 3 | 4; productIds: string[]; bg?: string }
export interface ImgTextData { img: string; title: string; body: string; side: "left" | "right" | "top" | "bottom"; bg?: string; titleColor?: string; bodyColor?: string; imgWidth?: number; textAlign?: "left" | "center" | "right"; titleSize?: number; bodySize?: number; titleAlign?: "left" | "center" | "right"; bodyAlign?: "left" | "center" | "right" }
export interface ListData { items: string[]; bg?: string; color?: string; itemSize?: number }
export interface EmptyData { height: number; bg?: string }
export interface ColumnData { kind: "text" | "image"; text?: string; img?: string }
export interface ColumnsData { cols: 2 | 3; columns: ColumnData[]; bg?: string; color?: string }
// divider est sans data
export interface FooterData {
  /** Contenu texte (multi-ligne) — DOIT contenir les 4 variables obligatoires
   *  {shopName} {shopAddress} {unsubscribeLink} {privacyLink} (validation
   *  côté sauvegarde du modèle). Ligne = un retour à la ligne dans l'input. */
  content: string;
  bg?: string;
  color?: string;
  align?: "left" | "center" | "right";
  fontSize?: number;
}

// ─── Blocs dynamiques (mails transactionnels) ───
// Ces blocs sont rendus avec les vraies données du client au moment de l'envoi
// (items du panier, favoris/produits sélectionnés, jours d'inactivité).
// Dans l'éditeur, ils affichent un aperçu illustratif (données factices).
export interface CartItemsData {
  /** Titre optionnel au-dessus de la liste des articles. */
  title?: string;
  bg?: string;
  /** Libellé de la ligne total (« Total », « Sous-total »…). */
  totalLabel?: string;
  /** Message affiché quand le panier est vide (fallback nouveautés). */
  emptyMessage?: string;
}
export interface FavoritesGridData {
  cols: 2 | 3;
  bg?: string;
  /** Message affiché quand aucun produit n'a été sélectionné pour ce mail. */
  emptyMessage?: string;
}
export interface DaysInactiveData {
  /** Gabarit avec {days} remplacé par le nombre de jours. */
  template: string;
  /** Gabarit utilisé quand le client n'a jamais visité (daysInactive === null). */
  neverVisitedTemplate: string;
  bg?: string;
  color?: string;
}

export type NewsletterBlock =
  | { id: number | string; type: "banner"; data: BannerData }
  | { id: number | string; type: "header"; data: HeaderData }
  | { id: number | string; type: "heading"; data: HeadingData }
  | { id: number | string; type: "callout"; data: CalloutData }
  | { id: number | string; type: "button"; data: ButtonData }
  | { id: number | string; type: "products"; data: ProductsData }
  | { id: number | string; type: "imgtext"; data: ImgTextData }
  | { id: number | string; type: "list"; data: ListData }
  | { id: number | string; type: "empty"; data: EmptyData }
  | { id: number | string; type: "columns"; data: ColumnsData }
  | { id: number | string; type: "divider"; data: Record<string, never> }
  | { id: number | string; type: "footer"; data: FooterData }
  | { id: number | string; type: "cartItems"; data: CartItemsData }
  | { id: number | string; type: "favoritesGrid"; data: FavoritesGridData }
  | { id: number | string; type: "daysInactive"; data: DaysInactiveData };

export type NewsletterBlockData = NewsletterBlock["data"];

// Données minimales des produits chargées pour le rendu de la grille produits
export interface ProductLite {
  id: string;
  name: string;
  reference: string;
  imagePath: string | null;
  priceCents: number | null;
}

/**
 * Concatène tous les textes visibles d'un tableau de blocs. Utilisé pour la
 * validation des variables obligatoires (le sujet est ajouté par le caller).
 */
export function collectBlocksText(blocks: NewsletterBlock[]): string {
  const parts: string[] = [];
  for (const b of blocks) {
    switch (b.type) {
      case "header":
        if (b.data.title) parts.push(b.data.title);
        if (b.data.subtitle) parts.push(b.data.subtitle);
        break;
      case "heading":
        parts.push(b.data.title, b.data.body);
        break;
      case "callout":
        parts.push(b.data.title, b.data.subtitle, b.data.cta, b.data.ctaUrl);
        break;
      case "button":
        parts.push(b.data.label, b.data.url);
        break;
      case "imgtext":
        parts.push(b.data.title, b.data.body);
        break;
      case "list":
        parts.push(...b.data.items);
        break;
      case "columns":
        for (const col of b.data.columns) {
          if (col.kind === "text" && col.text) parts.push(col.text);
        }
        break;
      case "footer":
        if (b.data.content) parts.push(b.data.content);
        break;
      case "cartItems":
        if (b.data.title) parts.push(b.data.title);
        if (b.data.totalLabel) parts.push(b.data.totalLabel);
        if (b.data.emptyMessage) parts.push(b.data.emptyMessage);
        break;
      case "favoritesGrid":
        if (b.data.emptyMessage) parts.push(b.data.emptyMessage);
        break;
      case "daysInactive":
        parts.push(b.data.template, b.data.neverVisitedTemplate);
        break;
      default:
        break; // banner/divider/empty/products : pas de texte de merge
    }
  }
  return parts.filter(Boolean).join("\n");
}

/**
 * Retourne le contenu texte du 1er bloc footer trouvé, ou `null` s'il n'y a
 * aucun bloc footer dans le modèle. Utilisé par la validation « variables
 * obligatoires DANS le footer » (nom + adresse boutique + désinscription +
 * politique de confidentialité).
 */
export function getFooterContent(blocks: NewsletterBlock[]): string | null {
  for (const b of blocks) {
    if (b.type === "footer") {
      return typeof b.data?.content === "string" ? b.data.content : "";
    }
  }
  return null;
}

// Défaut de chaque type de bloc
export function defaultDataFor(type: NewsletterBlockType): NewsletterBlockData {
  switch (type) {
    case "banner": return { img: "", alt: "Bannière" };
    case "header": return {
      logo: "",
      logoMaxHeight: 60,
      title: "",
      subtitle: "",
      bg: "#0f172a",
      textColor: "#ffffff",
      titleSize: 22,
      subtitleSize: 13,
      align: "center" as const,
    };
    case "heading": return { title: "Nouveau titre", body: "Votre texte ici.", align: "center" as const };
    case "callout": return { title: "Offre spéciale", subtitle: "Utilisez le code…", cta: "En profiter", ctaUrl: "", bg: "#334155", color: "#ffffff" };
    case "button": return { label: "Découvrir", url: "", bg: "#0f172a", color: "#ffffff", align: "center" as const };
    case "products": return { cols: 3 as const, productIds: [] };
    case "imgtext": return { img: "", title: "Titre", body: "Description…", side: "left" as const };
    case "list": return { items: ["✨ Item 1", "🎁 Item 2", "📦 Item 3"] };
    case "empty": return { height: 40 };
    case "columns": return { cols: 2 as const, columns: [{ kind: "text", text: "Colonne 1" }, { kind: "text", text: "Colonne 2" }] };
    case "divider": return {};
    case "footer": return {
      // Contenu par défaut : contient déjà les 4 variables obligatoires pour
      // que la sauvegarde passe dès l'ajout du bloc. La cliente peut ensuite
      // reformuler à sa guise — tant que les 4 tokens restent présents.
      content: "{shopName} · {shopAddress}\nSe désinscrire : {unsubscribeLink}\nPolitique de confidentialité : {privacyLink}",
      bg: "#f8fafc",
      color: "#64748b",
      align: "center" as const,
      fontSize: 12,
    };
    case "cartItems": return { title: "Votre panier", totalLabel: "Total", emptyMessage: "Votre panier est vide — venez découvrir nos nouveautés !" };
    case "favoritesGrid": return { cols: 2 as const, emptyMessage: "Aucun produit sélectionné." };
    case "daysInactive": return {
      template: "Cela fait {days} jour(s) qu'on ne vous a pas vu sur notre boutique.",
      neverVisitedTemplate: "Vous n'avez encore jamais visité notre boutique en ligne.",
    };
  }
}

// ─── Contexte dynamique injecté au moment de l'envoi ───
// Pour les mails transactionnels (panier abandonné, retour en stock, inactivité)
// on passe les vraies données du client — les blocs dynamiques les rendent.
// Pour une newsletter classique, ce contexte est absent (les blocs dynamiques
// affichent leur `emptyMessage` de secours).
export interface CartItemDynamic {
  productName: string;
  colorName: string | null;
  quantity: number;
  totalCents: number;
  imagePath: string | null;
}
export interface FavoriteDynamic {
  productName: string;
  colorName: string | null;
  priceCents: number;
  imagePath: string | null;
}
export interface NewsletterDynamicContext {
  cart?: { items: CartItemDynamic[]; totalCents: number };
  favorites?: FavoriteDynamic[];
  daysInactive?: number | null;
  firstName?: string;
}

/**
 * Remplace toutes les variables `{token}` (firstName, lastName, cartTotal, etc.)
 * par leur valeur dans le context. Voir `lib/mail-merge-variables.ts` pour la
 * liste complète des tokens supportés. Les tokens absents du context sont
 * conservés tels quels (utile pour repérer les fautes de frappe à la relecture).
 *
 * Retourne une copie profonde des blocs affectés — les autres blocs sont
 * réutilisés par référence pour économiser du travail.
 */
export function substituteVariables(
  blocks: NewsletterBlock[],
  context: Partial<Record<string, string>>,
): NewsletterBlock[] {
  const sub = (s: string | undefined): string | undefined =>
    s == null ? s : interpolateVariables(s, context);
  return blocks.map((b) => applySubToBlock(b, sub));
}

/**
 * Wrapper legacy : substitue uniquement `{firstName}`. Conservé pour les
 * callers existants (`user-mails.ts`). Nouveaux callers → utiliser
 * `substituteVariables(blocks, buildRecipientContext(...))`.
 */
export function substituteFirstName(
  blocks: NewsletterBlock[],
  firstName: string,
): NewsletterBlock[] {
  if (!firstName) return blocks;
  return substituteVariables(blocks, { firstName });
}

function applySubToBlock(
  b: NewsletterBlock,
  sub: (s: string | undefined) => string | undefined,
): NewsletterBlock {
  switch (b.type) {
    case "header":
      return { ...b, data: { ...b.data, title: sub(b.data.title), subtitle: sub(b.data.subtitle) } };
    case "footer":
      return { ...b, data: { ...b.data, content: sub(b.data.content) ?? "" } };
    case "heading":
      return { ...b, data: { ...b.data, title: sub(b.data.title) ?? "", body: sub(b.data.body) ?? "" } };
    case "callout":
      return { ...b, data: { ...b.data, title: sub(b.data.title) ?? "", subtitle: sub(b.data.subtitle) ?? "", cta: sub(b.data.cta) ?? "" } };
    case "button":
      return { ...b, data: { ...b.data, label: sub(b.data.label) ?? "" } };
    case "imgtext":
      return { ...b, data: { ...b.data, title: sub(b.data.title) ?? "", body: sub(b.data.body) ?? "" } };
    case "list":
      return { ...b, data: { ...b.data, items: b.data.items.map((it) => sub(it) ?? "") } };
    case "columns":
      return {
        ...b,
        data: {
          ...b.data,
          columns: b.data.columns.map((c) =>
            c.kind === "text" ? { ...c, text: sub(c.text) } : c,
          ),
        },
      };
    case "daysInactive":
      return { ...b, data: { ...b.data, template: sub(b.data.template) ?? "", neverVisitedTemplate: sub(b.data.neverVisitedTemplate) ?? "" } };
    case "cartItems":
      return { ...b, data: { ...b.data, title: sub(b.data.title), totalLabel: sub(b.data.totalLabel), emptyMessage: sub(b.data.emptyMessage) } };
    case "favoritesGrid":
      return { ...b, data: { ...b.data, emptyMessage: sub(b.data.emptyMessage) } };
    default:
      return b;
  }
}

/**
 * Rend un tableau de blocs en HTML mail complet (avec wrap + head + body).
 * Le footer standard est TOUJOURS ajouté en fin (ou remplace celui déjà présent).
 *
 * `dynamic` porte les données injectées pour les mails transactionnels
 * (panier abandonné, retour en stock, inactivité). Ignoré pour les
 * newsletters classiques.
 */
export function renderNewsletterHtml({
  subject,
  blocks,
  productsById,
  shared,
  dynamic,
  omitGlobalChrome,
}: {
  subject: string;
  blocks: NewsletterBlock[];
  productsById: Map<string, ProductLite>;
  shared: SharedMailContext;
  dynamic?: NewsletterDynamicContext;
  /**
   * `true` pour les mails marketing : supprime le header + footer globaux —
   * l'admin compose tout via blocs et intègre les mentions légales via les
   * variables obligatoires `{shopName}`, `{shopAddress}`, `{unsubscribeLink}`,
   * `{privacyLink}` (garanti par validation à la sauvegarde du modèle).
   */
  omitGlobalChrome?: boolean;
}): string {
  const bodyHtml = blocks
    .map((b) => renderBlock(b, productsById, shared, dynamic))
    .join("\n");

  return wrapMail({
    title: subject,
    bannerTitle: subject,
    bodyHtml,
    shared,
    omitGlobalChrome,
  });
}

function wrapBg(bg: string | undefined, inner: string): string {
  if (!bg) return inner;
  return `<div style="background:${bg};">${inner}</div>`;
}

/**
 * Enveloppe un bloc dans un conteneur avec padding horizontal 20 px.
 * Utilisé pour les blocs qui ne gèrent pas déjà leur propre inset (products,
 * imgtext, columns, callout, button, divider). Grâce au retrait du padding
 * horizontal du wrapper principal `wrapMail`, seuls les blocs edge-to-edge
 * (banner, empty) atteignent réellement les bords du mail.
 */
function contained(inner: string): string {
  return `<div style="padding:0 20px;">${inner}</div>`;
}

/**
 * Libellés courts substitués aux URLs des variables `{unsubscribeLink}` et
 * `{privacyLink}` dans le rendu HTML final. Sans ce raccourci, la cliente
 * verrait une URL longue affichée en clair — ici elle voit un texte cliquable
 * lisible comme « Cliquez ici ».
 */
const URL_TOKEN_LINK_LABELS: Record<string, string> = {
  unsubscribeLink: "Cliquez ici",
  privacyLink: "Cliquez ici",
};

/**
 * Remplace, dans un fragment HTML déjà échappé, chaque URL correspondant à
 * une variable connue (`unsubscribeLink`, `privacyLink`) par une balise
 * `<a>` avec un libellé court. Sans effet si :
 *  - le context de fusion est absent (mails système),
 *  - l'URL n'est pas trouvée dans le fragment (token non substitué ou
 *    template ne l'utilisant pas).
 */
function linkifyUrlTokens(
  escapedHtml: string,
  shared: SharedMailContext,
): string {
  const mc = shared.mergeContext;
  if (!mc) return escapedHtml;
  let out = escapedHtml;
  for (const [token, label] of Object.entries(URL_TOKEN_LINK_LABELS)) {
    const url = mc[token];
    if (!url) continue;
    const urlStr = String(url);
    const escapedUrl = escapeHtml(urlStr);
    if (!out.includes(escapedUrl)) continue;
    const anchor = `<a href="${escapedUrl}" style="color:inherit; text-decoration:underline;">${escapeHtml(label)}</a>`;
    out = out.split(escapedUrl).join(anchor);
  }
  return out;
}

function renderBlock(
  block: NewsletterBlock,
  productsById: Map<string, ProductLite>,
  shared: SharedMailContext,
  dynamic?: NewsletterDynamicContext,
): string {
  switch (block.type) {
    case "banner": {
      const src = block.data.img ? absoluteUrl(shared.baseUrl, block.data.img) : "";
      if (!src) return "";
      const h = block.data.height ? Math.max(60, Math.min(600, Number(block.data.height))) : null;
      const fit = block.data.fit === "contain" ? "contain" : "cover";
      const heightStyle = h ? `height:${h}px; object-fit:${fit};` : "";
      return wrapBg(block.data.bg, `<div style="margin:16px 0;"><img src="${escapeHtml(src)}" alt="${escapeHtml(block.data.alt || "")}" style="width:100%; ${heightStyle} display:block; border-radius:8px;"></div>`);
    }
    case "header": {
      const bg = block.data.bg || "#0f172a";
      const color = block.data.textColor || "#ffffff";
      const align = block.data.align || "center";
      const logoSrc = block.data.logo ? absoluteUrl(shared.baseUrl, block.data.logo) : "";
      const logoMax = Math.max(20, Math.min(160, Number(block.data.logoMaxHeight) || 60));
      const logoHtml = logoSrc
        ? `<div style="margin-bottom:14px;"><img src="${escapeHtml(logoSrc)}" alt="" style="max-height:${logoMax}px; display:inline-block; border:0;"></div>`
        : "";
      const hasTitle = !!(block.data.title || "").trim();
      const hasSubtitle = !!(block.data.subtitle || "").trim();
      const titleHtml = hasTitle
        ? `<h1 style="font-family:'Poppins', sans-serif; font-size:${block.data.titleSize || 22}px; font-weight:700; margin:0; color:${color}; word-wrap:break-word; overflow-wrap:break-word;">${escapeHtmlWithBreaks(block.data.title || "")}</h1>`
        : "";
      const subtitleHtml = hasSubtitle
        ? `<div style="font-size:${block.data.subtitleSize || 13}px; margin-top:${hasTitle ? "8px" : "0"}; color:${color}; opacity:0.85; word-wrap:break-word; overflow-wrap:break-word;">${escapeHtmlWithBreaks(block.data.subtitle || "")}</div>`
        : "";
      if (!logoHtml && !titleHtml && !subtitleHtml) return "";
      return `<div style="background:${bg}; padding:36px 24px; text-align:${align};">${logoHtml}${titleHtml}${subtitleHtml}</div>`;
    }
    case "footer": {
      const bg = block.data.bg || "#f8fafc";
      const color = block.data.color || "#64748b";
      const align = block.data.align || "center";
      const fontSize = Math.max(9, Math.min(20, Number(block.data.fontSize) || 12));
      const content = (block.data.content || "").trim();
      if (!content) return "";
      return `<div style="background:${bg}; color:${color}; padding:20px 24px; text-align:${align}; font-size:${fontSize}px; line-height:1.6; word-wrap:break-word; overflow-wrap:break-word;">${linkifyUrlTokens(escapeHtmlWithBreaks(content), shared)}</div>`;
    }
    case "heading": {
      const titleColor = block.data.titleColor || "#0f172a";
      const bodyColor = block.data.bodyColor || "#475569";
      const hasBody = (block.data.body || "").trim().length > 0;
      const hasTitle = (block.data.title || "").trim().length > 0;
      // Alignements per-élément (nouveau) avec fallback sur l'ancien `align`
      // pour rétrocompat des modèles créés avant cette séparation.
      const titleAlign = block.data.titleAlign ?? block.data.align ?? "left";
      const bodyAlign = block.data.bodyAlign ?? block.data.align ?? "left";
      const titleHtml = hasTitle
        ? `<h2 style="font-family:'Poppins', sans-serif; font-size:${block.data.titleSize || 20}px; font-weight:700; color:${titleColor}; margin:0${hasBody ? " 0 10px" : ""}; text-align:${titleAlign}; word-wrap:break-word; overflow-wrap:break-word;">${escapeHtmlWithBreaks(block.data.title)}</h2>`
        : "";
      const bodyHtml = hasBody
        ? `<p style="font-size:${block.data.bodySize || 14}px; color:${bodyColor}; line-height:1.6; margin:0; text-align:${bodyAlign}; white-space:pre-wrap; word-wrap:break-word; overflow-wrap:break-word;">${linkifyUrlTokens(escapeHtml(block.data.body), shared)}</p>`
        : "";
      if (!hasTitle && !hasBody) return "";
      return wrapBg(block.data.bg, `<div style="padding:16px 20px;">${titleHtml}${bodyHtml}</div>`);
    }
    case "callout": {
      const rawCtaUrl = (block.data.ctaUrl ?? "").trim();
      const ctaAbsolute = /^(https?:\/\/|mailto:)/i.test(rawCtaUrl)
        ? rawCtaUrl
        : rawCtaUrl
          ? absoluteUrl(shared.baseUrl, rawCtaUrl)
          : "";
      return contained(`<div style="margin:16px 0;">
<div style="background:${block.data.bg}; color:${block.data.color}; padding:20px; border-radius:14px; text-align:center;">
<div style="font-family:'Poppins', sans-serif; font-size:${block.data.titleSize || 16}px; font-weight:700; margin-bottom:6px; word-wrap:break-word; overflow-wrap:break-word;">${escapeHtmlWithBreaks(block.data.title)}</div>
<div style="font-size:${block.data.subtitleSize || 13}px; opacity:0.85; margin-bottom:14px; word-wrap:break-word; overflow-wrap:break-word;">${escapeHtmlWithBreaks(block.data.subtitle)}</div>
${ctaAbsolute ? `<a href="${escapeHtml(ctaAbsolute)}" style="display:inline-block; background:white; color:${block.data.bg}; padding:10px 22px; border-radius:999px; font-weight:600; font-size:${block.data.ctaSize || 13}px; text-decoration:none; word-wrap:break-word; overflow-wrap:break-word;">${escapeHtmlWithBreaks(block.data.cta)}</a>` : ""}
</div>
</div>`);
    }
    case "button": {
      const align = block.data.align || "center";
      // URL toujours absolue dans un mail : un href relatif type "/panier"
      // n'a pas de base côté client mail et casse le CTA. Fallback = home
      // boutique. Ignore les liens déjà absolus (http/https) et les mailto:.
      const rawUrl = (block.data.url ?? "").trim();
      const isAbsolute = /^(https?:\/\/|mailto:)/i.test(rawUrl);
      const url = rawUrl
        ? (isAbsolute ? rawUrl : absoluteUrl(shared.baseUrl, rawUrl))
        : shared.baseUrl;
      // ctaButton par défaut centre. Custom rendering si couleurs perso ou alignement autre.
      if (block.data.bg === "#0f172a" && block.data.color === "#ffffff" && align === "center") {
        return contained(ctaButton(block.data.label, url));
      }
      return contained(`<div style="text-align:${align}; margin:16px 0;">
<a href="${escapeHtml(url)}" style="display:inline-block; background:${block.data.bg}; color:${block.data.color}; padding:12px 28px; border-radius:10px; font-family:'Poppins', sans-serif; font-weight:600; font-size:${block.data.labelSize || 14}px; text-decoration:none; word-wrap:break-word; overflow-wrap:break-word; max-width:100%;">${escapeHtmlWithBreaks(block.data.label)}</a>
</div>`);
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
      return wrapBg(block.data.bg, contained(html));
    }
    case "imgtext": {
      const src = block.data.img ? absoluteUrl(shared.baseUrl, block.data.img) : "";
      const titleColor = block.data.titleColor || "#0f172a";
      const bodyColor = block.data.bodyColor || "#475569";
      // Alignements per-élément — fallback sur l'ancien `textAlign` global.
      const titleAlign = block.data.titleAlign ?? block.data.textAlign ?? "left";
      const bodyAlign = block.data.bodyAlign ?? block.data.textAlign ?? "left";
      const imgWidth = Math.max(20, Math.min(100, Number(block.data.imgWidth) || 45));
      const imgFull = src ? `<img src="${escapeHtml(src)}" alt="" style="width:100%; border-radius:8px; display:block;">` : "";
      const txtBlock = `<div style="font-family:'Poppins', sans-serif; font-size:${block.data.titleSize || 15}px; font-weight:700; color:${titleColor}; margin-bottom:6px; text-align:${titleAlign}; word-wrap:break-word; overflow-wrap:break-word;">${escapeHtmlWithBreaks(block.data.title)}</div>
<div style="font-size:${block.data.bodySize || 13}px; color:${bodyColor}; line-height:1.6; white-space:pre-wrap; text-align:${bodyAlign}; word-wrap:break-word; overflow-wrap:break-word;">${escapeHtml(block.data.body)}</div>`;
      const side = block.data.side;
      if (side === "top" || side === "bottom") {
        // Pour top/bottom, la largeur d'image contrôle sa taille en centrant.
        const imgWrap = src ? `<div style="width:${imgWidth}%; margin:0 auto;">${imgFull}</div>` : "";
        const imgRow = `<tr><td style="padding:0 10px 10px;">${imgWrap}</td></tr>`;
        const txtRow = `<tr><td style="padding:0 10px 10px;">${txtBlock}</td></tr>`;
        return wrapBg(block.data.bg, contained(`<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:16px 0;">${side === "top" ? imgRow + txtRow : txtRow + imgRow}</table>`));
      }
      const imgCell = `<td width="${imgWidth}%" style="padding:0 10px; vertical-align:middle;">${imgFull}</td>`;
      const txtCell = `<td style="vertical-align:middle; padding:0 10px;">${txtBlock}</td>`;
      return wrapBg(block.data.bg, contained(`<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:16px 0;"><tr>${side === "left" ? imgCell + txtCell : txtCell + imgCell}</tr></table>`));
    }
    case "list": {
      const color = block.data.color || "#334155";
      return wrapBg(block.data.bg, `<ul style="list-style:none; padding:12px 20px; margin:0;">
${block.data.items.map((item) => `<li style="padding:8px 0; font-size:${block.data.itemSize || 14}px; color:${color}; border-bottom:1px solid #f1f5f9; word-wrap:break-word; overflow-wrap:break-word;">${escapeHtml(item)}</li>`).join("")}
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
      return wrapBg(block.data.bg, contained(`<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:16px 0;"><tr>${cells}</tr></table>`));
    }
    case "divider":
      return contained(`<hr style="border:none; border-top:1px solid #e2e8f0; margin:16px 0;">`);
    case "cartItems": {
      const items = dynamic?.cart?.items ?? [];
      const totalCents = dynamic?.cart?.totalCents ?? 0;
      if (items.length === 0) {
        const msg = (block.data.emptyMessage || "Votre panier est vide.").trim();
        return contained(`<p style="font-size:13px; color:#475569; line-height:1.6; margin:16px 0;">${escapeHtml(msg)}</p>`);
      }
      const title = block.data.title?.trim();
      const titleHtml = title
        ? `<div style="font-family:'Poppins', sans-serif; font-size:14px; font-weight:700; color:#0f172a; margin:0 0 10px;">${escapeHtml(title)}</div>`
        : "";
      let list = `<div style="background:#f8fafc; border-radius:10px; padding:12px; margin:12px 0;">`;
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const border = i < items.length - 1 ? "border-bottom:1px solid #e2e8f0;" : "";
        list += `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="${border} padding:6px 0;"><tr>`;
        if (it.imagePath) {
          list += `<td width="48" style="padding-right:10px; vertical-align:top;"><img src="${escapeHtml(absoluteUrl(shared.baseUrl, it.imagePath))}" width="40" height="40" alt="" style="width:40px; height:40px; border-radius:6px; object-fit:cover; display:block;"></td>`;
        }
        list += `<td style="vertical-align:top;">
          <div style="font-size:12px; color:#0f172a; font-weight:600;">${escapeHtml(it.productName)}</div>
          <div style="font-size:10.5px; color:#64748b;">${it.colorName ? escapeHtml(it.colorName) + " · " : ""}x${it.quantity}</div>
        </td>
        <td align="right" style="vertical-align:top; white-space:nowrap;">
          <div style="font-size:12px; color:#0f172a; font-weight:700;">${formatEuros(it.totalCents)}</div>
        </td></tr></table>`;
      }
      const totalLabel = (block.data.totalLabel || "Total").trim();
      list += `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-top:2px solid #cbd5e1; padding-top:8px; margin-top:6px;"><tr>
        <td style="font-size:13px; font-weight:700; color:#0f172a;">${escapeHtml(totalLabel)}</td>
        <td align="right" style="font-size:14px; font-weight:700; color:#0f172a;">${formatEuros(totalCents)}</td>
      </tr></table></div>`;
      return wrapBg(block.data.bg, contained(titleHtml + list));
    }
    case "favoritesGrid": {
      const favorites = dynamic?.favorites ?? [];
      if (favorites.length === 0) {
        const msg = (block.data.emptyMessage || "Aucun produit sélectionné.").trim();
        return contained(`<p style="font-size:13px; color:#475569; line-height:1.6; margin:16px 0;">${escapeHtml(msg)}</p>`);
      }
      const cols = block.data.cols || 2;
      let html = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:12px 0;">`;
      for (let i = 0; i < favorites.length; i += cols) {
        html += `<tr>`;
        const row = favorites.slice(i, i + cols);
        for (const f of row) {
          const width = `${Math.floor(100 / cols)}%`;
          const imgSrc = f.imagePath ? absoluteUrl(shared.baseUrl, f.imagePath) : "";
          html += `<td width="${width}" style="padding:6px; vertical-align:top;">
            <div style="border:1px solid #e2e8f0; border-radius:8px; padding:8px;">
              ${imgSrc ? `<img src="${escapeHtml(imgSrc)}" alt="" style="width:100%; height:120px; object-fit:cover; border-radius:6px; display:block; margin-bottom:6px;">` : `<div style="height:120px; background:#f1f5f9; border-radius:6px; margin-bottom:6px;"></div>`}
              <div style="font-size:12px; font-family:'Poppins', sans-serif; font-weight:600; color:#0f172a;">${escapeHtml(f.productName)}</div>
              ${f.colorName ? `<div style="font-size:11px; color:#64748b;">${escapeHtml(f.colorName)}</div>` : ""}
              <div style="font-size:12px; color:#0f172a; font-weight:700; margin-top:4px;">${formatEuros(f.priceCents)}</div>
            </div>
          </td>`;
        }
        for (let k = row.length; k < cols; k++) html += `<td width="${Math.floor(100 / cols)}%"></td>`;
        html += `</tr>`;
      }
      html += `</table>`;
      return wrapBg(block.data.bg, contained(html));
    }
    case "daysInactive": {
      const days = dynamic?.daysInactive;
      const color = block.data.color || "#475569";
      const tpl = days === null || days === undefined
        ? (block.data.neverVisitedTemplate || "Vous n'avez encore jamais visité notre boutique.")
        : (block.data.template || "Cela fait {days} jour(s) qu'on ne vous a pas vu.");
      const text = tpl.replace(/\{days\}/g, days == null ? "" : String(days));
      return wrapBg(block.data.bg, contained(`<p style="font-size:13px; color:${color}; line-height:1.6; margin:12px 0;">${escapeHtml(text)}</p>`));
    }
  }
}
