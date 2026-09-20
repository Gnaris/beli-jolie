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
 * Retourne le modèle par défaut pour un stade relance inactivité donné.
 * - Stade 1 : rappel doux « on ne vous a pas vu depuis un moment ».
 * - Stade 2 : rappel personnalisé avec bénéfices.
 * - Stade 3 : dernière relance chaleureuse avant silence.
 * Au-delà du stade 3 → design du stade 3 (édité par la cliente).
 */
export function inactiveClientStageDefault(stageIndex: number): DefaultTemplate {
  switch (stageIndex) {
    case 1:
      return {
        name: SCENARIO_DEFAULT_NAMES.INACTIVE_CLIENT,
        subject: "Nos nouveautés vous attendent",
        blocks: [
          brandHeaderBlock("inac1"),
          {
            id: "inac1-title",
            type: "heading",
            data: {
              title: "On vous a pas vu depuis un moment 😴",
              body: "Bonjour {firstName},",
              align: "left",
            },
          },
          {
            id: "inac1-days",
            type: "daysInactive",
            data: {
              template:
                "Cela fait {days} jour(s) qu'on ne vous a pas vu sur notre boutique. Nous avons plein de nouveautés à vous montrer !",
              neverVisitedTemplate:
                "Vous n'avez encore jamais visité notre boutique en ligne. Nos nouveautés vous attendent !",
            },
          },
          {
            id: "inac1-list",
            type: "list",
            data: {
              items: [
                "✨ Nouvelle collection en ligne",
                "💎 Nouveaux modèles en stock",
                "🎁 Livraison offerte dès 200 € HT",
              ],
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
        subject: "Un petit clin d'œil pour vous {firstName}",
        blocks: [
          brandHeaderBlock("inac2"),
          {
            id: "inac2-title",
            type: "heading",
            data: {
              title: "Vous nous manquez",
              body: "Bonjour {firstName}, on tenait à reprendre contact.",
              align: "left",
            },
          },
          {
            id: "inac2-days",
            type: "daysInactive",
            data: {
              template:
                "Il s'est écoulé {days} jour(s) depuis votre dernière visite. Notre équipe reste disponible si vous avez la moindre question — sur un modèle, la livraison, votre compte.",
              neverVisitedTemplate:
                "Nous n'avons pas encore eu le plaisir de vous accueillir sur notre boutique en ligne. On serait ravi de vous montrer ce qu'on a préparé.",
            },
          },
          {
            id: "inac2-btn",
            type: "button",
            data: {
              label: "Revenir sur la boutique",
              url: "/produits",
              bg: "#0f172a",
              color: "#ffffff",
              align: "center",
            },
          },
          {
            id: "inac2-subcta",
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
            id: "inac2-sign",
            type: "heading",
            data: {
              title: "",
              body: "Bonne journée,\nL'équipe {shopName}",
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
        subject: "Un dernier bonjour de notre part",
        blocks: [
          brandHeaderBlock("inac3"),
          {
            id: "inac3-warn",
            type: "heading",
            data: {
              title: "NOUVEAUTÉS DU MOMENT",
              body: "On vous a préparé les dernières arrivées à découvrir.",
              align: "center",
              bg: "#0f172a",
              titleColor: "#cbd5e1",
              bodyColor: "#ffffff",
              titleSize: 11,
              bodySize: 15,
            },
          },
          {
            id: "inac3-title",
            type: "heading",
            data: {
              title: "{firstName}, ce sera notre dernière relance",
              body: "On ne veut pas encombrer votre boîte mail. Voici la dernière invitation à passer nous voir — après, promis, on vous laisse tranquille.",
              align: "left",
            },
          },
          {
            id: "inac3-days",
            type: "daysInactive",
            data: {
              template:
                "Cela fait {days} jour(s) qu'on ne vous a pas croisé sur la boutique.",
              neverVisitedTemplate:
                "Vous n'avez encore jamais franchi les portes de notre boutique en ligne.",
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
              body: "Merci pour votre confiance,\nL'équipe {shopName}",
              align: "left",
              bodyColor: "#475569",
            },
          },
          legalFooterBlock("inac3"),
        ],
      };
  }
}
