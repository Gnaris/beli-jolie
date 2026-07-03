import { describe, it, expect, vi, beforeEach } from "vitest";

// Chaque entité expose la même signature :
//   reorderXxx(orderedIds: string[]) → transaction Prisma qui écrit
//   position = index pour chaque id, puis invalide le cache.
//
// On mock un $transaction qui « collecte » les update et retourne un
// tableau vide, et on inspecte les updates envoyés.

const collectedUpdates: Array<{ where: { id: string }; data: { position: number } }> = [];
const mockCategoryUpdate = vi.fn((args: { where: { id: string }; data: { position: number } }) => {
  collectedUpdates.push(args);
  return Promise.resolve({});
});
const mockColorUpdate = vi.fn((args: { where: { id: string }; data: { position: number } }) => {
  collectedUpdates.push(args);
  return Promise.resolve({});
});
const mockCompositionUpdate = vi.fn((args: { where: { id: string }; data: { position: number } }) => {
  collectedUpdates.push(args);
  return Promise.resolve({});
});
const mockSeasonUpdate = vi.fn((args: { where: { id: string }; data: { position: number } }) => {
  collectedUpdates.push(args);
  return Promise.resolve({});
});
const mockHsCodeUpdate = vi.fn((args: { where: { id: string }; data: { position: number } }) => {
  collectedUpdates.push(args);
  return Promise.resolve({});
});

const mockTransaction = vi.fn((ops: Promise<unknown>[]) => Promise.all(ops));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: (ops: Promise<unknown>[]) => mockTransaction(ops),
    category: { update: (a: unknown) => mockCategoryUpdate(a as { where: { id: string }; data: { position: number } }) },
    color: { update: (a: unknown) => mockColorUpdate(a as { where: { id: string }; data: { position: number } }) },
    composition: { update: (a: unknown) => mockCompositionUpdate(a as { where: { id: string }; data: { position: number } }) },
    season: { update: (a: unknown) => mockSeasonUpdate(a as { where: { id: string }; data: { position: number } }) },
    hsCode: { update: (a: unknown) => mockHsCodeUpdate(a as { where: { id: string }; data: { position: number } }) },
  },
}));

const mockSession = vi.fn().mockResolvedValue({ user: { role: "ADMIN" } });
vi.mock("next-auth", () => ({
  getServerSession: (...a: unknown[]) => mockSession(...a),
}));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
const mockRevalidatePath = vi.fn();
const mockRevalidateTag = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: (...a: unknown[]) => mockRevalidatePath(...a),
  revalidateTag: (...a: unknown[]) => mockRevalidateTag(...a),
  // unstable_cache est utilisé au chargement de lib/cached-data (importé
  // transitivement par colors.ts). On rend le wrapper transparent.
  unstable_cache: <T extends (...args: unknown[]) => unknown>(fn: T) => fn,
}));
// Le lib i18n/locales est utilisé par categories.ts (autotranslate) — on stub.
vi.mock("@/lib/auto-translate", () => ({
  autoTranslateCategory: vi.fn(),
  autoTranslateSubCategory: vi.fn(),
  autoTranslateColor: vi.fn(),
  autoTranslateComposition: vi.fn(),
  autoTranslateSeason: vi.fn(),
}));
vi.mock("@/i18n/locales", () => ({ NON_DEFAULT_LOCALES: ["en"] }));

import { reorderCategories } from "@/app/actions/admin/categories";
import { reorderColors } from "@/app/actions/admin/colors";
import { reorderCompositions } from "@/app/actions/admin/compositions";
import { reorderSeasons } from "@/app/actions/admin/seasons";
import { reorderHsCodes } from "@/app/actions/admin/hs-codes";

beforeEach(() => {
  collectedUpdates.length = 0;
  mockRevalidatePath.mockClear();
  mockRevalidateTag.mockClear();
  mockSession.mockResolvedValue({ user: { role: "ADMIN" } });
});

describe("reorderCategories", () => {
  it("écrit position=0..N-1 dans l'ordre fourni", async () => {
    await reorderCategories(["c1", "c2", "c3"]);
    expect(collectedUpdates).toEqual([
      { where: { id: "c1" }, data: { position: 0 } },
      { where: { id: "c2" }, data: { position: 1 } },
      { where: { id: "c3" }, data: { position: 2 } },
    ]);
  });

  it("invalide le tag categories", async () => {
    await reorderCategories(["c1"]);
    expect(mockRevalidateTag).toHaveBeenCalledWith("categories", "default");
  });

  it("refuse un non-admin", async () => {
    mockSession.mockResolvedValueOnce({ user: { role: "CLIENT" } });
    await expect(reorderCategories(["c1"])).rejects.toThrow(/autorisé/i);
  });

  it("accepte une liste vide (no-op)", async () => {
    await reorderCategories([]);
    expect(collectedUpdates).toEqual([]);
  });
});

describe("reorderColors", () => {
  it("écrit position croissante", async () => {
    await reorderColors(["a", "b"]);
    expect(collectedUpdates).toEqual([
      { where: { id: "a" }, data: { position: 0 } },
      { where: { id: "b" }, data: { position: 1 } },
    ]);
  });
  it("invalide le tag colors", async () => {
    await reorderColors(["a"]);
    expect(mockRevalidateTag).toHaveBeenCalledWith("colors", "default");
  });
  it("refuse un non-admin", async () => {
    mockSession.mockResolvedValueOnce({ user: { role: "CLIENT" } });
    await expect(reorderColors(["a"])).rejects.toThrow(/autorisé/i);
  });
});

describe("reorderCompositions", () => {
  it("écrit position croissante", async () => {
    await reorderCompositions(["m1", "m2", "m3"]);
    expect(collectedUpdates.map((u) => u.data.position)).toEqual([0, 1, 2]);
    expect(collectedUpdates.map((u) => u.where.id)).toEqual(["m1", "m2", "m3"]);
  });
  it("invalide le tag compositions", async () => {
    await reorderCompositions(["m1"]);
    expect(mockRevalidateTag).toHaveBeenCalledWith("compositions", "default");
  });
});

describe("reorderSeasons", () => {
  it("écrit position croissante", async () => {
    await reorderSeasons(["s1", "s2"]);
    expect(collectedUpdates).toEqual([
      { where: { id: "s1" }, data: { position: 0 } },
      { where: { id: "s2" }, data: { position: 1 } },
    ]);
  });
  it("invalide le tag seasons", async () => {
    await reorderSeasons(["s1"]);
    expect(mockRevalidateTag).toHaveBeenCalledWith("seasons", "default");
  });
});

describe("reorderHsCodes", () => {
  it("écrit position croissante", async () => {
    await reorderHsCodes(["h1", "h2"]);
    expect(collectedUpdates).toEqual([
      { where: { id: "h1" }, data: { position: 0 } },
      { where: { id: "h2" }, data: { position: 1 } },
    ]);
  });
  it("invalide le tag hs-codes", async () => {
    await reorderHsCodes(["h1"]);
    expect(mockRevalidateTag).toHaveBeenCalledWith("hs-codes", "default");
  });
});
