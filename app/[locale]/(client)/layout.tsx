import { getServerSession } from "next-auth";
import { redirect } from "@/i18n/navigation";
import { redirect as nextRedirect } from "next/navigation";
import { cookies } from "next/headers";
import { authOptions } from "@/lib/auth";
import { getCachedShopName } from "@/lib/cached-data";
import PublicSidebar from "@/components/layout/PublicSidebar";
import Footer from "@/components/layout/Footer";

interface ClientLayoutProps {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}

export default async function ClientLayout({ children, params }: ClientLayoutProps) {
  const { locale } = await params;
  const session = await getServerSession(authOptions);

  if (!session) {
    return redirect({href: {pathname: "/connexion", query: { callbackUrl: `/${locale}/espace-pro` }}, locale});
  }

  const cookieStore = await cookies();
  const isPreview = cookieStore.get("bj_admin_preview")?.value === "1";

  if (session.user.role === "ADMIN" && !isPreview) nextRedirect("/admin");

  const shopName = await getCachedShopName();

  return (
    <div className="min-h-screen bg-bg-secondary flex flex-col">
      <PublicSidebar shopName={shopName} />
      <main className="flex-1 py-10 px-4">
        {children}
      </main>
      <Footer shopName={shopName} />
    </div>
  );
}
