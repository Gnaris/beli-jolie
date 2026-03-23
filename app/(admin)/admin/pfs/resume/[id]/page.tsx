import Link from "next/link";
import PfsReviewGrid from "@/components/pfs/PfsReviewGrid";

export default async function PfsResumePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <Link
          href="/admin/pfs/resume"
          className="text-text-secondary hover:text-text-primary transition-colors text-sm"
        >
          &larr; Retour aux résumés
        </Link>
        <Link href="/admin/pfs" className="btn-secondary text-sm">
          Nouvelle synchronisation
        </Link>
      </div>

      <PfsReviewGrid jobId={id} />
    </div>
  );
}
