/**
 * Traduction FR des messages d'erreur bruts renvoyés par Ankorstore.
 *
 * Ankorstore renvoie ses `issues[].message` en anglais dans le callback ou
 * dans `/operations/{id}/results`. Ces messages sont ensuite stockés en
 * `AnkorstoreOperation.errorMessage` et affichés tels quels dans le widget
 * flottant marketplaces (bouton « ⓘ » d'une ligne en erreur).
 *
 * Pour que la cliente comprenne ce qu'elle doit corriger sans passer par
 * une aide externe, on convertit chaque motif connu en phrase française
 * actionnable. Un motif inconnu est renvoyé tel quel préfixé de
 * « Erreur Ankorstore : » pour signaler l'origine.
 */

interface Rule {
  match: RegExp;
  translate: (m: RegExpMatchArray) => string;
}

const RULES: Rule[] = [
  // ── Images ─────────────────────────────────────────────
  {
    match: /image height is too small\s*\((\d+)px\).*minimum height expected is (\d+)px/i,
    translate: (m) =>
      `Une image est trop courte en hauteur (${m[1]} px, minimum ${m[2]} px). ` +
      `Remplacez la photo par une version au moins ${m[2]}×${m[2]} px.`,
  },
  {
    match: /image width is too small\s*\((\d+)px\).*minimum width expected is (\d+)px/i,
    translate: (m) =>
      `Une image est trop étroite en largeur (${m[1]} px, minimum ${m[2]} px). ` +
      `Remplacez la photo par une version au moins ${m[2]}×${m[2]} px.`,
  },
  {
    match: /at least 1 image is required to create an active product/i,
    translate: () =>
      `Ankorstore exige au moins une photo par variante. Vérifiez que toutes ` +
      `les couleurs de ce produit ont une photo, puis relancez la publication.`,
  },
  {
    match: /image .* (invalid|corrupt|malformed|could not be (downloaded|processed))/i,
    translate: () =>
      `Ankorstore n'a pas réussi à télécharger ou lire une des photos. ` +
      `Vérifiez que les photos s'affichent bien côté boutique puis réessayez.`,
  },

  // ── Options / variantes ────────────────────────────────
  {
    match: /product variants with SKU:\s*([^\s].*?)\s*have duplicated options/i,
    translate: (m) =>
      `Ce produit contient plusieurs variantes avec exactement la même couleur ` +
      `et la même taille (SKU concernés : ${m[1]}). Ankorstore refuse ce cas. ` +
      `Dédoublonnez la fiche : renommez l'une des couleurs ou supprimez la variante en trop.`,
  },
  {
    match: /variant .* must have (at least one|1) option/i,
    translate: () =>
      `Une variante n'a pas de couleur ni de taille renseignée. ` +
      `Complétez la fiche produit avant de republier.`,
  },

  // ── Prix ───────────────────────────────────────────────
  {
    match: /retail price.*must be greater than wholesale/i,
    translate: () =>
      `Le prix de vente public doit être strictement supérieur au prix de gros. ` +
      `Ajustez la marge Ankorstore dans Paramètres > Marketplaces.`,
  },
  {
    match: /wholesale price.*must be greater than 0/i,
    translate: () =>
      `Le prix de gros calculé pour Ankorstore est nul. ` +
      `Vérifiez le prix de base du produit et la marge Ankorstore.`,
  },

  // ── SKU / champs texte ────────────────────────────────
  {
    match: /sku (maximum|too long|length)/i,
    translate: () =>
      `Le SKU dépasse la longueur maximale acceptée par Ankorstore (48 caractères). ` +
      `Raccourcissez la référence produit ou le nom de la couleur.`,
  },
  {
    match: /external.*id.*(already|duplicate|taken)/i,
    translate: () =>
      `Un produit avec la même référence externe existe déjà sur Ankorstore. ` +
      `Déliez le produit existant depuis la modale de liaison marketplace, ` +
      `puis republiez.`,
  },

  // ── Divers ─────────────────────────────────────────────
  {
    match: /country.*(invalid|unknown|not supported)/i,
    translate: () =>
      `Le pays de fabrication n'est pas reconnu par Ankorstore. ` +
      `Corrigez-le dans la fiche produit.`,
  },
  {
    match: /category.*(invalid|unknown|not supported|required)/i,
    translate: () =>
      `La catégorie du produit n'est pas acceptée par Ankorstore. ` +
      `Vérifiez le mapping catégorie dans Paramètres > Marketplaces > Ankorstore.`,
  },
  {
    match: /hs.?code.*(invalid|unknown|not supported|required)/i,
    translate: () =>
      `Le code SH (douanier) est manquant ou invalide. Renseignez-le dans la fiche produit.`,
  },
];

/**
 * Traduit un message brut Ankorstore en français.
 * Les messages inconnus sont préfixés « Erreur Ankorstore : ».
 */
export function translateAnkorstoreErrorMessage(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;
  for (const rule of RULES) {
    const m = trimmed.match(rule.match);
    if (m) return rule.translate(m);
  }
  // Message inconnu : on le laisse passer préfixé — la cliente sait
  // au moins d'où ça vient et peut nous le remonter pour ajouter la
  // règle correspondante.
  return `Erreur Ankorstore : ${trimmed}`;
}

/**
 * Traduit une chaîne composée de plusieurs messages Ankorstore concaténés
 * (format de `fetchDetailedFailureMessage`) :
 *
 *   "validation_error: msg1 ; msg2 — validation_error: msg3"
 *
 * On sépare sur les motifs de jointure `\s+;\s+`, `\s+—\s+`, `\s+-\s+`,
 * et sur le préfixe `validation_error:` / `internal_error:` répété. Chaque
 * morceau est traduit indépendamment, puis les traductions sont
 * dédoublonnées (Ankorstore répète souvent la même erreur pour chaque
 * variante).
 */
export function translateAnkorstoreErrorBundle(raw: string): string {
  if (!raw) return raw;

  const withoutPrefix = raw.replace(/(?:validation_error|internal_error):\s*/gi, "\n");
  const parts = withoutPrefix
    .split(/\n|\s+;\s+|\s+—\s+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  if (parts.length === 0) {
    return translateAnkorstoreErrorMessage(raw);
  }

  const translated = parts.map((p) => translateAnkorstoreErrorMessage(p));
  const unique = Array.from(new Set(translated));
  return unique.join(" · ");
}
