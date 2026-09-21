/**
 * Modèles par défaut pour les 3 mails transactionnels : panier abandonné,
 * inactivité client, retour en stock. Reproduit le rendu historique
 * (lib/mail-templates/*.ts) sous forme de blocs newsletter.
 *
 * Utilisé par :
 * - `ensureDefaultScenarioTemplates()` (seed lazy) → crée les modèles au 1er
 *   accès à la liste si absents pour le tenant courant.
 * - `resetScenarioTemplateToDefault()` → remet blocs + sujet du modèle actif
 *   d'un scénario à son design d'origine.
 */

import type { NewsletterBlock } from "@/lib/newsletter-blocks";

export type ScenarioKey = "ABANDONED_CART" | "INACTIVE_CLIENT" | "RESTOCK";

export const SCENARIO_KEYS: readonly ScenarioKey[] = [
  "ABANDONED_CART",
  "INACTIVE_CLIENT",
  "RESTOCK",
] as const;

export const SCENARIO_LABELS: Record<ScenarioKey, string> = {
  ABANDONED_CART: "Panier abandonné",
  INACTIVE_CLIENT: "Relance inactivité",
  RESTOCK: "Retour en stock",
};

export const SCENARIO_DEFAULT_NAMES: Record<ScenarioKey, string> = {
  ABANDONED_CART: "Panier abandonné (par défaut)",
  INACTIVE_CLIENT: "Relance inactivité (par défaut)",
  RESTOCK: "Retour en stock (par défaut)",
};

/**
 * Blocs autorisés dans un modèle selon le scénario auquel il est lié.
 * `null` = modèle non lié (newsletter classique) → blocs dynamiques cachés.
 */
export function allowedDynamicBlocksFor(scenario: ScenarioKey | null): Set<string> {
  if (scenario === "ABANDONED_CART") return new Set(["cartItems"]);
  if (scenario === "RESTOCK") return new Set(["favoritesGrid"]);
  if (scenario === "INACTIVE_CLIENT") return new Set(["daysInactive"]);
  return new Set();
}

/**
 * Blocs OBLIGATOIRES dans un modèle selon son scénario.
 * Un modèle sans ces blocs ne peut pas être enregistré (bouton Save désactivé)
 * pour éviter qu'un mail transactionnel parte vide de son bloc dynamique clé.
 *
 * Retourne les types de blocs requis + un libellé humain pour l'UI.
 */
export interface RequiredBlockSpec {
  type: string;
  label: string;
}
export function requiredBlocksFor(scenario: ScenarioKey | null): RequiredBlockSpec[] {
  if (scenario === "ABANDONED_CART") {
    return [{ type: "cartItems", label: "Liste des articles du panier" }];
  }
  if (scenario === "RESTOCK") {
    return [{ type: "favoritesGrid", label: "Grille des favoris revenus en stock" }];
  }
  if (scenario === "INACTIVE_CLIENT") {
    return [{ type: "daysInactive", label: "Message sur les jours d'inactivité" }];
  }
  // Newsletter classique : aucun bloc obligatoire.
  return [];
}

/**
 * Vérifie qu'un tableau de blocs contient bien tous les blocs obligatoires du
 * scénario. Retourne la liste des blocs MANQUANTS (vide si tout va bien).
 */
export function missingRequiredBlocks(
  scenario: ScenarioKey | null,
  presentBlockTypes: string[],
): RequiredBlockSpec[] {
  const required = requiredBlocksFor(scenario);
  const present = new Set(presentBlockTypes);
  return required.filter((r) => !present.has(r.type));
}

interface DefaultTemplate {
  name: string;
  subject: string;
  blocks: NewsletterBlock[];
}

export const SCENARIO_DEFAULTS: Record<ScenarioKey, DefaultTemplate> = {
  ABANDONED_CART: abandonedCartStageDefault(1),
  INACTIVE_CLIENT: inactiveClientStageDefault(1),
  RESTOCK: {
    name: SCENARIO_DEFAULT_NAMES.RESTOCK,
    subject: "Vos favoris sont de retour",
    blocks: [
      {
        id: "rst-heading",
        type: "heading",
        data: {
          title: "Vos favoris sont revenus 🔔",
          body: "Bonjour {firstName}, bonne nouvelle — les produits ci-dessous sont de nouveau disponibles.",
          align: "left",
        },
      },
      {
        id: "rst-grid",
        type: "favoritesGrid",
        data: {
          cols: 2,
          emptyMessage: "Aucun produit à annoncer pour l'instant.",
        },
      },
      {
        id: "rst-btn",
        type: "button",
        data: {
          label: "Voir tous mes favoris",
          url: "/favoris",
          bg: "#0f172a",
          color: "#ffffff",
          align: "center",
        },
      },
      ...legalFooterBlocks("rst"),
    ],
  },
};

/**
 * Footer historique (blocs `heading` maquillés en pied de page) — encore
 * utilisé par INACTIVE_CLIENT et RESTOCK. Nouveau design panier abandonné :
 * voir `legalFooterBlock` (bloc `footer` en dur).
 */
function legalFooterBlocks(prefix: string): NewsletterBlock[] {
  return [
    { id: `${prefix}-legal-divider`, type: "divider", data: {} },
    {
      id: `${prefix}-legal-shop`,
      type: "heading",
      data: {
        title: "",
        body: "{shopName} · {shopAddress}",
        align: "center",
        bodyColor: "#94a3b8",
      },
    },
    {
      id: `${prefix}-legal-links`,
      type: "heading",
      data: {
        title: "",
        body: "Se désinscrire : {unsubscribeLink}\nPolitique de confidentialité : {privacyLink}",
        align: "center",
        bodyColor: "#94a3b8",
      },
    },
  ];
}

/**
 * Header commun aux 3 stades panier abandonné — logo texte + tagline.
 * Titre et sous-titre restent en variables pour que la cliente puisse
 * personnaliser ensuite (ex : mettre son logo à la place du texte).
 */
function brandHeaderBlock(prefix: string): NewsletterBlock {
  return {
    id: `${prefix}-header`,
    type: "header",
    data: {
      logo: "",
      logoMaxHeight: 60,
      title: "{shopName}",
      subtitle: "Grossiste bijoux",
      bg: "#ffffff",
      textColor: "#0f172a",
      titleSize: 22,
      subtitleSize: 11,
      align: "center",
    },
  };
}

/**
 * Footer légal — bloc de type `footer` (pas un heading maquillé). Contient
 * les 4 variables obligatoires validées à la sauvegarde :
 * `{shopName}` `{shopAddress}` `{unsubscribeLink}` `{privacyLink}`.
 */
function legalFooterBlock(prefix: string): NewsletterBlock {
  return {
    id: `${prefix}-footer`,
    type: "footer",
    data: {
      content:
        "{shopName} · {shopAddress}\nSe désinscrire : {unsubscribeLink}\nPolitique de confidentialité : {privacyLink}",
      bg: "#f8fafc",
      color: "#64748b",
      align: "center",
      fontSize: 11,
    },
  };
}

/**
 * Retourne le modèle par défaut pour un stade panier abandonné donné.
 * - Stade 1 : rappel doux, court, aucun rabais.
 * - Stade 2 : relance rassurante, on ouvre la porte au dialogue.
 * - Stade 3 : dernière chance, bandeau « Stock limité » + signature perso.
 * Au-delà du stade 3, on retombe sur le design du stade 3 (les stades 4+
 * sont libres d'être édités par la cliente).
 */
export function abandonedCartStageDefault(stageIndex: number): DefaultTemplate {
  switch (stageIndex) {
    case 1:
      return {
        name: SCENARIO_DEFAULT_NAMES.ABANDONED_CART,
        subject: "Vous avez oublié quelque chose ?",
        blocks: [
          brandHeaderBlock("abc1"),
          {
            id: "abc1-title",
            type: "heading",
            data: {
              title: "Votre panier vous attend, {firstName} 🛍️",
              body: "Vous avez laissé quelques articles dans votre panier — pas de panique, nous les avons gardés au chaud pour vous. Reprenez votre commande là où vous l'aviez laissée, en un clic.",
              align: "left",
            },
          },
          {
            id: "abc1-cart",
            type: "cartItems",
            data: {
              title: "",
              totalLabel: "Total HT",
              emptyMessage:
                "Votre panier est vide — nos nouveautés vous attendent !",
            },
          },
          {
            id: "abc1-btn",
            type: "button",
            data: {
              label: "Reprendre ma commande",
              url: "/panier",
              bg: "#0f172a",
              color: "#ffffff",
              align: "center",
            },
          },
          {
            id: "abc1-subcta",
            type: "heading",
            data: {
              title: "",
              body: "Votre panier reste actif tant que le stock le permet.",
              align: "center",
              bodyColor: "#64748b",
              bodySize: 12,
            },
          },
          {
            id: "abc1-sign",
            type: "heading",
            data: {
              title: "",
              body: "À très vite,\nL'équipe {shopName}",
              align: "left",
              bodyColor: "#475569",
            },
          },
          legalFooterBlock("abc1"),
        ],
      };

    case 2:
      return {
        name: `${SCENARIO_LABELS.ABANDONED_CART} — Stade 2`,
        subject: "Vos articles sont toujours là — on vous accompagne",
        blocks: [
          brandHeaderBlock("abc2"),
          {
            id: "abc2-title",
            type: "heading",
            data: {
              title: "Une petite hésitation, {firstName} ?",
              body: "Votre sélection est toujours dans votre panier. Si quelque chose vous retient — un doute sur les modèles, la livraison, ou une question sur votre compte — on est là pour vous répondre.",
              align: "left",
            },
          },
          {
            id: "abc2-cart",
            type: "cartItems",
            data: {
              title: "",
              totalLabel: "Total HT",
              emptyMessage:
                "Votre panier est vide — nos nouveautés vous attendent !",
            },
          },
          {
            id: "abc2-btn",
            type: "button",
            data: {
              label: "Retourner à mon panier",
              url: "/panier",
              bg: "#0f172a",
              color: "#ffffff",
              align: "center",
            },
          },
          {
            id: "abc2-subcta",
            type: "heading",
            data: {
              title: "",
              body: "Ou contactez-nous — on répond en général sous 2 h ouvrées.",
              align: "center",
              bodyColor: "#64748b",
              bodySize: 12,
            },
          },
          {
            id: "abc2-sign",
            type: "heading",
            data: {
              title: "",
              body: "Bonne journée,\nL'équipe {shopName}",
              align: "left",
              bodyColor: "#475569",
            },
          },
          legalFooterBlock("abc2"),
        ],
      };

    case 3:
    default:
      return {
        name: `${SCENARIO_LABELS.ABANDONED_CART} — Stade 3`,
        subject: "Un dernier rappel — vos articles vous attendent",
        blocks: [
          brandHeaderBlock("abc3"),
          {
            id: "abc3-warn",
            type: "heading",
            data: {
              title: "STOCK LIMITÉ",
              body: "Certains articles de votre panier sont bientôt en rupture.",
              align: "center",
              bg: "#0f172a",
              titleColor: "#cbd5e1",
              bodyColor: "#ffffff",
              titleSize: 11,
              bodySize: 15,
            },
          },
          {
            id: "abc3-title",
            type: "heading",
            data: {
              title: "Une dernière chance de finaliser 💫",
              body: "{firstName}, votre panier est toujours là mais nos stocks bougent vite. Voici ce qui vous attend :",
              align: "left",
            },
          },
          {
            id: "abc3-cart",
            type: "cartItems",
            data: {
              title: "",
              totalLabel: "Total HT",
              emptyMessage:
                "Votre panier est vide — nos nouveautés vous attendent !",
            },
          },
          {
            id: "abc3-btn",
            type: "button",
            data: {
              label: "Finaliser ma commande",
              url: "/panier",
              bg: "#0f172a",
              color: "#ffffff",
              align: "center",
            },
          },
          { id: "abc3-divider", type: "divider", data: {} },
          {
            id: "abc3-sign",
            type: "heading",
            data: {
              title: "",
              body: "Merci pour votre confiance,\nL'équipe {shopName}",
              align: "left",
              bodyColor: "#475569",
            },
          },
          legalFooterBlock("abc3"),
        ],
      };
  }
}

/**
 * Header signature des 3 mails inactivité — logo/nom boutique centré, eyebrow
 * en petites capitales espacées et fine règle décorative. Différent du header
 * panier abandonné pour signer visuellement le scénario.
 */
function elegantInactivityHeader(prefix: string): NewsletterBlock {
  return {
    id: `${prefix}-header`,
    type: "header",
    data: {
      logo: "",
      logoMaxHeight: 60,
      title: "{shopName}",
      subtitle: "Grossiste bijoux",
      bg: "#ffffff",
      textColor: "#0f172a",
      titleSize: 26,
      subtitleSize: 10,
      align: "center",
      subtitleUppercase: true,
      subtitleLetterSpacing: 30,
      decorativeRule: true,
      ruleColor: "#cbd5e1",
    },
  };
}

/**
 * Retourne le modèle par défaut pour un stade relance inactivité donné.
 * Les 3 stades partagent le même header/footer et la même palette ardoise ;
 * ils se différencient par le ton, la composition et l'intention :
 * - Stade 1 : invitation douce, focus nouveautés, 3 bénéfices en pastilles.
 * - Stade 2 : main tendue, ouverture au dialogue, callout « Nous écrire ».
 * - Stade 3 : au revoir élégant, bandeau dark de dernière invitation, colonnes.
 * Au-delà du stade 3 → design du stade 3 (édité par la cliente).
 */
export function inactiveClientStageDefault(stageIndex: number): DefaultTemplate {
  switch (stageIndex) {
    case 1:
      return {
        name: SCENARIO_DEFAULT_NAMES.INACTIVE_CLIENT,
        subject: "Vous nous manquez déjà, {firstName}",
        blocks: [
          elegantInactivityHeader("inac1"),
          {
            id: "inac1-spacer-top",
            type: "empty",
            data: { height: 12 },
          },
          {
            id: "inac1-title",
            type: "heading",
            data: {
              title: "Vous nous manquez déjà",
              body: "Bonjour {firstName}, ça fait un moment qu'on ne s'est pas croisés sur la boutique. Nos rayons ont bien changé depuis — on tenait à vous inviter à jeter un œil.",
              align: "left",
              titleSize: 22,
              titleColor: "#0f172a",
              bodyColor: "#475569",
            },
          },
          {
            id: "inac1-days",
            type: "daysInactive",
            data: {
              template:
                "Cela fait {days} jour(s) que vous n'êtes pas passé nous voir — et pendant ce temps, notre catalogue s'est étoffé.",
              neverVisitedTemplate:
                "Vous n'avez pas encore exploré la boutique en ligne — nos dernières pièces vous attendent.",
              color: "#64748b",
            },
          },
          {
            id: "inac1-features",
            type: "featuresRow",
            data: {
              items: [
                { icon: "✨", label: "Nouveaux modèles\nchaque semaine" },
                { icon: "💎", label: "Sélection\nexclusive grossiste" },
                { icon: "🚚", label: "Livraison offerte\ndès 200 € HT" },
              ],
              bg: "#f8fafc",
              circleBg: "#ffffff",
              iconColor: "#0f172a",
              labelColor: "#475569",
              circleSize: 56,
              iconSize: 22,
              labelSize: 12,
            },
          },
          {
            id: "inac1-btn",
            type: "button",
            data: {
              label: "Découvrir les nouveautés",
              url: "/produits",
              bg: "#0f172a",
              color: "#ffffff",
              align: "center",
            },
          },
          {
            id: "inac1-spacer-sign",
            type: "empty",
            data: { height: 8 },
          },
          {
            id: "inac1-sign",
            type: "heading",
            data: {
              title: "",
              body: "À très vite,\nL'équipe {shopName}",
              align: "left",
              bodyColor: "#475569",
            },
          },
          legalFooterBlock("inac1"),
        ],
      };

    case 2:
      return {
        name: `${SCENARIO_LABELS.INACTIVE_CLIENT} — Stade 2`,
        subject: "Un petit mot pour vous, {firstName}",
        blocks: [
          elegantInactivityHeader("inac2"),
          {
            id: "inac2-spacer-top",
            type: "empty",
            data: { height: 12 },
          },
          {
            id: "inac2-eyebrow",
            type: "heading",
            data: {
              title: "ON PENSE À VOUS",
              body: "",
              align: "left",
              titleSize: 11,
              titleColor: "#64748b",
            },
          },
          {
            id: "inac2-title",
            type: "heading",
            data: {
              title: "Un petit mot personnel",
              body: "Bonjour {firstName}, on n'aime pas trop quand un client s'éloigne sans qu'on sache pourquoi. Rien d'obligatoire ici — juste l'envie de garder le lien et de vous dire qu'on est là si besoin.",
              align: "left",
              titleSize: 22,
              titleColor: "#0f172a",
              bodyColor: "#475569",
            },
          },
          {
            id: "inac2-days",
            type: "daysInactive",
            data: {
              template:
                "Il s'est écoulé {days} jour(s) depuis votre dernière visite. Si quelque chose vous retient — un doute sur un modèle, un souci de livraison, un besoin particulier — on prend le temps d'y répondre.",
              neverVisitedTemplate:
                "Nous n'avons pas encore eu le plaisir de vous accueillir sur la boutique en ligne. Prenez le temps qu'il vous faut — on reste disponible.",
              color: "#64748b",
            },
          },
          {
            id: "inac2-callout",
            type: "callout",
            data: {
              title: "Une question ? Un doute ?",
              subtitle: "On répond en général sous 2 h ouvrées.",
              cta: "Nous écrire",
              ctaUrl: "mailto:{shopEmail}",
              bg: "#0f172a",
              color: "#ffffff",
              titleSize: 16,
              subtitleSize: 13,
              ctaSize: 13,
            },
          },
          {
            id: "inac2-btn",
            type: "button",
            data: {
              label: "Revenir sur la boutique",
              url: "/produits",
              bg: "#f1f5f9",
              color: "#0f172a",
              align: "center",
            },
          },
          { id: "inac2-divider", type: "divider", data: {} },
          {
            id: "inac2-sign",
            type: "heading",
            data: {
              title: "",
              body: "Prenez soin de vous,\nL'équipe {shopName}",
              align: "left",
              bodyColor: "#475569",
            },
          },
          legalFooterBlock("inac2"),
        ],
      };

    case 3:
    default:
      return {
        name: `${SCENARIO_LABELS.INACTIVE_CLIENT} — Stade 3`,
        subject: "Un dernier bonjour, {firstName}",
        blocks: [
          elegantInactivityHeader("inac3"),
          {
            id: "inac3-banner",
            type: "heading",
            data: {
              title: "DERNIÈRE INVITATION",
              body: "Un dernier bonjour de notre part",
              align: "center",
              bg: "#0f172a",
              titleColor: "#94a3b8",
              bodyColor: "#ffffff",
              titleSize: 11,
              bodySize: 22,
            },
          },
          {
            id: "inac3-title",
            type: "heading",
            data: {
              title: "",
              body: "{firstName}, on ne veut pas encombrer votre boîte mail. Voici notre dernière relance — après, promis, on vous laisse tranquille. Avant de partir, jetez peut-être un œil à ce qui vient d'arriver.",
              align: "left",
              bodyColor: "#475569",
            },
          },
          {
            id: "inac3-days",
            type: "daysInactive",
            data: {
              template:
                "Cela fait {days} jour(s) qu'on ne s'est pas croisés.",
              neverVisitedTemplate:
                "Nous n'avons pas eu la chance de vous accueillir sur la boutique.",
              color: "#64748b",
            },
          },
          {
            id: "inac3-columns",
            type: "columns",
            data: {
              cols: 2,
              columns: [
                {
                  kind: "text",
                  text:
                    "Nos dernières pièces\n\nDécouvrez ce qui vient d'arriver — modèles inédits et sélection exclusive grossiste.",
                },
                {
                  kind: "text",
                  text:
                    "Restons en contact\n\nUne question, une envie particulière ? Écrivez-nous à {shopEmail}, on prend le temps de vous répondre.",
                },
              ],
              bg: "#f8fafc",
              color: "#475569",
            },
          },
          {
            id: "inac3-btn",
            type: "button",
            data: {
              label: "Voir les nouveautés",
              url: "/produits",
              bg: "#0f172a",
              color: "#ffffff",
              align: "center",
            },
          },
          { id: "inac3-divider", type: "divider", data: {} },
          {
            id: "inac3-sign",
            type: "heading",
            data: {
              title: "",
              body: "Merci pour votre confiance,\nÀ bientôt peut-être,\nL'équipe {shopName}",
              align: "left",
              bodyColor: "#475569",
            },
          },
          legalFooterBlock("inac3"),
        ],
      };
  }
}
