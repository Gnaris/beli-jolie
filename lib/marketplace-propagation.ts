/**
 * lib/marketplace-propagation.ts
 *
 * Helpers pour construire les entrées de la file marketplace quand on veut
 * "propager" une modification (stock, prix, statut…) vers plusieurs
 * marketplaces à la fois. Utilisé par la modale unifiée ardoise (via
 * `useRefreshMarketplacePrompt().ask()`).
 */

export interface MarketplaceCandidate {
  id: string;
  reference: string;
  name: string;
  firstImage: string | null;
}

export interface MarketplaceCandidates {
  pfs: MarketplaceCandidate[];
  ankorstore: MarketplaceCandidate[];
  efashion: MarketplaceCandidate[];
  faire: MarketplaceCandidate[];
  orderchamp: MarketplaceCandidate[];
}

export interface MarketplacePropagateOptions {
  pfs?: boolean;
  ankorstore?: boolean;
  efashion?: boolean;
  faire?: boolean;
  orderchamp?: boolean;
}

export interface MarketplaceEnqueueInput {
  productId: string;
  reference: string;
  productName: string;
  firstImage: string | null;
  options: {
    local: boolean;
    pfs: boolean;
    ankorstore?: boolean;
    efashion?: boolean;
    faire?: boolean;
    orderchamp?: boolean;
  };
  mode: "publish" | "refresh" | "resync";
  marketplace: "pfs" | "ankorstore" | "efashion" | "faire" | "orderchamp";
}

/**
 * Retourne l'union des IDs uniques des candidates (pour passer à la modale).
 */
export function allCandidateIds(c: MarketplaceCandidates): string[] {
  return Array.from(
    new Set([
      ...c.pfs.map((p) => p.id),
      ...c.ankorstore.map((p) => p.id),
      ...c.efashion.map((p) => p.id),
      ...c.faire.map((p) => p.id),
      ...c.orderchamp.map((p) => p.id),
    ]),
  );
}

/**
 * true si au moins 1 candidat existe.
 */
export function hasAnyCandidate(c: MarketplaceCandidates): boolean {
  return (
    c.pfs.length + c.ankorstore.length + c.efashion.length + c.faire.length + c.orderchamp.length > 0
  );
}

/**
 * Construit les entrées de file en filtrant par les options cochées dans
 * la modale. mode = "publish" par défaut (pour les propagations classiques).
 */
export function buildMarketplaceInputs(
  candidates: MarketplaceCandidates,
  options: MarketplacePropagateOptions,
  mode: "publish" | "refresh" | "resync" = "publish",
): MarketplaceEnqueueInput[] {
  const inputs: MarketplaceEnqueueInput[] = [];
  if (options.pfs) {
    for (const p of candidates.pfs) {
      inputs.push({
        productId: p.id,
        reference: p.reference,
        productName: p.name,
        firstImage: p.firstImage,
        options: { local: false, pfs: true, ankorstore: false, efashion: false, faire: false },
        mode,
        marketplace: "pfs",
      });
    }
  }
  if (options.ankorstore) {
    for (const p of candidates.ankorstore) {
      inputs.push({
        productId: p.id,
        reference: p.reference,
        productName: p.name,
        firstImage: p.firstImage,
        options: { local: false, pfs: false, ankorstore: true, efashion: false, faire: false },
        mode,
        marketplace: "ankorstore",
      });
    }
  }
  if (options.efashion) {
    for (const p of candidates.efashion) {
      inputs.push({
        productId: p.id,
        reference: p.reference,
        productName: p.name,
        firstImage: p.firstImage,
        options: { local: false, pfs: false, ankorstore: false, efashion: true, faire: false },
        mode,
        marketplace: "efashion",
      });
    }
  }
  if (options.faire) {
    for (const p of candidates.faire) {
      inputs.push({
        productId: p.id,
        reference: p.reference,
        productName: p.name,
        firstImage: p.firstImage,
        options: {
          local: false,
          pfs: false,
          ankorstore: false,
          efashion: false,
          faire: true,
        },
        mode,
        marketplace: "faire",
      });
    }
  }
  if (options.orderchamp) {
    for (const p of candidates.orderchamp) {
      inputs.push({
        productId: p.id,
        reference: p.reference,
        productName: p.name,
        firstImage: p.firstImage,
        options: {
          local: false,
          pfs: false,
          ankorstore: false,
          efashion: false,
          faire: false,
          orderchamp: true,
        },
        mode,
        marketplace: "orderchamp",
      });
    }
  }
  return inputs;
}
