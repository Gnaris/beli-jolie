/**
 * Métadonnées des onglets Paramètres — pour le hero et le breadcrumb.
 *
 * Une source unique évite d'écrire trois fois la même chaîne (nav, hero,
 * breadcrumb) et permet à Vitest de valider la couverture (aucun tab
 * connu sans libellé).
 */

export const SETTINGS_TABS = [
  "general", "societe", "catalogue", "carrousels", "stock", "maintenance",
  "livraison", "paiement", "marketplaces", "horaires", "traduction", "seo",
  "messagerie", "affichage",
] as const;

export type SettingsTab = (typeof SETTINGS_TABS)[number];

type Metadata = { label: string; description: string };

const METADATA: Record<SettingsTab, Metadata> = {
  general:     { label: "Général",       description: "Bandeau d'annonces, bannière d'accueil, favicon, commande minimum et mot de passe admin." },
  societe:     { label: "Société",       description: "Informations légales et coordonnées de votre boutique — utilisées sur les factures, l'expédition et les mentions légales." },
  catalogue:   { label: "Catalogue",     description: "Ordre d'apparition des blocs (catégories, collections, tags) sur la page /produits et garde-fou de rafraîchissement." },
  carrousels:  { label: "Carrousels",    description: "Bandes de produits défilantes sur la page d'accueil — réorganisez-les et choisissez lesquelles montrer." },
  stock:       { label: "Stock",         description: "Ce que voient vos clients lorsqu'une variante ou un produit est en rupture." },
  maintenance: { label: "Maintenance",   description: "Bloque temporairement l'accès à votre boutique pour effectuer des travaux ou en cas d'incident." },
  livraison:   { label: "Livraison",     description: "Intégration Easy-Express pour créer les bordereaux et marge appliquée aux frais de port refacturés au client." },
  paiement:    { label: "Paiement",      description: "Clés Stripe pour encaisser les paiements par carte bancaire — chiffrées en base et modifiables à tout moment." },
  marketplaces:{ label: "Marketplaces",  description: "Connectez et pilotez PFS, Ankorstore, eFashion et Faire — prix, marges, publications." },
  horaires:    { label: "Horaires",      description: "Jours et heures d'ouverture affichés sur la page contact et utilisés pour l'assistance client." },
  traduction:  { label: "Traduction",    description: "Traduction automatique français → anglais des noms de produits, descriptions et attributs (via votre compte PFS)." },
  seo:         { label: "Référencement", description: "Textes descriptifs utilisés par Google pour comprendre votre site et bien vous référencer." },
  messagerie:  { label: "Messagerie",    description: "Notifications par mail des messages non lus dans votre boîte pro." },
  affichage:   { label: "Affichage",     description: "Choisissez le mode clair ou sombre pour l'ensemble des pages d'administration." },
};

export function settingsTabMetadata(tab: SettingsTab): Metadata {
  return METADATA[tab];
}

export function isSettingsTab(x: string): x is SettingsTab {
  return (SETTINGS_TABS as readonly string[]).includes(x);
}
