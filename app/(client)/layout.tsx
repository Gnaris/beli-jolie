import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/components/layout/Footer";

/**
 * Layout de l'espace client
 * Protège toutes les routes sous (client)/ — redirige si non connecté
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

  // Un admin ne doit pas accéder à l'espace client
  if (session.user.role === "ADMIN") {
    redirect("/admin");
  }

  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-[#FFFFFF]">
        {children}
      </main>
      <Footer />
    </>
  );
}
