import Script from "next/script";
import { cookies } from "next/headers";
import { getCachedSiteConfig } from "@/lib/cached-data";
import { GTM_CONTAINER_ID_KEY, GTM_CONTAINER_ID_PATTERN } from "@/lib/analytics";
import CookieConsentBanner, { COOKIE_CONSENT_NAME } from "./CookieConsentBanner";

/**
 * Injecte Google Tag Manager + bannière de consentement RGPD sur le site public.
 *
 * Google Consent Mode v2 : avant que gtm.js se charge, on pose les valeurs
 * par défaut dans dataLayer. Tant que l'utilisateur n'a pas cliqué
 * "Accepter", toutes les catégories de stockage restent "denied" — GTM
 * attend la mise à jour avant de déclencher ses tags.
 *
 * Jamais branché sur /admin (l'admin n'a pas de visiteurs à tracker).
 */
export default async function GtmAnalytics() {
  const [gtmRow, cookieStore] = await Promise.all([
    getCachedSiteConfig(GTM_CONTAINER_ID_KEY),
    cookies(),
  ]);
  const gtmId = (gtmRow?.value ?? "").trim();
  if (!gtmId || !GTM_CONTAINER_ID_PATTERN.test(gtmId)) return null;

  const consentCookie = cookieStore.get(COOKIE_CONSENT_NAME)?.value ?? "";
  const granted = consentCookie === "accepted";
  const defaultState = granted ? "granted" : "denied";

  return (
    <>
      <Script id="gtm-consent-default" strategy="beforeInteractive">
        {`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
window.gtag = window.gtag || gtag;
gtag('consent', 'default', {
  ad_storage: '${defaultState}',
  ad_user_data: '${defaultState}',
  ad_personalization: '${defaultState}',
  analytics_storage: '${defaultState}',
  functionality_storage: '${defaultState}',
  personalization_storage: '${defaultState}',
  security_storage: 'granted',
  wait_for_update: 500
});`}
      </Script>
      <Script id="gtm-main" strategy="afterInteractive">
        {`(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer','${gtmId}');`}
      </Script>
      <noscript>
        <iframe
          src={`https://www.googletagmanager.com/ns.html?id=${gtmId}`}
          height="0"
          width="0"
          style={{ display: "none", visibility: "hidden" }}
          title="gtm-noscript"
        />
      </noscript>
      <CookieConsentBanner initialDecision={consentCookie} />
    </>
  );
}
