/**
 * Tests unitaires de `lib/min-order.ts` : lecture de la config SiteConfig,
 * résolution du seuil applicable selon le mode + la 1ʳᵉ commande, et helper
 * `getEffectiveMinOrderHT` qui combine les deux.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const prismaMock: any = {
  siteConfig: {
    findMany: vi.fn(),
  },
  order: {
    count: vi.fn(),
  },
  user: {
    findUnique: vi.fn(),
  },
};
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

const {
  readMinOrderConfig,
  resolveMinOrderForCounters,
  isFirstOrderForUser,
  getEffectiveMinOrderHT,
  getEffectiveMinOrder,
  isMinOrderMode,
} = await import("@/lib/min-order");

beforeEach(() => {
  prismaMock.siteConfig.findMany.mockReset();
  prismaMock.order.count.mockReset();
  prismaMock.user.findUnique.mockReset();
  // Défaut : pas d'override client. Tests dédiés ré-écrasent ce mock.
  prismaMock.user.findUnique.mockResolvedValue({
    minimumOrderOverrideHt: null,
  });
});

function siteConfigRows(rows: Record<string, string>): { key: string; value: string }[] {
  return Object.entries(rows).map(([key, value]) => ({ key, value }));
}

describe("isMinOrderMode", () => {
  it("accepte les 4 modes valides", () => {
    expect(isMinOrderMode("none")).toBe(true);
    expect(isMinOrderMode("all")).toBe(true);
    expect(isMinOrderMode("first_only")).toBe(true);
    expect(isMinOrderMode("first_then_rest")).toBe(true);
  });

  it("refuse les autres valeurs", () => {
    expect(isMinOrderMode("")).toBe(false);
    expect(isMinOrderMode("ALL")).toBe(false);
    expect(isMinOrderMode(null)).toBe(false);
    expect(isMinOrderMode(undefined)).toBe(false);
    expect(isMinOrderMode(42)).toBe(false);
  });
});

describe("readMinOrderConfig — compat legacy", () => {
  it("aucune clé en base → mode 'none' + montants à 0", async () => {
    prismaMock.siteConfig.findMany.mockResolvedValue([]);
    const cfg = await readMinOrderConfig();
    expect(cfg).toEqual({ mode: "none", valueAll: 0, valueFirst: 0, valueRest: 0 });
  });

  it("min_order_ht > 0 sans min_order_mode → fallback mode 'all'", async () => {
    prismaMock.siteConfig.findMany.mockResolvedValue(
      siteConfigRows({ min_order_ht: "250" }),
    );
    const cfg = await readMinOrderConfig();
    expect(cfg.mode).toBe("all");
    expect(cfg.valueAll).toBe(250);
  });

  it("min_order_mode explicite l'emporte sur le fallback legacy", async () => {
    prismaMock.siteConfig.findMany.mockResolvedValue(
      siteConfigRows({
        min_order_mode: "first_then_rest",
        min_order_ht: "0",
        min_order_ht_first: "300",
        min_order_ht_rest: "150",
      }),
    );
    const cfg = await readMinOrderConfig();
    expect(cfg).toEqual({
      mode: "first_then_rest",
      valueAll: 0,
      valueFirst: 300,
      valueRest: 150,
    });
  });

  it("valeurs invalides / négatives → 0 (ignore silencieusement)", async () => {
    prismaMock.siteConfig.findMany.mockResolvedValue(
      siteConfigRows({
        min_order_mode: "all",
        min_order_ht: "-50",
        min_order_ht_first: "abc",
      }),
    );
    const cfg = await readMinOrderConfig();
    expect(cfg.mode).toBe("all");
    expect(cfg.valueAll).toBe(0);
    expect(cfg.valueFirst).toBe(0);
  });
});

describe("resolveMinOrderForCounters", () => {
  it("mode 'none' → 0 quoi qu'il arrive", () => {
    const cfg = { mode: "none" as const, valueAll: 500, valueFirst: 300, valueRest: 100 };
    expect(resolveMinOrderForCounters(cfg, true)).toBe(0);
    expect(resolveMinOrderForCounters(cfg, false)).toBe(0);
  });

  it("mode 'all' → toujours valueAll", () => {
    const cfg = { mode: "all" as const, valueAll: 500, valueFirst: 0, valueRest: 0 };
    expect(resolveMinOrderForCounters(cfg, true)).toBe(500);
    expect(resolveMinOrderForCounters(cfg, false)).toBe(500);
  });

  it("mode 'first_only' → valueFirst sur 1ʳᵉ commande, 0 ensuite", () => {
    const cfg = { mode: "first_only" as const, valueAll: 0, valueFirst: 300, valueRest: 0 };
    expect(resolveMinOrderForCounters(cfg, true)).toBe(300);
    expect(resolveMinOrderForCounters(cfg, false)).toBe(0);
  });

  it("mode 'first_then_rest' → valueFirst puis valueRest", () => {
    const cfg = { mode: "first_then_rest" as const, valueAll: 0, valueFirst: 300, valueRest: 150 };
    expect(resolveMinOrderForCounters(cfg, true)).toBe(300);
    expect(resolveMinOrderForCounters(cfg, false)).toBe(150);
  });
});

describe("isFirstOrderForUser", () => {
  it("compte les commandes non-annulées du client", async () => {
    prismaMock.order.count.mockResolvedValue(0);
    const first = await isFirstOrderForUser("u-1");
    expect(first).toBe(true);
    expect(prismaMock.order.count).toHaveBeenCalledWith({
      where: { userId: "u-1", status: { not: "CANCELLED" } },
    });
  });

  it("client avec au moins une commande → pas la 1ʳᵉ", async () => {
    prismaMock.order.count.mockResolvedValue(3);
    expect(await isFirstOrderForUser("u-1")).toBe(false);
  });
});

describe("getEffectiveMinOrderHT", () => {
  it("mode 'none' → 0 sans requête commande", async () => {
    prismaMock.siteConfig.findMany.mockResolvedValue([]);
    const min = await getEffectiveMinOrderHT("u-1");
    expect(min).toBe(0);
    expect(prismaMock.order.count).not.toHaveBeenCalled();
  });

  it("mode 'all' → valueAll sans requête commande", async () => {
    prismaMock.siteConfig.findMany.mockResolvedValue(
      siteConfigRows({ min_order_mode: "all", min_order_ht: "200" }),
    );
    const min = await getEffectiveMinOrderHT("u-1");
    expect(min).toBe(200);
    expect(prismaMock.order.count).not.toHaveBeenCalled();
  });

  it("visiteur non connecté (userId=null) → renvoie valueFirst (pire cas)", async () => {
    prismaMock.siteConfig.findMany.mockResolvedValue(
      siteConfigRows({
        min_order_mode: "first_then_rest",
        min_order_ht_first: "300",
        min_order_ht_rest: "100",
      }),
    );
    const min = await getEffectiveMinOrderHT(null);
    expect(min).toBe(300);
    expect(prismaMock.order.count).not.toHaveBeenCalled();
  });

  it("mode 'first_only' — 1ʳᵉ commande → seuil first", async () => {
    prismaMock.siteConfig.findMany.mockResolvedValue(
      siteConfigRows({ min_order_mode: "first_only", min_order_ht_first: "250" }),
    );
    prismaMock.order.count.mockResolvedValue(0);
    expect(await getEffectiveMinOrderHT("u-1")).toBe(250);
  });

  it("mode 'first_only' — 2ᵉ commande → 0", async () => {
    prismaMock.siteConfig.findMany.mockResolvedValue(
      siteConfigRows({ min_order_mode: "first_only", min_order_ht_first: "250" }),
    );
    prismaMock.order.count.mockResolvedValue(1);
    expect(await getEffectiveMinOrderHT("u-1")).toBe(0);
  });

  it("mode 'first_then_rest' — 1ʳᵉ vs suivantes", async () => {
    prismaMock.siteConfig.findMany.mockResolvedValue(
      siteConfigRows({
        min_order_mode: "first_then_rest",
        min_order_ht_first: "300",
        min_order_ht_rest: "100",
      }),
    );
    prismaMock.order.count.mockResolvedValueOnce(0);
    expect(await getEffectiveMinOrderHT("u-1")).toBe(300);
    prismaMock.order.count.mockResolvedValueOnce(2);
    expect(await getEffectiveMinOrderHT("u-1")).toBe(100);
  });
});

describe("getEffectiveMinOrder — override client permanent", () => {
  it("override > 0 remplace le seuil global", async () => {
    prismaMock.siteConfig.findMany.mockResolvedValue(
      siteConfigRows({ min_order_mode: "all", min_order_ht: "200" }),
    );
    prismaMock.user.findUnique.mockResolvedValue({
      minimumOrderOverrideHt: 50,
    });
    const res = await getEffectiveMinOrder("u-1");
    expect(res).toEqual({ amountHT: 50, source: "override_client" });
  });

  it("override = 0 = client sans minimum (VIP), même si global > 0", async () => {
    prismaMock.siteConfig.findMany.mockResolvedValue(
      siteConfigRows({ min_order_mode: "all", min_order_ht: "200" }),
    );
    prismaMock.user.findUnique.mockResolvedValue({
      minimumOrderOverrideHt: 0,
    });
    const res = await getEffectiveMinOrder("u-1");
    expect(res).toEqual({ amountHT: 0, source: "override_zero" });
  });

  it("override null → on suit le global", async () => {
    prismaMock.siteConfig.findMany.mockResolvedValue(
      siteConfigRows({ min_order_mode: "all", min_order_ht: "200" }),
    );
    prismaMock.user.findUnique.mockResolvedValue({
      minimumOrderOverrideHt: null,
    });
    const res = await getEffectiveMinOrder("u-1");
    expect(res).toEqual({ amountHT: 200, source: "global_all" });
  });

  it("erreur BDD sur le lookup override → retombe silencieusement sur le global", async () => {
    prismaMock.siteConfig.findMany.mockResolvedValue(
      siteConfigRows({ min_order_mode: "all", min_order_ht: "150" }),
    );
    prismaMock.user.findUnique.mockRejectedValue(new Error("prisma column missing"));
    const res = await getEffectiveMinOrder("u-1");
    expect(res.amountHT).toBe(150);
    expect(res.source).toBe("global_all");
  });
});
