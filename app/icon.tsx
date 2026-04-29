import { ImageResponse } from "next/og";
import { getCachedShopName } from "@/lib/cached-data";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default async function Icon() {
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
          fontSize: 22,
          fontWeight: 700,
          borderRadius: 6,
        }}
      >
        {initial}
      </div>
    ),
    size,
  );
}
