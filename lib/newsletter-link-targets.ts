/**
 * Cibles configurables pour un lien détecté dans un modèle newsletter HTML.
 *
 * L'éditeur scanne les `href="…"` du source HTML et propose, pour chacun,
 * un picker en arbre. La cliente choisit une cible (Accueil / Produit précis /
 * Catégorie précise / …) et l'éditeur récrit le href en URL absolue.
 *
 * Ce module est PUR (0 dépendance serveur) — safe pour import client.
 */

export type LinkTarget =
  | { kind: "home" }
  | { kind: "cart" }
  | { kind: "products" }
  | { kind: "product"; id: string; name: string; reference: string; handle: string }
  | { kind: "categories" }
  | { kind: "category"; id: string; name: string; slug: string }
  | { kind: "collections" }
  | { kind: "collection"; id: string; name: string; slug: string }
  | { kind: "about" }
  | { kind: "contact" }
  // URL libre entrée par l'admin (domaine inclus). Renvoyée telle quelle par
  // `buildLinkUrl` sans injection de `/fr` ni de baseUrl — c'est la cliente
  // qui garantit la validité (mailto:, http://, //cdn.example.com…).
  | { kind: "custom"; url: string };

/**
 * Construit l'URL absolue pour une cible donnée. `baseUrl` doit être fourni
 * sans slash final (`https://beliandjolie.com`) — c'est la responsabilité
 * du caller. Locale figée à `fr` : les mails partent en français quel que
 * soit le locale actif de l'admin. À rendre paramétrable si besoin plus tard.
 */
export function buildLinkUrl(baseUrl: string, target: LinkTarget): string {
  const root = baseUrl.replace(/\/+$/, "");
  const fr = `${root}/fr`;
  switch (target.kind) {
    case "home":         return fr;
    case "cart":         return `${fr}/panier`;
    case "products":     return `${fr}/produits`;
    case "product":      return `${fr}/produits/${target.handle}`;
    case "categories":   return `${fr}/categories`;
    case "category":     return `${fr}/categories/${target.slug}`;
    case "collections":  return `${fr}/collections`;
    case "collection":   return `${fr}/collections/${target.slug}`;
    case "about":        return `${fr}/a-propos`;
    case "contact":      return `${fr}/nous-contacter`;
    case "custom":       return target.url.trim();
  }
}

/**
 * Libellé humain lisible d'une cible — utilisé dans la liste des liens du
 * mail (ex. « Produit — Bracelet doré (A123) »).
 */
export function describeLinkTarget(target: LinkTarget): string {
  switch (target.kind) {
    case "home":         return "Accueil";
    case "cart":         return "Panier";
    case "products":     return "Tous les produits";
    case "product":      return `Produit — ${target.name} (${target.reference})`;
    case "categories":   return "Toutes les catégories";
    case "category":     return `Catégorie — ${target.name}`;
    case "collections":  return "Toutes les collections";
    case "collection":   return `Collection — ${target.name}`;
    case "about":        return "Qui sommes-nous";
    case "contact":      return "Nous contacter";
    case "custom":       return `Lien personnalisé — ${target.url.trim()}`;
  }
}
