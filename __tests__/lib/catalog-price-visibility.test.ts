import { describe, it, expect } from "vitest";
import type { Session } from "next-auth";
import { resolveCatalogShowPrices } from "@/lib/catalog-price-visibility";

// Helpers pour construire des sessions minimales.
function anonymous(): null {
  return null;
}
function approved(): Session {
  // Le type Session.user contient d'autres champs mais le helper ne lit que
  // role + status, on caste largement pour rester lisible.
  return { user: { id: "u1", role: "CLIENT", status: "APPROVED" } } as unknown as Session;
}
function pending(): Session {
  return { user: { id: "u2", role: "CLIENT", status: "PENDING" } } as unknown as Session;
}
function admin(): Session {
  return { user: { id: "u3", role: "ADMIN", status: "APPROVED" } } as unknown as Session;
}

describe("resolveCatalogShowPrices", () => {
  it("SHOW : prix visibles pour tout le monde (même anonymes)", () => {
    expect(resolveCatalogShowPrices("SHOW", anonymous())).toBe(true);
    expect(resolveCatalogShowPrices("SHOW", pending())).toBe(true);
    expect(resolveCatalogShowPrices("SHOW", approved())).toBe(true);
    expect(resolveCatalogShowPrices("SHOW", admin())).toBe(true);
  });

  it("HIDE : prix cachés pour tout le monde (même ADMIN et clients validés)", () => {
    expect(resolveCatalogShowPrices("HIDE", anonymous())).toBe(false);
    expect(resolveCatalogShowPrices("HIDE", pending())).toBe(false);
    expect(resolveCatalogShowPrices("HIDE", approved())).toBe(false);
    expect(resolveCatalogShowPrices("HIDE", admin())).toBe(false);
  });

  it("CONNECTED_ONLY : ADMIN et clients APPROVED voient, autres non", () => {
    expect(resolveCatalogShowPrices("CONNECTED_ONLY", anonymous())).toBe(false);
    expect(resolveCatalogShowPrices("CONNECTED_ONLY", pending())).toBe(false);
    expect(resolveCatalogShowPrices("CONNECTED_ONLY", approved())).toBe(true);
    expect(resolveCatalogShowPrices("CONNECTED_ONLY", admin())).toBe(true);
  });
});
