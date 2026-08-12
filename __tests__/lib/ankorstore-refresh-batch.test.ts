import { describe, it, expect } from "vitest";
import {
  isBatchRefreshPayload,
  isBatchCreateNewPayload,
} from "@/lib/ankorstore-refresh-batch";

describe("isBatchRefreshPayload", () => {
  it("détecte un payload batch valide", () => {
    const payload = { batch: true, members: [] };
    expect(isBatchRefreshPayload(payload)).toBe(true);
  });

  it("détecte un payload batch avec plusieurs membres", () => {
    const payload = {
      batch: true,
      members: [
        { productId: "p1", externalId: "R1" },
        { productId: "p2", externalId: "R2" },
      ],
    };
    expect(isBatchRefreshPayload(payload)).toBe(true);
  });

  it("refuse un payload single (pas de batch=true)", () => {
    const payload = {
      oldAnkorsProductId: "abc",
      reference: "R1",
      nextProductInput: {},
      nextPublishPayload: {},
      oldVariantSkus: ["sku1"],
    };
    expect(isBatchRefreshPayload(payload)).toBe(false);
  });

  it("refuse un payload avec batch=true mais members non-array", () => {
    const payload = { batch: true, members: "oops" };
    expect(isBatchRefreshPayload(payload)).toBe(false);
  });

  it("refuse null/undefined/string", () => {
    expect(isBatchRefreshPayload(null)).toBe(false);
    expect(isBatchRefreshPayload(undefined)).toBe(false);
    expect(isBatchRefreshPayload("hello")).toBe(false);
    expect(isBatchRefreshPayload(42)).toBe(false);
  });

  it("refuse un payload avec batch=false", () => {
    const payload = { batch: false, members: [] };
    expect(isBatchRefreshPayload(payload)).toBe(false);
  });
});

describe("isBatchCreateNewPayload", () => {
  it("détecte un payload batch CREATE_NEW valide (même forme que DELETE_OLD)", () => {
    const payload = {
      batch: true,
      members: [{ productId: "p1", externalId: "R1" }],
    };
    expect(isBatchCreateNewPayload(payload)).toBe(true);
  });

  it("refuse un payload publish single (pas de batch=true)", () => {
    const payload = {
      firstSku: "SKU-1",
      skuToBjVariantId: { "SKU-1": "v1" },
      allVariantsOutOfStock: false,
    };
    expect(isBatchCreateNewPayload(payload)).toBe(false);
  });

  it("refuse null/undefined", () => {
    expect(isBatchCreateNewPayload(null)).toBe(false);
    expect(isBatchCreateNewPayload(undefined)).toBe(false);
  });
});
