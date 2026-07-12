import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { routing } from "@/i18n/routing";
import TrackVisitPixel from "@/components/analytics/TrackVisitPixel";
import { getCurrentTenantId } from "@/lib/tenant";

interface LocaleLayoutProps {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}

export default async function LocaleLayout({ children, params }: LocaleLayoutProps) {
  // Bind ALS AVANT que les pages enfants queryent Prisma / caches — sinon
  // l'extension tenant-scope et tenantScopedCache tombent en fallback global
  // et servent les données d'un tenant à l'autre.
  await getCurrentTenantId();
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  return (
    <>
      {children}
      <TrackVisitPixel />
    </>
  );
}
