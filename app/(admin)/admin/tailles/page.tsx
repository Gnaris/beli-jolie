import { prisma } from "@/lib/prisma";
import type { Metadata } from "next";
import SizesManager from "@/components/admin/tailles/SizesManager";
import { getPfsAnnexes } from "@/lib/pfs-annexes";
import { withProtectedSizeItem, type SizeManagerItem } from "@/lib/protected-sizes";

export const metadata: Metadata = { title: "Gestion des tailles" };

export default async function TaillesPage() {
  const [sizes, annexes] = await Promise.all([
    prisma.size.findMany({
      orderBy: { position: "asc" },
      include: {
        _count: { select: { variantSizes: true } },
      },
    }),
    getPfsAnnexes().catch(() => null),
  ]);

  const sizeItems: SizeManagerItem[] = withProtectedSizeItem(
    sizes.map((s) => ({
      id: s.id,
      name: s.name,
      position: s.position,
      variantCount: s._count.variantSizes,
      pfsSizeRef: s.pfsSizeRef,
    })),
  );

  const pfsSizes = (annexes?.sizes ?? []).map((ref) => ({ reference: ref, label: ref }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Gestion des tailles</h1>
        <p className="page-subtitle">
          Créez votre bibliothèque de tailles et mappez chacune à sa référence
          Paris Fashion Shop.
        </p>
      </div>

      <SizesManager initialSizes={sizeItems} pfsSizes={pfsSizes} />
    </div>
  );
}
