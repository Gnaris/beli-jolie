import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  signCollectionContext,
  verifyCollectionContext,
  COLLECTION_CONTEXT_TTL_MS,
} from "@/lib/collection-context-cookie";

const ORIGINAL_SECRET = process.env.NEXTAUTH_SECRET;

beforeAll(() => {
  process.env.NEXTAUTH_SECRET = "test-secret-for-collection-context-cookie-unit-tests";
});

afterAll(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.NEXTAUTH_SECRET;
  else process.env.NEXTAUTH_SECRET = ORIGINAL_SECRET;
});

describe("collection-context-cookie", () => {
  it("round-trip : signCollectionContext puis verifyCollectionContext retourne l'id", () => {
    const signed = signCollectionContext("col_abc123");
    expect(verifyCollectionContext(signed)).toBe("col_abc123");
  });

  it("null / vide retourne null", () => {
    expect(verifyCollectionContext(null)).toBeNull();
    expect(verifyCollectionContext(undefined)).toBeNull();
    expect(verifyCollectionContext("")).toBeNull();
  });

  it("payload sans signature rejeté", () => {
    expect(verifyCollectionContext("not-a-signed-cookie")).toBeNull();
  });

  it("signature altérée : rejeté même si le payload est bon", () => {
    const signed = signCollectionContext("col_target");
    const tampered =
      signed.slice(0, -1) + (signed[signed.length - 1] === "A" ? "B" : "A");
    expect(verifyCollectionContext(tampered)).toBeNull();
  });

  it("payload altéré : la signature ne matche plus, rejeté", () => {
    const signed = signCollectionContext("col_target");
    const dot = signed.indexOf(".");
    const fakePayload = Buffer.from(
      JSON.stringify({ collectionId: "col_pirate", exp: Date.now() + 60_000 }),
      "utf8",
    )
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const tampered = `${fakePayload}.${signed.slice(dot + 1)}`;
    expect(verifyCollectionContext(tampered)).toBeNull();
  });

  it("cookie expiré : rejeté", () => {
    const past = Date.now() - COLLECTION_CONTEXT_TTL_MS - 60_000;
    const signed = signCollectionContext("col_stale", past);
    expect(verifyCollectionContext(signed)).toBeNull();
  });

  it("cookie signé avec un autre secret : rejeté", () => {
    const signed = signCollectionContext("col_x");
    const previous = process.env.NEXTAUTH_SECRET;
    process.env.NEXTAUTH_SECRET = "un-tout-autre-secret";
    try {
      expect(verifyCollectionContext(signed)).toBeNull();
    } finally {
      process.env.NEXTAUTH_SECRET = previous;
    }
  });
});
