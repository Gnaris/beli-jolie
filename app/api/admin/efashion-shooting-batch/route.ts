/**
 * /api/admin/efashion-shooting-batch
 *
 * GET    : liste les items en attente + état de validation
 * POST   : ajoute ou rafraîchit un produit dans la file
 *          body : { productId: string, mode: "PUBLISH" | "REFRESH" }
 * DELETE : retire un produit
 *          body : { productId: string }
 */

import { NextResponse, type NextRequest } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import {
  addToEfashionShootingBatch,
  listEfashionShootingBatch,
  removeFromEfashionShootingBatch,
} from "@/app/actions/admin/efashion-shooting-batch";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès non autorisé." }, { status: 401 });
  }
  const state = await listEfashionShootingBatch();
  return NextResponse.json(state);
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès non autorisé." }, { status: 401 });
  }
  let body: { productId?: string; mode?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON invalide." }, { status: 400 });
  }
  if (typeof body.productId !== "string" || body.productId.length === 0) {
    return NextResponse.json({ error: "productId requis." }, { status: 400 });
  }
  if (body.mode !== "PUBLISH" && body.mode !== "REFRESH") {
    return NextResponse.json(
      { error: "mode doit être PUBLISH ou REFRESH." },
      { status: 400 },
    );
  }
  const res = await addToEfashionShootingBatch(body.productId, body.mode);
  if (!res.success) return NextResponse.json({ error: res.error }, { status: 400 });
  return NextResponse.json({ success: true });
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès non autorisé." }, { status: 401 });
  }
  let body: { productId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON invalide." }, { status: 400 });
  }
  if (typeof body.productId !== "string" || body.productId.length === 0) {
    return NextResponse.json({ error: "productId requis." }, { status: 400 });
  }
  await removeFromEfashionShootingBatch(body.productId);
  return NextResponse.json({ success: true });
}
