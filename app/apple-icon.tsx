import { ImageResponse } from "next/og";
import { getCachedShopName, getCachedFavicon } from "@/lib/cached-data";
import { readFile, keyFromDbPath } from "@/lib/storage";
import { logger } from "@/lib/logger";
import { getCurrentTenantId } from "@/lib/tenant";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";
export const dynamic = "force-dynamic";

export default async function AppleIcon() {
  await getCurrentTenantId(); // bind ALS pour scope favicon par tenant
  const custom = await getCachedFavicon();
  if (custom?.appleIcon) {
    try {
      const buffer = await readFile(keyFromDbPath(custom.appleIcon));
      return new Response(new Uint8Array(buffer), {
        headers: {
          "Content-Type": "image/png",
          "Cache-Control": "public, max-age=0, must-revalidate",
        },
      });
    } catch (err) {
      logger.warn("[apple-icon] Custom favicon unreadable, falling back to initial", { error: err });
    }
  }

  const shopName = await getCachedShopName();
  const initial = (shopName.trim()[0] ?? "B").toUpperCase();

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0f172a",
          color: "#ffffff",
          fontSize: 110,
          fontWeight: 700,
        }}
      >
        {initial}
      </div>
    ),
    size,
  );
}
