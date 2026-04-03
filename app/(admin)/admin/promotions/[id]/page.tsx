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
      <div>
        <Link href="/admin/promotions" className="text-sm text-text-muted hover:text-text-primary font-body transition-colors">
          &larr; Retour aux promotions
        </Link>
        <h1 className="font-heading text-2xl font-bold text-text-primary mt-2">Modifier — {promo.name}</h1>
      </div>
      <PromotionForm initial={initial} />

      {promo.usages.length > 0 && (
        <div className="bg-bg-primary border border-border rounded-2xl p-6 max-w-2xl">
          <h3 className="font-heading font-bold text-text-primary mb-3">Utilisations recentes</h3>
          <div className="space-y-2">
            {promo.usages.map((u) => (
              <div key={u.id} className="flex items-center justify-between text-sm font-body">
                <span className="text-text-primary">
                  {u.user.firstName} {u.user.lastName}
                  {u.user.company && ` (${u.user.company})`}
                </span>
                <span className="text-text-muted">
                  -{Number(u.discountApplied).toFixed(2)}EUR — {u.order.orderNumber}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
