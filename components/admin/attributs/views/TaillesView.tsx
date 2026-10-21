import { prisma } from "@/lib/prisma";
import PageHeader from "@/components/admin/shared/PageHeader";
import SizesMasterDetail from "@/components/admin/tailles/SizesMasterDetail";
import CreateSizeTrigger from "@/components/admin/tailles/CreateSizeTrigger";
import { getPfsAnnexes } from "@/lib/pfs-annexes";
import { withProtectedSizeItem, type SizeManagerItem } from "@/lib/protected-sizes";

export default async function TaillesView() {
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
    <div className="space-y-5">
      <PageHeader
        eyebrow="Catalogue"
        title="Tailles"
        subtitle="Créez votre bibliothèque de tailles et associez chacune à sa référence Paris Fashion Shop."
        actions={<CreateSizeTrigger />}
      />
      <SizesMasterDetail initialSizes={sizeItems} pfsSizes={pfsSizes} />
    </div>
  );
}
