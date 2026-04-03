import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { authOptions } from "@/lib/auth";
import { getPromotions } from "@/app/actions/admin/promotions";
import PromotionsList from "./PromotionsList";

export const metadata = { title: "Promotions — Admin" };

export default async function AdminPromotionsPage() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") redirect("/connexion");

  const promotions = await getPromotions();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-2xl font-bold text-text-primary">Promotions</h1>
        <Link href="/admin/promotions/nouveau"
          className="px-4 py-2 text-sm font-body bg-[#1A1A1A] text-white rounded-lg hover:bg-[#333] transition-colors">
          Nouvelle promotion
        </Link>
      </div>
      <PromotionsList promotions={promotions} />
    </div>
  );
}
