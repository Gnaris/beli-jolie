import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import LiveClientsTracker from "@/components/admin/tracking/LiveClientsTracker";

export const metadata: Metadata = {
  title: "Suivi en direct — Admin",
};

export default async function SuiviPage() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") redirect("/connexion");

  return (
    <div className="space-y-6 animate-fadeIn">
      <div>
        <h1 className="page-title">Suivi en direct</h1>
        <p className="page-subtitle">
          Activité des clients connectés en temps réel
        </p>
      </div>

      <LiveClientsTracker />
    </div>
  );
}
