import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import PublicSidebar from "@/components/layout/PublicSidebar";

export default async function ClientLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);

  if (!session) redirect("/connexion?callbackUrl=/espace-pro");
  if (session.user.role === "ADMIN") redirect("/admin");

  return (
    <div className="min-h-screen bg-bg-secondary">
      <PublicSidebar />
      <main className="min-h-[calc(100vh-64px)]">
        {children}
      </main>
    </div>
  );
}
