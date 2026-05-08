import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    category:    { findMany: vi.fn() },
    subCategory: { findMany: vi.fn() },
    color:       { findMany: vi.fn() },
    composition: { findMany: vi.fn() },
    tag:         { findMany: vi.fn() },
  },
}));

import { prisma } from "@/lib/prisma";
import { GET } from "@/app/api/translations/entities/route";

function mockReq(locale: string | null) {
  const url = locale != null ? `http://test/api/translations/entities?locale=${locale}` : `http://test/api/translations/entities`;
  return { nextUrl: new URL(url) } as never;
}

describe("GET /api/translations/entities", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retourne {} pour locale=fr (pas de traduction nécessaire)", async () => {
    const res = await GET(mockReq("fr"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({});
    expect(prisma.category.findMany).not.toHaveBeenCalled();
  });

  it("rejette une locale inconnue avec 400", async () => {
    const res = await GET(mockReq("xx"));
    expect(res.status).toBe(400);
  });

  it("renvoie une map { nomFR(lc): nomTraduit } pour locale=en", async () => {
    vi.mocked(prisma.category.findMany).mockResolvedValue([
      { name: "Bracelets", translations: [{ name: "Bracelets EN" }] },
      { name: "Colliers",  translations: [] },
    ] as never);
    vi.mocked(prisma.subCategory.findMany).mockResolvedValue([
      { name: "Joncs", translations: [{ name: "Bangles" }] },
    ] as never);
    vi.mocked(prisma.color.findMany).mockResolvedValue([
      { name: "Rouge", translations: [{ name: "Red" }] },
      { name: "Bleu",  translations: [{ name: "Blue" }] },
    ] as never);
    vi.mocked(prisma.composition.findMany).mockResolvedValue([
      { name: "Acier inoxydable", translations: [{ name: "Stainless steel" }] },
    ] as never);
    vi.mocked(prisma.tag.findMany).mockResolvedValue([
      { name: "Tendance", translations: [{ name: "Trendy" }] },
    ] as never);

    const res = await GET(mockReq("en"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      "bracelets":         "Bracelets EN",
      "joncs":             "Bangles",
      "rouge":             "Red",
      "bleu":              "Blue",
      "acier inoxydable":  "Stainless steel",
      "tendance":          "Trendy",
    });
    // Pas d'entrée pour "Colliers" (pas de traduction)
    expect(body["colliers"]).toBeUndefined();
  });

  it("filtre les findMany sur la locale demandée", async () => {
    vi.mocked(prisma.category.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.subCategory.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.color.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.composition.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.tag.findMany).mockResolvedValue([] as never);

    await GET(mockReq("en"));

    for (const findMany of [
      prisma.category.findMany,
      prisma.subCategory.findMany,
      prisma.color.findMany,
      prisma.composition.findMany,
      prisma.tag.findMany,
    ]) {
      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          select: expect.objectContaining({
            translations: expect.objectContaining({
              where: { locale: "en" },
              take: 1,
            }),
          }),
        }),
      );
    }
  });
});
