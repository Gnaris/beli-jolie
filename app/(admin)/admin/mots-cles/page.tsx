import { prisma } from "@/lib/prisma";
import type { Metadata } from "next";
import TagsManager from "./TagsManager";

export const metadata: Metadata = { title: "Mots clés — Admin" };

export default async function MotsClesPage() {
  const tags = await prisma.tag.findMany({
    orderBy: { name: "asc" },
    include: {
      _count: { select: { products: true } },
    },
  });

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="page-title">Mots clés</h1>
        <p className="page-subtitle">
          Gérez les mots clés réutilisables sur plusieurs produits.
        </p>
      </div>

      <TagsManager
        initialTags={tags.map((t) => ({ id: t.id, name: t.name, productCount: t._count.products }))}
      />
    </div>
  );
}
