import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import PublicSidebar from "@/components/layout/PublicSidebar";
import { ISSYMA_PALETTE, ISSYMA_STYLES } from "@/components/issyma/theme";

const P = ISSYMA_PALETTE;

/**
 * Coquille commune à toutes les pages Issyma non-accueil (catalogue,
 * catégories, collections, fiche produit) : style tag, en-tête bordeaux,
 * children, footer bordeaux. Aligné visuellement avec `HomeIssymaLayout`
 * — modifier ici propage à toutes les pages Issyma sans toucher BJ.
 */
export default async function IssymaShell({
  shopName,
  jsonLdBlocks,
  children,
}: {
  shopName: string;
  jsonLdBlocks?: object[];
  children: React.ReactNode;
}) {
  const t = await getTranslations("home");

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: ISSYMA_STYLES }} />
      {jsonLdBlocks && jsonLdBlocks.length > 0 && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLdBlocks) }}
        />
      )}

      <div className="issyma-page min-h-screen antialiased">
        <PublicSidebar shopName={shopName} tenantSlug="issyma" />

        {children}

        <footer style={{ background: P.wine950 }}>
          <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-10 py-20">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-12">
              <div>
                <p className="serif text-2xl tracking-[0.18em]" style={{ color: P.cream }}>
                  {shopName.toUpperCase()}
                </p>
                <p
                  className="mt-5 text-sm font-light leading-relaxed max-w-xs"
                  style={{ color: `${P.cream}99` }}
                >
                  {t("issyma.footerAbout")}
                </p>
              </div>
              <div>
                <p className="eyebrow mb-5" style={{ color: `${P.cream2}cc` }}>
                  {t("issyma.footerHouse")}
                </p>
                <ul className="space-y-3 text-sm font-light" style={{ color: `${P.cream}99` }}>
                  <li><Link href="/a-propos" className="hover:opacity-80 transition">{t("issyma.footerAboutLink")}</Link></li>
                  <li><Link href="/nous-contacter" className="hover:opacity-80 transition">{t("issyma.footerContact")}</Link></li>
                </ul>
              </div>
              <div>
                <p className="eyebrow mb-5" style={{ color: `${P.cream2}cc` }}>
                  {t("issyma.footerShop")}
                </p>
                <ul className="space-y-3 text-sm font-light" style={{ color: `${P.cream}99` }}>
                  <li><Link href="/produits?new=1" className="hover:opacity-80 transition">{t("issyma.footerNew")}</Link></li>
                  <li><Link href="/categories" className="hover:opacity-80 transition">{t("issyma.footerCategories")}</Link></li>
                  <li><Link href="/collections" className="hover:opacity-80 transition">{t("issyma.footerCollections")}</Link></li>
                  <li><Link href="/produits?bestseller=1" className="hover:opacity-80 transition">{t("issyma.footerBest")}</Link></li>
                </ul>
              </div>
              <div>
                <p className="eyebrow mb-5" style={{ color: `${P.cream2}cc` }}>
                  {t("issyma.footerHelp")}
                </p>
                <ul className="space-y-3 text-sm font-light" style={{ color: `${P.cream}99` }}>
                  <li><Link href="/cgv" className="hover:opacity-80 transition">{t("issyma.footerCgv")}</Link></li>
                  <li><Link href="/mentions-legales" className="hover:opacity-80 transition">{t("issyma.footerLegal")}</Link></li>
                  <li><Link href="/confidentialite" className="hover:opacity-80 transition">{t("issyma.footerPrivacy")}</Link></li>
                </ul>
              </div>
            </div>

            <div
              className="mt-16 pt-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-center"
              style={{ borderTop: `1px solid ${P.wine800}` }}
            >
              <p className="text-xs tracking-[0.2em] uppercase" style={{ color: `${P.cream}80` }}>
                © {new Date().getFullYear()} {shopName} · {t("issyma.footerRights")}
              </p>
              <p className="text-xs tracking-[0.2em] uppercase" style={{ color: `${P.cream}80` }}>
                {t("issyma.footerLocation")}
              </p>
            </div>
          </div>
        </footer>
      </div>
    </>
  );
}
