import { prisma } from "@/lib/prisma";
import PageHeader from "@/components/admin/shared/PageHeader";
import HsCodesMasterDetail, { type HsCodeItem } from "@/components/admin/codes-sh/HsCodesMasterDetail";
import CreateHsCodeTrigger from "@/components/admin/codes-sh/CreateHsCodeTrigger";

export default async function CodesShView() {
  const rows = await prisma.hsCode.findMany({
    orderBy: [{ position: "asc" }, { code: "asc" }],
    include: { _count: { select: { products: true } } },
  });

  const items: HsCodeItem[] = rows.map((r) => ({
    id: r.id,
    code: r.code,
    label: r.label,
    productCount: r._count.products,
    position: r.position,
    createdAt: r.createdAt,
  }));

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Référentiel · Douanes"
        title="Codes SH"
        subtitle="Bibliothèque des codes douaniers (Système Harmonisé) attribués aux produits pour l'export et les marketplaces."
        actions={<CreateHsCodeTrigger />}
      />
      <HsCodesMasterDetail initialItems={items} />
    </div>
  );
}
