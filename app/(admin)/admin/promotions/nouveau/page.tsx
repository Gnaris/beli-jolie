import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { authOptions } from "@/lib/auth";
import PromotionForm from "@/components/admin/promotions/PromotionForm";

export const metadata = { title: "Nouvelle promotion — Admin" };

export default async function NewPromotionPage() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") redirect("/connexion");

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
          <h1 className="font-heading text-2xl font-bold text-text-primary mt-2">Nouvelle promotion</h1>
          <p className="text-sm text-text-muted font-body mt-1">Créez un code promo ou une remise automatique pour vos clients.</p>
        </div>
      </div>
      <PromotionForm />
    </div>
  );
}
