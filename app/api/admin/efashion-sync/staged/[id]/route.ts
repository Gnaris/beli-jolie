import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { approveEfashionStagedProduct, rejectEfashionStagedProduct, retryEfashionStagedProduct } from "@/lib/efashion-prepare";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const { id } = await params;
  const body = await req.json();
  const { action } = body;

  try {
    if (action === "approve") {
      const result = await approveEfashionStagedProduct(id);
      return NextResponse.json({ success: true, result });
    } else if (action === "reject") {
      const result = await rejectEfashionStagedProduct(id);
      return NextResponse.json({ success: true, result });
    } else if (action === "retry") {
      const result = await retryEfashionStagedProduct(id);
      return NextResponse.json({ success: true, result });
    } else {
      return NextResponse.json({ error: "Action invalide" }, { status: 400 });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
