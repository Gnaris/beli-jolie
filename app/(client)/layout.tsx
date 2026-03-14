import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import PublicSidebar from "@/components/layout/PublicSidebar";

/**
 * Layout espace client — sidebar gauche + contenu droit
 */
export default async function ClientLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);

  if (!session) {
    redirect("/connexion?callbackUrl=/espace-pro");
  }

  if (session.user.role === "ADMIN") {
    redirect("/admin");
  }

  return (
    <div className="flex min-h-screen">
      <PublicSidebar />
      <main className="flex-1 lg:ml-60 pt-14 lg:pt-0 min-w-0">
        {children}
      </main>
    </div>
  );
}
