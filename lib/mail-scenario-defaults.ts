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
  ABANDONED_CART: {
    name: SCENARIO_DEFAULT_NAMES.ABANDONED_CART,
    subject: "Votre panier vous attend",
    blocks: [
      {
        id: "abc-heading",
        type: "heading",
        data: {
          title: "Votre panier vous attend 🛒",
          body: "Bonjour {firstName}, vous avez laissé quelques articles dans votre panier. Ils vous attendent toujours !",
          align: "left",
        },
      },
      {
        id: "abc-cart",
        type: "cartItems",
        data: {
          title: "",
          totalLabel: "Total",
          emptyMessage: "Votre panier est vide — nos nouveautés vous attendent !",
        },
      },
      {
        id: "abc-btn",
        type: "button",
        data: {
          label: "Reprendre ma commande",
          url: "/panier",
          bg: "#0f172a",
          color: "#ffffff",
          align: "center",
        },
      },
      ...legalFooterBlocks("abc"),
    ],
  },
  INACTIVE_CLIENT: {
    name: SCENARIO_DEFAULT_NAMES.INACTIVE_CLIENT,
    subject: "Nos nouveautés vous attendent",
    blocks: [
      {
        id: "inac-heading",
        type: "heading",
        data: {
          title: "On vous a pas vu depuis un moment 😴",
          body: "Bonjour {firstName},",
          align: "left",
        },
      },
      {
        id: "inac-days",
        type: "daysInactive",
        data: {
          template: "Cela fait {days} jour(s) qu'on ne vous a pas vu sur notre boutique. Nous avons plein de nouveautés à vous montrer !",
          neverVisitedTemplate: "Vous n'avez encore jamais visité notre boutique en ligne. Nos nouveautés vous attendent !",
        },
      },
      {
        id: "inac-list",
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
        id: "inac-btn",
        type: "button",
        data: {
          label: "Découvrir les nouveautés",
          url: "/produits",
          bg: "#0f172a",
          color: "#ffffff",
          align: "center",
        },
      },
      ...legalFooterBlocks("inac"),
    ],
  },
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
 * Footer minimal RGPD/LCEN — inséré à la fin de chaque modèle par défaut.
 * Contient les 4 variables obligatoires (validées à la sauvegarde) :
 * `{shopName}` `{shopAddress}` `{unsubscribeLink}` `{privacyLink}`.
 * L'admin peut restyler ou déplacer ces blocs, mais s'il retire une variable,
 * la sauvegarde sera refusée.
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
