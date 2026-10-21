/**
 * Génère le prompt IA à copier-coller dans ChatGPT / Claude pour reformuler
 * un mail transactionnel. Le prompt est spécifique au scénario (ton, variables
 * obligatoires, contexte audience client / admin).
 *
 * Même pattern que `lib/newsletter-ai-prompt.ts` : pas d'appel réseau,
 * seulement la construction d'un prompt textuel que l'admin copie.
 *
 * Module PUR — safe pour import client.
 */

import {
  TRANSACTIONAL_SCENARIOS,
  AUDIENCE_LABELS,
  VARIABLE_KIND_LABELS,
  classifyVariableKind,
  describeVariableUsage,
  type TransactionalScenarioKey,
  type TransactionalScenarioMeta,
} from "@/lib/transactional-email-scenarios";

const HEADER = `Tu es un expert en rédaction d'emails transactionnels professionnels pour une boutique e-commerce B2B.

Je vais te décrire le mail que je veux et tu dois me retourner UNIQUEMENT du HTML (sans explications, sans texte avant ou après le code) prêt à être envoyé par email.`;

const TECH_CONSTRAINTS = `CONTRAINTES TECHNIQUES OBLIGATOIRES :
- Compatible clients mail courants (Outlook, Gmail, Apple Mail, iOS Mail)
- Un seul <div> racine, largeur max 600px, centré via margin:0 auto
- Styles 100 % inline (style="..."), pas de <style> ni classes CSS
- Pas de JavaScript, pas de <script>, pas d'iframe
- Pas d'images <img> (sauf si je te demande explicitement d'en ajouter)
- Police safe : Arial, Helvetica ou sans-serif
- Boutons = <a> avec padding + background inline (pas de <button>)
- Pas de media queries, pas de dark mode (ignorer @media)
- Longueur raisonnable : évite les ESM qui classent le mail en spam`;

const TOKEN_SYNTAX = `INTERPOLATION DES VARIABLES :
- Les variables dynamiques s'écrivent entre accolades : {firstName}, {orderNumber}, {code}, etc.
- NE PAS écrire \${firstName} ni {{firstName}} — seul {firstName} fonctionne (une seule paire d'accolades).
- Les variables OBLIGATOIRES ci-dessous DOIVENT apparaître au moins une fois dans le sujet ou le HTML, sinon la sauvegarde est refusée.
- Les variables FACULTATIVES peuvent être omises.
- Trois types de variables, à utiliser différemment :
  (1) TEXTE : insérable dans une phrase (ex. "Bonjour {firstName},").
  (2) LIEN (URL) : à placer UNIQUEMENT dans un href=\"\", jamais en texte brut.
      Exemple : <a href=\"{resetUrl}\" style=\"...\">Réinitialiser mon mot de passe</a>.
  (3) BLOC HTML : fragment HTML pré-fabriqué par le site (tableau d'articles,
      bloc IBAN, bloc motif...). Insérer la variable TELLE QUELLE à l'endroit
      voulu ; ne pas tenter de recréer son contenu à la main. Peut rendre une
      chaîne vide si l'info ne s'applique pas (ex. commande sans tracking).`;

function formatVariableLine(v: {
  token: string;
  label: string;
  example: string;
  hint?: string;
  description?: string;
  kind?: "text" | "url" | "htmlBlock";
}): string {
  const kind = classifyVariableKind(v);
  const kindLabel = VARIABLE_KIND_LABELS[kind];
  const usage = describeVariableUsage(v);
  const hint = v.hint ? ` — ${v.hint}` : "";
  return [
    `  • {${v.token}}  [${kindLabel}]  « ${v.label} »${hint}`,
    `     Exemple de valeur : "${v.example}"`,
    `     Comment l'utiliser : ${usage}`,
  ].join("\n");
}

function buildVariableSection(meta: TransactionalScenarioMeta): string {
  const required = meta.variables.filter((v) => v.required);
  const optional = meta.variables.filter((v) => !v.required);

  const lines: string[] = [];

  if (required.length > 0) {
    lines.push("VARIABLES OBLIGATOIRES — chacune DOIT apparaître au moins une fois dans le sujet ou le HTML :");
    for (const v of required) {
      lines.push(formatVariableLine(v));
    }
    lines.push("");
  }

  if (optional.length > 0) {
    lines.push("VARIABLES FACULTATIVES — à utiliser si pertinent :");
    for (const v of optional) {
      lines.push(formatVariableLine(v));
    }
  }

  return lines.join("\n");
}

const FOOTER = `À RETOURNER :
Renvoie UNIQUEMENT le code HTML, rien d'autre — pas d'intro, pas d'explication, pas de \`\`\`html.
Commence directement par <div et termine par </div>.`;

export interface BuildTransactionalAiPromptParams {
  /** Scénario pour lequel générer le mail. */
  scenarioKey: TransactionalScenarioKey;
  /** Description libre : ton, ambiance, détails voulus. */
  description: string;
  /** Sujet actuel (optionnel, pour contexte). */
  currentSubject?: string;
}

export function buildTransactionalAiPrompt(
  params: BuildTransactionalAiPromptParams,
): string {
  const meta = TRANSACTIONAL_SCENARIOS.find((s) => s.key === params.scenarioKey);
  if (!meta) {
    // Ne devrait pas arriver : scenarioKey vient toujours de l'UI qui liste
    // les scénarios du registre. On protège quand même.
    return `Scénario inconnu : ${params.scenarioKey}`;
  }

  const clean = params.description.trim();
  const descSection = clean
    ? `MA DEMANDE (ce que je veux changer / préciser) :\n${clean}`
    : `MA DEMANDE :\n(décris ici l'ambiance, le ton, les ajustements voulus)`;

  const context = `SCÉNARIO : ${meta.label}
AUDIENCE : ${AUDIENCE_LABELS[meta.audience]}
QUAND ce mail part : ${meta.description}

TON ATTENDU : ${meta.aiTone}`;

  const currentSubjectSection = params.currentSubject
    ? `SUJET ACTUEL (à conserver ou adapter légèrement) :\n${params.currentSubject}`
    : "";

  const parts = [
    HEADER,
    context,
    TECH_CONSTRAINTS,
    TOKEN_SYNTAX,
    buildVariableSection(meta),
  ];
  if (currentSubjectSection) parts.push(currentSubjectSection);
  parts.push(descSection);
  parts.push(FOOTER);

  return parts.join("\n\n");
}
