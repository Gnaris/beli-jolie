import { headers } from "next/headers";
import { VALID_LOCALES } from "@/i18n/locales";

// Index des sitemaps (1 sitemap par langue, générés par app/sitemap.ts via
// generateSitemaps → /sitemap/fr.xml, /sitemap/en.xml, …).
// C'est cette URL qui est déclarée dans robots.txt et la Search Console.
// /sitemap.xml (ancienne URL) redirige ici en 301 depuis le middleware.
export const dynamic = "force-dynamic";

export async function GET() {
  let baseUrl = (process.env.NEXTAUTH_URL || "https://example.com").replace(/\/$/, "");
  try {
    const h = await headers();
    const host = h.get("host");
    if (host) baseUrl = `https://${host.replace(/^www\./, "")}`;
  } catch {
    // hors requête : fallback env
  }
  const lastmod = new Date().toISOString();
  const body =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    VALID_LOCALES.map(
      (locale) =>
        `<sitemap>\n<loc>${baseUrl}/sitemap/${locale}.xml</loc>\n<lastmod>${lastmod}</lastmod>\n</sitemap>\n`,
    ).join("") +
    `</sitemapindex>\n`;

  return new Response(body, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
