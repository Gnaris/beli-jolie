import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  signCatalogContext,
  verifyCatalogContext,
  CATALOG_CONTEXT_TTL_MS,
} from "@/lib/catalog-context-cookie";

const ORIGINAL_SECRET = process.env.NEXTAUTH_SECRET;

beforeAll(() => {
  process.env.NEXTAUTH_SECRET = "test-secret-for-catalog-context-cookie-unit-tests";
});

afterAll(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.NEXTAUTH_SECRET;
  else process.env.NEXTAUTH_SECRET = ORIGINAL_SECRET;
});

describe("catalog-context-cookie", () => {
  it("round-trip : signCatalogContext puis verifyCatalogContext retourne l'id", () => {
    const signed = signCatalogContext("cat_abc123");
    expect(verifyCatalogContext(signed)).toBe("cat_abc123");
  });

  it("null / vide retourne null", () => {
    expect(verifyCatalogContext(null)).toBeNull();
    expect(verifyCatalogContext(undefined)).toBeNull();
    expect(verifyCatalogContext("")).toBeNull();
  });

  it("payload sans signature (pas de point) rejeté", () => {
    expect(verifyCatalogContext("not-a-signed-cookie")).toBeNull();
  });

  it("signature altérée : rejeté même si le payload est bon", () => {
    const signed = signCatalogContext("cat_target");
    // Flip le dernier caractère de la signature.
    const tampered =
      signed.slice(0, -1) + (signed[signed.length - 1] === "A" ? "B" : "A");
    expect(verifyCatalogContext(tampered)).toBeNull();
  });

  it("payload altéré : la signature ne matche plus, rejeté", () => {
    const signed = signCatalogContext("cat_target");
    const dot = signed.indexOf(".");
    // On garde la signature originale mais on remplace le payload par un
    // autre payload base64url — la vérification doit refuser.
    const fakePayload = Buffer.from(
      JSON.stringify({ catalogId: "cat_pirate", exp: Date.now() + 60_000 }),
      "utf8",
    )
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const tampered = `${fakePayload}.${signed.slice(dot + 1)}`;
    expect(verifyCatalogContext(tampered)).toBeNull();
  });

  it("cookie expiré : rejeté même si signature valide", () => {
    // On signe avec une date passée : exp = now - TTL - 1min → toujours expiré.
    const past = Date.now() - CATALOG_CONTEXT_TTL_MS - 60_000;
    const signed = signCatalogContext("cat_stale", past);
    expect(verifyCatalogContext(signed)).toBeNull();
  });

  it("cookie signé avec un autre secret : rejeté", () => {
    const signed = signCatalogContext("cat_x");
    // Change le secret entre signature et vérification.
    const previous = process.env.NEXTAUTH_SECRET;
    process.env.NEXTAUTH_SECRET = "un-tout-autre-secret";
    try {
      expect(verifyCatalogContext(signed)).toBeNull();
    } finally {
      process.env.NEXTAUTH_SECRET = previous;
    }
  });
});
