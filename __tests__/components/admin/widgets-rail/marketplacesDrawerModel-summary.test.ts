import { describe, it, expect } from "vitest";
import {
  groupItemsByProductAndMode,
  partitionGroupsForSummary,
  summarizeGroupsPerMarketplace,
  SUMMARY_THRESHOLD,
} from "@/components/admin/widgets-rail/marketplacesDrawerModel";
import type {
  MarketplaceRefreshItem,
  MarketplaceTarget,
  QueueItemMode,
  QueueItemStatus,
  TargetOutcome,
} from "@/components/admin/products/MarketplaceRefreshContext";

function mkItem(overrides: Partial<MarketplaceRefreshItem>): MarketplaceRefreshItem {
  const marketplace: MarketplaceTarget = overrides.marketplace ?? "faire";
  const mode: QueueItemMode = overrides.mode ?? "refresh";
  const status: QueueItemStatus = overrides.status ?? "done";
  return {
    id: overrides.id ?? "job-" + Math.random().toString(36).slice(2, 8),
    productId: overrides.productId ?? "p1",
    reference: overrides.reference ?? "REF-1",
    productName: overrides.productName ?? "Produit test",
    firstImage: overrides.firstImage ?? null,
    options: overrides.options ?? { local: false, faire: true },
    mode,
    marketplace,
    status,
    pfsOutcome: overrides.pfsOutcome,
    ankorsOutcome: overrides.ankorsOutcome,
    efashionOutcome: overrides.efashionOutcome,
    faireOutcome: overrides.faireOutcome,
    completedAt: overrides.completedAt,
    scheduledFor: overrides.scheduledFor,
  };
}

const ok: TargetOutcome = { ok: true };
const err = (message: string): TargetOutcome => ({
  ok: false,
  kind: "error",
  message,
});

describe("SUMMARY_THRESHOLD", () => {
  it("expose une constante numérique cohérente (bascule vue résumée)", () => {
    // On fige la valeur : la doc utilisatrice mentionne « au-delà de 20 ».
    // Si on veut la changer, le test doit être mis à jour explicitement.
    expect(SUMMARY_THRESHOLD).toBe(20);
  });
});

describe("summarizeGroupsPerMarketplace", () => {
  it("retourne un tableau vide quand il n'y a aucun groupe", () => {
    expect(summarizeGroupsPerMarketplace([])).toEqual([]);
  });

  it("ignore les marketplaces non ciblées (total=0 → exclues)", () => {
    // 1 produit ciblant uniquement Faire → seul Faire apparaît dans le résumé.
    const groups = groupItemsByProductAndMode([
      mkItem({ productId: "p1", marketplace: "faire", faireOutcome: ok }),
    ]);
    const summaries = summarizeGroupsPerMarketplace(groups);
    expect(summaries).toHaveLength(1);
    expect(summaries[0].target).toBe("faire");
    expect(summaries[0].done).toBe(1);
    expect(summaries[0].total).toBe(1);
  });

  it("agrège correctement done / active / queued / errors par marketplace", () => {
    // 4 produits distincts sur Faire : 2 done, 1 active, 1 en erreur.
    const groups = groupItemsByProductAndMode([
      mkItem({ productId: "p1", marketplace: "faire", faireOutcome: ok }),
      mkItem({ productId: "p2", marketplace: "faire", faireOutcome: ok }),
      mkItem({
        productId: "p3",
        marketplace: "faire",
        status: "in_progress",
      }),
      mkItem({
        productId: "p4",
        marketplace: "faire",
        faireOutcome: err("prix manquant"),
      }),
    ]);
    const summaries = summarizeGroupsPerMarketplace(groups);
    expect(summaries).toHaveLength(1);
    const faire = summaries[0];
    expect(faire.target).toBe("faire");
    expect(faire.total).toBe(4);
    expect(faire.done).toBe(2);
    expect(faire.active).toBe(1);
    expect(faire.errors).toBe(1);
    expect(faire.queued).toBe(0);
  });

  it("compte séparément chaque marketplace ciblée dans un même produit", () => {
    // 1 produit ciblant PFS+Ankor : PFS done, Ankor erreur.
    const groups = groupItemsByProductAndMode([
      mkItem({ productId: "p1", marketplace: "pfs", pfsOutcome: ok }),
      mkItem({
        productId: "p1",
        marketplace: "ankorstore",
        ankorsOutcome: err("timeout"),
      }),
    ]);
    const summaries = summarizeGroupsPerMarketplace(groups);
    // Ordre canonique : pfs avant ankorstore.
    expect(summaries.map((s) => s.target)).toEqual(["pfs", "ankorstore"]);
    expect(summaries[0].done).toBe(1);
    expect(summaries[1].errors).toBe(1);
  });

  it("respecte l'ordre canonique MARKETPLACE_ORDER dans la sortie", () => {
    // On mélange volontairement l'ordre d'entrée.
    const groups = groupItemsByProductAndMode([
      mkItem({ productId: "p1", marketplace: "microstore" }),
      mkItem({ productId: "p2", marketplace: "pfs" }),
      mkItem({ productId: "p3", marketplace: "faire" }),
    ]);
    const summaries = summarizeGroupsPerMarketplace(groups);
    expect(summaries.map((s) => s.target)).toEqual(["pfs", "faire", "microstore"]);
  });

  it("gère un volume au-dessus du seuil (500 produits Faire) sans doublons", () => {
    // Scénario réel : push massif de 500 produits sur Faire.
    const items: MarketplaceRefreshItem[] = [];
    for (let i = 0; i < 500; i += 1) {
      const outcome: TargetOutcome = i % 25 === 0 ? err("prix manquant") : ok;
      items.push(
        mkItem({
          productId: `p${i}`,
          marketplace: "faire",
          faireOutcome: outcome,
        }),
      );
    }
    const groups = groupItemsByProductAndMode(items);
    const summaries = summarizeGroupsPerMarketplace(groups);
    expect(summaries).toHaveLength(1);
    const faire = summaries[0];
    expect(faire.total).toBe(500);
    expect(faire.errors).toBe(20); // 500 / 25 = 20 échecs
    expect(faire.done).toBe(480);
    expect(faire.done + faire.errors).toBe(faire.total);
  });
});

describe("partitionGroupsForSummary", () => {
  it("sépare les erreurs des autres groupes", () => {
    const groups = groupItemsByProductAndMode([
      mkItem({ productId: "p1", marketplace: "faire", faireOutcome: ok }),
      mkItem({
        productId: "p2",
        marketplace: "faire",
        faireOutcome: err("timeout"),
      }),
      mkItem({ productId: "p3", marketplace: "faire", status: "in_progress" }),
    ]);
    const { errorGroups, aggregatedGroups } = partitionGroupsForSummary(groups);
    expect(errorGroups.map((g) => g.productId)).toEqual(["p2"]);
    expect(aggregatedGroups.map((g) => g.productId).sort()).toEqual(["p1", "p3"]);
  });

  it("retourne 2 tableaux vides quand l'entrée est vide", () => {
    expect(partitionGroupsForSummary([])).toEqual({
      errorGroups: [],
      aggregatedGroups: [],
    });
  });

  it("classe tous les groupes en agrégés si aucun n'est en erreur", () => {
    const groups = groupItemsByProductAndMode([
      mkItem({ productId: "p1", marketplace: "faire", faireOutcome: ok }),
      mkItem({ productId: "p2", marketplace: "faire", faireOutcome: ok }),
    ]);
    const { errorGroups, aggregatedGroups } = partitionGroupsForSummary(groups);
    expect(errorGroups).toEqual([]);
    expect(aggregatedGroups).toHaveLength(2);
  });

  it("classe tous les groupes en erreurs si aucun n'est ok/actif", () => {
    const groups = groupItemsByProductAndMode([
      mkItem({
        productId: "p1",
        marketplace: "faire",
        faireOutcome: err("timeout"),
      }),
      mkItem({
        productId: "p2",
        marketplace: "faire",
        faireOutcome: err("400"),
      }),
    ]);
    const { errorGroups, aggregatedGroups } = partitionGroupsForSummary(groups);
    expect(errorGroups).toHaveLength(2);
    expect(aggregatedGroups).toEqual([]);
  });
});
