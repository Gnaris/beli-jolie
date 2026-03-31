import { prisma } from "@/lib/prisma";
import Link from "next/link";

export default async function AnkorstoreHistoriquePage() {
  const jobs = await prisma.ankorstoreSyncJob.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { admin: { select: { firstName: true, lastName: true } } },
  });

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex items-center justify-between">
        <h1 className="page-title">Historique Ankorstore</h1>
        <Link href="/admin/ankorstore" className="text-sm text-brand hover:underline">&larr; Retour</Link>
      </div>

      <div className="bg-bg-primary border border-border rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-bg-secondary">
              <th className="text-left p-4 font-medium text-text-secondary">Date</th>
              <th className="text-left p-4 font-medium text-text-secondary">Status</th>
              <th className="text-left p-4 font-medium text-text-secondary">Admin</th>
              <th className="text-right p-4 font-medium text-text-secondary">Cr&eacute;&eacute;s</th>
              <th className="text-right p-4 font-medium text-text-secondary">Mis &agrave; jour</th>
              <th className="text-right p-4 font-medium text-text-secondary">Erreurs</th>
              <th className="text-right p-4 font-medium text-text-secondary">Total</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => (
              <tr key={job.id} className="border-b border-border hover:bg-bg-secondary/50">
                <td className="p-4">
                  {new Date(job.createdAt).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                </td>
                <td className="p-4">
                  <span className={`badge ${job.status === "COMPLETED" ? "badge-success" : job.status === "RUNNING" ? "badge-info" : job.status === "FAILED" ? "badge-error" : job.status === "CANCELLED" ? "badge-warning" : "badge-neutral"}`}>
                    {job.status}
                  </span>
                </td>
                <td className="p-4">{job.admin.firstName} {job.admin.lastName}</td>
                <td className="p-4 text-right font-mono">{job.createdProducts}</td>
                <td className="p-4 text-right font-mono">{job.updatedProducts}</td>
                <td className="p-4 text-right font-mono text-red-500">{job.errorProducts}</td>
                <td className="p-4 text-right font-mono">{job.processedProducts}</td>
              </tr>
            ))}
            {jobs.length === 0 && (
              <tr>
                <td colSpan={7} className="p-8 text-center text-text-secondary">Aucune synchronisation effectu&eacute;e.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
