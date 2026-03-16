import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { authOptions } from "@/lib/auth";
import PublicSidebar from "@/components/layout/PublicSidebar";

export default async function ClientLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);

  if (!session) redirect("/connexion?callbackUrl=/espace-pro");

  const cookieStore = await cookies();
  const isPreview = cookieStore.get("bj_admin_preview")?.value === "1";

  if (session.user.role === "ADMIN" && !isPreview) redirect("/admin");

  return (
    <div className="min-h-screen bg-bg-secondary">
      <PublicSidebar />
      <main className={`min-h-[calc(100vh-64px)]${session.user.role === "ADMIN" && isPreview ? " pb-20" : ""}`}>
        {children}
      </main>
    </div>
  );
}
