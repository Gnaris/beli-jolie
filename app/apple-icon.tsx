import { ImageResponse } from "next/og";
import { getCachedShopName } from "@/lib/cached-data";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default async function AppleIcon() {
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
