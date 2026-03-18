import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Lightweight endpoint used by middleware to check maintenance mode.
// Keep this fast — no auth, no heavy queries.
export async function GET() {
  try {
    const config = await prisma.siteConfig.findUnique({
      where: { key: "maintenance_mode" },
    });
    return NextResponse.json(
      { maintenance: config?.value === "true" },
      {
        headers: {
          // Allow CDN/edge caching for max 30 seconds
          "Cache-Control": "public, s-maxage=30",
        },
      }
    );
  } catch {
    // On DB error, assume not in maintenance to avoid locking everyone out
    return NextResponse.json({ maintenance: false });
  }
}
