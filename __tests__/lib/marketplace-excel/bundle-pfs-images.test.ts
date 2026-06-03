import { describe, it, expect } from "vitest";
import { bundlePfsImagesIntoParts } from "@/lib/marketplace-excel/export-orchestrator";
import type { PreparedImage } from "@/lib/marketplace-excel/prepare-images";

function makeImage(name: string, sizeBytes: number): PreparedImage {
  return { filename: name, buffer: Buffer.alloc(sizeBytes, "x") };
}

describe("bundlePfsImagesIntoParts", () => {
  it("retourne [] quand aucune image", async () => {
    const parts = await bundlePfsImagesIntoParts([]);
    expect(parts).toEqual([]);
  });

  it("met toutes les images dans un seul sous-ZIP quand sous la limite", async () => {
    const parts = await bundlePfsImagesIntoParts(
      [makeImage("a.jpg", 1_000_000), makeImage("b.jpg", 2_000_000)],
      15 * 1024 * 1024,
    );
    expect(parts).toHaveLength(1);
    expect(parts[0]!.filename).toBe("images_part_1.zip");
  });

  it("découpe en plusieurs sous-ZIP quand on dépasse la limite", async () => {
    const limit = 5 * 1024 * 1024; // 5 Mo
    const parts = await bundlePfsImagesIntoParts(
      [
        makeImage("a.jpg", 2_500_000),
        makeImage("b.jpg", 2_500_000), // total 5_000_000 = limit
        makeImage("c.jpg", 2_500_000), // ferait dépasser → part 2
        makeImage("d.jpg", 2_500_000),
        makeImage("e.jpg", 2_500_000), // ferait dépasser → part 3
      ],
      limit,
    );
    expect(parts.map((p) => p.filename)).toEqual([
      "images_part_1.zip",
      "images_part_2.zip",
      "images_part_3.zip",
    ]);
  });

  it("met une image trop grosse seule dans son propre sous-ZIP (best-effort)", async () => {
    const limit = 5 * 1024 * 1024;
    const parts = await bundlePfsImagesIntoParts(
      [
        makeImage("petit.jpg", 1_000_000),
        makeImage("trop_gros.jpg", 10_000_000), // > limit
        makeImage("autre.jpg", 1_000_000),
      ],
      limit,
    );
    // 3 parts attendues : petit (1Mo), trop_gros (10Mo seul), autre (1Mo)
    expect(parts).toHaveLength(3);
  });
});
