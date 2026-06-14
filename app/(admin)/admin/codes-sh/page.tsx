import Link from "next/link";
import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import HsCodesManager from "@/components/admin/codes-sh/HsCodesManager";

export const metadata: Metadata = { title: "Codes SH" };

export default async function CodesShPage() {
  const rows = await prisma.hsCode.findMany({
    orderBy: { code: "asc" },
    include: { _count: { select: { products: true } } },
  });

  const items = rows.map((r) => ({
    id: r.id,
    code: r.code,
    label: r.label,
    productCount: r._count.products,
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <div className="flex items-center gap-2 text-sm font-body text-text-muted mb-1">
            <Link href="/admin" className="hover:text-text-primary transition-colors">
              Admin
            </Link>
            <span>/</span>
            <span className="text-text-secondary">Codes SH</span>
          </div>
          <h1 className="page-title">Codes SH</h1>
          <p className="page-subtitle">
            Bibliothèque des codes douaniers (Système Harmonisé) attribués aux produits.
          </p>
        </div>
      </div>
      <HsCodesManager initialItems={items} />
    </div>
  );
}
