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
      <div>
        <Link href="/admin/promotions" className="text-sm text-text-muted hover:text-text-primary font-body transition-colors">
          &larr; Retour aux promotions
        </Link>
        <h1 className="font-heading text-2xl font-bold text-text-primary mt-2">Nouvelle promotion</h1>
      </div>
      <PromotionForm />
    </div>
  );
}
