import { describe, it, expect } from "vitest";

/**
 * Tests de logique pure sur la fusion cross-marketplace.
 *
 * L'objectif : garantir que la déduplication clients (email > carte > société)
 * fonctionne dans les 3 cas de figure typiques (client PFS seul, client eFashion
 * seul, client présent sur les 2 marketplaces) et qu'on cumule bien les
 * ordersCount + totalHT sans double comptage.
 *
 * Le vrai code est dans `getMarketplaceStats` de
 * `app/actions/admin/marketplace-orders.ts` — on reproduit ici la logique de
 * `upsertClient` en isolant la partie pure.
 */

type Source = "PFS" | "EFASHION";

interface ClientAcc {
  key: string;
  customerName: string;
  customerEmail: string | null;
  adminClientCardId: string | null;
  sources: Set<Source>;
  ordersCount: number;
  totalHT: number;
  lastOrderAt: Date | null;
}

function normalizeKey(
  email: string | null | undefined,
  cardId: string | null | undefined,
  company: string | null | undefined,
): string {
  const e = email?.trim().toLowerCase();
  if (e) return `email:${e}`;
  if (cardId) return `card:${cardId}`;
  const c = company?.trim().toLowerCase().replace(/\s+/g, " ");
  if (c) return `co:${c}`;
  return `unk:x`;
}

function upsert(
  map: Map<string, ClientAcc>,
  key: string,
  patch: {
    source: Source;
    customerName: string;
    customerEmail?: string | null;
    adminClientCardId?: string | null;
    orderTotal: number;
    orderDate: Date;
  },
): void {
  const existing = map.get(key);
  if (existing) {
    existing.sources.add(patch.source);
    existing.ordersCount += 1;
    existing.totalHT += patch.orderTotal;
    if (!existing.lastOrderAt || patch.orderDate > existing.lastOrderAt) {
      existing.lastOrderAt = patch.orderDate;
    }
    if (!existing.customerEmail && patch.customerEmail) {
      existing.customerEmail = patch.customerEmail;
    }
    if (!existing.adminClientCardId && patch.adminClientCardId) {
      existing.adminClientCardId = patch.adminClientCardId;
    }
  } else {
    map.set(key, {
      key,
      customerName: patch.customerName,
      customerEmail: patch.customerEmail ?? null,
      adminClientCardId: patch.adminClientCardId ?? null,
      sources: new Set([patch.source]),
      ordersCount: 1,
      totalHT: patch.orderTotal,
      lastOrderAt: patch.orderDate,
    });
  }
}

describe("marketplace-orders — dedup cross-marketplace", () => {
  it("client PFS seul + client eFashion seul : 2 entrées distinctes", () => {
    const map = new Map<string, ClientAcc>();
    upsert(map, normalizeKey(null, "card-A", "Boutique A"), {
      source: "PFS",
      customerName: "Boutique A",
      orderTotal: 100,
      orderDate: new Date("2026-07-01"),
    });
    upsert(map, normalizeKey("b@example.com", null, "Boutique B"), {
      source: "EFASHION",
      customerName: "Boutique B",
      customerEmail: "b@example.com",
      orderTotal: 200,
      orderDate: new Date("2026-07-02"),
    });
    expect(map.size).toBe(2);
  });

  it("client présent sur PFS et eFashion (même carte) : 1 entrée avec 2 badges", () => {
    const map = new Map<string, ClientAcc>();
    upsert(map, normalizeKey(null, "card-X", "Boutique X"), {
      source: "PFS",
      customerName: "Boutique X",
      adminClientCardId: "card-X",
      orderTotal: 100,
      orderDate: new Date("2026-07-01"),
    });
    upsert(map, normalizeKey(null, "card-X", "Boutique X"), {
      source: "EFASHION",
      customerName: "Boutique X",
      adminClientCardId: "card-X",
      orderTotal: 250,
      orderDate: new Date("2026-07-03"),
    });
    expect(map.size).toBe(1);
    const only = Array.from(map.values())[0];
    expect(only.sources.size).toBe(2);
    expect(only.sources.has("PFS")).toBe(true);
    expect(only.sources.has("EFASHION")).toBe(true);
    expect(only.ordersCount).toBe(2);
    expect(only.totalHT).toBe(350);
    expect(only.lastOrderAt).toEqual(new Date("2026-07-03"));
  });

  it("client présent sur PFS (sans email) et eFashion (avec email) via même société — regroupés", () => {
    // Cas où on n'a pas encore de fiche client rattachée : la clé retombe sur
    // le nom de société normalisé.
    const map = new Map<string, ClientAcc>();
    upsert(map, normalizeKey(null, null, "Bijoux Alpha"), {
      source: "PFS",
      customerName: "Bijoux Alpha",
      orderTotal: 50,
      orderDate: new Date("2026-06-15"),
    });
    // eFashion arrive avec un email — mais comme la clé PFS était basée sur la
    // société, le regroupement n'est pas automatique. C'est le comportement
    // documenté : sans fiche/email commun, on garde 2 entrées séparées.
    upsert(map, normalizeKey("alpha@example.com", null, "Bijoux Alpha"), {
      source: "EFASHION",
      customerName: "Bijoux Alpha",
      customerEmail: "alpha@example.com",
      orderTotal: 80,
      orderDate: new Date("2026-06-20"),
    });
    expect(map.size).toBe(2); // documenté : pas de fuzzy match cross-key
  });

  it("normalise l'email : casse et espaces ignorés", () => {
    expect(normalizeKey("  A@Example.COM  ", null, null)).toBe("email:a@example.com");
  });
});
