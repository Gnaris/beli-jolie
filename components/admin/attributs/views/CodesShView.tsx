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
        title="Codes SH"
        actions={<CreateHsCodeTrigger />}
      />
      <HsCodesMasterDetail initialItems={items} />
    </div>
  );
}
