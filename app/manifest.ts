import type { MetadataRoute } from "next";
import { getCachedShopName } from "@/lib/cached-data";

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const shopName = await getCachedShopName();
  return {
    name: shopName,
    short_name: shopName,
    description: `${shopName} — plateforme grossiste B2B`,
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#0f172a",
    icons: [
      {
        src: "/icon",
        sizes: "32x32",
        type: "image/png",
      },
      {
        src: "/apple-icon",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  };
}
