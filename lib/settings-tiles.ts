/**
 * Métadonnées des 12 tuiles de /admin/parametres (dashboard cockpit).
 *
 * Regroupe les 14 anciens onglets en 12 tuiles cliquables. Chaque tuile ouvre
 * une modale grand format contenant les cartes de réglage regroupées.
 *
 * Le mapping OLD_TAB_TO_TILE permet aux ~10 liens externes historiques
 * (`?tab=marketplaces` etc.) de continuer à ouvrir la bonne modale sans
 * casser aucun deep-link.
 */

export const SETTINGS_TILES = [
  "vitrine", "societe", "horaires",
  "paiement", "livraison", "regles",
  "marketplaces", "contenu",
  "messagerie", "traduction", "compte", "maintenance",
] as const;

export type SettingsTileKey = (typeof SETTINGS_TILES)[number];

export type TileAccent = "slate" | "sky" | "emerald" | "violet" | "rose" | "amber";

export type TileGroup = "boutique" | "ventes" | "canaux" | "outils";

export type TileStatus =
  | { tone: "ok"; label: string }
  | { tone: "warn"; label: string }
  | { tone: "off"; label: string }
  | { tone: "danger"; label: string };

export interface TileMeta {
  key: SettingsTileKey;
  title: string;
  description: string;
  group: TileGroup;
  accent: TileAccent;
  wide?: boolean;
}

const TILES: Record<SettingsTileKey, TileMeta> = {
  vitrine:      { key: "vitrine",      title: "Vitrine",              description: "Bannière d'accueil, bandeau d'annonces, favicon.",         group: "boutique", accent: "slate" },
  societe:      { key: "societe",      title: "Société & mentions",   description: "SIRET, TVA, adresse expéditeur — factures & légal.",       group: "boutique", accent: "slate" },
  horaires:     { key: "horaires",     title: "Horaires d'ouverture", description: "Affichés sur la page contact.",                            group: "boutique", accent: "sky" },
  paiement:     { key: "paiement",     title: "Paiement Stripe",      description: "Encaissement par carte bancaire.",                          group: "ventes",   accent: "emerald" },
  livraison:    { key: "livraison",    title: "Mode de livraison",    description: "Fournisseur d'expédition, bordereaux, marge sur les frais de port.", group: "ventes", accent: "emerald" },
  regles:       { key: "regles",       title: "Règles de vente",      description: "Commande mini, ruptures, ordre catalogue, badge photo.",   group: "ventes",   accent: "emerald" },
  marketplaces: { key: "marketplaces", title: "Marketplaces",         description: "PFS, Ankorstore, eFashion, Faire, Microstore.",            group: "canaux",   accent: "sky",    wide: true },
  contenu:      { key: "contenu",      title: "Contenu & Google",     description: "Carrousels d'accueil, textes SEO.",                        group: "canaux",   accent: "violet" },
  messagerie:   { key: "messagerie",   title: "Messagerie pro",       description: "Transfert Gmail, tuto Send-As, mot de passe boîte pro.",   group: "outils",   accent: "rose" },
  traduction:   { key: "traduction",   title: "Traduction auto",      description: "Fiches produit traduites FR → EN via PFS.",                group: "outils",   accent: "violet" },
  compte:       { key: "compte",       title: "Compte admin",         description: "Mot de passe admin, OTP actions sensibles, thème.",        group: "outils",   accent: "violet" },
  maintenance:  { key: "maintenance",  title: "Mode maintenance",     description: "Coupe temporairement l'accès à la boutique publique.",     group: "outils",   accent: "amber" },
};

export const GROUP_ORDER: { key: TileGroup; label: string; accent: TileAccent }[] = [
  { key: "boutique", label: "Votre boutique",       accent: "slate" },
  { key: "ventes",   label: "Vos ventes",           accent: "emerald" },
  { key: "canaux",   label: "Vos canaux de vente",  accent: "sky" },
  { key: "outils",   label: "Vos outils",           accent: "violet" },
];

export function getTileMeta(key: SettingsTileKey): TileMeta {
  return TILES[key];
}

export function isSettingsTile(x: string): x is SettingsTileKey {
  return (SETTINGS_TILES as readonly string[]).includes(x);
}

/**
 * Rétrocompat avec les ~10 liens historiques qui pointent vers
 * `/admin/parametres?tab=marketplaces` etc. Retourne la tuile à ouvrir
 * ou null si la valeur ne correspond à aucun ancien onglet connu.
 */
const OLD_TAB_TO_TILE: Record<string, SettingsTileKey> = {
  general:      "vitrine",
  societe:      "societe",
  catalogue:    "regles",
  carrousels:   "contenu",
  stock:        "regles",
  maintenance:  "maintenance",
  livraison:    "livraison",
  paiement:     "paiement",
  marketplaces: "marketplaces",
  horaires:     "horaires",
  traduction:   "traduction",
  seo:          "contenu",
  messagerie:   "messagerie",
  affichage:    "compte",
};

export function resolveOpenTile(searchParams: { open?: unknown; tab?: unknown }): SettingsTileKey | null {
  const rawOpen = typeof searchParams.open === "string" ? searchParams.open : "";
  if (rawOpen && isSettingsTile(rawOpen)) return rawOpen;

  const rawTab = typeof searchParams.tab === "string" ? searchParams.tab : "";
  if (rawTab && OLD_TAB_TO_TILE[rawTab]) return OLD_TAB_TO_TILE[rawTab];

  return null;
}
