/**
 * Tokenise un texte WhatsApp markdown en segments typés, prêts à rendre en
 * React (pas de HTML string, pas de risque XSS).
 *
 * WhatsApp reconnaît un sous-ensemble simple de markdown :
 *   *gras*          → { kind: "bold" }
 *   _italique_      → { kind: "italic" }
 *   ~barré~         → { kind: "strike" }
 *   ```mono```      → { kind: "code" }  (avec sauts de ligne autorisés)
 *   \n              → { kind: "linebreak" }
 *   autre           → { kind: "text" }
 *
 * Règle clef : le délimiteur doit encadrer un contenu qui NE COMMENCE PAS et
 * NE FINIT PAS par un espace (`* mot *` ne marche pas dans WhatsApp). Nos
 * regex encodent cette contrainte pour éviter les faux positifs (« 2 * 3 »).
 *
 * Aperçu ≠ rendu exact WhatsApp : les cas tordus (accolades mal fermées,
 * emojis à côté d'un délimiteur…) peuvent différer à la marge. Assez fidèle
 * pour aider la cliente à vérifier son texte avant envoi.
 */

export type WhatsAppMarkdownToken =
  | { kind: "text"; content: string }
  | { kind: "bold"; content: string }
  | { kind: "italic"; content: string }
  | { kind: "strike"; content: string }
  | { kind: "code"; content: string }
  | { kind: "linebreak" };

// Regex ordonnée : bloc code d'abord (peut contenir des \n), puis inline.
// Chaque groupe correspond à un `kind` distinct pour dispatcher au retour.
const INLINE_TOKEN_REGEX =
  /```([\s\S]+?)```|\*([^*\s](?:[^*\n]*[^*\s])?)\*|_([^_\s](?:[^_\n]*[^_\s])?)_|~([^~\s](?:[^~\n]*[^~\s])?)~/g;

function tokenizeSegment(segment: string): WhatsAppMarkdownToken[] {
  if (!segment) return [];
  const tokens: WhatsAppMarkdownToken[] = [];
  let lastIndex = 0;
  for (const match of segment.matchAll(INLINE_TOKEN_REGEX)) {
    const start = match.index ?? 0;
    if (start > lastIndex) {
      tokens.push({ kind: "text", content: segment.slice(lastIndex, start) });
    }
    if (match[1] !== undefined) tokens.push({ kind: "code", content: match[1] });
    else if (match[2] !== undefined) tokens.push({ kind: "bold", content: match[2] });
    else if (match[3] !== undefined) tokens.push({ kind: "italic", content: match[3] });
    else if (match[4] !== undefined) tokens.push({ kind: "strike", content: match[4] });
    lastIndex = start + match[0].length;
  }
  if (lastIndex < segment.length) {
    tokens.push({ kind: "text", content: segment.slice(lastIndex) });
  }
  return tokens;
}

export function tokenizeWhatsAppMarkdown(input: string): WhatsAppMarkdownToken[] {
  if (!input) return [];
  // On tokenise l'entrée COMPLÈTE d'un coup — les blocs code ```…``` peuvent
  // contenir des \n et il ne faut pas les casser en pré-splittant. Ensuite,
  // les tokens `text` qui contiennent des \n sont éclatés en text + linebreak.
  const raw = tokenizeSegment(input);
  const tokens: WhatsAppMarkdownToken[] = [];
  for (const token of raw) {
    if (token.kind !== "text" || !token.content.includes("\n")) {
      tokens.push(token);
      continue;
    }
    const lines = token.content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].length > 0) tokens.push({ kind: "text", content: lines[i] });
      if (i < lines.length - 1) tokens.push({ kind: "linebreak" });
    }
  }
  return tokens;
}
