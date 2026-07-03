import { describe, it, expect } from "vitest";
import {
  computeMarketplaceCounts,
  isMarketplaceAvailable,
  type BulkBarProduct,
} from "@/components/admin/products/BulkActionBar";

// Aide à construire des produits fictifs sans avoir à répéter les 15 champs.
function mkProduct(overrides: Partial<BulkBarProduct>): BulkBarProduct {
  return {
    id:                     overrides.id ?? "prod-x",
    reference:              overrides.reference ?? "REF-X",
    name:                   overrides.name ?? "Produit fictif",
    status:                 overrides.status ?? "ONLINE",
    isIncomplete:           overrides.isIncomplete ?? false,
    locked:                 overrides.locked ?? false,
    firstImage:             overrides.firstImage ?? null,
    pfsProductId:           overrides.pfsProductId ?? null,
    ankorsProductId:        overrides.ankorsProductId ?? null,
    efashionReferenceBase:  overrides.efashionReferenceBase ?? null,
    faireProductId:         overrides.faireProductId ?? null,
    pfsSyncRequired:        overrides.pfsSyncRequired ?? false,
    ankorsSyncRequired:     overrides.ankorsSyncRequired ?? false,
    efashionSyncRequired:   overrides.efashionSyncRequired ?? false,
    faireSyncRequired:      overrides.faireSyncRequired ?? false,
  };
}

describe("computeMarketplaceCounts — panneau Marketplaces dynamique", () => {
  it("compte 'à publier' = identifiant marketplace null + statut ONLINE + non incomplet", () => {
    const products = [
      mkProduct({ id: "1", status: "ONLINE", pfsProductId: null }),
      mkProduct({ id: "2", status: "ONLINE", pfsProductId: "pfs-42" }), // déjà publié
      mkProduct({ id: "3", status: "OFFLINE", pfsProductId: null }),    // brouillon exclu
      mkProduct({ id: "4", status: "ARCHIVED", pfsProductId: null }),   // archivé exclu
      mkProduct({ id: "5", status: "ONLINE", pfsProductId: null, isIncomplete: true }), // incomplet exclu
    ];
    const counts = computeMarketplaceCounts(products);
    expect(counts.pfs.publish.map((p) => p.id)).toEqual(["1"]);
  });

  it("compte 'à synchroniser' = drapeau *SyncRequired = true, indépendamment du statut", () => {
    const products = [
      mkProduct({ id: "1", pfsSyncRequired: true, status: "ONLINE" }),
      mkProduct({ id: "2", pfsSyncRequired: true, status: "OFFLINE" }), // même en brouillon
      mkProduct({ id: "3", pfsSyncRequired: false }),
    ];
    const counts = computeMarketplaceCounts(products);
    expect(counts.pfs.sync.map((p) => p.id).sort()).toEqual(["1", "2"]);
  });

  it("distingue correctement les 4 marketplaces (chaque champ a son propre compteur)", () => {
    // Chaque produit est "totalement publié partout" par défaut : on n'ouvre que
    // le canal testé pour éviter les faux positifs dus au default null.
    const alreadyPublished = { pfsProductId: "x", ankorsProductId: "x", efashionReferenceBase: "x", faireProductId: "x" };
    const products = [
      mkProduct({ id: "1", ...alreadyPublished, pfsProductId: null }),           // PFS: à publier
      mkProduct({ id: "2", ...alreadyPublished, ankorsSyncRequired: true }),     // ANK: à synchro
      mkProduct({ id: "3", ...alreadyPublished, efashionReferenceBase: null }),  // eFA: à publier
      mkProduct({ id: "4", ...alreadyPublished, faireSyncRequired: true }),      // Faire: à synchro
    ];
    const counts = computeMarketplaceCounts(products);
    expect(counts.pfs.publish.map((p) => p.id)).toEqual(["1"]);
    expect(counts.pfs.sync).toHaveLength(0);
    expect(counts.ankorstore.sync.map((p) => p.id)).toEqual(["2"]);
    expect(counts.ankorstore.publish).toHaveLength(0);
    expect(counts.efashion.publish.map((p) => p.id)).toEqual(["3"]);
    expect(counts.efashion.sync).toHaveLength(0);
    expect(counts.faire.sync.map((p) => p.id)).toEqual(["4"]);
    expect(counts.faire.publish).toHaveLength(0);
  });

  it("retourne 0 pour tout marketplace quand la sélection est vide", () => {
    const counts = computeMarketplaceCounts([]);
    expect(counts.pfs.publish).toHaveLength(0);
    expect(counts.pfs.sync).toHaveLength(0);
    expect(counts.ankorstore.publish).toHaveLength(0);
    expect(counts.efashion.sync).toHaveLength(0);
    expect(counts.faire.publish).toHaveLength(0);
  });

  it("retire les produits déjà en cours de publication sur la marketplace ciblée", () => {
    const products = [
      mkProduct({ id: "1", status: "ONLINE", ankorsProductId: null }),
      mkProduct({ id: "2", status: "ONLINE", ankorsProductId: null }),
    ];
    // "1" a une op Ankorstore active (publication en cours) → ne doit plus
    // apparaître dans "à publier". "2" reste éligible.
    const inFlight = { ankorstore: new Set(["1"]) };
    const counts = computeMarketplaceCounts(products, inFlight);
    expect(counts.ankorstore.publish.map((p) => p.id)).toEqual(["2"]);
  });

  it("retire les produits déjà en cours de synchronisation sur la marketplace ciblée", () => {
    const products = [
      mkProduct({ id: "1", pfsSyncRequired: true }),
      mkProduct({ id: "2", pfsSyncRequired: true }),
    ];
    const inFlight = { pfs: new Set(["2"]) };
    const counts = computeMarketplaceCounts(products, inFlight);
    expect(counts.pfs.sync.map((p) => p.id)).toEqual(["1"]);
  });

  it("le filtre in-flight est cloisonné par marketplace (op PFS ne masque pas Ankorstore)", () => {
    const p = mkProduct({
      id: "1",
      status: "ONLINE",
      pfsProductId: null,
      ankorsProductId: null,
    });
    // Op PFS active seulement → PFS masqué mais Ankorstore toujours proposé.
    const counts = computeMarketplaceCounts([p], { pfs: new Set(["1"]) });
    expect(counts.pfs.publish).toHaveLength(0);
    expect(counts.ankorstore.publish.map((x) => x.id)).toEqual(["1"]);
  });
});

describe("isMarketplaceAvailable — visibilité des cartes selon config", () => {
  const configured = {
    pfs: { available: true },
    ankorstore: { configured: true, enabled: true },
    efashion: { configured: true, enabled: true },
    faire: { configured: true, enabled: true },
  };

  it("PFS suit le flag available (pas de kill-switch séparé)", () => {
    expect(isMarketplaceAvailable("pfs", configured)).toBe(true);
    expect(isMarketplaceAvailable("pfs", { ...configured, pfs: { available: false } })).toBe(false);
  });

  it("Ankorstore/eFashion/Faire nécessitent configured ET enabled", () => {
    expect(isMarketplaceAvailable("ankorstore", configured)).toBe(true);
    expect(isMarketplaceAvailable("ankorstore", { ...configured, ankorstore: { configured: false, enabled: true } })).toBe(false);
    expect(isMarketplaceAvailable("ankorstore", { ...configured, ankorstore: { configured: true, enabled: false } })).toBe(false);

    expect(isMarketplaceAvailable("efashion", { ...configured, efashion: { configured: true, enabled: false } })).toBe(false);
    expect(isMarketplaceAvailable("faire", { ...configured, faire: { configured: false, enabled: false } })).toBe(false);
  });
});
