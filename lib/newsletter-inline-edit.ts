/**
 * Édition inline dans l'aperçu iframe du mail newsletter.
 *
 * L'admin peut clic-droit sur une balise de l'aperçu pour la modifier
 * directement (image → upload, lien → picker, texte → mini modale) sans
 * passer par le code HTML source. Ce module fournit les primitives :
 *
 *   1. `annotateHtmlForInlineEdit(html)` : ajoute `data-bj-edit-id="N"`
 *      sur toutes les balises éditables. Le HTML annoté est ce qui sert
 *      à rendre l'aperçu.
 *   2. `stripEditAttrs(html)` : retire tous les `data-bj-edit-id` — utilisé
 *      avant sauvegarde en BDD (le HTML propre reste consommable par les
 *      clients mail sans pollution d'attributs internes).
 *   3. `applyImageMutation` / `applyLinkMutation` / `applyTextMutation` :
 *      modifient UNE balise ciblée par son id.
 *
 * Types de balises éditables :
 *   - `<img>` → kind="image"
 *   - `<a>` → kind="link"
 *   - `<p|span|h1..h6|td|div|li|strong|em|b|i|small>` → kind="text",
 *     mais UNIQUEMENT si l'inner content est du texte pur (aucune sous-balise)
 *     et NE contient AUCUN token de merge (`{firstName}`, `{{img.xxx}}`,
 *     `{{#each}}`…). Sinon l'édition inline est refusée pour ne pas casser
 *     la personnalisation.
 */

export type EditableKind = "image" | "link" | "text";

export interface EditableEntry {
  id: string;
  kind: EditableKind;
}

/**
 * Tags dont l'innerText peut être édité inline s'il est "safe" (pas d'autre
 * balise dedans, pas de token de merge). Volontairement conservateur : on
 * refuse `<a>` (qui est déjà kind="link"), et les tags de layout (`<table>`,
 * `<tr>`, `<td>` est OK pour texte simple type "Total : 84 €").
 */
const EDITABLE_TEXT_TAGS = new Set([
  "p", "span", "h1", "h2", "h3", "h4", "h5", "h6",
  "td", "div", "li", "strong", "em", "b", "i", "small", "button", "label",
]);

/**
 * Vrai si la chaîne contient au moins un token de merge — `{firstName}`,
 * `{{img.xxx}}`, `{{#each cart}}`, etc. Utilisé pour refuser l'édition
 * inline d'un texte qui contient une variable (ré-écrire "Bonjour Marie"
 * en "Salut Marie" perdrait le `{firstName}` invisible).
 */
function hasMergeToken(s: string): boolean {
  return /\{\{?\s*[a-zA-Z#/]/.test(s);
}

/**
 * Vrai si l'inner content est du texte pur — aucune balise ouvrante ou
 * fermante à l'intérieur. Tolère les entités HTML (`&amp;`, `&nbsp;`).
 */
function isPureText(inner: string): boolean {
  return !/<\/?[a-zA-Z]/.test(inner);
}

/**
 * Ajoute `data-bj-edit-id="N"` sur toutes les balises éditables du HTML.
 * IDs séquentiels 1, 2, 3… dans l'ordre du DOM. Retourne :
 *   - `annotated` : le HTML annoté (utilisé pour rendre l'iframe).
 *   - `entries` : liste { id, kind } dans l'ordre d'apparition.
 *
 * Idempotent : ré-annoter un HTML déjà annoté RE-numérote depuis 1
 * (ancienne annotation retirée par `stripEditAttrs` implicite avant).
 * Ça évite les IDs qui dérivent au fil des éditions.
 */
export function annotateHtmlForInlineEdit(html: string): {
  annotated: string;
  entries: EditableEntry[];
} {
  if (!html) return { annotated: html, entries: [] };
  let out = stripEditAttrs(html);
  const entries: EditableEntry[] = [];
  let counter = 0;

  // Détecte les positions des blocs `{{#each …}}…{{/each}}` — TOUT tag
  // trouvé à l'intérieur est refusé à l'annotation. Raison : ces blocs sont
  // développés N fois côté serveur (une par article du panier), un id
  // annoté serait dupliqué N fois → mutation ambiguë. De plus, éditer un
  // template d'item du panier casserait tout le rendu dynamique. La cliente
  // édite ce type de bloc via le code HTML à gauche.
  const loopRanges: Array<[number, number]> = [];
  {
    const loopRe = /\{\{\s*#each\s+[a-zA-Z]+\s*\}\}[\s\S]*?\{\{\s*\/\s*each\s*\}\}/gi;
    let lm: RegExpExecArray | null;
    while ((lm = loopRe.exec(out)) !== null) {
      loopRanges.push([lm.index, lm.index + lm[0].length]);
    }
  }
  const inLoop = (pos: number): boolean =>
    loopRanges.some(([s, e]) => pos >= s && pos < e);

  // ─── Passe 1 : <img> (void tag, peut être dans n'importe quel parent :
  // notamment <a><img></a> pour un logo cliquable). Annoté indépendamment
  // du <a> parent — les 2 auront chacun leur data-bj-edit-id. ───
  {
    const re = /(<img\b)([^>]*?)(\/?>)/gi;
    const parts: string[] = [];
    let lastIdx = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(out)) !== null) {
      parts.push(out.slice(lastIdx, m.index));
      if (inLoop(m.index)) {
        parts.push(m[0]);
      } else {
        counter += 1;
        const id = String(counter);
        entries.push({ id, kind: "image" });
        parts.push(`${m[1]}${m[2]} data-bj-edit-id="${id}"${m[3]}`);
      }
      lastIdx = m.index + m[0].length;
    }
    parts.push(out.slice(lastIdx));
    out = parts.join("");
  }

  // Les insertions de la passe 1 ont décalé les positions — on recalcule
  // les ranges de boucle sur le nouveau `out`.
  loopRanges.length = 0;
  {
    const loopRe = /\{\{\s*#each\s+[a-zA-Z]+\s*\}\}[\s\S]*?\{\{\s*\/\s*each\s*\}\}/gi;
    let lm: RegExpExecArray | null;
    while ((lm = loopRe.exec(out)) !== null) {
      loopRanges.push([lm.index, lm.index + lm[0].length]);
    }
  }

  // ─── Passe 2 : <a>…</a> (containers). On annote seulement l'ouverture,
  // l'inner (qui contient peut-être un <img data-bj-edit-id="…">) est
  // laissé intact. ───
  {
    const re = /(<a\b)([^>]*?)(>)/gi;
    const parts: string[] = [];
    let lastIdx = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(out)) !== null) {
      parts.push(out.slice(lastIdx, m.index));
      if (/\bdata-bj-edit-id\b/.test(m[2]) || inLoop(m.index)) {
        parts.push(m[0]);
      } else {
        counter += 1;
        const id = String(counter);
        entries.push({ id, kind: "link" });
        parts.push(`${m[1]}${m[2]} data-bj-edit-id="${id}"${m[3]}`);
      }
      lastIdx = m.index + m[0].length;
    }
    parts.push(out.slice(lastIdx));
    out = parts.join("");
  }

  // Recalcule les positions de boucle après passe 2.
  loopRanges.length = 0;
  {
    const loopRe = /\{\{\s*#each\s+[a-zA-Z]+\s*\}\}[\s\S]*?\{\{\s*\/\s*each\s*\}\}/gi;
    let lm: RegExpExecArray | null;
    while ((lm = loopRe.exec(out)) !== null) {
      loopRanges.push([lm.index, lm.index + lm[0].length]);
    }
  }

  // ─── Passe 3 : tags texte éditables. On itère sur toutes les balises
  // ouvrantes candidates SANS les consommer (evite qu'un <div> parent avale
  // le <strong> interne). Pour chacune, on cherche son </tag> correspondant
  // et on décide si l'inner est du texte pur sans token. Les insertions
  // d'attribut sont appliquées à l'envers pour ne pas décaler les positions. ───
  const textTagsAlt = Array.from(EDITABLE_TEXT_TAGS).join("|");
  const openTagRe = new RegExp(`<(${textTagsAlt})\\b([^>]*?)>`, "gi");
  const insertions: Array<{ pos: number; text: string; kind: EditableKind; id: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = openTagRe.exec(out)) !== null) {
    const tagName = m[1].toLowerCase();
    const attrs = m[2];
    if (/\bdata-bj-edit-id\b/.test(attrs)) continue;
    if (inLoop(m.index)) continue;
    const openEnd = m.index + m[0].length;
    // Cherche le </tag> correspondant. On matche simplement le premier —
    // les tags text imbriqués de MÊME nom sont rares dans un mail (`<p><p>…`
    // ne se voit pas). Si ça arrive, on annote le mauvais bloc, l'admin
    // édite alors via le code source.
    const closeRe = new RegExp(`<\\/${tagName}\\s*>`, "i");
    const remaining = out.slice(openEnd);
    const closeMatch = closeRe.exec(remaining);
    if (!closeMatch) continue;
    const inner = remaining.slice(0, closeMatch.index);
    // On accepte : texte pur + texte avec tokens `{firstName}`.
    // On REFUSE les tags mixtes (contenant des sous-balises) car l'édition
    // rich text du bloc entier dans la modale rend le HTML désorganisé
    // (2026-09-24 — feedback cliente). Le prompt IA demande maintenant
    // à l'IA de créer un tag texte propre par phrase pour éviter les
    // mélanges (voir `IMG_INSTRUCTIONS` et section GRANULARITÉ TEXTE).
    if (!isPureText(inner)) continue;
    if (inner.trim().length === 0) continue;
    // Refus des blocs `{{#each}}`/`{{/each}}` : templating structurel.
    if (/\{\{\s*[#/]/.test(inner)) continue;
    counter += 1;
    const id = String(counter);
    // Position d'insertion = juste avant le `>` fermant du tag ouvrant.
    insertions.push({
      pos: openEnd - 1,
      text: ` data-bj-edit-id="${id}"`,
      kind: "text",
      id,
    });
    entries.push({ id, kind: "text" });
  }
  // Applique les insertions de la fin vers le début pour préserver les indices.
  insertions.sort((a, b) => b.pos - a.pos);
  for (const ins of insertions) {
    out = out.slice(0, ins.pos) + ins.text + out.slice(ins.pos);
  }

  return { annotated: out, entries };
}

/**
 * Retire tous les attributs `data-bj-edit-id="…"` d'un HTML annoté. À appeler
 * juste avant de sauvegarder en BDD ou de copier le HTML en clair pour un
 * export (le HTML propre reste consommable par les clients mail — les
 * attributs `data-*` sont ignorés à l'affichage, mais autant ne pas polluer).
 */
export function stripEditAttrs(html: string): string {
  if (!html) return html;
  // Match les 2 quotings + gère l'espace précédent.
  return html.replace(/\s+data-bj-edit-id\s*=\s*(["'])[^"']*\1/gi, "");
}

/**
 * Escape la valeur d'un attribut HTML — utilisé pour insérer une URL ou du
 * texte dans un `src=""` / `href=""` sans casser le parsing.
 */
function escapeAttr(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

/**
 * Sanitize l'HTML riche produit par le contentEditable de la modale d'édition
 * texte. Autorise seulement le formatage sémantique (gras, italique, souligné,
 * liens, sauts de ligne) — retire les scripts, event handlers, iframes, etc.
 *
 * Les mails newsletter s'affichent dans des clients mail qui n'exécutent pas
 * de JS ; le vrai risque XSS serait plutôt sur l'aperçu iframe. On sanitize
 * quand même pour ne pas polluer le HTML source.
 */
function sanitizeInlineRichHtml(v: string): string {
  return v
    // Retire <script>...</script> complet.
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    // Retire les balises hors allowlist. Allowlist : b, strong, i, em, u,
    // a, br, span (utile pour styling inline hérité). Retire les fermantes
    // et ouvrantes des balises interdites.
    .replace(/<\/?(?!(?:b|strong|i|em|u|a|br|span)\b)[a-zA-Z][^>]*>/gi, "")
    // Retire les handlers `on*` (onclick, onerror, …).
    .replace(/\s+on[a-z]+\s*=\s*(["'])[\s\S]*?\1/gi, "")
    // Retire javascript: URLs.
    .replace(/(\bhref\s*=\s*["'])javascript:[\s\S]*?(["'])/gi, "$1#$2");
}

/**
 * Récrit l'attribut `src` d'un `<img data-bj-edit-id="id">`. Idempotent :
 * si l'id n'existe pas, retourne le HTML inchangé.
 */
export function applyImageMutation(html: string, id: string, newSrc: string): string {
  if (!html) return html;
  const escId = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escaped = escapeAttr(newSrc);
  // Cherche <img …data-bj-edit-id="id"…>. On capture les attrs avant/après.
  // 2 passes :
  //  - si l'img a déjà un src="…", on le remplace.
  //  - sinon on ajoute src="…" juste avant `>` ou `/>`.
  const re = new RegExp(
    `(<img\\b[^>]*\\bdata-bj-edit-id\\s*=\\s*["']${escId}["'][^>]*?)(\\s*\\/?\\s*>)`,
    "i",
  );
  return html.replace(re, (_match, attrs: string, closer: string) => {
    if (/\bsrc\s*=\s*(["'])[\s\S]*?\1/i.test(attrs)) {
      const rewritten = attrs.replace(
        /\bsrc\s*=\s*(["'])[\s\S]*?\1/i,
        `src="${escaped}"`,
      );
      return `${rewritten}${closer}`;
    }
    return `${attrs} src="${escaped}"${closer}`;
  });
}

/**
 * Enveloppe l'élément ciblé (n'importe quel `<tag data-bj-edit-id="id">…</tag>`
 * ou `<img data-bj-edit-id="id">`) dans un `<a href="…">`. Utilisé par
 * l'action « Configurer le lien » du menu contextuel sur une image ou un
 * texte non-lié. Idempotent : si l'id n'existe pas, HTML inchangé.
 *
 * Attention : n'essaie pas de détecter un `<a>` parent existant — si le tag
 * est déjà dans un lien (`<a><img></a>`), cette fonction crée un `<a>` en
 * plus. L'admin voit alors la duplication dans le code source à gauche.
 */
export function wrapElementInLink(html: string, id: string, newHref: string): string {
  if (!html) return html;
  const escId = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escaped = escapeAttr(newHref);
  // Cas 1 : <img …/?> (void tag) — envelopper toute la balise.
  const imgRe = new RegExp(
    `<img\\b[^>]*\\bdata-bj-edit-id\\s*=\\s*["']${escId}["'][^>]*\\/?>`,
    "i",
  );
  if (imgRe.test(html)) {
    return html.replace(imgRe, (m) => `<a href="${escaped}">${m}</a>`);
  }
  // Cas 2 : <tag …>inner</tag> (container) — envelopper la balise complète.
  const tagRe = new RegExp(
    `<([a-zA-Z][a-zA-Z0-9]*)\\b[^>]*\\bdata-bj-edit-id\\s*=\\s*["']${escId}["'][^>]*>[\\s\\S]*?<\\/\\1\\s*>`,
    "i",
  );
  return html.replace(tagRe, (m) => `<a href="${escaped}">${m}</a>`);
}

/**
 * Récrit l'attribut `href` d'un `<a data-bj-edit-id="id">`. Comportement
 * identique à `applyImageMutation` pour src. Idempotent.
 */
export function applyLinkMutation(html: string, id: string, newHref: string): string {
  if (!html) return html;
  const escId = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escaped = escapeAttr(newHref);
  const re = new RegExp(
    `(<a\\b[^>]*\\bdata-bj-edit-id\\s*=\\s*["']${escId}["'][^>]*?)(>)`,
    "i",
  );
  return html.replace(re, (_match, attrs: string, closer: string) => {
    if (/\bhref\s*=\s*(["'])[\s\S]*?\1/i.test(attrs)) {
      const rewritten = attrs.replace(
        /\bhref\s*=\s*(["'])[\s\S]*?\1/i,
        `href="${escaped}"`,
      );
      return `${rewritten}${closer}`;
    }
    return `${attrs} href="${escaped}"${closer}`;
  });
}

/**
 * Récrit l'innerHTML d'un `<tag data-bj-edit-id="id">…</tag>`. Accepte du
 * HTML riche (b/strong/i/em/u/a/br/span) — sanitize l'input pour retirer
 * script, event handlers et balises hors allowlist. Les tokens `{firstName}`
 * et autres merge vars sont préservés tels quels.
 */
export function applyTextMutation(html: string, id: string, newHtml: string): string {
  if (!html) return html;
  const escId = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const sanitized = sanitizeInlineRichHtml(newHtml);
  const re = new RegExp(
    `(<([a-zA-Z][a-zA-Z0-9]*)\\b[^>]*\\bdata-bj-edit-id\\s*=\\s*["']${escId}["'][^>]*>)([\\s\\S]*?)(<\\/\\2\\s*>)`,
    "i",
  );
  return html.replace(re, (_match, openTag: string, _tag: string, _inner: string, closeTag: string) => {
    return `${openTag}${sanitized}${closeTag}`;
  });
}

/**
 * Renvoie l'innerHTML actuel d'un élément éditable (sert à pré-remplir la
 * modale d'édition de texte). Le HTML retourné peut contenir des balises de
 * formatage (b/i/u/a/…), les tokens de merge (`{firstName}`, `{{img.xxx}}`)
 * et des entités HTML — utilisé tel quel dans un contentEditable. Retourne
 * "" si l'id n'existe pas.
 *
 * Trim leading/trailing whitespace pour éviter que les retours à la ligne
 * cosmétiques du HTML source fassent apparaître le contenu "centré
 * verticalement" dans la modale.
 */
export function readTextContent(html: string, id: string): string {
  if (!html) return "";
  const escId = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `<([a-zA-Z][a-zA-Z0-9]*)\\b[^>]*\\bdata-bj-edit-id\\s*=\\s*["']${escId}["'][^>]*>([\\s\\S]*?)<\\/\\1\\s*>`,
    "i",
  );
  const m = html.match(re);
  if (!m) return "";
  return m[2].trim();
}

/**
 * Renvoie la valeur actuelle de `src` (image) ou `href` (link) pour l'entrée
 * ciblée. Retourne "" si absent.
 */
export function readAttrValue(
  html: string,
  id: string,
  attr: "src" | "href",
): string {
  if (!html) return "";
  const escId = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `<[a-zA-Z]+\\b[^>]*\\bdata-bj-edit-id\\s*=\\s*["']${escId}["'][^>]*>`,
    "i",
  );
  const m = html.match(re);
  if (!m) return "";
  const attrMatch = m[0].match(new RegExp(`\\b${attr}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "i"));
  return attrMatch ? attrMatch[2] : "";
}
