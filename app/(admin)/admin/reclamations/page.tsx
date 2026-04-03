import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { getAdminClaims } from "@/app/actions/admin/claims";
import AdminClaimsList from "./AdminClaimsList";

export const metadata = { title: "Reclamations — Admin" };

export default async function AdminClaimsPage() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") redirect("/connexion");

  const claims = await getAdminClaims();

  return (
    <div className="space-y-6">
      <h1 className="font-heading text-2xl font-bold text-text-primary">Reclamations</h1>
      <AdminClaimsList initialClaims={claims} />
    </div>
  );
}
