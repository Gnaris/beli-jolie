/**
 * Bulk sync marketplace — normalisation des options via validateEnqueueInput.
 *
 * Bug 2026-09-05 : le handler bulk (`handleBulkMarketplaceSync` dans
 * AdminProductsTable.tsx) construisait un `options` incomplet — champ
 * `orderchamp` absent — puis posait `options[marketplace] = true` seulement
 * pour PFS/Ankor/eFashion/Faire. Résultat : quand la cliente cliquait
 * « Synchroniser Orderchamp » depuis la barre d'action bulk, le payload
 * contenait `options.orderchamp = undefined`, `validateEnqueueInput` le
 * normalisait en `false`, et le worker `runOrderchampJob` skippait
 * silencieusement (SUCCEEDED sans envoyer à OC → prix jamais mis à jour).
 *
 * Fix : construire l'objet options complet (les 6 marketplaces + local) et
 * poser `options[marketplace] = true` de façon uniforme. Ce test verrouille
 * le contrat côté serveur : pour chaque marketplace ciblée, l'option
 * correspondante doit remonter à true après validation.
 */
import { describe, it, expect } from "vitest";
import { validateEnqueueInput } from "@/lib/marketplace-queue-serializer";

type Marketplace = "pfs" | "ankorstore" | "efashion" | "faire" | "orderchamp" | "microstore";

function buildBulkPayload(marketplace: Marketplace) {
  // Miroir de ce que produit désormais `handleBulkMarketplaceSync` après fix.
  const options = {
    local: false,
    pfs: false,
    ankorstore: false,
    efashion: false,
    faire: false,
    orderchamp: false,
    microstore: false,
  };
  options[marketplace] = true;
  return {
    productId: "p1",
    reference: "REF1",
    productName: "Produit test",
    firstImage: null,
    options,
    mode: "resync" as const,
    marketplace,
  };
}

describe("validateEnqueueInput — bulk sync options", () => {
  it("pour chaque marketplace ciblée, options[marketplace] doit être true après validation", () => {
    const marketplaces: Marketplace[] = ["pfs", "ankorstore", "efashion", "faire", "orderchamp", "microstore"];
    for (const mp of marketplaces) {
      const payload = buildBulkPayload(mp);
      const res = validateEnqueueInput([payload]);
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      const opts = res.items[0]!.options;
      expect(opts[mp]).toBe(true);
    }
  });

  it("regression bulk Orderchamp : `orderchamp: true` doit survivre à la validation", () => {
    // Reproduit précisément l'input envoyé par la barre d'action bulk après
    // fix. Sans le fix, le champ orderchamp était absent → normalisé à false
    // par validateEnqueueInput → job skippé silencieusement côté worker.
    const res = validateEnqueueInput([buildBulkPayload("orderchamp")]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.items[0]!.options.orderchamp).toBe(true);
    // Les autres marketplaces doivent rester à false.
    expect(res.items[0]!.options.pfs).toBe(false);
    expect(res.items[0]!.options.ankorstore).toBe(false);
    expect(res.items[0]!.options.efashion).toBe(false);
    expect(res.items[0]!.options.faire).toBe(false);
    expect(res.items[0]!.options.microstore).toBe(false);
  });

  it("garde-fou : un payload sans clé orderchamp (avant fix) ferait basculer options.orderchamp à false", () => {
    // Ce test documente le comportement historique qui a causé le bug —
    // il doit continuer à passer (validateEnqueueInput normalise undefined
    // en false), ce qui prouve pourquoi le handler bulk DOIT poser
    // orderchamp explicitement.
    const res = validateEnqueueInput([
      {
        productId: "p1",
        reference: "REF",
        productName: "Test",
        options: { local: false, pfs: false, ankorstore: false, efashion: false, faire: false },
        mode: "resync",
        marketplace: "orderchamp",
      },
    ]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // Confirme que sans le fix, options.orderchamp serait false → worker skip.
    expect(res.items[0]!.options.orderchamp).toBe(false);
  });
});
