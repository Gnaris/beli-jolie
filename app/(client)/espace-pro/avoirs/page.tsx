import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getAvailableCredit } from "@/lib/credits";

export const metadata = { title: "Avoirs" };

export default async function ClientCreditsPage() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "CLIENT") redirect("/connexion");

  const [credits, availableTotal] = await Promise.all([
    prisma.credit.findMany({
      where: { userId: session.user.id },
      include: {
        claim: { select: { reference: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    getAvailableCredit(session.user.id),
  ]);

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <h1 className="font-heading text-2xl font-bold text-text-primary">Avoirs</h1>

      <div className="bg-bg-primary border border-border rounded-2xl p-6">
        <p className="text-sm text-text-muted font-body">Solde disponible</p>
        <p className="font-heading text-3xl font-bold text-text-primary mt-1">
          {new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(availableTotal)}
        </p>
      </div>

      {credits.length === 0 ? (
        <div className="bg-bg-primary border border-border rounded-2xl p-8 text-center">
          <p className="text-text-muted font-body">Aucun avoir.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {credits.map((credit) => {
            const remaining = Number(credit.remainingAmount);
            const total = Number(credit.amount);
            const isExpired = credit.expiresAt && new Date(credit.expiresAt) < new Date();
            return (
              <div key={credit.id} className="bg-bg-primary border border-border rounded-2xl p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-heading font-semibold text-text-primary">
                      {new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(total)}
                    </p>
                    <p className="text-sm text-text-muted font-body mt-1">
                      Restant : {new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(remaining)}
                    </p>
                    {credit.claim && (
                      <p className="text-xs text-text-muted font-body mt-1">
                        Reclamation {credit.claim.reference}
                      </p>
                    )}
                  </div>
                  <div className="text-right">
                    <span className={`badge ${remaining > 0 && !isExpired ? "badge-success" : "badge-neutral"}`}>
                      {isExpired ? "Expire" : remaining > 0 ? "Actif" : "Utilise"}
                    </span>
                    <p className="text-xs text-text-muted font-body mt-1">
                      {new Date(credit.createdAt).toLocaleDateString("fr-FR")}
                    </p>
                    {credit.expiresAt && (
                      <p className="text-xs text-text-muted font-body">
                        Expire le {new Date(credit.expiresAt).toLocaleDateString("fr-FR")}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
