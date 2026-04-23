import { getServerSession } from "next-auth";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { authOptions } from "@/lib/auth";
import { getPromotion } from "@/app/actions/admin/promotions";
import PromotionForm from "@/components/admin/promotions/PromotionForm";

export const metadata = { title: "Modifier promotion — Admin" };

export default async function EditPromotionPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") redirect("/connexion");

  const { id } = await params;
  const promo = await getPromotion(id);
  if (!promo) notFound();

  const initial = {
    id: promo.id,
    name: promo.name,
    type: promo.type as "CODE" | "AUTO",
    code: promo.code || "",
    discountKind: promo.discountKind as "PERCENTAGE" | "FIXED_AMOUNT" | "FREE_SHIPPING",
    discountValue: String(Number(promo.discountValue)),
    minOrderAmount: promo.minOrderAmount ? String(Number(promo.minOrderAmount)) : "",
    maxUses: promo.maxUses ? String(promo.maxUses) : "",
    maxUsesPerUser: promo.maxUsesPerUser ? String(promo.maxUsesPerUser) : "",
    firstOrderOnly: promo.firstOrderOnly,
    appliesToAll: promo.appliesToAll,
    startsAt: new Date(promo.startsAt).toISOString().slice(0, 16),
    endsAt: promo.endsAt ? new Date(promo.endsAt).toISOString().slice(0, 16) : "",
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link
            href="/admin/promotions"
            className="inline-flex items-center gap-1.5 text-sm text-text-muted hover:text-text-primary font-body transition-colors group"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="transition-transform group-hover:-translate-x-0.5">
              <path d="M19 12H5" /><polyline points="12 19 5 12 12 5" />
            </svg>
            Retour aux promotions
          </Link>
          <h1 className="font-heading text-2xl font-bold text-text-primary mt-2">Modifier — {promo.name}</h1>
          <p className="text-sm text-text-muted font-body mt-1">Modifiez les paramètres de cette promotion.</p>
        </div>
      </div>

      <PromotionForm initial={initial} />

      {promo.usages.length > 0 && (
        <div className="bg-bg-primary border border-border rounded-2xl shadow-sm overflow-hidden max-w-3xl">
          <div className="px-6 py-4 border-b border-border-light bg-bg-secondary/50">
            <h3 className="font-heading font-semibold text-text-primary text-sm">
              Utilisations récentes
              <span className="ml-2 text-text-muted font-body font-normal">({promo.usages.length})</span>
            </h3>
          </div>
          <div className="divide-y divide-border-light">
            {promo.usages.map((u) => (
              <div key={u.id} className="flex items-center justify-between px-6 py-3 text-sm font-body">
                <span className="text-text-primary font-medium">
                  {u.user.firstName} {u.user.lastName}
                  {u.user.company && (
                    <span className="text-text-muted font-normal ml-1">({u.user.company})</span>
                  )}
                </span>
                <div className="flex items-center gap-3">
                  <span className="text-text-primary font-medium">-{Number(u.discountApplied).toFixed(2)} €</span>
                  <span className="text-text-muted text-xs">{u.order.orderNumber}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
