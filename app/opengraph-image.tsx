import { ImageResponse } from "next/og";
import sharp from "sharp";
import { getCachedShopName, getCachedSiteConfig } from "@/lib/cached-data";
import { getCachedSeoConfig, getSiteUrl } from "@/lib/seo";
import { getCurrentTenantId } from "@/lib/tenant";
import { readFile, keyFromDbPath } from "@/lib/storage";
import { logger } from "@/lib/logger";

/**
 * Image Open Graph par défaut de la boutique.
 *
 * Utilisée automatiquement par Next 16 comme fallback `og:image` /
 * `twitter:image` sur toutes les pages qui ne définissent pas leur propre
 * `openGraph.images` (produits ont déjà leur photo — cette image sert pour
 * home, /produits, /categories, /collections, /a-propos, etc.).
 *
 * Multi-tenant : le tenant est résolu via `getCurrentTenantId()` (Host header
 * → x-tenant-id → ALS). Chaque boutique a donc son propre visuel.
 *
 * Ordre de priorité :
 *   1. Image OG uploadée par l'admin (SiteConfig `site_og_image_url`) —
 *      renvoyée telle quelle (redirect 302 vers l'URL publique).
 *   2. Composition auto : logo (si dispo) + nom boutique + tagline sur fond
 *      slate (palette admin BJ, cohérent avec la charte).
 */

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
// Force per-request rendering : l'admin peut changer le logo/tagline sans
// devoir rebuilder. Le coût est absorbé par les scrapers réseaux (Facebook,
// WhatsApp) qui ne hit qu'à la 1ʳᵉ résolution de lien.
export const dynamic = "force-dynamic";

export default async function OpenGraphImage() {
  await getCurrentTenantId();

  const [shopName, seoConfig, taglineRow, siteUrl] = await Promise.all([
    getCachedShopName(),
    getCachedSeoConfig(),
    getCachedSiteConfig("seo_tagline"),
    getSiteUrl(),
  ]);

  // 1. Image OG explicite uploadée → on renvoie une redirection vers l'URL
  //    publique. Les scrapers OG suivent les 302.
  if (seoConfig.ogImageUrl) {
    const abs = seoConfig.ogImageUrl.startsWith("http")
      ? seoConfig.ogImageUrl
      : `${siteUrl}${seoConfig.ogImageUrl}`;
    return Response.redirect(abs, 302);
  }

  const tagline = taglineRow?.value?.trim() || "Grossiste B2B";

  // 2. Charge le logo local pour l'embed dans l'image générée. Satori ne
  //    peut pas fetcher un chemin relatif — il faut passer le buffer inline.
  let logoDataUri: string | null = null;
  if (seoConfig.logoUrl && seoConfig.logoUrl.startsWith("/")) {
    try {
      const buf = await readFile(keyFromDbPath(seoConfig.logoUrl));
      // Satori ne lit pas SVG, on convertit toujours en PNG pour être safe.
      const png = await sharp(buf).resize(240, 240, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 0 } }).png().toBuffer();
      logoDataUri = `data:image/png;base64,${png.toString("base64")}`;
    } catch (err) {
      logger.warn("[opengraph-image] Logo unreadable, falling back to initial", { error: err });
    }
  }

  const initial = (shopName.trim()[0] ?? "B").toUpperCase();

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: "linear-gradient(135deg, #0f172a 0%, #1e293b 55%, #334155 100%)",
          color: "#ffffff",
          fontFamily: "sans-serif",
          padding: "72px 88px",
          position: "relative",
        }}
      >
        {/* Halo décoratif */}
        <div
          style={{
            position: "absolute",
            top: -160,
            right: -120,
            width: 520,
            height: 520,
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(148,163,184,0.28) 0%, rgba(15,23,42,0) 70%)",
            display: "flex",
          }}
        />

        {/* Header : logo ou pastille initiale */}
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          {logoDataUri ? (
            <div
              style={{
                width: 108,
                height: 108,
                borderRadius: 24,
                background: "#ffffff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: 10,
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={logoDataUri} width={88} height={88} alt="" style={{ objectFit: "contain" }} />
            </div>
          ) : (
            <div
              style={{
                width: 108,
                height: 108,
                borderRadius: 24,
                background: "linear-gradient(135deg,#64748b,#334155)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#ffffff",
                fontSize: 56,
                fontWeight: 700,
              }}
            >
              {initial}
            </div>
          )}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 4,
            }}
          >
            <div style={{ fontSize: 20, letterSpacing: 6, color: "#cbd5e1", textTransform: "uppercase" }}>
              Grossiste B2B
            </div>
            <div style={{ fontSize: 34, fontWeight: 600, color: "#f8fafc" }}>{shopName}</div>
          </div>
        </div>

        {/* Bloc principal */}
        <div
          style={{
            marginTop: "auto",
            display: "flex",
            flexDirection: "column",
            gap: 24,
            maxWidth: 900,
          }}
        >
          <div
            style={{
              fontSize: 76,
              lineHeight: 1.05,
              fontWeight: 700,
              color: "#ffffff",
              letterSpacing: -1,
            }}
          >
            {tagline}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div
              style={{
                display: "flex",
                width: 12,
                height: 12,
                borderRadius: 999,
                background: "#10b981",
              }}
            />
            <div style={{ fontSize: 24, color: "#cbd5e1" }}>
              Catalogue réservé aux professionnels
            </div>
          </div>
        </div>

        {/* Footer : URL de la boutique */}
        <div
          style={{
            position: "absolute",
            bottom: 40,
            right: 88,
            fontSize: 22,
            color: "#94a3b8",
            display: "flex",
          }}
        >
          {siteUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")}
        </div>
      </div>
    ),
    size,
  );
}
