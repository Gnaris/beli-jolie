import { describe, it, expect, vi } from "vitest";

import { efashionListByReferenceBaseExact } from "@/lib/efashion-api";
import type { EfashionProductListItem } from "@/lib/efashion-api";

function makeItem(overrides: Partial<EfashionProductListItem>): EfashionProductListItem {
  return {
    id_produit: 0,
    id_vendeur: 2017,
    reference: "A11-DORÉ",
    reference_base: "A11",
    marque: null,
    id_vendeur_marque: 3228,
    collection: null,
    id_collection: null,
    categorie: null,
    id_categorie: null,
    prix: 3.5,
    prixReduit: null,
    poids: 0.05,
    visible: true,
    supprimer: false,
    id_couleur: 78,
    couleur: "Doré",
    stock_value: 100,
    stock_renseigne: true,
    vendu_par: "couleurs",
    id_pack: null,
    id_declinaison: 13334,
    id_provenance: null,
    provenance: null,
    nb_photos: 1,
    id_shooting: null,
    main: false,
    ...overrides,
  } as EfashionProductListItem;
}

describe("efashionListByReferenceBaseExact", () => {
  it("ne filtre que les items dont reference_base correspond exactement (insensible casse/espaces)", async () => {
    const listFn = vi
      .fn()
      .mockResolvedValueOnce({
        items: [
          makeItem({ id_produit: 1, reference: "A1100-DORÉ", reference_base: "A1100" }),
          makeItem({ id_produit: 2, reference: "A11-DORÉ", reference_base: " a11 " }),
          makeItem({ id_produit: 3, reference: "A1134-DORÉ", reference_base: "A1134" }),
          makeItem({ id_produit: 4, reference: "A11-ARGENT", reference_base: "A11" }),
        ],
        total: 4,
      })
      .mockResolvedValueOnce({ items: [], total: 4 });

    const res = await efashionListByReferenceBaseExact({
      idVendeur: 2017,
      referenceBase: "A11",
      listFn,
    });

    expect(res.map((it) => it.id_produit).sort()).toEqual([2, 4]);
  });

  it("incrémente skip de PAGE_SIZE strict (curseur par chunk eFashion)", async () => {
    // Page 0 : 50 items inutiles (matches partiels). Pas de match exact.
    const page0 = Array.from({ length: 50 }, (_, i) =>
      makeItem({ id_produit: 1000 + i, reference_base: `A11${i}` }),
    );
    // Page 1 : encore des matches partiels (l'API renvoie + que take demandé).
    const page1 = Array.from({ length: 73 }, (_, i) =>
      makeItem({ id_produit: 2000 + i, reference_base: `A11X${i}` }),
    );
    // Page 2 : contient enfin A11 exact.
    const page2 = [
      makeItem({ id_produit: 2418489, reference: "A11-ARGENT", reference_base: "A11" }),
      makeItem({ id_produit: 2418490, reference: "A11-DORÉ", reference_base: "A11" }),
    ];

    const listFn = vi
      .fn()
      .mockResolvedValueOnce({ items: page0, total: 200 })
      .mockResolvedValueOnce({ items: page1, total: 200 })
      .mockResolvedValueOnce({ items: page2, total: 200 })
      .mockResolvedValueOnce({ items: [], total: 200 });

    const res = await efashionListByReferenceBaseExact({
      idVendeur: 2017,
      referenceBase: "A11",
      listFn,
    });

    expect(res.map((it) => it.id_produit).sort()).toEqual([2418489, 2418490]);
    expect(listFn).toHaveBeenCalledTimes(4);
    expect(listFn.mock.calls[0][0].skip).toBe(0);
    expect(listFn.mock.calls[1][0].skip).toBe(50);
    expect(listFn.mock.calls[2][0].skip).toBe(100);
    expect(listFn.mock.calls[3][0].skip).toBe(150);
  });

  it("court-circuite la pagination dès qu'une page n'apporte plus de nouveau match exact", async () => {
    const page0 = [
      makeItem({ id_produit: 2418489, reference: "A11-ARGENT", reference_base: "A11" }),
      makeItem({ id_produit: 9001, reference_base: "A1100" }),
    ];
    const page1Partials = Array.from({ length: 30 }, (_, i) =>
      makeItem({ id_produit: 3000 + i, reference_base: `A11X${i}` }),
    );
    const listFn = vi
      .fn()
      .mockResolvedValueOnce({ items: page0, total: 100 })
      .mockResolvedValueOnce({ items: page1Partials, total: 100 });

    const res = await efashionListByReferenceBaseExact({
      idVendeur: 2017,
      referenceBase: "A11",
      listFn,
    });

    expect(res.map((it) => it.id_produit)).toEqual([2418489]);
    expect(listFn).toHaveBeenCalledTimes(2); // s'arrête après page 1 vide en matches exacts
  });

  it("arrête tout de suite quand la première page revient vide", async () => {
    const listFn = vi.fn().mockResolvedValueOnce({ items: [], total: 0 });

    const res = await efashionListByReferenceBaseExact({
      idVendeur: 2017,
      referenceBase: "A11",
      listFn,
    });

    expect(res).toEqual([]);
    expect(listFn).toHaveBeenCalledTimes(1);
  });

  it("respecte la borne dure maxPages pour éviter une boucle infinie", async () => {
    const listFn = vi.fn().mockImplementation(async () => ({
      items: [makeItem({ id_produit: Math.random(), reference_base: "A1100" })],
      total: 100,
    }));

    await efashionListByReferenceBaseExact({
      idVendeur: 2017,
      referenceBase: "A11",
      listFn,
      // On désactive le bailout no-match pour tester spécifiquement maxPages.
      noMatchBailoutPages: 1000,
      maxPages: 5,
    });

    expect(listFn).toHaveBeenCalledTimes(5);
  });

  it("abandonne après NO_MATCH_BAILOUT_PAGES pages sans aucun match exact", async () => {
    // Régression : sans ce garde-fou, une référence inexistante côté eFashion
    // (ou un filtre `reference` trop élargi côté API) faisait scanner jusqu'à
    // 30 pages × 50 items = 1500 fiches en séquentiel, plusieurs secondes.
    // Avec le bailout par défaut = 3, on ne fait plus que 3 appels max.
    const listFn = vi.fn().mockImplementation(async () => ({
      items: Array.from({ length: 50 }, (_, i) =>
        makeItem({ id_produit: Math.random(), reference_base: `A1100${i}` }),
      ),
      total: 5000,
    }));

    const res = await efashionListByReferenceBaseExact({
      idVendeur: 2017,
      referenceBase: "A11",
      listFn,
    });

    expect(res).toEqual([]);
    expect(listFn).toHaveBeenCalledTimes(3);
  });

  it("noMatchBailoutPages est configurable (bailout à 2 → 2 appels max sans exact)", async () => {
    const listFn = vi.fn().mockImplementation(async () => ({
      items: [makeItem({ reference_base: "A1100" })],
      total: 100,
    }));

    await efashionListByReferenceBaseExact({
      idVendeur: 2017,
      referenceBase: "A11",
      listFn,
      noMatchBailoutPages: 2,
    });

    expect(listFn).toHaveBeenCalledTimes(2);
  });

  it("le bailout no-match ne coupe pas la pagination quand un exact a déjà été trouvé", async () => {
    // Cas où on trouve 1 exact page 0, puis une longue série de non-exacts.
    // Le bailout doit être neutre : c'est la règle « exacts>0 + page sans nouveau exact »
    // qui doit gérer l'arrêt.
    const page0 = [
      makeItem({ id_produit: 111, reference_base: "A11" }),
      makeItem({ id_produit: 999, reference_base: "A1100" }),
    ];
    const page1PartialsOnly = Array.from({ length: 30 }, (_, i) =>
      makeItem({ id_produit: 3000 + i, reference_base: `A11X${i}` }),
    );
    const listFn = vi
      .fn()
      .mockResolvedValueOnce({ items: page0, total: 100 })
      .mockResolvedValueOnce({ items: page1PartialsOnly, total: 100 });

    const res = await efashionListByReferenceBaseExact({
      idVendeur: 2017,
      referenceBase: "A11",
      listFn,
    });

    expect(res.map((it) => it.id_produit)).toEqual([111]);
    // 2 appels : trouve exact page 0, page 1 sans nouveau exact → arrêt.
    expect(listFn).toHaveBeenCalledTimes(2);
  });

  it("transmet le premelFilter et la pageSize voulus à l'API", async () => {
    const listFn = vi.fn().mockResolvedValueOnce({ items: [], total: 0 });

    await efashionListByReferenceBaseExact({
      idVendeur: 4242,
      referenceBase: "Z99",
      premelFilter: "en_ligne",
      pageSize: 100,
      listFn,
    });

    expect(listFn).toHaveBeenCalledWith({
      idVendeur: 4242,
      take: 100,
      skip: 0,
      reference: "Z99",
      premelFilter: "en_ligne",
    });
  });
});
