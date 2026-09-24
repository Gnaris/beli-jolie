/**
 * Construction du prompt à donner à une IA (ChatGPT, Claude, Gemini, Mistral…)
 * pour générer un modèle de mail HTML compatible tous clients mail.
 *
 * Le prompt réunit :
 *   1. le contexte (rôle de l'IA, format attendu),
 *   2. les contraintes techniques dures (tables, styles inline, largeur max…),
 *   3. la liste des variables obligatoires (mentions légales RGPD/LCEN),
 *   4. la liste des variables facultatives (personnalisation client + boutique),
 *   5. la description libre du modèle voulu par la cliente.
 *
 * Module pur — sans dépendance serveur, safe pour import client.
 */

import { MAIL_VARIABLES, type MailVariable } from "@/lib/mail-merge-variables";
import type { ScenarioKey } from "@/lib/mail-scenario-defaults";

const HEADER = `Tu es un expert en emails HTML transactionnels. Génère-moi un modèle de mail HTML **compatible tous les clients mail** (Gmail, Outlook, Apple Mail, Yahoo).`;

const TECH_CONSTRAINTS = `CONTRAINTES TECHNIQUES OBLIGATOIRES :
- Utilise \`<table>\` pour toute la mise en page (pas de flexbox ni grid — Outlook ne les comprend pas).
- **Styles inline uniquement** (pas de <style> ni classes CSS externes — Gmail les supprime souvent).
- Largeur maximale du corps du mail : 600 px.
- Toutes les images : \`display:block; max-width:100%; height:auto;\` et un attribut \`alt=""\` non vide.
- Pas de JavaScript, pas d'iframe, pas de web fonts distantes obligatoires (utilise Arial / Helvetica / Georgia en fallback).
- Recommandé : \`<meta name="viewport" content="width=device-width, initial-scale=1">\` dans le \`<head>\` pour un bon rendu mobile.
- Ta réponse doit être un fichier HTML complet et autonome, commençant par \`<!doctype html>\`, prêt à être copié-collé tel quel.`;

const IMG_INSTRUCTIONS = `IMAGES :
**OBLIGATOIRE — chaque image doit être un token \`{{img.<nom>}}\`** (double accolades, préfixe \`img.\`, nom court en minuscules-tirets). Exemple : \`<img src="{{img.hero}}">\`, \`<img src="{{img.logo}}">\`, \`<img src="{{img.produit-1}}">\`. **Aucune URL en dur**, aucun \`https://\`, aucun \`data:\`, aucun \`via.placeholder.com\` — l'admin fera clic droit sur chaque image dans l'aperçu pour uploader le fichier réel, et le token sera automatiquement remplacé par l'URL du fichier uploadé.

Règles pour les noms d'images :
- Un mot court en minuscules (lettres, chiffres et tirets uniquement, pas d'accents).
- Nom **descriptif** de ce que l'image représente ou de sa position : \`hero\`, \`logo\`, \`banniere\`, \`produit-1\`, \`produit-2\`, \`signature\`, \`icone-livraison\`… (pas \`img1\`, \`photo\`, \`x\`).
- Un nom = une image unique dans le mail. Si tu veux 3 photos de produits, mets \`produit-1\`, \`produit-2\`, \`produit-3\` (pas 3 fois \`produit\`).

Règles pour l'attribut \`alt\` :
- **Toujours** renseigné, jamais vide.
- Décris précisément ce que doit montrer l'image (ex : \`alt="Collier doré porté sur un col blanc"\`, pas \`alt="image"\`). L'admin lit ces alt pour savoir quelle photo uploader pour chaque token.

**Dimensions à préciser** (obligatoire pour Outlook — sans \`width\` HTML explicite, il rend l'image en pleine résolution native, la mise en page casse) :
- Ajoute toujours un attribut HTML \`width="..."\` (en pixels, sans unité) — c'est la largeur d'affichage voulue.
- Ajoute \`height="..."\` UNIQUEMENT si tu veux forcer un ratio précis (bannière plate 600×200, avatar carré 80×80…). Sinon laisse tomber \`height\` et le CSS \`height:auto\` fera le boulot.
- Combine avec \`style="display:block;max-width:100%;height:auto;"\` pour le responsive mobile.

**Largeurs recommandées** (le corps du mail fait 600 px de large) :
- Image pleine largeur (hero, bannière) : \`width="600"\`
- Image demi-largeur (2 colonnes) : \`width="290"\` (marge de 10 px entre les 2)
- Image tiers (3 colonnes, vitrine produits) : \`width="180"\`
- Logo en-tête : \`width="150"\` à \`width="200"\` selon la charte
- Icônes / pictos : \`width="40"\` à \`width="60"\`
- Signature / photo de profil : \`width="80"\` à \`width="120"\`

**Hauteurs conseillées** (à préciser via \`height=""\` seulement si ratio imposé, sinon laisser \`height:auto\`) :
- Hero / bannière : 200 à 400 px de haut (pas plus, sinon le destinataire ne voit pas ton CTA sans scroller)
- Vignettes produits carrées : hauteur = largeur (ex : 180×180)
- Séparateurs / dividers : 1 à 4 px

La cliente uploadera des images en haute résolution (retina) — pas besoin de préciser \`width="1200"\` pour du retina, l'éditeur redimensionne. Seule la largeur d'AFFICHAGE compte.

Exemples corrects :

\`\`\`html
<!-- Hero pleine largeur -->
<img src="{{img.hero}}" alt="Vitrine automnale : bijoux dorés sur fond beige" width="600" style="display:block;max-width:100%;height:auto;">

<!-- Bannière avec hauteur fixe -->
<img src="{{img.banniere-promo}}" alt="Bandeau promo -20% jusqu'à dimanche" width="600" height="240" style="display:block;max-width:100%;">

<!-- Logo centré en en-tête -->
<img src="{{img.logo}}" alt="Logo Beli & Jolie" width="160" style="display:block;height:auto;">

<!-- Vignette produit en 3 colonnes -->
<img src="{{img.produit-1}}" alt="Bracelet fin doré chaîne torsadée" width="180" height="180" style="display:block;max-width:100%;">
\`\`\``;

function formatVariable(v: MailVariable): string {
  const hint = v.hint ? ` — ${v.hint}` : "";
  return `- \`{${v.token}}\` : ${v.label}${hint} (ex. « ${v.previewValue} »)`;
}

function buildMandatorySection(): string {
  const required = MAIL_VARIABLES.filter((v) => v.requiredMarketing);
  const lines = required.map(formatVariable).join("\n");
  return `VARIABLES OBLIGATOIRES (mentions légales RGPD/LCEN — le mail ne peut PAS être envoyé sans elles) :
${lines}

Ces 4 variables DOIVENT figurer dans le mail (typiquement dans un pied de page en petits caractères). Exemple de pied de page :
\`\`\`html
<p style="font-size:11px;color:#64748b;line-height:1.6;">
  {shopName} · {shopAddress}<br>
  <a href="{unsubscribeLink}" style="color:#64748b;">Se désinscrire</a> · <a href="{privacyLink}" style="color:#64748b;">Politique de confidentialité</a>
</p>
\`\`\``;
}

function buildOptionalSection(): string {
  const optional = MAIL_VARIABLES.filter(
    (v) => !v.requiredMarketing && !v.scenarios, // exclut aussi les dynamiques scoped scénario
  );
  const byGroup: Record<string, MailVariable[]> = {};
  for (const v of optional) {
    (byGroup[v.group] ??= []).push(v);
  }
  const groupLabel: Record<string, string> = {
    client: "Infos du client destinataire",
    boutique: "Infos de la boutique expéditrice",
    dynamique: "Données dynamiques",
    legal: "Mentions légales",
  };
  const parts: string[] = [`VARIABLES FACULTATIVES (à utiliser librement pour personnaliser le mail) :`];
  for (const group of Object.keys(byGroup)) {
    parts.push(`\n**${groupLabel[group] ?? group}** :`);
    parts.push(byGroup[group].map(formatVariable).join("\n"));
  }
  return parts.join("\n");
}

const GRANULARITY_INSTRUCTIONS = `GRANULARITÉ DU TEXTE (édition inline) :
**Chaque bout de texte doit vivre dans SON PROPRE tag simple** (pas de texte "libre" mélangé avec des balises sœurs dans le même parent). L'éditeur permet à l'admin de faire clic droit sur un texte pour l'éditer inline — MAIS il ne peut éditer que les tags dont le contenu est purement du texte (avec ou sans variables \`{token}\`). Un tag qui contient à la fois du texte ET des sous-balises N'EST PAS éditable inline.

**RÈGLE — pour CHAQUE ligne de texte lisible, utilise un tag texte propre** (\`<p>\`, \`<span>\`, \`<h1>\`, \`<td>\`, \`<div>\`, etc.) contenant UNIQUEMENT ce texte, sans sous-balise à l'intérieur.

**INTERDIT** :
\`\`\`html
<td>Bonjour {firstName}<br><a href="">CTA</a></td>   <!-- texte + <br> + <a> mélangés -->
<p>Voici <strong>Marie</strong>, votre panier</p>      <!-- texte + <strong> mélangés -->
<td>{shopName} · {shopAddress}<br><a href="{unsubscribeLink}">Se désinscrire</a></td>
\`\`\`

**CORRECT — sépare en tags frères / imbrique proprement** :
\`\`\`html
<!-- Message avec CTA : chaque bloc dans un tag propre -->
<td>
  <p style="margin:0 0 12px 0;">Bonjour {firstName}</p>
  <p style="margin:0 0 16px 0;">Voici les nouveautés du jour.</p>
  <a href="" style="display:inline-block;padding:12px 24px;background:#111;color:#fff;">Voir la boutique</a>
</td>

<!-- Footer avec liens légaux : chaque partie dans un tag propre -->
<td style="padding:20px 24px;text-align:center;font-size:11px;color:#64748b;">
  <p style="margin:0 0 6px 0;">{shopName} · {shopAddress}</p>
  <p style="margin:0;">
    <a href="{unsubscribeLink}" style="color:#64748b;">Se désinscrire</a>
    ·
    <a href="{privacyLink}" style="color:#64748b;">Politique de confidentialité</a>
  </p>
</td>

<!-- Mise en emphase : le mot en gras est un enfant, PAS mélangé avec le reste -->
<p style="margin:0;">Une nouvelle collection <strong>vient d'arriver</strong> — profitez-en.</p>
\`\`\`
Le dernier exemple reste éditable : l'admin voit un tag \`<p>\` NON annoté (car mixte) MAIS le \`<strong>Vient d'arriver</strong>\` interne EST annoté (car texte pur) — clic droit dessus édite juste ce mot. Utilise \`<strong>\` / \`<em>\` uniquement pour la MISE EN EMPHASE, pas pour découper des phrases entières.`;

const LINKS_INSTRUCTIONS = `LIENS (CTAs, boutons, images cliquables) :
Ne mets **JAMAIS** d'URLs en dur pour les liens du corps du mail (\`href="https://…"\`, \`href="/panier"\`, etc.). Chaque balise \`<a>\` DOIT avoir un attribut \`href=""\` (VIDE — deux guillemets qui se suivent). L'admin configure ensuite chaque lien via un picker visuel (arbre : Accueil / Produits / Catégories / Collections / Qui sommes-nous / Nous contacter) — la valeur vide est récrite automatiquement en URL absolue au moment de la configuration.

**IMPORTANT — TOUTE balise \`<a>\` doit avoir \`href=""\` :** ne jamais générer une \`<a>\` sans attribut \`href\` du tout. Ça rend le lien invisible au picker de configuration.

**Exception — mentions légales dans le footer :** utilise directement les tokens \`{unsubscribeLink}\` et \`{privacyLink}\` (merge vars) dans les \`href\`, PAS \`href=""\`. Ces liens sont dynamiques par destinataire et ne passent pas par le picker.

Exemple correct :
\`\`\`html
<a href="" style="display:inline-block;background:#0f172a;color:#fff;padding:14px 32px;border-radius:10px;font-weight:600;text-decoration:none;">
  Reprendre mon panier
</a>
…
<a href="{unsubscribeLink}" style="color:#64748b;">Se désinscrire</a>
<a href="{privacyLink}" style="color:#64748b;">Politique de confidentialité</a>
\`\`\``;

const FOOTER_INSTRUCTIONS = `RÈGLES DE LIVRAISON :
- Réponds UNIQUEMENT avec le HTML final, sans commentaire, sans explication avant/après.
- **Encapsule TOUT le HTML dans UN SEUL et UNIQUE bloc de code Markdown** \`\`\`html … \`\`\`. Aucun texte en dehors du bloc. Ne DÉCOUPE JAMAIS ta réponse en plusieurs blocs \`\`\`html … \`\`\` : un seul bloc contenant l'intégralité du HTML, du \`<!doctype html>\` jusqu'au \`</html>\` final. L'admin utilisera le bouton « Copier » du bloc pour récupérer le code sans les backticks.
- Vérifie avant de répondre :
  - les 4 tokens obligatoires \`{shopName}\`, \`{shopAddress}\`, \`{unsubscribeLink}\`, \`{privacyLink}\` sont présents ;
  - toutes les images utilisent la syntaxe \`{{img.nom}}\` (aucune URL en dur) ;
  - chaque \`<img>\` a un \`alt\` descriptif non vide ;
  - la mise en page est en \`<table>\`, tous les styles sont inline, largeur max 600 px.`;

/* ─────────────────────────────────────────────
   Section spécifique au scénario (panier / inactivité / restock)
   ───────────────────────────────────────────── */

/**
 * Bloc ajouté au prompt quand le modèle est lié à un scénario automatique.
 * Explique le déclencheur, les tokens dynamiques disponibles, et donne un
 * exemple d'itération `{{#each …}}` prêt à réutiliser.
 */
function buildScenarioSection(scenario: ScenarioKey | null): string | null {
  if (!scenario) return null;

  if (scenario === "ABANDONED_CART") {
    return `CONTEXTE MAIL — PANIER ABANDONNÉ :
Ce mail est envoyé automatiquement quelques heures après qu'un client B2B a rempli son panier sans passer commande. Objectif : lui rappeler ce qu'il a oublié et l'inciter à finaliser.

**⚠️ OBLIGATOIRE — SANS CES TOKENS LA SAUVEGARDE EST REFUSÉE :**
- \`{{#each cart}}…{{/each}}\` : la boucle qui affiche chaque article.
- \`{name}\` : nom du produit (à l'intérieur de la boucle).
- \`{image}\` : image du produit (à l'intérieur de la boucle, dans un \`<img src="{image}">\`).
- \`{qty}\` : quantité (à l'intérieur de la boucle).
- \`{total}\` : prix ligne formaté (à l'intérieur de la boucle).

Sans ces tokens, le client recevrait un mail « panier abandonné » VIDE — aucun sens métier. Le back-office bloque la sauvegarde tant que ces 5 éléments ne sont pas présents dans le HTML.

Tokens dynamiques complémentaires (fortement recommandés) :
- \`{cartTotal}\` : total du panier formaté (ex. « 84,50 € »).
- \`{cartCount}\` : nombre TOTAL d'articles dans le panier (ex. « 12 »).
- \`{color}\` : nom de la couleur (peut être vide, à l'intérieur de la boucle).
- \`{cartMoreCount}\` : nombre d'articles **non affichés** dans la boucle si le panier dépasse 8 (ex. « 4 »). Vaut « 0 » sinon.
- \`{cartMoreText}\` : phrase prête à coller quand des articles ne rentrent pas (ex. « … et 4 autres articles »). Vaut chaîne vide sinon.

**Cap de 8 articles** : le renderer tronque automatiquement à 8 articles maximum côté serveur. Au-dessus, il expose \`{cartMoreText}\` (« … et N autres articles »). Ajoute TOUJOURS une ligne sobre juste sous la boucle pour afficher ce token — sinon un panier de 15 articles ne montrera que les 8 premiers sans indication.

Exemple d'usage correct :
\`\`\`html
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border-radius:10px;">
  {{#each cart}}
  <tr>
    <td width="60" style="padding:8px;vertical-align:top;">
      <img src="{image}" alt="{name}" width="52" height="52" style="width:52px;height:52px;display:block;object-fit:cover;border-radius:6px;">
    </td>
    <td style="padding:8px;vertical-align:middle;font-size:13px;color:#0f172a;">
      <div style="font-weight:600;">{name}</div>
      <div style="font-size:11px;color:#64748b;">{color} · × {qty}</div>
    </td>
    <td align="right" style="padding:8px;font-weight:700;font-size:13px;color:#0f172a;white-space:nowrap;">{total}</td>
  </tr>
  {{/each}}
</table>
<p style="text-align:center;font-size:12px;color:#94a3b8;font-style:italic;">{cartMoreText}</p>
<p style="text-align:right;font-weight:700;">Total ({cartCount} articles) : {cartTotal}</p>
\`\`\``;
  }

  if (scenario === "INACTIVE_CLIENT") {
    return `CONTEXTE MAIL — RELANCE INACTIVITÉ :
Ce mail est envoyé automatiquement à un client B2B qui n'a pas visité la boutique depuis N jours. Objectif : le faire revenir, lui montrer qu'il nous a manqué.

**⚠️ OBLIGATOIRE — SANS CE TOKEN LA SAUVEGARDE EST REFUSÉE :**
- \`{days}\` : nombre de jours d'inactivité (ex. « 45 »).

Utilise \`{days}\` dans une phrase (ex. « Ça fait {days} jours qu'on ne vous a pas vu ! »). Pas de boucle nécessaire pour ce scénario.`;
  }

  if (scenario === "RESTOCK") {
    return `CONTEXTE MAIL — RETOUR EN STOCK :
Ce mail est envoyé quand un produit favori d'un client revient en stock. Objectif : l'avertir + lui proposer d'autres favoris qui sont aussi disponibles.

**⚠️ OBLIGATOIRE — SANS CES TOKENS LA SAUVEGARDE EST REFUSÉE :**
- \`{{#each favorites}}…{{/each}}\` : la boucle qui affiche chaque favori.
- \`{name}\` : nom du produit (à l'intérieur de la boucle).
- \`{image}\` : image du produit (à l'intérieur de la boucle, dans un \`<img src="{image}">\`).
- \`{price}\` : prix unitaire formaté (à l'intérieur de la boucle).

Tokens complémentaires (recommandés) :
- \`{color}\` : nom de la couleur (à l'intérieur de la boucle, peut être vide).
- \`{favoritesCount}\` : nombre TOTAL de favoris disponibles.
- \`{favoritesMoreCount}\` : nombre de favoris non affichés dans la boucle si > 8. Vaut « 0 » sinon.
- \`{favoritesMoreText}\` : phrase prête à coller (ex. « … et 3 autres favoris »). Vaut chaîne vide sinon.

**Cap 8** : la boucle est tronquée à 8 items côté serveur — ajoute une ligne \`{favoritesMoreText}\` sous la boucle pour signaler les items restants.

Exemple d'usage :
\`\`\`html
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
  {{#each favorites}}
  <tr>
    <td width="80" style="padding:8px;">
      <img src="{image}" alt="{name}" width="72" height="72" style="width:72px;height:72px;display:block;object-fit:cover;border-radius:8px;">
    </td>
    <td style="padding:8px;font-size:13px;">
      <div style="font-weight:600;color:#0f172a;">{name}</div>
      <div style="font-size:11px;color:#64748b;">{color}</div>
      <div style="font-weight:700;margin-top:4px;">{price}</div>
    </td>
  </tr>
  {{/each}}
</table>\``;
  }

  return null;
}

export interface BuildAiPromptParams {
  description: string;
  /** Scénario automatique si le modèle est lié à un déclencheur. `null` = manuel. */
  scenario?: ScenarioKey | null;
}

export function buildAiPrompt({ description, scenario = null }: BuildAiPromptParams): string {
  const clean = description.trim();
  const descSection = clean
    ? `VOICI LE MODÈLE DE MAIL QUE JE SOUHAITE :\n${clean}`
    : `VOICI LE MODÈLE DE MAIL QUE JE SOUHAITE :\n(à compléter — décris ici le style, le ton, le contenu voulu, la structure des sections, l'ambiance, etc.)`;

  const scenarioSection = buildScenarioSection(scenario);

  const parts: string[] = [
    HEADER,
    TECH_CONSTRAINTS,
    GRANULARITY_INSTRUCTIONS,
    IMG_INSTRUCTIONS,
    LINKS_INSTRUCTIONS,
    buildMandatorySection(),
    buildOptionalSection(),
  ];
  if (scenarioSection) parts.push(scenarioSection);
  parts.push(descSection);
  parts.push(FOOTER_INSTRUCTIONS);

  return parts.join("\n\n");
}
