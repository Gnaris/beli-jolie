import { getServerSession } from "next-auth";
import { redirect } from "@/i18n/navigation";
import { redirect as nextRedirect } from "next/navigation";
import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";
import { authOptions } from "@/lib/auth";
import { getCachedShopName } from "@/lib/cached-data";
import PublicSidebar from "@/components/layout/PublicSidebar";
import Footer from "@/components/layout/Footer";
import AccountStatusWatcher from "@/components/client/AccountStatusWatcher";
import LogoutButton from "@/components/client/LogoutButton";

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

  // Compte en attente de validation : pas de header ni de footer, et on
  // remplace le contenu par un message centré. Le watcher rafraîchit la
  // page dès que l'admin valide le compte.
  if (session.user.status === "PENDING") {
    const t = await getTranslations("account");
    return (
      <div className="min-h-screen bg-bg-secondary flex items-center justify-center p-6">
        <div className="max-w-md w-full text-center">
          <h1 className="font-heading text-2xl font-semibold text-text-primary">
            {t("pendingValidation")}
          </h1>
          <p className="mt-3 text-sm font-body text-text-secondary leading-relaxed">
            {t("pendingValidationDesc")}
          </p>
          <div className="mt-8 flex justify-center">
            <LogoutButton />
          </div>
        </div>
        <AccountStatusWatcher initialStatus="PENDING" />
      </div>
    );
  }

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
