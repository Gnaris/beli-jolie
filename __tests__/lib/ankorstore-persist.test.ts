/**
 * Tests pour lib/ankorstore-persist.ts.
 *
 * Le helper doit :
 *   1. Créer normalement une row AnkorstoreOperation
 *   2. Ignorer P2002 (kickoff concurrent) et logger un warning
 *   3. Propager toute autre erreur Prisma
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

const mockCreate = vi.fn();
const mockLoggerWarn = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    ankorstoreOperation: {
      create: (...args: unknown[]) => mockCreate(...args),
    },
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: mockLoggerWarn, error: vi.fn() },
}));

describe("persistAnkorstoreOperation", () => {
  beforeEach(() => {
    mockCreate.mockReset();
    mockLoggerWarn.mockReset();
  });

  it("crée la row normalement quand l'id est libre", async () => {
    mockCreate.mockResolvedValueOnce({});
    const { persistAnkorstoreOperation } = await import("@/lib/ankorstore-persist");

    await persistAnkorstoreOperation({
      id: "op-1",
      productId: "prod-1",
      type: "UPDATE",
      payload: { foo: "bar" } as unknown as Prisma.InputJsonValue,
      context: "Ankorstore Test",
    });

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
  });

  it("ignore P2002 (kickoff concurrent) et log un warning", async () => {
    const p2002 = new Prisma.PrismaClientKnownRequestError(
      "Unique constraint failed on the constraint: `PRIMARY`",
      { code: "P2002", clientVersion: "5.22.0", meta: { target: "PRIMARY" } },
    );
    mockCreate.mockRejectedValueOnce(p2002);
    const { persistAnkorstoreOperation } = await import("@/lib/ankorstore-persist");

    await expect(
      persistAnkorstoreOperation({
        id: "op-dup",
        productId: "prod-1",
        type: "PUBLISH",
        payload: {} as Prisma.InputJsonValue,
        context: "Ankorstore Test",
      }),
    ).resolves.toBeUndefined();

    expect(mockLoggerWarn).toHaveBeenCalledTimes(1);
    const [msg, ctx] = mockLoggerWarn.mock.calls[0];
    expect(msg).toContain("Opération déjà persistée");
    expect(ctx).toMatchObject({ operationId: "op-dup", productId: "prod-1" });
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
  });
});
