import { redirect } from "next/navigation";
import Link from "next/link";
import { getCachedEfashionEnabled } from "@/lib/cached-data";
import EfashionReviewGrid from "@/components/efashion/EfashionReviewGrid";

export default async function EfashionReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const efashionEnabled = await getCachedEfashionEnabled();
  if (!efashionEnabled) redirect("/admin/efashion");
  const { id } = await params;

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <Link
          href="/admin/efashion/historique"
          className="text-text-secondary hover:text-text-primary transition-colors text-sm"
        >
          &larr; Retour à l&apos;historique
        </Link>
        <Link href="/admin/efashion" className="btn-secondary text-sm">
          Nouvelle synchronisation
        </Link>
      </div>

      <EfashionReviewGrid jobId={id} />
    </div>
  );
}
