import { prisma } from "@/lib/prisma";
import type { Metadata } from "next";
import PageHeader from "@/components/admin/shared/PageHeader";
import TagsManager from "./TagsManager";

export const metadata: Metadata = { title: "Mots clés — Admin" };

export default async function MotsClesPage() {
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
    <div className="max-w-[1400px] mx-auto space-y-5 px-4 md:px-6 py-6">
      <PageHeader
        eyebrow="Catalogue"
        title="Mots-clés"
        subtitle="Étiquettes libres réutilisables sur vos produits pour affiner la recherche et les filtres."
      />

      <TagsManager initialTags={tagItems} />
    </div>
  );
}
