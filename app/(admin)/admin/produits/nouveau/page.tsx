import Link from "next/link";
import type { Metadata } from "next";
import ProductForm from "@/components/admin/products/ProductForm";
import { getCachedPfsEnabled } from "@/lib/cached-data";
import { CreatePageWrapper, CreatePageToggle } from "./CreatePageWrapper";

export const metadata: Metadata = { title: "Nouveau produit" };

export default async function NouveauProduitPage() {
  const hasPfsConfig = await getCachedPfsEnabled();

  return (
    <CreatePageWrapper>
      <div className="max-w-[1600px] mx-auto space-y-8">
        <div>
          <div className="flex items-center gap-2 text-sm font-body text-text-muted mb-2">
            <Link href="/admin/produits" className="hover:text-text-primary transition-colors">Produits</Link>
            <span>/</span>
            <span className="text-text-secondary">Nouveau</span>
          </div>
          <div className="flex items-center justify-between">
            <h1 className="page-title">
              Créer un produit
            </h1>
            <CreatePageToggle />
          </div>
        </div>

        <ProductForm
          hasPfsConfig={hasPfsConfig}
        />
      </div>
    </CreatePageWrapper>
  );
}
