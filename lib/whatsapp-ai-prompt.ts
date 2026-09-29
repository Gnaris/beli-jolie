/**
 * Construction du prompt à donner à une IA (ChatGPT, Claude, Gemini, Mistral…)
 * pour générer le CONTENU d'un modèle de message WhatsApp.
 *
 * Différences majeures avec le prompt mail (`newsletter-ai-prompt.ts`) :
 *  - WhatsApp = texte pur (pas de HTML, pas de tables, pas de boutons).
 *  - Max 1000 caractères.
 *  - Formatage limité : `*gras*` `_italique_` `~barré~` ```` ```mono``` ```` .
 *  - Pas de vrais liens cliquables sur du texte : l'URL DOIT figurer en clair.
 *  - Pas de mentions RGPD/désinscription obligatoires (canal 1-to-1).
 *  - Signature perso (`{adminFirstName}` — l'admin qui envoie).
 *
 * Module pur — sans dépendance serveur, safe pour import client.
 */

import { WHATSAPP_VARIABLES } from "@/lib/whatsapp-message";
import { VARIABLE_GROUP_LABELS } from "@/lib/mail-merge-variables";
import type { MailVariable } from "@/lib/mail-merge-variables";

const HEADER = `Tu es un expert en messages WhatsApp commerciaux (B2B). Génère-moi le CONTENU d'un message WhatsApp court, chaleureux et efficace, prêt à être copié dans un modèle réutilisable.`;

const FORMAT_CONSTRAINTS = `CONTRAINTES DE FORMAT :
- Texte pur — pas de HTML, pas de balises, pas de tableaux.
- Longueur maximale : **1000 caractères** (sois concis, va à l'essentiel).
- Formatage WhatsApp reconnu :
  - \`*texte*\` → **gras**
  - \`_texte_\` → *italique*
  - \`~texte~\` → ~~barré~~
  - \`\`\`texte\`\`\` → monospace
- **INTERDIT** : ne mets AUCUN emoji (pas de 👋, ✨, 👉, ❤, 🎉…). WhatsApp Desktop casse leur encodage à l'envoi et le destinataire reçoit des \`?\` bizarres. Reste sur du texte propre — le ton chaleureux passe par les mots.
- Découpe en courts paragraphes séparés par une ligne vide — plus lisible sur mobile.`;

const LINKS_CONSTRAINTS = `LIENS :
WhatsApp NE SAIT PAS créer de lien sur un mot (contrairement au mail). Seules les **URL brutes** sont cliquables — l'appli les détecte et les rend cliquables automatiquement chez le destinataire.

**INTERDIT** :
\`Cliquez ici\` (rien de cliquable, l'URL est cachée)

**CORRECT** :
\`Voir le catalogue : https://beliandjolie.com/catalogue\`
\`Découvrez la nouveauté : https://beliandjolie.com/produits/collier-lune\`

Écris le libellé + l'URL en clair. Une URL par ligne quand il y en a plusieurs.`;

function formatVariable(v: MailVariable): string {
  const hint = v.hint ? ` — ${v.hint}` : "";
  return `- \`{${v.token}}\` : ${v.label}${hint} (ex. « ${v.previewValue} »)`;
}

function buildVariablesSection(): string {
  const byGroup: Record<string, MailVariable[]> = {};
  for (const v of WHATSAPP_VARIABLES) {
    (byGroup[v.group] ??= []).push(v);
  }
  const parts: string[] = [
    `VARIABLES DISPONIBLES (elles seront remplacées automatiquement au moment de l'envoi — utilise-les au lieu de deviner un prénom ou un nom d'entreprise) :`,
  ];
  for (const group of Object.keys(byGroup)) {
    const groupLabel =
      VARIABLE_GROUP_LABELS[group as keyof typeof VARIABLE_GROUP_LABELS] ?? group;
    parts.push(`\n**${groupLabel}** :`);
    parts.push(byGroup[group].map(formatVariable).join("\n"));
  }
  return parts.join("\n");
}

const TONE_GUIDANCE = `TON & STYLE :
- WhatsApp est un canal **personnel et direct** — écris comme si tu parlais à une personne, pas comme un mail marketing.
- Commence par un salut personnel (\`Bonjour {firstName}\`, \`Salut {firstName}\`).
- Signe le message avec le prénom de l'expéditeur (\`{adminFirstName}\`) — jamais avec « L'équipe » ou un nom générique.
- Évite les majuscules criardes, les points d'exclamation en rafale, le vocabulaire trop publicitaire.
- Une seule idée par message — un WhatsApp qui essaie de tout dire ne convertit pas.`;

const FOOTER_INSTRUCTIONS = `RÈGLES DE LIVRAISON :
- Réponds UNIQUEMENT avec le texte du message final, sans commentaire, sans explication avant/après.
- Encapsule le contenu dans UN SEUL bloc de code Markdown \`\`\`text … \`\`\` pour que l'admin puisse le copier proprement.
- Vérifie avant de répondre :
  - Le message contient au moins UNE variable client (\`{firstName}\` par exemple) — sinon il aura l'air générique.
  - Il est signé avec \`{adminFirstName}\` ou équivalent.
  - Aucune balise HTML n'est présente.
  - **Aucun emoji** dans le texte (👋 ✨ 👉 etc. sont interdits — voir contraintes de format).
  - Les URL, s'il y en a, sont en clair (jamais \`[texte](url)\`).
  - Le total tient sous 1000 caractères.`;

export interface BuildWhatsAppAiPromptParams {
  description: string;
}

export function buildWhatsAppAiPrompt({ description }: BuildWhatsAppAiPromptParams): string {
  const clean = description.trim();
  const descSection = clean
    ? `VOICI LE MESSAGE QUE JE SOUHAITE :\n${clean}`
    : `VOICI LE MESSAGE QUE JE SOUHAITE :\n(à compléter — décris ici le contexte du message : à qui il s'adresse, pourquoi tu l'envoies, quelle info clé transmettre, quel ton adopter, éventuel lien à inclure, etc.)`;

  const parts: string[] = [
    HEADER,
    FORMAT_CONSTRAINTS,
    LINKS_CONSTRAINTS,
    TONE_GUIDANCE,
    buildVariablesSection(),
    descSection,
    FOOTER_INSTRUCTIONS,
  ];

  return parts.join("\n\n");
}
