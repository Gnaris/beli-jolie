import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import CatalogEditor from "@/components/admin/catalogues/CatalogEditor";

export const metadata: Metadata = { title: "Modifier le catalogue — Admin" };

interface Props {
  params: Promise<{ id: string }>;
}

export default async function AdminCatalogEditPage({ params }: Props) {
  const { id } = await params;

  const catalog = await prisma.catalog.findUnique({
    where: { id },
    include: {
      products: {
        orderBy: { position: "asc" },
        include: {
          product: {
            include: {
              colorImages: { orderBy: { order: "asc" } },
              colors: {
                where: { saleType: "UNIT" },
                include: {
                  color: { select: { id: true, name: true, hex: true } },
                },
              },
            },
          },
        },
      },
    },
  });

  if (!catalog) notFound();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Modifier le catalogue</h1>
        <p className="page-subtitle font-[family-name:var(--font-roboto)]">
          Sélectionnez les produits, personnalisez le titre, la couleur ou la photo de fond.
        </p>
      </div>
      <CatalogEditor catalog={catalog as any} />
    </div>
  );
}
