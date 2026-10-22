import { prisma } from "@/lib/prisma";
import PageHeader from "@/components/admin/shared/PageHeader";
import TagsManager from "@/app/(admin)/admin/mots-cles/TagsManager";

export default async function MotsClesView() {
  const tags = await prisma.tag.findMany({
    orderBy: { name: "asc" },
    include: {
      _count: { select: { products: true } },
      translations: true,
    },
  });

  const tagItems = tags.map((t) => ({
    id: t.id,
    name: t.name,
    productCount: t._count.products,
    translations: Object.fromEntries(t.translations.map((tr) => [tr.locale, tr.name])),
  }));

  return (
    <div className="space-y-5">
      <PageHeader title="Mots-clés" />
      <TagsManager initialTags={tagItems} />
    </div>
  );
}
