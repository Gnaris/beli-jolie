import "@/lib/env";
import type { Metadata } from "next";
import { Poppins, Roboto } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { getServerSession } from "next-auth";
import { cookies, headers } from "next/headers";
import { RTL_LOCALES } from "@/i18n/request";
import { authOptions } from "@/lib/auth";
import SessionProvider from "@/components/providers/SessionProvider";
import { ToastProvider } from "@/components/ui/Toast";
import { ConfirmProvider } from "@/components/ui/ConfirmDialog";
import { OtpConfirmProvider } from "@/components/ui/OtpConfirmDialog";
import { LoadingOverlayProvider } from "@/components/ui/LoadingOverlay";
import { getCachedShopName, getCachedBusinessHours, getCachedSiteConfig } from "@/lib/cached-data";
import { getCachedSeoConfig, buildOrganizationSchema, getSiteUrl } from "@/lib/seo";
import { getCurrentTenantId } from "@/lib/tenant";
import { ADMIN_THEME_COOKIE, parseAdminTheme } from "@/lib/admin-theme";
import AnnouncementBanner from "@/components/layout/AnnouncementBanner";
import { ANNOUNCEMENT_BANNER_INITIAL_HEIGHT_PX } from "@/components/layout/announcement-banner-constants";
import ChatWidgetLoader from "@/components/client/ChatWidgetLoader";
import HeartbeatLoader from "@/components/client/HeartbeatLoader";
import "./globals.css";

/* ─────────────────────────────────────────────
   Fonts Google
   - Poppins : titres modernes et élégants
   - Roboto  : corps de texte lisible et neutre
───────────────────────────────────────────── */
const poppins = Poppins({
  variable: "--font-poppins",
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500", "600", "700"],
});

const roboto = Roboto({
  variable: "--font-roboto",
  subsets: ["latin"],
  display: "swap",
  weight: ["300", "400", "500", "700"],
});

/* ─────────────────────────────────────────────
   Métadonnées SEO globales
───────────────────────────────────────────── */
export async function generateMetadata(): Promise<Metadata> {
  // Bind ALS AVANT tout accès cache/BDD — sinon les caches unstable_cache
  // et l'extension Prisma tombent en "global" et servent la config d'un
  // tenant à l'autre (fuite cross-tenant).
  await getCurrentTenantId();
  const [shopName, siteUrl, taglineRow] = await Promise.all([
    getCachedShopName(),
    getSiteUrl(),
    getCachedSiteConfig("seo_tagline"),
  ]);
  const tagline = taglineRow?.value?.trim() || "Grossiste B2B";
  const fullTitle = `${shopName} — ${tagline}`;
  return {
    metadataBase: new URL(siteUrl),
    title: {
      default: fullTitle,
      template: `%s | ${shopName}`,
    },
    description:
      `${shopName}, plateforme grossiste B2B. Catalogue produits pour revendeurs et professionnels. Qualité premium, tarifs professionnels.`,
    keywords: [
      "grossiste B2B",
      "plateforme professionnelle",
      "revendeur",
      "catalogue produits",
      "vente en gros",
    ],
    authors: [{ name: shopName }],
    openGraph: {
      type: "website",
      locale: "fr_FR",
      siteName: shopName,
      title: fullTitle,
      description:
        "Plateforme grossiste B2B pour professionnels. Catalogue produits, tarifs dégressifs, livraison rapide.",
    },
    twitter: {
      card: "summary_large_image",
      title: fullTitle,
      description: "Catalogue produits pour professionnels. Tarifs grossiste et livraison rapide.",
    },
    robots: { index: true, follow: true },
    manifest: "/manifest.webmanifest",
    verification: {
      google: "RgVY8dXeiuin_PnyWCdNUiRmcLqFWv77fzM33tVD6Vc",
    },
  };
}

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Idem generateMetadata : bind ALS avant caches.
  await getCurrentTenantId();
  const [locale, messages, shopName, businessHours, session, announcementRow, seoConfig, cookieStore, headerStore] = await Promise.all([
    getLocale(),
    getMessages(),
    getCachedShopName(),
    getCachedBusinessHours(),
    getServerSession(authOptions),
    getCachedSiteConfig("announcement_banner"),
    getCachedSeoConfig(),
    cookies(),
    headers(),
  ]);

  // Dark mode admin : on pose la classe `admin-dark` sur <html> en SSR
  // pour supprimer le flash de mode clair au reload. Scopé aux visites
  // /admin uniquement (via le header `x-current-path` posé par le
  // middleware) — les visiteurs publics qui auraient encore le cookie
  // ne voient jamais le dark hors admin.
  const currentPath = headerStore.get("x-current-path") ?? "";
  const isAdminRoute = currentPath.startsWith("/admin");
  const adminTheme = parseAdminTheme(cookieStore.get(ADMIN_THEME_COOKIE)?.value ?? null);
  const htmlThemeClass = isAdminRoute && adminTheme === "dark" ? "admin-dark" : "";

  const organizationJsonLd = buildOrganizationSchema({
    name: shopName,
    url: await getSiteUrl(),
    description: `${shopName} — plateforme grossiste B2B pour professionnels.`,
    email: seoConfig.email,
    phone: seoConfig.phone,
    address: seoConfig.address,
  });

  let announcement: { messages: string[]; bgColor: string; textColor: string; speed?: number } | null = null;
  if (announcementRow?.value) {
    try {
      const parsed = JSON.parse(announcementRow.value);
      if (parsed.messages?.length > 0) {
        announcement = parsed;
      }
    } catch { /* ignore invalid JSON */ }
  }

  const isRTL = (RTL_LOCALES as string[]).includes(locale);

  return (
    <html
      lang={locale}
      dir={isRTL ? "rtl" : "ltr"}
      className={`${poppins.variable} ${roboto.variable} ${htmlThemeClass}`.trim()}
      style={announcement ? ({ "--announcement-height": `${ANNOUNCEMENT_BANNER_INITIAL_HEIGHT_PX}px` } as React.CSSProperties) : undefined}
      suppressHydrationWarning
    >
      <head />
      <body className="antialiased">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(organizationJsonLd),
          }}
        />
        {announcement && (
          <AnnouncementBanner
            messages={announcement.messages}
            bgColor={announcement.bgColor}
            textColor={announcement.textColor}
            speed={announcement.speed}
          />
        )}
        <NextIntlClientProvider messages={messages}>
          <SessionProvider session={session}>
            <ToastProvider>
              <ConfirmProvider>
                <OtpConfirmProvider>
                  <LoadingOverlayProvider>
                    {children}
                    <ChatWidgetLoader businessHours={businessHours} />
                    <HeartbeatLoader />
                    {/* AdminChatWidgetLoader est désormais monté uniquement dans
                        le layout /admin (via le rail droit) — sortir cette ligne
                        évitait un doublon qui plantait sur les pages publiques
                        car useRightRail() n'existe qu'à l'intérieur du rail. */}
                  </LoadingOverlayProvider>
                </OtpConfirmProvider>
              </ConfirmProvider>
            </ToastProvider>
          </SessionProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
