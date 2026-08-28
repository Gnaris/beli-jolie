// Regroupe les changements de statut en attente (posés via badge unitaire
// dans le tableau produits admin) par statut cible, en filtrant les entrées
// devenues inutiles : produit disparu ou déjà au statut demandé.
//
// Utilisé par `AdminProductsTable` pour :
//   1. Calculer combien d'actions vont réellement être envoyées au serveur.
//   2. Appeler `bulkUpdateProductStatus` une seule fois par statut cible
//      (ONLINE / OFFLINE / ARCHIVED), avec un seul code OTP pour l'ensemble
//      des archivages.

export type PendingStatusTarget = "ONLINE" | "OFFLINE" | "ARCHIVED";

export type PendingStatusGroupingProduct = {
  id: string;
  status: "OFFLINE" | "ONLINE" | "ARCHIVED" | "SYNCING";
};

export type PendingStatusGroups = {
  ONLINE: string[];
  OFFLINE: string[];
  ARCHIVED: string[];
};

export function groupPendingStatuses(
  products: readonly PendingStatusGroupingProduct[],
  pendingStatuses: Readonly<Record<string, PendingStatusTarget>>,
): PendingStatusGroups {
  const groups: PendingStatusGroups = { ONLINE: [], OFFLINE: [], ARCHIVED: [] };
  for (const [id, target] of Object.entries(pendingStatuses)) {
    const p = products.find((x) => x.id === id);
    if (!p) continue;
    if (p.status === target) continue;
    groups[target].push(id);
  }
  return groups;
}

export function countPendingStatusChanges(groups: PendingStatusGroups): number {
  return groups.ONLINE.length + groups.OFFLINE.length + groups.ARCHIVED.length;
}
