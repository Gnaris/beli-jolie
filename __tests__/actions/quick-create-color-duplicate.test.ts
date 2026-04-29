import { describe, it, expect, vi, beforeEach } from "vitest";

const mockColorCreate = vi.fn();
const mockColorFindFirst = vi.fn();
const mockColorTranslationUpsert = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    color: {
      create: (...a: unknown[]) => mockColorCreate(...a),
      findFirst: (...a: unknown[]) => mockColorFindFirst(...a),
    },
    colorTranslation: { upsert: (...a: unknown[]) => mockColorTranslationUpsert(...a) },
  },
}));

vi.mock("next-auth", () => ({
  getServerSession: vi.fn().mockResolvedValue({ user: { role: "ADMIN" } }),
}));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

import { createColorQuick } from "@/app/actions/admin/quick-create";

/**
 * Avant ce correctif, la création tombait sur l'erreur Prisma brute
 * `Unique constraint failed on the constraint: Color_name_key` quand l'admin
 * tentait d'ajouter une couleur déjà présente. On vérifie maintenant l'unicité
 * en amont pour renvoyer un message lisible et éviter d'écrire en BDD.
 */
describe("createColorQuick — refuse les doublons de nom", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("crée la couleur quand le nom est libre", async () => {
    mockColorFindFirst.mockResolvedValue(null);
    mockColorCreate.mockResolvedValue({ id: "col-1", name: "Rouge", hex: "#ff0000", patternImage: null });

    const res = await createColorQuick({ fr: "Rouge" }, "#ff0000", null);

    expect(mockColorFindFirst).toHaveBeenCalledWith({
      where: { name: { equals: "Rouge" } },
      select: { name: true },
    });
    expect(mockColorCreate).toHaveBeenCalledTimes(1);
    expect(res).toEqual({ id: "col-1", name: "Rouge", hex: "#ff0000", patternImage: null });
  });

  it("lève une erreur lisible si une couleur du même nom existe déjà", async () => {
    mockColorFindFirst.mockResolvedValue({ name: "Rouge" });

    await expect(createColorQuick({ fr: "Rouge" }, "#ff0000", null)).rejects.toThrow(
      /La couleur « Rouge » existe déjà/,
    );
    expect(mockColorCreate).not.toHaveBeenCalled();
  });
});
