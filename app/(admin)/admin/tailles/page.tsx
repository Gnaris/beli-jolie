import { prisma } from "@/lib/prisma";
import type { Metadata } from "next";
import SizesManager from "@/components/admin/tailles/SizesManager";
import { getPfsAnnexes } from "@/lib/pfs-annexes";
import { PROTECTED_SIZE_NAME, PROTECTED_SIZE_PFS_REF } from "@/lib/protected-sizes";

export const metadata: Metadata = { title: "Gestion des tailles" };

async function ensureProtectedSize() {
  await prisma.size.upsert({
    where: { name: PROTECTED_SIZE_NAME },
    update: {},
    create: { name: PROTECTED_SIZE_NAME, pfsSizeRef: PROTECTED_SIZE_PFS_REF, position: 0 },
  });
}

export default async function TaillesPage() {
  await ensureProtectedSize();

  const [sizes, annexes] = await Promise.all([
    prisma.size.findMany({
      orderBy: { position: "asc" },
      include: {
        _count: { select: { variantSizes: true } },
      },
    }),
    getPfsAnnexes().catch(() => null),
  ]);

  const sizeItems = sizes.map((s) => ({
    id: s.id,
    name: s.name,
    position: s.position,
    variantCount: s._count.variantSizes,
    pfsSizeRef: s.pfsSizeRef,
  }));

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
