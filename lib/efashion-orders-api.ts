/**
 * eFashion Paris — API commandes (lecture seule)
 *
 * Wrappers GraphQL typés pour l'endpoint `wapi.efashion-paris.com/graphql` :
 *   - query `commandes(page, limit, filters)`   → liste paginée
 *   - query `commandeById(id: Int!)`            → détail complet
 *   - query `commandeEtiquettes(idCommande)`    → tracking + URL PDF
 *   - query `countriesFromOrders`               → référentiel pays pour filtres
 *   - GET   `/api/invoices/{id}`                → PDF facture
 *
 * Découvert via HAR le 2026-07-23. Réutilise le cookie jar et l'authent partagés
 * avec le reste du client eFashion (voir `lib/efashion-client.ts` + `lib/efashion-auth.ts`).
 */

import { efashionFetch, efashionGraphql } from "@/lib/efashion-client";
import { ensureEfashionSession, invalidateEfashionSession } from "@/lib/efashion-auth";
import { EfashionOrderStatus } from "@prisma/client";

/**
 * Wrapper qui garantit une session eFashion active + retry unique en cas de
 * cookie expiré côté serveur. Utilisé par tous les endpoints commandes.
 *
 * Sans ce filet, un worker qui tourne pendant plus de 30 min (ou après un
 * redémarrage PM2 avec un cache session vidé) retourne « eFashion GraphQL:
 * Unauthorized » sur le 1ᵉʳ appel.
 */
async function withEfashionSession<T>(fn: () => Promise<T>): Promise<T> {
  await ensureEfashionSession();
  try {
    return await fn();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Le serveur eFashion répond soit HTTP 401 (unauthorized) soit "Unauthorized"
    // en GraphQL error message. Dans les 2 cas on invalide la session et on
    // retente une fois — évite de renvoyer une erreur à la cliente juste parce
    // que le cookie a expiré silencieusement.
    if (/unauthori[sz]ed|401/i.test(msg)) {
      await invalidateEfashionSession();
      await ensureEfashionSession();
      return fn();
    }
    throw err;
  }
}

// ─────────────────────────────────────────────
// Types — réponse LIST (query `commandes`)
// ─────────────────────────────────────────────

export interface EfashionListOrderRow {
  id_commande: string; // "10618644"
  id_commande_name: string; // "F5647C490444A158967V2017"
  id_commande_groupe: number;
  montantTotal: number;
  montantApresRemise: number;
  montantRuptureHT: number;
  montantCA: number;
  acheteur: { nomSociete: string | null } | null;
  isPremiereCommande: boolean;
  nb_colis: number;
  statut: number; // 2, 8, ...
  id_livraison: number | null;
  dateCreation: string; // ISO "2026-07-22T12:20:47.000Z"
  dateCommande: string;
  dateExpedition: string | null;
  commandeStatut: {
    id_statut: string;
    statut_fr: string;
  } | null;
  livraison: { libelle: string | null } | null;
  commandeGroupe: {
    id_commande_groupe: string;
    groupage: number;
    date_creation: string;
    date_expedition: string | null;
  } | null;
}

export interface EfashionListOrdersResponse {
  commandes: {
    data: EfashionListOrderRow[];
    total: number;
    page: number;
    limit: number;
  };
}

// ─────────────────────────────────────────────
// Types — réponse DÉTAIL (query `commandeById`)
// ─────────────────────────────────────────────

export interface EfashionOrderAddress {
  id_adresse: string;
  adresse: string | null;
  codePostal: string | null;
  ville: string | null;
  telephone: string | null;
  mobile: string | null;
  NomContact: string | null;
  Societe: string | null;
  pays: {
    id_pays: string;
    code: string;
    texte_fr: string;
    is_cee: boolean;
  } | null;
}

export interface EfashionOrderLine {
  id_ligne: number;
  id_commande: number;
  id_produit: number;
  id_couleur: number | null;
  quantite_pack: number;
  corbeille: number;
  quantites: Record<string, number>; // { q1..q12 }
  prixLigne: number;
  reference: string; // "A257-BLANC"
  reference_base: string; // "A257"
  prix: number;
  prixReduit: number | null;
  poids_produit: number | null;
  poids: number | null;
  vendu_par: string | null; // "couleurs" | "unitaire"
  id_vendeur: number;
  couleur_FR: string | null;
  couleur_EN: string | null;
  couleur_UK: string | null;
  declinaisons: Record<string, string | null> | null; // { d1_FR..d12_FR, d1_UK..d12_UK }
  quantite_total: number;
  imageUrl: string | null;
  categorie: string | null;
  categorie_en: string | null;
  id_categorie: number | null;
  provenance_code: string | null;
}

export interface EfashionOrderDetail {
  id_commande: string;
  id_commande_name: string;
  id_commande_groupe: number;
  montantTotal: number;
  montantApresRemise: number;
  montantCA: number;
  poids: number | null;
  nb_colis: number;
  statut: number;
  Commentaires: string | null;
  data: string | null; // JSON stringifié avec dimensions colis
  id_adresse_livraison: number | null;
  id_adresse_facturation: number | null;
  acheteur: {
    id_acheteur: string;
    nomContact: string | null;
    prenomContact: string | null;
    email: string | null;
    nomSociete: string | null;
    tva_intra: string | null;
    eori: string | null;
    active_tva: number;
    data: string | null;
  } | null;
  livraison: {
    id_livraison: string;
    libelle: string | null;
    commentaires: string | null;
    telephone: string | null;
    email: string | null;
    site_web: string | null;
  } | null;
  paiement: {
    id_paiement: string;
    texte_fr: string | null;
  } | null;
  commandeGroupe: {
    id_commande_groupe: string;
    id_commande_groupe_name: string;
    groupage: number;
    data: string | null;
    date_creation: string;
    frais_port_src: number | null;
    frais_port: number | null;
  } | null;
  groupageReadiness: { countReady: number; countTotal: number } | null;
  parcelScanInfo: {
    expectedCount: number;
    scannedCount: number;
    scannedTrackingNumbers: Array<{
      tracking: string;
      parcelNumber: string;
      carrierTrackingNumber: string | null;
      carrierId: number | null;
      scannedAt: string | null;
    }>;
  } | null;
  pickupColisInfo: {
    id_colis_pickup: string;
    nb_colis: number;
    nom_reception: string | null;
    date_creation: string;
  } | null;
  dateCommande: string;
  dateCreation: string;
  dateExpedition: string | null;
  adresseLivraison: EfashionOrderAddress | null;
  adresseFacturation: EfashionOrderAddress | null;
  lignes: EfashionOrderLine[];
  remises: Array<{
    id_commande_remise: string;
    id_commande: number;
    id_remise: number | null;
    libelle: string | null;
    typeRemise: string | null;
    auteur: string | null;
    type: string | null;
    montant: number;
    isFraisPort: boolean;
  }>;
  optionClient: unknown;
  needsCustomsDeclaration: boolean;
}

export interface EfashionOrderEtiquette {
  id_commande_etiquette: string;
  id_commande: number;
  tracking_number: string;
  etiquette: string; // URL PDF
  id_livraison: number;
}

// ─────────────────────────────────────────────
// Requêtes GraphQL — extraites du HAR eFashion
// ─────────────────────────────────────────────

const LIST_QUERY = /* GraphQL */ `
  query ($page: Int, $limit: Int, $filters: CommandeFiltersInput) {
    commandes(page: $page, limit: $limit, filters: $filters) {
      data {
        id_commande
        id_commande_name
        id_commande_groupe
        montantTotal
        montantApresRemise
        montantRuptureHT
        montantCA
        acheteur { nomSociete }
        isPremiereCommande
        nb_colis
        statut
        id_livraison
        dateCreation
        dateCommande
        dateExpedition
        commandeStatut { id_statut statut_fr }
        livraison { libelle }
        commandeGroupe {
          id_commande_groupe
          groupage
          date_creation
          date_expedition
        }
      }
      total
      page
      limit
    }
  }
`;

const DETAIL_QUERY = /* GraphQL */ `
  query GetOrderDetail($id: Int!) {
    commandeById(id: $id) {
      id_commande
      id_commande_name
      id_commande_groupe
      montantTotal
      montantApresRemise
      montantCA
      poids
      nb_colis
      statut
      Commentaires
      data
      id_adresse_livraison
      id_adresse_facturation
      acheteur {
        id_acheteur nomContact prenomContact email nomSociete
        tva_intra eori active_tva data
      }
      livraison {
        id_livraison libelle commentaires telephone email site_web
      }
      paiement { id_paiement texte_fr }
      commandeGroupe {
        id_commande_groupe id_commande_groupe_name groupage data
        date_creation frais_port_src frais_port
      }
      groupageReadiness { countReady countTotal }
      parcelScanInfo {
        expectedCount scannedCount
        scannedTrackingNumbers {
          tracking parcelNumber carrierTrackingNumber carrierId scannedAt
        }
      }
      pickupColisInfo {
        id_colis_pickup nb_colis nom_reception date_creation
      }
      dateCommande dateCreation dateExpedition
      adresseLivraison {
        id_adresse adresse codePostal ville telephone mobile NomContact Societe
        pays { id_pays code texte_fr is_cee }
      }
      adresseFacturation {
        id_adresse adresse codePostal ville telephone mobile NomContact Societe
        pays { id_pays code texte_fr is_cee }
      }
      lignes {
        id_ligne id_commande id_produit id_couleur
        quantite_pack corbeille
        quantites {
          q1 q2 q3 q4 q5 q6 q7 q8 q9 q10 q11 q12
        }
        prixLigne reference reference_base prix prixReduit
        poids_produit poids vendu_par id_vendeur
        couleur_FR couleur_EN couleur_UK
        declinaisons {
          d1_FR d2_FR d3_FR d4_FR d5_FR d6_FR d7_FR d8_FR d9_FR d10_FR d11_FR d12_FR
          d1_UK d2_UK d3_UK d4_UK d5_UK d6_UK d7_UK d8_UK d9_UK d10_UK d11_UK d12_UK
        }
        quantite_total imageUrl categorie categorie_en id_categorie provenance_code
      }
      remises {
        id_commande_remise id_commande id_remise libelle
        typeRemise auteur type montant isFraisPort
      }
      optionClient
      needsCustomsDeclaration
    }
  }
`;

const ETIQUETTES_QUERY = /* GraphQL */ `
  query GetOrderLabels($id: Int!) {
    commandeEtiquettes(idCommande: $id) {
      id_commande_etiquette
      id_commande
      tracking_number
      etiquette
      id_livraison
    }
  }
`;

// ─────────────────────────────────────────────
// Endpoints
// ─────────────────────────────────────────────

export interface EfashionListOrdersOptions {
  page: number;
  limit?: number;
  filters?: Record<string, unknown>;
}

/** GraphQL `commandes(page, limit, filters)` — liste paginée (défaut 25/page côté UI eFashion). */
export async function efashionListOrders(
  opts: EfashionListOrdersOptions,
): Promise<EfashionListOrdersResponse["commandes"]> {
  return withEfashionSession(async () => {
    const data = await efashionGraphql<EfashionListOrdersResponse>(LIST_QUERY, {
      page: opts.page,
      limit: opts.limit ?? 50,
      filters: opts.filters ?? {},
    });
    return data.commandes;
  });
}

/** GraphQL `commandeById(id)` — détail complet (adresses, lignes, groupage). */
export async function efashionGetOrderDetail(
  orderId: number | string,
): Promise<EfashionOrderDetail> {
  const id = typeof orderId === "string" ? parseInt(orderId, 10) : orderId;
  return withEfashionSession(async () => {
    const data = await efashionGraphql<{ commandeById: EfashionOrderDetail }>(
      DETAIL_QUERY,
      { id },
    );
    return data.commandeById;
  });
}

/** GraphQL `commandeEtiquettes(idCommande)` — numéros de suivi + URL PDF étiquette. */
export async function efashionGetOrderEtiquettes(
  orderId: number | string,
): Promise<EfashionOrderEtiquette[]> {
  const id = typeof orderId === "string" ? parseInt(orderId, 10) : orderId;
  return withEfashionSession(async () => {
    const data = await efashionGraphql<{ commandeEtiquettes: EfashionOrderEtiquette[] }>(
      ETIQUETTES_QUERY,
      { id },
    );
    return data.commandeEtiquettes ?? [];
  });
}

/** GET `/api/invoices/{id}` — télécharge le PDF facture. Retourne le buffer brut. */
export async function efashionGetInvoicePdf(orderId: number | string): Promise<ArrayBuffer> {
  const id = typeof orderId === "string" ? parseInt(orderId, 10) : orderId;
  return withEfashionSession(async () => {
    const res = await efashionFetch(`/api/invoices/${id}`, { method: "GET" });
    if (!res.ok) {
      throw new Error(`eFashion invoice HTTP ${res.status}`);
    }
    return res.arrayBuffer();
  });
}

// ─────────────────────────────────────────────
// Helpers de normalisation
// ─────────────────────────────────────────────

/**
 * Statut brut eFashion (id numérique + libellé FR) → notre enum normalisé.
 *
 * Deux entrées : l'id numérique quand il est connu (mapping stable côté API)
 * et, en filet de sécurité, le libellé FR (« Confirmé », « Expédiée »…) qui
 * dépanne quand un statutId inconnu apparaît. Le libellé prime sur l'id si
 * les deux sont fournis, parce que les libellés sont plus stables dans le
 * temps que les ids internes eFashion.
 *
 * Correspondance observée (HAR + retours cliente 2026-07-23) :
 *   1  = En attente / brouillon                → NEW
 *   2  = Commande expédiée                     → SHIPPED
 *   3  = Annulée                               → CANCELLED
 *   ?  = « Confirmé » / « Confirmée »          → VALIDATED
 *   ?  = « Prête à expédier », « Préparation » → VALIDATED (pré-expédition)
 *   8  = Pickup colis effectué                 → SHIPPED
 *
 * Fallback prudent : tout ce qui n'est pas explicitement expédié, annulé ou
 * validé → NEW, pour ne pas déclencher la déduction stock par erreur.
 */
export function normalizeEfashionStatus(
  statutId: number,
  statutLabelFr?: string | null,
): EfashionOrderStatus {
  // Libellé prioritaire — plus stable que l'id numérique.
  // Ordre des regex important : SHIPPED avant VALIDATED, sinon « Pret pour
  // pickup colis » matcherait à la fois "pickup" et "pret" (piège observé).
  // La règle SHIPPED exige explicitement « expédié » ou « (pickup|colis) effectué ».
  const label = (statutLabelFr ?? "").trim().toLowerCase();
  if (label) {
    if (/annul/.test(label)) return EfashionOrderStatus.CANCELLED;
    if (/exp[éeè]d|(pickup|colis) effectu/.test(label)) return EfashionOrderStatus.SHIPPED;
    // VALIDATED = état de pré-expédition (confirmé, en préparation, prêt à partir)
    if (/confirm|pr[ée]par|pr[êe]t/.test(label)) return EfashionOrderStatus.VALIDATED;
    if (/attente|nouvelle|brouillon/.test(label)) return EfashionOrderStatus.NEW;
  }
  // Fallback sur l'id numérique
  switch (statutId) {
    case 2:
    case 8:
      return EfashionOrderStatus.SHIPPED;
    case 3:
      return EfashionOrderStatus.CANCELLED;
    default:
      return EfashionOrderStatus.NEW;
  }
}

/** Somme des `quantites.q1..q12` d'une ligne (souvent égal à quantite_total, mais pas garanti). */
export function sumLineQuantities(qs: Record<string, number> | null | undefined): number {
  if (!qs) return 0;
  let s = 0;
  for (let i = 1; i <= 12; i++) {
    const v = qs[`q${i}`];
    if (typeof v === "number") s += v;
  }
  return s;
}
