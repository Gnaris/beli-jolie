import { describe, it, expect } from "vitest";
import {
  countPendingStatusChanges,
  groupPendingStatuses,
  type PendingStatusGroupingProduct,
} from "@/lib/pending-status-grouping";

const products: PendingStatusGroupingProduct[] = [
  { id: "p1", status: "OFFLINE" },
  { id: "p2", status: "ONLINE" },
  { id: "p3", status: "OFFLINE" },
  { id: "p4", status: "ARCHIVED" },
];

describe("groupPendingStatuses", () => {
  it("groupe chaque produit selon son statut cible", () => {
    const groups = groupPendingStatuses(products, {
      p1: "ONLINE",
      p2: "OFFLINE",
      p3: "ARCHIVED",
    });
    expect(groups.ONLINE).toEqual(["p1"]);
    expect(groups.OFFLINE).toEqual(["p2"]);
    expect(groups.ARCHIVED).toEqual(["p3"]);
  });

  it("ignore les entrées dont le statut cible est déjà appliqué", () => {
    const groups = groupPendingStatuses(products, {
      // p1 est déjà OFFLINE → à ignorer (aucun changement réel)
      p1: "OFFLINE",
      p2: "OFFLINE",
    });
    expect(groups.OFFLINE).toEqual(["p2"]);
    expect(groups.ONLINE).toEqual([]);
    expect(groups.ARCHIVED).toEqual([]);
  });

  it("ignore les entrées dont le produit n'est plus dans la liste", () => {
    const groups = groupPendingStatuses(products, {
      "ghost-id": "ONLINE",
      p2: "OFFLINE",
    });
    expect(groups.OFFLINE).toEqual(["p2"]);
    expect(groups.ONLINE).toEqual([]);
  });

  it("renvoie tous les groupes vides quand rien n'est en attente", () => {
    const groups = groupPendingStatuses(products, {});
    expect(groups).toEqual({ ONLINE: [], OFFLINE: [], ARCHIVED: [] });
  });
});

describe("countPendingStatusChanges", () => {
  it("compte le total réellement applicable", () => {
    const groups = groupPendingStatuses(products, {
      p1: "ONLINE",
      p2: "OFFLINE",
      p3: "ARCHIVED",
      p4: "ARCHIVED", // déjà ARCHIVED → ignoré
    });
    expect(countPendingStatusChanges(groups)).toBe(3);
  });

  it("renvoie 0 quand rien ne change vraiment", () => {
    const groups = groupPendingStatuses(products, { p1: "OFFLINE", p2: "ONLINE" });
    expect(countPendingStatusChanges(groups)).toBe(0);
  });
});
