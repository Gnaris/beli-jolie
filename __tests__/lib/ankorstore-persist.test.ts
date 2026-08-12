/**
 * Tests pour lib/ankorstore-persist.ts.
 *
 * Le helper doit :
 *   1. Créer normalement une row AnkorstoreOperation et retourner
 *      { inserted: true }
 *   2. Sur P2002 avec MÊME productId (double kickoff bénin), retourner
 *      { inserted: false, sameProduct: true }
 *   3. Sur P2002 avec productId DIFFÉRENT (opId partagé — dangereux),
 *      retourner { inserted: false, sameProduct: false } et logger .error
 *   4. Propager toute autre erreur Prisma
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

const mockCreate = vi.fn();
const mockFindUnique = vi.fn();
const mockLoggerWarn = vi.fn();
const mockLoggerError = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    ankorstoreOperation: {
      create: (...args: unknown[]) => mockCreate(...args),
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
    },
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: mockLoggerWarn, error: mockLoggerError },
}));

describe("persistAnkorstoreOperation", () => {
  beforeEach(() => {
    mockCreate.mockReset();
    mockFindUnique.mockReset();
    mockLoggerWarn.mockReset();
    mockLoggerError.mockReset();
  });

  it("crée la row normalement quand l'id est libre → inserted: true", async () => {
    mockCreate.mockResolvedValueOnce({});
    const { persistAnkorstoreOperation } = await import("@/lib/ankorstore-persist");

    const result = await persistAnkorstoreOperation({
      id: "op-1",
      productId: "prod-1",
      type: "UPDATE",
      payload: { foo: "bar" } as unknown as Prisma.InputJsonValue,
      context: "Ankorstore Test",
    });

    expect(result).toEqual({ inserted: true });
    expect(mockCreate).toHaveBeenCalledWith({
      data: {
        id: "op-1",
        productId: "prod-1",
        type: "UPDATE",
        status: "PENDING",
        payload: { foo: "bar" },
      },
    });
    expect(mockLoggerWarn).not.toHaveBeenCalled();
    expect(mockLoggerError).not.toHaveBeenCalled();
  });

  it("P2002 avec MÊME productId → inserted:false sameProduct:true + warn", async () => {
    const p2002 = new Prisma.PrismaClientKnownRequestError(
      "Unique constraint failed on the constraint: `PRIMARY`",
      { code: "P2002", clientVersion: "5.22.0", meta: { target: "PRIMARY" } },
    );
    mockCreate.mockRejectedValueOnce(p2002);
    mockFindUnique.mockResolvedValueOnce({ productId: "prod-1" });
    const { persistAnkorstoreOperation } = await import("@/lib/ankorstore-persist");

    const result = await persistAnkorstoreOperation({
      id: "op-dup",
      productId: "prod-1",
      type: "PUBLISH",
      payload: {} as Prisma.InputJsonValue,
      context: "Ankorstore Test",
    });

    expect(result).toEqual({
      inserted: false,
      existingProductId: "prod-1",
      sameProduct: true,
    });
    expect(mockLoggerWarn).toHaveBeenCalledTimes(1);
    expect(mockLoggerError).not.toHaveBeenCalled();
    const [msg] = mockLoggerWarn.mock.calls[0];
    expect(msg).toContain("double kickoff même produit");
  });

  it("P2002 avec productId DIFFÉRENT → inserted:false sameProduct:false + error", async () => {
    const p2002 = new Prisma.PrismaClientKnownRequestError(
      "Unique constraint failed on the constraint: `PRIMARY`",
      { code: "P2002", clientVersion: "5.22.0", meta: { target: "PRIMARY" } },
    );
    mockCreate.mockRejectedValueOnce(p2002);
    mockFindUnique.mockResolvedValueOnce({ productId: "prod-OTHER" });
    const { persistAnkorstoreOperation } = await import("@/lib/ankorstore-persist");

    const result = await persistAnkorstoreOperation({
      id: "op-shared",
      productId: "prod-1",
      type: "REFRESH_CREATE_NEW",
      payload: {} as Prisma.InputJsonValue,
      context: "Ankorstore Batch Refresh Phase 2",
    });

    expect(result).toEqual({
      inserted: false,
      existingProductId: "prod-OTHER",
      sameProduct: false,
    });
    expect(mockLoggerError).toHaveBeenCalledTimes(1);
    expect(mockLoggerWarn).not.toHaveBeenCalled();
    const [msg, ctx] = mockLoggerError.mock.calls[0];
    expect(msg).toContain("PARTAGÉ");
    expect(ctx).toMatchObject({
      operationId: "op-shared",
      requestedProductId: "prod-1",
      existingProductId: "prod-OTHER",
    });
  });

  it("propage toute autre erreur Prisma", async () => {
    const otherErr = new Prisma.PrismaClientKnownRequestError("Something else", {
      code: "P1001",
      clientVersion: "5.22.0",
    });
    mockCreate.mockRejectedValueOnce(otherErr);
    const { persistAnkorstoreOperation } = await import("@/lib/ankorstore-persist");

    await expect(
      persistAnkorstoreOperation({
        id: "op-x",
        productId: "prod-1",
        type: "DELETE",
        payload: {} as Prisma.InputJsonValue,
        context: "Ankorstore Test",
      }),
    ).rejects.toBe(otherErr);

    expect(mockLoggerWarn).not.toHaveBeenCalled();
    expect(mockLoggerError).not.toHaveBeenCalled();
  });
});
