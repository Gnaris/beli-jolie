import { describe, it, expect, vi, beforeEach } from "vitest";

const mockColorFindMany = vi.fn();
const mockPfsGetColors = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    color: {
      findMany: (...a: unknown[]) => mockColorFindMany(...a),
    },
  },
}));

vi.mock("next-auth", () => ({
  getServerSession: vi.fn().mockResolvedValue({ user: { role: "ADMIN" } }),
}));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  // unstable_cache passes through the inner fn so our test still exercises the
  // live fetch path (cache is a Next runtime concern, not behavior under test).
  unstable_cache: (fn: (...args: unknown[]) => unknown) => fn,
}));
vi.mock("@/lib/auto-translate", () => ({
  autoTranslateColor: vi.fn(),
}));
vi.mock("@/lib/pfs-api-write", () => ({
  pfsGetColors: (...a: unknown[]) => mockPfsGetColors(...a),
}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { fetchPfsColorsForMapping } from "@/app/actions/admin/colors";
import { PFS_COLORS } from "@/lib/marketplace-excel/pfs-taxonomy";

describe("fetchPfsColorsForMapping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the live PFS colors list when the API succeeds", async () => {
    mockColorFindMany.mockResolvedValue([]);
    mockPfsGetColors.mockResolvedValue([
      { reference: "BLACK", value: "#111111", image: null, labels: { fr: "Noir" } },
      { reference: "GOLDEN", value: "#C4A647", image: "gold.svg", labels: { fr: "Doré" } },
    ]);
    const data = await fetchPfsColorsForMapping();
    expect(data.pfsColors).toEqual([
      { reference: "Noir", value: "#111111", image: null, label: "Noir" },
      { reference: "Doré", value: "#C4A647", image: "gold.svg", label: "Doré" },
    ]);
  });

  it("uses the hex returned by the API (not the static mapping)", async () => {
    mockColorFindMany.mockResolvedValue([]);
    mockPfsGetColors.mockResolvedValue([
      { reference: "NOIR", value: "#2A2A2A", image: null, labels: { fr: "Noir" } },
    ]);
    const data = await fetchPfsColorsForMapping();
    const noir = data.pfsColors.find((c) => c.reference === "Noir");
    expect(noir?.value).toBe("#2A2A2A");
  });

  it("falls back to the static list when the API throws", async () => {
    mockColorFindMany.mockResolvedValue([]);
    mockPfsGetColors.mockRejectedValue(new Error("PFS down"));
    const data = await fetchPfsColorsForMapping();
    expect(data.pfsColors.length).toBe(PFS_COLORS.length);
    expect(data.pfsColors[0].reference).toBe(PFS_COLORS[0]);
  });

  it("falls back to the static list when the API returns an empty array", async () => {
    mockColorFindMany.mockResolvedValue([]);
    mockPfsGetColors.mockResolvedValue([]);
    const data = await fetchPfsColorsForMapping();
    expect(data.pfsColors.length).toBe(PFS_COLORS.length);
  });

  it("exposes existing DB mappings keyed by PFS reference", async () => {
    mockPfsGetColors.mockResolvedValue([
      { reference: "RED", value: "#E53935", image: null, labels: { fr: "Rouge" } },
      { reference: "WHITE", value: "#FFFFFF", image: null, labels: { fr: "Blanc" } },
    ]);
    mockColorFindMany.mockResolvedValue([
      { id: "c1", name: "Rouge cerise", pfsColorRef: "Rouge" },
      { id: "c2", name: "Blanc cassé", pfsColorRef: "Blanc" },
      { id: "c3", name: "Sans mapping", pfsColorRef: null },
    ]);
    const data = await fetchPfsColorsForMapping();
    expect(data.existingMappings).toEqual({
      Rouge: { colorId: "c1", colorName: "Rouge cerise" },
      Blanc: { colorId: "c2", colorName: "Blanc cassé" },
    });
  });

  it("refuses non-admin callers", async () => {
    const nextAuth = await import("next-auth");
    (nextAuth.getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      user: { role: "CLIENT" },
    });
    await expect(fetchPfsColorsForMapping()).rejects.toThrow();
  });
});
