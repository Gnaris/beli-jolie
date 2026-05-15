import { ImageResponse } from "next/og";
import sharp from "sharp";
import { getCachedShopName, getCachedFavicon } from "@/lib/cached-data";
import { readFile, keyFromDbPath } from "@/lib/storage";
import { logger } from "@/lib/logger";

export const size = { width: 192, height: 192 };
export const contentType = "image/png";
// Force per-request rendering so admin can swap the favicon without rebuilds.
// The browser still caches the favicon aggressively; the request to this route
// only happens on hard refresh / first visit, so cost is negligible.
export const dynamic = "force-dynamic";

export default async function Icon() {
  const custom = await getCachedFavicon();
  if (custom?.icon) {
    try {
      const buffer = await readFile(keyFromDbPath(custom.icon));
      // Google requires favicons ≥ 48px square (recommended: 192×192). If the
      // uploaded file is smaller, upscale it to match the declared size.
      const meta = await sharp(buffer).metadata();
      const needsResize =
        (meta.width ?? 0) < size.width || (meta.height ?? 0) < size.height;
      const final = needsResize
        ? await sharp(buffer)
            .resize(size.width, size.height, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
            .png()
            .toBuffer()
        : buffer;
      return new Response(new Uint8Array(final), {
        headers: {
          "Content-Type": "image/png",
          "Cache-Control": "public, max-age=0, must-revalidate",
        },
      });
    } catch (err) {
      // File missing / unreadable → log and fall back to the generated icon.
      logger.warn("[icon] Custom favicon unreadable, falling back to initial", { error: err });
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
          fontSize: 130,
          fontWeight: 700,
          borderRadius: 36,
        }}
      >
        {initial}
      </div>
    ),
    size,
  );
}
