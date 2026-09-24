import { describe, it, expect } from "vitest";
import {
  annotateHtmlForInlineEdit,
  applyImageMutation,
  applyLinkMutation,
  applyTextMutation,
  readAttrValue,
  readTextContent,
  stripEditAttrs,
  wrapElementInLink,
} from "@/lib/newsletter-inline-edit";

describe("annotateHtmlForInlineEdit — annotation des balises éditables", () => {
  it("annote <img> avec data-bj-edit-id", () => {
    const { annotated, entries } = annotateHtmlForInlineEdit(`<img src="/a.webp" alt="A">`);
    expect(entries).toEqual([{ id: "1", kind: "image" }]);
    expect(annotated).toBe(`<img src="/a.webp" alt="A" data-bj-edit-id="1">`);
  });

  it("annote <a> avec data-bj-edit-id", () => {
    const { annotated, entries } = annotateHtmlForInlineEdit(`<a href="/x">Cliquer</a>`);
    expect(entries).toEqual([{ id: "1", kind: "link" }]);
    expect(annotated).toBe(`<a href="/x" data-bj-edit-id="1">Cliquer</a>`);
  });

  it("annote <p>texte simple</p> comme kind=text", () => {
    const { annotated, entries } = annotateHtmlForInlineEdit(`<p>Bonjour tout le monde</p>`);
    expect(entries).toEqual([{ id: "1", kind: "text" }]);
    expect(annotated).toBe(`<p data-bj-edit-id="1">Bonjour tout le monde</p>`);
  });

  it("ACCEPTE d'annoter un texte qui contient un token merge {firstName}", () => {
    // Depuis 2026-09-24 : la modale d'édition propose une palette de
    // variables pour ré-insérer les tokens effacés par erreur.
    const { annotated, entries } = annotateHtmlForInlineEdit(`<p>Bonjour {firstName}</p>`);
    expect(entries).toEqual([{ id: "1", kind: "text" }]);
    expect(annotated).toBe(`<p data-bj-edit-id="1">Bonjour {firstName}</p>`);
  });

  it("REFUSE d'annoter un texte qui contient un bloc `{{#each}}` (structure de boucle)", () => {
    const { entries } = annotateHtmlForInlineEdit(`<td>{{#each cart}}x{{/each}}</td>`);
    expect(entries).toEqual([]);
  });

  it("REFUSE d'annoter les tags à l'intérieur d'un bloc {{#each}} — items dynamiques du panier", () => {
    // Sinon éditer un `<td>{name}</td>` d'un item panier casserait le template
    // pour TOUS les articles à l'envoi (le bloc est développé N fois).
    const html = `<img src="/logo.webp">
{{#each cart}}
  <tr>
    <td><img src="/item.webp" alt="{name}"></td>
    <td><a href="/produit">{name}</a></td>
    <td>{total}</td>
  </tr>
{{/each}}
<p>Total : {cartTotal}</p>`;
    const { entries } = annotateHtmlForInlineEdit(html);
    // Attendu : logo (image en dehors de la boucle) + <p>Total : {cartTotal}</p>
    // (texte en dehors). Rien à l'intérieur de {{#each cart}}.
    expect(entries).toEqual([
      { id: "1", kind: "image" },
      { id: "2", kind: "text" },
    ]);
  });

  it("REFUSE d'annoter un tag texte qui contient une sous-balise", () => {
    // On refuse pour éviter la désorganisation dans la modale d'édition
    // rich text quand le bloc contient un mix texte + balises. L'admin
    // édite les sous-balises annotées séparément (le <strong> ici).
    const { annotated, entries } = annotateHtmlForInlineEdit(`<p>Voici <strong>gras</strong></p>`);
    expect(entries).toEqual([{ id: "1", kind: "text" }]);
    expect(annotated).toBe(`<p>Voici <strong data-bj-edit-id="1">gras</strong></p>`);
  });

  it("REFUSE d'annoter un <td> mixte — le prompt IA doit séparer en tags propres", () => {
    // Le prompt IA demande un `<span>{shopName}...</span>` séparé d'un
    // `<a>...</a>` frère, pour que chaque bloc soit éditable seul et rester
    // lisible dans la modale d'édition.
    const html = `<td>{shopName} · {shopAddress}<br><a href="/x">A</a></td>`;
    const { entries } = annotateHtmlForInlineEdit(html);
    expect(entries).toEqual([{ id: "1", kind: "link" }]);
  });

  it("annote un <img> à l'intérieur d'un <a> (cas logo cliquable)", () => {
    // Cas cliente 2026-09-24 : logo = <a href=""><img></a>. Sans cette
    // séparation, le clic droit sur l'img remontait au <a> et proposait
    // « Configurer le lien » au lieu de « Remplacer l'image ».
    const html = `<a href=""><img src="/logo.webp" alt="Logo"></a>`;
    const { annotated, entries } = annotateHtmlForInlineEdit(html);
    expect(entries).toEqual([
      { id: "1", kind: "image" },
      { id: "2", kind: "link" },
    ]);
    expect(annotated).toBe(
      `<a href="" data-bj-edit-id="2"><img src="/logo.webp" alt="Logo" data-bj-edit-id="1"></a>`,
    );
  });

  it("REFUSE d'annoter un texte vide / whitespace", () => {
    const { entries } = annotateHtmlForInlineEdit(`<p>   </p><p></p>`);
    expect(entries).toEqual([]);
  });

  it("IDs séquentiels 1, 2, 3… dans l'ordre du DOM", () => {
    const html = `<img src="/a.webp"><a href="/x">Lien</a><p>Texte</p>`;
    const { entries } = annotateHtmlForInlineEdit(html);
    expect(entries).toEqual([
      { id: "1", kind: "image" },
      { id: "2", kind: "link" },
      { id: "3", kind: "text" },
    ]);
  });

  it("idempotent : re-annoter renumérote depuis 1 (pas de doublons)", () => {
    const html = `<img src="/a.webp" alt="A">`;
    const first = annotateHtmlForInlineEdit(html);
    const second = annotateHtmlForInlineEdit(first.annotated);
    expect(second.annotated).toBe(first.annotated);
    expect(second.entries).toEqual(first.entries);
  });

  it("<img> auto-fermant supporté", () => {
    const { annotated } = annotateHtmlForInlineEdit(`<img src="/a.webp" alt="A"/>`);
    expect(annotated).toBe(`<img src="/a.webp" alt="A" data-bj-edit-id="1"/>`);
  });

  it("gère plusieurs <a> distincts", () => {
    const html = `<a href="/x">A</a><a href="/y">B</a>`;
    const { entries } = annotateHtmlForInlineEdit(html);
    expect(entries).toEqual([
      { id: "1", kind: "link" },
      { id: "2", kind: "link" },
    ]);
  });

  it("HTML vide → rien à annoter", () => {
    const { annotated, entries } = annotateHtmlForInlineEdit("");
    expect(annotated).toBe("");
    expect(entries).toEqual([]);
  });
});

describe("stripEditAttrs — nettoyage avant sauvegarde", () => {
  it("retire data-bj-edit-id (double quotes)", () => {
    expect(stripEditAttrs(`<p data-bj-edit-id="42">Hello</p>`)).toBe(`<p>Hello</p>`);
  });

  it("retire data-bj-edit-id (single quotes)", () => {
    expect(stripEditAttrs(`<img src="/a.webp" data-bj-edit-id='7'>`)).toBe(`<img src="/a.webp">`);
  });

  it("laisse intacts les autres attributs data-*", () => {
    expect(stripEditAttrs(`<div data-foo="1" data-bj-edit-id="2">X</div>`))
      .toBe(`<div data-foo="1">X</div>`);
  });

  it("idempotent : HTML propre inchangé", () => {
    const html = `<p>Ok</p>`;
    expect(stripEditAttrs(html)).toBe(html);
  });
});

describe("applyImageMutation — récriture du src", () => {
  it("remplace src existant sur l'img ciblée", () => {
    const html = `<img src="/old.webp" alt="A" data-bj-edit-id="1">`;
    const out = applyImageMutation(html, "1", "/new.webp");
    expect(out).toBe(`<img src="/new.webp" alt="A" data-bj-edit-id="1">`);
  });

  it("ajoute src si absent (cas rare d'un img sans src)", () => {
    const html = `<img alt="A" data-bj-edit-id="1">`;
    const out = applyImageMutation(html, "1", "/new.webp");
    expect(out).toContain(`src="/new.webp"`);
  });

  it("ne touche pas les autres <img>", () => {
    const html = `<img src="/a.webp" data-bj-edit-id="1"><img src="/b.webp" data-bj-edit-id="2">`;
    const out = applyImageMutation(html, "1", "/x.webp");
    expect(out).toContain(`src="/x.webp"`);
    expect(out).toContain(`src="/b.webp"`);
  });

  it("échappe les guillemets et esperluettes dans l'URL", () => {
    const html = `<img src="" data-bj-edit-id="1">`;
    const out = applyImageMutation(html, "1", "https://x.com/?a=1&b=2");
    expect(out).toContain(`src="https://x.com/?a=1&amp;b=2"`);
  });

  it("id inexistant → HTML inchangé", () => {
    const html = `<img src="/a.webp" data-bj-edit-id="1">`;
    expect(applyImageMutation(html, "999", "/nope.webp")).toBe(html);
  });
});

describe("applyLinkMutation — récriture du href", () => {
  it("remplace href existant sur le <a> ciblé", () => {
    const html = `<a href="/old" data-bj-edit-id="1">X</a>`;
    expect(applyLinkMutation(html, "1", "/new"))
      .toBe(`<a href="/new" data-bj-edit-id="1">X</a>`);
  });

  it("ajoute href si absent", () => {
    const html = `<a data-bj-edit-id="1">X</a>`;
    expect(applyLinkMutation(html, "1", "/x")).toContain(`href="/x"`);
  });

  it("id inexistant → HTML inchangé", () => {
    const html = `<a href="/x" data-bj-edit-id="1">X</a>`;
    expect(applyLinkMutation(html, "999", "/y")).toBe(html);
  });
});

describe("applyTextMutation — récriture de l'innerHTML avec HTML riche", () => {
  it("remplace le contenu texte simple", () => {
    const html = `<p data-bj-edit-id="1">Ancien</p>`;
    expect(applyTextMutation(html, "1", "Nouveau"))
      .toBe(`<p data-bj-edit-id="1">Nouveau</p>`);
  });

  it("préserve les balises de formatage (b/strong/i/em/u/a/br/span)", () => {
    const html = `<p data-bj-edit-id="1">X</p>`;
    const rich = `Bonjour <strong>Marie</strong>, voici <a href="/produits">le catalogue</a>.`;
    expect(applyTextMutation(html, "1", rich))
      .toBe(`<p data-bj-edit-id="1">${rich}</p>`);
  });

  it("retire les balises hors allowlist (script, iframe, div, etc.)", () => {
    const html = `<p data-bj-edit-id="1">Ok</p>`;
    const out = applyTextMutation(html, "1", `<script>alert(1)</script>Hello<iframe></iframe><div>x</div>`);
    expect(out).not.toContain(`<script`);
    expect(out).not.toContain(`<iframe`);
    expect(out).not.toContain(`<div>`);
    expect(out).toContain(`Hello`);
    expect(out).toContain(`x`);
  });

  it("retire les event handlers on* et les URLs javascript:", () => {
    const html = `<p data-bj-edit-id="1">X</p>`;
    const out = applyTextMutation(html, "1", `<a href="javascript:alert(1)" onclick="steal()">Bad</a>`);
    expect(out).not.toContain(`javascript:`);
    expect(out).not.toContain(`onclick`);
    expect(out).toContain(`Bad`);
  });

  it("préserve les tokens de merge {firstName}", () => {
    const html = `<p data-bj-edit-id="1">X</p>`;
    expect(applyTextMutation(html, "1", `Bonjour {firstName}`))
      .toBe(`<p data-bj-edit-id="1">Bonjour {firstName}</p>`);
  });

  it("préserve les autres attributs de la balise ciblée", () => {
    const html = `<h1 style="color:red" data-bj-edit-id="1">Titre</h1>`;
    expect(applyTextMutation(html, "1", "Nouveau"))
      .toBe(`<h1 style="color:red" data-bj-edit-id="1">Nouveau</h1>`);
  });

  it("id inexistant → HTML inchangé", () => {
    const html = `<p data-bj-edit-id="1">X</p>`;
    expect(applyTextMutation(html, "999", "Y")).toBe(html);
  });
});

describe("wrapElementInLink — envelopper un élément dans un <a>", () => {
  it("enveloppe un <img> dans un <a>", () => {
    const html = `<img src="/x.webp" data-bj-edit-id="1">`;
    expect(wrapElementInLink(html, "1", "/produits"))
      .toBe(`<a href="/produits"><img src="/x.webp" data-bj-edit-id="1"></a>`);
  });

  it("enveloppe un <p> texte dans un <a>", () => {
    const html = `<p data-bj-edit-id="1">Bonjour</p>`;
    expect(wrapElementInLink(html, "1", "https://x.com"))
      .toBe(`<a href="https://x.com"><p data-bj-edit-id="1">Bonjour</p></a>`);
  });

  it("escape les caractères spéciaux dans l'URL", () => {
    const html = `<p data-bj-edit-id="1">X</p>`;
    expect(wrapElementInLink(html, "1", `/x?a=1&b="2"`))
      .toContain(`href="/x?a=1&amp;b=&quot;2&quot;"`);
  });

  it("id inexistant → HTML inchangé", () => {
    const html = `<p data-bj-edit-id="1">X</p>`;
    expect(wrapElementInLink(html, "999", "/y")).toBe(html);
  });
});

describe("readTextContent / readAttrValue — lecture pour pré-remplissage", () => {
  it("readTextContent renvoie le texte actuel", () => {
    const html = `<p data-bj-edit-id="1">Bonjour</p>`;
    expect(readTextContent(html, "1")).toBe("Bonjour");
  });

  it("readTextContent retourne l'innerHTML (balises préservées pour rich edit)", () => {
    const html = `<p data-bj-edit-id="1">Marie &amp; <strong>Pierre</strong></p>`;
    expect(readTextContent(html, "1")).toBe(`Marie &amp; <strong>Pierre</strong>`);
  });

  it("readAttrValue renvoie src d'un img", () => {
    const html = `<img src="/a.webp" data-bj-edit-id="1">`;
    expect(readAttrValue(html, "1", "src")).toBe("/a.webp");
  });

  it("readAttrValue renvoie href d'un lien", () => {
    const html = `<a href="/x" data-bj-edit-id="1">A</a>`;
    expect(readAttrValue(html, "1", "href")).toBe("/x");
  });

  it("id inexistant → chaîne vide", () => {
    expect(readTextContent(`<p data-bj-edit-id="1">X</p>`, "999")).toBe("");
    expect(readAttrValue(`<img src="/a" data-bj-edit-id="1">`, "999", "src")).toBe("");
  });
});
