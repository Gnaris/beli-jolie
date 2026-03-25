import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";

/**
 * POST /api/admin/revalidate
 * Body: { tags: string[], secret: string }
 *
 * Revalidates the given cache tags. Protected by NEXTAUTH_SECRET.
 * Used by CLI scripts (clear-products, seed, etc.) that modify data
 * outside of Next.js server actions.
 */
export async function POST(req: NextRequest) {
  const { tags, secret } = await req.json();

  if (secret !== process.env.NEXTAUTH_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!Array.isArray(tags) || tags.length === 0) {
    return NextResponse.json({ error: "tags required" }, { status: 400 });
  }

  for (const tag of tags) {
    revalidateTag(tag, "default");
  }

  return NextResponse.json({ revalidated: tags });
}
