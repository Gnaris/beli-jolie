/**
 * STUB — route /api/admin/ankorstore-search désactivée (2026-08-13).
 * Remplacée par le flow direct via `searchAnkorstoreBoCandidatesForBjProduct`
 * dans la nouvelle modale `LinkAnkorstoreProductModal` v2.
 */
"use server";

import { NextResponse } from "next/server";

export async function GET(): Promise<Response> {
  return NextResponse.json({
    error: "Endpoint désactivé — utiliser la nouvelle modale de liaison Ankorstore.",
    results: [],
  }, { status: 410 });
}
