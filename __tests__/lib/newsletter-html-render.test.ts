import { describe, it, expect } from "vitest";
import {
  applyDynamicLimits,
  countMarkdownCodeFences,
  expandIterations,
  extractHrefs,
  extractImageTokens,
  injectMissingHrefs,
  MAX_LOOP_ITEMS,
  renderNewsletterHtmlForSend,
  rewriteHref,
  stripMarkdownCodeFences,
  substituteTemplateImages,
  type HtmlCartItem,
  type HtmlDynamicContext,
  type HtmlFavorite,
} from "@/lib/newsletter-html-render";
import { buildLinkUrl } from "@/lib/newsletter-link-targets";
import { missingRequiredMarketingVariables } from "@/lib/mail-merge-variables";

const IMAGES = [
  { name: "hero", path: "/uploads/beliandjolie/newsletters/cly1/hero.webp" },
  { name: "logo", path: "/uploads/beliandjolie/newsletters/cly1/logo.webp" },
];
const BASE = "https://beliandjolie.com";

describe("substituteTemplateImages", () => {
  it("remplace {{img.nom}} par l'URL absolue", () => {
    const html = `<img src="{{img.hero}}"><img src="{{img.logo}}">`;
    const out = substituteTemplateImages(html, IMAGES, BASE);
    expect(out).toContain(`src="https://beliandjolie.com/uploads/beliandjolie/newsletters/cly1/hero.webp"`);
    expect(out).toContain(`src="https://beliandjolie.com/uploads/beliandjolie/newsletters/cly1/logo.webp"`);
  });

  it("tolère les espaces autour du token", () => {
    const html = `<img src="{{ img.hero }}">`;
    const out = substituteTemplateImages(html, IMAGES, BASE);
    expect(out).toContain(`hero.webp`);
    expect(out).not.toContain(`{{`);
  });

  it("laisse intact un token inconnu (utile pour repérer les fautes de frappe)", () => {
    const html = `<img src="{{img.inexistant}}">`;
    const out = substituteTemplateImages(html, IMAGES, BASE);
    expect(out).toBe(html);
  });

  it("respecte les URLs déjà absolues dans le path", () => {
    const html = `<img src="{{img.externe}}">`;
    const out = substituteTemplateImages(html, [{ name: "externe", path: "https://cdn.ex.com/x.png" }], BASE);
    expect(out).toContain(`src="https://cdn.ex.com/x.png"`);
  });

  it("chaîne vide -> chaîne vide sans crash", () => {
    expect(substituteTemplateImages("", IMAGES, BASE)).toBe("");
  });
});

describe("renderNewsletterHtmlForSend", () => {
  it("substitue images ET merge vars", () => {
    const html = `<p>Bonjour {firstName}, voici {shopName} !</p><img src="{{img.hero}}">`;
    const out = renderNewsletterHtmlForSend({
      html,
      images: IMAGES,
      baseUrl: BASE,
      mergeContext: { firstName: "Marie", shopName: "Beli & Jolie" },
    });
    expect(out).toContain("Bonjour Marie, voici Beli & Jolie !");
    expect(out).toContain("hero.webp");
  });

  it("sans mergeContext, ne touche que les images", () => {
    const html = `<p>Salut {firstName}</p><img src="{{img.logo}}">`;
    const out = renderNewsletterHtmlForSend({ html, images: IMAGES, baseUrl: BASE });
    expect(out).toContain("{firstName}"); // pas substitué
    expect(out).toContain("logo.webp");
  });

  it("les tokens inconnus (image comme merge var) restent en place", () => {
    const html = `<p>{tokenBidon}</p><img src="{{img.zzz}}">`;
    const out = renderNewsletterHtmlForSend({
      html,
      images: IMAGES,
      baseUrl: BASE,
      mergeContext: { firstName: "Marie" },
    });
    expect(out).toContain("{tokenBidon}");
    expect(out).toContain("{{img.zzz}}");
  });
});

describe("extractImageTokens", () => {
  it("retourne la liste des noms d'images référencés", () => {
    const html = `<img src="{{img.hero}}"><img src="{{img.logo}}">`;
    expect(extractImageTokens(html)).toEqual(["hero", "logo"]);
  });

  it("dédoublonne les occurrences multiples", () => {
    const html = `<img src="{{img.hero}}"> ...loin... <img src="{{img.hero}}">`;
    expect(extractImageTokens(html)).toEqual(["hero"]);
  });

  it("préserve l'ordre d'apparition", () => {
    const html = `{{img.c}} {{img.a}} {{img.b}} {{img.a}}`;
    expect(extractImageTokens(html)).toEqual(["c", "a", "b"]);
  });

  it("normalise en minuscules", () => {
    const html = `{{img.HERO}} {{img.Hero}}`;
    expect(extractImageTokens(html)).toEqual(["hero"]);
  });

  it("HTML vide → tableau vide", () => {
    expect(extractImageTokens("")).toEqual([]);
  });

  it("tolère les espaces autour du token", () => {
    expect(extractImageTokens(`{{ img.hero }}`)).toEqual(["hero"]);
  });
});

describe("expandIterations — {{#each cart}}...{{/each}}", () => {
  const CART_ITEMS: HtmlCartItem[] = [
    { productName: "Bracelet doré", colorName: "Or", quantity: 2, totalCents: 4800, imagePath: "/uploads/x/p1.webp" },
    { productName: "Collier fin", colorName: null, quantity: 1, totalCents: 3200, imagePath: null },
  ];
  const CTX: HtmlDynamicContext = { cart: { items: CART_ITEMS, totalCents: 8000 } };
  const BASE = "https://beliandjolie.com";

  it("développe une boucle cart en N itérations", () => {
    const tpl = `<ul>{{#each cart}}<li>{name} × {qty}</li>{{/each}}</ul>`;
    const out = expandIterations(tpl, CTX, BASE);
    expect(out).toBe(`<ul><li>Bracelet doré × 2</li><li>Collier fin × 1</li></ul>`);
  });

  it("substitue {total} et formatage euros", () => {
    const tpl = `{{#each cart}}[{total}] {{/each}}`;
    const out = expandIterations(tpl, CTX, BASE);
    // formats fr-FR : U+00A0 pour l'espace insécable avant le symbole
    expect(out).toContain("[48,00");
    expect(out).toContain("[32,00");
  });

  it("substitue {image} en URL absolue", () => {
    const tpl = `{{#each cart}}<img src="{image}">{{/each}}`;
    const out = expandIterations(tpl, CTX, BASE);
    expect(out).toContain(`<img src="https://beliandjolie.com/uploads/x/p1.webp">`);
    // 2e item sans image → placeholder SVG (voir MISSING_IMAGE_PLACEHOLDER).
    expect(out).toContain(`<img src="data:image/svg+xml`);
    expect(out).not.toContain(`<img src="">`);
  });

  it("{color} vide → chaîne vide", () => {
    const tpl = `{{#each cart}}[{color}]{{/each}}`;
    const out = expandIterations(tpl, CTX, BASE);
    expect(out).toBe(`[Or][]`);
  });

  it("cart absent → boucle rendue vide (0 itération)", () => {
    const tpl = `<ul>{{#each cart}}<li>x</li>{{/each}}</ul>`;
    const out = expandIterations(tpl, undefined, BASE);
    expect(out).toBe(`<ul></ul>`);
  });

  it("cart présent mais items vide → 0 itération", () => {
    const tpl = `<ul>{{#each cart}}<li>x</li>{{/each}}</ul>`;
    const out = expandIterations(tpl, { cart: { items: [], totalCents: 0 } }, BASE);
    expect(out).toBe(`<ul></ul>`);
  });

  it("collection inconnue → laisse la boucle intacte", () => {
    const tpl = `<ul>{{#each unknown}}<li>x</li>{{/each}}</ul>`;
    const out = expandIterations(tpl, CTX, BASE);
    expect(out).toContain(`{{#each unknown}}`);
  });

  it("plusieurs boucles ne se mangent pas mutuellement (non-greedy)", () => {
    const tpl = `A{{#each cart}}{name}{{/each}} B{{#each cart}}{name}{{/each}}`;
    const out = expandIterations(tpl, CTX, BASE);
    expect(out).toBe(`ABracelet doréCollier fin BBracelet doréCollier fin`);
  });

  it("{{#each}} présent dans un commentaire HTML ne casse pas le rendu", () => {
    const tpl = `<!-- doc {{#each cart}} explication {{/each}} -->
<table>{{#each cart}}<tr>{name}</tr>{{/each}}</table>`;
    const out = expandIterations(tpl, CTX, BASE);
    // La vraie boucle est développée normalement (2 lignes)
    expect(out).toContain("<tr>Bracelet doré</tr>");
    expect(out).toContain("<tr>Collier fin</tr>");
    // Le commentaire est laissé intact (mais les tokens neutralisés)
    expect(out).toContain("<!--");
    expect(out).toContain("-->");
    // Le texte du commentaire ne doit PAS apparaître dupliqué entre 2 items
    const bracIdx = out.indexOf("Bracelet doré");
    const colIdx = out.indexOf("Collier fin");
    expect(out.slice(bracIdx, colIdx)).not.toContain("explication");
  });

  it("imagePath null → utilise le placeholder SVG (pas src vide)", () => {
    const tpl = `{{#each cart}}<img src="{image}">{{/each}}`;
    const emptyImageCart: HtmlDynamicContext = {
      cart: {
        items: [{ productName: "X", colorName: null, quantity: 1, totalCents: 100, imagePath: null }],
        totalCents: 100,
      },
    };
    const out = expandIterations(tpl, emptyImageCart, BASE);
    expect(out).toContain("data:image/svg+xml");
    expect(out).not.toContain(`src=""`);
  });
});

describe("renderNewsletterHtmlForSend avec dynamic", () => {
  it("pipeline complet : itération + images + merge vars", () => {
    const html = `Bonjour {firstName} !
      <table>{{#each cart}}<tr><td><img src="{image}"></td><td>{name} × {qty}</td></tr>{{/each}}</table>
      <img src="{{img.logo}}">
      Total : {cartTotal}`;
    const out = renderNewsletterHtmlForSend({
      html,
      images: [{ name: "logo", path: "/uploads/x/logo.webp" }],
      baseUrl: "https://beliandjolie.com",
      mergeContext: { firstName: "Marie", cartTotal: "80,00 €" },
      dynamic: {
        cart: {
          items: [{ productName: "Bracelet doré", colorName: "Or", quantity: 2, totalCents: 4800, imagePath: "/uploads/x/p1.webp" }],
          totalCents: 4800,
        },
      },
    });
    expect(out).toContain("Bonjour Marie !");
    expect(out).toContain("Bracelet doré × 2");
    expect(out).toContain("https://beliandjolie.com/uploads/x/p1.webp");
    expect(out).toContain("https://beliandjolie.com/uploads/x/logo.webp");
    expect(out).toContain("Total : 80,00 €");
  });
});

describe("applyDynamicLimits — cap 8 items + tokens de reste", () => {
  const makeItem = (i: number): HtmlCartItem => ({
    productName: `P${i}`, colorName: null, quantity: 1, totalCents: 100, imagePath: null,
  });
  const makeFav = (i: number): HtmlFavorite => ({
    productName: `F${i}`, colorName: null, priceCents: 100, imagePath: null,
  });

  it("cap MAX_LOOP_ITEMS = 8", () => {
    expect(MAX_LOOP_ITEMS).toBe(8);
  });

  it("panier ≤ 8 : rien n'est tronqué, tokens vides", () => {
    const items = Array.from({ length: 5 }, (_, i) => makeItem(i));
    const { dynamic, extraMerge } = applyDynamicLimits({ cart: { items, totalCents: 500 } });
    expect(dynamic?.cart?.items).toHaveLength(5);
    expect(extraMerge.cartMoreCount).toBe("0");
    expect(extraMerge.cartMoreText).toBe("");
  });

  it("panier 15 articles : tronque à 8, expose « … et 7 autres »", () => {
    const items = Array.from({ length: 15 }, (_, i) => makeItem(i));
    const { dynamic, extraMerge } = applyDynamicLimits({ cart: { items, totalCents: 1500 } });
    expect(dynamic?.cart?.items).toHaveLength(8);
    expect(extraMerge.cartMoreCount).toBe("7");
    expect(extraMerge.cartMoreText).toContain("7 autres articles");
  });

  it("panier 9 articles : « … et 1 autre article » (singulier)", () => {
    const items = Array.from({ length: 9 }, (_, i) => makeItem(i));
    const { dynamic, extraMerge } = applyDynamicLimits({ cart: { items, totalCents: 900 } });
    expect(dynamic?.cart?.items).toHaveLength(8);
    expect(extraMerge.cartMoreText).toContain("1 autre article");
    expect(extraMerge.cartMoreText).not.toContain("autres articles");
  });

  it("favoris 12 : tronque à 8, expose favoritesMoreText", () => {
    const favorites = Array.from({ length: 12 }, (_, i) => makeFav(i));
    const { dynamic, extraMerge } = applyDynamicLimits({ favorites });
    expect(dynamic?.favorites).toHaveLength(8);
    expect(extraMerge.favoritesMoreCount).toBe("4");
    expect(extraMerge.favoritesMoreText).toContain("4 autres favoris");
  });

  it("dynamic absent : tokens vides mais présents (évite {cartMoreText} brut)", () => {
    const { dynamic, extraMerge } = applyDynamicLimits(undefined);
    expect(dynamic).toBeUndefined();
    expect(extraMerge.cartMoreText).toBe("");
    expect(extraMerge.favoritesMoreText).toBe("");
  });
});

describe("renderNewsletterHtmlForSend — cap intégré au pipeline", () => {
  it("15 items → 8 lignes rendues + {cartMoreText} substitué", () => {
    const items = Array.from({ length: 15 }, (_, i) => ({
      productName: `Article ${i + 1}`, colorName: null, quantity: 1, totalCents: 100, imagePath: null,
    }));
    const html = `{{#each cart}}<li>{name}</li>{{/each}}<span>{cartMoreText}</span>`;
    const out = renderNewsletterHtmlForSend({
      html, images: [], baseUrl: "https://x",
      dynamic: { cart: { items, totalCents: 1500 } },
    });
    const liCount = (out.match(/<li>/g) ?? []).length;
    expect(liCount).toBe(8);
    expect(out).toContain("Article 1");
    expect(out).toContain("Article 8");
    expect(out).not.toContain("Article 9");
    expect(out).toContain("et 7 autres articles");
  });

  it("5 items → 5 lignes + {cartMoreText} vide", () => {
    const items = Array.from({ length: 5 }, (_, i) => ({
      productName: `A${i}`, colorName: null, quantity: 1, totalCents: 100, imagePath: null,
    }));
    const html = `{{#each cart}}<li>{name}</li>{{/each}}[{cartMoreText}]`;
    const out = renderNewsletterHtmlForSend({
      html, images: [], baseUrl: "https://x",
      dynamic: { cart: { items, totalCents: 500 } },
    });
    expect((out.match(/<li>/g) ?? []).length).toBe(5);
    expect(out).toContain("[]"); // cartMoreText vide
  });
});

describe("extractHrefs — capture des liens configurables", () => {
  it("extrait les hrefs de <a> avec leur libellé", () => {
    const html = `<a href="#">Un</a> <a href="https://x.com">Deux</a>`;
    expect(extractHrefs(html)).toEqual([
      { href: "#", label: "Un", occurrenceIndex: 0 },
      { href: "https://x.com", label: "Deux" },
    ]);
  });

  it("hrefs NON-configurés identiques → 1 entrée par occurrence (chacune avec son label)", () => {
    // Bug cliente 2026-09-24 : logo + bouton CTA partagent href="" → configurer
    // l'un propageait l'URL à l'autre. Fix : chaque occurrence est distincte.
    const html = `<a href="">Finaliser</a><a href="">Voir mes favoris</a>`;
    expect(extractHrefs(html)).toEqual([
      { href: "", label: "Finaliser", occurrenceIndex: 0 },
      { href: "", label: "Voir mes favoris", occurrenceIndex: 1 },
    ]);
  });

  it("URLs configurées identiques → 1 entrée dédoublonnée avec labels concaténés", () => {
    const html = `<a href="/produits">Voir tout</a><a href="/produits">Nos nouveautés</a>`;
    expect(extractHrefs(html)).toEqual([
      { href: "/produits", label: "Voir tout · Nos nouveautés" },
    ]);
  });

  it("ignore les hrefs à l'intérieur de {{#each cart}}", () => {
    const html = `<a href="#hero">Header</a>
{{#each cart}}<a href="/prod">{name}</a>{{/each}}
<a href="#footer">Footer</a>`;
    expect(extractHrefs(html)).toEqual([
      { href: "#hero", label: "Header", occurrenceIndex: 0 },
      { href: "#footer", label: "Footer", occurrenceIndex: 0 },
    ]);
  });

  it("ignore les hrefs qui sont uniquement un token merge (unsubscribeLink, privacyLink)", () => {
    const html = `<a href="{unsubscribeLink}">Désinscription</a><a href="{privacyLink}">Vie privée</a><a href="#cta">CTA</a>`;
    expect(extractHrefs(html)).toEqual([
      { href: "#cta", label: "CTA", occurrenceIndex: 0 },
    ]);
  });

  it("supporte guillemets simples et doubles", () => {
    const html = `<a href='#simple'>1</a><a href="#double">2</a>`;
    expect(extractHrefs(html)).toEqual([
      { href: "#simple", label: "1", occurrenceIndex: 0 },
      { href: "#double", label: "2", occurrenceIndex: 0 },
    ]);
  });

  it("HTML vide → tableau vide", () => {
    expect(extractHrefs("")).toEqual([]);
  });

  it("inclut les href vides (`href=\"\"`) pour permettre leur configuration", () => {
    const html = `<a href="">CTA</a>`;
    expect(extractHrefs(html)).toEqual([
      { href: "", label: "CTA", occurrenceIndex: 0 },
    ]);
  });

  it("prend l'alt de l'image si le <a> englobe une image", () => {
    const html = `<a href="#promo"><img src="{{img.hero}}" alt="Bandeau promo -20%"></a>`;
    expect(extractHrefs(html)).toEqual([
      { href: "#promo", label: "Bandeau promo -20%", occurrenceIndex: 0 },
    ]);
  });

  it("dépouille les balises internes du libellé (bold, span, styles inline)", () => {
    const html = `<a href="" style="padding:14px 32px;"><strong>Finaliser</strong> ma commande</a>`;
    expect(extractHrefs(html)).toEqual([
      { href: "", label: "Finaliser ma commande", occurrenceIndex: 0 },
    ]);
  });

  it("ordre : non-configurés d'abord, configurés ensuite", () => {
    const html = `<a href="/x">Deja OK</a><a href="">A configurer 1</a><a href="/y">Aussi OK</a><a href="">A configurer 2</a>`;
    expect(extractHrefs(html)).toEqual([
      { href: "", label: "A configurer 1", occurrenceIndex: 0 },
      { href: "", label: "A configurer 2", occurrenceIndex: 1 },
      { href: "/x", label: "Deja OK" },
      { href: "/y", label: "Aussi OK" },
    ]);
  });
});

describe("stripMarkdownCodeFences / countMarkdownCodeFences — nettoyage des fences IA", () => {
  it("retire ```html en ouverture et ``` en fermeture", () => {
    const html = "```html\n<!doctype html>\n<html>...</html>\n```";
    const { html: out, removed } = stripMarkdownCodeFences(html);
    expect(removed).toBe(2);
    expect(out).not.toContain("```");
    expect(out).toContain("<!doctype html>");
    expect(out).toContain("<html>...</html>");
  });

  it("retire les fences au milieu du HTML (ChatGPT découpe sa réponse en 2 blocs)", () => {
    // Cas cliente 2026-09-24 : ChatGPT recoupe son bloc → ``` au milieu du HTML.
    const html = `<table>
<tr><td>Bonjour</td></tr>
\`\`\`
\`\`\`html
<tr><td>Suite</td></tr>
</table>`;
    const { html: out, removed } = stripMarkdownCodeFences(html);
    expect(removed).toBe(2);
    expect(out).not.toContain("```");
    expect(out).toContain("Bonjour");
    expect(out).toContain("Suite");
  });

  it("idempotent sur HTML propre", () => {
    const html = `<p>Hello</p>`;
    const { html: out, removed } = stripMarkdownCodeFences(html);
    expect(removed).toBe(0);
    expect(out).toBe(html);
  });

  it("ne touche pas aux backticks isolés (< 3 consécutifs)", () => {
    const html = "<code>let x = `hello`</code>";
    const { html: out, removed } = stripMarkdownCodeFences(html);
    expect(removed).toBe(0);
    expect(out).toBe(html);
  });

  it("countMarkdownCodeFences détecte le nombre de fences", () => {
    expect(countMarkdownCodeFences("<p>ok</p>")).toBe(0);
    expect(countMarkdownCodeFences("```html\n<p>ok</p>\n```")).toBe(2);
    expect(countMarkdownCodeFences("```\n```\n```")).toBe(3);
  });
});

describe("injectMissingHrefs — auto-fix <a> sans href", () => {
  it("détecte les <a> sans href et injecte href=\"\"", () => {
    const html = `<a>Sans href</a><a href="#">Avec</a>`;
    const { html: out, injected } = injectMissingHrefs(html);
    expect(injected).toBe(1);
    expect(out).toContain(`<a href="">Sans href</a>`);
    expect(out).toContain(`<a href="#">Avec</a>`);
  });

  it("tolère les <a> multi-lignes générés par ChatGPT", () => {
    const html = `<a\n  style="color:red"\n>MULTI</a>`;
    const { html: out, injected } = injectMissingHrefs(html);
    expect(injected).toBe(1);
    expect(out).toContain(`href=""`);
  });

  it("idempotent : ré-exécution sur HTML propre n'injecte rien", () => {
    const html = `<a href="">A</a>`;
    const { injected } = injectMissingHrefs(html);
    expect(injected).toBe(0);
  });
});

describe("rewriteHref — récriture ciblée dans le HTML", () => {
  it("sans occurrenceIndex → remplace toutes les occurrences de la même URL", () => {
    const html = `<a href="#">A</a><a href="#">B</a><a href="/x">C</a>`;
    const { html: out, count } = rewriteHref(html, "#", "https://x.com/fr");
    expect(count).toBe(2);
    expect(out).toBe(`<a href="https://x.com/fr">A</a><a href="https://x.com/fr">B</a><a href="/x">C</a>`);
  });

  it("occurrenceIndex=0 → ne remplace QUE la 1ʳᵉ occurrence, laisse les autres intactes", () => {
    // Cas cliente : logo (occurrence 0) + bouton CTA (occurrence 1) partagent href="".
    const html = `<a href="">Logo</a><a href="">CTA</a>`;
    const { html: out, count } = rewriteHref(html, "", "https://beliandjolie.com/fr", 0);
    expect(count).toBe(1);
    expect(out).toBe(`<a href="https://beliandjolie.com/fr">Logo</a><a href="">CTA</a>`);
  });

  it("occurrenceIndex=1 → ne remplace QUE la 2ème occurrence", () => {
    const html = `<a href="">Logo</a><a href="">CTA</a>`;
    const { html: out, count } = rewriteHref(html, "", "https://beliandjolie.com/fr/panier", 1);
    expect(count).toBe(1);
    expect(out).toBe(`<a href="">Logo</a><a href="https://beliandjolie.com/fr/panier">CTA</a>`);
  });

  it("occurrenceIndex ignore les hrefs d'une autre valeur", () => {
    const html = `<a href="">A</a><a href="#">B</a><a href="">C</a>`;
    const { html: out, count } = rewriteHref(html, "", "/x", 1);
    // La 2ème occurrence de `href=""` est le <a>C, pas le <a>B (autre valeur).
    expect(count).toBe(1);
    expect(out).toBe(`<a href="">A</a><a href="#">B</a><a href="/x">C</a>`);
  });

  it("préserve les guillemets simples", () => {
    const html = `<a href='#'>A</a>`;
    const { html: out } = rewriteHref(html, "#", "https://x.com");
    expect(out).toBe(`<a href='https://x.com'>A</a>`);
  });

  it("échappe les caractères regex dans oldValue", () => {
    const html = `<a href="https://x.com/?q=a&b=c">A</a>`;
    const { html: out, count } = rewriteHref(html, "https://x.com/?q=a&b=c", "https://y.com");
    expect(count).toBe(1);
    expect(out).toBe(`<a href="https://y.com">A</a>`);
  });

  it("URL identique → 0 récriture, HTML inchangé", () => {
    const html = `<a href="#">A</a>`;
    const { html: out, count } = rewriteHref(html, "#", "#");
    expect(count).toBe(0);
    expect(out).toBe(html);
  });
});

describe("buildLinkUrl — construction URLs cibles", () => {
  const BASE = "https://beliandjolie.com";
  it("home → /fr", () => {
    expect(buildLinkUrl(BASE, { kind: "home" })).toBe("https://beliandjolie.com/fr");
  });
  it("cart → /fr/panier", () => {
    expect(buildLinkUrl(BASE, { kind: "cart" })).toBe("https://beliandjolie.com/fr/panier");
  });
  it("custom → URL renvoyée telle quelle (avec trim)", () => {
    expect(buildLinkUrl(BASE, { kind: "custom", url: "https://exemple.com/promo" }))
      .toBe("https://exemple.com/promo");
    expect(buildLinkUrl(BASE, { kind: "custom", url: "  mailto:contact@x.fr  " }))
      .toBe("mailto:contact@x.fr");
  });
  it("products (liste)", () => {
    expect(buildLinkUrl(BASE, { kind: "products" })).toBe("https://beliandjolie.com/fr/produits");
  });
  it("product (détail avec handle)", () => {
    expect(buildLinkUrl(BASE, { kind: "product", id: "x", name: "N", reference: "A123", handle: "n-a123" }))
      .toBe("https://beliandjolie.com/fr/produits/n-a123");
  });
  it("category (détail avec slug)", () => {
    expect(buildLinkUrl(BASE, { kind: "category", id: "x", name: "Bijoux", slug: "bijoux" }))
      .toBe("https://beliandjolie.com/fr/categories/bijoux");
  });
  it("about + contact", () => {
    expect(buildLinkUrl(BASE, { kind: "about" })).toBe("https://beliandjolie.com/fr/a-propos");
    expect(buildLinkUrl(BASE, { kind: "contact" })).toBe("https://beliandjolie.com/fr/nous-contacter");
  });
  it("trim slashes finaux du baseUrl", () => {
    expect(buildLinkUrl("https://beliandjolie.com/", { kind: "home" })).toBe("https://beliandjolie.com/fr");
  });
});

describe("validation footer marketing sur HTML", () => {
  it("un HTML sans les 4 tokens obligatoires est rejeté", () => {
    const html = `<p>Bonjour {firstName}</p>`;
    const missing = missingRequiredMarketingVariables(html);
    const tokens = missing.map((v) => v.token);
    expect(tokens).toEqual(expect.arrayContaining(["shopName", "shopAddress", "unsubscribeLink", "privacyLink"]));
  });

  it("un HTML avec les 4 tokens passe", () => {
    const html = `
      <body>
        <p>Contenu</p>
        <footer>{shopName} · {shopAddress}<br>
          Désinscription : {unsubscribeLink}<br>
          Politique : {privacyLink}
        </footer>
      </body>`;
    const missing = missingRequiredMarketingVariables(html);
    expect(missing).toHaveLength(0);
  });

  it("un HTML avec 3 tokens sur 4 remonte le manquant", () => {
    const html = `{shopName} {shopAddress} {unsubscribeLink}`;
    const missing = missingRequiredMarketingVariables(html);
    expect(missing.map((v) => v.token)).toEqual(["privacyLink"]);
  });
});
