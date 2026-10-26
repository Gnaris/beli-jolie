/**
 * Tests pour canonicalHostRedirect() — 301 www.<domaine> → <domaine>.
 *
 * Contexte (Search Console, oct. 2026) : le site répondait aussi sur
 * www.beliandjolie.com avec une balise canonical en www → tout le catalogue
 * existait en double. On redirige www vers le domaine nu uniquement si les 2
 * pointent vers la même boutique.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("next-intl/middleware", () => ({
  default: () => () => ({ headers: new Map() }),
}));
vi.mock("next-auth/jwt", () => ({ getToken: vi.fn() }));
vi.mock("@/i18n/routing", () => ({
  routing: { locales: ["fr", "en"], defaultLocale: "fr" },
}));

import { canonicalHostRedirect } from "@/middleware";

const BJ = { id: "tenant-bj" };
const OTHER = { id: "tenant-other" };
const UNKNOWN = { unknown: true as const };

describe("canonicalHostRedirect", () => {
  it("redirige www vers le domaine nu quand les 2 sont la même boutique", () => {
    expect(canonicalHostRedirect("www.beliandjolie.com", BJ, BJ)).toBe("beliandjolie.com");
  });

  it("ne redirige pas un domaine déjà sans www", () => {
    expect(canonicalHostRedirect("beliandjolie.com", BJ, BJ)).toBeNull();
  });

  it("ne redirige pas si le domaine nu n'est pas enregistré", () => {
    expect(canonicalHostRedirect("www.beliandjolie.com", BJ, UNKNOWN)).toBeNull();
  });

  it("ne redirige pas si www n'est pas enregistré", () => {
    expect(canonicalHostRedirect("www.beliandjolie.com", UNKNOWN, BJ)).toBeNull();
  });

  it("ne redirige pas si www et domaine nu sont 2 boutiques différentes", () => {
    expect(canonicalHostRedirect("www.exemple.fr", BJ, OTHER)).toBeNull();
  });
});
