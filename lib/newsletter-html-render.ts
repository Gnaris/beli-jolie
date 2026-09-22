/**
 * Rendu des modèles newsletter au format "html" (éditeur HTML/CSS libre).
 *
 * Contrairement au format "blocks" (voir `lib/newsletter-blocks.ts`), la
 * cliente écrit directement du HTML dans l'éditeur — pas de structure JSON,
 * pas de composition automatique. Ce module se contente :
 *
 *   1. de remplacer chaque token `{{img.<nom>}}` par l'URL absolue de l'image
 *      correspondante dans la bibliothèque du modèle ;
 *   2. d'interpoler les merge vars `{firstName}`, `{shopName}`, etc. via le
 *      module `mail-merge-variables` — mêmes règles que le format "blocks".
 *
 * Le HTML est utilisé tel quel (aucun wrap automatique) : la cliente est
 * responsable de son propre `<!doctype html>`, `<head>`, `<body>` et de ses
 * mentions légales. La validation à la sauvegarde s'assure que les 4
 * variables marketing obligatoires (`{shopName}`, `{shopAddress}`,
 * `{unsubscribeLink}`, `{privacyLink}`) sont présentes quelque part dans le
 * source.
 */

import { interpolate, type MailMergeContext } from "@/lib/mail-merge-variables";

/**
 * Structure minimale d'une image de bibliothèque (mapping nom → URL publique).
 * Les callers qui ont un `NewsletterTemplateImage` complet peuvent le passer
 * tel quel, seuls `name` et `path` sont lus.
 */
export interface TemplateImageRef {
  name: string;
  path: string;
}

/**
 * Convertit un chemin BDD ("/uploads/…") en URL absolue en préfixant avec
 * `baseUrl`. Laisse intactes les URLs déjà absolues (http/https) ainsi que
 * les URIs `data:` (utilisés pour les placeholders d'aperçu client-side).
 */
function toAbsoluteUrl(baseUrl: string, path: string): string {
  if (!path) return "";
  if (/^(https?:\/\/|data:)/i.test(path)) return path;
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${baseUrl.replace(/\/+$/, "")}${normalized}`;
}

/**
 * Remplace tous les `{{img.<nom>}}` du HTML par l'URL absolue de l'image
 * correspondante. Les tokens dont le nom ne correspond à aucune image
 * connue sont conservés tels quels — utile pour repérer les fautes de
 * frappe à la relecture d'un envoi de test.
 *
 * La syntaxe accepte `{{img.<nom>}}` avec ou sans espaces autour :
 *  `{{img.hero}}`, `{{ img.hero }}` fonctionnent identiquement.
 * Le nom est un slug (a-z, 0-9, tirets/underscores) — même règle qu'à
 * l'upload de l'image côté server action.
 */
export function substituteTemplateImages(
  html: string,
  images: readonly TemplateImageRef[],
  baseUrl: string,
): string {
  if (!html) return html;
  const byName = new Map<string, string>();
  for (const img of images) {
    byName.set(img.name, toAbsoluteUrl(baseUrl, img.path));
  }
  return html.replace(/\{\{\s*img\.([a-z0-9_-]+)\s*\}\}/gi, (match, name: string) => {
    const url = byName.get(name.toLowerCase());
    return url ?? match;
  });
}

/**
 * Retire les blocs `{{#each …}}…{{/each}}` du HTML avant analyse. Utilisé
 * par `extractHrefs` : les hrefs à l'intérieur d'une boucle sont dupliqués
 * par article/favori à l'envoi — ils n'ont pas de sens à être configurés
 * globalement via le picker de liens (choix produit UI : on ignore, cf.
 * décision cliente 2026-09-22).
 */
function stripIterations(html: string): string {
  return html.replace(EACH_REGEX, "");
}

/**
 * Extrait la liste unique des valeurs `href="…"` présentes dans le HTML,
 * en excluant celles à l'intérieur des boucles `{{#each …}}…{{/each}}`.
 * Utilisé par le panneau « Liens du mail » de l'éditeur — chaque href
 * détecté ouvre un picker de cible (Accueil / Produit / Catégorie / …).
 *
 * Règles :
 *  - Accepte guillemets simples `'` ou doubles `"`.
 *  - Trim les whitespaces.
 *  - Dédoublonne (une URL configurée = tous ses hrefs récrits).
 *  - IGNORE les hrefs qui contiennent un token merge var (ex. `{unsubscribeLink}`,
 *    `{privacyLink}`, `{shopWebsite}`) — la cliente les gère via les variables,
 *    pas via le picker.
 */
export function extractHrefs(html: string): string[] {
  if (!html) return [];
  const stripped = stripIterations(html);
  const seen = new Set<string>();
  const order: string[] = [];
  const re = /<a\b[^>]*\bhref\s*=\s*(["'])([\s\S]*?)\1/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stripped)) !== null) {
    // On garde la valeur EXACTE (non-trimée) pour que la ré-écriture retrouve
    // l'occurrence à l'identique. Les hrefs vides (`href=""`) sont volontai-
    // rement remontés — la cliente doit pouvoir les configurer. Idem pour
    // les `href="#"` : placeholders générés par ChatGPT.
    const raw = m[2];
    // Skip les URLs entièrement composées d'un token merge ({unsubscribeLink},
    // {privacyLink}, {shopLink}…) — gérées via les merge vars, pas le picker.
    if (/^\s*\{[a-zA-Z][a-zA-Z0-9_]*\}\s*$/.test(raw)) continue;
    if (seen.has(raw)) continue;
    seen.add(raw);
    order.push(raw);
  }
  return order;
}

/**
 * Compte les `<a>` sans attribut `href` — ChatGPT oublie régulièrement d'en
 * poser un, ce qui rend le lien invisible au panneau « Liens du mail »
 * (extractHrefs ne peut pas les capturer). Utilisé par l'éditeur pour
 * proposer un fix en 1 clic via `injectMissingHrefs`.
 */
export function countAnchorsWithoutHref(html: string): number {
  if (!html) return 0;
  let count = 0;
  const re = /<a\b([^>]*)>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    if (!/\bhref\s*=/i.test(m[1])) count++;
  }
  return count;
}

/**
 * Injecte `href="#"` sur chaque `<a>` sans attribut `href`. Retourne le HTML
 * corrigé + le nombre d'injections. Attributs existants préservés dans leur
 * ordre et leur formatage (multi-ligne toléré). Idempotent : ré-exécuter
 * sur un HTML déjà propre ne modifie rien.
 */
export function injectMissingHrefs(html: string): { html: string; injected: number } {
  if (!html) return { html, injected: 0 };
  let injected = 0;
  const out = html.replace(/<a\b([^>]*)>/gi, (match, attrs: string) => {
    if (/\bhref\s*=/i.test(attrs)) return match;
    injected++;
    // href vide — la cliente le configure ensuite via le picker « Liens du mail ».
    // On préfixe d'un espace pour ne pas coller au `<a` ou au 1er attribut existant.
    return `<a href=""${attrs}>`;
  });
  return { html: out, injected };
}

/**
 * Récrit toutes les occurrences de `href="OLD"` (ou `href='OLD'`) par
 * `href="NEW"` en préservant la casse du guillemet original. Utilisé par
 * le panneau de liens à la validation du picker. Retourne le HTML mis à
 * jour + le nombre d'occurrences récrites (utile pour le toast).
 */
export function rewriteHref(
  html: string,
  oldValue: string,
  newValue: string,
): { html: string; count: number } {
  if (!html || oldValue === newValue) return { html, count: 0 };
  // Échappe les caractères regex de `oldValue` pour construire un pattern sûr.
  const esc = oldValue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let count = 0;
  const out = html.replace(
    new RegExp(`(\\bhref\\s*=\\s*)(["'])${esc}\\2`, "gi"),
    (_full, prefix: string, quote: string) => {
      count += 1;
      return `${prefix}${quote}${newValue}${quote}`;
    },
  );
  return { html: out, count };
}

/**
 * Extrait la liste des noms d'images référencés dans un HTML via la syntaxe
 * `{{img.<nom>}}`. Utilisé par l'éditeur pour détecter les images citées dans
 * le HTML mais pas encore uploadées, et proposer un upload rapide.
 *
 * Retourne les noms en minuscules, dédoublonnés, dans l'ordre d'apparition
 * (utile pour un affichage stable côté UI).
 */
export function extractImageTokens(html: string): string[] {
  if (!html) return [];
  const seen = new Set<string>();
  const order: string[] = [];
  const re = /\{\{\s*img\.([a-z0-9_-]+)\s*\}\}/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const name = m[1].toLowerCase();
    if (!seen.has(name)) {
      seen.add(name);
      order.push(name);
    }
  }
  return order;
}

/* ─────────────────────────────────────────────
   Contexte dynamique (scénarios)
   ───────────────────────────────────────────── */

/** Format monétaire fr-FR — utilisé dans les substitutions {total}, {price}. */
function formatEuros(cents: number): string {
  return (cents / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
}

/**
 * Un article du panier tel qu'exposé dans une boucle `{{#each cart}}…{{/each}}`
 * du HTML — chaque itération remplace les tokens {image}, {name}, {color},
 * {qty}, {total} par les valeurs de l'article courant.
 */
export interface HtmlCartItem {
  productName: string;
  colorName: string | null;
  quantity: number;
  totalCents: number;
  imagePath: string | null;
}

/** Un favori (grille de produits pour scénario RESTOCK). */
export interface HtmlFavorite {
  productName: string;
  colorName: string | null;
  priceCents: number;
  imagePath: string | null;
}

/**
 * Données injectées dans les boucles `{{#each …}}` du HTML. Absent → les
 * boucles sont expansées à vide (0 itération). Utile pour l'aperçu : afficher
 * un mail scénario sans forcément avoir les vraies données du client.
 */
export interface HtmlDynamicContext {
  cart?: { items: readonly HtmlCartItem[]; totalCents: number };
  favorites?: readonly HtmlFavorite[];
}

// Match `{{#each XXX}}…{{/each}}` où XXX = cart|favorites. `[\s\S]*?` non greedy
// pour supporter plusieurs boucles dans le même HTML sans que la 1ʳᵉ mange les
// suivantes. Le flag `i` tolère la casse (`{{#EACH cart}}` marche aussi).
const EACH_REGEX = /\{\{\s*#each\s+([a-z]+)\s*\}\}([\s\S]*?)\{\{\s*\/each\s*\}\}/gi;

/**
 * Placeholder SVG (rectangle gris avec un pictogramme photo) utilisé quand
 * un article de panier ou un favori n'a pas d'image en base. Encodé en URI
 * `data:` inline pour rester autonome (ni fetch réseau ni fichier statique).
 * Fallback visible dans l'aperçu ET dans les vrais mails — évite les `src=""`
 * qui affichent l'icône « image cassée » du client mail.
 */
export const MISSING_IMAGE_PLACEHOLDER =
  "data:image/svg+xml;utf8," +
  "%3Csvg%20xmlns%3D'http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg'%20viewBox%3D'0%200%20100%20100'%3E" +
  "%3Crect%20width%3D'100'%20height%3D'100'%20fill%3D'%23e2e8f0'%2F%3E" +
  "%3Cpath%20d%3D'M30%2035h40v30H30zM40%2045l6%206%206-8%2010%2012H34z'%20fill%3D'%2394a3b8'%2F%3E" +
  "%3Ccircle%20cx%3D'42'%20cy%3D'44'%20r%3D'3'%20fill%3D'%2394a3b8'%2F%3E%3C%2Fsvg%3E";

/**
 * Neutralise les tokens `{{#each …}}` et `{{/each}}` présents à l'intérieur
 * d'un commentaire HTML (`<!-- … -->`). Sans ça, `EACH_REGEX` matche parfois
 * le token du commentaire, capture tout jusqu'au vrai `{{/each}}`, et rend
 * le contenu du commentaire visible et dupliqué à chaque itération.
 * Ne touche pas au contenu du commentaire lui-même (Outlook conditional
 * comments `<!--[if mso]>…<![endif]-->` restent fonctionnels), on remplace
 * seulement les tokens problématiques par des chaînes littérales.
 */
function maskIterationTokensInComments(html: string): string {
  return html.replace(/<!--[\s\S]*?-->/g, (comment) =>
    comment
      .replace(/\{\{\s*#each\s+([a-z]+)\s*\}\}/gi, "«each $1»")
      .replace(/\{\{\s*\/each\s*\}\}/gi, "«/each»"),
  );
}

/**
 * Rendu d'une ligne de panier — tokens ligne substitués par les valeurs
 * réelles de l'article. Image absolutisée via `baseUrl`, prix formaté fr-FR.
 * Un token inconnu (typo dans le template ligne) est laissé tel quel pour
 * repérage à la relecture.
 */
function renderCartLine(
  template: string,
  item: HtmlCartItem,
  baseUrl: string,
): string {
  const ctx: MailMergeContext = {
    image: item.imagePath
      ? toAbsoluteUrl(baseUrl, item.imagePath)
      : MISSING_IMAGE_PLACEHOLDER,
    name: item.productName,
    color: item.colorName ?? "",
    qty: String(item.quantity),
    total: formatEuros(item.totalCents),
  };
  return interpolate(template, ctx);
}

function renderFavoriteLine(
  template: string,
  fav: HtmlFavorite,
  baseUrl: string,
): string {
  const ctx: MailMergeContext = {
    image: fav.imagePath
      ? toAbsoluteUrl(baseUrl, fav.imagePath)
      : MISSING_IMAGE_PLACEHOLDER,
    name: fav.productName,
    color: fav.colorName ?? "",
    price: formatEuros(fav.priceCents),
  };
  return interpolate(template, ctx);
}

/**
 * Nombre maximum d'articles / favoris affichés dans une boucle `{{#each}}`.
 * Au-delà, on tronque et on expose le nombre non affiché via les tokens
 * `{cartMoreCount}` + `{cartMoreText}` (resp. `{favoritesMoreCount}` +
 * `{favoritesMoreText}`). Choisi produit-side : 8 articles = mail court,
 * lisible sur mobile, sans casser le fold (« Reprendre mon panier » reste
 * atteignable sans scroll interminable).
 */
export const MAX_LOOP_ITEMS = 8;

/**
 * Tronque `cart.items` / `favorites` à `MAX_LOOP_ITEMS` et produit les
 * tokens de merge qui décrivent le reste (« … et 3 autres articles »).
 * Callers :
 *  - `renderNewsletterHtmlForSend` (envoi réel) — appliqué en interne.
 *  - éditeur en aperçu local — pour montrer la même troncature à l'écran.
 *
 * Renvoie un objet toujours défini pour éviter les branches côté caller —
 * même sans dynamic, `extraMerge` contient les tokens vides (« 0 » / "")
 * pour que l'interpolation ne laisse pas `{cartMoreText}` brut.
 */
export function applyDynamicLimits(
  dynamic: HtmlDynamicContext | undefined,
): { dynamic: HtmlDynamicContext | undefined; extraMerge: MailMergeContext } {
  const extraMerge: MailMergeContext = {
    cartMoreCount: "0",
    cartMoreText: "",
    favoritesMoreCount: "0",
    favoritesMoreText: "",
  };
  if (!dynamic) return { dynamic, extraMerge };

  const out: HtmlDynamicContext = { ...dynamic };

  if (dynamic.cart && dynamic.cart.items.length > MAX_LOOP_ITEMS) {
    const remaining = dynamic.cart.items.length - MAX_LOOP_ITEMS;
    out.cart = {
      items: dynamic.cart.items.slice(0, MAX_LOOP_ITEMS),
      totalCents: dynamic.cart.totalCents,
    };
    extraMerge.cartMoreCount = String(remaining);
    extraMerge.cartMoreText = `… et ${remaining} autre${remaining > 1 ? "s" : ""} article${remaining > 1 ? "s" : ""}`;
  }

  if (dynamic.favorites && dynamic.favorites.length > MAX_LOOP_ITEMS) {
    const remaining = dynamic.favorites.length - MAX_LOOP_ITEMS;
    out.favorites = dynamic.favorites.slice(0, MAX_LOOP_ITEMS);
    extraMerge.favoritesMoreCount = String(remaining);
    extraMerge.favoritesMoreText = `… et ${remaining} autre${remaining > 1 ? "s" : ""} favori${remaining > 1 ? "s" : ""}`;
  }

  return { dynamic: out, extraMerge };
}

/**
 * Développe toutes les boucles `{{#each cart}}…{{/each}}` /
 * `{{#each favorites}}…{{/each}}` en concaténant N rendus du template
 * interne (un par item). Nom de collection inconnu → laisse la boucle
 * intacte pour repérage.
 */
export function expandIterations(
  html: string,
  dynamic: HtmlDynamicContext | undefined,
  baseUrl: string,
): string {
  if (!html) return html;
  const masked = maskIterationTokensInComments(html);
  return masked.replace(EACH_REGEX, (match, key: string, lineTemplate: string) => {
    const k = key.toLowerCase();
    if (k === "cart") {
      const items = dynamic?.cart?.items ?? [];
      return items.map((it) => renderCartLine(lineTemplate, it, baseUrl)).join("");
    }
    if (k === "favorites") {
      const favs = dynamic?.favorites ?? [];
      return favs.map((f) => renderFavoriteLine(lineTemplate, f, baseUrl)).join("");
    }
    return match;
  });
}

/**
 * Rendu final d'un modèle newsletter HTML pour l'envoi :
 *   1. développement des boucles `{{#each cart}}…{{/each}}` (scénarios dyn.),
 *   2. substitution des images de la bibliothèque ({{img.nom}}),
 *   3. interpolation des merge vars ({firstName}, {shopName}, {unsubscribeLink}…).
 *
 * L'ordre importe : les boucles d'abord (produisent du HTML qui peut contenir
 * des `{{img.nom}}` ou des `{merge}`), puis images, puis merge vars.
 *
 * Retourne le HTML tel qu'envoyé au destinataire — la cliente doit avoir
 * inclus son propre `<!doctype>` / `<html>` dans le source.
 */
export function renderNewsletterHtmlForSend(params: {
  html: string;
  images: readonly TemplateImageRef[];
  baseUrl: string;
  mergeContext?: MailMergeContext;
  dynamic?: HtmlDynamicContext;
}): string {
  // Troncature à MAX_LOOP_ITEMS + tokens {cartMoreText}/{favoritesMoreText}
  // pour signaler proprement les items non affichés en dessous de la boucle.
  const { dynamic: limited, extraMerge } = applyDynamicLimits(params.dynamic);
  const withIterations = expandIterations(params.html, limited, params.baseUrl);
  const withImages = substituteTemplateImages(withIterations, params.images, params.baseUrl);
  // extraMerge en dernier : nos calculs de troncature font autorité — ils
  // sont dérivés directement de la longueur réelle du cart/favorites, un
  // caller n'a pas de raison légitime de les fournir en override.
  const merged: MailMergeContext = { ...(params.mergeContext ?? {}), ...extraMerge };
  return interpolate(withImages, merged);
}
