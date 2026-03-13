import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import ClientSidebar from "@/components/layout/ClientSidebar";

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
    <div className="min-h-screen bg-[#F5F5F5]">
      <ClientSidebar />
      {/* Contenu décalé de la largeur de la sidebar sur desktop */}
      <main className="lg:ml-60 min-h-screen pt-0 lg:pt-0">
        {/* Offset pour header mobile */}
        <div className="pt-14 lg:pt-0">
          {children}
        </div>
      </main>
    </div>
  );
}
