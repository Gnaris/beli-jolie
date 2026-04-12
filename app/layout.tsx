import "@/lib/env";
import type { Metadata } from "next";
import { Poppins, Roboto } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { getServerSession } from "next-auth";
import { RTL_LOCALES } from "@/i18n/request";
import { authOptions } from "@/lib/auth";
import SessionProvider from "@/components/providers/SessionProvider";
import { ToastProvider } from "@/components/ui/Toast";
import { ConfirmProvider } from "@/components/ui/ConfirmDialog";
import { LoadingOverlayProvider } from "@/components/ui/LoadingOverlay";
import AccessCodeTracker from "@/components/layout/AccessCodeTracker";
import GuestBanner from "@/components/layout/GuestBanner";
import HeartbeatTracker from "@/components/layout/HeartbeatTracker";
import { getCachedShopName, getCachedBusinessHours, getCachedSiteConfig } from "@/lib/cached-data";
import AnnouncementBanner from "@/components/layout/AnnouncementBanner";
import ChatWidgetLoader from "@/components/client/ChatWidgetLoader";
import AdminChatWidgetLoader from "@/components/admin/AdminChatWidgetLoader";
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
  const shopName = await getCachedShopName();
  return {
    title: {
      default: `${shopName} — Grossiste B2B`,
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
      title: `${shopName} — Grossiste B2B`,
      description:
        "Plateforme grossiste B2B pour professionnels. Catalogue produits, tarifs dégressifs, livraison rapide.",
    },
    twitter: {
      card: "summary_large_image",
      title: `${shopName} — Grossiste B2B`,
      description: "Catalogue produits pour professionnels. Tarifs grossiste et livraison rapide.",
    },
    robots: { index: true, follow: true },
  };
}

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const [locale, messages, shopName, businessHours, session, announcementRow] = await Promise.all([
    getLocale(),
    getMessages(),
    getCachedShopName(),
    getCachedBusinessHours(),
    getServerSession(authOptions),
    getCachedSiteConfig("announcement_banner"),
  ]);

  let announcement: { messages: string[]; bgColor: string; textColor: string; speed?: number } | null = null;
  if (announcementRow?.value) {
    try {
      const parsed = JSON.parse(announcementRow.value);
      if (parsed.messages?.length > 0) {
        announcement = parsed;
      }
    } catch { /* ignore invalid JSON */ }
  }

  const isRTL = RTL_LOCALES.includes(locale as "ar");

  return (
    <html
      lang={locale}
      dir={isRTL ? "rtl" : "ltr"}
      className={`${poppins.variable} ${roboto.variable}`}
      suppressHydrationWarning
    >
      <head />
      <body className="antialiased">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "Organization",
              name: shopName,
              description: "Plateforme grossiste B2B pour professionnels.",
              url: process.env.NEXTAUTH_URL || "https://example.com",
            }),
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
                <LoadingOverlayProvider>
                  <GuestBanner />
                  <AccessCodeTracker />
                  <HeartbeatTracker />
                  {children}
                  <ChatWidgetLoader businessHours={businessHours} />
                  <AdminChatWidgetLoader />
                </LoadingOverlayProvider>
              </ConfirmProvider>
            </ToastProvider>
          </SessionProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
